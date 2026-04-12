import { Component, OnInit, AfterViewInit } from '@angular/core';
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

  tosAnalysis: TosRowAnalysis[] = [];
  tosRowView: any[] = [];

  private cognitiveChart?: Chart;
  private answersChart?: Chart;
  private topicChart?: Chart;
  private competencyChart?: Chart;

  constructor(
    private route: ActivatedRoute,
    private teacherService: TeacherService
  ) {}

  ngOnInit() {
    const stateResult = history.state?.resultData;
    LocalDataService.getSubject(this.classId, this.subjectId)
    if (stateResult) {
      this.result = stateResult;
      this.classId = Number((stateResult as any).classId || 0);
      this.subjectId = Number((stateResult as any).subjectId || 0);
      this.buildTosAnalysis();
      if (this.result?.tosRows) {
        this.tosRowView = this.buildTosRowView(this.result.tosRows);
      }
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

    // 🔥 ADD THIS HERE (after everything is ready)
    setTimeout(() => {
      this.enrichAnswersWithTOS();
      const subject = LocalDataService.getSubject(this.classId, this.subjectId);

console.log("SUBJECT:", subject);

      this.renderAnswerDistributionChart(this.result!.answers);
      this.renderCognitiveChart(this.result!.answers);
      this.renderTopicChart(this.result!.answers);
      this.renderCompetencyChart(this.result!.answers);
    }, 100);
  }


  ngAfterViewInit() {
   
  }

  /** Topics this student is strong at (highest % first). */
  get strongestTopics(): { topic: string; correct: number; total: number; percent: number }[] {
    return this.tosAnalysis
      .filter(r => r.total >= 1)
      .map(r => ({ topic: r.topic, correct: r.correct, total: r.total, percent: r.percentScore }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 5);
  }

  /** Topics that need improvement (lowest % first). */
  get weakestTopics(): { topic: string; correct: number; total: number; percent: number }[] {
    return this.tosAnalysis
      .filter(r => r.total >= 1)
      .map(r => ({ topic: r.topic, correct: r.correct, total: r.total, percent: r.percentScore }))
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 3);
  }
private enrichAnswersWithTOS() {
  if (!this.result?.answers || !this.result?.tosRows) return;

  let itemCounter = 1;

  for (const row of this.result.tosRows as any[]) {
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
  // ✅ Build TOS Row Analysis
  private buildTosAnalysis() {
    if (!this.result) return;

    const subject = LocalDataService.getSubject(this.classId, this.subjectId);
    let tosRows = subject?.tosRows;
    if (!tosRows?.length && this.result.tosRows?.length) {
      tosRows = LocalDataService.generateTOSRows(this.result.tosRows as any);
    }
    if (!tosRows?.length) return;
    // ✅ ADD THIS LINE
    this.result.tosRows = tosRows as any;

    this.tosAnalysis = tosRows.map((row: any) => {
      const start = row.startQuestion;
      const end = row.endQuestion;
      const rowAnswers = this.result!.answers.filter(
        a => a.question >= start && a.question <= end
      );

      const total = rowAnswers.length;
      const correct = rowAnswers.filter(a => a.correct).length;

      return {
        topic: row.topic,
        competency: row.competency,
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

  // ✅ Chart for Topic Breakdown
  renderTopicChart(answers: AnswerEntry[]) {
    const ctx = document.getElementById('topicChart') as HTMLCanvasElement;
    if (!ctx) return;

    if (this.topicChart) this.topicChart.destroy();

    const breakdown: { [topic: string]: { correct: number; total: number } } = {};

    answers.forEach(a => {
      const topic = a.topic || 'N/A';
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

  printPage() {
    window.print();
  }
}
