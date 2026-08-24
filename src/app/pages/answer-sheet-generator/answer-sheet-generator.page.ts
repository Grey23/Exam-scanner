import { Component, OnInit, Input } from '@angular/core';
import { NavController, ToastController, LoadingController, IonicModule, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LocalDataService, TopicEntry } from '../../services/local-data.service';
import { ActivatedRoute } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import jsPDF from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { FileOpener } from '@capacitor-community/file-opener';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { TeacherService, ClassStudent } from '../../services/teacher.service';
import { bubbles, BubbleTemplate } from '../../data/bubble-template';
import html2canvas from 'html2canvas';


@Component({
  selector: 'app-answer-sheet-generator',
  templateUrl: './answer-sheet-generator.page.html',
  styleUrls: ['./answer-sheet-generator.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AnswerSheetGeneratorPage implements OnInit {

  @Input() classId!: number;
  @Input() subjectId!: number;
  @Input() embedded: boolean = false;
  @Input() totalQuestionsInput?: number;

  tos: TopicEntry[] = [];
  questions: any[] = [];
  totalQuestions = 0;
  className = '';
  subjectName = '';
  pdfContent: string | null = null;

  students: ClassStudent[] = [];
  selectedStudentId: number | 'all' = 'all';
  currentStudentName: string = '';
  currentStudentRollNumber: string = '';
  private currentStudentId: number | null = null;

  // Small binary grid code (8x8) for student identity
  private readonly CODE_GRID_SIZE = 8;
  private readonly CODE_CELL_SIZE = 6; // template pixels

  private studentCodeGridCacheKey = '';
  private studentCodeGridCacheValue: number[][] | null = null;

  private readonly EXPORT_CANVAS_TIMEOUT_MS = 15000;
  private readonly EXPORT_PDF_TIMEOUT_MS = 45000;

  isExporting = false;

  constructor(
    private route: ActivatedRoute,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private teacherService: TeacherService
  ) {}
  getX(index: number): number {
    const group = Math.floor(index / 10);
    const colWidth = 200;
    const col = group % 3;
    return 120 + col * colWidth;
  }

  getY(index: number): number {
    const group = Math.floor(index / 10);
    const row = index % 10;
    const rowHeight = 30; // tighter rows
    return group < 3 ? 185 + row * rowHeight : 505 + row * rowHeight;
  }

  private async presentAlert(message: string, header = '') {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }

  private async presentConfirm(message: string, header = ''): Promise<boolean> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Continue', role: 'confirm' },
      ],
    });
    await alert.present();
    const res = await alert.onDidDismiss();
    return res.role === 'confirm';
  }

  private computeTotalQuestionsFromTos(tos: TopicEntry[]): number {
    const cognitiveLevels: (keyof TopicEntry)[] = [
      'remembering',
      'understanding',
      'applying',
      'analyzing',
      'evaluating',
      'creating',
    ];
    return (tos || []).reduce((sum, row) => {
      return (
        sum +
        cognitiveLevels.reduce((s, level) => s + Number((row as any)?.[level] || 0), 0)
      );
    }, 0);
  }

  private async resolveClassAndSubjectNames() {
    // Prefer local cache first
    const cls = LocalDataService.getClass(this.classId);
    if (cls?.name) this.className = String(cls.name);

    const localSubject = LocalDataService.getSubject(this.classId, this.subjectId);
    if (localSubject?.name) this.subjectName = String(localSubject.name);

    // If names are missing (fresh install / not cached), pull from Firebase in parallel
    const needClass = !this.className;
    const needSubject = !this.subjectName;
    if (needClass || needSubject) {
      const [classesRes, subjectsRes] = await Promise.all([
        needClass ? this.teacherService.getClasses().catch(e => { console.error('resolveClassAndSubjectNames: classes', e); return []; }) : Promise.resolve([]),
        needSubject ? this.teacherService.getClassSubjects(this.classId).catch(e => { console.error('resolveClassAndSubjectNames: subjects', e); return []; }) : Promise.resolve([])
      ]);
      if (needClass && Array.isArray(classesRes)) {
        const c = classesRes.find((k: any) => Number(k?.id) === Number(this.classId));
        if (c?.name) this.className = String(c.name);
      }
      if (needSubject && Array.isArray(subjectsRes)) {
        const s = subjectsRes.find((k: any) => Number(k?.id) === Number(this.subjectId));
        if (s?.name) this.subjectName = String(s.name);
      }
    }
  }

  async ngOnInit() {

    await LocalDataService.load();

    // This component is used in two ways:
    // 1) Embedded inside TOS page via @Input() classId/subjectId
    // 2) Standalone route /answer-sheet-generator/:classId/:subjectId
    // Only use route params if Inputs aren't provided.
    if (!Number.isFinite(Number(this.classId)) || Number(this.classId) <= 0) {
      this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    }
    if (!Number.isFinite(Number(this.subjectId)) || Number(this.subjectId) <= 0) {
      this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));
    }

    if (!Number.isFinite(this.classId) || !Number.isFinite(this.subjectId)) {
      await this.presentAlert('Missing class/subject. Please open this from your Class and Subject list.');
      return;
    }

    await this.resolveClassAndSubjectNames();

    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    this.tos = subject?.tos || [];
    this.questions = Array.isArray(subject?.questions) ? (subject?.questions as any[]) : [];
    const needQuestions = !this.questions.length;

    const [studentsList, qRes] = await Promise.all([
      this.teacherService.getSubjectStudentsForClass(this.classId, this.subjectId),
      needQuestions ? this.teacherService.loadSubjectQuestions(this.classId, this.subjectId) : Promise.resolve({ success: false, questions: [] })
    ]);
    this.students = Array.isArray(studentsList) ? studentsList : [];

    if (needQuestions && qRes.success && Array.isArray(qRes.questions) && qRes.questions.length) {
      this.questions = qRes.questions;
      if (subject) {
        subject.questions = this.questions;
        void LocalDataService.save();
      }
    }

    this.selectedStudentId = 'all';
    this.applySelectedStudent();

    // Use passed input if available (for embedded mode with live TOS updates)
    if (this.totalQuestionsInput != null && this.totalQuestionsInput > 0) {
      this.totalQuestions = this.totalQuestionsInput;
    } else {
      const tosTotal = this.computeTotalQuestionsFromTos(this.tos);
      const qTotal = Array.isArray(this.questions) ? this.questions.length : 0;
      this.totalQuestions = qTotal > 0 ? qTotal : tosTotal;
    }

    if (this.totalQuestions > bubbles.length) {
      await this.presentAlert(
        `This answer sheet template supports up to ${bubbles.length} questions. Your current total is ${this.totalQuestions}. Please reduce the total questions in TOS/Question Generator or expand the template.`,
        'Too many questions'
      );
      this.totalQuestions = bubbles.length;
    }
  }

  applySelectedStudent() {
    if (this.selectedStudentId === 'all') {
      this.currentStudentName = '';
      this.currentStudentRollNumber = '';
      return;
    }

    const idNum = Number(this.selectedStudentId);
    const st = (this.students || []).find(s => Number(s.id) === idNum);
    this.currentStudentName = st ? String(st.name || '') : '';
    this.currentStudentRollNumber = st ? String(st.roll_number || '') : '';
    this.currentStudentId = st ? Number(st.id) : null;
  }

  get selectedStudentLabel(): string {
    if (this.selectedStudentId === 'all') return 'All Students';
    const idNum = Number(this.selectedStudentId);
    const st = (this.students || []).find(s => Number(s.id) === idNum);
    if (!st) return 'Selected Student';
    const roll = st.roll_number ? ` (${st.roll_number})` : '';
    return `${st.name}${roll}`;
  }

  get displayQuestions(): any[] {
    const list = Array.isArray(this.questions) ? this.questions : [];
    if (list.length) return list;
    // fallback: generate blank placeholders if questions aren't available
    return new Array(this.totalQuestions).fill(null).map(() => ({
      question: '',
      choices: { A: '', B: '', C: '', D: '' },
    }));
  }

  get exportBubbles(): BubbleTemplate[] {
    const max = Math.min(Number(this.totalQuestions || 0), bubbles.length);
    return bubbles.filter((b) => b.question <= max);
  }

  /**
   * Build an 8x8 binary grid encoding (classId, subjectId, studentId).
   * We only need this for the currently rendered student/page.
   */
  get studentCodeGrid(): number[][] {
    if (!this.currentStudentId) return [];

    const cacheKey = `${Number(this.classId || 0)}-${Number(this.subjectId || 0)}-${Number(this.currentStudentId || 0)}`;
    if (this.studentCodeGridCacheValue && this.studentCodeGridCacheKey === cacheKey) {
      return this.studentCodeGridCacheValue;
    }

    const size = this.CODE_GRID_SIZE;
    const grid: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

    // Simple finder border (row 0 and col 0 set to 1)
    for (let i = 0; i < size; i++) {
      grid[0][i] = 1;
      grid[i][0] = 1;
    }

    const classPart = Number(this.classId || 0) & 0xffff;
    const subjectPart = Number(this.subjectId || 0) & 0xffff;
    const studentPart = Number(this.currentStudentId || 0) & 0xffff;

    const bits: number[] = [];
    const pushBits = (value: number) => {
      for (let i = 15; i >= 0; i--) {
        bits.push(((value >> i) & 1) ? 1 : 0);
      }
    };

    pushBits(classPart);
    pushBits(subjectPart);
    pushBits(studentPart);

    // Fill inner 7x7 area (rows 1..7, cols 1..7) row-major
    let idx = 0;
    for (let r = 1; r < size; r++) {
      for (let c = 1; c < size; c++) {
        if (idx < bits.length) {
          grid[r][c] = bits[idx++];
        } else {
          grid[r][c] = 0;
        }
      }
    }

    this.studentCodeGridCacheKey = cacheKey;
    this.studentCodeGridCacheValue = grid;
    return grid;
  }

  private svgElementToCanvas(
    svgEl: SVGElement,
    width: number,
    height: number,
    scale: number
  ): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      let timer: any;
      try {
        const xml = new XMLSerializer().serializeToString(svgEl);
        const svg = xml.includes('xmlns=') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const img = new Image();
        img.decoding = 'async';
        img.crossOrigin = 'anonymous';

        timer = setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch {}
          reject(new Error('Timed out while rendering answer sheet (SVG -> Canvas).'));
        }, this.EXPORT_CANVAS_TIMEOUT_MS);

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context missing');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.drawImage(img, 0, 0, width, height);

            clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolve(canvas);
          } catch (e) {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            reject(e);
          }
        };
        img.onerror = (e) => {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          reject(e);
        };
        img.src = url;
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  private async buildPdfFromSvgForStudents(svgEl: SVGElement, studentsToExport: ClassStudent[]) {

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const waitFrames = async (frames: number) => {
      for (let i = 0; i < frames; i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
    };

    const cloneSvgForExport = (src: SVGElement): SVGElement => {
      const clone = src.cloneNode(true) as SVGElement;
      // Ensure the clone has required namespace
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      return clone;
    };

    const setSvgText = (root: SVGElement, id: string, value: string) => {
      const el = root.querySelector(`#${CSS.escape(id)}`);
      if (!el) return;
      el.textContent = value;
    };

    for (let i = 0; i < studentsToExport.length; i++) {

      const st = studentsToExport[i];
      this.currentStudentName = String(st?.name || '');
      this.currentStudentRollNumber = String(st?.roll_number || '');
      this.currentStudentId = Number(st?.id || 0);

      // Let Angular update the SVG bindings (text nodes inside SVG)
      await waitFrames(2);

      // Yield to UI thread before heavy PDF work
      await new Promise((r) => setTimeout(r, 0));

      if (i > 0) pdf.addPage();

      const svgForThisStudent = cloneSvgForExport(svgEl);

      setSvgText(svgForThisStudent, 'student-name', this.currentStudentName || '');
      setSvgText(svgForThisStudent, 'student-roll', this.currentStudentRollNumber || '');

      try {
        const vectorPromise = svg2pdf(svgForThisStudent, pdf, {
          xOffset: 0,
          yOffset: 0,
          scale: 1,
          width: pageWidth,
          height: pageHeight,
        } as any);

        await Promise.race([
          vectorPromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out while generating PDF (SVG -> PDF).')), this.EXPORT_PDF_TIMEOUT_MS))
        ]);
      } catch (e) {
        // Fallback to raster (some SVG features may not be supported)
        const isWeb = Capacitor.getPlatform() === 'web';
        const scale = isWeb ? 2 : 1.25;
        const svgWidth = 800;
        const svgHeight = 1131;
        const canvas = await this.svgElementToCanvas(svgForThisStudent, svgWidth, svgHeight, scale);
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const imgProps = pdf.getImageProperties(imgData);
        const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
        const renderWidth = imgProps.width * ratio;
        const renderHeight = imgProps.height * ratio;

        pdf.addImage(imgData, 'JPEG', 0, 0, renderWidth, renderHeight);
      }
    }

    return pdf;
  }
/** 
  async exportPDF() {
    if (this.isExporting) return;
    this.isExporting = true;

    const element = document.getElementById('export-bubble-sheet') as SVGElement | null;
    if (!element) {
      await this.presentAlert('Answer sheet not found.');
      return;
    }

    const roster = Array.isArray(this.students) ? this.students : [];
    let studentsToExport: ClassStudent[] =
      this.selectedStudentId === 'all'
        ? roster
        : roster.filter(s => Number(s.id) === Number(this.selectedStudentId));

    if (this.embedded && this.selectedStudentId === 'all') {
      studentsToExport = roster.slice(0, 1);
    }

    if (!studentsToExport.length) {
      await this.presentAlert('No enrolled students found for this subject. Please enroll students first in Class Students.');
      return;
    }

    if (this.selectedStudentId === 'all' && studentsToExport.length > 1) {
      const ok = await this.presentConfirm(
        `This will generate ${studentsToExport.length} page(s) (one per student). Continue?`,
        'Export All Students'
      );
      if (!ok) return;
    }

    const loading = await this.loadingController.create({
      message: 'Generating PDF...',
      spinner: 'dots',
    });
    await loading.present();

    try {
      const pdf = await Promise.race<jsPDF>([
        this.buildPdfFromSvgForStudents(element, studentsToExport),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out while generating PDF.')), this.EXPORT_PDF_TIMEOUT_MS))
      ]);
      const fileName = `answer-sheet-${this.className}-${this.subjectName}-${Date.now()}.pdf`;

      const isWeb = Capacitor.getPlatform() === 'web';
      if (!isWeb) {
        const pdfBase64 = pdf.output('datauristring').split(',')[1];
        try {
          await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Documents,
          });

          await this.showToast('✅ PDF saved!');

          let shareUrl = '';
          if (Capacitor.getPlatform() === 'android') {
            const fileUri = await Filesystem.getUri({
              path: fileName,
              directory: Directory.Documents,
            });
            shareUrl = fileUri.uri;
          } else if (Capacitor.getPlatform() === 'ios') {
            shareUrl = `data:application/pdf;base64,${pdfBase64}`;
          }

          await Share.share({
            title: 'Generated Answer Sheet',
            text: 'Here is the generated answer sheet.',
            url: shareUrl,
            dialogTitle: 'Share PDF',
          });

          await this.showToast('✅ PDF shared!');
        } catch (err) {
          console.error('PDF save/share failed:', err);
          const msg = String((err as any)?.message || err);
          await this.presentAlert('PDF export/share failed: ' + msg);
        }
      } else {
        const blobUrl = pdf.output('bloburl').toString();
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.open(blobUrl, '_blank');
        await this.showToast('✅ PDF downloaded and opened!');
      }
    } catch (error) {
      console.error('Export error:', error);
      const msg = String((error as any)?.message || error);
      await this.presentAlert('Failed to export or share PDF: ' + msg);
    } finally {
      this.applySelectedStudent();
      await loading.dismiss();
      this.isExporting = false;
    }
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color: 'dark',
    });
    await toast.present();
  }
    */
async exportPDF() {
  if (this.isExporting) return;

  this.isExporting = true;

  const loading = await this.loadingController.create({
    message: 'Generating PDF...',
    spinner: 'dots',
  });

  await loading.present();

  try {
    const element = document.getElementById('answer-sheet-container');

    if (!element) {
      throw new Error('Answer sheet not found.');
    }

    const svg = element.querySelector('svg') as SVGSVGElement | null;

    if (!svg) {
      throw new Error('Answer sheet SVG not found.');
    }

    // Make sure Angular has finished rendering the current student.
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    await new Promise(resolve => setTimeout(resolve, 100));

    /*
     * Render the SVG directly.
     * This avoids html2canvas having to interpret the SVG/Angular DOM.
     */
    const svgClone = svg.cloneNode(true) as SVGElement;

    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgClone);

    const svgBlob = new Blob(
      [svgString],
      { type: 'image/svg+xml;charset=utf-8' }
    );

    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const img = new Image();

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(
          new Error('Could not render the answer sheet.')
        );
        img.src = svgUrl;
      });

      /*
       * Use the actual SVG dimensions.
       */
      const svgWidth = 850;
      const svgHeight = 1231;

      const canvas = document.createElement('canvas');

      const scale = Capacitor.getPlatform() === 'web' ? 2 : 1.5;

      canvas.width = Math.round(svgWidth * scale);
      canvas.height = Math.round(svgHeight * scale);

      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not create canvas context.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      ctx.drawImage(
        img,
        0,
        0,
        svgWidth,
        svgHeight
      );

      /*
       * Convert rendered sheet to PNG.
       */
      const imgData = canvas.toDataURL('image/png');

      /*
       * Create A4 PDF.
       */
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgProps = pdf.getImageProperties(imgData);

      const imageRatio = imgProps.height / imgProps.width;

      let pdfWidth = pageWidth;
      let pdfHeight = pdfWidth * imageRatio;

      /*
       * Keep the entire answer sheet inside the A4 page.
       */
      if (pdfHeight > pageHeight) {
        pdfHeight = pageHeight;
        pdfWidth = pdfHeight / imageRatio;
      }

      const x = (pageWidth - pdfWidth) / 2;
      const y = (pageHeight - pdfHeight) / 2;

      pdf.addImage(
        imgData,
        'PNG',
        x,
        y,
        pdfWidth,
        pdfHeight
      );

      const fileName =
        `answer-sheet-${this.className || 'class'}-${this.subjectName || 'exam'}-${Date.now()}.pdf`;

      /*
       * ==============================
       * WEB
       * ==============================
       */
      if (Capacitor.getPlatform() === 'web') {

        // jsPDF handles the browser download directly.
        pdf.save(fileName);

        await this.showToast('✅ PDF downloaded successfully.');

        return;
      }

      /*
       * ==============================
       * MOBILE
       * ==============================
       */

      // Get PDF as base64.
      const dataUri = pdf.output('datauristring');

      const pdfBase64 = dataUri.split(',')[1];

      if (!pdfBase64) {
        throw new Error('Could not convert PDF to base64.');
      }

      /*
       * Save into the app's Documents directory.
       */
      await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Documents,
        recursive: true,
      });

      console.log('PDF saved:', fileName);

      /*
       * Get the actual native URI.
       */
      const fileUri = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Documents,
      });

      console.log('PDF URI:', fileUri.uri);

      await this.showToast('✅ PDF saved. Opening share options...');

      /*
       * Share the actual file URI.
       */
      await Share.share({
        title: 'Generated Answer Sheet',
        text: 'Here is the generated answer sheet.',
        url: fileUri.uri,
        dialogTitle: 'Share Answer Sheet',
      });

      await this.showToast('✅ PDF ready to share.');

    } finally {
      URL.revokeObjectURL(svgUrl);
    }

  } catch (error) {

    console.error('=================================');
    console.error('ANSWER SHEET EXPORT ERROR');
    console.error(error);
    console.error('=================================');

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await this.presentAlert(
      `Failed to export answer sheet.\n\n${message}`,
      'Export Error'
    );

  } finally {

    await loading.dismiss();

    this.applySelectedStudent();

    this.isExporting = false;
  }
}
/*
  async exportPDF() {
  const element = document.getElementById('answer-sheet-container');
  if (!element) {
    alert('Answer sheet not found.');
    return;
  }

  const loading = await this.loadingController.create({
    message: 'Generating PDF...',
    spinner: 'dots',
  });
  await loading.present();

  try {
    // ✅ Clone the element so the preview isn't disturbed
    const clone = element.cloneNode(true) as HTMLElement;
    const rect = element.getBoundingClientRect();
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.position = "fixed";
    clone.style.left = "-10000px";
    clone.style.top = "-10000px";
    clone.style.paddingTop = "180px";
    clone.style.zIndex = "-1";
    document.body.appendChild(clone);

    // 📸 Render
    const canvas = await html2canvas(clone, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });

    document.body.removeChild(clone);

    // Convert canvas → PDF
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    const x = 0;
    const y = (pdf.internal.pageSize.getHeight() - pdfHeight) / 2;

    pdf.addImage(imgData, "PNG", x, y, pdfWidth, pdfHeight);

    const fileName = `answer-sheet-${Date.now()}.pdf`;

if (Capacitor.getPlatform() !== 'web') {
  const pdfBase64 = pdf.output('datauristring').split(',')[1];
  try {
    // Step 1: Save file
    const savedFile = await Filesystem.writeFile({
      path: fileName,
      data: pdfBase64,
      directory: Directory.Documents,
    });

    this.showToast('✅ PDF saved!');

    // Step 2: Get sharable URI
    let shareUrl = '';
    if (Capacitor.getPlatform() === 'android') {
      // Android → need content:// URI
      const fileUri = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Documents,
      });
      shareUrl = fileUri.uri; // content:// URI
    } else if (Capacitor.getPlatform() === 'ios') {
      // iOS → can use base64 data URI
      shareUrl = `data:application/pdf;base64,${pdfBase64}`;
    }
  
    // Step 3: Share file
    await Share.share({
      title: 'Generated Answer Sheet',
      text: 'Here is the generated answer sheet.',
      url: shareUrl,
      dialogTitle: 'Share PDF',
    });

    this.showToast('✅ PDF shared!');
  } catch (err) {
    console.error('PDF save/share failed:', err);
    this.showToast('⚠️ PDF saved, but sharing failed.');
  } finally {
    await loading.dismiss();
  } 
}

else {
  // 💻 Browser
  const blobUrl = pdf.output('bloburl').toString();
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  await loading.dismiss();
  window.open(blobUrl, '_blank');
  this.showToast('✅ PDF downloaded and opened!');
}

} catch (error) {
  console.error('Export error:', error);
  await loading.dismiss();
  this.showToast('❌ Failed to export or share PDF.');
}
}
*/
private async showToast(message: string) {
  const toast = await this.toastController.create({
    message,
    duration: 3000,
    position: 'bottom',
    color: 'dark',
  });
  await toast.present();
}
}