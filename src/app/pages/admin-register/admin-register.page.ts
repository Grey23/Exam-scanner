import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-admin-register',
  templateUrl: './admin-register.page.html',
  styleUrls: ['./admin-register.page.scss'],
  standalone: false
})
export class AdminRegisterPage {
  email = '';
  password = '';
  confirmPassword = '';
  name = '';
  schoolName = '';
  isLoading = false;
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private toastController: ToastController
  ) {}

  async register() {
    console.log('=== ADMIN REGISTRATION STARTED ===');
    console.log('Email:', this.email);
    console.log('Name:', this.name);
    console.log('School Name:', this.schoolName);

    if (!this.email || !this.password || !this.confirmPassword || !this.name || !this.schoolName) {
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

    console.log('All validations passed, sending registration request...');
    this.isLoading = true;
    try {
      console.log('Calling authService.register...');
      const result = await this.authService.register(
        this.email,
        this.password,
        this.name,
        'admin',
        this.schoolName,
        undefined
      );

      console.log('Registration result:', result);

      if (result.success) {
        console.log('Admin registration successful!');
        this.showToast('Admin account created successfully!');
        console.log('Navigating to admin-dashboard...');
        this.router.navigate(['/admin-dashboard']);
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
      console.log('=== ADMIN REGISTRATION COMPLETED ===');
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

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'top'
    });
    await toast.present();
  }
}
