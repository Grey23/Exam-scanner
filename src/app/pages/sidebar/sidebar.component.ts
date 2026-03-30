import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, MenuController, NavController, AlertController } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  @Input() activePage: 'dashboard' | 'classes' | 'subjects' | 'scan' | 'results' | 'settings' | '' = '';
  @Input() contentId: string = 'main-content';
  @Input() menuId: string = 'main';

  currentUser: User | null = null;

  constructor(
    private navCtrl: NavController,
    private menuController: MenuController,
    private authService: AuthService,
    private alertController: AlertController
  ) {
    this.currentUser = this.authService.getCurrentUser();
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
