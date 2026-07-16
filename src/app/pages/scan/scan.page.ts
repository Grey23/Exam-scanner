import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../../firebase';

import { CameraService } from '../../services/camera.service';
import { TeacherService } from '../../services/teacher.service';
import { LocalDataService, ScannedResult, AnswerEntry, TopicEntry } from '../../services/local-data.service';    
import { OmrLiteService } from '../../services/omr-lite.service';
import { OmrScannerService } from '../../services/omr-scanner.service';
import { OpenCvScannerService } from '../../services/opencv-scanner.service';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import jsQR from 'jsqr';
import type { ClassStudent } from '../../services/teacher.service';
import type { CornerHints } from '../../services/omr-scanner.service';

import { BubbleTemplate, bubbles, Option, BubbleCoordinate } from '../../data/bubble-template';
import { Platform } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { NavController } from '@ionic/angular';
import { Chart } from 'chart.js';
//import { AndroidPermissions } from '@awesome-cordova-plugins/android-permissions/ngx';
//import { PreloaderService } from '../../services/preloader.service';
//import { ScanService } from '../../services/scan.service';
//import { ScanAnswerService } from '../../services/scanAnswer.service';
import { Optional } from '@angular/core';
//import { AnswerKeyService } from '../../services/answer-key.service';

declare var cv: any;
declare const Tesseract: any;
/** 
export interface ScannedResult {
  id: number;
  headerImage: string;
  fullImage: string;
  answers: AnswerEntry[];
  score: number;
  total: number;
  subjectId: number;
  classId: number;
  timestamp: string;
  answerDistribution: Record<'A'|'B'|'C'|'D', number>;
  cognitiveBreakdown: { [level: string]: { correct: number; total: number } };
  tosRows: TopicEntry[];
}
export interface TopicEntry {
  topicName: string;
  learningCompetency: string;
  days: number;
  percent: number;
  expectedItems?: number;
  remembering?: number;
  understanding?: number;
  applying?: number;
  analyzing?: number;
  evaluating?: number;
  creating?: number;
}
  */
interface Question {
  questionNumber: number;
  answer: 'A' | 'B' | 'C' | 'D';
}
interface AnswerSheet {
  id: number;
  teacher_id: number;
  subject: string;
  questions: Question[];
}
export interface Result {
  question: number;
  marked: Option | null;
  correctAnswer: Option | null;
  correct: boolean;
  topic?: string | null;       // ✅ added
  competency?: string | null;  // ✅ added
  level?: string | null;       // ✅ added
}
/** 
export interface AnswerEntry {
  question: number;
  marked: Option | null;
  correctAnswer: Option | null;
  correct: boolean;
  topic?: string | null;
  competency?: string | null;
  level?: string | null;
}
*/
function isOption(value: string | null): value is Option {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D';
}
function isGoodWarpCandidate(corners: { x: number, y: number }[]): boolean {
  const dx = (p1: { x: number, y: number }, p2: { x: number, y: number }) => p2.x - p1.x;
  const dy = (p1: { x: number, y: number }, p2: { x: number, y: number }) => p2.y - p1.y;
  const dist = (p1: { x: number, y: number }, p2: { x: number, y: number }) =>
    Math.hypot(dx(p1, p2), dy(p1, p2));

  const angle = (
    a: { x: number, y: number },
    b: { x: number, y: number },
    c: { x: number, y: number }
  ) => {
    const ab: [number, number] = [dx(a, b), dy(a, b)];
    const cb: [number, number] = [dx(c, b), dy(c, b)];
    const dot = ab[0] * cb[0] + ab[1] * cb[1];
    const mag1 = Math.hypot(...ab);
    const mag2 = Math.hypot(...cb);
    return Math.acos(dot / (mag1 * mag2)) * (180 / Math.PI);
  };

  const [tl, tr, br, bl] = corners;

  const widthTop = dist(tl, tr);
  const widthBottom = dist(bl, br);
  const heightLeft = dist(tl, bl);
  const heightRight = dist(tr, br);

  const avgWidth = (widthTop + widthBottom) / 2;
  const avgHeight = (heightLeft + heightRight) / 2;
  const ratio = avgHeight / avgWidth;

  // 1. Aspect ratio check (A4 paper is about 1.414)
  if (ratio < 1.3 || ratio > 1.5) return false;

  // 2. Opposite side length similarity check
  if (Math.abs(widthTop - widthBottom) > 40 || Math.abs(heightLeft - heightRight) > 40) return false;

  // 3. Internal angle check
  const angles = [
    angle(tl, tr, br),
    angle(tr, br, bl),
    angle(br, bl, tl),
    angle(bl, tl, tr),
  ];
  if (angles.some(a => a < 80 || a > 100)) return false;

  return true;
}

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
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule],
  //providers: [AndroidPermissions],
})
export class ScanPage implements AfterViewInit, OnDestroy {

  
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('video', { static: false }) videoRef!: ElementRef<HTMLVideoElement>;
  //@ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  //@ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
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

  //mine

  
  canvasWidth = 800;
  canvasHeight = Math.round(800 * 1.414);
  latestWarpedMat: any = null;
  latestWarpedMatBase64: string | null = null; // ✅ add this

