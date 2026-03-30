import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { AdminSidebarComponent } from '../admin-sidebar/admin-sidebar.component';

@Component({
  selector: 'app-admin-modules-monitor',
  templateUrl: './admin-modules-monitor.page.html',
  styleUrls: ['./admin-modules-monitor.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, AdminSidebarComponent]
})
export class AdminModulesMonitorPage implements OnInit {
  modules = [
    { name: 'Authentication', status: 'OK' },
    { name: 'User Management', status: 'OK' },
    { name: 'Scanning', status: 'OK' },
    { name: 'Results', status: 'OK' }
  ];

  ngOnInit() {
    // no-op
  }
}
