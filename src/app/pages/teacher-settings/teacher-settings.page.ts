import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';
import { TeacherService } from '../../services/teacher.service';
import { Subscription } from 'rxjs';
import { getDoc, doc } from 'firebase/firestore';
import { firebaseDb } from '../../firebase';

@Component({
  selector: 'app-teacher-settings',
  templateUrl: './teacher-settings.page.html',
  styleUrls: ['./teacher-settings.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TeacherSettingsPage implements OnInit, OnDestroy {
  @ViewChild('fileInput', { static: false }) fileInput!: ElementRef<HTMLInputElement>;

  currentUser: User | null = null;
  formData = {
    name: '',
    email: '',
    schoolId: '',
    bio: ''
  };
  isLoading = false;
  isSaving = false;
  schools: any[] = [];
  profileImageUrl: string | null = null;
  schoolName: string | null = null;
  schoolInfo: any = null;
  private authSub?: Subscription;

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private teacherService: TeacherService,
    private toastController: ToastController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ngOnInit() {
    this.authSub = this.authService.auth$.subscribe(state => {
      this.currentUser = state.user;
    });

    this.loadUserData();
  }

  ngOnDestroy() {
    this.authSub?.unsubscribe();
  }

  ionViewWillEnter() {
    this.loadUserData();
  }

  async loadUserData() {
    this.isLoading = true;
    try {
      if (this.currentUser) {
        this.formData = {
          name: this.currentUser.name || '',
          email: this.currentUser.email || '',
          schoolId: this.currentUser.schoolId ? String(this.currentUser.schoolId) : '',
          bio: ''
        };
      }

      const result = await this.teacherService.getMyProfile();
      if (result.success && result.profile) {
        this.formData = {
          name: String(result.profile.name || this.formData.name || ''),
          email: String(result.profile.email || this.formData.email || ''),
          schoolId: result.profile.schoolId !== undefined ? String(result.profile.schoolId) : (this.formData.schoolId || ''),
          bio: String(result.profile.bio || '')
        };
        this.profileImageUrl = result.profile.photoURL || null;
      }

      // Load school information
      if (this.currentUser?.schoolId) {
        await this.loadSchoolInfo(String(this.currentUser.schoolId));
      }
    } catch (err) {
      console.error('Error loading user data:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async loadSchoolInfo(schoolId: string) {
    try {
      const db = firebaseDb();
      const schoolRef = doc(db, 'schools', schoolId);
      const snap = await getDoc(schoolRef);

      if (snap.exists()) {
        const data = snap.data();
        this.schoolInfo = {
          name: data['name'] || data['schoolName'] || 'Unknown School',
          address: data['address'] || null,
          phone: data['phone'] || null
        };
        this.schoolName = this.schoolInfo.name;
      } else {
        // Fallback to schoolName from user object
        this.schoolName = this.currentUser?.schoolName || null;
        this.schoolInfo = this.schoolName ? { name: this.schoolName } : null;
      }
    } catch (err) {
      console.error('Error loading school info:', err);
      // Fallback
      this.schoolName = this.currentUser?.schoolName || null;
      this.schoolInfo = this.schoolName ? { name: this.schoolName } : null;
    }
  }

  selectProfileImage() {
    const input = this.fileInput?.nativeElement;
    if (input) {
      input.click();
    } else {
      console.error('File input not found');
    }
  }

  async removePhoto() {
    this.profileImageUrl = null;
    try {
      const result = await this.teacherService.updateProfile({
        ...this.formData,
        photoURL: null
      });
      if (result.success) {
        this.showToast('Profile photo removed', 'success');
      } else {
        this.showToast(result.error || 'Failed to remove photo', 'danger');
      }
    } catch (err) {
      console.error('Error removing profile photo:', err);
      this.showToast('Failed to remove photo', 'danger');
    }
  }

  async onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    console.log('Selected file:', file.name, file.type, file.size);

    if (!file.type.startsWith('image/')) {
      this.showToast('Please select an image file', 'warning');
      return;
    }

    // Preview the image locally
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      console.log('Image loaded, size:', dataUrl?.length);
      this.profileImageUrl = dataUrl;

      // Save to profile
      try {
        const result = await this.teacherService.updateProfile({
          ...this.formData,
          photoURL: this.profileImageUrl
        });
        console.log('Save result:', result);
        if (result.success) {
          this.showToast('Profile photo updated!', 'success');
        } else {
          this.showToast(result.error || 'Failed to save photo', 'danger');
        }
      } catch (err) {
        console.error('Error saving profile photo:', err);
        this.showToast('Failed to save photo', 'danger');
      }
    };
    reader.onerror = (err) => {
      console.error('FileReader error:', err);
      this.showToast('Failed to read file', 'danger');
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be selected again
    input.value = '';
  }

  async saveProfile() {
    if (!this.formData.name || !this.formData.email) {
      this.showToast('Name and email are required', 'warning');
      return;
    }

    this.isSaving = true;
    try {
      const result = await this.teacherService.updateProfile({
        ...this.formData,
        photoURL: this.profileImageUrl
      });

      if (result.success) {
        this.showToast('Profile updated successfully!', 'success');

        await this.authService.patchCurrentUser({
          name: this.formData.name,
          email: this.formData.email,
          schoolId: this.formData.schoolId
        });

        this.currentUser = this.authService.getCurrentUser();
      } else {
        this.showToast(result.error || 'Failed to update profile', 'danger');
      }
    } catch (err: any) {
      console.error('Error updating profile:', err);
      this.showToast(err.message || 'Failed to update profile', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  goBack() {
    this.navCtrl.back();
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'top',
      color
    });
    await toast.present();
  }
}
