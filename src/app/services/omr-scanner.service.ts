/**
 * ZipGrade-style OMR Scanner Service
 *
 * Uses OpenCV for accurate scanning:
 * - On Android: NativeScan plugin (native OpenCV)
 * - On Web/iOS: OpenCvScannerService (OpenCV.js)
 * - Fallback: OmrLiteService if OpenCV unavailable
 */

import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { NativeScan } from '../plugins/native-scan';
import { OmrLiteService } from './omr-lite.service';
import { OpenCvScannerService } from './opencv-scanner.service';
import { bubbles } from '../data/bubble-template';

export interface GradingResult {
  questionNumber: number;
  detectedAnswer: string | null;
  correctAnswer: string;
  status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid';
  confidence?: number;
  rawScores?: { [key: string]: number };
}

export interface ScanProcessResult {
  gradingResults: GradingResult[];
  studentHash?: number | null;
  usedNative?: boolean;
  warpedImageBase64?: string | null;
}

export type CornerHints = import('./opencv-scanner.service').CornerHints;

@Injectable({ providedIn: 'root' })
export class OmrScannerService {
  private nativeAvailable: boolean | null = null;

  constructor(
    private omrLite: OmrLiteService,
    private openCvScanner: OpenCvScannerService
  ) {}

  /**
   * Check if NativeScan (OpenCV) is available (Android only)
   * DISABLED: OpenCV native library has loading issues, using web-based processing instead
   */
  async isNativeScanAvailable(): Promise<boolean> {
    // Force disabled - use web-based processing only
    console.log('[OMR] NativeScan disabled, using web-based processing');
    return false;
  }

  private readonly MAX_DIM = 1400;

  private maybeDownscale(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const w = canvas.width;
    const h = canvas.height;
    const maxDim = Math.max(w, h);
    if (maxDim <= this.MAX_DIM) return canvas;
    const scale = this.MAX_DIM / maxDim;
    const nw = Math.round(w * scale);
    const nh = Math.round(h * scale);
    const resized = document.createElement('canvas');
    resized.width = nw;
    resized.height = nh;
    const ctx = resized.getContext('2d');
    if (ctx) ctx.drawImage(canvas, 0, 0, w, h, 0, 0, nw, nh);
    return resized;
  }

  /**
   * Process a canvas frame - uses web-based processing (OpenCV.js or OmrLite fallback)
   * NativeScan (native OpenCV) is disabled due to library loading issues
   */
  async processFrame(
    canvas: HTMLCanvasElement,
    answerKey: string[],
    cornerHints?: CornerHints | null
  ): Promise<ScanProcessResult> {
    const workCanvas = this.maybeDownscale(canvas);

    const scaledHints: CornerHints | null = (() => {
      if (!cornerHints) return null;
      if (workCanvas === canvas) return cornerHints;

      const sx = workCanvas.width / Math.max(1, canvas.width);
      const sy = workCanvas.height / Math.max(1, canvas.height);
      return {
        tl: { x: cornerHints.tl.x * sx, y: cornerHints.tl.y * sy },
        tr: { x: cornerHints.tr.x * sx, y: cornerHints.tr.y * sy },
        br: { x: cornerHints.br.x * sx, y: cornerHints.br.y * sy },
        bl: { x: cornerHints.bl.x * sx, y: cornerHints.bl.y * sy }
      };
    })();

    try {
      console.log('[OMR] Checking OpenCV availability...');
      const cv = (window as any).cv;
      if (cv?.Mat) {
        console.log('[OMR] ✅ OpenCV.js ready, running scan...');
        const result = await this.openCvScanner.processFrame(workCanvas, answerKey, scaledHints);
        console.log('[OMR] ✅ OpenCV scan completed successfully');
        return {
          gradingResults: result.gradingResults,
          studentHash: result.studentHash,
          usedNative: false,
          warpedImageBase64: result.warpedImageBase64 ?? null
        };
      }
      
      console.log('[OMR] OpenCV.js not ready, using OmrLite fallback...');
      return this.processWithOmrLite(workCanvas, answerKey);
    } catch (e: any) {
      console.error('[OMR] ❌ Scan error:', e?.message || e);
      return this.processWithOmrLite(workCanvas, answerKey);
    }
  }

  /**
   * NativeScan path - full OpenCV pipeline (ZipGrade-style)
   */
  private async processWithNativeScan(
    canvas: HTMLCanvasElement,
    answerKey: string[]
  ): Promise<ScanProcessResult> {
    const base64 = canvas.toDataURL('image/jpeg', 0.92);
    const maxItems = Math.min(50, Math.max(1, answerKey.length || 50));

    const answerKeyObj: Record<string, 'A' | 'B' | 'C' | 'D'> = {};
    answerKey.forEach((v, i) => {
      const s = String(v || '').trim().toUpperCase();
      if (s === 'A' || s === 'B' || s === 'C' || s === 'D') {
        answerKeyObj[String(i + 1)] = s as 'A' | 'B' | 'C' | 'D';
      }
    });

    const template = bubbles.slice(0, maxItems).map((b) => ({
      question: b.question,
      options: b.options as Record<'A' | 'B' | 'C' | 'D', { cx: number; cy: number; radius: number }>
    }));

    const result = await NativeScan.scanSheet({
      imageBase64: base64,
      maxItems,
      answerKey: answerKeyObj,
      template
    });

    if (!result.ok) {
      throw new Error(result.error ?? 'Native scan failed');
    }

    const gradingResults: GradingResult[] = [];
    const answers = result.answers ?? {};

    for (let q = 1; q <= maxItems; q++) {
      const detected = answers[String(q)] ?? null;
      const correct = answerKey[q - 1]?.trim().toUpperCase() || '';
      const validCorrect = ['A', 'B', 'C', 'D'].includes(correct);

      let status: GradingResult['status'] = 'Blank';
      if (!detected) {
        status = validCorrect ? 'Blank' : 'Invalid';
      } else if (!validCorrect) {
        status = 'Invalid';
      } else {
        status = detected === correct ? 'Correct' : 'Incorrect';
      }

      gradingResults.push({
        questionNumber: q,
        detectedAnswer: detected,
        correctAnswer: validCorrect ? correct : '',
        status,
        confidence: detected ? 1 : 0
      });
    }

    return {
      gradingResults,
      studentHash: null,
      usedNative: true
    };
  }

  /**
   * OmrLite path - enhanced JS pipeline with ZipGrade-style adaptive thresholds
   */
  private processWithOmrLite(
    canvas: HTMLCanvasElement,
    answerKey: string[]
  ): ScanProcessResult {
    const { gradingResults, studentHash } = this.omrLite.processFrame(canvas, answerKey);
    return {
      gradingResults,
      studentHash,
      usedNative: false
    };
  }
}
