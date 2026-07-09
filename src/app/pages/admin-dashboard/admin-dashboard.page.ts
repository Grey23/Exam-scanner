import { Component, OnInit } from '@angular/core';
import { NavController, AlertController, MenuController, ToastController } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';
import Chart from 'chart.js/auto';
import { AdminService } from '../../services/admin.service';

interface WeeklyActivity {
  day: string;
  scans: number;
}

interface ScansByClass {
  className: string;
  count: number;
}

interface QuestionsByDay {
  day: string;
  count: number;
}

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: false
})
export class AdminDashboardPage implements OnInit {
  currentUser: User | null = null;
  isLoading = false;
  isLoadingStats = false;
  isLoadingCharts = false;
  private hasLoadedOnce = false;

  totalUsers = 0;
  totalTeachers = 0;
  totalAdmins = 0;

  totalClasses = 0;
  questionsGeneratedToday = 0;
  totalScannedPapers = 0;

  weeklyActivity: WeeklyActivity[] = [];
  scansByClass: ScansByClass[] = [];
  questionsByDay: QuestionsByDay[] = [];

  private usersChart?: Chart;
  private activityChart?: Chart;
  private scansChart?: Chart;
  private questionsChart?: Chart;

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private adminService: AdminService,
    private alertController: AlertController,
    private menuController: MenuController,
    private toastController: ToastController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ngOnInit() {
    // Defer initial load to ionViewDidEnter so canvases exist before rendering Chart.js
  }

  ionViewDidEnter() {
    if (this.hasLoadedOnce) return;
    this.hasLoadedOnce = true;
    void this.loadData();
  }

  async loadData() {
    // Load stats first (fast)
    this.isLoadingStats = true;
    this.isLoadingCharts = true;
    
    try {
      const res = await this.adminService.getDashboardMetrics();
      if (!res.success || !res.data) {
        throw new Error(res.message || 'Failed to load dashboard metrics');
      }

      // Set stats immediately
      this.totalUsers = Number(res.data.totalUsers || 0);
      this.totalTeachers = Number(res.data.totalTeachers || 0);
      this.totalAdmins = Number(res.data.totalAdmins || 0);
      this.totalClasses = Number(res.data.totalClasses || 0);
      this.questionsGeneratedToday = Number(res.data.questionsGeneratedToday || 0);
      this.totalScannedPapers = Number(res.data.totalScannedPapers || 0);
      this.isLoadingStats = false;

      // Get real chart data from backend
      this.weeklyActivity = Array.isArray(res.data.weeklyActivity) ? res.data.weeklyActivity : [];
      this.scansByClass = Array.isArray(res.data.scansByClass) ? res.data.scansByClass : [];
      this.questionsByDay = Array.isArray(res.data.questionsByDay) ? res.data.questionsByDay : [];

      // Defer chart rendering
      setTimeout(() => this.renderChartsLazy(), 0);
    } catch (err) {
      console.error('AdminDashboardPage: loadData failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard metrics';
      await this.showToast(msg);
      this.totalUsers = 0;
      this.totalTeachers = 0;
      this.totalAdmins = 0;
      this.totalClasses = 0;
      this.questionsGeneratedToday = 0;
      this.totalScannedPapers = 0;
      this.isLoadingStats = false;
      this.isLoadingCharts = false;
    }
  }

  private renderChartsLazy(): void {
    // Use requestAnimationFrame for smoother rendering
    requestAnimationFrame(() => {
      // Render charts in sequence with micro-delays to not block UI
      this.renderUsersChart();
      
      setTimeout(() => {
        this.renderActivityChart();
        
        setTimeout(() => {
          this.renderScansChart();
          
          setTimeout(() => {
            this.renderQuestionsChart();
            this.isLoadingCharts = false;
          }, 50);
        }, 50);
      }, 50);
    });
  }

  private renderUsersChart(): void {
    const canvas = document.getElementById('adminUsersChart') as HTMLCanvasElement | null;
    if (!canvas) return;

    if (this.usersChart) {
      this.usersChart.destroy();
    }

    this.usersChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Teachers', 'Admins'],
        datasets: [
          {
            data: [this.totalTeachers, this.totalAdmins],
            backgroundColor: ['#3b82f6', '#f97316'],
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 16,
              usePointStyle: true
            }
          }
        },
        cutout: '60%'
      }
    });
  }

  private renderActivityChart(): void {
    const canvas = document.getElementById('adminActivityChart') as HTMLCanvasElement | null;
    if (!canvas) return;

    if (this.activityChart) {
      this.activityChart.destroy();
    }

    // Use real data from backend
    const labels = this.weeklyActivity.map(d => d.day);
    const data = this.weeklyActivity.map(d => d.scans);

    this.activityChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Scans',
            data: data,
            backgroundColor: 'rgba(59, 130, 246, 0.8)',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.05)'
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  }

  private renderScansChart(): void {
    const canvas = document.getElementById('adminScansChart') as HTMLCanvasElement | null;
    if (!canvas) return;

    if (this.scansChart) {
      this.scansChart.destroy();
    }

    // Use real data from backend
    const labels = this.scansByClass.map(d => d.className);
    const data = this.scansByClass.map(d => d.count);

    this.scansChart = new Chart(canvas, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: [
              '#3b82f6',
              '#8b5cf6',
              '#06b6d4',
              '#f97316',
              '#10b981'
            ],
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 12,
              usePointStyle: true,
              font: {
                size: 10
              }
            }
          }
        }
      }
    });
  }

  private renderQuestionsChart(): void {
    const canvas = document.getElementById('adminQuestionsChart') as HTMLCanvasElement | null;
    if (!canvas) return;

    if (this.questionsChart) {
      this.questionsChart.destroy();
    }

    // Use real data from backend
    const labels = this.questionsByDay.map(d => d.day);
    const data = this.questionsByDay.map(d => d.count);

    this.questionsChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Questions',
            data: data,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#8b5cf6'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.05)'
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  }

  private async showToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2200,
      position: 'top'
    });
    await toast.present();
  }

  // Navigate to different sections
  goToDashboard() {
    this.menuController.close();
    // already on dashboard
  }

  goToClasses() {
    this.menuController.close();
    this.navCtrl.navigateForward('/class-list');
  }

  goToScan() {
    this.menuController.close();
    this.navCtrl.navigateForward('/scan');
  }

  goToResults() {
    this.menuController.close();
    this.navCtrl.navigateForward('/resultviewer');
  }

  goToAnswerKey() {
    this.menuController.close();
    this.navCtrl.navigateForward('/answer-key/0/0');
  }

  goToQuestionGenerator() {
    this.menuController.close();
    this.navCtrl.navigateForward('/question-generator/0/0');
  }

  goToTeachers() {
    this.menuController.close();
    this.navCtrl.navigateForward('/admin-users');
  }

  goToSchoolSettings() {
    this.menuController.close();
    // Navigate to school settings (to be created)
    // this.navCtrl.navigateForward('/school-settings');
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
            await this.authService.logout();
            this.navCtrl.navigateRoot('/login');
          }
        }
      ]
    });

    await alert.present();
  }

  refreshData() {
    void this.loadData();
  }
}
