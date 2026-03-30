import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { AdminSidebarComponent } from '../admin-sidebar/admin-sidebar.component';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-admin-system-monitor',
  templateUrl: './admin-system-monitor.page.html',
  styleUrls: ['./admin-system-monitor.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, AdminSidebarComponent]
})
export class AdminSystemMonitorPage implements OnInit {
  apiBaseUrl = environment.apiBaseUrl;

  constructor() {}

  ngOnInit() {
    // no-op
  }
}
