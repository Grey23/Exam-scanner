import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController, ModalController } from '@ionic/angular';
import { AdminSidebarComponent } from '../admin-sidebar/admin-sidebar.component';
import { AuthService, User } from '../../services/auth.service';
import { AdminService } from '../../services/admin.service';

@Component({
  selector: 'app-admin-users',
  templateUrl: './admin-users.page.html',
  styleUrls: ['./admin-users.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminSidebarComponent]
})
export class AdminUsersPage implements OnInit {
  currentUser: User | null = null;

  isLoading = false;
  users: any[] = [];
  userSearch = '';

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalUsers = 0;
  totalPages = 0;

  // Filter
  userFilter: 'all' | 'admin' | 'teacher' = 'all';

  // Edit modal
  isEditModalOpen = false;
  editingUser: any = null;
  editForm = { name: '', email: '', userType: 'teacher', schoolName: '' };

  // Password modal
  isPasswordModalOpen = false;
  passwordUser: any = null;
  newPassword = '';
  confirmPassword = '';
  isSavingPassword = false;

  constructor(
    private authService: AuthService,
    private adminService: AdminService,
    private toastController: ToastController,
    private alertController: AlertController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ngOnInit() {
    void this.loadUsers();
  }

  async loadUsers() {
    this.isLoading = true;
    try {
      const res = await this.adminService.getUsers(this.currentPage, this.pageSize, this.userSearch);
      if (res.success && res.data) {
        let allUsers = res.data.users || [];

        // Apply client-side filter
        if (this.userFilter === 'admin') {
          allUsers = allUsers.filter((u: any) => u.userType === 'admin' || u.userType === 'school');
        } else if (this.userFilter === 'teacher') {
          allUsers = allUsers.filter((u: any) => u.userType === 'teacher');
        }

        this.users = allUsers;
        const pag = res.data.pagination;
        this.totalUsers = pag.total;
        this.totalPages = pag.totalPages;
        this.currentPage = pag.page;
      } else {
        await this.showToast(res.message || 'Failed to load users');
        this.users = [];
      }
    } catch (err) {
      console.error('AdminUsersPage: loadUsers failed', err);
      this.users = [];
      await this.showToast('Failed to load users');
    } finally {
      this.isLoading = false;
    }
  }

  setFilter(filter: 'all' | 'admin' | 'teacher') {
    this.userFilter = filter;
    this.currentPage = 1;
    void this.loadUsers();
  }

  async onSearch() {
    this.currentPage = 1;
    await this.loadUsers();
  }

  async prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      await this.loadUsers();
    }
  }

  async nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      await this.loadUsers();
    }
  }

  userTypeLabel(user: any): string {
    if (user.userType === 'school' || user.userType === 'admin') return 'Admin';
    return 'Teacher';
  }

  // Edit user
  openEditModal(user: any) {
    this.editingUser = user;
    this.editForm = {
      name: user.name || '',
      email: user.email || '',
      userType: user.userType || 'teacher',
      schoolName: user.schoolName || ''
    };
    this.isEditModalOpen = true;
  }

  closeEditModal() {
    this.isEditModalOpen = false;
    this.editingUser = null;
  }

  async saveEdit() {
    if (!this.editingUser) return;

    const updates: any = {};
    if (this.editForm.name !== this.editingUser.name) updates.name = this.editForm.name;
    if (this.editForm.email !== this.editingUser.email) updates.email = this.editForm.email;
    if (this.editForm.userType !== this.editingUser.userType) updates.userType = this.editForm.userType;
    if (this.editForm.schoolName !== (this.editingUser.schoolName || '')) updates.schoolName = this.editForm.schoolName || null;

    if (Object.keys(updates).length === 0) {
      await this.showToast('No changes detected');
      return;
    }

    const res = await this.adminService.updateUser(this.editingUser.id, updates);
    if (res.success) {
      await this.showToast('User updated');
      this.closeEditModal();
      await this.loadUsers();
    } else {
      await this.showToast(res.message || 'Failed to update user');
    }
  }

  // Delete user
  async deleteUser(user: any) {
    const alert = await this.alertController.create({
      header: 'Delete User',
      message: `Are you sure you want to delete "${user.name || user.email}"? This cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            const res = await this.adminService.deleteUser(user.id);
            if (res.success) {
              await this.showToast('User deleted');
              await this.loadUsers();
            } else {
              await this.showToast(res.message || 'Failed to delete user');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  // Password change
  openPasswordModal(user: any) {
    this.passwordUser = user;
    this.newPassword = '';
    this.confirmPassword = '';
    this.isPasswordModalOpen = true;
  }

  closePasswordModal() {
    this.isPasswordModalOpen = false;
    this.passwordUser = null;
  }

  async savePassword() {
    if (!this.passwordUser) return;

    const pw = this.newPassword.trim();
    const cpw = this.confirmPassword.trim();

    if (!pw || pw.length < 6) {
      await this.showToast('Password must be at least 6 characters');
      return;
    }

    if (pw !== cpw) {
      await this.showToast('Passwords do not match');
      return;
    }

    this.isSavingPassword = true;
    try {
      const res = await this.adminService.setUserPassword(this.passwordUser.id, pw);
      if (res.success) {
        await this.showToast('Password updated');
        this.closePasswordModal();
      } else {
        await this.showToast(res.message || 'Failed to update password');
      }
    } finally {
      this.isSavingPassword = false;
    }
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2200,
      position: 'top'
    });
    await toast.present();
  }
}