  // Inside ScanPage class
  latestResult: ScannedResult | null = null;
  latestResultId: number | null = null; // or string, depending on how you save IDs
  //latestWarpedMat: any = null;
  //classId: number = 0;
  //subjectId: number = 0;
  chart: Chart | undefined;
  chartInstance: any = null;
  scannedImageUrl: string | null = null;
  studentPercentage: number = 0;
  classAveragePercentage: number = 0;
  showCamera = false;
  showCroppedImage = false;
  croppedHeaderBase64: string = '';
  fullImageBase64: string = '';
  croppedImageUrl: string | null = null;
  //isProcessing: boolean = false;
  cropOpacity = 1;
  //score: number = 0;
  results: Result[] = [];
  detectionBoxes = [
    { x: 0, y: 0, width: 125, height: 125 },
    { x: 0, y: 500, width: 125, height: 125 },
    { x: 355, y: 0, width: 125, height: 125 },
    { x: 355, y: 500, width: 125, height: 125 }
  ];

  detectedContours: any;
  isSheetScanned: boolean = false;
  answers: any[] = [];
  //total: number = 0;
  //detectedAnswers: { [questionNumber: string]: string | null } = {};
  detectedAnswers: Record<number, Option | null> = {};
  hasResults: boolean = false;
  subject!: string;
  cvInitialized = false;
  tosRows: any[] = [];
  answerSheets: AnswerSheet[] = [];
  //answerKey: { [questionNumber: number]: string } = {};

  // internal OpenCV helpers (optional; only create if needed by your processVideo)
  private srcMat: any = null;
  private cap: any = null;


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

    type RingStyle = 'correct' | 'wrong' | 'correctKey' | 'blank' | 'invalid';

