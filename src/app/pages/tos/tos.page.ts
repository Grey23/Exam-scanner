import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AlertController } from '@ionic/angular';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { LocalDataService, ScannedResult, TopicEntry } from '../../services/local-data.service';
import { AnswerSheetGeneratorPage } from '../answer-sheet-generator/answer-sheet-generator.page';
import { ClassStudent, TeacherService } from '../../services/teacher.service';

@Component({
  selector: 'app-tos',
  templateUrl: './tos.page.html',
  styleUrls: ['./tos.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AnswerSheetGeneratorPage, RouterModule] 
})
export class TosPage implements OnInit {
  classId!: number;
  subjectId!: number;
  className = '';
  subjectName = '';
  viewMode: 'edit' | 'print' | 'answersheet' | 'students' = 'edit';

  tos: TopicEntry[] = [];
  totalItems = 0;
  isLoadingTos = false;
  isSavingTos = false;

  students: ClassStudent[] = [];
  isLoadingStudents = false;
  selectedStudentId: number | null = null;
  studentSummaryById = new Map<number, { attempts: number; avgPct: number; latest?: ScannedResult }>();
  private subjectResults: ScannedResult[] = [];

  topicJumpIndex: number | null = null;
  private expandedTopicIndexes = new Set<number>();
  private previousTos: TopicEntry[] = []; // Store TOS before edits for comparison

  getTotal(field: keyof TopicEntry): number {
  return this.tos.reduce((sum, topic) => sum + (Number(topic[field]) || 0), 0);
}

  constructor(
    private route: ActivatedRoute,
    private teacherService: TeacherService,
    private navCtrl: NavController,
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

  private recomputeStudentSummaries() {
    this.studentSummaryById.clear();
    const allResults = (this.subjectResults && this.subjectResults.length)
      ? this.subjectResults
      : LocalDataService.getResultsBySubject(this.classId, this.subjectId);

    for (const s of this.students || []) {
      const sid = Number(s.id);
      const roll = String(s.roll_number || '').trim();
      const name = String(s.name || '').trim().toLowerCase();

      const resultsForStudent = (allResults || []).filter(r => {
        if (Number((r as any).studentId) === sid) return true;
        if (roll && String((r as any).rollNumber || '').trim() === roll) return true;
        if (name && String((r as any).studentName || '').trim().toLowerCase() === name) return true;
        return false;
      });

      const attempts = resultsForStudent.length;
      const avgPct = attempts
        ? resultsForStudent.reduce((sum, r) => {
            const total = Number(r.total) || 0;
            const score = Number(r.score) || 0;
            return sum + (total > 0 ? (score / total) * 100 : 0);
          }, 0) / attempts
        : 0;

      const latest = (resultsForStudent || []).slice().sort((a, b) => {
        const ta = Date.parse(String(a.timestamp || '')) || 0;
        const tb = Date.parse(String(b.timestamp || '')) || 0;
        return tb - ta;
      })[0];

      this.studentSummaryById.set(s.id, { attempts, avgPct, latest: latest || undefined });
    }
  }

  async loadStudents() {
    this.isLoadingStudents = true;
    try {
      this.students = await this.teacherService.getSubjectStudentsForClass(this.classId, this.subjectId);
      this.recomputeStudentSummaries();
      if (this.students.length && !this.selectedStudentId) {
        this.selectedStudentId = this.students[0].id;
      }
    } catch (e) {
      console.error('Failed to load students for TOS page', e);
      this.students = [];
      this.studentSummaryById.clear();
    } finally {
      this.isLoadingStudents = false;
    }
  }

  selectStudent(studentId: number) {
    this.selectedStudentId = studentId;
  }

  getSelectedStudent(): ClassStudent | undefined {
    if (!this.selectedStudentId) return undefined;
    return (this.students || []).find(s => Number(s.id) === Number(this.selectedStudentId));
  }

  getSelectedStudentSummary(): { attempts: number; avgPct: number; latest?: ScannedResult } | undefined {
    if (!this.selectedStudentId) return undefined;
    return this.studentSummaryById.get(this.selectedStudentId);
  }

  getSelectedStudentTopicBreakdown(): { topic: string; competency: string; level: string; correct: number; total: number; percent: number }[] {
    const s = this.getSelectedStudent();
    if (!s) return [];
    return LocalDataService.getStudentTopicBreakdown(this.classId, this.subjectId, s.id, s.roll_number);
  }

  getStrongestTopics(): { topic: string; percent: number }[] {
    const rows = this.getSelectedStudentTopicBreakdown();
    return rows
      .filter(r => r.total >= 2)
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 5)
      .map(r => ({ topic: r.topic, percent: r.percent }));
  }

  getWeakestTopics(): { topic: string; percent: number }[] {
    const rows = this.getSelectedStudentTopicBreakdown();
    return rows
      .filter(r => r.total >= 2)
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 5)
      .map(r => ({ topic: r.topic, percent: r.percent }));
  }

  getStudentLatestLabel(studentId: number): string {
    const s = this.studentSummaryById.get(studentId);
    const r = s?.latest;
    if (!r || !Number.isFinite(Number(r.total)) || Number(r.total) <= 0) return '';
    const pct = (Number(r.score) / Number(r.total)) * 100;
    return `${r.score} / ${r.total} (${pct.toFixed(1)}%)`;
  }

  openSelectedStudentLatestResult() {
    const summary = this.getSelectedStudentSummary();
    const latest = summary?.latest;
    if (!latest) {
      void this.presentAlert('No scan result found for this student yet.');
      return;
    }
    this.navCtrl.navigateForward('/resultviewer', {
      queryParams: {
        classId: this.classId,
        subjectId: this.subjectId,
        resultId: latest.id
      }
    });
  }

  isTopicExpanded(index: number): boolean {
    return this.expandedTopicIndexes.has(index);
  }

  toggleTopic(index: number) {
    if (this.expandedTopicIndexes.has(index)) this.expandedTopicIndexes.delete(index);
    else this.expandedTopicIndexes.add(index);
  }

  expandAllTopics() {
    this.expandedTopicIndexes = new Set(this.tos.map((_, i) => i));
  }

  collapseAllTopics() {
    this.expandedTopicIndexes.clear();
  }

  async deleteTopic(index: number) {
    if (!Number.isFinite(index) || index < 0 || index >= (this.tos?.length || 0)) return;

    const alert = await this.alertController.create({
      header: 'Delete Topic?',
      message: 'This will remove the topic and its associated questions from the TOS. Save TOS to apply changes permanently.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.tos.splice(index, 1);

            // Rebuild expanded indexes based on removed item
            const next = new Set<number>();
            for (const i of Array.from(this.expandedTopicIndexes)) {
              if (i === index) continue;
              next.add(i > index ? i - 1 : i);
            }
            this.expandedTopicIndexes = next;

            if (this.topicJumpIndex !== null && this.topicJumpIndex !== undefined) {
              if (this.topicJumpIndex === index) this.topicJumpIndex = null;
              else if (this.topicJumpIndex > index) this.topicJumpIndex = this.topicJumpIndex - 1;
            }

            this.recomputeTotals();
            this.totalItems = this.totalTosItems;
          }
        }
      ]
    });
    await alert.present();
  }

  jumpToTopic(index: number | null) {
    if (index === null || index === undefined) return;
    const el = document.getElementById(`tos-topic-${index}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async ngOnInit() {
    await LocalDataService.load();
    this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));

    const initialView = this.route.snapshot.queryParamMap.get('view');
    if (initialView === 'students' || initialView === 'answersheet' || initialView === 'edit' || initialView === 'print') {
      this.viewMode = initialView as any;
    }

    const cls = LocalDataService.getClass(this.classId);
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);

    this.className = cls?.name || '';
    this.subjectName = subject?.name || '';
    this.tos = subject?.tos || [];

    // Default: expand first topic (if any)
    if (this.tos.length) this.expandedTopicIndexes.add(0);

    // Load TOS, scan results, and students in parallel for faster startup.
    await Promise.all([
      this.loadTosFromFirebase(),
      this.refreshResultsForStudents(),
      this.loadStudents()
    ]);

    this.totalItems = this.tos.reduce((sum, row) => {
      return (
        sum +
        (row.remembering || 0) +
        (row.understanding || 0) +
        (row.applying || 0) +
        (row.analyzing || 0) +
        (row.evaluating || 0) +
        (row.creating || 0)
      );
    }, 0);
  }

  private recomputeTotals() {
    this.totalItems = this.tos.reduce((sum, row) => {
      return (
        sum +
        (row.remembering || 0) +
        (row.understanding || 0) +
        (row.applying || 0) +
        (row.analyzing || 0) +
        (row.evaluating || 0) +
        (row.creating || 0)
      );
    }, 0);
  }

  private async loadTosFromFirebase() {
    this.isLoadingTos = true;
    try {
      const res = await this.teacherService.loadSubjectTos(this.classId, this.subjectId);
      if (res.success) {
        this.tos = res.tos || [];
        this.previousTos = JSON.parse(JSON.stringify(this.tos)); // Deep copy for comparison
        LocalDataService.saveTOS(this.classId, this.subjectId, this.tos);
        this.recomputeTotals();
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.isLoadingTos = false;
    }
  }

  /**
   * Refresh scan results for this subject and recompute per-student summaries.
   * Called on init and whenever the page becomes active again so that
   * newly scanned results immediately appear as the student's "latest" attempt.
   */
  private async refreshResultsForStudents() {
    // Merge remote + local so that very recent scans (saved locally first)
    // are not lost if Firestore has not yet returned them.
    try {
      const localResults = LocalDataService.getResultsBySubject(this.classId, this.subjectId) || [];
      const res = await this.teacherService.loadSubjectResults(this.classId, this.subjectId);

      const mergedMap = new Map<number, ScannedResult>();
      for (const r of localResults) {
        mergedMap.set(r.id, r);
      }
      if (res.success && Array.isArray(res.results)) {
        for (const r of res.results) {
          mergedMap.set(r.id, r);
        }
      }

      this.subjectResults = Array.from(mergedMap.values());
      LocalDataService.setSubjectResults(this.classId, this.subjectId, this.subjectResults);
    } catch (e) {
      console.error('Failed to load scan results for TOS page', e);
      this.subjectResults = LocalDataService.getResultsBySubject(this.classId, this.subjectId);
    }

    if (this.students && this.students.length) {
      this.recomputeStudentSummaries();
    }
  }

  // Re-run result refresh whenever we come back to this page (e.g. after scanning),
  // so "View Latest Result" always points to the newest attempt.
  async ionViewWillEnter() {
    if (!this.classId || !this.subjectId) return;
    await this.refreshResultsForStudents();
  }

  setMode(mode: 'edit' | 'print' | 'answersheet' | 'students') {
    this.viewMode = mode;

    // Automatically trigger print when entering print mode
    if (mode === 'print') {
      setTimeout(() => {
        window.print();
      }, 300);
    }
  }

  onModeChange(mode: 'edit' | 'print' | 'answersheet' | 'students') {
    this.setMode(mode);
  }
  addTopicRow() {
  this.tos.push({
    topicName: '',
    learningCompetency: '',
    days: 0,
    percent: 0,
    expectedItems: 0,
    remembering: 0,
    understanding: 0,
    applying: 0,
    analyzing: 0,
    evaluating: 0,
    creating: 0
  });

  const idx = this.tos.length - 1;
  this.expandedTopicIndexes.add(idx);
  this.topicJumpIndex = idx;
  setTimeout(() => this.jumpToTopic(idx), 50);
  }

  async saveTos() {
    if (this.isSavingTos) return;
    this.isSavingTos = true;
    try {
      const payload = (this.tos || []).map((row) => ({
        topicName: String(row.topicName || ''),
        learningCompetency: String(row.learningCompetency || ''),
        days: Number(row.days || 0),
        percent: Number(row.percent || 0),
        expectedItems: Number(row.expectedItems || 0),
        remembering: Number(row.remembering || 0),
        understanding: Number(row.understanding || 0),
        applying: Number(row.applying || 0),
        analyzing: Number(row.analyzing || 0),
        evaluating: Number(row.evaluating || 0),
        creating: Number(row.creating || 0),
      }));

      // Sync questions with TOS changes
      await this.syncQuestionsWithTos(payload);

      const res = await this.teacherService.saveSubjectTos(this.classId, this.subjectId, payload);
      if (!res.success) {
        await this.presentAlert(res.error || 'Failed to save TOS');
        return;
      }

      // Update previousTos after successful save
      this.previousTos = JSON.parse(JSON.stringify(payload));

      LocalDataService.saveTOS(this.classId, this.subjectId, payload);
      await LocalDataService.save();
      await this.presentAlert('TOS saved!');
    } catch (err: any) {
      await this.presentAlert(err?.message || 'Failed to save TOS');
    } finally {
      this.isSavingTos = false;
    }
  }

  private async syncQuestionsWithTos(newTos: TopicEntry[]) {
    const cognitiveLevels = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'] as const;

    // Load existing questions
    const qRes = await this.teacherService.loadSubjectQuestions(this.classId, this.subjectId);
    const existingQuestions: any[] = (qRes.success && Array.isArray(qRes.questions)) ? qRes.questions : [];

    // Group existing questions by (topic, competency, level)
    const existingByGroup = new Map<string, any[]>();
    for (const q of existingQuestions) {
      const topic = String(q?.topic || '').trim();
      const competency = String(q?.competency || '').trim();
      const level = String(q?.level || '').trim();
      const key = `${topic}|||${competency}|||${level}`;
      if (!existingByGroup.has(key)) {
        existingByGroup.set(key, []);
      }
      existingByGroup.get(key)!.push(q);
    }

    // Build set of valid (topic, competency) from new TOS
    const validTopicKeys = new Set<string>();
    for (const entry of newTos) {
      const topicKey = `${String(entry.topicName || '').trim()}|||${String(entry.learningCompetency || '').trim()}`;
      validTopicKeys.add(topicKey);
    }

    // Track which questions to keep/update
    const finalQuestions: any[] = [];
    const processedGroups = new Set<string>();

    // Process each TOS entry
    for (const entry of newTos) {
      const topic = String(entry.topicName || '').trim();
      const competency = String(entry.learningCompetency || '').trim();
      const topicKey = `${topic}|||${competency}`;

      for (const level of cognitiveLevels) {
        const targetCount = Number((entry as any)[level] || 0);
        const groupKey = `${topic}|||${competency}|||${level}`;
        processedGroups.add(groupKey);

        // Get existing questions for this group
        const existingInGroup = existingByGroup.get(groupKey) || [];
        
        // Separate visible and hidden
        const visible = existingInGroup.filter(q => !q.hidden);
        const hidden = existingInGroup.filter(q => q.hidden);

        if (targetCount === 0) {
          // Hide all questions in this group
          for (const q of existingInGroup) {
            finalQuestions.push({ ...q, hidden: true });
          }
        } else if (targetCount <= visible.length) {
          // Need fewer questions - hide the extras
          for (let i = 0; i < visible.length; i++) {
            const q = visible[i];
            if (i < targetCount) {
              // Keep visible
              finalQuestions.push({ ...q, hidden: false });
            } else {
              // Hide this one
              finalQuestions.push({ ...q, hidden: true });
            }
          }
          // Keep existing hidden ones as hidden
          for (const q of hidden) {
            finalQuestions.push({ ...q, hidden: true });
          }
        } else {
          // Need more questions - show hidden first, then add blanks
          const needed = targetCount - visible.length;
          const toShow = hidden.slice(0, needed);
          const stillHidden = hidden.slice(needed);

          // Keep all visible
          for (const q of visible) {
            finalQuestions.push({ ...q, hidden: false });
          }
          // Show hidden ones
          for (const q of toShow) {
            finalQuestions.push({ ...q, hidden: false });
          }
          // Keep rest hidden
          for (const q of stillHidden) {
            finalQuestions.push({ ...q, hidden: true });
          }

          // Add new blank questions if still needed
          const stillNeeded = targetCount - (visible.length + toShow.length);
          for (let i = 0; i < stillNeeded; i++) {
            const n = existingInGroup.length + i + 1;
            const built = this.buildTemplateQuestion(topic, competency, level, n);
            finalQuestions.push({
              topic,
              competency,
              level,
              question: built.question,
              choices: built.choices,
              answer: built.answer,
              hidden: false,
            });
          }
        }
      }
    }

    // Handle questions for deleted topics - hide them
    for (const [groupKey, questions] of existingByGroup.entries()) {
      if (processedGroups.has(groupKey)) continue;
      
      const [topic, competency, level] = groupKey.split('|||');
      const topicKey = `${topic}|||${competency}`;
      
      // If topic no longer exists in TOS, hide all its questions
      if (!validTopicKeys.has(topicKey)) {
        for (const q of questions) {
          finalQuestions.push({ ...q, hidden: true });
        }
      }
    }

    // Save updated questions
    await this.teacherService.saveSubjectQuestions(this.classId, this.subjectId, finalQuestions);

    // Update local data
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    if (subject) {
      subject.questions = finalQuestions;
      await LocalDataService.save();
    }
  }

  // Helper methods for template question generation (same logic as question-generator page)
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

  get totalTosItems(): number {
    return (
      Number(this.getTotal('remembering')) +
      Number(this.getTotal('understanding')) +
      Number(this.getTotal('applying')) +
      Number(this.getTotal('analyzing')) +
      Number(this.getTotal('evaluating')) +
      Number(this.getTotal('creating'))
    );
  }

}
