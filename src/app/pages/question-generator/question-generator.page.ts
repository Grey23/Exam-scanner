import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule } from '@ionic/angular';
import { LocalDataService, TopicEntry } from '../../services/local-data.service';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../../firebase';
import { TeacherService } from '../../services/teacher.service';

declare const pdfjsLib: any;

@Component({
  selector: 'app-question-generator',
  templateUrl: './question-generator.page.html',
  styleUrls: ['./question-generator.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class QuestionGeneratorPage implements OnInit {
  @ViewChild('pdfInput') pdfInputRef!: ElementRef<HTMLInputElement>;

  classId!: number;
  subjectId!: number;
  className = '';
  subjectName = '';
  tos: TopicEntry[] = [];
  topicOptions: string[] = [];
  selectedTopic = '';
  topicViewMode: 'selected' | 'all' = 'all';
  questions: {
    topic: string;
    competency: string;
    level: string;
    levelSource?: 'ai' | 'teacher';
    question: string;
    choices: { A: string; B: string; C: string; D: string };
    answer: 'A' | 'B' | 'C' | 'D' | '';
    hidden?: boolean;
  }[] = [];

  displayQuestions: {
    topic: string;
    competency: string;
    level: string;
    levelSource?: 'ai' | 'teacher';
    question: string;
    choices: { A: string; B: string; C: string; D: string };
    answer: 'A' | 'B' | 'C' | 'D' | '';
    hidden?: boolean;
  }[] = [];

  isGeneratingAI = false;
  isLoadingTos = false;
  promptText = '';
  isPromptingAI = false;
  isChatOpen = false;
  chatMessages: { role: 'user' | 'gemini'; text: string; ts: number }[] = [];
  isImportingPdf = false;
  pendingPdfFile: File | null = null;
  pendingPdfFileName = '';
  pendingPdfFileSize = '';
  showPdfConfirmation = false;

  constructor(
    private route: ActivatedRoute,
    private teacherService: TeacherService,
    private alertController: AlertController
  ) {}

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
        { text: 'Delete', role: 'confirm' },
      ],
    });
    await alert.present();
    const res = await alert.onDidDismiss();
    return res.role === 'confirm';
  }

  private formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  setPendingPdfFile(file: File | null) {
    this.pendingPdfFile = file;
    this.showPdfConfirmation = !!file;
    this.pendingPdfFileName = file?.name || '';
    this.pendingPdfFileSize = file ? this.formatFileSize(file.size) : '';
  }

  cancelPendingPdfSelection() {
    this.setPendingPdfFile(null);
  }

  async chooseAnotherPdfFile() {
    this.setPendingPdfFile(null);
    setTimeout(() => {
      this.pdfInputRef?.nativeElement?.click();
    }, 0);
  }

  confirmPendingPdfSelection() {
    if (!this.pendingPdfFile) return;
    this.showPdfConfirmation = false;
    void this.generateFromPdf(this.pendingPdfFile);
    this.pendingPdfFile = null;
    this.pendingPdfFileName = '';
    this.pendingPdfFileSize = '';
  }

  private normalizeTosRow(row: any): TopicEntry | null {
    if (!row || typeof row !== 'object') return null;
    const topicName = String((row as any)?.topicName ?? (row as any)?.topic ?? '').trim();
    if (!topicName) return null;
    const learningCompetency = String((row as any)?.learningCompetency ?? (row as any)?.competency ?? '').trim();
    return {
      topicName,
      learningCompetency,
      days: Number((row as any)?.days || 0),
      percent: Number((row as any)?.percent || 0),
      expectedItems: Number((row as any)?.expectedItems || 0),
      remembering: Number((row as any)?.remembering || 0),
      understanding: Number((row as any)?.understanding || 0),
      applying: Number((row as any)?.applying || 0),
      analyzing: Number((row as any)?.analyzing || 0),
      evaluating: Number((row as any)?.evaluating || 0),
      creating: Number((row as any)?.creating || 0),
    };
  }

  private recomputeTopicOptions() {
    this.topicOptions = Array.from(
      new Set((this.tos || []).map((t) => String(t.topicName || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }

async ngOnInit() {
  await LocalDataService.load();

  this.classId =
    Number(this.route.snapshot.paramMap.get('classId'));

  this.subjectId =
    Number(this.route.snapshot.paramMap.get('subjectId'));

  if (
    !Number.isFinite(this.classId) ||
    !Number.isFinite(this.subjectId)
  ) {
    await this.presentAlert(
      'Missing class/subject. Please go back to TOS and open Question Generator again.'
    );
    return;
  }

  // ============================================================
  // 1. LOAD LOCAL CLASS / SUBJECT
  // ============================================================

  const cls =
    LocalDataService.getClass(this.classId);

  const subject =
    LocalDataService.getSubject(
      this.classId,
      this.subjectId
    );

  this.className =
    cls?.name || '';

  this.subjectName =
    subject?.name || '';

  // ============================================================
  // 2. LOAD LOCAL TOS
  // ============================================================

  this.tos =
    (Array.isArray(subject?.tos)
      ? subject.tos
      : []
    )
      .map((r: any) =>
        this.normalizeTosRow(r)
      )
      .filter(Boolean) as TopicEntry[];

  this.recomputeTopicOptions();

  if (
    this.topicOptions.length &&
    !this.topicOptions.includes(this.selectedTopic)
  ) {
    this.selectedTopic =
      this.topicOptions[0];
  }

  // ============================================================
  // 3. LOAD TOS + QUESTIONS FROM FIREBASE
  // ============================================================

  const [
    tosRes,
    qRes
  ] = await Promise.all([
    this.loadTosFromFirebase(),

    this.teacherService.loadSubjectQuestions(
      this.classId,
      this.subjectId
    )
  ]);

  // ============================================================
  // 4. CHECK THAT TOS EXISTS
  // ============================================================

  if (!this.tos.length) {
    await this.presentAlert(
      'No topics found. Please add and Save TOS first, then open Question Generator again.'
    );
    return;
  }

  // ============================================================
  // 5. CALCULATE THE CURRENT TOS TOTAL
  // ============================================================

  const totalPlannedItems =
    this.tos.reduce(
      (sum: number, row: any) => {

        const planned =
          Math.max(
            0,
            Math.floor(
              Number(
                row.expectedItems || 0
              )
            )
          );

        return sum + planned;
      },
      0
    );

  console.log(
    '========================================'
  );

  console.log(
    'QUESTION GENERATOR INITIALIZATION'
  );

  console.log(
    'TOS rows:',
    this.tos
  );

  console.log(
    'TOS planned items:',
    totalPlannedItems
  );

  // ============================================================
  // 6. GET FIREBASE QUESTIONS
  // ============================================================

  const firebaseQuestions =
    qRes.success &&
    Array.isArray(qRes.questions)
      ? qRes.questions as any[]
      : [];

  console.log(
    'Firebase questions:',
    firebaseQuestions.length
  );

  // ============================================================
  // 7. USE FIREBASE QUESTIONS ONLY IF THEIR COUNT MATCHES
  //    THE CURRENT TOS.
  //
  //    Otherwise, rebuild the question slots from the TOS.
  // ============================================================

  if (
    totalPlannedItems > 0 &&
    firebaseQuestions.length === totalPlannedItems
  ) {

    console.log(
      'Firebase question count matches TOS.'
    );

    this.questions =
      firebaseQuestions;

  } else {

    console.log(
      'Firebase question count does NOT match TOS.'
    );

    console.log(
      `Expected ${totalPlannedItems}, ` +
      `but received ${firebaseQuestions.length}.`
    );

    console.log(
      'Rebuilding question slots from TOS...'
    );

    this.generateQuestions();
  }

  // ============================================================
  // 8. SAVE CURRENT QUESTION SLOTS LOCALLY
  // ============================================================

  if (subject) {

    subject.questions =
      this.questions;

    await LocalDataService.save();
  }

  this.refreshDisplayQuestions();

  console.log(
    'Final question count:',
    this.questions.length
  );

  console.log(
    '========================================'
  );
}

  private refreshDisplayQuestions() {
    const selected = String(this.selectedTopic || '').trim();
    // Filter out hidden questions (hidden: true means they should not be shown)
    const visibleQuestions = (this.questions || []).filter((q) => !q?.hidden);
    if (this.topicViewMode === 'selected' && selected) {
      // Filter view only; do NOT mutate original questions.
      this.displayQuestions = visibleQuestions.filter((q) => String(q?.topic || '').trim() === selected);
    } else {
      this.displayQuestions = visibleQuestions;
    }
  }

  private shuffle<T>(arr: T[], seed: number): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.seededInt(seed + i, 0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private makeMathMcq(
    question: string,
    correct: number,
    seed: number,
    variant: 'add' | 'sub' | 'mul' | 'div'
  ): { question: string; choices: { A: string; B: string; C: string; D: string }; answer: 'A' | 'B' | 'C' | 'D' } {
    const distractors = new Set<number>();
    distractors.add(correct);

    const bump = (k: number) => {
      if (variant === 'mul') return correct + k * this.seededInt(seed + k, 1, 6);
      if (variant === 'div') return Math.max(0, correct + k * this.seededInt(seed + k, 1, 4));
      return correct + k * this.seededInt(seed + k, 1, 12);
    };

    let k = 1;
    while (distractors.size < 4) {
      distractors.add(bump(k));
      distractors.add(bump(-k));
      k++;
    }

    const vals = Array.from(distractors).slice(0, 4);
    const shuffled = this.shuffle(vals, seed + 99);
    const correctIndex = shuffled.indexOf(correct);
    const letters = ['A', 'B', 'C', 'D'] as const;
    const answer = letters[Math.max(0, correctIndex)] || 'A';

    const choices = {
      A: String(shuffled[0]),
      B: String(shuffled[1]),
      C: String(shuffled[2]),
      D: String(shuffled[3]),
    };

    return { question, choices, answer };
  }

  private async loadTosFromFirebase() {
    this.isLoadingTos = true;
    try {
      const res = await this.teacherService.loadSubjectTos(this.classId, this.subjectId);
      if (!res.success) {
        await this.presentAlert(res.error || 'Failed to load TOS from Firebase');
        return;
      }

      if (Array.isArray(res.tos)) {
        const local = Array.isArray(this.tos) ? this.tos : [];
        const remote = res.tos
          .map((r: any) => this.normalizeTosRow(r))
          .filter(Boolean) as TopicEntry[];
        const seen = new Set<string>();
        const merged: TopicEntry[] = [];
        for (const row of [...remote, ...local]) {
          const topicName = String((row as any)?.topicName || '').trim();
          const learningCompetency = String((row as any)?.learningCompetency || '').trim();
          const key = `${topicName}|||${learningCompetency}`;
          if (!topicName) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            ...(row as any),
            topicName,
            learningCompetency,
          });
        }

        this.tos = merged;

        this.recomputeTopicOptions();

        if (this.topicOptions.length && !this.topicOptions.includes(this.selectedTopic)) {
          this.selectedTopic = this.topicOptions[0];
        }

        LocalDataService.saveTOS(this.classId, this.subjectId, this.tos);
        await LocalDataService.save();
      }
    } catch (e) {
      console.error(e);
      await this.presentAlert((e as any)?.message || 'Failed to load TOS from Firebase');
    } finally {
      this.isLoadingTos = false;
    }
  }

  onTopicChange() {
    // Only change view. Do not regenerate (would clear existing generated questions).
    this.refreshDisplayQuestions();
  }

  onTopicViewModeChange() {
    // Only change view. Do not regenerate (would clear existing generated questions).
    this.refreshDisplayQuestions();
  }

  private hashSeed(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private seededInt(seed: number, min: number, max: number): number {
    let x = seed >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 0) / 4294967296;
    return Math.floor(r * (max - min + 1)) + min;
  }

  private buildTemplateQuestion(
    topic: string,
    competency: string,
    level: string,
    n: number
  ): { question: string; choices: { A: string; B: string; C: string; D: string }; answer: 'A' | 'B' | 'C' | 'D' | '' } {
    const t = String(topic || '').trim();
    const rawCompetency = String(competency || '').trim();
    const c = rawCompetency && !/^\d+$/.test(rawCompetency) ? rawCompetency : '';
    const l = String(level || '').trim();
    const key = `${t}|${c}|${l}|${n}`;
    const seed = this.hashSeed(key);
    const lower = t.toLowerCase();

    const wantsMultiplication = /multiplication|multiply|times|product/.test(lower);
    const wantsDivision = /division|divide|quotient/.test(lower);
    const wantsAddition = /addition|add|sum/.test(lower);
    const wantsSubtraction = /subtraction|subtract|difference/.test(lower);

    if (wantsMultiplication) {
      const a = this.seededInt(seed, 2, 12);
      const b = this.seededInt(seed + 1, 2, 12);
      const stem = l === 'applying'
        ? `A group has ${a} rows with ${b} items each. How many items are there in all?`
        : `Compute: ${a} × ${b}`;
      return this.makeMathMcq(stem, a * b, seed, 'mul');
    }

    if (wantsDivision) {
      const b = this.seededInt(seed, 2, 12);
      const q = this.seededInt(seed + 1, 2, 12);
      const a = b * q;
      const stem = l === 'applying'
        ? `${a} items are shared equally among ${b} students. How many does each student get?`
        : `Compute: ${a} ÷ ${b}`;
      return this.makeMathMcq(stem, q, seed, 'div');
    }

    if (wantsAddition) {
      const a = this.seededInt(seed, 10, 99);
      const b = this.seededInt(seed + 1, 10, 99);
      const stem = l === 'applying'
        ? `You have ${a} pesos and receive ${b} more. How much money do you have now?`
        : `Compute: ${a} + ${b}`;
      return this.makeMathMcq(stem, a + b, seed, 'add');
    }

    if (wantsSubtraction) {
      const a = this.seededInt(seed, 20, 120);
      const b = this.seededInt(seed + 1, 1, Math.min(99, a - 1));
      const stem = l === 'applying'
        ? `You have ${a} candies and give away ${b}. How many are left?`
        : `Compute: ${a} − ${b}`;
      return this.makeMathMcq(stem, a - b, seed, 'sub');
    }

    const stem = c || t;
    const q =
      l === 'remembering' ? `Define: ${stem}` :
      l === 'understanding' ? `Explain: ${stem}` :
      l === 'applying' ? `Apply the concept of ${stem} in a real-life example.` :
      l === 'analyzing' ? `Analyze the following situation related to ${stem}. What are the key parts and relationships?` :
      l === 'evaluating' ? `Evaluate this statement about ${stem}. Do you agree? Justify your answer.` :
      l === 'creating' ? `Create a short problem or scenario that demonstrates ${stem}.` :
      `${stem}`;

    return {
      question: q,
      choices: { A: '', B: '', C: '', D: '' },
      answer: '',
    };
  }
/*
  generateQuestions() {
    this.questions = [];

    const cognitiveLevels = [
      'remembering',
      'understanding',
      'applying',
      'analyzing',
      'evaluating',
      'creating'
    ];

    const normalizedTos = (Array.isArray(this.tos) ? this.tos : [])
      .map((t) => ({
        ...t,
        topicName: String(t.topicName || '').trim(),
        learningCompetency: String(t.learningCompetency || '').trim(),
      }))
      .filter((t) => !!t.topicName);

    //const selected = String(this.selectedTopic || '').trim();
    //const activeTos = this.topicViewMode === 'selected'
      //? normalizedTos.filter(t => t.topicName === selected)
      //: normalizedTos;

      // Question slots must always represent the complete exam.
    // The topicViewMode is only for displaying/filtering questions,
    // not for determining the total exam question count.
    const activeTos = normalizedTos;

    // To keep question order stable and avoid collisions in seeded generation,
    // number items per (topic, competency, level) group.
    const counters = new Map<string, number>();

    for (const entry of activeTos) {
      for (const level of cognitiveLevels) {
        const count = Number((entry as any)[level] || 0);
        if (!count) continue;
        const key = `${entry.topicName}|||${entry.learningCompetency}|||${level}`;
        const start = counters.get(key) ?? 0;
        for (let j = 1; j <= count; j++) {
          const n = start + j;
          const built = this.buildTemplateQuestion(entry.topicName, entry.learningCompetency, level, n);
          this.questions.push({
            topic: entry.topicName,
            competency: entry.learningCompetency,
            level,
            question: built.question,
            choices: built.choices,
            answer: built.answer,
          });
        }
        counters.set(key, start + count);
      }
    }

    this.refreshDisplayQuestions();
  }
  */
generateQuestions() {
  this.questions = [];

  const cognitiveLevels = [
    'remembering',
    'understanding',
    'applying',
    'analyzing',
    'evaluating',
    'creating'
  ] as const;

  const normalizedTos = (Array.isArray(this.tos) ? this.tos : [])
    .map((t) => ({
      ...t,
      topicName: String(t.topicName || '').trim(),
      learningCompetency: String(t.learningCompetency || '').trim(),
    }))
    .filter((t) => !!t.topicName);

  // IMPORTANT:
  // Question generation is for the COMPLETE exam.
  // Do not use selected-topic filtering here.
  const activeTos = normalizedTos;

  const counters = new Map<string, number>();

  console.log('========================================');
  console.log('GENERATING QUESTION SLOTS FROM TOS');
  console.log('========================================');

  for (const entry of activeTos) {

    // ============================================================
    // 1. PLANNED ITEMS IS THE AUTHORITATIVE QUESTION COUNT
    // ============================================================

    const plannedItems = Math.max(
      0,
      Math.floor(
        Number((entry as any).expectedItems || 0)
      )
    );

    if (plannedItems <= 0) {
      console.warn(
        `Topic "${entry.topicName}" has 0 planned items.`
      );
      continue;
    }

    // ============================================================
    // 2. GET TEACHER-ENTERED BLOOM COUNTS
    // ============================================================

    const bloomCounts = {
      remembering: Math.max(
        0,
        Math.floor(
          Number((entry as any).remembering || 0)
        )
      ),

      understanding: Math.max(
        0,
        Math.floor(
          Number((entry as any).understanding || 0)
        )
      ),

      applying: Math.max(
        0,
        Math.floor(
          Number((entry as any).applying || 0)
        )
      ),

      analyzing: Math.max(
        0,
        Math.floor(
          Number((entry as any).analyzing || 0)
        )
      ),

      evaluating: Math.max(
        0,
        Math.floor(
          Number((entry as any).evaluating || 0)
        )
      ),

      creating: Math.max(
        0,
        Math.floor(
          Number((entry as any).creating || 0)
        )
      )
    };

    const bloomTotal =
      bloomCounts.remembering +
      bloomCounts.understanding +
      bloomCounts.applying +
      bloomCounts.analyzing +
      bloomCounts.evaluating +
      bloomCounts.creating;

    // ============================================================
    // 3. VALIDATE BLOOM TOTAL
    // ============================================================

    if (bloomTotal > plannedItems) {
      console.error(
        `Invalid TOS: "${entry.topicName}" has ` +
        `${bloomTotal} Bloom items but only ` +
        `${plannedItems} planned items.`
      );

      continue;
    }

    const remainingItems =
      plannedItems - bloomTotal;

    console.log(
      `Topic: ${entry.topicName}`
    );

    console.log(
      `Planned: ${plannedItems}`
    );

    console.log(
      `Teacher Bloom: ${bloomTotal}`
    );

    console.log(
      `Unassigned: ${remainingItems}`
    );

    // ============================================================
    // 4. CREATE SLOTS FOR TEACHER-ASSIGNED BLOOM LEVELS
    // ============================================================

    for (const level of cognitiveLevels) {

      const count =
        bloomCounts[level];

      if (count <= 0) {
        continue;
      }

      const key =
        `${entry.topicName}|||` +
        `${entry.learningCompetency}|||` +
        `${level}`;

      const start =
        counters.get(key) || 0;

      for (let j = 1; j <= count; j++) {

        const n =
          start + j;

        const built =
          this.buildTemplateQuestion(
            entry.topicName,
            entry.learningCompetency,
            level,
            n
          );

        this.questions.push({
          topic:
            entry.topicName,

          competency:
            entry.learningCompetency,

          level,

          question:
            built.question,

          choices:
            built.choices,

          answer:
            built.answer
        });
      }

      counters.set(
        key,
        start + count
      );
    }

    // ============================================================
    // 5. CREATE THE REMAINING PLANNED SLOTS
    //
    // These are deliberately UNASSIGNED.
    // AI will decide their Bloom levels later.
    // ============================================================

    for (let j = 0; j < remainingItems; j++) {

      this.questions.push({
        topic:
          entry.topicName,

        competency:
          entry.learningCompetency,

        level:
          'unassigned',

        question:
          `Question ${this.questions.length + 1}`,

        choices: {
          A: '',
          B: '',
          C: '',
          D: ''
        },

        answer:
          ''
      });
    }

    // ============================================================
    // 6. VERIFY THIS TOPIC CREATED EXACTLY PLANNED ITEMS
    // ============================================================

    const topicQuestionCount =
      this.questions.filter(
        (q: any) =>
          q.topic === entry.topicName &&
          q.competency === entry.learningCompetency
      ).length;

    console.log(
      `Generated for "${entry.topicName}": ` +
      `${topicQuestionCount}/${plannedItems}`
    );
  }

  // ============================================================
  // 7. FINAL TOTAL
  // ============================================================

  const totalPlannedItems =
    activeTos.reduce(
      (sum, row: any) =>
        sum +
        Math.max(
          0,
          Math.floor(
            Number(row.expectedItems || 0)
          )
        ),
      0
    );

  console.log('----------------------------------------');

  console.log(
    'TOTAL TOS PLANNED ITEMS:',
    totalPlannedItems
  );

  console.log(
    'TOTAL QUESTION SLOTS GENERATED:',
    this.questions.length
  );

  console.log('----------------------------------------');

  if (
    totalPlannedItems !==
    this.questions.length
  ) {
    console.error(
      `QUESTION SLOT MISMATCH: ` +
      `TOS=${totalPlannedItems}, ` +
      `QUESTIONS=${this.questions.length}`
    );
  }

  console.log('========================================');

  this.refreshDisplayQuestions();
}
async printQuestions() {
  const list = (this.displayQuestions || []).filter(
    (q) => String(q?.question || '').trim()
  );

  if (!list.length) {
    await this.presentAlert('No generated questions to print.');
    return;
  }

  const escapeHtml = (s: any) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const questionsHtml = list.map((q, idx) => {
    const question = escapeHtml(q.question);
    const A = escapeHtml(q.choices?.A);
    const B = escapeHtml(q.choices?.B);
    const C = escapeHtml(q.choices?.C);
    const D = escapeHtml(q.choices?.D);

    return `
      <div class="question">
        <div class="question-text">
          <span class="number">${idx + 1}.</span>
          <span>${question}</span>
        </div>

        <div class="choices">
          <div class="choice">
            <span class="letter">A.</span>
            <span>${A}</span>
          </div>

          <div class="choice">
            <span class="letter">B.</span>
            <span>${B}</span>
          </div>

          <div class="choice">
            <span class="letter">C.</span>
            <span>${C}</span>
          </div>

          <div class="choice">
            <span class="letter">D.</span>
            <span>${D}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        <title>${escapeHtml(this.className)} - ${escapeHtml(this.subjectName)}</title>

        <style>
          @page {
            size: A4;
            margin: 15mm 16mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 0;
            font-family: "Times New Roman", Times, serif;
            color: #000;
            font-size: 10.5pt;
            line-height: 1.2;
          }

          .header {
            text-align: center;
            margin-bottom: 20px;
          }

          .class-name {
            font-size: 16pt;
            font-weight: bold;
            margin-bottom: 2px;
          }

          .subject-name {
            font-size: 14pt;
            font-weight: bold;
            margin-bottom: 18px;
          }

          .directions {
            text-align: left;
            font-size: 11pt;
            margin-bottom: 18px;
          }

          .questions {
            width: 100%;
          }

          .question {
            break-inside: avoid;
            page-break-inside: avoid;
            margin-bottom: 11px;
          }

          .question-text {
            display: flex;
            align-items: flex-start;
            gap: 5px;
            font-size: 10.5pt;
            margin-bottom: 4px;
          }

          .number {
            font-weight: normal;
            flex: 0 0 auto;
          }

          .choices {
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: 14px;
            row-gap: 1px;
            margin-left: 18px;
            font-size: 10pt;
          }

          .choice {
            display: flex;
            align-items: flex-start;
            gap: 4px;
          }

          .letter {
            flex: 0 0 auto;
          }

          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .question {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }
          .brand-logo {
            width: 70px;
            height: 70px;
            object-fit: contain;
            display: block;
            margin: 0 auto 8px auto;
          }
        </style>
      </head>

      <body>
        <div class="header">
        <img
          src="${window.location.origin}/assets/logo/school-logo.jpg"
          alt="School logo"
          class="brand-logo"
        />
          <div class="class-name">
            ${escapeHtml(this.className)}
          </div>

          <div class="subject-name">
            ${escapeHtml(this.subjectName)}
          </div>
        </div>

        <div class="directions">
          <strong>Directions:</strong>
Read each question carefully, choose the best answer, and mark it clearly on your answer sheet.
        </div>

        <div class="questions">
          ${questionsHtml}
        </div>

        <script>
          window.onload = function() {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `;

  const w = window.open('', '_blank');

  if (!w) {
    await this.presentAlert(
      'Popup blocked. Please allow popups to print.'
    );
    return;
  }

  w.document.open();
  w.document.write(html);
  w.document.close();
}
  private normalizeAnswerLetter(v: any): 'A' | 'B' | 'C' | 'D' | '' {
    const s = String(v || '').trim().toUpperCase();
    return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? (s as any) : '';
  }

  async askGemini() {
    if (this.isPromptingAI) return;
    const prompt = String(this.promptText || '').trim();
    if (!prompt) {
      await this.presentAlert('Type your prompt first.');
      return;
    }

    this.chatMessages = [
      ...this.chatMessages,
      { role: 'user', text: prompt, ts: Date.now() },
    ];

    this.isPromptingAI = true;
    try {
      const fn = httpsCallable(
        firebaseFunctions(),
        'generateQuestionsWithAI'
      ) as any;

      const res = await fn({
        mode: 'mcq',
        prompt,
        count: 5,
      });

      const items: any[] = Array.isArray(res?.data?.questions) ? res.data.questions : [];
      const rawTextItems = items.filter((it) => typeof it === 'string').map((it) => String(it));
      const mapped = items
        .map((it) => {
          if (!it || typeof it !== 'object') return null;
          const qText = String(it?.question || '').trim();
          const choices = it?.choices && typeof it.choices === 'object' ? it.choices : {};
          const A = String(choices?.A || '').trim();
          const B = String(choices?.B || '').trim();
          const C = String(choices?.C || '').trim();
          const D = String(choices?.D || '').trim();
          const ans = this.normalizeAnswerLetter(it?.answer);

          if (!qText || !A || !B || !C || !D || !ans) return null;

          return {
            topic: this.selectedTopic,
            competency: '',
            level: 'remembering',
            question: qText,
            choices: { A, B, C, D },
            answer: ans,
          };
        })
        .filter(Boolean) as any[];

      if (!mapped.length) {
        const fallbackText = rawTextItems.length ? rawTextItems.join('\n\n') : 'No questions returned.';
        await this.presentAlert(fallbackText);
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'gemini', text: fallbackText, ts: Date.now() },
        ];
        return;
      }

      this.questions = [...mapped, ...this.questions];
      this.chatMessages = [
        ...this.chatMessages,
        { role: 'gemini', text: `Inserted ${mapped.length} MCQ(s) into your list.`, ts: Date.now() },
      ];
      this.promptText = '';
    } catch (e: any) {
      const code = e?.code ? String(e.code) : '';
      const message = e?.message ? String(e.message) : String(e);
      const details = e?.details ? (typeof e.details === 'string' ? e.details : JSON.stringify(e.details)) : '';

      if (code === 'functions/resource-exhausted') {
        const msg =
          'Gemini quota/rate limit exceeded.\n' +
          'You can still use the locally-generated MCQs for now.\n' +
          'Please wait a bit and try again, or check Gemini API quota/billing.';
        await this.presentAlert(msg);
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'gemini', text: msg, ts: Date.now() },
        ];
      } else {
        const msg = [code, message, details].filter(Boolean).join('\n');
        await this.presentAlert(msg);
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'gemini', text: msg, ts: Date.now() },
        ];
      }
    } finally {
      this.isPromptingAI = false;
    }
  }
