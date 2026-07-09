import { Component } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {
  email = '';
  password = '';
  isLoading = false;
  showPassword = false;
  loginSuccess = false;
  logoutSuccess = false;
  errorMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private toastController: ToastController
  ) {}

  ionViewWillEnter() {
    // Reset all state when entering the page
    this.loginSuccess = false;
    this.logoutSuccess = false;
    this.email = '';
    this.password = '';
    this.isLoading = false;
    this.showPassword = false;

    // Check if coming from logout
    this.route.queryParams.subscribe(params => {
      if (params['logout'] === 'true') {
        this.logoutSuccess = true;
        // Hide logout success after 2 seconds
        setTimeout(() => {
          this.logoutSuccess = false;
        }, 2000);
      }
    });
  }

  async login() {
    if (!this.email || !this.password) {
      await this.showToast('Please fill in all fields');
      return;
    }

    this.isLoading = true;
    const result = await this.authService.login(this.email, this.password);

    if (result.success) {
      this.loginSuccess = true;
      this.errorMessage = '';

      const user = this.authService.getCurrentUser();
      let target = '/teacher-dashboard';
      if (user?.userType === 'admin' || user?.userType === 'school') {
        target = '/admin-dashboard';
      } else if (user?.userType && user.userType !== 'teacher') {
        target = '/student-dashboard';
      }

      setTimeout(() => {
        void this.router.navigate([target]);
      }, 700);
    } else {
      this.errorMessage = result.message;
    }

    this.isLoading = false;
  }

  goToRegister() {
    this.router.navigate(['/register']);
  }

  goToForgotPassword() {
    this.router.navigate(['/forgot-password']);
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
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
