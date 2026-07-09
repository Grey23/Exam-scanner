import { Component, OnInit, AfterViewInit, NgZone, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { 
  LocalDataService, 
  ScannedResult, 
  AnswerEntry   
} from '../../services/local-data.service';
import { FormsModule } from '@angular/forms';
import Chart from 'chart.js/auto';
import { HttpClientModule } from '@angular/common/http';
import { TopicEntry } from '../../services/local-data.service';
import { TeacherService } from '../../services/teacher.service';
import { ModalController } from '@ionic/angular';


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

@Component({
  selector: 'app-resultviewer',
  templateUrl: './resultviewer.page.html',
  styleUrls: ['./resultviewer.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultviewerPage implements OnInit, AfterViewInit, OnDestroy {
  classId!: number;
  subjectId!: number;
  resultId!: number;
  result?: ScannedResult;

  meanPercentage = 0;

  tosAnalysis: TosRowAnalysis[] = [];
  tosRowView: any[] = [];

  // Tab switching
  activeTab: 'details' | 'statistics' | 'review' | 'responses' = 'details';
  reviewFilterQuery = '';
  reviewFilterType: 'all' | 'correct' | 'incorrect' = 'all';
  responseOptions: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

  // Statistics data
  allResults: ScannedResult[] = [];
  statistics: {
    minScore: number;
    maxScore: number;
    averageScore: number;
    medianScore: number;
    stdDeviation: number;
    minPercentage: number;
    maxPercentage: number;
    averagePercentage: number;
    medianPercentage: number;
    stdDeviationPercentage: number;
    totalStudents: number;
  } = {
    minScore: 0,
    maxScore: 0,
    averageScore: 0,
    medianScore: 0,
    stdDeviation: 0,
    minPercentage: 0,
    maxPercentage: 0,
    averagePercentage: 0,
    medianPercentage: 0,
    stdDeviationPercentage: 0,
    totalStudents: 0
  };

  topicBreakdownData: {
    topic: string;
    competency: string;
    cognitives: { level: string; correct: number; total: number; percent: number }[];
    totalCorrect: number;
    totalItems: number;
    overallPercent: number;
  }[] = [];

  private cognitiveChart?: Chart;
  private cognitiveCombinedChart?: Chart;
  private answersChart?: Chart;
  private topicChart?: Chart;
  private competencyChart?: Chart;

  constructor(
    private route: ActivatedRoute,
    private teacherService: TeacherService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private modalController: ModalController
  ) {}

  ngOnInit() {
    const stateResult = history.state?.resultData;
    if (stateResult) {
      this.result = stateResult;
      this.classId = Number((stateResult as any).classId || 0);
      this.subjectId = Number((stateResult as any).subjectId || 0);

      // Load local data to get TOS
      LocalDataService.load().then(() => {
        // Ensure UI updates happen inside Angular zone.
        this.ngZone.run(() => {
          try {
            if ((LocalDataService as any).debugLog) {
              (LocalDataService as any).debugLog();
            }
          } catch {}

          // Load all results for statistics
          const subject = LocalDataService.getSubject(this.classId, this.subjectId);
          const rawResults = subject?.results || [];
          // Deduplicate results by student ID/roll number - keep only the latest scan for each student
          this.allResults = this.deduplicateResults(rawResults);

          this.meanPercentage = LocalDataService.getMeanPercentage(this.classId, this.subjectId);
          this.calculateStatistics();
          this.buildTosAnalysis();
          if (this.result?.tosRows) {
            this.tosRowView = this.buildTosRowView(this.result.tosRows);
          }
          this.cdr.detectChanges();

          // Also render charts when loading from state
          setTimeout(() => {
            this.enrichAnswersWithTOS();
            if (this.result?.answers) {
              requestAnimationFrame(() => {
                this.renderAnswerDistributionChart(this.result!.answers);
                this.renderCognitiveChart(this.result!.answers);
                this.renderCognitiveCombinedChart(this.result!.answers);
                this.renderTopicChart(this.result!.answers);
                this.renderCompetencyChart(this.result!.answers);
              });
            }

            // Render per-topic cognitive breakdown charts after the *ngFor canvases exist
            setTimeout(() => {
              this.renderPerTopicCharts();
              this.cdr.detectChanges();
            }, 150);
          }, 100);
        });
      });
      return;
    }

    this.route.queryParams.subscribe(params => {
      this.classId = +params['classId'];
      this.subjectId = +params['subjectId'];
      this.resultId = +params['resultId'];
      void this.resolveResultFromStoreOrFirebase();
    });
  }

  private async resolveResultFromStoreOrFirebase() {
    // Ensure local cache is loaded from storage at least once.
    await LocalDataService.load();

    // 1) Try in-memory LocalDataService cache
    let subject = LocalDataService.getSubject(this.classId, this.subjectId);
    this.result = subject?.results?.find(r => r.id === this.resultId);

    // 2) Fallback: pull from Firebase if not found locally
    if (!this.result) {
      try {
        const res = await this.teacherService.loadSubjectResults(this.classId, this.subjectId);
        if (res.success && Array.isArray(res.results)) {
          // Prefer direct lookup from remote results so this works
          // even if LocalDataService does not yet have a subject entry.
          this.result = res.results.find(r => r.id === this.resultId);
          const rawResults = res.results || [];
          // Deduplicate results by student ID/roll number - keep only the latest scan for each student
          this.allResults = this.deduplicateResults(rawResults);

          // Hydrate LocalDataService cache when a subject exists.
          subject = LocalDataService.getSubject(this.classId, this.subjectId);
          if (subject) {
            LocalDataService.setSubjectResults(this.classId, this.subjectId, res.results || []);
          }
        }
      } catch (err) {
        console.error('Resultviewer: failed to load results from Firebase', err);
      }
    } else {
      // Load all results from local cache for statistics
      const rawResults = subject?.results || [];
      // Deduplicate results by student ID/roll number - keep only the latest scan for each student
      this.allResults = this.deduplicateResults(rawResults);
    }

    this.buildTosAnalysis();
    if (this.result?.tosRows) {
      this.tosRowView = this.buildTosRowView(this.result.tosRows);
    }

    this.meanPercentage = LocalDataService.getMeanPercentage(this.classId, this.subjectId);
    this.calculateStatistics();
    this.cdr.detectChanges();

    // 🔥 ADD THIS HERE (after everything is ready)
    setTimeout(() => {
      this.enrichAnswersWithTOS();
      requestAnimationFrame(() => {
        this.renderAnswerDistributionChart(this.result!.answers);
        this.renderCognitiveChart(this.result!.answers);
        this.renderCognitiveCombinedChart(this.result!.answers);
        this.renderTopicChart(this.result!.answers);
        this.renderCompetencyChart(this.result!.answers);
      });

      // Render per-topic cognitive breakdown charts
      setTimeout(() => {
        this.renderPerTopicCharts();
        this.cdr.detectChanges();
      }, 50);
    }, 100);
  }


  ngAfterViewInit() {
   
  }

  ngOnDestroy() {
    try {
      this.answersChart?.destroy();
      this.cognitiveChart?.destroy();
      this.cognitiveCombinedChart?.destroy();
      this.topicChart?.destroy();
      this.competencyChart?.destroy();
      this.topicCharts.forEach((c) => c.destroy());
      this.topicCharts = [];
    } catch {
      // ignore
    }
  }

  /** Topics this student is strong at (highest % first). Aggregates by topic name. */
  get strongestTopics(): { topic: string; correct: number; total: number; percent: number }[] {
    // Aggregate by topic name (combine all cognitive levels for same topic)
    const topicMap = new Map<string, { correct: number; total: number }>();
    
    for (const row of this.tosAnalysis) {
      if (row.total < 1 || row.topic === 'N/A') continue;
      const existing = topicMap.get(row.topic) || { correct: 0, total: 0 };
      existing.correct += row.correct;
      existing.total += row.total;
      topicMap.set(row.topic, existing);
    }

    return Array.from(topicMap.entries())
      .map(([topic, data]) => ({
        topic,
        correct: data.correct,
        total: data.total,
        percent: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0
      }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 5);
  }

  /** Topics that need improvement (lowest % first). Aggregates by topic name. */
  get weakestTopics(): { topic: string; correct: number; total: number; percent: number }[] {
    // Aggregate by topic name (combine all cognitive levels for same topic)
    const topicMap = new Map<string, { correct: number; total: number }>();
    
    for (const row of this.tosAnalysis) {
      if (row.total < 1 || row.topic === 'N/A') continue;
      const existing = topicMap.get(row.topic) || { correct: 0, total: 0 };
      existing.correct += row.correct;
      existing.total += row.total;
      topicMap.set(row.topic, existing);
    }

    return Array.from(topicMap.entries())
      .map(([topic, data]) => ({
        topic,
        correct: data.correct,
        total: data.total,
        percent: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0
      }))
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 3);
  }

  /** Cognitive levels this student is strong at (highest % correct first). */
  get strongestCognitiveLevels(): { level: string; correct: number; total: number; percent: number }[] {
    const map = new Map<string, { correct: number; total: number }>();
    for (const row of this.tosAnalysis) {
      if (row.total < 1 || row.level === 'N/A') continue;
      const existing = map.get(row.level) || { correct: 0, total: 0 };
      existing.correct += row.correct;
      existing.total += row.total;
      map.set(row.level, existing);
    }

    return Array.from(map.entries())
      .map(([level, data]) => ({
        level,
        correct: data.correct,
        total: data.total,
        percent: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0
      }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 3);
  }

  /** Cognitive levels that need improvement (lowest % correct first). */
  get weakestCognitiveLevels(): { level: string; correct: number; total: number; percent: number }[] {
    const map = new Map<string, { correct: number; total: number }>();
    for (const row of this.tosAnalysis) {
      if (row.total < 1 || row.level === 'N/A') continue;
      const existing = map.get(row.level) || { correct: 0, total: 0 };
      existing.correct += row.correct;
      existing.total += row.total;
      map.set(row.level, existing);
    }

    return Array.from(map.entries())
      .map(([level, data]) => ({
        level,
        correct: data.correct,
        total: data.total,
        percent: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0
      }))
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 3);
  }

  /** Calculate statistics for all results in the subject */
  private calculateStatistics() {
    if (!this.allResults || this.allResults.length === 0) {
      return;
    }

    const scores = this.allResults.map(r => r.score);
    const percentages = this.allResults.map(r => r.total > 0 ? (r.score / r.total) * 100 : 0);

    this.statistics.totalStudents = this.allResults.length;
    this.statistics.minScore = Math.min(...scores);
    this.statistics.maxScore = Math.max(...scores);
    this.statistics.minPercentage = Math.min(...percentages);
    this.statistics.maxPercentage = Math.max(...percentages);

    // Average
    const sumScore = scores.reduce((a, b) => a + b, 0);
    const sumPercentage = percentages.reduce((a, b) => a + b, 0);
    this.statistics.averageScore = sumScore / scores.length;
    this.statistics.averagePercentage = sumPercentage / percentages.length;

    // Median
    const sortedScores = [...scores].sort((a, b) => a - b);
    const sortedPercentages = [...percentages].sort((a, b) => a - b);
    const mid = Math.floor(sortedScores.length / 2);
    this.statistics.medianScore = sortedScores.length % 2 !== 0
      ? sortedScores[mid]
      : (sortedScores[mid - 1] + sortedScores[mid]) / 2;
    this.statistics.medianPercentage = sortedPercentages.length % 2 !== 0
      ? sortedPercentages[mid]
      : (sortedPercentages[mid - 1] + sortedPercentages[mid]) / 2;

    // Standard Deviation
    const varianceScore = scores.reduce((sum, val) => sum + Math.pow(val - this.statistics.averageScore, 2), 0) / scores.length;
    const variancePercentage = percentages.reduce((sum, val) => sum + Math.pow(val - this.statistics.averagePercentage, 2), 0) / percentages.length;
    this.statistics.stdDeviation = Math.sqrt(varianceScore);
    this.statistics.stdDeviationPercentage = Math.sqrt(variancePercentage);
  }

  /** Switch between tabs */
  switchTab(tab: 'details' | 'review' | 'statistics' | 'responses') {
    this.activeTab = tab;
    
    // Re-render charts when switching back to details tab
    if (tab === 'details' && this.result?.answers) {
      this.ngZone.runOutsideAngular(() => {
        setTimeout(() => {
          requestAnimationFrame(() => {
            this.renderAnswerDistributionChart(this.result!.answers);
            this.renderCognitiveChart(this.result!.answers);
            this.renderCognitiveCombinedChart(this.result!.answers);
            this.renderTopicChart(this.result!.answers);
            this.renderCompetencyChart(this.result!.answers);
          });
          
          // Re-render per-topic charts
          setTimeout(() => {
            this.renderPerTopicCharts();
            this.cdr.detectChanges();
          }, 150);
        }, 100);
      });
    }
  }

  /** Deduplicate results by student ID/roll number - keep only the latest scan for each student */
  private deduplicateResults(results: ScannedResult[]): ScannedResult[] {
    const studentMap = new Map<string, ScannedResult>();
    
    results.forEach(result => {
      // Create a unique key for the student using roll number or student name
      const studentKey = result.rollNumber || result.studentName || `student_${result.id}`;
      
      // If we already have a result for this student, keep the one with the latest timestamp
      const existing = studentMap.get(studentKey);
      if (!existing || (result.timestamp && existing.timestamp && result.timestamp > existing.timestamp)) {
        studentMap.set(studentKey, result);
      }
    });
    
    return Array.from(studentMap.values());
  }

  /** Calculate cognitive breakdown for a single result */
  private getCognitiveBreakdown(result: ScannedResult): { level: string; correct: number; total: number; percent: number }[] {
    if (!result.answers || result.answers.length === 0) return [];
    
    const breakdown: { [level: string]: { correct: number; total: number } } = {};
    
    result.answers.forEach(answer => {
      const level = answer.level || 'N/A';
      if (level === 'N/A') return;
      
      if (!breakdown[level]) {
        breakdown[level] = { correct: 0, total: 0 };
      }
      
      breakdown[level].total++;
      if (answer.correct) {
        breakdown[level].correct++;
      }
    });
    
    return Object.keys(breakdown).map(level => ({
      level,
      correct: breakdown[level].correct,
      total: breakdown[level].total,
      percent: breakdown[level].total > 0 ? Math.round((breakdown[level].correct / breakdown[level].total) * 100) : 0
    })).sort((a, b) => b.percent - a.percent); // Sort by percentage descending
  }

  /** Get weakest cognitive levels for a student (areas needing improvement) */
  private getWeakestCognitiveLevels(result: ScannedResult): string[] {
    const breakdown = this.getCognitiveBreakdown(result);
    return breakdown
      .filter(c => c.percent < 70 && c.total > 0)
      .map(c => c.level);
  }

  /** Get answer distribution percentage for a specific option (A, B, C, D) */
  getAnswerDistribution(option: string): number {
    if (!this.result?.answers || this.result.answers.length === 0) return 0;
    
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    this.result.answers.forEach(answer => {
      if (answer.marked) {
        counts[answer.marked]++;
      }
    });
    
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (total === 0) return 0;
    
    return Math.round((counts[option] / total) * 100);
  }

  get correctAnswers() {
    if (!this.result?.answers) return [];
    return [...this.result.answers]
      .filter(a => a.correct)
      .sort((a, b) => a.question - b.question);
  }

  get incorrectAnswers() {
    if (!this.result?.answers) return [];
    return [...this.result.answers]
      .filter(a => !a.correct)
      .sort((a, b) => a.question - b.question);
  }

  get filteredCorrectAnswers() {
    const query = this.reviewFilterQuery.trim().toLowerCase();
    return this.correctAnswers.filter(answer => {
      if (!query) return true;
      const questionMatch = String(answer.question).includes(query);
      const topicMatch = String(answer.topic || '').toLowerCase().includes(query);
      const competencyMatch = String(answer.competency || '').toLowerCase().includes(query);
      return questionMatch || topicMatch || competencyMatch;
    });
  }

  get filteredIncorrectAnswers() {
    const query = this.reviewFilterQuery.trim().toLowerCase();
    return this.incorrectAnswers.filter(answer => {
      if (!query) return true;
      const questionMatch = String(answer.question).includes(query);
      const topicMatch = String(answer.topic || '').toLowerCase().includes(query);
      const competencyMatch = String(answer.competency || '').toLowerCase().includes(query);
      const correctAnswerMatch = String(answer.correctAnswer || '').toLowerCase().includes(query);
      return questionMatch || topicMatch || competencyMatch || correctAnswerMatch;
    });
  }

  get questionResponseBreakdown(): Array<{
    question: number;
    correctAnswer: string | null;
    responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>>;
  }> {
    const answerSources = (this.allResults?.length ? this.allResults : this.result ? [this.result] : []) as ScannedResult[];

    const questionMap = new Map<number, {
      correctAnswer: string | null;
      responses: Record<'A' | 'B' | 'C' | 'D', Array<{ name: string; rollNumber?: string | null }>>;
    }>();

    answerSources.forEach(result => {
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
        if (['A', 'B', 'C', 'D'].includes(option)) {
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
      .map(([question, data]) => ({
        question,
        correctAnswer: data.correctAnswer,
        responses: data.responses
      }));
  }

  /** Get accuracy percentage for the current result */
  getAccuracyPercentage(): number {
    if (!this.result || this.result.total === 0) return 0;
    return Math.round((this.result.score / this.result.total) * 100);
  }

  /** Get incorrect answer count */
  getIncorrectCount(): number {
    if (!this.result) return 0;
    return this.result.total - this.result.score;
  }

  /** Per-topic cognitive breakdown - groups TOS analysis by topic with cognitive details */
  private computeTopicBreakdown(): {
    topic: string;
    competency: string;
    cognitives: { level: string; correct: number; total: number; percent: number }[];
    totalCorrect: number;
    totalItems: number;
    overallPercent: number;
  }[] {
    const topicMap = new Map<string, {
      competency: string;
      cognitives: Map<string, { correct: number; total: number }>;
    }>();

    for (const row of this.tosAnalysis) {
      if (row.topic === 'N/A') continue;

      let entry = topicMap.get(row.topic);
      if (!entry) {
        entry = {
          competency: row.competency || 'N/A',
          cognitives: new Map<string, { correct: number; total: number }>()
        };
        topicMap.set(row.topic, entry);
      }

      // Update competency if not N/A
      if (row.competency && row.competency !== 'N/A') {
        entry.competency = row.competency;
      }

      // Add cognitive level data
      if (row.level && row.level !== 'N/A' && row.total > 0) {
        const cog = entry.cognitives.get(row.level) || { correct: 0, total: 0 };
        cog.correct += row.correct;
        cog.total += row.total;
        entry.cognitives.set(row.level, cog);
      }
    }

    return Array.from(topicMap.entries()).map(([topic, data]) => {
      const cognitives = Array.from(data.cognitives.entries())
        .map(([level, cog]) => ({
          level,
          correct: cog.correct,
          total: cog.total,
          percent: cog.total > 0 ? Math.round((cog.correct / cog.total) * 100) : 0
        }))
        .sort((a, b) => {
          // Sort by cognitive level order
          const order = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
          return order.indexOf(a.level) - order.indexOf(b.level);
        });

      const totalCorrect = cognitives.reduce((sum, c) => sum + c.correct, 0);
      const totalItems = cognitives.reduce((sum, c) => sum + c.total, 0);

      return {
        topic,
        competency: data.competency,
        cognitives,
        totalCorrect,
        totalItems,
        overallPercent: totalItems > 0 ? Math.round((totalCorrect / totalItems) * 100) : 0
      };
    });
  }

private enrichAnswersWithTOS() {
  if (!this.result?.answers) return;

  // Try to get TOS rows from result, or fall back to subject
  let tosRows: any[] = this.result.tosRows || [];
  if (!tosRows.length) {
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    // Check both tos (TopicEntry[]) and tosRows (TosRow[])
    if (subject?.tosRows?.length) {
      tosRows = subject.tosRows;
    } else if (subject?.tos?.length) {
      tosRows = subject.tos;
    }
  }
  if (!tosRows.length) {
    console.warn('No TOS data found for enrichment');
    return;
  }

  console.log('Enriching answers with TOS data:', tosRows.length, 'rows');

  // Some previously saved results may have tosRows stored in TosRow[] format
  // (topic/competency/level/startQuestion/endQuestion) instead of TopicEntry.
  const looksLikeTosRow = (row: any) =>
    row && typeof row === 'object' && 'startQuestion' in row && 'endQuestion' in row && 'level' in row;

  if (looksLikeTosRow(tosRows[0])) {
    for (const row of tosRows) {
      const start = Number(row.startQuestion);
      const end = Number(row.endQuestion);
      const level = String(row.level || 'N/A');
      const topic = row.topic || 'N/A';
      const competency = row.competency || 'N/A';

      for (let q = start; q <= end; q++) {
        const answer = this.result.answers.find(a => a.question === q);
        if (!answer) continue;
        answer.level = level.charAt(0).toUpperCase() + level.slice(1);
        answer.topic = topic;
        answer.competency = competency;
      }
    }
    return;
  }

  let itemCounter = 1;

  for (const row of tosRows) {
    const levels = [
      'remembering', 'understanding', 'applying',
      'analyzing', 'evaluating', 'creating'
    ];

    for (const lvl of levels) {
      const count = Number(row[lvl]) || 0;

      for (let i = 0; i < count; i++) {
        const questionNumber = itemCounter++;

        const answer = this.result.answers.find(a => a.question === questionNumber);
        if (answer) {
          answer.level = lvl.charAt(0).toUpperCase() + lvl.slice(1);

          // ✅ FIXED HERE
          answer.topic = row.topicName || row.topic || 'N/A';
          answer.competency = row.learningCompetency || row.competency || 'N/A';
        }
      }
    }
  }
}
  // Build TOS Row Analysis
  private buildTosAnalysis() {
    console.log('buildTosAnalysis START');
    if (!this.result) {
      console.log('buildTosAnalysis: no result, returning');
      return;
    }

    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    console.log('buildTosAnalysis: subject found:', !!subject, 'tosRows:', subject?.tosRows?.length, 'tos:', subject?.tos?.length);

    // Try multiple sources for TOS data:
    // 1. subject?.tosRows (generated TosRow[])
    // 2. subject?.tos (raw TopicEntry[]) - generate TosRow[] from it
    // 3. result.tosRows (saved with scan result)
    let tosRows = subject?.tosRows;
    if (!tosRows?.length && subject?.tos?.length) {
      console.log('Generating TosRows from subject.tos');
      tosRows = LocalDataService.generateTOSRows(subject.tos);
    }
    if (!tosRows?.length && this.result.tosRows?.length) {
      // result.tosRows could be TopicEntry[] or TosRow[]
      const firstRow = (this.result.tosRows as any[])[0];
      if (firstRow.startQuestion !== undefined) {
        // Already TosRow[] format
        tosRows = this.result.tosRows as any[];
      } else {
        // TopicEntry[] format - generate TosRow[]
        tosRows = LocalDataService.generateTOSRows(this.result.tosRows as any);
      }
    }
    if (!tosRows?.length) {
      this.topicBreakdownData = [];
      return;
    }

    this.tosAnalysis = tosRows.map((row: any) => {
      const start = row.startQuestion;
      const end = row.endQuestion;
      const rowAnswers = this.result!.answers.filter(
        a => a.question >= start && a.question <= end
      );

      const total = rowAnswers.length;
      const correct = rowAnswers.filter(a => a.correct).length;

      // Handle both TopicEntry (topicName) and TosRow (topic) formats
      const topicName = row.topic || row.topicName || 'N/A';
      const competencyName = row.competency || row.learningCompetency || 'N/A';

      return {
        topic: topicName,
        competency: competencyName,
        level: row.level,
        percentage: row.percentage,
        numItems: row.numItems,
        start,
        end,
        correct,
        total,
        percentScore: total > 0 ? Math.round((correct / total) * 100) : 0,
      };
    });

    // Cache topic breakdown once to avoid recomputation during change detection.
    this.topicBreakdownData = this.computeTopicBreakdown();
    console.log('buildTosAnalysis DONE - tosAnalysis:', this.tosAnalysis.length, 'topicBreakdownData:', this.topicBreakdownData.length);
  }

  
buildTosRowView(tosRows: TopicEntry[]): any[] {
  let itemCounter = 1;
  const rows: any[] = [];

  for (const row of tosRows) {
    const cognitiveLevels: { level: string; count: number; range: string }[] = [];
    const levels: (keyof TopicEntry)[] = [
      'remembering', 'understanding', 'applying',
      'analyzing', 'evaluating', 'creating'
    ];

    const questions: any[] = [];
    let rowCorrect = 0;
    let rowTotal = 0;

    for (const lvl of levels) {
      const count = Number(row[lvl]) || 0;
      if (count > 0) {
        const start = itemCounter;
        const end = itemCounter + count - 1;

        // 🔹 match answers to this range
        for (let q = start; q <= end; q++) {
          const ans = this.result?.answers.find(a => a.question === q);
          if (ans) {
            questions.push({
              qNum: q,
              selected: ans.marked ?? '—',
              correct: ans.correctAnswer ?? '—',
              isCorrect: ans.correct
            });

            rowTotal++;
            if (ans.correct) rowCorrect++;
          }
        }

        cognitiveLevels.push({
          level: String(lvl),
          count,
          range: `${start}-${end}`
        });
        itemCounter += count;
      }
    }

    // 🔹 calculate row performance (%)
    const performance = rowTotal > 0 ? (rowCorrect / rowTotal) * 100 : 0;

    rows.push({
      topic: row.topicName,
      competency: row.learningCompetency,
      percent: row.percent,
      expectedItems: row.expectedItems,
      cognitives: cognitiveLevels,
      questions,
      rowCorrect,
      rowTotal,
      performance: performance.toFixed(1) + '%'   // e.g. "60.0%"
    });
  }

  return rows;
}

  // ✅ Chart for A/B/C/D distribution
  renderAnswerDistributionChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('answersChart') as HTMLCanvasElement;
    if (!ctx) return;

    // Set explicit dimensions
    ctx.width = 300;
    ctx.height = 200;

    if (this.answersChart) this.answersChart.destroy();

    const counts: Record<"A" | "B" | "C" | "D", number> = { A: 0, B: 0, C: 0, D: 0 };
    answers.forEach(a => {
      if (a.marked) counts[a.marked as "A" | "B" | "C" | "D"]++;
    });

    this.answersChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['A', 'B', 'C', 'D'],
        datasets: [
          {
            label: 'Selections',
            data: [counts.A, counts.B, counts.C, counts.D],
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 2,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: false,
        devicePixelRatio: 1,
        animation: {
          duration: 500,
          easing: 'easeOutQuart'
        },
        plugins: { 
          title: { display: true, text: 'Answer Distribution' },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: { size: 14 },
            bodyFont: { size: 13 },
            cornerRadius: 8,
            displayColors: false
          },
          legend: {
            display: false
          }
        },
        scales: { 
          y: { 
            beginAtZero: true,
            ticks: {
              font: { size: 11 }
            }
          },
          x: {
            ticks: {
              font: { size: 12, weight: 'bold' }
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const label = ['A', 'B', 'C', 'D'][index];
            const value = counts[label as keyof typeof counts];
            console.log(`Selected ${label}: ${value} times`);
          }
        }
      },
    });
  }

  // ✅ Chart for Bloom's levels
  renderCognitiveChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('cognitiveChart') as HTMLCanvasElement;
    if (!ctx) return;

    // Set explicit dimensions
    ctx.width = 300;
    ctx.height = 200;

    if (this.cognitiveChart) this.cognitiveChart.destroy();

    const breakdown: { [level: string]: { correct: number; total: number } } = {};

    answers.forEach(a => {
      const level = a.level || 'N/A';
      if (level === 'N/A') return;
      if (!breakdown[level]) breakdown[level] = { correct: 0, total: 0 };
      breakdown[level].total++;
      if (a.correct) breakdown[level].correct++;
    });

    const labels = Object.keys(breakdown);
    const correct = labels.map(l => breakdown[l].correct);
    const total = labels.map(l => breakdown[l].total);

    this.cognitiveChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { 
            label: 'Correct', 
            data: correct, 
            backgroundColor: 'rgba(75, 192, 192, 0.7)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 2,
            borderRadius: 6
          },
          { 
            label: 'Total', 
            data: total, 
            backgroundColor: 'rgba(255, 99, 132, 0.3)',
            borderColor: 'rgba(255, 99, 132, 0.6)',
            borderWidth: 2,
            borderRadius: 6
          },
        ],
      },
      options: {
        responsive: false,
        devicePixelRatio: 1,
        animation: {
          duration: 500,
          easing: 'easeOutQuart'
        },
        plugins: { 
          title: { display: true, text: "Bloom's Cognitive Breakdown" },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: { size: 14 },
            bodyFont: { size: 13 },
            cornerRadius: 8
          },
          legend: {
            position: 'top',
            labels: {
              font: { size: 11 },
              usePointStyle: true,
              padding: 15
            }
          }
        },
        scales: { 
          y: { 
            beginAtZero: true,
            ticks: {
              font: { size: 11 }
            }
          },
          x: {
            ticks: {
              font: { size: 10 },
              maxRotation: 45,
              minRotation: 45
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const datasetIndex = elements[0].datasetIndex;
            const label = labels[index];
            const value = datasetIndex === 0 ? correct[index] : total[index];
            const type = datasetIndex === 0 ? 'Correct' : 'Total';
            console.log(`${label} - ${type}: ${value}`);
          }
        }
      },
    });
  }

  // ✅ Combined cognitive graph (% correct per level)
  renderCognitiveCombinedChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('cognitiveCombinedChart') as HTMLCanvasElement;
    if (!ctx) return;

    // Set explicit dimensions
    ctx.width = 300;
    ctx.height = 200;

    if (this.cognitiveCombinedChart) this.cognitiveCombinedChart.destroy();

    const breakdown: { [level: string]: { correct: number; total: number } } = {};

    answers.forEach(a => {
      const level = a.level || 'N/A';
      if (level === 'N/A') return;
      if (!breakdown[level]) breakdown[level] = { correct: 0, total: 0 };
      breakdown[level].total++;
      if (a.correct) breakdown[level].correct++;
    });

    const labels = Object.keys(breakdown);
    const percents = labels.map(l => {
      const b = breakdown[l];
      return b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0;
    });

    // Color coding based on percentage
    const backgroundColors = percents.map(p => {
      if (p >= 70) return 'rgba(34, 197, 94, 0.7)'; // green
      if (p >= 50) return 'rgba(234, 179, 8, 0.7)'; // yellow
      return 'rgba(239, 68, 68, 0.7)'; // red
    });

    const borderColors = percents.map(p => {
      if (p >= 70) return 'rgba(34, 197, 94, 1)';
      if (p >= 50) return 'rgba(234, 179, 8, 1)';
      return 'rgba(239, 68, 68, 1)';
    });

    this.cognitiveCombinedChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '% Correct',
            data: percents,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 2,
            borderRadius: 8
          }
        ]
      },
      options: {
        responsive: false,
        devicePixelRatio: 1,
        animation: {
          duration: 600,
          easing: 'easeOutQuart'
        },
        plugins: { 
          title: { display: true, text: 'Cognitive Performance (% Correct)' },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: { size: 14 },
            bodyFont: { size: 13 },
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                const value = context.parsed.y;
                let status = 'Needs improvement';
                if (value >= 70) status = 'Good';
                else if (value >= 50) status = 'Average';
                return `${value}% - ${status}`;
              }
            }
          },
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              font: { size: 11 },
              callback: function(value) {
                return value + '%';
              }
            }
          },
          x: {
            ticks: {
              font: { size: 10 },
              maxRotation: 45,
              minRotation: 45
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const label = labels[index];
            const percent = percents[index];
            console.log(`${label}: ${percent}% correct`);
          }
        }
      }
    });
  }

  // ✅ Chart for Topic Breakdown
  renderTopicChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('topicChart') as HTMLCanvasElement;
    if (!ctx) return;

    // Set explicit dimensions
    ctx.width = 300;
    ctx.height = 200;

    if (this.topicChart) this.topicChart.destroy();

    const breakdown: { [topic: string]: { correct: number; total: number } } = {};

    answers.forEach(a => {
      const topic = a.topic || 'N/A';
      if (topic === 'N/A') return;
      if (!breakdown[topic]) breakdown[topic] = { correct: 0, total: 0 };
      breakdown[topic].total++;
      if (a.correct) breakdown[topic].correct++;
    });

    const labels = Object.keys(breakdown);
    const correct = labels.map(l => breakdown[l].correct);
    const total = labels.map(l => breakdown[l].total);

    this.topicChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { 
            label: 'Correct', 
            data: correct, 
            backgroundColor: 'rgba(153, 102, 255, 0.7)',
            borderColor: 'rgba(153, 102, 255, 1)',
            borderWidth: 2,
            borderRadius: 6
          },
          { 
            label: 'Total', 
            data: total, 
            backgroundColor: 'rgba(255, 206, 86, 0.3)',
            borderColor: 'rgba(255, 206, 86, 0.6)',
            borderWidth: 2,
            borderRadius: 6
          },
        ],
      },
      options: {
        responsive: false,
        devicePixelRatio: 1,
        animation: {
          duration: 500,
          easing: 'easeOutQuart'
        },
        plugins: { 
          title: { display: true, text: 'Topic Breakdown' },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: { size: 14 },
            bodyFont: { size: 13 },
            cornerRadius: 8
          },
          legend: {
            position: 'top',
            labels: {
              font: { size: 11 },
              usePointStyle: true,
              padding: 15
            }
          }
        },
        scales: { 
          y: { 
            beginAtZero: true,
            ticks: {
              font: { size: 11 }
            }
          },
          x: {
            ticks: {
              font: { size: 10 },
              maxRotation: 45,
              minRotation: 45
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const datasetIndex = elements[0].datasetIndex;
            const label = labels[index];
            const value = datasetIndex === 0 ? correct[index] : total[index];
            const type = datasetIndex === 0 ? 'Correct' : 'Total';
            console.log(`${label} - ${type}: ${value}`);
          }
        }
      },
    });
  }

  // ✅ Chart for Competency Breakdown
  renderCompetencyChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('competencyChart') as HTMLCanvasElement;
    if (!ctx) return;

    // Set explicit dimensions
    ctx.width = 300;
    ctx.height = 200;

    if (this.competencyChart) this.competencyChart.destroy();

    const breakdown: { [competency: string]: { correct: number; total: number } } = {};

    answers.forEach(a => {
      const competency = a.competency || 'N/A';
      if (competency === 'N/A') return;
      if (!breakdown[competency]) breakdown[competency] = { correct: 0, total: 0 };
      breakdown[competency].total++;
      if (a.correct) breakdown[competency].correct++;
    });

    const labels = Object.keys(breakdown);
    const correct = labels.map(l => breakdown[l].correct);
    const total = labels.map(l => breakdown[l].total);

    this.competencyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { 
            label: 'Correct', 
            data: correct, 
            backgroundColor: 'rgba(255, 159, 64, 0.7)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 2,
            borderRadius: 6
          },
          { 
            label: 'Total', 
            data: total, 
            backgroundColor: 'rgba(54, 162, 235, 0.3)',
            borderColor: 'rgba(54, 162, 235, 0.6)',
            borderWidth: 2,
            borderRadius: 6
          },
        ],
      },
      options: {
        responsive: false,
        devicePixelRatio: 1,
        animation: {
          duration: 500,
          easing: 'easeOutQuart'
        },
        plugins: { 
          title: { display: true, text: 'Competency Breakdown' },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: { size: 14 },
            bodyFont: { size: 13 },
            cornerRadius: 8
          },
          legend: {
            position: 'top',
            labels: {
              font: { size: 11 },
              usePointStyle: true,
              padding: 15
            }
          }
        },
        scales: { 
          y: { 
            beginAtZero: true,
            ticks: {
              font: { size: 11 }
            }
          },
          x: {
            ticks: {
              font: { size: 10 },
              maxRotation: 45,
              minRotation: 45
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const datasetIndex = elements[0].datasetIndex;
            const label = labels[index];
            const value = datasetIndex === 0 ? correct[index] : total[index];
            const type = datasetIndex === 0 ? 'Correct' : 'Total';
            console.log(`${label} - ${type}: ${value}`);
          }
        }
      },
    });
  }

  // Store per-topic charts for cleanup
  topicCharts: Chart[] = [];

  // Render per-topic cognitive breakdown charts
  renderPerTopicCharts() {
    console.log('renderPerTopicCharts called, breakdown length:', this.topicBreakdownData.length);

    // Destroy existing topic charts
    this.topicCharts.forEach(chart => chart.destroy());
    this.topicCharts = [];

    const breakdown = this.topicBreakdownData;

    if (!breakdown.length) return;

    breakdown.forEach((topicData, index) => {
      const canvasId = `topicChart-${index}`;
      const ctx = document.getElementById(canvasId) as HTMLCanvasElement;
      if (!ctx) return;

      // Set explicit dimensions
      ctx.width = 280;
      ctx.height = 150;

      const labels = topicData.cognitives.map(c => c.level);
      const correct = topicData.cognitives.map(c => c.correct);
      const total = topicData.cognitives.map(c => c.total);

      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { 
              label: 'Correct', 
              data: correct, 
              backgroundColor: 'rgba(75, 192, 192, 0.7)',
              borderColor: 'rgba(75, 192, 192, 1)',
              borderWidth: 2,
              borderRadius: 4
            },
            { 
              label: 'Total', 
              data: total, 
              backgroundColor: 'rgba(255, 159, 64, 0.3)',
              borderColor: 'rgba(255, 159, 64, 0.6)',
              borderWidth: 2,
              borderRadius: 4
            },
          ],
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          devicePixelRatio: 1,
          animation: {
            duration: 400,
            easing: 'easeOutQuart'
          },
          plugins: {
            title: { display: false },
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              padding: 10,
              titleFont: { size: 12 },
              bodyFont: { size: 11 },
              cornerRadius: 6
            }
          },
          scales: {
            y: { 
              beginAtZero: true, 
              ticks: { 
                stepSize: 1,
                font: { size: 10 }
              }
            },
            x: {
              ticks: {
                font: { size: 9 },
                maxRotation: 45,
                minRotation: 45
              }
            }
          },
          onClick: (event, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              const datasetIndex = elements[0].datasetIndex;
              const label = labels[index];
              const value = datasetIndex === 0 ? correct[index] : total[index];
              const type = datasetIndex === 0 ? 'Correct' : 'Total';
              console.log(`${topicData.topic} - ${label} - ${type}: ${value}`);
            }
          }
        }
      });

      this.topicCharts.push(chart);
    });
  }

  printPage() {
    window.print();
  }

  // Help modal methods
  async showHelp(type: 'score' | 'cognitive' | 'topic' | 'statistics' | 'general') {
    const helpContent = this.getHelpContent(type);
    
    const modal = await this.modalController.create({
      component: HelpModalComponent,
      componentProps: {
        title: helpContent.title,
        content: helpContent.content
      },
      cssClass: 'help-modal'
    });
    
    await modal.present();
  }

  private getHelpContent(type: string) {
    const contents = {
      score: {
        title: 'Understanding Your Score',
        content: `
          <p><strong>Score:</strong> Shows how many questions you answered correctly out of the total questions.</p>
          <p><strong>Percentage:</strong> Your score converted to a percentage. Higher is better!</p>
          <p><strong>Mean Percentage:</strong> The average score of all students who took this exam. Compare your score to see how you performed relative to the class.</p>
        `
      },
      cognitive: {
        title: 'Cognitive Levels Explained',
        content: `
          <p><strong>Bloom's Taxonomy:</strong> These charts show your performance across different thinking levels:</p>
          <ul>
            <li><strong>Remembering:</strong> Recalling facts and basic concepts</li>
            <li><strong>Understanding:</strong> Explaining ideas or concepts</li>
            <li><strong>Applying:</strong> Using information in new situations</li>
            <li><strong>Analyzing:</strong> Drawing connections among ideas</li>
            <li><strong>Evaluating:</strong> Justifying a stand or decision</li>
            <li><strong>Creating:</strong> Producing new or original work</li>
          </ul>
          <p>The chart shows what percentage you got correct at each level.</p>
        `
      },
      topic: {
        title: 'Topic Breakdown Explained',
        content: `
          <p><strong>Topics:</strong> Shows which subject topics you performed well in and which need more practice.</p>
          <p><strong>Good At:</strong> Topics where you scored 70% or higher - keep up the good work!</p>
          <p><strong>Needs Improvement:</strong> Topics where you scored below 70% - focus your study time here.</p>
          <p><strong>Per-Topic Charts:</strong> Each topic shows a breakdown of how you did at different cognitive levels within that topic.</p>
        `
      },
      statistics: {
        title: 'Answer Analysis Explained',
        content: `
          <p><strong>✅ Correct Answers:</strong> Number of questions the student answered correctly out of the total.</p>
          <p><strong>❌ Incorrect Answers:</strong> Number of questions the student answered incorrectly.</p>
          <p><strong>� Accuracy:</strong> The percentage of correct answers. Higher is better!</p>
          <p><strong>🎯 Mean Percentage:</strong> The average score of all students who took this exam. Compare the student's accuracy to see how they performed relative to the class.</p>
          <p><strong>� Answer Distribution:</strong> Shows which answer options (A, B, C, D) the student selected most frequently. This can reveal patterns in their answering behavior.</p>
        `
      },
      general: {
        title: 'Result Viewer Guide',
        content: `
          <p><strong>Details Tab:</strong> View your individual score, cognitive performance, topic breakdown, and scanned paper.</p>
          <p><strong>Statistics Tab:</strong> View class-wide statistics to see how you compare to other students.</p>
          <p><strong>Interactive Charts:</strong> Tap on any chart to see detailed values. Charts are color-coded for easy reading.</p>
          <p><strong>Help Buttons:</strong> Tap the (?) icon next to any section for detailed explanations.</p>
        `
      }
    };
    
    return (contents as any)[type] || contents.general;
  }
}

// Help Modal Component
@Component({
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
    </ion-content>
  `,
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class HelpModalComponent {
  title!: string;
  content!: string;

  constructor(private modalController: ModalController) {}

  close() {
    this.modalController.dismiss();
  }
}