    const drawBubbleRing = (tpl: typeof bubbles[0], opt: 'A' | 'B' | 'C' | 'D', style: RingStyle) => {
      const coord = tpl.options[opt];
      const x = coord.cx * scaleX;
      const y = coord.cy * scaleY;
      const r = coord.radius * scaleR;

      ctx.save();
      ctx.setLineDash([]);

      switch (style) {
        case 'correct':
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = Math.max(3, 4 * scaleR);
          break;
        case 'wrong':
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = Math.max(3, 4 * scaleR);
          break;
        case 'correctKey':
          ctx.strokeStyle = '#16a34a';
          ctx.lineWidth = Math.max(2.5, 3 * scaleR);
          break;
        case 'blank':
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = Math.max(2.5, 3 * scaleR);
          ctx.setLineDash([5, 4]);
          break;
        case 'invalid':
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = Math.max(2.5, 3 * scaleR);
          break;
      }

      ctx.beginPath();
      ctx.arc(x, y, r + 2 * scaleR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    for (let q = 1; q <= Math.min(50, maxQuestion); q++) {
      const tpl = bubbles[q - 1];
      if (!tpl) continue;

      const res = byQuestion.get(q);
      if (!res) continue;

      const detected = res.detectedAnswer && ['A', 'B', 'C', 'D'].includes(res.detectedAnswer)
        ? res.detectedAnswer as 'A' | 'B' | 'C' | 'D'
        : null;
      const correct = res.correctAnswer && ['A', 'B', 'C', 'D'].includes(res.correctAnswer)
        ? res.correctAnswer as 'A' | 'B' | 'C' | 'D'
        : null;

      if (res.status === 'Blank') {
        for (const opt of ['A', 'B', 'C', 'D'] as const) {
          drawBubbleRing(tpl, opt, 'blank');
        }
        continue;
      }

      if (res.status === 'Correct' && detected) {
        drawBubbleRing(tpl, detected, 'correct');
        continue;
      }

      if (res.status === 'Incorrect') {
        if (detected) drawBubbleRing(tpl, detected, 'wrong');
        if (correct && correct !== detected) drawBubbleRing(tpl, correct, 'correctKey');
        continue;
      }

      if (res.status === 'Invalid') {
        if (detected) drawBubbleRing(tpl, detected, 'invalid');
      }
    }
  }

  private scheduleScanOverlayRender() {
    setTimeout(() => this.renderScanOverlay(), 50);
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
    private alertCtrl: AlertController,
    private platform: Platform,
    private router: Router,
    private http: HttpClient,
    private navCtrl: NavController,
    //private preloader: PreloaderService,         // ✅ new
    //private scanAnswerService: ScanAnswerService, // ✅ new
    //private answerKeyService: AnswerKeyService,
    //private scanService: ScanService,
    //@Optional() private androidPermissions?: AndroidPermissions,
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
    //alert("initScanner called");
    //this.statusMessage = 'Initializing...';
    await LocalDataService.load();

    try {
      this.openCvScanner.preload();
      await Promise.all([this.startCamera(), this.loadAnswerKey()]);
      //this.statusMessage = 'Ready to scan';
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
  // ✅ Start camera after everything is prepared
  this.onStartCameraButtonClick();
  }

  stopScanner() {
    this.showCamera = false;
    this.showCroppedImage = false;
    this.croppedImageUrl = null;
    this.isProcessing = false;
    this.showDetectionBoxes = true; // re-enable boxes for next scan
    if (this.videoRef?.nativeElement?.srcObject) {
      const stream = this.videoRef.nativeElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      this.videoRef.nativeElement.srcObject = null;
    }
    //this.streamActive = false;
    //if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    //void this.cameraService.stopStream();
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
        this.scheduleScanOverlayRender();
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
                this.scheduleScanOverlayRender();
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
    this.scheduleScanOverlayRender();
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
      await LocalDataService.load();
      LocalDataService.debugLog();
      const subject = LocalDataService.getSubject(this.classId, this.subjectId);
      console.log('=== SCAN SAVE DEBUG ===');
      console.log('classId:', this.classId, 'subjectId:', this.subjectId);
      console.log('subject:', subject);
      console.log('subject?.tos:', subject?.tos);
      console.log('subject?.tosRows:', subject?.tosRows);
      const tos = subject?.tos || [];
      const tosRows = subject?.tosRows || LocalDataService.generateTOSRows(tos);
      const tosMap = LocalDataService.generateTOSMap(tos);
      console.log('tos length:', tos.length);
      console.log('tosRows length:', tosRows.length);
      console.log('tosMap length:', tosMap.length);
      console.log('======================');

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
        headerImage: this.croppedHeaderBase64 || "",
        fullImage: this.lastCapturedImageData || "",
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

 /** 
async ngAfterViewInit() {
  await this.waitForVideoElement();
  await this.waitForOpenCV();

  // Load classId + subjectId from params
  this.route.queryParams.subscribe(params => {
    this.classId = Number(params['classId']);
    this.subjectId = Number(params['subjectId']);

    // Optional: preload scans
    this.scanService.getScans(this.classId, this.subjectId).subscribe({
      next: (scans) => {
        console.log("✅ Loaded scans:", scans);
      },
      error: (err) => {
        console.error("❌ Failed to load scans", err);
      }
    });

    // Load TOS
    this.http.get<any[]>(`https://capstone-wwbm.onrender.com/subjects/${this.classId}/${this.subjectId}/tos`).subscribe({
      next: (tos: any[]) => {
        this.tosRows = tos;
      },
      error: (err) => {
        console.error("❌ Failed to load TOS", err);
        this.tosRows = [];
      }
    });

   // ✅ Load Answer Key once
   this.answerKeyService.getAnswerKey(this.classId, this.subjectId).subscribe(keyRows => {
    this.answerKey = {}; // reset
    keyRows.forEach((row: any) => {
      console.log("🔎 Raw row from DB:", row);

      // ✅ Flexible property mapping
      const qNum = row.question || row.question_number || row.questionNumber;
      const correct = row.correctAnswer || row.correct_answer || row.correctAnswer;

      if (qNum && correct) {
        this.answerKey[qNum] = correct;
      }
    });

    this.total = Object.keys(this.answerKey).length;
    console.log("✅ Final AnswerKey Map:", this.answerKey);
  });
  });

  // ✅ Start camera after everything is prepared
  this.onStartCameraButtonClick();
}
*/


 private async waitForOpenCV(): Promise<void> {
  while (!(window as any).cv || !(window as any).cv.Mat) {
    await new Promise(res => setTimeout(res, 50));
  }
  console.log("✅ OpenCV is ready");
}

  private async waitForVideoElement(): Promise<void> {
    while (!this.videoRef || !this.videoRef.nativeElement) {
      await new Promise(res => setTimeout(res, 10));
    }
  }
private initOpenCVMatsAndCapture(videoEl: HTMLVideoElement) {
  if (typeof (window as any).cv !== 'undefined') {
    // Proceed with initialization
  } else {
    console.warn('OpenCV is not available. Please try again later.');
    alert('OpenCV is not available. Please try again later.');
  }
}

onStartCameraButtonClick() {
  this.showCamera = true;

  // Wait for Angular to render the <video> element
  setTimeout(() => {
    this.startCameraView();
  }, 0);
}

  startCameraView() {
  const videoEl: HTMLVideoElement = this.videoRef?.nativeElement;
  if (!videoEl) {
    console.warn('Video element not ready, retrying...');
    setTimeout(() => this.startCameraView(), 50); // retry shortly
    return;
  }

  navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: 640 },
      height: { ideal: 480 }
    }
  }).then((stream) => {
    videoEl.srcObject = stream;
    videoEl.play();
    videoEl.onloadedmetadata = () => {
      videoEl.width = 640;
      videoEl.height = 480;
      this.processVideo();
    };
  }).catch((err) => {
    console.error('Camera error:', err);
    alert('Error accessing camera: ' + err.message);
  });
  }
    
  goToResultViewer(result?: ScannedResult | null) {
  const payload = result ?? this.latestResult;
  if (!payload) return;
  this.router.navigate(['/resultviewer'], {
    state: { resultData: payload }
  });
}
  reset() {
    this.showCamera = false;
    this.showCroppedImage = false;
    this.croppedImageUrl = null;
    this.isProcessing = false;
    this.showDetectionBoxes = true; // re-enable boxes for next scan
    if (this.videoRef?.nativeElement?.srcObject) {
      const stream = this.videoRef.nativeElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      this.videoRef.nativeElement.srcObject = null;
    }
  }

  // New flag at the top of your scan.page.ts
  showDetectionBoxes: boolean = true;

  drawDetectionBoxes(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.showDetectionBoxes) return; // skip drawing entirely
    ctx.save();
    ctx.globalAlpha = 1.0;
    this.detectionBoxes.forEach(box => {
      ctx.strokeStyle = 'lime';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    });
    ctx.restore();
  }

  isRectInsideDetectionBoxes(rect: { x: number; y: number; width: number; height: number }) {
    return this.detectionBoxes.some(box => {
      return (
        rect.x >= box.x &&
        rect.y >= box.y &&
        rect.x + rect.width <= box.x + box.width &&
        rect.y + rect.height <= box.y + box.height
      );
    });
  }

    processVideo() {
    //alert("processVideo started");
    try {
        const video = this.videoRef.nativeElement;
        const canvas = this.canvasRef.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            alert('Could not get canvas context');
            return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const edges = new cv.Mat();

    const FPS = 10;
    let stopped = false;

    const process = () => {
      if (stopped) return;

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();

      if (!video || video.readyState < 2) {
        requestAnimationFrame(process);
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      this.drawDetectionBoxes(ctx, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      src.data.set(imageData.data);

      cv.cvtColor(src, gray, cv.COLOR_BGR2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      cv.threshold(blurred, edges, 60, 255, cv.THRESH_BINARY_INV);
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      if (!this.detectionBoxes || this.detectionBoxes.length === 0) {
        requestAnimationFrame(process);
        return;
      }

      let detectedBoxes = new Array(this.detectionBoxes.length).fill(false);

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true);

        if (
          approx.rows === 4 &&
          cv.isContourConvex(approx) &&
          cv.contourArea(approx) > 300 &&  // min size
          cv.contourArea(approx) < 3000    // max size
        ) {
          const rect = cv.boundingRect(approx);

          this.detectionBoxes.forEach((box, idx) => {
            if (
              rect.x >= box.x &&
              rect.y >= box.y &&
              rect.x + rect.width <= box.x + box.width &&
              rect.y + rect.height <= box.y + box.height
            ) {
              detectedBoxes[idx] = true;
              ctx.save();
              ctx.strokeStyle = 'red';
              ctx.lineWidth = 4;
              ctx.globalAlpha = 0.7;
              ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
              ctx.fillStyle = 'rgba(255,0,0,0.2)';
              ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
              ctx.restore();
            }
          });
        }
        approx.delete();
        cnt.delete();
      }

      // In the processVideo function, when all boxes are detected:
      if (detectedBoxes.every(v => v) && !this.isProcessing && !this.croppedImageUrl) {

        alert("Auto capture triggered");
        this.isProcessing = true;

        const capturedFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

        this.detectAndCropPaper(capturedFrame)
          .then(() => {
              //alert("detectAndCropPaper returned");

              this.isProcessing = false;

              stopped = false;   // <-- important for testing
          })
          .catch(err => {
              console.error(err);
              this.isProcessing = false;
          });

      }

      requestAnimationFrame(process);
    };

    requestAnimationFrame(process);
    } catch (error) {
        console.error('Error in processVideo:', error);
    }
    }

    // helper
  async presentAlert(header: string, message: string) {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  async detectAndCropPaper(imageData: ImageData): Promise<void>
  //<ScannedResult | null>
   {
  const log = (...args: any[]) => console.log("[detectAndCropPaper]", ...args);
    alert("Entered detectAndCropPaper");
  try {
    //this.presentAlert("Scan Step", "Init started");
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) throw new Error("Canvas element not found");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context missing");
    //alert("1 - canvas ready");
    // Read canvas into OpenCV Mat
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        // 🔥 FIX 1: Light normalization (works for bright & dark rooms)
    const norm = new cv.Mat();
    cv.normalize(gray, norm, 0, 255, cv.NORM_MINMAX);
        // ✅ ADD THIS HERE
    //cv.medianBlur(norm, norm, 5);
    cv.GaussianBlur(norm, norm, new cv.Size(5, 5), 0);
    //alert("✅ Canvas read + grayscale + blur applied");

    const markerCorners: { x: number; y: number }[] = [];
    if (!Array.isArray(this.detectionBoxes) || this.detectionBoxes.length === 0) {
      console.warn("No detectionBoxes");
      return; // 🔥 do NOT throw
    }
    //alert(`📦 detectionBoxes count: ${this.detectionBoxes.length}`);
    //alert("2 - image loaded");
    // 🔹 Detect 4 corners
    for (const [boxIndex, box] of this.detectionBoxes.entries()) {
      //alert("3a");
      //alert(`🔍 Processing detectionBox ${boxIndex + 1}`);
      //const roi = gray.roi(new cv.Rect(box.x, box.y, box.width, box.height));
      const roi = norm.roi(new cv.Rect(box.x, box.y, box.width, box.height));
      const roiContours = new cv.MatVector();
      const roiHierarchy = new cv.Mat();
      const thresh = new cv.Mat();
      //alert("3b");
      cv.adaptiveThreshold(
        roi,
        thresh,
        255,
        cv.ADAPTIVE_THRESH_MEAN_C,
        cv.THRESH_BINARY_INV,
        45,
        0
      );
      //alert("3c");
      cv.findContours(thresh, roiContours, roiHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      //alert("3d");
      //cv.threshold(roi, roi, 90, 255, cv.THRESH_BINARY_INV);
      //cv.findContours(roi, roiContours, roiHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let bestQuad: Array<{ x: number; y: number }> | null = null;
      let maxArea = 0;
      //alert("4");
      for (let contourIndex = 0; contourIndex < roiContours.size(); contourIndex++) {
        //alert("5" + contourIndex);
        const cnt = roiContours.get(contourIndex);
        //alert("6");
        const approx = new cv.Mat();
        //alert("7");
        cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true);
        //alert("8");
        if (approx.rows >= 4 && approx.rows <= 6 && cv.isContourConvex(approx)) {

            const rect = cv.boundingRect(approx);
            const ratio = rect.width / rect.height;

            if (ratio < 0.6 || ratio > 1.4) {
              approx.delete();
              cnt.delete();
              continue;
            }

          const area = cv.contourArea(approx);

          /* ✅ ADD THIS HERE
          const fillRatio = area / (rect.width * rect.height);
          if (fillRatio < 0.5) {
            approx.delete();
            cnt.delete();
            continue;
          }*/

          if (area > 80 && area < 900 && area > maxArea) {
            maxArea = area;
            bestQuad = [];
            for (let j = 0; j < 4; j++) {
              const pt = approx.data32S.slice(j * 2, j * 2 + 2);
              bestQuad.push({ x: pt[0] + box.x, y: pt[1] + box.y });
            }
          }
        }
        approx.delete();
        cnt.delete();
      }

      if (bestQuad) {

        alert(`✅ Quad found in box ${boxIndex + 1}, area=${maxArea}`);

        const cx = bestQuad.reduce((sum, p) => sum + p.x, 0) / 4;
        const cy = bestQuad.reduce((sum, p) => sum + p.y, 0) / 4;

        markerCorners.push({ x: cx, y: cy });

      } else {

        alert(`⚠️ No quad in box ${boxIndex + 1} — restarting scan`);

        roi.delete();
        roiContours.delete();
        roiHierarchy.delete();
        thresh.delete();
        this.isProcessing = false;
        this.statusMessage = "Ready to scan";
        return; // return to processVideo
      }

      roi.delete();
      roiContours.delete();
      roiHierarchy.delete();
      thresh.delete();
    }
    gray.delete();
    norm.delete();
    if (markerCorners.length !== 4) throw new Error("Expected 4 corners, got " + markerCorners.length);
    alert("✅ Found 4 corners, ordering...");
    const sum = markerCorners.map(p => p.x + p.y);
    const diff = markerCorners.map(p => p.x - p.y);

    const ordered = [
      markerCorners[sum.indexOf(Math.min(...sum))], // top-left
      markerCorners[diff.indexOf(Math.max(...diff))], // top-right
      markerCorners[sum.indexOf(Math.max(...sum))], // bottom-right
      markerCorners[diff.indexOf(Math.min(...diff))] // bottom-left
    ];
    // 🔹 Order corners (TL, TR, BR, BL)
    /*markerCorners.sort((a, b) => a.y - b.y);
    const top = markerCorners.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = markerCorners.slice(2, 4).sort((a, b) => a.x - b.x);
    const ordered = [top[0], top[1], bottom[1], bottom[0]];
*/
    const FIXED_WIDTH = 800;
    const FIXED_HEIGHT = Math.round(800 * 1.414);
    //alert(`📐 Perspective target size: ${FIXED_WIDTH}x${FIXED_HEIGHT}`);

    const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered[0].x, ordered[0].y,
      ordered[1].x, ordered[1].y,
      ordered[2].x, ordered[2].y,
      ordered[3].x, ordered[3].y
    ]);
    const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      FIXED_WIDTH, 0,
      FIXED_WIDTH, FIXED_HEIGHT,
      0, FIXED_HEIGHT
    ]);
    const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(FIXED_WIDTH, FIXED_HEIGHT));
    //alert("✅ Perspective transform complete");

    // ✅ Save warpedMat for processSheet
    if (this.latestWarpedMat) this.latestWarpedMat.delete();
    this.latestWarpedMat = dst.clone();
    //alert("4 - perspective done");
    // Show warped result
    canvas.width = FIXED_WIDTH;
    canvas.height = FIXED_HEIGHT;
    cv.imshow(canvas, dst);
    //alert("5 - image displayed");
    // Disable detection boxes
    this.showDetectionBoxes = false;
    this.detectionBoxes = [];
    //alert("📸 Warped sheet drawn on canvas");

    // 🔹 Crop header
    const HEADER_HEIGHT = 250;
    const headerMat = dst.roi(new cv.Rect(0, 0, dst.cols, HEADER_HEIGHT));
    const headerCanvas = document.createElement("canvas");
    headerCanvas.width = headerMat.cols;
    headerCanvas.height = headerMat.rows;
    cv.imshow(headerCanvas, headerMat);
    this.croppedHeaderBase64 = headerCanvas.toDataURL("image/jpeg", 0.8); // compressed JPEG
    headerMat.delete();
    //alert("📎 Header cropped + saved");
    //alert("6 - header done");
    // ✅ Log header + warped sizes
    const sizeKB = (b64: string) =>
      b64 ? Math.round((b64.length * (3 / 4)) / 1024) : 0;

    const warpedSize = sizeKB(canvas.toDataURL("image/jpeg", 0.8));
    const headerSize = sizeKB(this.croppedHeaderBase64);
    //alert(`📏 Size check: header=${headerSize}KB, warped=${warpedSize}KB`);
    //alert("📥 Answer key passed in: " + JSON.stringify(this.answerKey));
    //alert("7 - Passing to processSheet");
    // 🔹 Process bubbles + overlay + build result
    const overlayCtx = canvas.getContext("2d");
    if (!overlayCtx) {
        alert("⚠️ overlayCtx missing");
        return;
    }

    //alert("🔄 Passing to processSheet...");

    await this.processSheet(overlayCtx);
    //alert("Returned from processSheet");
    this.calculateStats();
    //alert("B");
    this.showResults = true;
    //alert("C");
    this.scheduleScanOverlayRender();
    //alert("Before loadStudents");
    await this.loadStudentsForSave();
    //alert("After loadStudents");
    this.saveSuccess = false;
    //alert("detectAndCropPaper finished");
    this.isProcessing = false;
    /** 
    let result: ScannedResult | null = null;

    if (overlayCtx) {
      // ✅ Ensure answerKey is available before processing
      if ((!this.answerKey || Object.keys(this.answerKey).length === 0) && this.answerKey) {
        try {
          const arr = await this.loadAnswerKey();
            

          // Normalize into { [qNum]: 'A' | 'B' | 'C' | 'D' }
          /** 
          this.answerKey = {};
          for (const it of arr || []) {
            const qnum = Number(it.question ?? it.question_number);
            if (!Number.isNaN(qnum) && it.correctAnswer) {
              this.answerKey[qnum] = String(it.correctAnswer).toUpperCase();
            }
          }
            
          console.log("✅ detectAndCropPaper: answerKey loaded before processing:", this.answerKey);
        } catch (e) {
          console.warn("⚠️ detectAndCropPaper: Could not load answerKey before processing:", e);
        }
      }

      alert("🔄 Passing to processSheet with answerKey...");
      result = await this.processSheet(overlayCtx);
    } else {
      alert("⚠️ overlayCtx missing, skipping processSheet");
    }
    **/
    // Cleanup mats
    src.delete();
    dst.delete();
    srcPoints.delete();
    dstPoints.delete();
    M.delete();

    this.presentAlert("Scan Step", "Done detectAndCropPaper, proceeding to processSheet.");
    //return result;
    return;
  } catch (err: any) {
  console.error("detectAndCropPaper error:", err);

  const msg =
    err?.message ||
    err?.toString() ||
    JSON.stringify(err) ||
    "Unknown error";

  this.presentAlert("Error", "detectAndCropPaper failed: " + msg);
  alert("❌ detectAndCropPaper failed: " + msg);

  return;
}
}

