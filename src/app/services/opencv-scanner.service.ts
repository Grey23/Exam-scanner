/**
 * Full OpenCV-based OMR Scanner (ZipGrade-style)
 *
 * Pipeline:
 * 1. Load OpenCV.js (from CDN script in index.html)
 * 2. Corner detection via contours (adaptive threshold, findContours)
 * 3. Perspective warp to fixed sheet size
 * 4. Template-based bubble sampling with annulus fill scoring
 * 5. Adaptive threshold (sheet-wide statistics)
 */

import { Injectable } from '@angular/core';
import { bubbles, Option } from '../data/bubble-template';
import { OmrLiteService } from './omr-lite.service';

export interface GradingResult {
  questionNumber: number;
  detectedAnswer: string | null;
  correctAnswer: string;
  status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid';
  confidence?: number;
  rawScores?: { [key: string]: number };
}

export interface OpenCvScanResult {
  gradingResults: GradingResult[];
  studentHash: number | null;
  warpedImageBase64?: string | null;
}

export interface CornerHints {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}

@Injectable({ providedIn: 'root' })
export class OpenCvScannerService {
  private cvInstance: any = null;
  private initPromise: Promise<any> | null = null;
  private runtimeReadyPromise: Promise<any> | null = null;

  constructor(private omrLite: OmrLiteService) {}

  readonly SHEET_WIDTH = 800;
  readonly SHEET_HEIGHT = 1131;

  // Corner markers in template coordinates (centers of the 55x55 nested squares)
  // Matches answer-sheet-generator.page.html marker positions.
  readonly TEMPLATE_MARKERS = {
    tl: { x: 42.5, y: 42.5 },
    tr: { x: 757.5, y: 42.5 },
    br: { x: 757.5, y: 1088.5 },
    bl: { x: 42.5, y: 1088.5 }
  };

  /** Call early (e.g. on scan page init) to preload OpenCV from CDN */
  preload(): void {
    void this.ensureOpenCv().catch(() => {});
  }

  async ensureOpenCv(): Promise<any> {
    // Check cached instance first
    if (this.cvInstance) return this.cvInstance;

    // Check if OpenCV is already ready right now (synchronous check)
    const cvNow = (window as any).cv;
    if (cvNow?.Mat) {
      this.cvInstance = cvNow;
      console.log('[OpenCV] ✅ Already initialized (cv.Mat exists)');
      return cvNow;
    }

    // Check if we're already initializing
    if (this.initPromise) return this.initPromise;

    console.log('[OpenCV] Starting initialization wait...');
    this.initPromise = (async () => {
      // Double-check after async start
      const cvCheck = (window as any).cv;
      if (cvCheck?.Mat) {
        this.cvInstance = cvCheck;
        console.log('[OpenCV] ✅ Initialized during async check');
        return cvCheck;
      }

      // Wait for script tag to populate window.cv
      for (let i = 0; i < 400; i++) { // 400 * 50ms = 20s max wait
        const cv = (window as any).cv;
        if (cv?.Mat) {
          this.cvInstance = cv;
          console.log('[OpenCV] ✅ Initialized after', i * 50, 'ms');
          return cv;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      this.initPromise = null;
      throw new Error('OpenCV did not load. Ensure opencv.js script is loaded (index.html).');
    })();

    return this.initPromise;
  }

  async processFrame(
    canvas: HTMLCanvasElement,
    answerKey: string[],
    cornerHints?: CornerHints | null
  ): Promise<OpenCvScanResult> {
    console.log('[OpenCV] processFrame started. Canvas:', canvas?.width, 'x', canvas?.height);
    
    // Check canvas validity
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      console.error('[OpenCV] Invalid canvas dimensions');
      throw new Error('Invalid canvas dimensions for processing');
    }

    console.log('[OpenCV] Getting direct reference to window.cv');
    const cv = (window as any).cv;
    if (!cv || !cv.Mat) {
      console.error('[OpenCV] OpenCV global not ready in processFrame');
      throw new Error('OpenCV instance not available');
    }

    console.log('[OpenCV] Attempting to get 2D context...');
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: false // Faster readback if we don't need transparency
    });
    
