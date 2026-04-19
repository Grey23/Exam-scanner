import { Component, OnInit, AfterViewInit, NgZone } from '@angular/core';
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
})
export class ResultviewerPage implements OnInit, AfterViewInit {
  classId!: number;
  subjectId!: number;
  resultId!: number;
  result?: ScannedResult;

  meanPercentage = 0;

  tosAnalysis: TosRowAnalysis[] = [];
  tosRowView: any[] = [];

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
    private ngZone: NgZone
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

          this.meanPercentage = LocalDataService.getMeanPercentage(this.classId, this.subjectId);
          this.buildTosAnalysis();
          if (this.result?.tosRows) {
            this.tosRowView = this.buildTosRowView(this.result.tosRows);
          }

          // Also render charts when loading from state
          setTimeout(() => {
            this.enrichAnswersWithTOS();
            // TEMPORARILY DISABLE ALL CHARTS to debug hang issue
            console.log('Charts temporarily disabled for debugging (stateResult path)');
            // if (this.result?.answers) {
            //   this.renderAnswerDistributionChart(this.result.answers);
            //   this.renderCognitiveChart(this.result.answers);
            //   this.renderCognitiveCombinedChart(this.result.answers);
            //   this.renderTopicChart(this.result.answers);
            //   this.renderCompetencyChart(this.result.answers);
            // }

            // Render per-topic cognitive breakdown charts after the *ngFor canvases exist
            setTimeout(() => {
              this.renderPerTopicCharts();
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

          // Hydrate LocalDataService cache when a subject exists.
          subject = LocalDataService.getSubject(this.classId, this.subjectId);
          if (subject) {
            LocalDataService.setSubjectResults(this.classId, this.subjectId, res.results || []);
          }
        }
      } catch (err) {
        console.error('Resultviewer: failed to load results from Firebase', err);
      }
    }

    this.buildTosAnalysis();
    if (this.result?.tosRows) {
      this.tosRowView = this.buildTosRowView(this.result.tosRows);
    }

    this.meanPercentage = LocalDataService.getMeanPercentage(this.classId, this.subjectId);

    // 🔥 ADD THIS HERE (after everything is ready)
    setTimeout(() => {
      this.enrichAnswersWithTOS();
      const subject = LocalDataService.getSubject(this.classId, this.subjectId);

console.log("SUBJECT:", subject);

      // TEMPORARILY DISABLE ALL CHARTS to debug hang issue
      console.log('Charts temporarily disabled for debugging');
      // this.renderAnswerDistributionChart(this.result!.answers);
      // this.renderCognitiveChart(this.result!.answers);
      // this.renderCognitiveCombinedChart(this.result!.answers);
      // this.renderTopicChart(this.result!.answers);
      // this.renderCompetencyChart(this.result!.answers);

      // Render per-topic cognitive breakdown charts
      setTimeout(() => {
        this.renderPerTopicCharts();
      }, 50);
    }, 100);
  }


  ngAfterViewInit() {
   
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
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: 'Answer Distribution' } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // ✅ Chart for Bloom’s levels
  renderCognitiveChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('cognitiveChart') as HTMLCanvasElement;
    if (!ctx) return;

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
          { label: 'Correct', data: correct, backgroundColor: 'rgba(75, 192, 192, 0.7)' },
          { label: 'Total', data: total, backgroundColor: 'rgba(255, 99, 132, 0.3)' },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: "Bloom's Cognitive Breakdown" } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // ✅ Combined cognitive graph (% correct per level)
  renderCognitiveCombinedChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('cognitiveCombinedChart') as HTMLCanvasElement;
    if (!ctx) return;

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

    this.cognitiveCombinedChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '% Correct',
            data: percents,
            backgroundColor: 'rgba(37, 99, 235, 0.7)'
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: 'Cognitive Performance (% Correct)' } },
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        }
      }
    });
  }

  // ✅ Chart for Topic Breakdown
  renderTopicChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('topicChart') as HTMLCanvasElement;
    if (!ctx) return;

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
          { label: 'Correct', data: correct, backgroundColor: 'rgba(153, 102, 255, 0.7)' },
          { label: 'Total', data: total, backgroundColor: 'rgba(255, 206, 86, 0.3)' },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: 'Topic Breakdown' } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // ✅ Chart for Competency Breakdown
  renderCompetencyChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('competencyChart') as HTMLCanvasElement;
    if (!ctx) return;

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
          { label: 'Correct', data: correct, backgroundColor: 'rgba(255, 159, 64, 0.7)' },
          { label: 'Total', data: total, backgroundColor: 'rgba(54, 162, 235, 0.3)' },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: 'Competency Breakdown' } },
        scales: { y: { beginAtZero: true } },
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

    // TEMPORARILY DISABLED to debug hang issue
    console.log('Per-topic charts temporarily disabled for debugging');
    return;
    if (!breakdown.length) return;

    breakdown.forEach((topicData, index) => {
      const canvasId = `topicChart-${index}`;
      const ctx = document.getElementById(canvasId) as HTMLCanvasElement;
      if (!ctx) return;

      const labels = topicData.cognitives.map(c => c.level);
      const correct = topicData.cognitives.map(c => c.correct);
      const total = topicData.cognitives.map(c => c.total);

      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Correct', data: correct, backgroundColor: 'rgba(75, 192, 192, 0.7)' },
            { label: 'Total', data: total, backgroundColor: 'rgba(255, 159, 64, 0.3)' },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: false },
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });

      this.topicCharts.push(chart);
    });
  }

  printPage() {
    window.print();
  }
}
