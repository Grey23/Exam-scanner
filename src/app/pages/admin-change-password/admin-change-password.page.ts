import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { AdminSidebarComponent } from '../admin-sidebar/admin-sidebar.component';
import { AdminService } from '../../services/admin.service';
import { firebaseDb } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { AuthService, User } from '../../services/auth.service';

@Component({
  selector: 'app-admin-change-password',
  templateUrl: './admin-change-password.page.html',
  styleUrls: ['./admin-change-password.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminSidebarComponent]
})
export class AdminChangePasswordPage implements OnInit {
  currentUser: User | null = null;

  isLoadingUsers = false;
  users: User[] = [];
  userSearch = '';

  selectedUid: string | null = null;
  newPassword = '';
  confirmPassword = '';

  isSubmitting = false;

  constructor(
    private authService: AuthService,
    private adminService: AdminService,
    private toastController: ToastController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ngOnInit() {
    void this.loadUsers();
  }

  async loadUsers() {
    this.isLoadingUsers = true;
    try {
      const db = firebaseDb();
      const snap = await getDocs(collection(db, 'users'));

      this.users = snap.docs.map((d) => {
        const data: any = d.data() || {};

        const userTypeRaw = data.userType as User['userType'] | undefined;
        const userType =
          userTypeRaw === 'admin' || userTypeRaw === 'school' || userTypeRaw === 'teacher'
            ? userTypeRaw
            : 'teacher';

        return {
          id: d.id,
          email: String(data.email ?? ''),
          name: String(data.name ?? ''),
          userType,
          schoolName: data.schoolName ?? undefined,
          schoolId: data.schoolId ?? undefined
        };
      });

      if (!this.selectedUid && this.users.length) {
        this.selectedUid = this.users[0].id;
      }
    } catch (err) {
      console.error('AdminChangePasswordPage: loadUsers failed', err);
      this.users = [];
      await this.showToast('Failed to load users');
    } finally {
      this.isLoadingUsers = false;
    }
  }

  get filteredUsers(): User[] {
    const q = this.userSearch.trim().toLowerCase();
    if (!q) return this.users;

    return this.users.filter((u) => {
      return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    });
  }

  async submit() {
    if (!this.selectedUid) {
      await this.showToast('Select a user.');
      return;
    }

    const pw = (this.newPassword || '').trim();
    const cpw = (this.confirmPassword || '').trim();

    if (!pw || pw.length < 6) {
      await this.showToast('Password must be at least 6 characters.');
      return;
    }

    if (pw !== cpw) {
      await this.showToast('Passwords do not match.');
      return;
    }

    this.isSubmitting = true;
    try {
      const res = await this.adminService.setUserPassword(this.selectedUid, pw);
      if (res.success) {
        this.newPassword = '';
        this.confirmPassword = '';
        await this.showToast('Password updated.');
      } else {
        await this.showToast(res.message || 'Failed to update password.');
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2400,
      position: 'top'
    });
    await toast.present();
  }
}
