import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, MenuController, NavController, AlertController } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';

@Component({
  selector: 'app-admin-sidebar',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './admin-sidebar.component.html',
  styleUrls: ['./admin-sidebar.component.scss'],
})
export class AdminSidebarComponent {
  @Input() activePage: 'dashboard' | 'system' | 'modules' | 'users' | 'schools' | '' = '';
  @Input() contentId: string = 'admin-content';
  @Input() menuId: string = 'admin-menu';

  currentUser: User | null = null;

  constructor(
    private navCtrl: NavController,
    private menuController: MenuController,
    private authService: AuthService,
    private alertController: AlertController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ionViewWillEnter() {
    this.menuController.enable(true, 'admin-menu');
    this.menuController.enable(false, 'main'); // disable teacher menu
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
            await this.closeMenu();
            await this.authService.logout();
            this.navCtrl.navigateRoot('/login');
          }
        }
      ]
    });

    await alert.present();
  }
}
