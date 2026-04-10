import { Injectable } from '@angular/core';

import { HttpClient, HttpHeaders } from '@angular/common/http';

import { Preferences } from '@capacitor/preferences';

import { BehaviorSubject, Observable } from 'rxjs';

import { map } from 'rxjs/operators';

import { environment } from 'src/environments/environment';

import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, serverTimestamp, setDoc, getDoc } from 'firebase/firestore';
import { firebaseAuth, firebaseDb } from '../firebase';
import { TeacherService } from './teacher.service';



export interface User {

  id: string;

  email: string;

  name: string;

  userType: 'teacher' | 'admin' | 'school'; // 'school' is legacy, treated as 'admin'

  schoolName?: string;

  schoolId?: string | number;

  teacherId?: string;

}



export interface AuthState {

  isAuthenticated: boolean;

  user: User | null;

  token: string | null;

}



@Injectable({

  providedIn: 'root'

})

export class AuthService {

  private authSubject = new BehaviorSubject<AuthState>({

    isAuthenticated: false,

    user: null,

    token: null

  });



  public auth$ = this.authSubject.asObservable();



  constructor(
    private http: HttpClient,
    private teacherService: TeacherService
  ) {
    this.checkAuth();
  }



  async checkAuth(): Promise<void> {

    try {

      const stored = await Preferences.get({ key: 'currentUser' });

      const storedToken = await Preferences.get({ key: 'authToken' });

      

      if (stored.value && storedToken.value) {

        const user = JSON.parse(stored.value);

        this.authSubject.next({

          isAuthenticated: true,

          user,

          token: storedToken.value

        });

      }

    } catch (err) {

      console.error('checkAuth error:', err);

      // Continue without auth on error

      this.authSubject.next({

        isAuthenticated: false,

        user: null,

        token: null

      });

    }

  }



  async register(

    email: string,

    password: string,

    name: string,

    userType: 'teacher' | 'admin',

    schoolName?: string,

    teacherId?: string

  ): Promise<{ success: boolean; message: string }> {

    try {

      // For teachers, validate Teacher ID against roster
      if (userType === 'teacher' && teacherId) {
        const checkResult = await this.checkTeacherId(teacherId);
        if (!checkResult.success) {
          return { success: false, message: checkResult.message || 'Failed to verify Teacher ID' };
        }
        if (!checkResult.data?.valid) {
          return { success: false, message: checkResult.data?.reason || 'Invalid Teacher ID' };
        }
      }

      const auth = firebaseAuth();

      const db = firebaseDb();

      const creds = await createUserWithEmailAndPassword(auth, email, password);

      const token = await creds.user.getIdToken();

      const profile: User = {

        id: creds.user.uid,

        email: creds.user.email || email,

        name,

        userType,

        schoolName: schoolName || undefined,

        teacherId: teacherId || undefined

      };

      await setDoc(doc(db, 'users', creds.user.uid), {

        email: profile.email,

        name: profile.name,

        userType: profile.userType,

        schoolName: profile.schoolName || null,

        teacherId: profile.teacherId || null,

        createdAt: serverTimestamp()

      }, { merge: true });

      // Mark teacher as registered in roster
      if (userType === 'teacher' && teacherId) {
        await this.markTeacherRegistered(teacherId, creds.user.uid, email);
      }

      await Preferences.set({ key: 'authToken', value: token });

      await Preferences.set({ key: 'currentUser', value: JSON.stringify(profile) });

      this.authSubject.next({

        isAuthenticated: true,

        user: profile,

        token

      });

      return { success: true, message: 'Registration successful' };

    } catch (err: any) {

      console.error('AuthService: Caught exception:', err);

      // Extract error message from different possible error structures

      let errorMessage = 'Registration failed';

      console.log('Error structure:', {

        'err.error': err.error,

        'err.message': err.message,

        'err.status': err.status,

        'err.statusText': err.statusText

      });

      if (err.error) {

        if (typeof err.error === 'string') {

          errorMessage = err.error;

        } else if (err.error.error) {

          errorMessage = err.error.error;

        } else if (err.error.message) {

          errorMessage = err.error.message;

        }

      } else if (err.message) {

        errorMessage = err.message;

      }

      console.error('AuthService: Final error message:', errorMessage);

      return { success: false, message: errorMessage };

    }

  }