    if (!ctx) {
      console.error('[OpenCV] Could not get 2D context from canvas');
      throw new Error('Could not get canvas context');
    }

    console.log('[OpenCV] Context obtained. Calling getImageData...');
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      console.log('[OpenCV] getImageData successful. Size:', imageData.data.length);
    } catch (e: any) {
      console.error('[OpenCV] getImageData failed:', e);
      throw new Error('Failed to extract image data: ' + (e.message || 'Unknown error'));
    }

    console.log('[OpenCV] Calling imageDataToMat...');
    const src = this.imageDataToMat(cv, imageData);
    console.log('[OpenCV] Mat created successfully');

    try {
      let corners: Array<{ x: number; y: number }> | null = null;

      // Precompute a binary image for marker refinement (fast ROI contour search)
      const markerBin = this.buildMarkerBinary(cv, src);

      if (cornerHints) {
        const hinted = [cornerHints.tl, cornerHints.tr, cornerHints.br, cornerHints.bl];
        const orderedHinted = this.orderCorners(hinted);
        const refinedHinted = this.refineCornersWithLocalContours(cv, markerBin, orderedHinted);
        const useHinted = refinedHinted && refinedHinted.length === 4 ? refinedHinted : orderedHinted;

        if (this.isValidCornerQuad(useHinted, canvas.width, canvas.height)) {
          corners = useHinted;
          console.log('[OpenCV] Using corner hints from preview tracking');
        } else {
          console.warn('[OpenCV] Provided corner hints are invalid; falling back to detection');
        }
      }

      if (!corners) {
        // Use OmrLite's proven marker detection (same as preview) for consistent corners
        console.log('[OpenCV] Using OmrLite marker detection for consistent corners...');
        const imageDataForLite = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const liteCorners = this.omrLite.detectMarkersForPreview(imageDataForLite.data, canvas.width, canvas.height);

        if (liteCorners && liteCorners.length === 4) {
          const orderedLite = this.orderCorners(liteCorners);
          const refinedLite = this.refineCornersWithLocalContours(cv, markerBin, orderedLite);
          const useLite = refinedLite && refinedLite.length === 4 ? refinedLite : orderedLite;

          if (this.isValidCornerQuad(useLite, canvas.width, canvas.height)) {
            corners = useLite;
            console.log('[OpenCV] OmrLite corners accepted:', corners.map((c: any) => `(${Math.round(c.x)},${Math.round(c.y)})`).join(' '));
          } else {
            console.warn('[OpenCV] OmrLite produced an invalid quad; falling back to OpenCV corner detection');
          }
        } else {
          console.warn('[OpenCV] OmrLite found only', liteCorners?.length || 0, 'corners; falling back to OpenCV corner detection');
        }
      }

      if (!corners) {
        const cvCorners = this.detectCorners(cv, src);
        if (!cvCorners || cvCorners.length !== 4) {
          throw new Error('Could not detect all 4 corner markers. Align the sheet within the frame.');
        }
        corners = this.orderCorners(cvCorners);
        console.log('[OpenCV] OpenCV corners used:', corners.map((c: any) => `(${Math.round(c.x)},${Math.round(c.y)})`).join(' '));
      }

      try { markerBin.delete(); } catch {}

      console.log('[OpenCV] Corners found. Warping...');
      const warped = this.warpPerspective(cv, src, corners);
      const warpedImageBase64 = this.matToJpegDataUrl(cv, warped, 0.9);
      
      console.log('[OpenCV] Decoding student code...');
      const studentHash = this.decodeStudentCode(cv, warped);
      
      console.log('[OpenCV] Grading bubbles...');
      const gradingResults = this.gradeBubbles(cv, warped, answerKey);

      console.log('[OpenCV] All processing steps finished');
      try { warped.delete(); } catch {}
      return { gradingResults, studentHash, warpedImageBase64 };
    } catch (e: any) {
      console.error('[OpenCV] Processing pipeline error:', e);
      throw e;
    } finally {
      if (src && !src.isDeleted()) {
        src.delete();
        console.log('[OpenCV] Cleanup: src Mat deleted');
      }
    }
  }

  private matToJpegDataUrl(cv: any, mat: any, quality: number): string | null {
    try {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = mat.cols;
      outCanvas.height = mat.rows;
      try {
        cv.imshow(outCanvas, mat);
      } catch (e) {
        const ctx = outCanvas.getContext('2d');
        if (!ctx) throw e;

        let rgba: any = mat;
        let tmp: any = null;
        try {
          if (mat.channels && mat.channels() === 1) {
            tmp = new cv.Mat();
            cv.cvtColor(mat, tmp, cv.COLOR_GRAY2RGBA);
            rgba = tmp;
          } else if (mat.channels && mat.channels() === 3) {
            tmp = new cv.Mat();
            cv.cvtColor(mat, tmp, cv.COLOR_RGB2RGBA);
            rgba = tmp;
          }

          const bytes = new Uint8ClampedArray(rgba.data);
          const imgData = new ImageData(bytes, rgba.cols, rgba.rows);
          ctx.putImageData(imgData, 0, 0);
        } finally {
          try { tmp?.delete?.(); } catch {}
        }
      }

      return outCanvas.toDataURL('image/jpeg', quality);
    } catch (e) {
      console.warn('[OpenCV] matToJpegDataUrl failed:', e);
      return null;
    }
  }

  private buildMarkerBinary(cv: any, src: any): any {
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const bin = new cv.Mat();
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1);
      cv.threshold(blurred, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

      const closeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, closeKernel);
      closeKernel.delete();

      const dilateKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.dilate(bin, bin, dilateKernel, new cv.Point(-1, -1), 1);
      dilateKernel.delete();

      return bin;
    } finally {
      try { gray.delete(); } catch {}
      try { blurred.delete(); } catch {}
    }
  }

  private refineCornersWithLocalContours(
    cv: any,
    markerBin: any,
    orderedCorners: Array<{ x: number; y: number }>
  ): Array<{ x: number; y: number }> | null {
    if (!Array.isArray(orderedCorners) || orderedCorners.length !== 4) return null;

    const patch = Math.round(Math.min(markerBin.cols, markerBin.rows) * 0.18);
    const results: Array<{ x: number; y: number }> = [];

    for (const c of orderedCorners) {
      const refined = this.refineCornerFromBinaryROI(cv, markerBin, c, patch);
      if (!refined) return null;
      results.push(refined);
    }

    return results;
  }

  private refineCornerFromBinaryROI(
    cv: any,
    markerBin: any,
    approx: { x: number; y: number },
    patchSize: number
  ): { x: number; y: number } | null {
    const w = markerBin.cols;
    const h = markerBin.rows;

    const half = Math.max(50, Math.floor(patchSize / 2));
    const x0 = Math.max(0, Math.round(approx.x - half));
    const y0 = Math.max(0, Math.round(approx.y - half));
    const x1 = Math.min(w, Math.round(approx.x + half));
    const y1 = Math.min(h, Math.round(approx.y + half));

    const rw = Math.max(1, x1 - x0);
    const rh = Math.max(1, y1 - y0);
    const roiRect = new cv.Rect(x0, y0, rw, rh);
    const roi = markerBin.roi(roiRect);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();

    try {
      cv.findContours(roi, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const n = contours.size();
      if (n <= 0) return null;

      let best: { x: number; y: number; score: number } | null = null;

      for (let i = 0; i < Math.min(n, 400); i++) {
        const cnt = contours.get(i);
        if (!cnt) continue;

        const area = cv.contourArea(cnt);
        if (!Number.isFinite(area) || area < 60) {
          cnt.delete();
          continue;
        }

        const rect = cv.boundingRect(cnt);
        const ar = Math.min(rect.width, rect.height) / Math.max(1, Math.max(rect.width, rect.height));
        if (ar < 0.55) {
          cnt.delete();
          continue;
        }

        // For nested-square markers, the contour centroid can drift.
        // Bounding-rect center is typically more stable.
        const cx = x0 + rect.x + rect.width / 2;
        const cy = y0 + rect.y + rect.height / 2;

        const dx = cx - approx.x;
        const dy = cy - approx.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const rectArea = rect.width * rect.height;
        const size = Math.min(rect.width, rect.height);

        // Prefer close-to-approx, square-ish, and sufficiently large blobs.
        // Penalize distance more strongly than raw contour area.
        const score = rectArea + area - dist * dist * 0.35 + size * 20;

        if (!best || score > best.score) best = { x: cx, y: cy, score };

        cnt.delete();
      }

      if (!best) return null;
      return { x: best.x, y: best.y };
    } catch {
      return null;
    } finally {
      try { roi.delete(); } catch {}
      try { contours.delete(); } catch {}
      try { hierarchy.delete(); } catch {}
    }
  }

  private imageDataToMat(cv: any, imageData: ImageData): any {
    console.log('[OpenCV] imageDataToMat dimensions:', imageData.width, 'x', imageData.height);
    
    // Fallback: manual copy to avoid any potential cv.matFromImageData issues
    const mat = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
    mat.data.set(imageData.data);
    console.log('[OpenCV] imageDataToMat: manual copy successful');
    return mat;
  }

  // Detect the 4 corner nested-square markers (TL/TR/BR/BL)
  private detectCorners(cv: any, src: any): Array<{ x: number; y: number }> | null {
    console.log('[OpenCV] detectCorners: Creating Mats');
    const gray = new cv.Mat();
    const bin = new cv.Mat();
    const hierarchy = new cv.Mat();
    const contours = new cv.MatVector();
    
    try {
      console.log('[OpenCV] detectCorners: cvtColor');
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      
      console.log('[OpenCV] detectCorners: GaussianBlur');
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

      console.log('[OpenCV] detectCorners: adaptiveThreshold');
      cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 10);

      console.log('[OpenCV] detectCorners: findContours');
      cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const contoursSize = contours.size();
      console.log('[OpenCV] detectCorners: found', contoursSize, 'contours');

      const w = src.cols;
      const h = src.rows;
      const imgArea = w * h;

      const minArea = imgArea * 0.0005;
      const maxArea = imgArea * 0.05;

      const detected: { [k: string]: { x: number; y: number; score: number } | null } = {
        tl: null, tr: null, br: null, bl: null
      };

      const regionFrac = 0.4;
      const regions = {
        tl: { x0: 0, y0: 0, x1: Math.floor(w * regionFrac), y1: Math.floor(h * regionFrac) },
        tr: { x0: w - Math.floor(w * regionFrac), y0: 0, x1: w, y1: Math.floor(h * regionFrac) },
        bl: { x0: 0, y0: h - Math.floor(h * regionFrac), x1: Math.floor(w * regionFrac), y1: h },
        br: { x0: w - Math.floor(w * regionFrac), y0: h - Math.floor(h * regionFrac), x1: w, y1: h }
      };

      console.log('[OpenCV] detectCorners: looping through contours');
      const maxToProcess = Math.min(contoursSize, 1000);
      for (let i = 0; i < maxToProcess; i++) {
        let cnt: any;
        try {
          cnt = contours.get(i);
          if (!cnt) continue;
          
          const area = cv.contourArea(cnt);
          if (area < minArea || area > maxArea) {
            cnt.delete();
            continue;
          }

          const rect = cv.boundingRect(cnt);
          const ar = rect.width / Math.max(1, rect.height);
          if (ar < 0.7 || ar > 1.35) {
            cnt.delete();
            continue;
          }

          const m = cv.moments(cnt);
          if (!m.m00) {
            cnt.delete();
            continue;
          }
          const cx = m.m10 / m.m00;
          const cy = m.m01 / m.m00;

          const score = 1 - Math.abs(1 - ar);

          const inRegion = (r: any) => cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1;
          (['tl', 'tr', 'br', 'bl'] as const).forEach((k) => {
            if (!inRegion((regions as any)[k])) return;
            const cur = detected[k];
            if (!cur || score > cur.score) detected[k] = { x: cx, y: cy, score };
          });

          cnt.delete();
        } catch (innerE) {
          console.error('[OpenCV] Contour processing error at index', i, innerE);
          if (cnt) try { cnt.delete(); } catch {}
        }
      }
      console.log('[OpenCV] detectCorners: loop finished');

      const results = ['tl', 'tr', 'br', 'bl'].map(k => detected[k]);
      if (results.every(r => r !== null)) {
        console.log('[OpenCV] detectCorners: ✅ Found all corners');
        return results as Array<{ x: number; y: number }>;
      }
      console.warn('[OpenCV] detectCorners: ❌ Missing corners:', results.map((r, i) => r ? 'OK' : ['TL','TR','BR','BL'][i]));
      return null;
    } catch (e) {
      console.error('[OpenCV] detectCorners error:', e);
      return null;
    } finally {
      try { gray.delete(); } catch {}
      try { bin.delete(); } catch {}
      try { hierarchy.delete(); } catch {}
      try { contours.delete(); } catch {}
    }
  }

  private warpPerspective(cv: any, src: any, corners: Array<{ x: number; y: number }>): any {
    // corners are already ordered tl,tr,br,bl from detectCorners
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ]);

    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      this.TEMPLATE_MARKERS.tl.x, this.TEMPLATE_MARKERS.tl.y,
      this.TEMPLATE_MARKERS.tr.x, this.TEMPLATE_MARKERS.tr.y,
      this.TEMPLATE_MARKERS.br.x, this.TEMPLATE_MARKERS.br.y,
      this.TEMPLATE_MARKERS.bl.x, this.TEMPLATE_MARKERS.bl.y
    ]);

    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const dst = new cv.Mat();
    const dsize = new cv.Size(this.SHEET_WIDTH, this.SHEET_HEIGHT);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    srcPts.delete();
    dstPts.delete();
    M.delete();

    return dst;
  }

  private orderCorners(corners: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (!Array.isArray(corners) || corners.length !== 4) return corners;

    const sum = corners.map((p) => ({ p, v: p.x + p.y }));
    const diff = corners.map((p) => ({ p, v: p.x - p.y }));

    const tl = sum.reduce((a, b) => (a.v < b.v ? a : b)).p;
    const br = sum.reduce((a, b) => (a.v > b.v ? a : b)).p;
    const tr = diff.reduce((a, b) => (a.v > b.v ? a : b)).p;
    const bl = diff.reduce((a, b) => (a.v < b.v ? a : b)).p;

    // Ensure unique points; if detection produced duplicates, fall back to original
    const key = (p: { x: number; y: number }) => `${Math.round(p.x)}:${Math.round(p.y)}`;
    const uniq = new Set([key(tl), key(tr), key(br), key(bl)]);
    if (uniq.size !== 4) return corners;

    return [tl, tr, br, bl];
  }

  private isValidCornerQuad(
    corners: Array<{ x: number; y: number }>,
    width: number,
    height: number
  ): boolean {
    if (!Array.isArray(corners) || corners.length !== 4) return false;

    const tl = corners[0];
    const tr = corners[1];
    const br = corners[2];
    const bl = corners[3];

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const top = dist(tl, tr);
    const right = dist(tr, br);
    const bottom = dist(br, bl);
    const left = dist(bl, tl);

    const minSide = Math.min(top, right, bottom, left);
    const maxSide = Math.max(top, right, bottom, left);

    // Reject tiny quads or extremely skewed shapes
    if (minSide < Math.min(width, height) * 0.12) return false;
    if (maxSide / Math.max(1, minSide) > 4.0) return false;

    // Shoelace area
    const area = Math.abs(
      (tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y) -
      (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x)
    ) / 2;

    const imgArea = width * height;
    if (!Number.isFinite(area) || area < imgArea * 0.08) return false;

    // Must be roughly convex (cross products same sign)
    const cross = (a: any, b: any, c: any) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const z1 = cross(tl, tr, br);
    const z2 = cross(tr, br, bl);
    const z3 = cross(br, bl, tl);
    const z4 = cross(bl, tl, tr);
    const allPos = z1 > 0 && z2 > 0 && z3 > 0 && z4 > 0;
    const allNeg = z1 < 0 && z2 < 0 && z3 < 0 && z4 < 0;
    if (!(allPos || allNeg)) return false;

    return true;
  }

  private decodeStudentCode(cv: any, warped: any): number | null {
    const gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

    const originX = 320;
    const originY = 150;
    const cell = 6;
    const size = 8;
    const bits: number[] = [];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (r === 0 || c === 0) continue;
        const px = Math.round(originX + c * cell + cell / 2);
        const py = Math.round(originY + r * cell + cell / 2);
        if (px >= 0 && px < gray.cols && py >= 0 && py < gray.rows) {
          const val = gray.ucharAt(py, px);
          bits.push(val < 150 ? 1 : 0);
        }
      }
    }

    gray.delete();

    if (bits.length < 48) return null;

    const read16 = (offset: number): number => {
      let val = 0;
      for (let i = 0; i < 16; i++) {
        val = (val << 1) | (bits[offset + i] ? 1 : 0);
      }
      return val & 0xffff;
    };

    return read16(32);
  }

  private gradeBubbles(cv: any, warped: any, answerKey: string[]): GradingResult[] {
    const gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

    const normalizedKey = Array.isArray(answerKey) ? answerKey : [];
    const keyLen = normalizedKey.length || 0;
    // Always process at least 50 questions so the UI + overlay don't collapse to Q1
    // when the answer key isn't loaded yet or only contains a single item.
    const n = Math.min(bubbles.length, Math.max(50, keyLen));
    console.log('[OpenCV] Grading questions 1 to', n);

    const perQuestion: Array<{ fills: { opt: Option; score: number }[]; top: { opt: Option; score: number }; second: { opt: Option; score: number } }> = [];

    for (let q = 0; q < n; q++) {
      const t = bubbles[q];
      const fills: { opt: Option; score: number }[] = [];

      for (const opt of ['A', 'B', 'C', 'D'] as Option[]) {
        const coord = t.options[opt];
        const score = this.bubbleFillScore(cv, gray, coord.cx, coord.cy, coord.radius);
        fills.push({ opt, score });
      }

      const sorted = [...fills].sort((a, b) => b.score - a.score);
      perQuestion.push({
        fills,
        top: sorted[0],
        second: sorted[1]
      });
    }

    // --- Adaptive thresholds (ZipGrade-style, aligned with OmrLiteService) ---
    const bestScores = perQuestion.map((d) => d.top.score).filter((s) => s > 0.005);
    const sorted = bestScores.length > 0 ? [...bestScores].sort((a, b) => a - b) : [];

    // Use ~85th percentile of best-per-question scores as "strong" mark level.
    const qStrong = 0.85;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(qStrong * (sorted.length - 1))));
    const strong = sorted.length > 0 ? sorted[idx] : 0.0;

    console.log('[OpenCV] strong score:', strong.toFixed(3));

    // More forgiving thresholds (aligned with OmrLiteService) so lightly-filled
    // pencil marks in imported photos still register.
    const baseFill = strong > 0 ? strong * 0.6 : 0.16;
    const minFill = Math.max(0.10, Math.min(0.28, baseFill));
    const minGap = Math.max(0.05, Math.min(0.16, minFill * 0.55));

    console.log(
      '[OpenCV] Final thresholds - minFill:',
      minFill.toFixed(3),
      'minGap:',
      minGap.toFixed(3)
    );

    const results: GradingResult[] = [];
    for (let q = 0; q < n; q++) {
      const { fills, top, second } = perQuestion[q];
      const correctAns = q < keyLen ? this.normalizeKey(normalizedKey[q]) : '';

      let status: GradingResult['status'] = 'Blank';
      let detectedAnswer: string | null = null;

      if (top.score < minFill) {
        status = 'Blank';
      } else if (top.score - second.score < minGap) {
        status = 'Invalid';
      } else {
        detectedAnswer = top.opt;
        status = !correctAns ? 'Invalid' : (detectedAnswer === correctAns ? 'Correct' : 'Incorrect');
      }

      results.push({
        questionNumber: q + 1,
        detectedAnswer,
        correctAnswer: correctAns,
        status,
        confidence: top.score,
        rawScores: this.getRawScores(fills)
      });
    }

    gray.delete();
    return results;
  }

  private getRawScores(fills: { opt: Option; score: number }[]): { [key: string]: number } {
    const scores: { [key: string]: number } = {};
    fills.forEach(f => { scores[f.opt] = f.score; });
    return scores;
  }

  private bubbleFillScore(cv: any, gray: any, cx: number, cy: number, radius: number): number {
    const r = Math.max(8, radius);

    // Heavier focus on the very center of the bubble so filled circles
    // separate more clearly from unfilled ones, especially on printed sheets.
    const innerRadius = Math.round(r * 0.9);
    const innerMean = this.meanInCircle(cv, gray, cx, cy, innerRadius);

    // Local background: thin ring just outside the bubble outline.
    const bgInner = Math.round(r * 1.05);
    const bgOuter = Math.round(r * 1.35);
    const bgMean = this.meanInAnnulus(cv, gray, cx, cy, bgInner, bgOuter);

    const delta = bgMean - innerMean;
    // Normalize relative to local background so light pencil shading still registers.
    const denom = Math.max(60, bgMean);
    const score = denom > 0 ? (delta / denom) : 0;
    return Math.max(0, Math.min(1, score));
  }

  private meanInCircle(cv: any, gray: any, cx: number, cy: number, radius: number): number {
    const w = gray.cols;
    const h = gray.rows;
    const rInt = Math.ceil(radius);
    let total = 0;
    let count = 0;
    const rSq = radius * radius;

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        if (dx * dx + dy * dy > rSq) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && x < w && y >= 0 && y < h) {
          total += gray.ucharAt(y, x);
          count++;
        }
      }
    }
    return count > 0 ? total / count : 255;
  }

  private meanInAnnulus(cv: any, gray: any, cx: number, cy: number, rIn: number, rOut: number): number {
    const w = gray.cols;
    const h = gray.rows;
    const rInt = Math.ceil(rOut);
    let total = 0;
    let count = 0;
    const rInSq = rIn * rIn;
    const rOutSq = rOut * rOut;

    for (let dy = -rInt; dy <= rInt; dy++) {
      for (let dx = -rInt; dx <= rInt; dx++) {
        const dSq = dx * dx + dy * dy;
        if (dSq < rInSq || dSq > rOutSq) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && x < w && y >= 0 && y < h) {
          total += gray.ucharAt(y, x);
          count++;
        }
      }
    }
    return count > 0 ? total / count : 255;
  }

  private normalizeKey(v: any): string {
    const s = String(v || '').trim().toUpperCase();
    return ['A', 'B', 'C', 'D'].includes(s) ? s : '';
  }
}
