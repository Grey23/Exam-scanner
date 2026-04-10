import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { ToastController, AlertController } from '@ionic/angular';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-admin-roster',
  templateUrl: './admin-roster.page.html',
  styleUrls: ['./admin-roster.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AdminRosterPage implements OnInit {
  schoolId = '';
  schoolName = '';
  teachers: any[] = [];
  filteredTeachers: any[] = [];
  pagedTeachers: any[] = [];
  isLoading = false;
  searchQuery = '';
  showImportModal = false;
  importData: any[] = [];
  importPreview: any[] = [];
  isImporting = false;
  selectedFile: File | null = null;

  // Pagination
  pageSize = 10;
  currentPage = 1;
  totalPages = 1;

  editingTeacher: any = null;
  editTeacherId = '';
  editTeacherName = '';
  editSchoolId = '';
  schools: any[] = [];

  showAddModal = false;
  newTeacherId = '';
  newTeacherName = '';

  // Stats
  totalTeachers = 0;
  registeredCount = 0;
  unregisteredCount = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private adminService: AdminService,
    private toastController: ToastController,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    this.schoolId = this.route.snapshot.paramMap.get('schoolId') || '';
    await this.loadSchools();
    await this.loadRoster();
  }

  async loadSchools() {
    try {
      const result = await this.adminService.getSchools();
      if (result.success && result.data) {
        this.schools = result.data.schools || [];
        // Set school name from the loaded schools
        const currentSchool = this.schools.find(s => s.id === this.schoolId);
        if (currentSchool) {
          this.schoolName = currentSchool.name;
        }
      }
    } catch (err) {
      console.error('Error loading schools:', err);
    }
  }

  async loadRoster() {
    this.isLoading = true;
    try {
      const result = await this.adminService.getRoster(this.schoolId);
      if (result.success && result.data?.teachers) {
        this.teachers = result.data.teachers;
        this.applyFilterSortAndPaging(true);
        this.updateStats();
      } else {
        this.showToast(result.message || 'Failed to load roster', 'danger');
      }
    } catch (err) {
      console.error('Error loading roster:', err);
      this.showToast('Failed to load roster', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  updateStats() {
    this.totalTeachers = this.teachers.length;
    this.registeredCount = this.teachers.filter(t => t.registered).length;
    this.unregisteredCount = this.totalTeachers - this.registeredCount;
  }

  filterTeachers() {
    this.applyFilterSortAndPaging(true);
  }

  private applyFilterSortAndPaging(resetToFirstPage: boolean) {
    const query = this.searchQuery.toLowerCase().trim();
    const base = !query
      ? [...this.teachers]
      : this.teachers.filter(t =>
          String(t?.name || '').toLowerCase().includes(query) ||
          String(t?.teacherId || '').toLowerCase().includes(query) ||
          (t?.email && String(t.email).toLowerCase().includes(query))
        );

    // Sort by last name (best with 'Last, First M.'), fallback to last token
    base.sort((a, b) => {
      const aKey = this.getLastNameSortKey(String(a?.name || ''));
      const bKey = this.getLastNameSortKey(String(b?.name || ''));
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) return cmp;
      return String(a?.name || '').localeCompare(String(b?.name || ''));
    });

    this.filteredTeachers = base;

    if (resetToFirstPage) {
      this.currentPage = 1;
    }

    this.totalPages = Math.max(1, Math.ceil(this.filteredTeachers.length / this.pageSize));
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }

    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.pagedTeachers = this.filteredTeachers.slice(start, end);
  }

  private getLastNameSortKey(name: string): string {
    const cleaned = String(name || '').trim();
    if (!cleaned) return '';

    // Preferred format: 'Last, First M.'
    const commaIndex = cleaned.indexOf(',');
    if (commaIndex > 0) {
      return cleaned.slice(0, commaIndex).trim().toLowerCase();
    }

    // Fallback: use last word as last name
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return (parts[parts.length - 1] || '').toLowerCase();
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.applyFilterSortAndPaging(false);
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.applyFilterSortAndPaging(false);
    }
  }

  openImportModal() {
    this.importData = [];
    this.importPreview = [];
    this.selectedFile = null;
    this.showImportModal = true;
  }

  closeImportModal() {
    this.showImportModal = false;
    this.importData = [];
    this.importPreview = [];
    this.selectedFile = null;
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    this.selectedFile = file;
    const reader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Skip header row and parse data
        const headers = jsonData[0] as string[];
        const teacherIdCol = this.findColumnIndex(headers, [
          'teacher_id',
          'teacherid',
          'teacher id',
          'teacher-id',
          'id'
        ]);
        const lastNameCol = this.findColumnIndex(headers, ['last name', 'lastname', 'surname', 'family name', 'last_name']);
        const firstNameCol = this.findColumnIndex(headers, ['first name', 'firstname', 'given name', 'first_name']);
        const midInitialCol = this.findColumnIndex(headers, ['mid initial', 'middle initial', 'mi', 'm.i.', 'middle', 'mid', 'middle_name', 'middle name']);

        // IMPORTANT: detect split columns first. We don't want a generic "name" match to accidentally
        // select "Last Name" or "First Name".
        const hasSplitName = lastNameCol !== -1 && firstNameCol !== -1;

        const nameCol = hasSplitName
          ? -1
          : this.findStrictNameColumnIndex(headers);
        if (teacherIdCol === -1 || (nameCol === -1 && !hasSplitName)) {
          this.showToast('Excel must have Teacher ID and either Name OR Last Name + First Name columns', 'warning');
          return;
        }

        this.importData = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (!row || row.length === 0) continue;

          const teacherId = String(row[teacherIdCol] || '').trim();
          let name = '';

          if (nameCol !== -1) {
            name = String(row[nameCol] || '').trim();
          } else if (hasSplitName) {
            const lastName = String(row[lastNameCol] || '').trim();
            const firstName = String(row[firstNameCol] || '').trim();
            const mid = midInitialCol !== -1 ? String(row[midInitialCol] || '').trim() : '';
            name = this.formatTeacherName(lastName, firstName, mid);
          }

          if (teacherId && name) {
            this.importData.push({ teacherId, name });
          }
        }

        this.importPreview = this.importData.slice(0, 10);
        this.showToast(`Found ${this.importData.length} teachers in file`, 'success');
      } catch (err) {
        console.error('Error parsing Excel:', err);
        this.showToast('Failed to parse Excel file', 'danger');
      }
    };

    reader.readAsArrayBuffer(file);
  }

  private formatTeacherName(lastName: string, firstName: string, midInitial: string): string {
    const ln = String(lastName || '').trim();
    const fn = String(firstName || '').trim();
    let mi = String(midInitial || '').trim();

    if (!ln || !fn) return '';

    // Keep only first character for middle initial
    if (mi) {
      mi = mi.replace(/\./g, '');
      mi = mi.charAt(0).toUpperCase();
    }

    return mi ? `${ln}, ${fn} ${mi}.` : `${ln}, ${fn}`;
  }

  private findStrictNameColumnIndex(headers: string[]): number {
    const allowedExact = new Set([
      'name',
      'teacher name',
      'teachername',
      'teacher_name',
      'full name',
      'fullname',
      'full_name',
      'name (last, first m.)'
    ]);

    for (let i = 0; i < headers.length; i++) {
      const raw = String(headers[i] || '').toLowerCase().trim();
      const normalized = raw.replace(/\s+/g, ' ');

      if (allowedExact.has(normalized) || allowedExact.has(raw.replace(/\s+/g, ''))) {
        return i;
      }
    }

    return -1;
  }

  findColumnIndex(headers: string[], possibleNames: string[]): number {
    for (let i = 0; i < headers.length; i++) {
      const header = String(headers[i] || '').toLowerCase().trim();
      if (possibleNames.some(name => header === name || header.includes(name))) {
        return i;
      }
    }
    return -1;
  }

  async importTeachers() {
    if (this.importData.length === 0) {
      this.showToast('No teachers to import', 'warning');
      return;
    }

    this.isImporting = true;
    try {
      const result = await this.adminService.importRoster(this.schoolId, this.importData);
      if (result.success) {
        const data = result.data;
        this.showToast(`Imported ${data.imported} teachers. Skipped ${data.skipped}.`, 'success');
        this.closeImportModal();
        await this.loadRoster();
      } else {
        this.showToast(result.message || 'Failed to import teachers', 'danger');
      }
    } catch (err) {
      console.error('Error importing teachers:', err);
      this.showToast('Failed to import teachers', 'danger');
    } finally {
      this.isImporting = false;
    }
  }

  async deleteTeacher(teacher: any) {
    const alert = await this.alertController.create({
      header: 'Remove Teacher',
      message: `Are you sure you want to remove "${teacher.name}" from the roster?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            this.isLoading = true;
            try {
              const result = await this.adminService.deleteFromRoster(this.schoolId, teacher.teacherId);
              if (result.success) {
                this.showToast('Teacher removed from roster', 'success');
                await this.loadRoster();
              } else {
                this.showToast(result.message || 'Failed to remove teacher', 'danger');
              }
            } catch (err) {
              console.error('Error removing teacher:', err);
              this.showToast('Failed to remove teacher', 'danger');
            } finally {
              this.isLoading = false;
            }
          }
        }
      ]
    });
    await alert.present();
  }

  openEditTeacherModal(teacher: any) {
    this.editingTeacher = teacher;
    this.editTeacherId = String(teacher?.teacherId || '');
    this.editTeacherName = String(teacher?.name || '');
    this.editSchoolId = String(this.schoolId);
  }

  closeEditTeacherModal() {
    this.editingTeacher = null;
    this.editTeacherId = '';
    this.editTeacherName = '';
    this.editSchoolId = '';
  }

  async updateTeacher() {
    if (!this.editingTeacher) return;
    const nextName = this.editTeacherName.trim();
    const nextTeacherId = this.editTeacherId.trim();
    const nextSchoolId = this.editSchoolId.trim();

    if (!nextName) {
      this.showToast('Please enter teacher name', 'warning');
      return;
    }
    if (!nextTeacherId) {
      this.showToast('Please enter teacher ID', 'warning');
      return;
    }

    this.isLoading = true;
    try {
      const result = await this.adminService.updateRosterTeacher(
        this.schoolId,
        String(this.editingTeacher.teacherId),
        nextName,
        nextTeacherId !== String(this.editingTeacher.teacherId) ? nextTeacherId : undefined,
        nextSchoolId !== this.schoolId ? nextSchoolId : undefined
      );
      if (result.success) {
        this.showToast('Teacher updated successfully', 'success');
        this.closeEditTeacherModal();
        // If school changed, navigate to the new school's roster
        if (nextSchoolId !== this.schoolId) {
          this.router.navigate(['/admin-roster', nextSchoolId]);
        } else {
          await this.loadRoster();
        }
      } else {
        this.showToast(result.message || 'Failed to update teacher', 'danger');
      }
    } catch (err) {
      console.error('Error updating teacher:', err);
      this.showToast('Failed to update teacher', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  // Add Teacher Modal
  openAddModal() {
    this.newTeacherId = '';
    this.newTeacherName = '';
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
    this.newTeacherId = '';
    this.newTeacherName = '';
  }

  async addTeacher() {
    const teacherId = this.newTeacherId.trim();
    const name = this.newTeacherName.trim();

    if (!teacherId) {
      this.showToast('Please enter teacher ID', 'warning');
      return;
    }
    if (!name) {
      this.showToast('Please enter teacher name', 'warning');
      return;
    }

    this.isLoading = true;
    try {
      const result = await this.adminService.addToRoster(this.schoolId, teacherId, name);
      if (result.success) {
        this.showToast('Teacher added successfully', 'success');
        this.closeAddModal();
        await this.loadRoster();
      } else {
        this.showToast(result.message || 'Failed to add teacher', 'danger');
      }
    } catch (err) {
      console.error('Error adding teacher:', err);
      this.showToast('Failed to add teacher', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  async exportRoster() {
    this.isLoading = true;
    try {
      const result = await this.adminService.exportRoster(this.schoolId);
      if (result.success && result.data) {
        const data = result.data;
        const teachers = data.teachers;

        // Create worksheet
        const wsData = [
          ['Teacher ID', 'Name', 'Registered', 'Registration Date', 'Email'],
          ...teachers.map((t: any) => [
            t.teacherId,
            t.name,
            t.registered,
            t.registeredAt,
            t.email
          ])
        ];

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Roster');

        // Generate filename
        const filename = `${this.schoolName.replace(/\s+/g, '_')}_roster_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, filename);

        this.showToast('Roster exported successfully', 'success');
      } else {
        this.showToast(result.message || 'Failed to export roster', 'danger');
      }
    } catch (err) {
      console.error('Error exporting roster:', err);
      this.showToast('Failed to export roster', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  downloadTemplate() {
    // Create a sample template with headers and example rows
    const templateData = [
      ['Teacher ID', 'Last Name', 'First Name', 'Mid Initial'],
      ['T001', 'Cruz', 'Juan', 'D'],
      ['T002', 'Reyes', 'Jose', 'A'],
      ['T003', 'Santos', 'Maria', 'L'],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);

    // Set column widths for better readability
    ws['!cols'] = [
      { wch: 15 },  // Teacher ID
      { wch: 18 },  // Last Name
      { wch: 18 },  // First Name
      { wch: 12 }   // Mid Initial
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Teacher Roster Template');

    const filename = `teacher_roster_template.xlsx`;
    XLSX.writeFile(wb, filename);

    this.showToast('Template downloaded successfully', 'success');
  }

  formatDate(timestamp: any): string {
    if (!timestamp) return 'Not registered';
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
