
import { Preferences } from '@capacitor/preferences';

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

export interface AnswerEntry {
  question: number;
  marked: string | null;        // what student selected
  correctAnswer: string | null; // key from teacher
  correct: boolean;             // true/false
  topic?: string | null;        // 🔹 from TOS mapping
  competency?: string | null;   // 🔹 from TOS mapping
  level?: string | null;        // 🔹 Bloom’s level
}


export interface ScannedResult {
  id: number;
  headerImage: string;
  fullImage: string;
  answers: AnswerEntry[];
  score: number;
  total: number;
  subjectId: number;
  classId: number;
  studentId?: number | null;
  rollNumber?: string | null;
  studentName?: string | null;
  timestamp: string;
  answerDistribution: Record<'A'|'B'|'C'|'D', number>;
  cognitiveBreakdown: { [level: string]: { correct: number; total: number } };
  // ✅ new field: snapshot of TOS rows
  tosRows: TopicEntry[];
}

export interface TosRow {
  topic: string;
  competency: string;
  level: string;
  percentage: number;
  numItems: number;
  startQuestion: number;
  endQuestion: number;
  cognitives?: { level: string; rawValue: number }[];   // <-- add this field for display
}

export interface Subject {
  id: number;
  name: string;
  tos: TopicEntry[];
  tosRows?: TosRow[];   // ✅ added so `subject.tosRows` works
  questions?: any[];
  answerKey?: string[];
  results?: ScannedResult[];
}


export interface Class {
  id: number;
  name: string;
  subjects: Subject[];
}

export class LocalDataService {
  private static classes: Class[] = [];
  private static isLoaded = false;

  // Load from storage into memory
  static async load(): Promise<void> {
    if (this.isLoaded) {
      console.log('LocalDataService already loaded, skipping');
      return;
    }
    console.log('LocalDataService loading from storage...');
    const stored = await Preferences.get({ key: 'examData' });
    if (stored.value) {
      this.classes = JSON.parse(stored.value);
      console.log('Loaded classes:', this.classes.length);
    } else {
      this.classes = [];
      console.log('No stored data found, initialized empty classes');
    }
    this.isLoaded = true;
  }

  // Force reload from storage (useful for debugging)
  static async forceReload(): Promise<void> {
    this.isLoaded = false;
    await this.load();
  }

  // Debug: log current state
  static debugLog(): void {
    console.log('=== LocalDataService DEBUG ===');
    console.log('isLoaded:', this.isLoaded);
    console.log('classes count:', this.classes.length);
    this.classes.forEach((cls, i) => {
      console.log(`Class ${i}:`, cls.id, cls.name, 'subjects:', cls.subjects.length);
      cls.subjects.forEach((sub, j) => {
        console.log(`  Subject ${j}:`, sub.id, sub.name, 'tos:', sub.tos?.length, 'tosRows:', sub.tosRows?.length);
      });
    });
    console.log('==============================');
  }

  static async save(): Promise<void> {
    await Preferences.set({ key: 'examData', value: JSON.stringify(this.classes) });
  }

  static getClasses(): Class[] {
    return this.classes;
  }

  static addClass(name: string) {
    const newClass: Class = {
      id: Date.now(),
      name,
      subjects: []
    };
    this.classes.push(newClass);
  }

  static getClass(id: number): Class | undefined {
    return this.classes.find(cls => cls.id === id);
  }
 // 🔹 Delete Class by ID
  static deleteClass(classId: number) {
    this.classes = this.classes.filter(cls => cls.id !== classId);
    this.save();
  }

  // 🔹 Delete Subject by ID inside a Class
  static deleteSubject(classId: number, subjectId: number) {
    const cls = this.getClass(classId);
    if (cls) {
      cls.subjects = cls.subjects.filter(sub => sub.id !== subjectId);
      this.save();
    }
  }
  static addSubject(classId: number, subjectName: string) {
    const cls = this.getClass(classId);
    if (cls) {
      const newSubject: Subject = {
        id: Date.now(),
        name: subjectName,
        tos: [],
        questions: [],
        answerKey: []
      };
      cls.subjects.push(newSubject);
    }
  }

  static getSubject(classId: number, subjectId: number): Subject | undefined {
    return this.getClass(classId)?.subjects.find(sub => sub.id === subjectId);
  }

  static saveTOS(classId: number, subjectId: number, tos: TopicEntry[]) {
    console.log('saveTOS called with classId:', classId, 'subjectId:', subjectId, 'tos length:', tos?.length);

    let subject = this.getSubject(classId, subjectId);

    if (!subject) {
      // Subject doesn't exist - try to create it
      console.log('Subject not found, attempting to create...');

      let cls = this.getClass(classId);
      if (!cls) {
        // Class doesn't exist either - create it
        console.log('Class not found, creating class:', classId);
        cls = {
          id: classId,
          name: `Class ${classId}`,
          subjects: []
        };
        this.classes.push(cls);
      }

      // Create subject
      subject = {
        id: subjectId,
        name: `Subject ${subjectId}`,
        tos: [],
        questions: [],
        answerKey: []
      };
      cls.subjects.push(subject);
      console.log('Created subject:', subjectId);
    }

    subject.tos = tos;
    subject.tosRows = this.generateTOSRows(tos);
    console.log('TOS saved. tosRows length:', subject.tosRows?.length);
  }