  // Check if Teacher ID is valid for registration
  async checkTeacherId(teacherId: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getAuthHeaders();
      const res: any = await this.http.get(
        `${environment.apiBaseUrl}/admin/roster/check-teacher-id`,
        { headers, params: { teacherId } }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to check Teacher ID' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to check Teacher ID' };
    }
  }

  // Mark teacher as registered in roster
  private async markTeacherRegistered(teacherId: string, uid: string, email: string): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      await this.http.post(
        `${environment.apiBaseUrl}/admin/roster/mark-registered`,
        { teacherId, uid, email },
        { headers }
      ).toPromise();
    } catch (err) {
      console.error('Failed to mark teacher as registered:', err);
      // Don't fail registration if this fails
    }
  }

  private async getAuthHeaders(): Promise<HttpHeaders> {
    const auth = firebaseAuth();
    const current = auth.currentUser;
    let token = this.getToken();

    if (current && !token) {
      token = await current.getIdToken();
    }

    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }



  async login(email: string, password: string): Promise<{ success: boolean; message: string }> {

    try {

      const auth = firebaseAuth();

      const creds = await signInWithEmailAndPassword(auth, email, password);

      const token = await creds.user.getIdToken();

      // Hydrate profile from Firestore so settings (name/schoolId/userType) persist across logout/login.
      let profileName = String(creds.user.displayName || '');
      let profileUserType: any = 'teacher';
      let profileSchoolId: any = undefined;
      let profileSchoolName: any = undefined;

      try {
        const db = firebaseDb();
        const snap = await getDoc(doc(db, 'users', creds.user.uid));
        if (snap.exists()) {
          const data: any = snap.data();
          if (data?.name) profileName = String(data.name);
          if (data?.userType) profileUserType = String(data.userType);
          if (data?.schoolId !== undefined && data?.schoolId !== null) profileSchoolId = data.schoolId;
          if (data?.schoolName) profileSchoolName = String(data.schoolName);
        }
      } catch (e) {
        console.error('AuthService.login: failed to hydrate user profile from Firestore', e);
      }

      const user: User = {
        id: creds.user.uid,
        email: creds.user.email || email,
        name: profileName,
        userType: (profileUserType === 'admin' || profileUserType === 'school') ? profileUserType : 'teacher',
        schoolId: profileSchoolId,
        schoolName: profileSchoolName
      };

      await Preferences.set({ key: 'authToken', value: token });

      await Preferences.set({ key: 'currentUser', value: JSON.stringify(user) });

      this.authSubject.next({

        isAuthenticated: true,

        user,

        token

      });

      return { success: true, message: 'Login successful' };

    } catch (err: any) {

      const errorMessage = err?.message || 'Login failed';

      return { success: false, message: errorMessage };

    }

    return { success: false, message: 'Login failed' };

  }



  async logout(): Promise<void> {
    try {
      const auth = firebaseAuth();
      await signOut(auth);
    } catch (err) {
      console.error('Logout failed:', err);
    }

    // Only clear auth session keys, preserve app data like examData and settings
    await Preferences.remove({ key: 'currentUser' });
    await Preferences.remove({ key: 'authToken' });

    this.teacherService.clearTeacherIdCache();

    this.authSubject.next({
      isAuthenticated: false,
      user: null,
      token: null
    });

  }



  getCurrentUser(): User | null {

    return this.authSubject.value.user;

  }



  async patchCurrentUser(patch: Partial<User>): Promise<void> {

    const current = this.authSubject.value.user;

    let baseUser: User | null = current;

    if (!baseUser) {

      try {

        const stored = await Preferences.get({ key: 'currentUser' });

        baseUser = stored.value ? (JSON.parse(stored.value) as User) : null;

      } catch {

        baseUser = null;

      }

    }

    if (!baseUser) {

      return;

    }

    const nextUser: User = {

      ...baseUser,

      ...patch

    };

    await Preferences.set({ key: 'currentUser', value: JSON.stringify(nextUser) });

    this.authSubject.next({

      ...this.authSubject.value,

      isAuthenticated: true,

      user: nextUser

    });

  }



  getToken(): string | null {

    return this.authSubject.value.token;

  }



  isAuthenticated(): boolean {

    return this.authSubject.value.isAuthenticated;

  }



  isAdmin(): boolean {

    const user = this.authSubject.value.user;

    return user?.userType === 'admin' || user?.userType === 'school';

  }



  isTeacher(): boolean {

    const user = this.authSubject.value.user;

    return user?.userType === 'teacher';

  }

}

