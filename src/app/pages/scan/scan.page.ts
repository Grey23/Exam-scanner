import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../../firebase';

import { CameraService } from '../../services/camera.service';
import { TeacherService } from '../../services/teacher.service';
import { LocalDataService, ScannedResult, AnswerEntry, TopicEntry } from '../../services/local-data.service';
import { bubbles } from '../../data/bubble-template';
import { OmrLiteService } from '../../services/omr-lite.service';
import { OmrScannerService } from '../../services/omr-scanner.service';
import { OpenCvScannerService } from '../../services/opencv-scanner.service';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import jsQR from 'jsqr';
import type { ClassStudent } from '../../services/teacher.service';
import type { CornerHints } from '../../services/omr-scanner.service';

interface GradingResult {
  questionNumber: number;
  detectedAnswer: string | null;
  correctAnswer: string;
  status: 'Correct' | 'Incorrect' | 'Blank' | 'Invalid';
  confidence?: number;
  rawScores?: { [key: string]: number };
}

@Component({
  selector: 'app-scan',
  templateUrl: './scan.page.html',
  styleUrls: ['./scan.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, HttpClientModule]
})
export class ScanPage implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('resultOverlay') resultOverlayRef!: ElementRef<HTMLCanvasElement>;

  // OMR Config
  readonly SHEET_WIDTH = 800;
  readonly SHEET_HEIGHT = 1131; // A4 aspect ratio
  readonly QUESTIONS_COUNT = 50;
  readonly OPTIONS_COUNT = 4; // A, B, C, D
  readonly FILL_THRESHOLD = 0.25; // 25% fill means marked

  // State
  isProcessing = false;
  showResults = false;
  statusMessage = 'Initializing...';
  lastError = '';
  debugMode = false;

  // Data
  classId = 0;
  subjectId = 0;
  examTitle = 'Exam Results';
  answerKey: string[] = [];
  gradingResults: GradingResult[] = [];
  lastCapturedImageData: string | null = null;

  // When OpenCV runs, it returns a warped (800x1131) sheet image.
  // If we render that as the preview, bubble-template coordinates align perfectly.
  lastPreviewWasWarped = false;

  // Template binding: used as the preview image src for manual review.
  get scannedPreviewImage(): string | null {
    return this.lastCapturedImageData;
  }

  // Save to profile
  students: ClassStudent[] = [];
  rollNumberInput = '';
  selectedStudentId: number | null = null;
  isSaving = false;
  saveSuccess = false;

  // Stats
  score = 0;
  total = 0;
  correctCount = 0;
  incorrectCount = 0;
  blankCount = 0;
  invalidCount = 0;

  // Real-time marker tracking for visual feedback (no auto-capture)
  detectedMarkers: { [key: string]: { x: number, y: number } | null } = {
    tl: null, tr: null, br: null, bl: null
  };
  markerMemory: { [key: string]: { pos: { x: number, y: number }, frames: number } } = {
    tl: { pos: { x: 0, y: 0 }, frames: 0 },
    tr: { pos: { x: 0, y: 0 }, frames: 0 },
    br: { pos: { x: 0, y: 0 }, frames: 0 },
    bl: { pos: { x: 0, y: 0 }, frames: 0 }
  };
  readonly MEMORY_LIFE = 10;

  private streamActive = false;
  private animationFrameId: number | null = null;

  /**
   * Called when the preview image loads (see template).
   * Renders a lightweight overlay (corner marker dots) for manual review only.
   */
  renderScanOverlay() {
    const overlay = this.resultOverlayRef?.nativeElement;
    if (!overlay) return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const imgEl = document.querySelector('img.scan-preview-image') as HTMLImageElement | null;
    const displayW = imgEl?.clientWidth || overlay.width || 0;
    const displayH = imgEl?.clientHeight || overlay.height || 0;
    if (displayW > 0) overlay.width = displayW;
    if (displayH > 0) overlay.height = displayH;

    if (!overlay.width || !overlay.height) return;

    // Determine the coordinate base size for bubble-template.
    // - Warped OpenCV preview is exactly 800x1131 -> perfect alignment.
    // - Otherwise, fall back to the image's natural dimensions (may be cropped/offset).
    const baseW = this.lastPreviewWasWarped ? this.SHEET_WIDTH : (imgEl?.naturalWidth || this.SHEET_WIDTH);
    const baseH = this.lastPreviewWasWarped ? this.SHEET_HEIGHT : (imgEl?.naturalHeight || this.SHEET_HEIGHT);

    const scaleX = overlay.width / Math.max(1, baseW);
    const scaleY = overlay.height / Math.max(1, baseH);
    const scaleR = Math.min(scaleX, scaleY);

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const byQuestion = new Map<number, GradingResult>();
    for (const r of this.gradingResults || []) byQuestion.set(r.questionNumber, r);

    const maxQuestionFromResults = (this.gradingResults || []).reduce((m, r) => Math.max(m, r.questionNumber), 0);
    const maxQuestion = Math.max(
      maxQuestionFromResults,
      Math.min(50, Array.isArray(this.answerKey) ? this.answerKey.length : 0),
      1
    );

    // Draw bubble template for each question (outline) and fill the detected/correct answers.
    for (let q = 1; q <= Math.min(50, maxQuestion); q++) {
      const tpl = bubbles[q - 1];
      if (!tpl) continue;

      const res = byQuestion.get(q);
      const detected = res?.detectedAnswer;
      const correct = res?.correctAnswer;

      // Outline bubble
      const drawBubble = (opt: 'A' | 'B' | 'C' | 'D', fill?: { color: string; alpha: number }) => {
        const coord = tpl.options[opt];
        const x = coord.cx * scaleX;
        const y = coord.cy * scaleY;
        const r = coord.radius * scaleR;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'transparent';
        ctx.strokeStyle = 'rgba(17,24,39,0.35)';
        ctx.lineWidth = 2;

        ctx.stroke();

        if (fill) {
          ctx.save();
          ctx.globalAlpha = fill.alpha;
          ctx.fillStyle = fill.color;
          ctx.fill();
          ctx.restore();
        }
      };

      // Always show outlines for all options
      drawBubble('A');
      drawBubble('B');
      drawBubble('C');
      drawBubble('D');

      if (!res) continue;

      if (detected && ['A', 'B', 'C', 'D'].includes(detected)) {
        const detectedColor =
          res.status === 'Correct'
            ? 'rgba(16,185,129,1)' // green
            : res.status === 'Incorrect'
              ? 'rgba(239,68,68,1)' // red
              : res.status === 'Blank'
                ? 'rgba(59,130,246,1)' // blue
                : 'rgba(245,158,11,1)'; // amber/orange

        drawBubble(detected as any, { color: detectedColor, alpha: 0.35 });
      }

      if (res.status === 'Incorrect' && correct && ['A', 'B', 'C', 'D'].includes(correct) && correct !== detected) {
        drawBubble(correct as any, { color: 'rgba(59,130,246,1)', alpha: 0.25 });
      }
    }
  }

  private getTrackedCornerHints(): CornerHints | null {
    const tl = this.detectedMarkers['tl'];
    const tr = this.detectedMarkers['tr'];
    const br = this.detectedMarkers['br'];
    const bl = this.detectedMarkers['bl'];
    if (!tl || !tr || !br || !bl) return null;
    return { tl, tr, br, bl };
  }

  private buildWorkCanvasWithHints(
    source: HTMLCanvasElement,
    hints: CornerHints | null
  ): { canvas: HTMLCanvasElement; hints: CornerHints | null } {
    if (!hints) return { canvas: source, hints: null };
    const xs = [hints.tl.x, hints.tr.x, hints.br.x, hints.bl.x];
    const ys = [hints.tl.y, hints.tr.y, hints.br.y, hints.bl.y];

    const pad = 80;
    let minX = Math.max(0, Math.min(...xs) - pad);
    let maxX = Math.min(source.width, Math.max(...xs) + pad);
    let minY = Math.max(0, Math.min(...ys) - pad);
    let maxY = Math.min(source.height, Math.max(...ys) + pad);

    const minSize = 420;
    if (maxX - minX < minSize) {
      const grow = (minSize - (maxX - minX)) / 2;
      minX = Math.max(0, minX - grow);
      maxX = Math.min(source.width, maxX + grow);
    }
    if (maxY - minY < minSize) {
      const grow = (minSize - (maxY - minY)) / 2;
      minY = Math.max(0, minY - grow);
      maxY = Math.min(source.height, maxY + grow);
    }

    const w = Math.max(1, Math.round(maxX - minX));
    const h = Math.max(1, Math.round(maxY - minY));
    if (w <= 1 || h <= 1) return { canvas: source, hints };

    const work = document.createElement('canvas');
    work.width = w;
    work.height = h;
    const wctx = work.getContext('2d');
    if (!wctx) return { canvas: source, hints };

    wctx.drawImage(source, minX, minY, w, h, 0, 0, w, h);

    const adjustedHints: CornerHints = {
      tl: { x: hints.tl.x - minX, y: hints.tl.y - minY },
      tr: { x: hints.tr.x - minX, y: hints.tr.y - minY },
      br: { x: hints.br.x - minX, y: hints.br.y - minY },
      bl: { x: hints.bl.x - minX, y: hints.bl.y - minY }
    };
    return { canvas: work, hints: adjustedHints };
  }

  // Optional AI backup (Gemini via Firebase Functions)
  // Keep OFF to preserve the original on-device scanning behavior.
  aiAssistEnabled = false;
  aiChecking = false;

  constructor(
    private cameraService: CameraService,
    private teacherService: TeacherService,
    private omrLite: OmrLiteService,
    private omrScanner: OmrScannerService,
    private openCvScanner: OpenCvScannerService,
    private route: ActivatedRoute,
    private ngZone: NgZone,
    private alertCtrl: AlertController
  ) {}

  async ngAfterViewInit() {
    this.route.queryParams.subscribe(params => {
      this.classId = Number(params['classId'] || 0);
      this.subjectId = Number(params['subjectId'] || 0);
      void this.initScanner();
    });
  }

  ngOnDestroy() {
    this.stopScanner();
  }

  async initScanner() {
    this.statusMessage = 'Initializing...';
    await LocalDataService.load();

    try {
      this.openCvScanner.preload();
      await Promise.all([this.startCamera(), this.loadAnswerKey()]);
      this.statusMessage = 'Ready to scan';
      this.isProcessing = false;
    } catch (e: any) {
      console.error('Camera failed', e);
      this.lastError = 'Camera access denied or failed.';
      return;
    }
  }

  async loadAnswerKey() {
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    const tos: any[] = Array.isArray(subject?.tos) ? subject!.tos : [];
    const questions: any[] = Array.isArray(subject?.questions) ? subject!.questions : [];
    const cachedKey: any[] = Array.isArray(subject?.answerKey) ? subject!.answerKey! : [];

    const res = await this.teacherService.loadSubjectAnswerKey(this.classId, this.subjectId);
    const remoteKey: any[] = (res.success && Array.isArray(res.answerKey)) ? res.answerKey : [];

    const normalize = (v: any): string => {
      const s = String(v || '').trim().toUpperCase();
      return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? s : '';
    };

    const keyBase = (remoteKey.length ? remoteKey : cachedKey).map(normalize);

    const computeTotalQuestionsFromTos = (rows: any[]): number => {
      const cognitiveLevels = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'];
      return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
        return sum + cognitiveLevels.reduce((s, k) => s + Number((row as any)?.[k] || 0), 0);
      }, 0);
    };

    const expectedFromQuestions = Array.isArray(questions) ? questions.length : 0;
    const expectedFromTos = computeTotalQuestionsFromTos(tos);
    const expectedFromKey = keyBase.length;

    const expectedQuestionsRaw =
      expectedFromQuestions > 0 ? expectedFromQuestions :
      expectedFromTos > 0 ? expectedFromTos :
      expectedFromKey > 0 ? expectedFromKey :
      50;

    const expectedQuestions = Math.max(1, Math.min(Number(expectedQuestionsRaw || 0), bubbles.length));

    // Ensure we only grade questions that exist on the generated sheet for this subject.
    this.answerKey = new Array(expectedQuestions).fill('').map((_, i) => keyBase[i] || '');
    this.total = expectedQuestions;
  }

  async startCamera() {
    try {
      await this.cameraService.attachToVideo(this.videoRef.nativeElement);
      this.streamActive = true;
      this.startPreviewLoop();
    } catch (e: any) {
      console.error('Camera access failed:', e);
      this.ngZone.run(() => {
        this.lastError = e.message || 'Camera access denied';
      });
      throw e;
    }
  }

  stopScanner() {
    this.streamActive = false;
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    void this.cameraService.stopStream();
  }

  startPreviewLoop() {
    const video = this.videoRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const loop = () => {
      if (!this.streamActive) return;
      
      if (video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        // Track markers for visual feedback (green corners) - no auto-capture
        if (!this.showResults && !this.isProcessing) {
          this.trackMarkers(ctx, canvas.width, canvas.height);
        }
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private trackMarkers(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const quadrants = this.omrLite.getQuadrants(width, height);
    
    let foundAll = true;
    const newMarkers: any = {};

    for (const quad of quadrants) {
      const marker = this.omrLite.findNestedMarker(data, width, height, quad);
      
      if (marker) {
        this.markerMemory[quad.id] = { pos: marker.center, frames: this.MEMORY_LIFE };
        newMarkers[quad.id] = marker.center;
      } else {
        if (this.markerMemory[quad.id].frames > 0) {
          this.markerMemory[quad.id].frames--;
          newMarkers[quad.id] = this.markerMemory[quad.id].pos;
        } else {
          newMarkers[quad.id] = null;
          foundAll = false;
        }
      }
    }

    this.ngZone.run(() => {
      this.detectedMarkers = newMarkers;
    });
  }

  toggleDebug() {
    this.debugMode = !this.debugMode;
  }

  async capture() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.statusMessage = 'Scanning OMR...';
    this.lastError = '';
    
    // Give UI a moment to update
    await new Promise(res => setTimeout(res, 100));

    try {
      const canvas = this.canvasRef.nativeElement;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      // QR-first: try to decode any standard QR in the frame
      let qrStudentId: number | null = null;
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height);
        if (qr?.data) {
          // Expect payload like "QR:classId:subjectId:studentId" but we only trust studentId.
          const parts = String(qr.data).split(':');
          if (parts.length >= 4 && parts[0] === 'QR') {
            const stuId = Number(parts[3] || 0);
            if (Number.isFinite(stuId)) {
              qrStudentId = stuId;
            }
          }
        }
      }

      // If preview tracking sees all 4 corner markers (green boxes), crop/focus the scan input
      // around the sheet to improve OpenCV marker detection and reduce warped results.
      const tracked = this.getTrackedCornerHints();
      const built = this.buildWorkCanvasWithHints(canvas, tracked);
      const workCanvas = built.canvas;

      const { gradingResults, studentHash, warpedImageBase64 } = await this.omrScanner.processFrame(
        workCanvas,
        this.answerKey,
        built.hints
      );

      this.lastPreviewWasWarped = !!warpedImageBase64;
      this.lastCapturedImageData = warpedImageBase64 || workCanvas.toDataURL('image/jpeg', 0.85);
      this.saveSuccess = false;

      this.ngZone.run(() => {
        this.gradingResults = gradingResults;
        this.calculateStats();
        this.showResults = true;
        this.isProcessing = false;
        this.statusMessage = 'Ready to scan';
        void this.loadStudentsForSave().then(() => {
          // Prefer explicit QR student id if available, otherwise fallback hash
          if (qrStudentId != null) {
            this.autoAttachByExactId(qrStudentId);
          } else if (studentHash != null) {
            this.autoAttachByHash(studentHash);
          }
        });
        if (this.aiAssistEnabled) {
          void this.runAiDoubleCheck();
        }
      });
    } catch (e: any) {
      console.error('OMR Lite Error', e);
      this.ngZone.run(() => {
        this.lastError = e.message || 'Detection failed';
        this.isProcessing = false;
        this.statusMessage = 'Ready to scan';
        
        // If it failed, check if it's a "No sheet found" error
        if (e.message.includes('markers')) {
          this.lastError = 'Sheet not visible. Please align corner markers.';
        }
      });
    }
  }

  async importFromGallery() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.statusMessage = 'Opening gallery...';
    this.lastError = '';

    try {
      const image = await Camera.getPhoto({
        quality: 100,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        this.statusMessage = 'Processing photo...';

        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            try {
              const ctx2 = canvas.getContext('2d', { willReadFrequently: true });

              let qrStudentId: number | null = null;
              if (ctx2) {
                const imageData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
                const qr = jsQR(imageData.data, imageData.width, imageData.height);
                if (qr?.data) {
                  const parts = String(qr.data).split(':');
                  if (parts.length >= 4 && parts[0] === 'QR') {
                    const stuId = Number(parts[3] || 0);
                    if (Number.isFinite(stuId)) {
                      qrStudentId = stuId;
                    }
                  }
                }
              }

              // Use the same on-device scanner pipeline as live camera:
              // NativeScan/OpenCV/OmrLite (no backend or Wi‑Fi required).
              const { gradingResults, studentHash, warpedImageBase64 } = await this.omrScanner.processFrame(canvas, this.answerKey);
              this.lastPreviewWasWarped = !!warpedImageBase64;
              this.lastCapturedImageData = warpedImageBase64 || canvas.toDataURL('image/jpeg', 0.85);
              this.saveSuccess = false;
              this.ngZone.run(() => {
                this.gradingResults = gradingResults;
                this.calculateStats();
                this.showResults = true;
                this.isProcessing = false;
                this.statusMessage = 'Ready to scan';
                void this.loadStudentsForSave().then(() => {
                  if (qrStudentId != null) {
                    this.autoAttachByExactId(qrStudentId as number);
                  } else if (studentHash != null) {
                    this.autoAttachByHash(studentHash);
                  }
                });
                if (this.aiAssistEnabled) {
                  void this.runAiDoubleCheck();
                }
              });
            } catch (err: any) {
              this.ngZone.run(() => {
                this.lastError = err?.message || 'Photo processing failed';
                if (this.lastError.includes('markers')) {
                  this.lastError = 'Corner markers not detected in photo.';
                } else if (this.lastError.includes('timed out')) {
                  this.lastError = 'Processing took too long. Please try again or use a clearer photo.';
                }
                this.isProcessing = false;
                this.statusMessage = 'Ready to scan';
              });
            }
          }
        };
        img.src = image.webPath;
      } else {
        this.ngZone.run(() => {
          this.isProcessing = false;
          this.statusMessage = 'Ready to scan';
        });
      }
    } catch (e: any) {
      console.error('Gallery import error', e);
      this.ngZone.run(() => {
        this.lastError = 'Gallery selection cancelled or failed';
        this.isProcessing = false;
        this.statusMessage = 'Ready to scan';
      });
    }
  }

  correctResult(index: number, event: any) {
    const newVal = event.detail.value;
    const r = this.gradingResults[index];
    r.detectedAnswer = newVal;
    
    if (!newVal) {
      r.status = 'Blank';
    } else {
      r.status = newVal === r.correctAnswer ? 'Correct' : 'Incorrect';
    }
    
    this.calculateStats();
  }

  // Remove the old OpenCV based methods as they are no longer used
  // canvasToMat, processOMR, detectAndWarp, sortCorners, gradeBubblesFromTemplate can be removed or kept as backups.


  calculateStats() {
    this.correctCount = this.gradingResults.filter(r => r.status === 'Correct').length;
    this.incorrectCount = this.gradingResults.filter(r => r.status === 'Incorrect').length;
    this.blankCount = this.gradingResults.filter(r => r.status === 'Blank').length;
    this.invalidCount = this.gradingResults.filter(r => r.status === 'Invalid').length;
    this.score = this.correctCount;
  }

  resetScanner() {
    this.showResults = false;
    this.gradingResults = [];
    this.score = 0;
    this.lastError = '';
    this.lastCapturedImageData = null;
    this.saveSuccess = false;
    this.rollNumberInput = '';
    this.selectedStudentId = null;
    this.startCamera();
  }

  async loadStudentsForSave() {
    if (!this.classId || !this.subjectId) return;
    try {
      this.students = await this.teacherService.getSubjectStudentsForClass(this.classId, this.subjectId);
      this.tryMatchStudentByRoll();
    } catch (e) {
      console.error('Failed to load students', e);
      this.students = [];
    }
  }

  autoAttachByHash(studentHash: number) {
    const match = (this.students || []).find(
      s => (Number(s.id) & 0xffff) === (Number(studentHash) & 0xffff)
    );
    if (!match) return;
    this.selectedStudentId = match.id;
    this.rollNumberInput = String(match.roll_number || '');
  }

  autoAttachByExactId(studentId: number) {
    const match = (this.students || []).find(
      s => Number(s.id) === Number(studentId)
    );
    if (!match) return;
    this.selectedStudentId = match.id;
    this.rollNumberInput = String(match.roll_number || '');
  }

  tryMatchStudentByRoll() {
    const roll = String(this.rollNumberInput || '').trim();
    if (!roll) {
      this.selectedStudentId = null;
      return;
    }
    const match = (this.students || []).find(s => String(s.roll_number || '').trim().toLowerCase() === roll.toLowerCase());
    this.selectedStudentId = match ? match.id : null;
  }

  onRollNumberChange() {
    this.tryMatchStudentByRoll();
  }

  onStudentSelected(event: any) {
    const id = event?.detail?.value;
    this.selectedStudentId = id ?? null;
    const s = (this.students || []).find(st => Number(st.id) === Number(id));
    if (s?.roll_number) this.rollNumberInput = String(s.roll_number);
  }

  get matchedStudent(): ClassStudent | undefined {
    if (!this.selectedStudentId) return undefined;
    return (this.students || []).find(s => Number(s.id) === Number(this.selectedStudentId));
  }

  async saveToProfile() {
    const roll = String(this.rollNumberInput || '').trim();
    const student = this.matchedStudent;

    if (!roll && !student) {
      await this.alertCtrl.create({
        header: 'Select Student',
        message: 'Enter the roll number from the sheet, or pick a student from the list.',
        buttons: ['OK']
      }).then(a => a.present());
      return;
    }

    this.isSaving = true;
    try {
      const subject = LocalDataService.getSubject(this.classId, this.subjectId);
      const tos = subject?.tos || [];
      const tosRows = subject?.tosRows || LocalDataService.generateTOSRows(tos);
      const tosMap = LocalDataService.generateTOSMap(tos);

      const answers: AnswerEntry[] = this.gradingResults.map((r, i) => {
        const mapEntry = tosMap[r.questionNumber - 1];
        return {
          question: r.questionNumber,
          marked: r.detectedAnswer,
          correctAnswer: r.correctAnswer || null,
          correct: r.status === 'Correct',
          topic: mapEntry?.topic ?? null,
          competency: mapEntry?.competency ?? null,
          level: mapEntry?.level ?? null
        };
      });

      const answerDistribution: Record<'A'|'B'|'C'|'D', number> = { A: 0, B: 0, C: 0, D: 0 };
      answers.forEach(a => {
        if (a.marked && (a.marked === 'A' || a.marked === 'B' || a.marked === 'C' || a.marked === 'D')) {
          answerDistribution[a.marked]++;
        }
      });

      const cognitiveBreakdown: { [level: string]: { correct: number; total: number } } = {};
      answers.forEach(a => {
        const level = a.level || 'N/A';
        if (!cognitiveBreakdown[level]) cognitiveBreakdown[level] = { correct: 0, total: 0 };
        cognitiveBreakdown[level].total++;
        if (a.correct) cognitiveBreakdown[level].correct++;
      });

      const imgData = this.lastCapturedImageData || '';

      const result: ScannedResult = {
        id: Date.now(),
        headerImage: imgData,
        fullImage: imgData,
        answers,
        score: this.correctCount,
        total: this.gradingResults.length,
        subjectId: this.subjectId,
        classId: this.classId,
        studentId: student?.id ?? null,
        // Prefer typed-in roll number, otherwise fall back to student's existing roll, otherwise null
        rollNumber: roll || student?.roll_number || null,
        studentName: student?.name ?? null,
        timestamp: new Date().toISOString(),
        answerDistribution,
        cognitiveBreakdown,
        tosRows: (subject?.tos || []) as TopicEntry[]
      };

      LocalDataService.saveScannedResult(this.classId, this.subjectId, result);
      const remoteRes = await this.teacherService.saveScanResult(this.classId, this.subjectId, result);
      if (!remoteRes.success) {
        console.warn('Remote scan save failed:', remoteRes.error);
      }

      if (student && roll && !String(student.roll_number || '').trim()) {
        const res = await this.teacherService.updateStudentRollNumber(this.classId, this.subjectId, student.id, roll);
        if (!res.success) console.warn('Could not update profile roll number:', res.error);
      }

      this.saveSuccess = true;
      await this.alertCtrl.create({
        header: 'Saved',
        message: `Result saved to ${student?.name || 'profile'} (Roll: ${roll || student?.roll_number || '—'})`,
        buttons: ['OK']
      }).then(a => a.present());
    } catch (e: any) {
      console.error('Save failed', e);
      await this.alertCtrl.create({
        header: 'Save Failed',
        message: e?.message || 'Could not save result.',
        buttons: ['OK']
      }).then(a => a.present());
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Optional AI-assisted backup grading using Gemini via Firebase Functions.
   * Calls a callable function `gradeOmrWithAI` if available, and lets AI
   * suggest corrections for low-confidence / invalid questions.
   */
  private async runAiDoubleCheck() {
    if (!this.gradingResults.length || this.aiChecking) return;

    this.aiChecking = true;
    try {
      const fn = httpsCallable(
        firebaseFunctions(),
        'gradeOmrWithAI'
      ) as any;

      const payload = {
        gradingResults: this.gradingResults,
        answerKey: this.answerKey,
        imageBase64: this.lastCapturedImageData || null,
      };

      const res = await fn(payload);
      const aiResults: GradingResult[] = Array.isArray((res as any)?.data?.gradingResults)
        ? (res as any).data.gradingResults
        : [];

      if (!aiResults.length) return;

      // Merge AI suggestions: only override when AI is more confident
      // or when our status is Invalid/Blank.
      const byQuestion = new Map<number, GradingResult>();
      aiResults.forEach(r => byQuestion.set(r.questionNumber, r));

      this.gradingResults = this.gradingResults.map((orig) => {
        const ai = byQuestion.get(orig.questionNumber);
        if (!ai) return orig;

        const origConf = orig.confidence ?? 0;
        const aiConf = ai.confidence ?? 0;
        const origIsWeak = orig.status === 'Invalid' || orig.status === 'Blank';

        if (aiConf > origConf || origIsWeak) {
          return {
            ...orig,
            detectedAnswer: ai.detectedAnswer,
            status: ai.status,
            confidence: aiConf,
            rawScores: ai.rawScores ?? orig.rawScores,
          };
        }
        return orig;
      });

      this.calculateStats();
    } catch (e) {
      // If AI backup fails (function missing, quota, etc.), just ignore.
      console.warn('AI double-check failed or unavailable:', e);
    } finally {
      this.aiChecking = false;
    }
  }

}

