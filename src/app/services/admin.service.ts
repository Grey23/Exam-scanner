import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { AuthService } from './auth.service';
import { Preferences } from '@capacitor/preferences';
import { firebaseAuth } from '../firebase';

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private apiUrl = `${environment.apiBaseUrl}/admin`;

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  private async getHeaders(): Promise<HttpHeaders> {
    let token = this.authService.getToken();

    try {
      const auth = firebaseAuth();
      const current = auth.currentUser;
      if (current) {
        token = await current.getIdToken();
      }
    } catch {
      // ignore, fallback to stored token
    }

    if (!token) {
      try {
        const stored = await Preferences.get({ key: 'authToken' });
        if (stored.value) token = stored.value;
      } catch {
        // ignore
      }
    }

    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  async setUserPassword(uid: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.post(
        `${this.apiUrl}/users/set-password`,
        { uid, newPassword },
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to set password' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to set password' };
    }
  }

  async getSystemHealth(): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.get(
        `${this.apiUrl}/system/health`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to get system health' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to get system health' };
    }
  }

  async getDbStatus(): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.get(
        `${this.apiUrl}/system/db`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to get DB status' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to get DB status' };
    }
  }

  async getDashboardMetrics(): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.get(
        `${this.apiUrl}/metrics/dashboard`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to load dashboard metrics' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to load dashboard metrics' };
    }
  }

  async getUsers(page = 1, limit = 10, search = ''): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const params: any = { page: String(page), limit: String(limit) };
      if (search) params.search = search;

      const res: any = await this.http.get(
        `${this.apiUrl}/users`,
        { headers, params }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to load users' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to load users' };
    }
  }

  async updateUser(uid: string, updates: { name?: string; email?: string; userType?: string; schoolName?: string; schoolId?: string }): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.put(
        `${this.apiUrl}/users/${uid}`,
        updates,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to update user' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to update user' };
    }
  }

  async deleteUser(uid: string): Promise<{ success: boolean; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.delete(
        `${this.apiUrl}/users/${uid}`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to delete user' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to delete user' };
    }
  }

  // =====================================================
  // SCHOOLS MANAGEMENT
  // =====================================================

  async getSchools(): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.get(
        `${this.apiUrl}/schools`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to load schools' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to load schools' };
    }
  }

  async createSchool(name: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.post(
        `${this.apiUrl}/schools`,
        { name },
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to create school' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to create school' };
    }
  }

  async updateSchool(schoolId: string, name: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.put(
        `${this.apiUrl}/schools/${schoolId}`,
        { name },
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to update school' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to update school' };
    }
  }

  async deleteSchool(schoolId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.delete(
        `${this.apiUrl}/schools/${schoolId}`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to delete school' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to delete school' };
    }
  }

  // =====================================================
  // TEACHER ROSTER MANAGEMENT
  // =====================================================

  async getRoster(schoolId: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.get(
        `${this.apiUrl}/schools/${schoolId}/roster`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to load roster' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to load roster' };
    }
  }

  async importRoster(schoolId: string, teachers: any[]): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.post(
        `${this.apiUrl}/schools/${schoolId}/roster/import`,
        { teachers },
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to import roster' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to import roster' };
    }
  }

  async deleteFromRoster(schoolId: string, teacherId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.delete(
        `${this.apiUrl}/schools/${schoolId}/roster/${teacherId}`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to delete teacher from roster' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to delete teacher from roster' };
    }
  }

  async addToRoster(
    schoolId: string,
    teacherId: string,
    name: string
  ): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.post(
        `${this.apiUrl}/schools/${schoolId}/roster`,
        { teacherId, name },
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to add teacher' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to add teacher' };
    }
  }

  async updateRosterTeacher(
    schoolId: string,
    teacherId: string,
    name: string,
    newTeacherId?: string,
    newSchoolId?: string
  ): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const body: any = { name };
      if (newTeacherId && newTeacherId !== teacherId) {
        body.teacherId = newTeacherId;
      }
      if (newSchoolId && newSchoolId !== schoolId) {
        body.schoolId = newSchoolId;
      }

      const res: any = await this.http.put(
        `${this.apiUrl}/schools/${schoolId}/roster/${teacherId}`,
        body,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to update teacher' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to update teacher' };
    }
  }

  async checkTeacherId(teacherId: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.get(
        `${this.apiUrl}/roster/check-teacher-id`,
        { headers, params: { teacherId } }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to check teacher ID' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to check teacher ID' };
    }
  }

  async markTeacherRegistered(teacherId: string, uid: string, email: string): Promise<{ success: boolean; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.post(
        `${this.apiUrl}/roster/mark-registered`,
        { teacherId, uid, email },
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to mark teacher as registered' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to mark teacher as registered' };
    }
  }

  async exportRoster(schoolId: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const headers = await this.getHeaders();
      const res: any = await this.http.get(
        `${this.apiUrl}/schools/${schoolId}/export`,
        { headers }
      ).toPromise();

      if (res?.success) {
        return { success: true, data: res.data };
      }

      return { success: false, message: res?.error || res?.message || 'Failed to export roster' };
    } catch (err: any) {
      return { success: false, message: err?.error?.message || err?.message || 'Failed to export roster' };
    }
  }
}
