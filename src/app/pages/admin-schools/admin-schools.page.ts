import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { ToastController, AlertController } from '@ionic/angular';

@Component({
  selector: 'app-admin-schools',
  templateUrl: './admin-schools.page.html',
  styleUrls: ['./admin-schools.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AdminSchoolsPage implements OnInit {
  schools: any[] = [];
  filteredSchools: any[] = [];
  isLoading = false;
  showAddModal = false;
  newSchoolName = '';
  editingSchool: any = null;
  editSchoolName = '';
  searchQuery = '';

  // Stats
  totalSchools = 0;
  totalTeachers = 0;
  totalRegistered = 0;

  constructor(
    private adminService: AdminService,
    private router: Router,
    private toastController: ToastController,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    this.loadSchools();
  }

  async loadSchools() {
    this.isLoading = true;
    try {
      const result = await this.adminService.getSchools();
      if (result.success && result.data?.schools) {
        this.schools = result.data.schools;
        this.filteredSchools = [...this.schools];
        this.updateStats();
      } else {
        this.showToast(result.message || 'Failed to load schools', 'danger');
      }
    } catch (err) {
      console.error('Error loading schools:', err);
      this.showToast('Failed to load schools', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  updateStats() {
    this.totalSchools = this.schools.length;
    this.totalTeachers = this.schools.reduce((sum, s) => sum + (s.teacherCount || 0), 0);
    this.totalRegistered = this.schools.reduce((sum, s) => sum + (s.registeredCount || 0), 0);
  }

  filterSchools() {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) {
      this.filteredSchools = [...this.schools];
    } else {
      this.filteredSchools = this.schools.filter(s =>
        s.name.toLowerCase().includes(query)
      );
    }
  }

  openAddModal() {
    this.newSchoolName = '';
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
    this.newSchoolName = '';
  }

  async addSchool() {
    if (!this.newSchoolName.trim()) {
      this.showToast('Please enter a school name', 'warning');
      return;
    }

    this.isLoading = true;
    try {
      const result = await this.adminService.createSchool(this.newSchoolName.trim());
      if (result.success) {
        this.showToast('School created successfully', 'success');
        this.closeAddModal();
        await this.loadSchools();
      } else {
        this.showToast(result.message || 'Failed to create school', 'danger');
      }
    } catch (err) {
      console.error('Error creating school:', err);
      this.showToast('Failed to create school', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  openEditModal(school: any) {
    this.editingSchool = school;
    this.editSchoolName = school.name;
  }

  closeEditModal() {
    this.editingSchool = null;
    this.editSchoolName = '';
  }

  async updateSchool() {
    if (!this.editSchoolName.trim()) {
      this.showToast('Please enter a school name', 'warning');
      return;
    }

    this.isLoading = true;
    try {
      const result = await this.adminService.updateSchool(this.editingSchool.id, this.editSchoolName.trim());
      if (result.success) {
        this.showToast('School updated successfully', 'success');
        this.closeEditModal();
        await this.loadSchools();
      } else {
        this.showToast(result.message || 'Failed to update school', 'danger');
      }
    } catch (err) {
      console.error('Error updating school:', err);
      this.showToast('Failed to update school', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  async deleteSchool(school: any) {
    const alert = await this.alertController.create({
      header: 'Delete School',
      message: `Are you sure you want to delete "${school.name}"? This will also delete all teachers in its roster. This action cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            this.isLoading = true;
            try {
              const result = await this.adminService.deleteSchool(school.id);
              if (result.success) {
                this.showToast('School deleted successfully', 'success');
                await this.loadSchools();
              } else {
                this.showToast(result.message || 'Failed to delete school', 'danger');
              }
            } catch (err) {
              console.error('Error deleting school:', err);
              this.showToast('Failed to delete school', 'danger');
            } finally {
              this.isLoading = false;
            }
          }
        }
      ]
    });
    await alert.present();
  }

  viewRoster(school: any) {
    this.router.navigate(['/admin-roster', school.id], {
      state: { schoolName: school.name }
    });
  }

  formatDate(timestamp: any): string {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      position: 'top',
      color
    });
    await toast.present();
  }
}