// 🔹 Convert Base64 → Blob
dataURItoBlob(dataURI: string) {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}
/** 
// 🔹 Main handler after scanning (now receives the result from processSheet)
// 🔹 Main handler after scanning (receives the result from processSheet)
async handleScanComplete(result: ScannedResult) {
  if (!result) {
    console.warn("⚠️ handleScanComplete received null result, skipping.");
    alert("⚠️ handleScanComplete received null result, skipping.");
    return;
  }

  try {
    alert("💾 handleScanComplete: Saving scan to backend...");

    // 1. Save scan + answers
    await this.saveScanToBackend(result);

    alert("✅ handleScanComplete: Navigating to result viewer...");

    // 2. Navigate to result viewer
    this.goToResultViewer(result);

  } catch (err: any) {
    console.error("❌ Failed to save scan", err);
    alert("❌ Failed to save scan to backend: " + err.message);
  }
}
  */
/** 
// 🔹 Save scanned result to backend (scan + answers)
async saveScanToBackend(result: ScannedResult): Promise<void> {
  alert("💾 saveScanToBackend: Preparing safeResults...");

  // ✅ Convert answers safely from result.answers
  const safeResults = (result.answers || []).map(r => ({
    question_number: r.question,
    marked: r.marked ? String(r.marked) : null,     // ✅ match DB column
    correct_answer: r.correctAnswer ? String(r.correctAnswer) : null,
    correct: r.correct,                             // ✅ boolean/0/1 based on backend
    topic: r.topic || null,
    competency: r.competency || null,
    level: r.level || null
  }));

  // ✅ Match backend schema
  const scanData = {
    subject_id: result.subjectId,
    class_id: result.classId,
    score: result.score,
    total: result.total,
    header_image: result.headerImage,
    full_image: result.fullImage,
    timestamp: result.timestamp,
    answers: safeResults
  };

  alert("📡 saveScanToBackend: Sending scanData to backend...");

  return new Promise<void>((resolve, reject) => {
    this.scanService.createScan(result.classId, result.subjectId, scanData).subscribe({
      next: (res: any) => {
        const scanId = res.scanId;
        alert("✅ saveScanToBackend: Scan saved with scanId=" + scanId);

        // ✅ Save answers separately linked to scanId
        this.scanAnswerService.saveAnswers(scanId, safeResults).subscribe({
          next: () => {
            console.log("✅ Scan + answers saved!");
            alert("✅ saveScanToBackend: Answers saved successfully!");
            resolve();
          },
          error: (err: any) => {
            console.error("❌ Error saving answers:", err);
            alert("❌ saveScanToBackend: Error saving answers - " + err.message);
            reject(err);
          }
        });
      },
      error: (err: any) => {
        console.error("❌ Error saving scan:", err);
        alert("❌ saveScanToBackend: Error saving scan - " + err.message);
        reject(err);
      }
    });
  });
}
*/
// 🔹 Detect bubbles, overlay, and build result object
async processSheet(
  ctx?: CanvasRenderingContext2D,
  //answerKey?: Record<number, any>
): Promise<void>{
  if (!this.latestWarpedMat || this.latestWarpedMat.empty()) {
    alert("⚠️ processSheet: No warpedMat available.");
    return;
  }
  await this.loadAnswerKey();
  // allow either the passed-in answerKey param OR this.answerKey
  /** 
  if ((!answerKey || Object.keys(answerKey).length === 0) &&
      (!this.answerKey || Object.keys(this.answerKey).length === 0)) {
    console.warn("⚠️ No answer key available — overlays that need the key will be disabled.");
    // DO NOT return; proceed (we'll just have rawKey === {})
  }
*/
  // rawKey will be the passed answerKey (preferred) or this.answerKey or empty {}
  //const rawKey: Record<number, any> = answerKey || this.answerKey || {};
  // Helper to coerce into Option | null
  /** 
  const getCorrectAnswer = (qNum: number): Option | null => {
    const val = rawKey[qNum];
    return val && ["A", "B", "C", "D"].includes(val) ? val as Option : null;
  };*/
  const toGray = (src: any) => {
    const gray = new cv.Mat();
    const code =
      typeof src.channels === "function" && src.channels() === 4
        ? cv.COLOR_RGBA2GRAY
        : cv.COLOR_BGR2GRAY;
    cv.cvtColor(src, gray, code);
    return gray;
  };

  const H = this.latestWarpedMat.rows;
  const W = this.latestWarpedMat.cols;
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);

  this.detectedAnswers = {};
  this.results = [];
  this.score = 0;

  // 🔹 Use preloaded TOS
  const tosRows = this.tosRows || [];
  const tosTotal = tosRows.reduce((sum, row) => sum + (row.expectedItems || 0), 0);
  const maxItems = tosTotal > 0 ? tosTotal : bubbles.length;
  this.total = maxItems;

  // ✅ Draw warped sheet
  const canvas = this.canvasRef.nativeElement;
  cv.imshow(canvas, this.latestWarpedMat);
  //alert( `${this.latestWarpedMat.cols} x ${this.latestWarpedMat.rows}`);
  const overlayCtx = canvas.getContext("2d");
  if (!overlayCtx) return;

  const ring = (x: number, y: number, r: number, color: string, lw = 2) => {
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, r, 0, 2 * Math.PI);
    overlayCtx.lineWidth = lw;
    overlayCtx.strokeStyle = color;
    overlayCtx.stroke();
  };

  let processed = 0;

  for (const bubble of bubbles) {
    if (processed >= maxItems) break;
    const qNum = bubble.question as number;

    const ratios: Record<Option, number> = { A: 0, B: 0, C: 0, D: 0 };
    const means: Record<Option, number> = { A: 255, B: 255, C: 255, D: 255 };
    for (const opt of ["A", "B", "C", "D"] as const) {
      const { cx, cy, radius } = bubble.options[opt];
      const side = Math.max(2 * radius, 1);
      const x = Math.max(0, Math.min(W - 1, Math.round(cx - radius)));
      const y = Math.max(0, Math.min(H - 1, Math.round(cy - radius)));
      const w = Math.min(side, W - x);
      const h = Math.min(side, H - y);

      const patch = this.latestWarpedMat.roi(new cv.Rect(x, y, w, h));
      const gray = toGray(patch);

      const mean = cv.mean(gray)[0];
      means[opt] = mean; // 🔥 YOU MISSED THIS
      if (mean > 190) {
        ratios[opt] = 0;
          patch.delete(); 
          gray.delete();
        continue;
      }

      // 🔥 boost contrast
      //cv.equalizeHist(gray, gray);

      // 🔥 slight blur (not too strong)
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      const bin = new cv.Mat();
      cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      if (cv.countNonZero(bin) < 20) {
        cv.threshold(gray, bin, 90, 255, cv.THRESH_BINARY_INV);
      }

      const mask = cv.Mat.zeros(h, w, cv.CV_8UC1);
      const rx = radius * 1.0;
      //const rx = Math.min(w, h) / 2 - 1;
      cv.circle(
        mask,
        new cv.Point(Math.round(w / 2), Math.round(h / 2)),
        Math.round(rx),
        new cv.Scalar(255),
        -1
      );

      const masked = new cv.Mat();
      cv.bitwise_and(bin, mask, masked);
      //cv.morphologyEx(masked, masked, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(masked, masked, cv.MORPH_CLOSE, kernel);
      const nonZero = cv.countNonZero(masked);
      if (nonZero < 8) {
        ratios[opt] = 0;
        patch.delete(); gray.delete(); bin.delete(); mask.delete(); masked.delete();
        continue;
      }
      const totalPixels = Math.PI * rx * rx;
      ratios[opt] = nonZero / totalPixels;

      patch.delete(); gray.delete(); bin.delete(); mask.delete(); masked.delete();
    }

    // 🔹 Detect marked answer
    let selected: Option | null = null;
    let bestRatio = 0;
    let secondBest = 0;
    const MIN_DETECT = 0.18;
    const MIN_GAP = 0.16;
    for (const opt of ["A", "B", "C", "D"] as const) {
      const r = ratios[opt];
      if (r > bestRatio) {
          secondBest = bestRatio;
          bestRatio = r;
          selected = opt;
        } else if (r > secondBest) {
          secondBest = r;
        }
      }

    // 🚫 reject noise
    const bestMean = selected ? means[selected] : 255;

    // 🚫 reject noise + shadow
    if (
      bestRatio < MIN_DETECT ||
      (bestRatio - secondBest) < MIN_GAP ||
      bestMean > 190 // 🔥 shadow filter
    ) {
      selected = null;
    }
    /*
    // 🔹 Correct answer (loose old-style but typed)
    const correctAnswer = getCorrectAnswer(qNum);
    const isCorrect = !!(selected && correctAnswer && selected === correctAnswer);
    if (isCorrect) this.score++;

    this.detectedAnswers[String(qNum)] = selected ?? null;
    this.results.push({
      question: qNum,
      marked: selected,
      correctAnswer,
      correct: isCorrect,
      topic: bubble.topic ?? null,
      competency: bubble.competency ?? null,
      level: bubble.level ?? null,
    });
    processed++;
*/

    this.detectedAnswers[qNum] = selected;
    // 🔹 Overlay
    /*
    for (const opt of ["A", "B", "C", "D"] as const) {
      const { cx, cy, radius } = bubble.options[opt];
      let color = "blue";
      if (opt === selected && opt === correctAnswer) color = "green";
      else if (opt === selected && opt !== correctAnswer) color = "red";
      else if (opt === correctAnswer) color = "yellow";

      ring(cx, cy, radius, color, 2);
    }
      */
  }
  this.gradingResults = this.gradeDetectedAnswers(this.detectedAnswers);
  
  this.score =
      this.gradingResults.filter(
          g => g.status === "Correct"
      ).length;

  this.total =
      this.gradingResults.length;
      this.scheduleScanOverlayRender();

  // Finalize score
  this.studentPercentage = this.total > 0 ? (this.score / this.total) * 100 : 0;
  this.hasResults = true;

  const tosMap = LocalDataService.generateTOSMap(tosRows);

  this.results = this.gradingResults.map(g => {

      const mapEntry = tosMap[g.questionNumber - 1];

      return {
          question: g.questionNumber,
          marked: g.detectedAnswer as Option | null,
          correctAnswer: (g.correctAnswer || null) as Option | null,
          correct: g.status === "Correct",

          topic: mapEntry?.topic ?? null,
          competency: mapEntry?.competency ?? null,
          level: mapEntry?.level ?? null
      };

  });

  // ✅ Convert canvas to DataURL
  let warpedDataUrl = "";
  try {
    warpedDataUrl = canvas.toDataURL("image/jpeg", 0.7);
  } catch (e) {
    console.error("⚠️ Failed to export warpedDataUrl:", e);
  }

  const headerBase64 = this.croppedHeaderBase64 ?? "";

  const answerDistribution = this.results.reduce(
    (acc, a) => {
      if (a.marked) acc[a.marked] = (acc[a.marked] || 0) + 1;
      return acc;
    },
    { A: 0, B: 0, C: 0, D: 0 }
  );

  const cognitiveBreakdown = this.results.reduce((acc, a) => {
    const lvl = a.level || "N/A";
    if (!acc[lvl]) acc[lvl] = { correct: 0, total: 0 };
    acc[lvl].total++;
    if (a.correct) acc[lvl].correct++;
    return acc;
  }, {} as Record<string, { correct: number; total: number }>);
