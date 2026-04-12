
import { LocalDataService } from './services/local-data.service';
import { Platform } from '@ionic/angular';
import { CameraService } from './services/camera.service';
import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, MenuController, NavController, AlertController } from '@ionic/angular';
import { AuthService, User } from './services/auth.service';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [CommonModule, IonicModule, FormsModule, RouterModule],
  standalone: true,
})
export class AppComponent {
    @Input() activePage: 'dashboard' | 'classes' | 'subjects' | 'scan' | 'results' | 'settings' | '' = '';
    @Input() contentId: string = 'main-content';
    @Input() menuId: string = 'main';
  
    currentUser: User | null = null;
  constructor(
    private platform: Platform,
    private cameraService: CameraService,
    private authService: AuthService,
    private navCtrl: NavController,
    private menuController: MenuController,
    private alertController: AlertController,
    private router: Router // 👈 ADD THIS
  ) {
    this.initializeApp();
    this.currentUser = this.authService.getCurrentUser();
  }

  async initializeApp() {
  try {
    await LocalDataService.load();
  } catch (err) {
    console.error('LocalDataService load error:', err);
  }

  try {
    await this.authService.checkAuth();
    this.currentUser = this.authService.getCurrentUser(); // ⭐ ADD THIS
  } catch (err) {
    console.error('AuthService checkAuth error:', err);
  }

  await this.platform.ready();
}
ionViewWillEnter() {
  this.menuController.enable(true, 'main');
  this.menuController.enable(false, 'admin-menu');
}
  isAdminRoute(): boolean {
  return this.router.url.startsWith('/admin');
}
  
    async ngOnInit() {
      try {
        await this.menuController.enable(true, this.menuId);
      } catch {
        // ignore
      }
    }
  
    async closeMenu() {
      try {
        await this.menuController.close(this.menuId);
      } catch {
        // ignore
      }
    }
  
    async goTo(url: string) {
      await this.closeMenu();
      this.navCtrl.navigateRoot(url);
    }
  
    /**
     * Results entrypoint from sidebar:
     * 1) Show class list
     * 2) From there, teachers can drill into subjects and scans.
     */
    async goToResultsRoot() {
      await this.closeMenu();
      this.navCtrl.navigateRoot('/class-list', {
        queryParams: { view: 'results' }
      } as any);
    }
  
    async goToSubjects() {
      if (this.activePage === 'subjects') {
        await this.closeMenu();
        return;
      }
      await this.goTo('/class-list');
    }
  
    async logout() {
      const alert = await this.alertController.create({
        header: 'Logout',
        message: 'Are you sure you want to logout?',
        buttons: [
          {
            text: 'No',
            role: 'cancel'
          },
          {
            text: 'Yes',
            handler: async () => {
              try {
                await this.closeMenu();
              } catch {
                // ignore menu close errors
              }
              
              try {
                await this.authService.logout();
              } catch (err) {
                console.error('Logout error:', err);
              }
              
              // Always navigate to login with logout param, even if logout fails
              this.navCtrl.navigateRoot('/login', {
                queryParams: { logout: 'true' }
              });
            }
          }
        ]
      });
  
      await alert.present();
    }
  
}
