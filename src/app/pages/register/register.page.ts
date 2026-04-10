import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: false
})
export class RegisterPage {
  email = '';
  password = '';
  confirmPassword = '';
  name = '';
  userType: 'teacher' | 'admin' = 'teacher';
  schoolName = '';
  teacherId = '';
  isLoading = false;
  showPassword = false;
  showConfirmPassword = false;
  validatingTeacherId = false;
  teacherIdValid: boolean | null = null;
  teacherIdMessage = '';
  verifiedTeacherName = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private toastController: ToastController
  ) {}

  async validateTeacherId() {
    if (!this.teacherId.trim()) {
      this.teacherIdValid = null;
      this.teacherIdMessage = '';
      this.verifiedTeacherName = '';
      return;
    }

    this.validatingTeacherId = true;
    this.teacherIdValid = null;
    this.teacherIdMessage = '';

    try {
      const result = await this.authService.checkTeacherId(this.teacherId.trim());
      if (result.success && result.data) {
        this.teacherIdValid = result.data.valid;
        this.teacherIdMessage = result.data.reason || '';
        if (result.data.valid && result.data.name) {
          this.verifiedTeacherName = result.data.name;
          // Auto-fill name if empty
          if (!this.name.trim()) {
            this.name = result.data.name;
          }
        } else {
          this.verifiedTeacherName = '';
        }
      } else {
        this.teacherIdValid = false;
        this.teacherIdMessage = result.message || 'Failed to verify Teacher ID';
      }
    } catch (err) {
      this.teacherIdValid = false;
      this.teacherIdMessage = 'Failed to verify Teacher ID';
    } finally {
      this.validatingTeacherId = false;
    }
  }

  async register() {
    console.log('=== REGISTRATION STARTED ===');
    console.log('Email:', this.email);
    console.log('Name:', this.name);
    console.log('User Type:', this.userType);
    console.log('School Name:', this.schoolName);
    console.log('Teacher ID:', this.teacherId);

    if (!this.email || !this.password || !this.confirmPassword || !this.name) {
      console.log('Missing required fields');
      this.showToast('Please fill in all required fields');
      return;
    }

    if (this.password !== this.confirmPassword) {
      console.log('Passwords do not match');
      this.showToast('Passwords do not match');
      return;
    }

    if (this.password.length < 6) {
      console.log('Password too short');
      this.showToast('Password must be at least 6 characters');
      return;
    }

    if (this.userType === 'admin' && !this.schoolName) {
      console.log('School name required for admin');
      this.showToast('School name is required for admin accounts');
      return;
    }

    // Teacher ID validation for teachers
    if (this.userType === 'teacher') {
      if (!this.teacherId.trim()) {
        this.showToast('Teacher ID is required for teacher accounts');
        return;
      }
      if (this.teacherIdValid === false) {
        this.showToast(this.teacherIdMessage || 'Invalid Teacher ID');
        return;
      }
    }

    console.log('All validations passed, sending registration request...');
    this.isLoading = true;
    try {
      console.log('Calling authService.register...');
      const result = await this.authService.register(
        this.email,
        this.password,
        this.name,
        this.userType,
        this.schoolName,
        this.userType === 'teacher' ? this.teacherId.trim() : undefined
      );

      console.log('Registration result:', result);

      if (result.success) {
        console.log('Registration successful!');
        this.showToast('Registration successful!');
        // Route based on user type
        if (this.userType === 'teacher') {
          console.log('Navigating to teacher-dashboard...');
          this.router.navigate(['/teacher-dashboard']);
        } else if (this.userType === 'admin') {
          console.log('Navigating to admin-dashboard...');
          this.router.navigate(['/admin-dashboard']);
        }
      } else {
        console.log('Registration failed:', result.message);
        this.showToast(result.message || 'Registration failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Registration error caught:', err);
      console.error('Error stack:', err);
      const errorMsg = err?.message || err?.error?.error || 'Registration failed. Please try again.';
      console.error('Final error message:', errorMsg);
      this.showToast(errorMsg);
    } finally {
      this.isLoading = false;
      console.log('=== REGISTRATION COMPLETED ===');
    }
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  onUserTypeChange() {
    // Reset teacher ID validation when switching user type
    this.teacherIdValid = null;
    this.teacherIdMessage = '';
    this.verifiedTeacherName = '';
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'top'
    });
    await toast.present();
  }
}
