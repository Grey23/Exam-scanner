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
}
