import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AlertController, ModalController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { LocalDataService, ScannedResult, TopicEntry } from '../../services/local-data.service';
import { AnswerSheetGeneratorPage } from '../answer-sheet-generator/answer-sheet-generator.page';
import { ClassStudent, TeacherService } from '../../services/teacher.service';
import Chart from 'chart.js/auto';

interface QuestionResponseBreakdown {
  question: number;
  correctAnswer: string | null;
  responses: Record<
    'A' | 'B' | 'C' | 'D',
    Array<{ name: string; rollNumber?: string | null }>
  >;
  totalResponses: number;
  percentages: Record<'A' | 'B' | 'C' | 'D', number>;
}


interface TosRowAnalysis {
  topic: string;
  competency: string;
  level: string;
  percentage: number;
  numItems: number;
  start: number;
  end: number;
  correct: number;
  total: number;
  percentScore: number;
}
interface ItemAnalysis {
  question: number;
  correctAnswer: string | null;

  totalResponses: number;
  correctCount: number;
  percentCorrect: number;

  counts: {
    A: number;
    B: number;
    C: number;
    D: number;
    Blank: number;
  };

  alternativeAnswers: {
    option: string;
    count: number;
    percent: number;
  }[];
}

@Component({
  selector: 'app-tos',
  templateUrl: './tos.page.html',
  styleUrls: ['./tos.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AnswerSheetGeneratorPage, RouterModule] 
})
export class TosPage implements OnInit {
  responseChart?: Chart;
  correctVsIncorrectChart!: Chart;
  answerDistributionChart!: Chart;
  questionResponseBreakdown: QuestionResponseBreakdown[] = [];
  classId!: number;
  subjectId!: number;
  className = '';
  subjectName = '';
  @ViewChild('modeSegment', { read: ElementRef }) modeSegment!: ElementRef<HTMLElement>;
  viewMode: 'overview' | 'edit' | 'print' | 'answersheet' | 'students' | 'responses' = 'overview';
  allResults: ScannedResult[] = [];
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
  responseOptions: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

  // Student Participation & Cognitive Performance Metrics
  totalStudents = 0;
  studentsScanned = 0;
  studentsNotScanned = 0;
  studentsCognitiveBreakdown: Record<string, { correct: number; total: number; percent: number }> = {};
  studentsPerformanceGood = 0;    // 75%+ average
  studentsPerformanceAverage = 0; // 50-75% average
  studentsPerformanceStruggling = 0; // <50% average

  // For tracking student performance data (used for filtering)
  private studentPerformanceMap = new Map<number, { name: string; rollNumber?: string; percentage: number }>();
  private scannedStudentIds = new Set<number>();

  getTotal(field: keyof TopicEntry): number {
  return this.tos.reduce((sum, topic) => sum + (Number(topic[field]) || 0), 0);
}

  /**
   * Calculate overall student participation and cognitive performance metrics
   */
  private computeOverallMetrics() {
    this.totalStudents = this.students.length;
    this.studentsScanned = 0;
    this.studentsNotScanned = 0;
    this.studentsPerformanceGood = 0;
    this.studentsPerformanceAverage = 0;
    this.studentsPerformanceStruggling = 0;

    // Clear maps
    this.studentPerformanceMap.clear();
    this.scannedStudentIds.clear();

    // Initialize cognitive breakdown
    this.studentsCognitiveBreakdown = {
      'Remember (R)': { correct: 0, total: 0, percent: 0 },
      'Understand (U)': { correct: 0, total: 0, percent: 0 },
      'Apply (A)': { correct: 0, total: 0, percent: 0 },
      'Analyze (A)': { correct: 0, total: 0, percent: 0 },
      'Evaluate (E)': { correct: 0, total: 0, percent: 0 },
      'Create (C)': { correct: 0, total: 0, percent: 0 }
    };

    let totalCognitiveCorrect = 0;
    let totalCognitiveItems = 0;

    // Process each student
    for (const student of this.students) {
      const summary = this.studentSummaryById.get(student.id);
      
      if (!summary || summary.attempts === 0) {
        // Student has NOT scanned
        this.studentsNotScanned++;
      } else {
        // Student HAS scanned
        this.studentsScanned++;
        this.scannedStudentIds.add(student.id);

        // Categorize by performance
        const avgPct = summary.avgPct;
        this.studentPerformanceMap.set(student.id, {
          name: student.name,
          rollNumber: student.roll_number || undefined,
          percentage: avgPct
        });

        if (avgPct >= 75) {
          this.studentsPerformanceGood++;
        } else if (avgPct >= 50) {
          this.studentsPerformanceAverage++;
        } else {
          this.studentsPerformanceStruggling++;
        }

        // Aggregate cognitive breakdown from latest result
        if (summary.latest && summary.latest.cognitiveBreakdown) {
          const breakdown = summary.latest.cognitiveBreakdown;
          
          // Map cognitive levels
          const levelMap: Record<string, string> = {
            'remembering': 'Remember (R)',
            'understanding': 'Understand (U)',
            'applying': 'Apply (A)',
            'analyzing': 'Analyze (A)',
            'evaluating': 'Evaluate (E)',
            'creating': 'Create (C)'
          };

          for (const [level, data] of Object.entries(breakdown)) {
            const mappedLevel = levelMap[level] || level;
            if (this.studentsCognitiveBreakdown[mappedLevel]) {
              this.studentsCognitiveBreakdown[mappedLevel].correct += (data as any).correct || 0;
              this.studentsCognitiveBreakdown[mappedLevel].total += (data as any).total || 0;
              totalCognitiveCorrect += (data as any).correct || 0;
              totalCognitiveItems += (data as any).total || 0;
            }
          }
        }
      }
    }

    // Calculate percentages for cognitive breakdown
    for (const level in this.studentsCognitiveBreakdown) {
      const data = this.studentsCognitiveBreakdown[level];
      data.percent = data.total > 0 ? (data.correct / data.total) * 100 : 0;
    }
  }

  /**
   * Get cognitive level performance with color indicator
   */
  getCognitivePerformanceColor(percent: number): string {
    if (percent >= 75) return 'success';
    if (percent >= 50) return 'warning';
    return 'danger';
  }

  /**
   * Get performance category color
   */
  getPerformanceCategoryColor(category: 'good' | 'average' | 'struggling'): string {
    switch(category) {
      case 'good': return 'success';
      case 'average': return 'warning';
      case 'struggling': return 'danger';
    }
  }

  /**
   * Get not scanned students list
   */
  getNotScannedStudents(): ClassStudent[] {
    return (this.students || []).filter(s => {
      const summary = this.studentSummaryById.get(s.id);
      return !summary || summary.attempts === 0;
    });
  }

  /**
   * Get scanned students list
   */
  getScannedStudents(): { name: string; rollNumber?: string; percentage: number }[] {
    const scanned: { name: string; rollNumber?: string; percentage: number }[] = [];
    this.studentPerformanceMap.forEach((data, studentId) => {
      scanned.push(data);
    });
    return scanned.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get good performance students (≥75%)
   */
  getGoodStudents(): { name: string; rollNumber?: string; percentage: number }[] {
    const good: { name: string; rollNumber?: string; percentage: number }[] = [];
    this.studentPerformanceMap.forEach((data, studentId) => {
      if (data.percentage >= 75) {
        good.push(data);
      }
    });
    return good.sort((a, b) => b.percentage - a.percentage);
  }

  /**
   * Get average performance students (50-75%)
   */
  getAverageStudents(): { name: string; rollNumber?: string; percentage: number }[] {
    const average: { name: string; rollNumber?: string; percentage: number }[] = [];
    this.studentPerformanceMap.forEach((data, studentId) => {
      if (data.percentage >= 50 && data.percentage < 75) {
        average.push(data);
      }
    });
    return average.sort((a, b) => b.percentage - a.percentage);
  }

  /**
   * Get struggling performance students (<50%)
   */
  getStrugglingStudents(): { name: string; rollNumber?: string; percentage: number }[] {
    const struggling: { name: string; rollNumber?: string; percentage: number }[] = [];
    this.studentPerformanceMap.forEach((data, studentId) => {
      if (data.percentage < 50) {
        struggling.push(data);
      }
    });
    return struggling.sort((a, b) => a.percentage - b.percentage);
  }
  private buildQuestionResponseBreakdown() {

  const questionMap = new Map<number, {
    correctAnswer: string | null;
    responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>>;
  }>();

  this.subjectResults.forEach(result => {

    result.answers?.forEach(answer => {

      if (answer.question == null) return;

      const question = Number(answer.question);

      const existing = questionMap.get(question) || {
        correctAnswer: answer.correctAnswer || null,
        responses: {
          A: [],
          B: [],
          C: [],
          D: []
        }
      };

      if (!existing.correctAnswer && answer.correctAnswer) {
        existing.correctAnswer = answer.correctAnswer;
      }

      const option = (answer.marked || '').toUpperCase() as
        'A' | 'B' | 'C' | 'D';

      if (this.responseOptions.includes(option)) {

        existing.responses[option].push({

          name: result.studentName || `Student ${result.id}`,

          rollNumber: result.rollNumber || null

        });

      }

      questionMap.set(question, existing);

    });

  });

  this.questionResponseBreakdown =
    Array.from(questionMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([question, data]) => {

        const totalResponses =
          Object.values(data.responses)
            .reduce((sum, arr) => sum + arr.length, 0);

        return {

          question,

          correctAnswer: data.correctAnswer,

          responses: data.responses,

          totalResponses,

          percentages: {

            A: totalResponses ? data.responses.A.length * 100 / totalResponses : 0,

            B: totalResponses ? data.responses.B.length * 100 / totalResponses : 0,

            C: totalResponses ? data.responses.C.length * 100 / totalResponses : 0,

            D: totalResponses ? data.responses.D.length * 100 / totalResponses : 0

          }

        };

      });
}
/** 
    get questionResponseBreakdown(): Array<{
      question: number;
      correctAnswer: string | null;
      responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>>;
      totalResponses: number;
      percentages: Record<'A' | 'B' | 'C' | 'D', number>;
      }> {
    const questionMap = new Map<number, {
      correctAnswer: string | null;
      responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>>;
    }>();

    this.subjectResults.forEach(result => {
      result.answers?.forEach(answer => {
        if (answer.question == null) return;
        const question = Number(answer.question);
        const existing = questionMap.get(question) || {
          correctAnswer: answer.correctAnswer || null,
          responses: { A: [], B: [], C: [], D: [] }
        };

        if (!existing.correctAnswer && answer.correctAnswer) {
          existing.correctAnswer = answer.correctAnswer;
        }

        const option = (answer.marked || '').toUpperCase() as 'A' | 'B' | 'C' | 'D';
        if (this.responseOptions.includes(option)) {
          existing.responses[option].push({
            name: result.studentName || `Student ${result.id}`,
            rollNumber: result.rollNumber || null
          });
        }

        questionMap.set(question, existing);
      });
    });

    return Array.from(questionMap.entries())
  .sort((a, b) => a[0] - b[0])
  .map(([question, data]) => {

    const totalResponses =
      Object.values(data.responses)
        .reduce((sum, arr) => sum + arr.length, 0);

    return {
      question,
      correctAnswer: data.correctAnswer,
      responses: data.responses,

      totalResponses,

      percentages: {
        A: totalResponses ? (data.responses.A.length / totalResponses) * 100 : 0,
        B: totalResponses ? (data.responses.B.length / totalResponses) * 100 : 0,
        C: totalResponses ? (data.responses.C.length / totalResponses) * 100 : 0,
        D: totalResponses ? (data.responses.D.length / totalResponses) * 100 : 0
      }
    };

  });
  }
*/
buildResponseDistributionChart() {

  const stats = this.overallResponseStats;


  if (this.responseChart) {
    this.responseChart.destroy();
  }


  const canvas =
    document.getElementById(
      'responseDistributionChart'
    ) as HTMLCanvasElement;


  if (!canvas) {
    console.log('Response chart canvas not ready');
    return;
  }


  this.responseChart = new Chart(
    canvas,
    {
      type:'bar',

      data:{
        labels:[
          'A',
          'B',
          'C',
          'D'
        ],

        datasets:[
          {
            label:'Responses',

            data:[
              stats.optionCounts.A,
              stats.optionCounts.B,
              stats.optionCounts.C,
              stats.optionCounts.D
            ]
          }
        ]
      },

      options:{
        responsive:true,

        plugins:{
          legend:{
            display:false
          }
        }
      }
    }
  );

}
get currentStudentResults(): ScannedResult[] {

  if (!this.students || !this.students.length) {
    return [];
  }


  const matchedResults = this.subjectResults.filter(result => {

    return this.students.some(student => {

      const sid = Number(student.id);

      const roll =
        String(student.roll_number || '').trim();

      const name =
        String(student.name || '')
          .trim()
          .toLowerCase();


      return (
        Number((result as any).studentId) === sid ||
        (roll &&
          String((result as any).rollNumber || '').trim() === roll) ||
        (name &&
          String((result as any).studentName || '')
            .trim()
            .toLowerCase() === name)
      );

    });

  });


  // Keep only latest attempt per student
  const latestByStudent = new Map<string, ScannedResult>();


  matchedResults.forEach(result => {

    const key =
      String(
        result.studentName ||
        result.rollNumber ||
        result.studentId
      )
      .trim()
      .toLowerCase();


    const existing =
      latestByStudent.get(key);


    if (!existing) {

      latestByStudent.set(key, result);

    } else {

      const oldTime =
        Date.parse(String(existing.timestamp || ''));

      const newTime =
        Date.parse(String(result.timestamp || ''));


      if (newTime > oldTime) {
        latestByStudent.set(key, result);
      }

    }

  });


  return Array.from(latestByStudent.values());

}
get overallResponseStats() {

  let correct = 0;
  let incorrect = 0;

  const optionCounts: Record<'A'|'B'|'C'|'D', number> = {
    A:0,
    B:0,
    C:0,
    D:0
  };

  let totalAnswers = 0;


  this.questionResponseBreakdown.forEach(item => {

    const correctAnswer =
      item.correctAnswer?.toUpperCase();


    (['A','B','C','D'] as const)
    .forEach(option => {


      const count =
        this.getOptionResponses(item, option).length;


      optionCounts[option] += count;

      totalAnswers += count;


      if(option === correctAnswer){

        correct += count;

      } else {

        incorrect += count;

      }


    });


  });


  return {

    totalAnswers,

    correct,

    incorrect,

    correctPercentage:
      totalAnswers
        ? (correct / totalAnswers) * 100
        : 0,


    incorrectPercentage:
      totalAnswers
        ? (incorrect / totalAnswers) * 100
        : 0,


    optionCounts

  };

}
  getOptionResponses(
    item: { responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>> },
    option: 'A' | 'B' | 'C' | 'D'
  ): Array<{ name: string; rollNumber?: string | null }> {
    const responses = item.responses?.[option] || [];
    const seen = new Map<string, { name: string; rollNumber?: string | null }>();
    responses.forEach(student => {
      const key = `${student.rollNumber ?? ''}|${student.name?.trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, student);
      }
    });
    return Array.from(seen.values());
  }

  getOptionResponseLabel(
    item: { responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>> },
    option: 'A' | 'B' | 'C' | 'D',
    previewCount = 4
  ): string {
    const responses = this.getOptionResponses(item, option);
    if (!responses.length) {
      return 'No responses';
    }

    const preview = responses.slice(0, previewCount)
      .map(r => `${r.name}${r.rollNumber ? ` (${r.rollNumber})` : ''}`);

    const remaining = responses.length - preview.length;
    return preview.join(', ') + (remaining > 0 ? `, +${remaining} more` : '');
  }

  async showResponseOptionList(
    item: { question: number; responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>> },
    option: 'A' | 'B' | 'C' | 'D'
  ) {
    const students = this.getOptionResponses(item, option);
    const title = `Question ${item.question} — ${option} responses (${students.length})`;
    console.log('[TOS] navigating to response page', title, students.length);

    await this.router.navigate(['responses', item.question, option], {
      relativeTo: this.route,
      state: {
        students,
        title
      }
    });
  }

  /**
   * Show modal with student list for a category
   */
  async showStudentList(type: 'scanned' | 'notScanned' | 'good' | 'average' | 'struggling') {
    let students: { name: string; rollNumber?: string; percentage?: number }[] = [];
    let title = '';

    switch (type) {
      case 'scanned':
        students = this.getScannedStudents();
        title = `Scanned Students (${students.length})`;
        break;
      case 'notScanned':
        students = this.getNotScannedStudents().map(s => ({ name: s.name, rollNumber: s.roll_number || undefined }));
        title = `Not Scanned Students (${students.length})`;
        break;
      case 'good':
        students = this.getGoodStudents();
        title = `Good Performance Students ≥75% (${students.length})`;
        break;
      case 'average':
        students = this.getAverageStudents();
        title = `Average Performance Students 50-75% (${students.length})`;
        break;
      case 'struggling':
        students = this.getStrugglingStudents();
        title = `Struggling Students <50% (${students.length})`;
        break;
    }

    const modal = await this.modalController.create({
      component: StudentListModalComponent,
      componentProps: {
        title: title,
        students: students
      },
      cssClass: 'student-list-modal'
    });

    await modal.present();
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private teacherService: TeacherService,
    private navCtrl: NavController,
    private alertController: AlertController,
    private modalController: ModalController
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

    // Compute overall metrics after individual summaries are ready
    this.computeOverallMetrics();
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
    if (this.subjectResults.length) {
      this.buildQuestionResponseBreakdown();
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
      this.buildQuestionResponseBreakdown();
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

  setMode(mode: 'overview' | 'edit' | 'print' | 'answersheet' | 'students' | 'responses') {
    this.viewMode = mode;
    
    if(mode === 'responses') {

      setTimeout(() => {
        this.buildResponseDistributionChart();
      }, 300);
    }

    // Automatically trigger print when entering print mode
    if (mode === 'print') {
      setTimeout(() => {
        window.print();
      }, 300);
    }

    setTimeout(() => this.scrollActiveSegmentIntoView(), 50);
  }

  onModeChange(mode: 'overview' | 'edit' | 'print' | 'answersheet' | 'students' | 'responses') {
    this.setMode(mode);
  }

  private scrollActiveSegmentIntoView() {
    const segmentEl: HTMLElement = this.modeSegment?.nativeElement;
    if (!segmentEl) {
      return;
    }

    const activeButton = segmentEl.querySelector('ion-segment-button[aria-checked="true"], ion-segment-button.ion-activated, ion-segment-button.ion-selected');
    if (activeButton instanceof HTMLElement) {
      activeButton.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
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
      // Ensure LocalDataService is loaded before saving
      await LocalDataService.load();
      console.log('=== TOS SAVE DEBUG ===');
      console.log('classId:', this.classId, 'subjectId:', this.subjectId);
      console.log('tos to save:', this.tos);

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
      LocalDataService.debugLog();
      console.log('=== TOS SAVE COMPLETE ===');
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

get itemAnalysis(): ItemAnalysis[] {

  const results = this.currentStudentResults || [];

  if (!results.length) {
    return [];
  }

  const questionMap = new Map<number, ItemAnalysis>();

  for (const result of results) {

    for (const answer of result.answers || []) {

      const question = Number(answer.question);

      if (!questionMap.has(question)) {

        questionMap.set(question, {

          question,

          correctAnswer: answer.correctAnswer,

          totalResponses: 0,

          correctCount: 0,

          percentCorrect: 0,

          counts: {
            A: 0,
            B: 0,
            C: 0,
            D: 0,
            Blank: 0
          },

          alternativeAnswers: []

        });

      }

      const item = questionMap.get(question)!;

      item.totalResponses++;

      const marked = (answer.marked || '').toUpperCase();

      switch (marked) {

        case 'A':
          item.counts.A++;
          break;

        case 'B':
          item.counts.B++;
          break;

        case 'C':
          item.counts.C++;
          break;

        case 'D':
          item.counts.D++;
          break;

        default:
          item.counts.Blank++;
      }

      if (answer.correct) {
        item.correctCount++;
      }

    }

  }

  const analysis = Array.from(questionMap.values())
    .sort((a, b) => a.question - b.question);

  analysis.forEach(item => {

    item.percentCorrect =
      item.totalResponses
        ? Math.round((item.correctCount / item.totalResponses) * 100)
        : 0;

    item.alternativeAnswers = ['A', 'B', 'C', 'D']
      .filter(option => option !== item.correctAnswer)
      .map(option => {

        const count = item.counts[option as 'A' | 'B' | 'C' | 'D'];

        return {

          option,

          count,

          percent: item.totalResponses
            ? Math.round((count / item.totalResponses) * 100)
            : 0

        };

      })
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count);

  });

  return analysis;

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

  /**
   * Show help modal for TOS fields
   */
  async showHelp(type: 'topicName' | 'competency' | 'days' | 'percent' | 'plannedItems' | 'blooms' | 'overview') {
    const helpContent: Record<string, { title: string; content: string }> = {
      topicName: {
        title: 'Topic Name',
        content: `<p><strong>Enter the name of the topic you're teaching.</strong></p>
          <p><strong>Examples:</strong></p>
          <ul>
            <li>Photosynthesis</li>
            <li>Fractions</li>
            <li>World War II</li>
            <li>Respiration</li>
          </ul>
          <p>Make it clear and specific so students understand what they're being tested on.</p>`
      },
      competency: {
        title: 'Learning Competency',
        content: `<p><strong>Describe what students should be able to do after learning this topic.</strong></p>
          <p><strong>Use simple language:</strong></p>
          <ul>
            <li>"Students can explain photosynthesis"</li>
            <li>"Students can solve fraction problems"</li>
            <li>"Students can identify causes of WW2"</li>
          </ul>
          <p>Focus on the learning outcome, not the topic itself.</p>`
      },
      days: {
        title: 'Number of Days',
        content: `<p><strong>How many days did you spend teaching this topic?</strong></p>
          <p><strong>Example:</strong></p>
          <ul>
            <li>If you taught it for 2 weeks = 10 days</li>
            <li>If you taught it for 1 week = 5 days</li>
          </ul>
          <p>This helps show how much time was spent on each topic.</p>`
      },
      percent: {
        title: 'Percentage (%)',
        content: `<p><strong>What percentage of the exam will test this topic?</strong></p>
          <p><strong>Example:</strong></p>
          <ul>
            <li>If the topic is 25% of content = enter 25</li>
            <li>If all topics together = 100%</li>
          </ul>
          <p>This ensures balanced exam questions across all topics.</p>`
      },
      plannedItems: {
        title: 'Planned Items',
        content: `<p><strong>How many questions do you plan to ask about this topic?</strong></p>
          <p><strong>Example:</strong></p>
          <ul>
            <li>If your exam has 50 questions total</li>
            <li>And 25% of content is photosynthesis</li>
            <li>Then planned items = 12-13 questions</li>
          </ul>
          <p>This is your target number of questions.</p>`
      },
      blooms: {
        title: 'Bloom\'s Cognitive Levels',
        content: `<p><strong>These are the thinking levels. Distribute your questions across different levels:</strong></p>
          <ul>
            <li><strong>Remembering (R):</strong> Simple recall facts (What? Define?)</li>
            <li><strong>Understanding (U):</strong> Explain ideas (Explain? Summarize?)</li>
            <li><strong>Applying (A):</strong> Use knowledge in new situations (How would you...? Solve?)</li>
            <li><strong>Analyzing (A):</strong> Break down and compare (Compare? Why?)</li>
            <li><strong>Evaluating (E):</strong> Make judgments (Defend? Criticize?)</li>
            <li><strong>Creating (C):</strong> Build something new (Design? Create?)</li>
          </ul>
          <p><strong>Example for 10 questions:</strong></p>
          <ul>
            <li>R: 3 questions</li>
            <li>U: 2 questions</li>
            <li>A: 2 questions</li>
            <li>A: 1 question</li>
            <li>E: 1 question</li>
            <li>C: 1 question</li>
          </ul>`
      },
      overview: {
        title: 'What is a Table of Specification?',
        content: `<p><strong>A Table of Specification (TOS) is a blueprint for your exam:</strong></p>
          <ul>
            <li>✓ Lists all topics you taught</li>
            <li>✓ Shows how many questions for each topic</li>
            <li>✓ Ensures balanced exam questions</li>
            <li>✓ Uses Bloom's Cognitive Levels</li>
            <li>✓ Helps create fair assessments</li>
          </ul>
          <p>It ensures your exam fairly represents what you taught in class. Without it, your exam might focus too much on one topic and miss others.</p>
          <p><strong>For non-technical teachers:</strong> Think of it like a recipe. Just as a recipe lists ingredients and amounts, a TOS lists topics and how many questions each should have.</p>`
      }
    };

    const helpData = helpContent[type] || { title: 'Help', content: '<p>No information available.</p>' };
    
    const modal = await this.modalController.create({
      component: HelpModalComponent,
      componentProps: {
        title: helpData.title,
        content: helpData.content
      },
      cssClass: 'help-modal'
    });
    
    await modal.present();
  }

}

// Help Modal Component
@Component({
  selector: 'app-help-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div [innerHTML]="content"></div>
      <div class="response-modal-actions">
        <ion-button expand="block" fill="outline" (click)="close()">Close</ion-button>
      </div>
    </ion-content>
  `,
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class HelpModalComponent {
  @Input() title = '';
  @Input() content = '';

  constructor(private modalController: ModalController) {}

  async close() {
    try {
      await this.modalController.dismiss(undefined, undefined, 'tos-response-modal');
      return;
    } catch (e) {
      console.warn('[TOS] HelpModalComponent close by id failed', e);
    }

    try {
      await this.modalController.dismiss();
      return;
    } catch (e) {
      console.warn('[TOS] HelpModalComponent close failed', e);
    }

    try {
      const topModal = await this.modalController.getTop();
      if (topModal) {
        await topModal.dismiss();
      }
    } catch (nestedError) {
      console.warn('[TOS] HelpModalComponent fallback close failed', nestedError);
    }
  }
}

// Student List Modal Component
@Component({
  selector: 'app-student-list-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title }}</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" type="button" (click)="close()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-button expand="block" fill="outline" style="margin-bottom: 12px;" (click)="close()">Close</ion-button>
      <ion-list *ngIf="students.length > 0">
        <ion-item *ngFor="let student of students; let i = index" lines="inset">
          <ion-label>
            <div style="font-weight: 900; font-size: 16px;">{{ i + 1 }}. {{ student.name }}</div>
            <div style="font-size: 12px; opacity: 0.7;" *ngIf="student.rollNumber">
              Roll: #{{ student.rollNumber }}
            </div>
            <div style="font-size: 13px; color: #2563eb; font-weight: 700; margin-top: 4px;" *ngIf="student.percentage !== undefined">
              {{ student.percentage.toFixed(1) }}%
            </div>
          </ion-label>
        </ion-item>
      </ion-list>
      <div *ngIf="students.length === 0" style="text-align: center; padding: 40px 20px; opacity: 0.6;">
        <p>No students in this category</p>
      </div>
    </ion-content>
  `,
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class StudentListModalComponent {
  title!: string;
  students!: { name: string; rollNumber?: string; percentage?: number }[];

  constructor(private modalController: ModalController) {}

  async close() {
    console.log('[TOS] response modal close clicked');
    try {
      const topModal = await this.modalController.getTop();
      console.log('[TOS] getTop result', topModal);
      if (topModal) {
        await topModal.dismiss();
        console.log('[TOS] dismissed top modal');
        return;
      }
    } catch (e) {
      console.warn('[TOS] Could not dismiss top modal', e);
    }

    try {
      const modals = Array.from(document.querySelectorAll('ion-modal')) as any[];
      console.log('[TOS] found ion-modal overlays', modals.length);
      if (modals.length) {
        await modals[modals.length - 1].dismiss();
        console.log('[TOS] dismissed DOM ion-modal');
        return;
      }
    } catch (e) {
      console.warn('[TOS] DOM dismiss failed', e);
    }

    try {
      await this.modalController.dismiss();
      console.log('[TOS] dismissed fallback modal');
    } catch (e) {
      console.warn('[TOS] Fallback dismiss failed', e);
    }
  }
}