/*
  const result: ScannedResult = {
    id: Date.now(),
    headerImage: headerBase64,
    fullImage: warpedDataUrl,

    answers: this.results,

    score: this.score,
    total: this.gradingResults.length,

    subjectId: this.subjectId,
    classId: this.classId,

    timestamp: new Date().toISOString(),

    answerDistribution,
    cognitiveBreakdown,

    tosRows
};
*/
  this.lastCapturedImageData = warpedDataUrl;
  this.croppedHeaderBase64 = headerBase64;
  kernel.delete();
  //await this.handleScanComplete(result);
  //return result;
  //alert("processSheet finished");
  return;
}
/*
renderAnswerDistributionChart() {
  if (this.chart) {
    this.chart.destroy();
  }
  const questions = Object.keys(this.detectedAnswers).sort((a, b) => +a - +b);
  const answerOptions = ['A', 'B', 'C', 'D'];
  const colors = ['#f44336', '#2196f3', '#4caf50', '#ffeb3b'];

  const answerCounts = questions.map(q => {
    const answer = this.detectedAnswers[q];
    return answerOptions.map(opt => (answer === opt ? 1 : 0));
  });

  const datasets = answerOptions.map((option, idx) => ({
    label: `Option ${option}`,
    data: answerCounts.map(counts => counts[idx]),
    backgroundColor: colors[idx],
  }));

  const ctx = document.getElementById('answersChart') as HTMLCanvasElement;
  if (!ctx) return;

  this.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: questions.map(q => `Q${q}`),
      datasets: datasets,
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Answer Distribution (Scanned Sheet)',
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          title: { display: true, text: 'Selections' },
        },
        x: {
          title: { display: true, text: 'Questions' },
        },
      },
    },
  });
}

processResultsAndShowChart() {
  this.renderAnswerDistributionChart();
  }
  */
private gradeDetectedAnswers(
  detectedAnswers: Record<number, Option | null>
): GradingResult[] {

  const results: GradingResult[] = [];

  const answerKey = Array.isArray(this.answerKey)
    ? this.answerKey
    : [];

  const totalQuestions =
    Math.min(this.total, answerKey.length);

  for (let i = 0; i < totalQuestions; i++) {

    const questionNumber = i + 1;

    const detected = detectedAnswers[questionNumber] ?? null;

    const correct = this.normalizeKey(answerKey[i]);

let status: GradingResult["status"];

if (!detected) {

    status = "Blank";

}
else if (!correct) {

    status = "Invalid";

}
else if (detected === correct) {

    status = "Correct";

}
else {

    status = "Incorrect";

}

    results.push({
      questionNumber,
      detectedAnswer: detected,
      correctAnswer: correct,
      status
    });
  }

  return results;
}
  private normalizeKey(v: any): string {
    const s = String(v || '').trim().toUpperCase();
    return ['A', 'B', 'C', 'D'].includes(s) ? s : '';
  }
}