/*
  async generateWithAI() {
    if (this.isGeneratingAI) return;

    if (!this.questions.length) {
      await this.presentAlert('No questions to generate.');
      return;
    }

    this.isGeneratingAI = true;
    try {
      const fn = httpsCallable(
        firebaseFunctions(),
        'generateQuestionsWithAI'
      ) as any;

      const groups = new Map<string, number[]>();
      for (let i = 0; i < this.questions.length; i++) {
        const q = this.questions[i];
        const key = `${q.topic}|||${q.competency}|||${q.level}`;
        const arr = groups.get(key);
        if (arr) {
          arr.push(i);
        } else {
          groups.set(key, [i]);
        }
      }

      for (const [key, indexes] of groups.entries()) {
        const [topic, competency, cognitiveLevel] = key.split('|||');
        const count = indexes.length;

        const res = await fn({
          topic,
          competency,
          cognitiveLevel,
          count,
          mode: 'mcq',
        });

        const items: any[] = Array.isArray(res?.data?.questions) ? res.data.questions : [];
        for (let j = 0; j < indexes.length; j++) {
          const idx = indexes[j];
          const it = items[j];
          if (it && typeof it === 'object') {
            const qText = String(it.question || '').trim();
            const choices = it.choices && typeof it.choices === 'object' ? it.choices : {};
            const A = String(choices.A || '').trim();
            const B = String(choices.B || '').trim();
            const C = String(choices.C || '').trim();
            const D = String(choices.D || '').trim();
            const ans = this.normalizeAnswerLetter(it.answer);

            if (qText) this.questions[idx].question = qText;
            this.questions[idx].choices = { A, B, C, D };
            this.questions[idx].answer = ans;
          }
        }
      }
    } catch (e: any) {
      const code = e?.code ? String(e.code) : '';
      const message = e?.message ? String(e.message) : String(e);
      const details = e?.details ? (typeof e.details === 'string' ? e.details : JSON.stringify(e.details)) : '';

      if (code === 'functions/resource-exhausted') {
        await this.presentAlert(
          'Gemini quota/rate limit exceeded.\n' +
          'Keeping your current (template) MCQs.\n' +
          'Please wait a bit and try again, or check Gemini API quota/billing.'
        );
      } else {
        await this.presentAlert([code, message, details].filter(Boolean).join('\n'));
      }
    } finally {
      this.isGeneratingAI = false;
    }
  }
    */
