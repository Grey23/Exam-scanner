import { Injectable } from '@angular/core';

import { HttpClient, HttpHeaders } from '@angular/common/http';

import { Observable, BehaviorSubject } from 'rxjs';

import { Preferences } from '@capacitor/preferences';

import { environment } from 'src/environments/environment';

import { collection, deleteDoc, doc, getDoc, getDocs, increment, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import { firebaseDb } from '../firebase';
import type { TopicEntry } from './local-data.service';




export interface Subject {

  id: number;

  name: string;

  code?: string;

  description?: string | null;

  total_marks?: number;

  student_count?: number;

  class_id?: number;

  teacher_id?: number;

}



export interface ClassData {

  id: number;

  name: string;

  grade_level?: string;

  student_count: number;

  subjects?: Subject[];

}



export interface ClassStudent {

  id: number;

  name: string;

  email?: string | null;

  roll_number?: string | null;

  enrollment_date?: string;

}



@Injectable({

  providedIn: 'root'

})

export class TeacherService {

  private apiUrl = `${environment.apiBaseUrl}/teacher`;

  private classesSubject = new BehaviorSubject<ClassData[]>([]);

  public classes$ = this.classesSubject.asObservable();

  // In-memory cache of scan results per subject to avoid
  // hitting Firestore every time the user opens TOS/results.
  private subjectResultsCache = new Map<string, import('./local-data.service').ScannedResult[]>();

  // Session cache for teacher id (avoids repeated Preferences reads).
  private teacherIdCache: string | null = null;

  // Cache for getClasses (2 min TTL) so dashboard/class-list load fast on back navigation.
  private classesCache: { data: ClassData[]; at: number } | null = null;
  private static readonly CACHE_TTL_MS = 2 * 60 * 1000;

  // Cache for getClassSubjects per classId.
  private subjectsCache = new Map<number, { data: Subject[]; at: number }>();

  // Cache for loadSubjectTos per classId:subjectId.
  private tosCache = new Map<string, { data: TopicEntry[]; at: number }>();

  constructor(private http: HttpClient) {}



  /**
   * Resolve the current teacher id used for all Firestore paths.
   * Cached for the session to avoid repeated Preferences reads.
   */
  private async getTeacherId(): Promise<string> {
    if (this.teacherIdCache != null) return this.teacherIdCache;
    const userData = await Preferences.get({ key: 'currentUser' });
    const user = JSON.parse(userData.value || '{}');
    let teacherId = String(user?.id || '').trim();
    if (!teacherId) {
      teacherId = 'dev-teacher';
      console.warn('[TeacherService] No logged-in user; using fallback teacherId:', teacherId);
    }
    this.teacherIdCache = teacherId;
    return teacherId;
  }

  /** Call after logout so next login gets fresh teacher id. */
  clearTeacherIdCache(): void {
    this.teacherIdCache = null;
    this.classesCache = null;
    this.subjectsCache.clear();
    this.tosCache.clear();
    this.subjectResultsCache.clear();
  }

  async loadSubjectAnswerKey(
    classId: number,
    subjectId: number
  ): Promise<{ success: boolean; answerKey: string[]; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      const snap = await getDoc(subjectRef);
      if (!snap.exists()) {
        return { success: true, answerKey: [] };
      }

      const data: any = snap.data();
      const arr: any[] = Array.isArray(data?.answerKey) ? data.answerKey : [];
      const answerKey: string[] = arr.map((v) => {
        const s = String(v || '').trim().toUpperCase();
        return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? s : '';
      });
      return { success: true, answerKey };
    } catch (err: any) {
      console.error('Error loading answer key:', err);
      return { success: false, answerKey: [], error: err.message || 'Failed to load answer key' };
    }
  }

  async loadSubjectQuestions(
    classId: number,
    subjectId: number
  ): Promise<{ success: boolean; questions: any[]; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      const snap = await getDoc(subjectRef);
      if (!snap.exists()) {
        return { success: true, questions: [] };
      }

      const data: any = snap.data();
      const questions: any[] = Array.isArray(data?.questions) ? data.questions : [];
      return { success: true, questions };
    } catch (err: any) {
      console.error('Error loading questions:', err);
      return { success: false, questions: [], error: err.message || 'Failed to load questions' };
    }
  }

  async saveSubjectAnswerKey(
    classId: number,
    subjectId: number,
    answerKey: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      const normalized: string[] = (Array.isArray(answerKey) ? answerKey : []).map((v) => {
        const s = String(v || '').trim().toUpperCase();
        return (s === 'A' || s === 'B' || s === 'C' || s === 'D') ? s : '';
      });

      await setDoc(
        subjectRef,
        {
          answerKey: normalized,
          answerKeyUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      return { success: true };
    } catch (err: any) {
      console.error('Error saving answer key:', err);
      return { success: false, error: err.message || 'Failed to save answer key' };
    }
  }

  async saveSubjectQuestions(
    classId: number,
    subjectId: number,
    questions: any[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));

      const safeQuestions: any[] = Array.isArray(questions) ? questions : [];
      const answerKey: string[] = safeQuestions.map((q: any) => {
        const a = String(q?.answer || '').trim().toUpperCase();
        return (a === 'A' || a === 'B' || a === 'C' || a === 'D') ? a : '';
      });

      await setDoc(
        subjectRef,
        {
          questions: safeQuestions,
          answerKey,
          questionsUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      return { success: true };
    } catch (err: any) {
      console.error('Error saving questions:', err);
      return { success: false, error: err.message || 'Failed to save questions' };
    }
  }

  async loadSubjectTos(classId: number, subjectId: number, options?: { refresh?: boolean }): Promise<{ success: boolean; tos: TopicEntry[]; error?: string }> {
    const key = `${classId}:${subjectId}`;
    const cached = this.tosCache.get(key);
    const useCache = !options?.refresh && cached &&
      (Date.now() - cached.at) < TeacherService.CACHE_TTL_MS;
    if (useCache && cached) return { success: true, tos: cached.data };

    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      const snap = await getDoc(subjectRef);
      if (!snap.exists()) {
        this.tosCache.set(key, { data: [], at: Date.now() });
        return { success: true, tos: [] };
      }

      const data: any = snap.data();
      const tos: TopicEntry[] = Array.isArray(data?.tos) ? data.tos : [];
      this.tosCache.set(key, { data: tos, at: Date.now() });
      return { success: true, tos };
    } catch (err: any) {
      console.error('Error loading TOS:', err);
      return { success: false, tos: [], error: err.message || 'Failed to load TOS' };
    }
  }

  async saveSubjectTos(
    classId: number,
    subjectId: number,
    tos: TopicEntry[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      await setDoc(
        subjectRef,
        {
          tos,
          tosUpdatedAt: Date.now(),
        },
        { merge: true }
      );

      this.tosCache.delete(`${classId}:${subjectId}`);
      return { success: true };
    } catch (err: any) {
      console.error('Error saving TOS:', err);
      return { success: false, error: err.message || 'Failed to save TOS' };
    }
  }

  /**
   * Save a scanned result into Firestore under the subject document.
   * Results are stored in a dedicated "results" subcollection to avoid
   * inflating the subject document itself.
   */
  async saveScanResult(
    classId: number,
    subjectId: number,
    result: import('./local-data.service').ScannedResult
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const resultRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(subjectId),
        'results',
        String(result.id)
      );

      await setDoc(resultRef, result, { merge: true });

      // Update in-memory cache so subsequent views are instant.
      const cacheKey = `${teacherId}:${classId}:${subjectId}`;
      const prev = this.subjectResultsCache.get(cacheKey) || [];
      const merged = [...prev.filter(r => r.id !== result.id), result];
      this.subjectResultsCache.set(cacheKey, merged);

      return { success: true };
    } catch (err: any) {
      console.error('Error saving scan result:', err);
      return { success: false, error: err.message || 'Failed to save scan result' };
    }
  }

  /**
   * Load all scanned results for a subject from Firestore.
   */
  async loadSubjectResults(
    classId: number,
    subjectId: number,
    options?: { refresh?: boolean }
  ): Promise<{ success: boolean; results: import('./local-data.service').ScannedResult[]; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      // Use cached results unless a refresh is explicitly requested.
      const cacheKey = `${teacherId}:${classId}:${subjectId}`;
      if (!options?.refresh) {
        const cached = this.subjectResultsCache.get(cacheKey);
        if (cached && cached.length) {
          return { success: true, results: cached };
        }
      }

      const resultsCol = collection(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(subjectId),
        'results'
      );

      const snap = await getDocs(resultsCol);
      const results = snap.docs.map(d => d.data() as import('./local-data.service').ScannedResult);

      // Populate cache for fast subsequent access.
      this.subjectResultsCache.set(cacheKey, results.slice());

      return { success: true, results };
    } catch (err: any) {
      console.error('Error loading scan results:', err);
      return { success: false, results: [], error: err.message || 'Failed to load scan results' };
    }
  }



  async getClassStudents(classId: number): Promise<ClassStudent[]> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(db, 'teachers', teacherId, 'classes', String(classId), 'students'),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          email: data.email ?? null,
          roll_number: data.roll_number ?? null,
          enrollment_date: data.enrollment_date ? String(data.enrollment_date) : undefined
        };
      });
    } catch (err) {
      console.error('Error fetching class students:', err);
      return [];
    }
  }



  async createClassStudent(
    classId: number,
    payload: { name: string; email?: string; roll_number?: string }
  ): Promise<{ success: boolean; student?: ClassStudent; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      const id = Date.now();

      const student: ClassStudent = {
        id,
        name: payload.name,
        email: payload.email ?? null,
        roll_number: payload.roll_number ?? null,
        enrollment_date: new Date().toISOString()
      };

      await setDoc(doc(db, 'teachers', teacherId, 'classes', String(classId), 'students', String(id)), {
        ...student,
        createdAt: Date.now()
      });

      const classRef = doc(db, 'teachers', teacherId, 'classes', String(classId));
      await updateDoc(classRef, { student_count: increment(1) });

      return { success: true, student };
    } catch (err: any) {
      console.error('Error creating class student:', err);
      return { success: false, error: err.message || 'Failed to create student' };
    }
  }



  private async getAuthHeaders(): Promise<HttpHeaders> {

    const token = await Preferences.get({ key: 'authToken' });

    return new HttpHeaders({

      'Authorization': `Bearer ${token.value || ''}`,

      'Content-Type': 'application/json'

    });

  }



  /**

   * Delete a student from a class roster

   */

  async deleteClassStudent(

    classId: number,

    studentId: number

  ): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const rosterRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'students', String(studentId));
      const rosterSnap = await getDoc(rosterRef);
      if (!rosterSnap.exists()) {
        return { success: true };
      }

      await deleteDoc(rosterRef);

      const classRef = doc(db, 'teachers', teacherId, 'classes', String(classId));
      await updateDoc(classRef, { student_count: increment(-1) });
      return { success: true };

    } catch (err: any) {

      console.error('Error deleting class student:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to delete student' };

    }

  }



  /**

   * Unenroll student from a subject (keeps them in class roster)

   */

  async unenrollStudentFromSubject(

    classId: number,

    subjectId: number,

    studentId: number

  ): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const enrollmentRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(subjectId),
        'enrollments',
        String(studentId)
      );

      const enrollmentSnap = await getDoc(enrollmentRef);
      if (!enrollmentSnap.exists()) {
        return { success: true };
      }

      await deleteDoc(enrollmentRef);

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      await updateDoc(subjectRef, { student_count: increment(-1) });

      return { success: true };

    } catch (err: any) {

      console.error('Error unenrolling student:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to unenroll student' };

    }

  }



  /**

   * Get students enrolled in a subject

   */

  async getSubjectStudents(subjectId: number): Promise<ClassStudent[]> {

    return this.getSubjectStudentsForClass(0, subjectId);

  }



  async getSubjectStudentsForClass(classId: number, subjectId: number): Promise<ClassStudent[]> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(
          db,
          'teachers',
          teacherId,
          'classes',
          String(classId),
          'subjects',
          String(subjectId),
          'enrollments'
        ),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          email: data.email ?? null,
          roll_number: data.roll_number ?? null,
          enrollment_date: data.enrollment_date ? String(data.enrollment_date) : undefined
        };
      });
    } catch (err) {
      console.error('Error fetching subject students:', err);
      return [];
    }
  }



  /**

   * Enroll an existing class student into a subject

   */

  /**
   * Update a student's roll number in class roster and subject enrollment.
   * Use when scan extracts roll number and we want to sync it to the profile.
   */
  async updateStudentRollNumber(
    classId: number,
    subjectId: number,
    studentId: number,
    rollNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      const roll = String(rollNumber || '').trim();

      const rosterRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'students', String(studentId));
      await updateDoc(rosterRef, { roll_number: roll || null });

      const enrollmentRef = doc(
        db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId),
        'enrollments', String(studentId)
      );
      const enrSnap = await getDoc(enrollmentRef);
      if (enrSnap.exists()) {
        await updateDoc(enrollmentRef, { roll_number: roll || null });
      }

      return { success: true };
    } catch (err: any) {
      console.error('Error updating roll number:', err);
      return { success: false, error: err?.message || 'Failed to update roll number' };
    }
  }

  async enrollStudentToSubject(

    classId: number,

    subjectId: number,

    studentId: number

  ): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const enrollmentRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(subjectId),
        'enrollments',
        String(studentId)
      );

      const existingEnrollment = await getDoc(enrollmentRef);
      if (existingEnrollment.exists()) {
        return { success: true };
      }

      const rosterDoc = await getDoc(
        doc(db, 'teachers', teacherId, 'classes', String(classId), 'students', String(studentId))
      );
      if (!rosterDoc.exists()) {
        return { success: false, error: 'Student not found in class roster' };
      }

      const roster: any = rosterDoc.data();

      await setDoc(
        enrollmentRef,
        {
          id: Number(roster.id || studentId),
          name: roster.name || '',
          email: roster.email ?? null,
          roll_number: roster.roll_number ?? null,
          enrollment_date: new Date().toISOString(),
          createdAt: Date.now()
        },
        { merge: true }
      );

      const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId));
      await updateDoc(subjectRef, { student_count: increment(1) });

      return { success: true };

    } catch (err: any) {

      console.error('Error enrolling student:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to enroll student' };

    }

  }



  /**

   * Copy/Move student enrollment between subjects

   */

  async transferStudentEnrollment(payload: {

    classId: number;

    source_subject_id: number;

    student_id: number;

    target_subject_id: number;

    mode: 'copy' | 'move';

  }): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      const studentId = payload.student_id;
      const classId = payload.classId;

      const sourceRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(payload.source_subject_id),
        'enrollments',
        String(studentId)
      );

      const targetRef = doc(
        db,
        'teachers',
        teacherId,
        'classes',
        String(classId),
        'subjects',
        String(payload.target_subject_id),
        'enrollments',
        String(studentId)
      );

      const sourceSnap = await getDoc(sourceRef);
      if (!sourceSnap.exists()) {
        return { success: false, error: 'Source enrollment not found' };
      }

      const targetAlreadyExists = (await getDoc(targetRef)).exists();

      await setDoc(targetRef, { ...sourceSnap.data(), createdAt: Date.now() }, { merge: true });

      if (!targetAlreadyExists) {
        const targetSubjectRef = doc(
          db,
          'teachers',
          teacherId,
          'classes',
          String(classId),
          'subjects',
          String(payload.target_subject_id)
        );
        await updateDoc(targetSubjectRef, { student_count: increment(1) });
      }

      if (payload.mode === 'move') {
        await deleteDoc(sourceRef);

        const sourceSubjectRef = doc(
          db,
          'teachers',
          teacherId,
          'classes',
          String(classId),
          'subjects',
          String(payload.source_subject_id)
        );
        await updateDoc(sourceSubjectRef, { student_count: increment(-1) });
      }

      return { success: true };

    } catch (err: any) {

      console.error('Error transferring enrollment:', err);

      return { success: false, error: err.error?.error || err.message || 'Failed to transfer enrollment' };

    }

  }



  async getClasses(options?: { refresh?: boolean }): Promise<ClassData[]> {
    const useCache = !options?.refresh && this.classesCache &&
      (Date.now() - this.classesCache.at) < TeacherService.CACHE_TTL_MS;
    if (useCache && this.classesCache) return this.classesCache.data;

    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(db, 'teachers', teacherId, 'classes'),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);
      const baseClasses: ClassData[] = snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          grade_level: data.grade_level ? String(data.grade_level) : undefined,
          student_count: data.student_count !== undefined ? Number(data.student_count) : 0
        };
      });

      const hydratedBase = await Promise.all(
        baseClasses.map(async (cls) => {
          try {
            const rosterSnap = await getDocs(
              collection(db, 'teachers', teacherId, 'classes', String(cls.id), 'students')
            );
            const count = rosterSnap.size;

            if (count === Number(cls.student_count || 0)) {
              return cls;
            }

            const classRef = doc(db, 'teachers', teacherId, 'classes', String(cls.id));
            await updateDoc(classRef, { student_count: count });
            return { ...cls, student_count: count };
          } catch {
            return cls;
          }
        })
      );

      const classesWithSubjects = await Promise.all(
        hydratedBase.map(async (cls) => {
          const subjects = await this.getClassSubjects(cls.id);
          return { ...cls, subjects };
        })
      );

      this.classesCache = { data: classesWithSubjects, at: Date.now() };
      this.classesSubject.next(classesWithSubjects);
      return classesWithSubjects;
    } catch (err) {
      console.error('Error fetching classes:', err);
      return [];
    }
  }



  async getClassSubjects(classId: number, options?: { refresh?: boolean }): Promise<Subject[]> {
    const cached = this.subjectsCache.get(classId);
    const useCache = !options?.refresh && cached &&
      (Date.now() - cached.at) < TeacherService.CACHE_TTL_MS;
    if (useCache && cached) return cached.data;

    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const q = query(
        collection(db, 'teachers', teacherId, 'classes', String(classId), 'subjects'),
        orderBy('createdAt', 'desc')
      );

      const snap = await getDocs(q);

      const subjects = snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: Number(data.id),
          name: String(data.name || ''),
          code: data.code ? String(data.code) : undefined,
          description: data.description ?? null,
          total_marks: data.total_marks !== undefined ? Number(data.total_marks) : undefined,
          student_count: data.student_count !== undefined ? Number(data.student_count) : undefined,
          class_id: Number(classId)
        } as Subject;
      });

      const hydrated = await Promise.all(
        subjects.map(async (sub) => {
          if (typeof sub.student_count === 'number') return sub;

          try {
            const enrollSnap = await getDocs(
              collection(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(sub.id), 'enrollments')
            );
            const count = enrollSnap.size;
            const subjectRef = doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(sub.id));
            await updateDoc(subjectRef, { student_count: count });
            return { ...sub, student_count: count };
          } catch {
            return { ...sub, student_count: 0 };
          }
        })
      );

      this.subjectsCache.set(classId, { data: hydrated, at: Date.now() });
      return hydrated;
    } catch (err) {
      console.error('Error fetching class subjects:', err);
      return [];
    }
  }



  async createClass(
    className: string,
    gradLevel?: string
  ): Promise<{ success: boolean; class?: ClassData; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const id = Date.now();
      const newClass: ClassData = {
        id,
        name: className,
        grade_level: gradLevel || undefined,
        student_count: 0,
        subjects: []
      };

      await setDoc(doc(db, 'teachers', teacherId, 'classes', String(id)), {
        id,
        name: className,
        grade_level: gradLevel || '',
        student_count: 0,
        createdAt: Date.now()
      });

      await this.getClasses({ refresh: true });
      return { success: true, class: newClass };
    } catch (err: any) {
      console.error('Error creating class:', err);
      return { success: false, error: err.message || 'Failed to create class' };
    }
  }



  async deleteClass(classId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      await deleteDoc(doc(db, 'teachers', teacherId, 'classes', String(classId)));
      this.subjectsCache.delete(classId);
      await this.getClasses({ refresh: true });
      return { success: true };
    } catch (err: any) {
      console.error('Error deleting class:', err);
      return { success: false, error: err.message || 'Failed to delete class' };
    }
  }



  async createSubject(payload: {
    name: string;
    code?: string;
    class_id: number;
    description?: string;
    total_marks?: number;
  }): Promise<{ success: boolean; subject?: Subject; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      const id = Date.now();

      const subject: Subject = {
        id,
        name: payload.name,
        code: payload.code,
        description: payload.description ?? null,
        total_marks: payload.total_marks,
        class_id: payload.class_id
      };

      await setDoc(
        doc(db, 'teachers', teacherId, 'classes', String(payload.class_id), 'subjects', String(id)),
        {
          id,
          name: payload.name,
          code: payload.code || '',
          description: payload.description || '',
          total_marks: payload.total_marks ?? null,
          class_id: payload.class_id,
          student_count: 0,
          createdAt: Date.now()
        }
      );

      this.subjectsCache.delete(payload.class_id);
      return { success: true, subject };
    } catch (err: any) {
      console.error('Error creating subject:', err);
      return { success: false, error: err.message || 'Failed to create subject' };
    }
  }



  async deleteSubject(classId: number, subjectId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();
      await deleteDoc(doc(db, 'teachers', teacherId, 'classes', String(classId), 'subjects', String(subjectId)));
      this.subjectsCache.delete(classId);
      this.tosCache.delete(`${classId}:${subjectId}`);
      return { success: true };
    } catch (err: any) {
      console.error('Error deleting subject:', err);
      return { success: false, error: err.message || 'Failed to delete subject' };
    }
  }



  /**

   * Update teacher profile information

   */

  async updateProfile(profileData: any): Promise<{ success: boolean; error?: string }> {

    try {

      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const payload: any = {
        name: profileData?.name ?? '',
        email: profileData?.email ?? '',
        schoolId: profileData?.schoolId ?? '',
        bio: profileData?.bio ?? ''
      };

      await setDoc(doc(db, 'users', teacherId), {
        ...payload,
        updatedAt: Date.now()
      }, { merge: true });

      return { success: true };

    } catch (err: any) {

      console.error('Error updating profile:', err);

      return { success: false, error: err.message || 'Failed to update profile' };

    }

  }



  async getMyProfile(): Promise<{ success: boolean; profile?: any; error?: string }> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const snap = await getDoc(doc(db, 'users', teacherId));
      if (!snap.exists()) {
        return { success: true, profile: null };
      }

      return { success: true, profile: snap.data() };
    } catch (err: any) {
      console.error('Error loading profile:', err);
      return { success: false, error: err.message || 'Failed to load profile' };
    }
  }

  /**
   * Count total generated questions across all subjects for the teacher.
   * Used by the dashboard to display the "Questions Generated" stat.
   */
  async getTotalGeneratedQuestions(): Promise<number> {
    try {
      const teacherId = await this.getTeacherId();
      const db = firebaseDb();

      const classesSnap = await getDocs(collection(db, 'teachers', teacherId, 'classes'));
      let total = 0;

      for (const classDoc of classesSnap.docs) {
        const classId = classDoc.id;
        const subjectsSnap = await getDocs(
          collection(db, 'teachers', teacherId, 'classes', classId, 'subjects')
        );

        for (const subjectDoc of subjectsSnap.docs) {
          const data = subjectDoc.data();
          const questions: any[] = Array.isArray(data?.['questions']) ? data['questions'] : [];
          total += questions.length;
        }
      }

      return total;
    } catch (err) {
      console.error('Error counting generated questions:', err);
      return 0;
    }
  }

}

