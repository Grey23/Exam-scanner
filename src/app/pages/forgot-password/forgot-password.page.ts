import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { sendPasswordResetEmail } from 'firebase/auth';
import { firebaseAuth, firebaseDb } from '../../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss']
})
export class ForgotPasswordPage {
  email = '';
  isLoading = false;
  emailSent = false;

  constructor(
    private router: Router,
    private toastController: ToastController
  ) {}

  async sendResetEmail() {
    const email = this.email.trim().toLowerCase();

    if (!email) {
      await this.showToast('Please enter your email address');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await this.showToast('Please enter a valid email address');
      return;
    }

    this.isLoading = true;

    try {
      // Check if email exists in Firestore
      const db = firebaseDb();
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', email));
      const snap = await getDocs(q);

      if (snap.empty) {
        await this.showToast('No account found with this email address');
        this.isLoading = false;
        return;
      }

      // Send Firebase password reset email
      const auth = firebaseAuth();
      await sendPasswordResetEmail(auth, email, {
        url: 'https://exam-scanner-b0867.web.app/reset-password',
        handleCodeInApp: true
      });

      this.emailSent = true;
    } catch (err: any) {
      console.error('Forgot password error:', err);
      await this.showToast(err?.message || 'Failed to send reset email. Please try again.');
    } finally {
      this.isLoading = false;
    }
  }

  goBack() {
    this.router.navigate(['/login']);
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'top',
      color: 'warning'
    });
    await toast.present();
  }
}