async generateWithAI() {
  if (this.isGeneratingAI) return;

  if (!this.questions.length) {
    await this.presentAlert('No questions to generate.');
    return;
  }

  this.isGeneratingAI = true;

  try {
    const fn = httpsCallable(
      firebaseFunctions(),
      'generateQuestionsWithAI'
    ) as any;

    // ============================================================
    // 1. BUILD THE BLOOM INFORMATION FROM THE TOS
    // ============================================================

    const cognitiveLevels = [
      'remembering',
      'understanding',
      'applying',
      'analyzing',
      'evaluating',
      'creating'
    ] as const;

    const bloomByTopic = new Map<string, {
      topic: string;
      competency: string;
      plannedItems: number;
      existingBloom: {
        remembering: number;
        understanding: number;
        applying: number;
        analyzing: number;
        evaluating: number;
        creating: number;
      };
      bloomTotal: number;
      remainingItems: number;
    }>();

    for (const row of this.tos || []) {
      const topic = String(row.topicName || '').trim();

      if (!topic) continue;

      const competency =
        String(row.learningCompetency || '').trim();

      const plannedItems =
        Math.max(
          0,
          Math.floor(
            Number(row.expectedItems || 0)
          )
        );

      const existingBloom = {
        remembering: Math.max(
          0,
          Math.floor(
            Number(row.remembering || 0)
          )
        ),

        understanding: Math.max(
          0,
          Math.floor(
            Number(row.understanding || 0)
          )
        ),

        applying: Math.max(
          0,
          Math.floor(
            Number(row.applying || 0)
          )
        ),

        analyzing: Math.max(
          0,
          Math.floor(
            Number(row.analyzing || 0)
          )
        ),

        evaluating: Math.max(
          0,
          Math.floor(
            Number(row.evaluating || 0)
          )
        ),

        creating: Math.max(
          0,
          Math.floor(
            Number(row.creating || 0)
          )
        )
      };

      const bloomTotal =
        existingBloom.remembering +
        existingBloom.understanding +
        existingBloom.applying +
        existingBloom.analyzing +
        existingBloom.evaluating +
        existingBloom.creating;

      const remainingItems =
        plannedItems - bloomTotal;

      // ----------------------------------------------------------
      // Do not silently fix an invalid TOS.
      // ----------------------------------------------------------

      if (remainingItems < 0) {
        throw new Error(
          `Topic "${topic}" has ${bloomTotal} Bloom items, ` +
          `but only ${plannedItems} planned items. ` +
          `Please reduce the Bloom counts before generating questions.`
        );
      }

      const key =
        `${topic}|||${competency}`;

      bloomByTopic.set(key, {
        topic,
        competency,
        plannedItems,
        existingBloom,
        bloomTotal,
        remainingItems
      });
    }

    // ============================================================
    // 2. CHECK THAT QUESTION COUNT MATCHES THE TOS
    // ============================================================

    let totalPlannedItems = 0;

    for (const item of bloomByTopic.values()) {
      totalPlannedItems += item.plannedItems;
    }

    if (
      totalPlannedItems > 0 &&
      this.questions.length !== totalPlannedItems
    ) {
      await this.presentAlert(
        `Your TOS plans ${totalPlannedItems} items, ` +
        `but the Question Generator currently has ${this.questions.length} questions.\n\n` +
        `Please generate the question slots again before using AI.`
      );

      return;
    }

    // ============================================================
    // 3. BUILD THE COMPLETE BLOOM INFORMATION FOR GEMINI
    // ============================================================

    const bloomPlan = Array.from(
      bloomByTopic.values()
    ).map(item => ({
      topic: item.topic,
      competency: item.competency,
      plannedItems: item.plannedItems,

      existingBloom: item.existingBloom,

      bloomTotal: item.bloomTotal,

      remainingItems: item.remainingItems
    }));

    // ============================================================
    // 4. SEND ALL QUESTIONS IN ONE GEMINI REQUEST
    // ============================================================

    const request = {
      mode: 'mcq',

      // Tell the backend that this is a complete exam-generation
      // request rather than a single cognitive-level group.
      examMode: true,

      // Total number of questions currently prepared.
      count: this.questions.length,

      // Send the TOS/Bloom information.
      bloomPlan,

      // Send the existing template questions so Gemini knows
      // exactly which questions it needs to replace.
      questions: this.questions.map(
        (q: any, index: number) => ({
          index,

          topic:
            String(q.topic || '').trim(),

          competency:
            String(q.competency || '').trim(),

          level:
            String(q.level || '').trim(),

          question:
            String(q.question || '').trim()
        })
      )
    };

    console.log(
      '=== AI EXAM GENERATION REQUEST ==='
    );

    console.log(
      'Question count:',
      this.questions.length
    );

    console.log(
      'Bloom plan:',
      bloomPlan
    );

    // ============================================================
    // 5. ONE CALL TO FIREBASE / GEMINI
    // ============================================================

    const res = await fn(request);

    console.log(
      '=== AI EXAM GENERATION RESPONSE ===',
      res?.data
    );

    const data =
      res?.data || {};

    // ============================================================
    // 6. APPLY AI BLOOM SUGGESTIONS
    // ============================================================

    const bloomSuggestions =
      Array.isArray(data?.bloomSuggestions)
        ? data.bloomSuggestions
        : [];

    for (const suggestion of bloomSuggestions) {

      const topic =
        String(
          suggestion?.topic || ''
        ).trim();

      const competency =
        String(
          suggestion?.competency || ''
        ).trim();

      const key =
        `${topic}|||${competency}`;

      const target =
        bloomByTopic.get(key);

      if (!target) {
        console.warn(
          'AI returned Bloom suggestion for unknown topic:',
          suggestion
        );

        continue;
      }

      const suggestionBloom = {
        remembering: Number(
          suggestion?.bloom?.remembering || 0
        ),

        understanding: Number(
          suggestion?.bloom?.understanding || 0
        ),

        applying: Number(
          suggestion?.bloom?.applying || 0
        ),

        analyzing: Number(
          suggestion?.bloom?.analyzing || 0
        ),

        evaluating: Number(
          suggestion?.bloom?.evaluating || 0
        ),

        creating: Number(
          suggestion?.bloom?.creating || 0
        )
      };

      const suggestionTotal =
        suggestionBloom.remembering +
        suggestionBloom.understanding +
        suggestionBloom.applying +
        suggestionBloom.analyzing +
        suggestionBloom.evaluating +
        suggestionBloom.creating;

      // ----------------------------------------------------------
      // Validate the AI suggestion on the frontend too.
      // ----------------------------------------------------------

      if (
        suggestionTotal !==
        target.remainingItems
      ) {
        throw new Error(
          `AI Bloom suggestion for "${topic}" ` +
          `contains ${suggestionTotal} items, ` +
          `but ${target.remainingItems} were required.`
        );
      }

      // ----------------------------------------------------------
      // IMPORTANT:
      // Add the AI values to the teacher's existing values.
      // Never replace them.
      // ----------------------------------------------------------

      const tosRow =
        (this.tos || []).find(
          (row: any) =>
            String(row.topicName || '').trim() === topic &&
            String(row.learningCompetency || '').trim() === competency
        );

      if (!tosRow) {
        console.warn(
          'Could not find TOS row for AI Bloom suggestion:',
          suggestion
        );

        continue;
      }

      for (const level of cognitiveLevels) {

        const existingValue =
          Number(
            (tosRow as any)[level] || 0
          );

        const aiValue =
          Number(
            (suggestionBloom as any)[level] || 0
          );

        (tosRow as any)[level] =
          existingValue + aiValue;
      }
    }

    // ============================================================
    // 7. APPLY GENERATED QUESTIONS
    // ============================================================

    const generatedQuestions =
      Array.isArray(data?.questions)
        ? data.questions
        : [];

    if (!generatedQuestions.length) {
      throw new Error(
        'Gemini did not return any questions.'
      );
    }

    for (
      let i = 0;
      i < this.questions.length;
      i++
    ) {

      const generated =
        generatedQuestions[i];

      if (
        !generated ||
        typeof generated !== 'object'
      ) {
        continue;
      }

      const qText =
        String(
          generated.question || ''
        ).trim();

      const choices =
        generated.choices &&
        typeof generated.choices === 'object'
          ? generated.choices
          : {};

      const A =
        String(
          choices.A || ''
        ).trim();

      const B =
        String(
          choices.B || ''
        ).trim();

      const C =
        String(
          choices.C || ''
        ).trim();

      const D =
        String(
          choices.D || ''
        ).trim();

      const answer =
        this.normalizeAnswerLetter(
          generated.answer
        );

            if (qText) {
        this.questions[i].question = qText;
      }

      this.questions[i].choices = {
        A,
        B,
        C,
        D
      };

      this.questions[i].answer = answer;

      // =========================================================
      // APPLY THE BLOOM LEVEL RETURNED BY GEMINI
      // =========================================================

      const currentLevel = String(
        this.questions[i].level || ''
      )
        .trim()
        .toLowerCase();

      const aiLevel = String(
        generated.level || ''
      )
        .trim()
        .toLowerCase();

      const unassignedValues = [
        '',
        'unassigned',
        'pending',
        'not assigned'
      ];

      const wasUnassigned =
        unassignedValues.includes(currentLevel);

      // Only AI-fill levels that were previously unassigned.
      // Preserve any Bloom level already assigned by the teacher.
      if (wasUnassigned) {

        const assignedLevel = cognitiveLevels.find(
          level => level === aiLevel
        );

        if (!assignedLevel) {
          throw new Error(
            `Gemini did not return a valid Bloom level for question ${i + 1}. ` +
            `Received: "${generated.level || 'empty'}".`
          );
        }

        // Update the question's actual Bloom level.
        this.questions[i].level = assignedLevel;

        // Mark that the level was assigned by AI.
        this.questions[i].levelSource = 'ai';
      }
    // ============================================================
    // 8. REFRESH THE QUESTION DISPLAY
    // ============================================================

    this.refreshDisplayQuestions();

    console.log(
      '=== AI GENERATION COMPLETE ==='
    );

    console.log(
      'Final TOS:',
      this.tos
    );

    console.log(
      'Final question count:',
      this.questions.length
    );
  }
  } catch (e: any) {

    console.error(
      'AI generation failed:',
      e
    );

    const code =
      e?.code
        ? String(e.code)
        : '';

    const message =
      e?.message
        ? String(e.message)
        : String(e);

    const details =
      e?.details
        ? (
            typeof e.details === 'string'
              ? e.details
              : JSON.stringify(e.details)
          )
        : '';

    if (
      code ===
      'functions/resource-exhausted'
    ) {

      await this.presentAlert(
        'Gemini quota/rate limit exceeded.\n\n' +
        'Your current questions were kept.\n' +
        'Please wait and try again, or check your Gemini API quota/billing.'
      );

    } else {

      await this.presentAlert(
        [code, message, details]
          .filter(Boolean)
          .join('\n')
      );
    }

  } finally {

    this.isGeneratingAI = false;
  }
}
  async onPdfFileSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files && input.files.length ? input.files[0] : null;
    if (!file) {
      return;
    }

    // Reset the input so the same file can be selected again if needed.
    if (input) {
      input.value = '';
    }

    if (!file.type || !file.type.includes('pdf')) {
      await this.presentAlert('Please select a PDF file.');
      return;
    }

    this.setPendingPdfFile(file);
  }

  private async generateFromPdf(file: File) {
    if (this.isImportingPdf) return;

    if (!file.type || !file.type.includes('pdf')) {
      await this.presentAlert('Please select a PDF file.');
      return;
    }

    if (typeof pdfjsLib === 'undefined' || !pdfjsLib || !pdfjsLib.getDocument) {
      await this.presentAlert(
        'PDF engine not loaded. Please check your internet connection and reload the app.'
      );
      return;
    }

    this.isImportingPdf = true;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      const maxPages = Math.min(pdf.numPages || 0, 10);
      let fullText = '';

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = (textContent.items || [])
          .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
          .join(' ');
        fullText += '\n\n' + pageText;
      }

      const cleaned = fullText.replace(/\s+/g, ' ').trim();
      if (!cleaned) {
        await this.presentAlert('Could not read any text from the PDF.');
        return;
      }

      const snippet = cleaned.slice(0, 8000);
      const fn = httpsCallable(
        firebaseFunctions(),
        'generateQuestionsWithAI'
      ) as any;

      // Determine which existing questions are "blank" and should be filled.
      // We treat a question as blank if it has **no correct answer set yet**
      // (answer letter missing/invalid), regardless of placeholder question text.
      const selectedTopicTrimmed = String(this.selectedTopic || '').trim();
      const blankIndexes: number[] = [];
      for (let i = 0; i < this.questions.length; i++) {
        const q = this.questions[i];
        const isInScope =
          this.topicViewMode === 'selected' && selectedTopicTrimmed
            ? String(q.topic || '').trim() === selectedTopicTrimmed
            : true;
        const hasAnswer = !!this.normalizeAnswerLetter((q as any).answer);
        if (isInScope && !hasAnswer) {
          blankIndexes.push(i);
        }
      }

      if (!blankIndexes.length) {
        await this.presentAlert(
          'No blank questions to fill. You can clear some questions or regenerate from TOS, then import the PDF again.'
        );
        return;
      }

      const count = blankIndexes.length;
      const res = await fn({
        mode: 'mcq',
        prompt:
          `Use the following lesson content to create ${count} multiple-choice questions (A–D) ` +
          `that are appropriate for the subject "${this.subjectName}" and class "${this.className}". ` +
          `Return structured MCQs with choices A–D and the correct answer letter.\n\n` +
          snippet,
        count,
      });

      const items: any[] = Array.isArray(res?.data?.questions) ? res.data.questions : [];
      const mapped = items
        .map((it) => {
          if (!it || typeof it !== 'object') return null;
          const qText = String(it?.question || '').trim();
          const choices = it?.choices && typeof it.choices === 'object' ? it.choices : {};
          const A = String(choices?.A || '').trim();
          const B = String(choices?.B || '').trim();
          const C = String(choices?.C || '').trim();
          const D = String(choices?.D || '').trim();
          const ans = this.normalizeAnswerLetter(it?.answer);

          if (!qText || !A || !B || !C || !D || !ans) return null;

          return {
            question: qText,
            choices: { A, B, C, D },
            answer: ans,
          };
        })
        .filter(Boolean) as any[];

      if (!mapped.length) {
        await this.presentAlert('AI did not return any valid MCQs for this PDF.');
        return;
      }

      // Fill only existing blank questions; do not add new ones.
      const fillCount = Math.min(blankIndexes.length, mapped.length);
      for (let i = 0; i < fillCount; i++) {
        const qIndex = blankIndexes[i];
        const src = mapped[i];
        const dest = this.questions[qIndex];
        dest.question = src.question;
        dest.choices = src.choices;
        dest.answer = src.answer;
      }

      this.refreshDisplayQuestions();
      await this.presentAlert(`Filled ${fillCount} blank question(s) from the PDF lesson.`);
    } catch (e: any) {
      const message = e?.message ? String(e.message) : String(e);
      await this.presentAlert(message || 'Failed to generate questions from PDF.');
    } finally {
      this.isImportingPdf = false;
    }
  }

  async saveQuestions() {
    try {
      const res = await this.teacherService.saveSubjectQuestions(this.classId, this.subjectId, this.questions);
      if (!res.success) {
        await this.presentAlert(res.error || 'Failed to save questions');
        return;
      }

      const subject = LocalDataService.getSubject(this.classId, this.subjectId);
      if (subject) {
        subject.questions = this.questions;
        subject.answerKey = (this.questions || []).map((q) => {
          const a = String((q as any)?.answer || '').trim().toUpperCase();
          return (a === 'A' || a === 'B' || a === 'C' || a === 'D') ? a : '';
        });
        await LocalDataService.save();
      }
      await this.presentAlert('Questions saved to Firebase!');
    } catch (e: any) {
      await this.presentAlert(e?.message || 'Failed to save questions');
    }
  }

  async deleteQuestion(target: number | any) {
    const ok = await this.presentConfirm('Delete this question?');
    if (!ok) return;

    if (typeof target === 'number') {
      const index = target;
      if (!Number.isFinite(index) || index < 0 || index >= this.questions.length) return;
      this.questions = this.questions.filter((_, i) => i !== index);
      this.refreshDisplayQuestions();
      return;
    }

    const q = target;
    const idx = this.questions.indexOf(q);
    if (idx >= 0) {
      this.questions = this.questions.filter((_, i) => i !== idx);
      this.refreshDisplayQuestions();
    }
  }
}
