import { Injectable } from '@angular/core';
import { bubbles, BubbleTemplate, Option } from '../data/bubble-template';

export interface Point {
  x: number;
  y: number;
}

export interface Marker {
  center: Point;
  rect: { x: number, y: number, w: number, h: number };
}

@Injectable({ providedIn: 'root' })
export class OmrLiteService {
  // Config matching bubble-template.ts
  readonly SHEET_WIDTH = 800;
  readonly SHEET_HEIGHT = 1131;
  readonly FILL_THRESHOLD = 0.35; // 35% darkness threshold for Lite Engine

  // Expected marker positions in template
  readonly TEMPLATE_MARKERS: Point[] = [
    { x: 42.5, y: 42.5 },   // TL (center of 45x45 rect at 20,20)
    { x: 757.5, y: 42.5 },  // TR
    { x: 757.5, y: 1088.5 }, // BR
    { x: 42.5, y: 1088.5 }  // BL
  ];

  /**
   * Main entry point: process a canvas frame and return results.
   */
  processFrame(canvas: HTMLCanvasElement, answerKey: string[]): { gradingResults: any[]; studentHash?: number | null } {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get canvas context');

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // 1. Corner marker detection (reduces false positives from arbitrary scenes)
    //    We require 4 reliable markers; if we can't see the template, we fail
    //    fast instead of returning fake results.
    const quadMarkers = this.detectMarkers(data, width, height);
    if (quadMarkers.length !== 4) {
      throw new Error(`Sheet not fully visible. Ensure all 4 black corner markers are inside the frame.`);
    }

    const markersToUse: Point[] = quadMarkers.map(m => m.center);

    // 3. Compute Perspective Transform
    const sortedMarkers = this.sortCorners(markersToUse);
    const transform = this.getPerspectiveTransform(this.TEMPLATE_MARKERS, sortedMarkers);

    // 4. Decode student identity code (if present)
    const studentHash = this.decodeStudentCode(data, width, height, transform);

    // 5. Sample Bubbles (ZipGrade-style: local background normalization + adaptive threshold)
    const results: Array<{
      questionNumber: number;
      detectedAnswer: string | null;
      correctAnswer: string;
      status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid';
      confidence?: number;
    }> = [];
    const normalizedKey = Array.isArray(answerKey) ? answerKey : [];
    const requestedCount = normalizedKey.length;
    const questionsToProcess = Math.max(
      1,
      Math.min(
        bubbles.length,
        requestedCount > 0 ? requestedCount : 50
      )
    );

    // Pass 1: Collect all fill data and per-question top scores for adaptive threshold
    const perQuestionData: Array<{
      fills: { option: Option; score: number }[];
      top: { option: Option; score: number };
      second: { option: Option; score: number };
    }> = [];

    for (let q = 0; q < questionsToProcess; q++) {
      const template = bubbles[q];
      const fills: { option: Option, score: number }[] = [];

      (['A', 'B', 'C', 'D'] as Option[]).forEach(opt => {
        const coord = template.options[opt];
        const imgPt = this.applyTransform(transform, coord.cx, coord.cy);

        // ZipGrade-style: Sample center only, use annulus as local background
        const innerRadius = Math.max(3, coord.radius * 0.55);
        const ringInner = Math.max(innerRadius + 2, coord.radius * 0.95);
        const ringOuter = Math.max(ringInner + 2, coord.radius * 1.45);

        const innerMean = this.getMeanBrightnessInDisk(data, width, height, imgPt, innerRadius);
        const ringMean = this.getMeanBrightnessInRing(data, width, height, imgPt, ringInner, ringOuter);

        const bg = Number.isFinite(ringMean) && ringMean > 0 ? ringMean : innerMean;
        // Normalize relative to local background so light pencil shading still registers.
        const denom = Math.max(60, bg);
        const score = denom > 0 ? this.clamp01((bg - innerMean) / denom) : 0;
        fills.push({ option: opt, score });
      });

      const sortedFills = [...fills].sort((a, b) => b.score - a.score);
      perQuestionData.push({
        fills,
        top: sortedFills[0],
        second: sortedFills[1]
      });
    }

    // ZipGrade-style adaptive threshold: use sheet-wide statistics
    // Strong marks = 85th percentile of best fill per question.
    // Also require a minimum number of questions with clear marks to avoid blank-sheet false positives.
    const bestScores = perQuestionData.map((d) => d.top.score).filter((s) => s > 0.005);
    const sorted = bestScores.length > 0 ? [...bestScores].sort((a, b) => a - b) : [];
    const qStrong = 0.85;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(qStrong * (sorted.length - 1))));
    const strong = sorted.length > 0 ? sorted[idx] : 0.0;

    const maxBest = bestScores.length > 0 ? Math.max(...bestScores) : 0.0;

    // More forgiving thresholds for low‑quality cameras / younger students:
    // - Allow slightly lighter fills to count as marked.
    // - Still require a reasonable gap between top and second option to avoid double-mark noise.
    const baseFill = strong > 0 ? strong * 0.6 : 0.16;
    const approxMinFill = Math.max(0.10, Math.min(0.28, baseFill));
    const approxMinGap = Math.max(0.05, Math.min(0.16, approxMinFill * 0.55));
    const confidentMarks = perQuestionData.filter(
      (d) => d.top.score >= approxMinFill && (d.top.score - d.second.score) >= approxMinGap
    ).length;

    console.log(
      '[OmrLite] strong:',
      strong.toFixed(3),
      'approxMinFill:',
      approxMinFill.toFixed(3),
      'approxMinGap:',
      approxMinGap.toFixed(3),
      'confidentMarks:',
      confidentMarks
    );

    // Single-pass thresholds: conservative baseline so blank sheets remain blank
    // even without a separate "blank sheet" shortcut.
    // Lower cutoff so lightly-marked pencil sheets are not forced to blank.
    const isLikelyBlankSheet = maxBest < 0.12;
    const minFill = isLikelyBlankSheet ? 1 : approxMinFill;
    const minGap = approxMinGap;

    // Pass 2: Grade using adaptive thresholds
    for (let q = 0; q < questionsToProcess; q++) {
      const { fills, top, second } = perQuestionData[q];
      const correctAns = this.normalizeAnswerLetter(normalizedKey[q]);

      let status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid' = 'Blank';
      let detectedAnswer: string | null = null;

      if (top.score < minFill) {
        status = 'Blank';
      } else if ((top.score - second.score) < minGap) {
        status = 'Invalid';
      } else {
        detectedAnswer = top.option;
        if (!correctAns) {
          status = 'Invalid';
        } else {
          status = detectedAnswer === correctAns ? 'Correct' : 'Incorrect';
        }
      }

      const rawMap: { [key: string]: number } = {};
      fills.forEach(f => { rawMap[f.option] = f.score; });

      results.push({
        questionNumber: q + 1,
        detectedAnswer,
        correctAnswer: correctAns,
        status,
        confidence: top.score,
        // rawScores is only used by scan.page for debug; it's handled in OpenCvScannerService.
      });
    }

    return { gradingResults: results, studentHash };
  }

  public detectMarkersForPreview(data: Uint8ClampedArray, width: number, height: number): Point[] {
    const markers = this.detectMarkers(data, width, height);
    return markers.map((m) => m.center);
  }

  /**
   * Decode the small 8x8 student identity grid drawn in the header.
   * Returns the lower 16-bit student hash (studentId & 0xffff) or null.
   */
  private decodeStudentCode(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    h: number[]
  ): number | null {
    // Grid definition must match answer-sheet-generator.page.html
    // Placed in the blank area between CLASS/DATE and the roll number box
    const originX = 320;
    const originY = 150;
    const cell = 6;
    const size = 8;

    const bits: number[] = [];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Skip outer border row/col 0 (finder)
        if (r === 0 || c === 0) continue;

        const u = originX + c * cell + cell / 2;
        const v = originY + r * cell + cell / 2;
        const pt = this.applyTransform(h, u, v);
        const brightness = this.getMeanBrightnessInDisk(data, width, height, pt, cell * 0.4);
        const bit = brightness < 150 ? 1 : 0;
        bits.push(bit);
      }
    }

    if (bits.length < 48) return null;

    const read16 = (offset: number): number => {
      let val = 0;
      for (let i = 0; i < 16; i++) {
        val = (val << 1) | (bits[offset + i] ? 1 : 0);
      }
      return val & 0xffff;
    };

    // const classPart = read16(0);
    // const subjectPart = read16(16);
    const studentPart = read16(32);
    return studentPart;
  }

  /**
   * Scans the ENTIRE image for potential markers using a fast stride.
   */
  private findAllMarkersGlobal(data: Uint8ClampedArray, width: number, height: number): Point[] {
    const markers: Point[] = [];
    const stride = 10; // Fast global scan
    
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 110) { // Potential marker dark pixel
          // Check if this point matches the nested marker pattern
          // We use a small local quadrant around this point
          const localQuad = {
            x1: Math.max(0, x - 20),
            y1: Math.max(0, y - 20),
            x2: Math.min(width, x + 20),
            y2: Math.min(height, y + 20)
          };
          const marker = this.findNestedMarker(data, width, height, localQuad);
          if (marker) {
            // Avoid duplicate markers near each other
            if (!markers.some(m => Math.hypot(m.x - marker.center.x, m.y - marker.center.y) < 50)) {
              markers.push(marker.center);
            }
          }
        }
      }
    }
    return markers;
  }

  private findBestSheetRectangle(points: Point[], width: number, height: number): Point[] | null {
    if (points.length < 4) return null;
    
    // Sort by Y to split into Top and Bottom halves
    const sortedY = [...points].sort((a, b) => a.y - b.y);
    const topPoints = sortedY.slice(0, Math.ceil(points.length / 2)).sort((a, b) => a.x - b.x);
    const bottomPoints = sortedY.slice(Math.floor(points.length / 2)).sort((a, b) => b.x - a.x);
    
    if (topPoints.length < 2 || bottomPoints.length < 2) return null;
    
    // Candidate corners: TL, TR, BR, BL
    const tl = topPoints[0];
    const tr = topPoints[topPoints.length - 1];
    const br = bottomPoints[0];
    const bl = bottomPoints[bottomPoints.length - 1];
    
    // Validate this is a reasonable sheet rectangle:
    // 1. TL must be in top-left region, TR in top-right, etc.
    const margin = 0.15; // Each corner must be within 15% of its expected region
    const w = width, h = height;
    
    const inRegion = (p: Point, xMin: number, xMax: number, yMin: number, yMax: number) =>
      p.x >= xMin * w && p.x <= xMax * w && p.y >= yMin * h && p.y <= yMax * h;
    
    if (!inRegion(tl, 0, margin, 0, margin)) return null;
    if (!inRegion(tr, 1 - margin, 1, 0, margin)) return null;
    if (!inRegion(br, 1 - margin, 1, 1 - margin, 1)) return null;
    if (!inRegion(bl, 0, margin, 1 - margin, 1)) return null;
    
    // 2. Aspect ratio should be roughly A4 (1:1.4) accounting for perspective
    const rectW = Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y);
    const rectH = Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y);
    const aspect = rectW / rectH;
    if (aspect < 0.5 || aspect > 1.2) return null; // A4 is ~0.7, allow some skew
    
    // 3. Minimum size - rectangle should cover at least 10% of frame area
    const area = rectW * rectH / 2;
    if (area < width * height * 0.10) return null;
    
    return [tl, tr, br, bl];
  }

  private getPaperWhite(data: Uint8ClampedArray, width: number, height: number, corners: Point[]): number {
    // Sample a small area in the center of the 4 markers
    const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
    const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
    
    let total = 0, count = 0;
    for (let y = Math.round(cy - 20); y < cy + 20; y++) {
      for (let x = Math.round(cx - 20); x < cx + 20; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const idx = (y * width + x) * 4;
        total += (data[idx] + data[idx+1] + data[idx+2]) / 3;
        count++;
      }
    }
    return count > 0 ? total / count : 200; // Fallback to safe grey-white
  }

  /**
   * Find 4 nested square markers by looking in corner quadrants.
   * Uses larger quadrants (45%) to detect markers even when camera is close.
   */
  private detectMarkers(data: Uint8ClampedArray, width: number, height: number): Marker[] {
    const markers: Marker[] = [];
    // Larger quadrants (55%) to catch markers both when camera is close and when
    // the sheet is slightly rotated / not perfectly centered.
    // No margin - markers can be at the very edge of the frame
    const qW = Math.round(width * 0.55);
    const qH = Math.round(height * 0.55);

    const quadrants = [
      { x1: 0, y1: 0, x2: qW, y2: qH },                       // TL
      { x1: width - qW, y1: 0, x2: width, y2: qH },           // TR
      { x1: width - qW, y1: height - qH, x2: width, y2: height }, // BR
      { x1: 0, y1: height - qH, x2: qW, y2: height }          // BL
    ];

    for (const quad of quadrants) {
      const marker = this.findNestedMarker(data, width, height, quad);
      if (marker) markers.push(marker);
    }

    // Fallback: Only use global scan if we found at least 3 markers in quadrants.
    // This prevents false positives when there's no paper at all.
    // We need strong evidence of a real sheet before inferring missing corners.
    if (markers.length === 3) {
      const pts = this.findAllMarkersGlobal(data, width, height);
      // Include the markers we already found
      pts.push(...markers.map(m => m.center));
      const best = this.findBestSheetRectangle(pts, width, height);
      if (best && best.length === 4) {
        return best.map((p) => ({
          center: p,
          rect: { x: p.x, y: p.y, w: 1, h: 1 }
        }));
      }
    }

    return markers;
  }

  /**
   * Specifically looks for the nested square pattern (Black-White-Black)
   * Relaxed thresholds for better detection on mobile cameras with varying lighting.
   */
  public findNestedMarker(data: Uint8ClampedArray, width: number, height: number, quad: any): Marker | null {
    const x1 = Math.max(0, Math.floor(Number(quad?.x1 ?? 0)));
    const y1 = Math.max(0, Math.floor(Number(quad?.y1 ?? 0)));
    const x2 = Math.min(width, Math.ceil(Number(quad?.x2 ?? width)));
    const y2 = Math.min(height, Math.ceil(Number(quad?.y2 ?? height)));

    // Adaptive thresholds based on local brightness (handles glare / dim cameras).
    // We sample sparsely to keep this cheap enough for real-time tracking.
    let quadTotal = 0;
    let quadCount = 0;
    const sampleStride = 10;
    for (let y = y1; y < y2; y += sampleStride) {
      for (let x = x1; x < x2; x += sampleStride) {
        const idx = (Math.round(y) * width + Math.round(x)) * 4;
        quadTotal += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        quadCount++;
      }
    }
    const quadMean = quadCount > 0 ? quadTotal / quadCount : 160;
    const darkThresh = Math.max(60, Math.min(150, quadMean * 0.68));
    const lightThresh = Math.max(90, Math.min(220, quadMean * 0.88));

    const getBrightness = (x: number, y: number) => {
      const idx = (y * width + x) * 4;
      return (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    };

    const checkCandidate = (cx: number, cy: number): { marker: Marker; score: number } | null => {
      if (cx < 2 || cy < 2 || cx >= width - 2 || cy >= height - 2) return null;

      const c = getBrightness(cx, cy);
      if (c > darkThresh + 10) return null;

      const maxStep = 40;
      const dirs: Array<{ dx: number; dy: number }> = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];

      const d1s: number[] = [];
      const d2s: number[] = [];
      const d3s: number[] = [];

      for (const d of dirs) {
        let d1 = -1;
        let d2 = -1;
        let d3 = -1;

        for (let s = 1; s <= maxStep; s++) {
          const x = cx + d.dx * s;
          const y = cy + d.dy * s;
          if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) break;
          const b = getBrightness(x, y);
          if (d1 < 0) {
            if (b > lightThresh) d1 = s;
          } else if (d2 < 0) {
            if (b < darkThresh) d2 = s;
          } else {
            if (b > lightThresh) {
              d3 = s;
              break;
            }
          }
        }

        if (d1 < 2 || d2 < 0 || d3 < 0) return null;
        if (d2 - d1 < 1 || d3 - d2 < 1) return null;

        d1s.push(d1);
        d2s.push(d2);
        d3s.push(d3);
      }

      const outerR = Math.round((d3s[0] + d3s[1] + d3s[2] + d3s[3]) / 4);
      if (outerR < 6) return null;

      const minX = Math.max(x1, cx - outerR);
      const maxX = Math.min(x2 - 1, cx + outerR);
      const minY = Math.max(y1, cy - outerR);
      const maxY = Math.min(y2 - 1, cy + outerR);
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);

      const aspect = h > 0 ? (w / h) : 0;
      if (aspect < 0.6 || aspect > 1.5) return null;
      const size = Math.min(w, h);
      if (size < 8) return null;

      const spread = Math.max(...d3s) - Math.min(...d3s);
      const score = size - spread * 2;

      return {
        marker: {
          center: { x: cx, y: cy },
          rect: { x: minX, y: minY, w, h }
        },
        score
      };
    };

    let best: { marker: Marker; score: number } | null = null;

    const stride = 6;
    for (let y = y1 + 2; y < y2 - 2; y += stride) {
      for (let x = x1 + 2; x < x2 - 2; x += stride) {
        const b = getBrightness(x, y);
        if (b > darkThresh) continue;

        const cand = checkCandidate(x, y);
        if (!cand) continue;
        if (!best || cand.score > best.score) best = cand;
      }
    }

    return best ? best.marker : null;
  }

  /**
   * Helper to get standard quadrants for detection
   * Uses 45% coverage to match detectMarkers() for consistent live/capture behavior
   */
  public getQuadrants(width: number, height: number) {
    const qW = Math.round(width * 0.45);
    const qH = Math.round(height * 0.45);

    return [
      { id: 'tl', x1: 0, y1: 0, x2: qW, y2: qH },                       // TL
      { id: 'tr', x1: width - qW, y1: 0, x2: width, y2: qH },           // TR
      { id: 'br', x1: width - qW, y1: height - qH, x2: width, y2: height }, // BR
      { id: 'bl', x1: 0, y1: height - qH, x2: qW, y2: height }          // BL
    ];
  }

  private sortCorners(pts: Point[]): Point[] {
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sorted.slice(2, 4).sort((a, b) => b.x - a.x);
    return [top[0], top[1], bottom[0], bottom[1]]; 
  }

  /**
   * Perspective transform math (Homography).
   */
  private getPerspectiveTransform(src: Point[], dst: Point[]): number[] {
    const x0 = src[0].x, y0 = src[0].y;
    const x1 = src[1].x, y1 = src[1].y;
    const x2 = src[2].x, y2 = src[2].y;
    const x3 = src[3].x, y3 = src[3].y;

    const u0 = dst[0].x, v0 = dst[0].y;
    const u1 = dst[1].x, v1 = dst[1].y;
    const u2 = dst[2].x, v2 = dst[2].y;
    const u3 = dst[3].x, v3 = dst[3].y;

    const a = [
      [x0, y0, 1, 0, 0, 0, -u0 * x0, -u0 * y0],
      [0, 0, 0, x0, y0, 1, -v0 * x0, -v0 * y0],
      [x1, y1, 1, 0, 0, 0, -u1 * x1, -u1 * y1],
      [0, 0, 0, x1, y1, 1, -v1 * x1, -v1 * y1],
      [x2, y2, 1, 0, 0, 0, -u2 * x2, -u2 * y2],
      [0, 0, 0, x2, y2, 1, -v2 * x2, -v2 * y2],
      [x3, y3, 1, 0, 0, 0, -u3 * x3, -u3 * y3],
      [0, 0, 0, x3, y3, 1, -v3 * x3, -v3 * y3]
    ];

    const b = [u0, v0, u1, v1, u2, v2, u3, v3];
    return this.solveLinear(a, b);
  }

  private solveLinear(a: number[][], b: number[]): number[] {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let max = i;
      for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[max][i])) max = j;
      [a[i], a[max]] = [a[max], a[i]];
      [b[i], b[max]] = [b[max], b[i]];

      for (let j = i + 1; j < n; j++) {
        const factor = a[j][i] / a[i][i];
        b[j] -= factor * b[i];
        for (let k = i; k < n; k++) a[j][k] -= factor * a[i][k];
      }
    }

    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) sum += a[i][j] * x[j];
      x[i] = (b[i] - sum) / a[i][i];
    }
    return x;
  }

  private applyTransform(h: number[], u: number, v: number): Point {
    const w = h[6] * u + h[7] * v + 1;
    return {
      x: (h[0] * u + h[1] * v + h[2]) / w,
      y: (h[3] * u + h[4] * v + h[5]) / w
    };
  }

  /**
   * Calculate mean brightness (0..255) inside a disk.
   */
  private getMeanBrightnessInDisk(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    pt: Point,
    radius: number
  ): number {
    let total = 0;
    let count = 0;
    const rSq = radius * radius;
    const rInt = Math.ceil(radius);

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        if (dx * dx + dy * dy > rSq) continue;

        const x = Math.round(pt.x + dx);
        const y = Math.round(pt.y + dy);
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = (y * width + x) * 4;
        total += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
    }

    return count > 0 ? total / count : 255;
  }

  /**
   * Calculate mean brightness (0..255) in an annulus (ring) around the bubble.
   * This is used as the local background reference, robust against shadows.
   */
  private getMeanBrightnessInRing(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    pt: Point,
    innerRadius: number,
    outerRadius: number
  ): number {
    let total = 0;
    let count = 0;
    const rInSq = innerRadius * innerRadius;
    const rOutSq = outerRadius * outerRadius;
    const rInt = Math.ceil(outerRadius);

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        const dSq = dx * dx + dy * dy;
        if (dSq < rInSq || dSq > rOutSq) continue;

        const x = Math.round(pt.x + dx);
        const y = Math.round(pt.y + dy);
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = (y * width + x) * 4;
        total += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
    }

    return count > 0 ? total / count : NaN;
  }

  private normalizeAnswerLetter(v: any): string {
    const s = String(v || '').trim().toUpperCase();
    return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? s : '';
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }
}