  static generateTOSMap(tos: TopicEntry[]): {
    question: number;
    topic: string;
    competency: string;
    level: string;
  }[] {
    const cognitiveLevels = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'];
    const map: any[] = [];
    let qNum = 1;

    tos.forEach(topic => {
      cognitiveLevels.forEach(level => {
        const count = Number(topic[level as keyof TopicEntry] || 0);
        for (let i = 0; i < count; i++) {
          map.push({
            question: qNum++,
            topic: topic.topicName,
            competency: topic.learningCompetency,
            level
          });
        }
      });
    });

    return map;
  }
static generateTOSRows(tos: TopicEntry[]): TosRow[] {
  const rows: TosRow[] = [];
  const cognitiveLevels = ['remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'];

  let qNum = 1;

  tos.forEach(entry => {
    cognitiveLevels.forEach(level => {
      const count = Number(entry[level as keyof TopicEntry] || 0);
      if (count > 0) {
        const row: TosRow = {
          topic: entry.topicName,
          competency: entry.learningCompetency,
          level,
          percentage: entry.percent,
          numItems: count,
          startQuestion: qNum,
          endQuestion: qNum + count - 1,
          // ✅ Only include this level’s value
          cognitives: [
            { level, rawValue: count }
          ]
        };
        rows.push(row);
        qNum += count;
      }
    });
  });

  return rows;
}


  static saveScannedResult(classId: number, subjectId: number, result: ScannedResult) {
    const subject = this.getSubject(classId, subjectId);
    if (!subject) return;
    subject.results = subject.results || [];
    subject.results.push(result);
  }

  static setSubjectResults(classId: number, subjectId: number, results: ScannedResult[]) {
    const subject = this.getSubject(classId, subjectId);
    if (!subject) return;
    subject.results = results.slice();
  }

  
  // 🔹 NEW: Get all results for a subject
  static getResultsBySubject(classId: number, subjectId: number): ScannedResult[] {
    const subject = this.getSubject(classId, subjectId);
    return subject?.results || [];
  }

  // 🔹 NEW: Compute mean percentage for subject
  static getMeanPercentage(classId: number, subjectId: number): number {
    const results = this.getResultsBySubject(classId, subjectId);
    if (!results.length) return 0;
    const totalPercent = results.reduce((sum, r) => sum + (r.score / r.total) * 100, 0);
    return totalPercent / results.length;
  }
  // 🔹 Inside LocalDataService
  static getAggregatedAnswerDistribution(classId: number, subjectId: number) {
    const results = this.getResultsBySubject(classId, subjectId);
    const counts = { A: 0, B: 0, C: 0, D: 0 };

    results.forEach(r => {
      r.answers.forEach(a => {
        if (a.marked) counts[a.marked as "A" | "B" | "C" | "D"]++;
      });
    });

    return counts;
  }

  static getAggregatedCognitiveBreakdown(classId: number, subjectId: number) {
    const results = this.getResultsBySubject(classId, subjectId);
    const breakdown: { [level: string]: { correct: number; total: number } } = {};

    results.forEach(r => {
      r.answers.forEach(a => {
        const level = a.level || "N/A";
        if (!breakdown[level]) breakdown[level] = { correct: 0, total: 0 };
        breakdown[level].total++;
        if (a.correct) breakdown[level].correct++;
      });
    });

    return breakdown;
  }

  static getResultsByStudent(classId: number, subjectId: number, studentId: number, studentRollNumber?: string | null): ScannedResult[] {
    const results = this.getResultsBySubject(classId, subjectId);
    const sid = Number(studentId);
    const roll = String(studentRollNumber || '').trim();
    return (results || []).filter(r => {
      if (Number((r as any)?.studentId) === sid) return true;
      if (roll && String((r as any)?.rollNumber || '').trim() === roll) return true;
      return false;
    });
  }

  /** Per-topic breakdown for a student in this subject (correct, total, percent). */
  static getStudentTopicBreakdown(classId: number, subjectId: number, studentId: number, studentRollNumber?: string | null): { topic: string; competency: string; level: string; correct: number; total: number; percent: number }[] {
    const results = this.getResultsByStudent(classId, subjectId, studentId, studentRollNumber);
    const subject = this.getSubject(classId, subjectId);
    const tosRows = subject?.tosRows?.length ? subject.tosRows : this.generateTOSRows(subject?.tos || []);
    if (!tosRows.length) return [];

    const byRow: { [key: string]: { correct: number; total: number } } = {};
    for (const row of tosRows) {
      const key = `${row.topic}|${row.competency}|${row.level}`;
      byRow[key] = { correct: 0, total: 0 };
    }

    for (const r of results) {
      for (const a of r.answers || []) {
        const row = tosRows.find((tr: any) => a.question >= tr.startQuestion && a.question <= tr.endQuestion);
        if (!row) continue;
        const key = `${row.topic}|${row.competency}|${row.level}`;
        const rec = byRow[key];
        if (!rec) continue;
        rec.total++;
        if (a.correct) rec.correct++;
      }
    }

    return tosRows.map((row: any) => {
      const key = `${row.topic}|${row.competency}|${row.level}`;
      const rec = byRow[key] || { correct: 0, total: 0 };
      return {
        topic: row.topic,
        competency: row.competency,
        level: row.level,
        correct: rec.correct,
        total: rec.total,
        percent: rec.total > 0 ? Math.round((rec.correct / rec.total) * 100) : 0
      };
    }).filter(x => x.total > 0);
  }

  static getLatestResultByStudent(classId: number, subjectId: number, studentId: number, studentRollNumber?: string | null): ScannedResult | undefined {
    const list = this.getResultsByStudent(classId, subjectId, studentId, studentRollNumber);
    return (list || []).slice().sort((a, b) => {
      const ta = Date.parse(String(a.timestamp || '')) || 0;
      const tb = Date.parse(String(b.timestamp || '')) || 0;
      return tb - ta;
    })[0];
  }
}

