import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { firebaseAuth } from '../../firebase';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss']
})
export class ResetPasswordPage implements OnInit {
  oobCode: string | null = null;

  email: string | null = null;
  isLoading = true;

  newPassword = '';
  confirmPassword = '';
  showPassword = false;

  isSubmitting = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private toastController: ToastController
  ) {}

  async ngOnInit() {
    this.oobCode = this.route.snapshot.queryParamMap.get('oobCode');

    if (!this.oobCode) {
      this.isLoading = false;
      await this.showToast('Invalid reset link.');
      return;
    }

    try {
      const auth = firebaseAuth();
      this.email = await verifyPasswordResetCode(auth, this.oobCode);
    } catch (err: any) {
      console.error('ResetPasswordPage verify failed:', err);
      await this.showToast(err?.message || 'Invalid or expired reset link.');
      this.email = null;
    } finally {
      this.isLoading = false;
    }
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  async submit() {
    if (!this.oobCode) {
      await this.showToast('Invalid reset link.');
      return;
    }

    const pw = this.newPassword.trim();
    const cpw = this.confirmPassword.trim();

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
      const auth = firebaseAuth();
      await confirmPasswordReset(auth, this.oobCode, pw);
      await this.showToast('Password updated. You can now log in.');
      await this.router.navigate(['/login']);
    } catch (err: any) {
      console.error('ResetPasswordPage confirm failed:', err);
      await this.showToast(err?.message || 'Failed to reset password.');
    } finally {
      this.isSubmitting = false;
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
