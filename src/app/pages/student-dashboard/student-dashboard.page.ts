import { Component, OnInit, OnDestroy } from '@angular/core';
import { NavController, AlertController, MenuController } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';
import { DashboardService, StudentStats } from '../../services/dashboard.service';
import { Chart, registerables } from 'chart.js';
import { Subscription } from 'rxjs';

Chart.register(...registerables);

@Component({
  selector: 'app-student-dashboard',
  templateUrl: './student-dashboard.page.html',
  styleUrls: ['./student-dashboard.page.scss'],
  standalone: false
})
export class StudentDashboardPage implements OnInit {
  currentUser: User | null = null;
  studentStats: StudentStats | null = null;
  isLoading = false;
  pageSegment = 'overview';
  chart: Chart | null = null;
  private authSub?: Subscription;

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private dashboardService: DashboardService,
    private alertController: AlertController,
    private menuController: MenuController
  ) {
    this.currentUser = this.authService.getCurrentUser();
  }

  ngOnInit() {
    this.authSub = this.authService.auth$.subscribe(state => {
      this.currentUser = state.user;
    });

    this.loadData();
  }



  ngOnDestroy() {
    this.authSub?.unsubscribe();
  }



  ionViewWillEnter() {
    this.menuController.enable(false, 'main');
    this.menuController.enable(true, 'student');
  }

  async loadData() {
    this.isLoading = true;
    // Use student ID from current user or 1 as default
    const studentId = parseInt(this.currentUser?.id || '1', 10);
    await this.dashboardService.loadStudentStats(studentId);
    this.studentStats = this.dashboardService.getStudentStats();
    this.isLoading = false;
    
    setTimeout(() => {
      this.initChart();
    }, 500);
  }

  initChart() {
    const ctx = document.getElementById('performanceChart') as HTMLCanvasElement;
    
    if (!ctx || !this.studentStats) return;

    // Destroy existing chart if it exists
    if (this.chart) {
      this.chart.destroy();
    }

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: this.studentStats.recentScores.map(score => score.subjectName),
        datasets: [{
          label: 'Score (%)',
          data: this.studentStats.recentScores.map(score => score.percentage),
          backgroundColor: [
            'rgba(102, 126, 234, 0.8)',
            'rgba(118, 75, 162, 0.8)',
            'rgba(40, 167, 69, 0.8)',
            'rgba(252, 185, 11, 0.8)'
          ],
          borderColor: [
            '#667eea',
            '#764ba2',
            '#28a745',
            '#fcb90b'
          ],
          borderWidth: 1,
          borderRadius: 8
        }]
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
            max: 100,
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

  viewSubjectDetails(subject: any) {
    this.navCtrl.navigateForward(`/subject-results/${subject.subjectId}`);
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

  onSegmentChange(event: any) {
    const value = event.detail.value;
    this.pageSegment = typeof value === 'string' ? value : String(value);
  }

  refreshData() {
    this.loadData();
  }
}
