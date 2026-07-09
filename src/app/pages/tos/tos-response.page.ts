import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tos-response',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tos"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ title }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p *ngIf="selection"><strong>Selection:</strong> {{ selection }}</p>

      <ion-list *ngIf="students && students.length > 0">
        <ion-item *ngFor="let student of students; let i = index" lines="inset">
          <ion-label>
            <div style="font-weight: 700; font-size: 15px;">{{ i + 1 }}. {{ student.name }}</div>
            <div style="font-size: 12px; opacity: 0.7;" *ngIf="student.rollNumber">Roll: #{{ student.rollNumber }}</div>
          </ion-label>
        </ion-item>
      </ion-list>

      <div *ngIf="!students || students.length === 0" class="empty-state">
        <p>No students selected this option.</p>
      </div>
    </ion-content>
  `,
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class TosResponsePage {
  title = 'Responses';
  selection = '';
  students: Array<{ name: string; rollNumber?: string | null }> = [];

  constructor(private route: ActivatedRoute, private router: Router) {
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state as { students?: Array<{ name: string; rollNumber?: string | null }>; title?: string };
    this.students = state?.students || [];
    this.title = state?.title || this.title;
    this.selection = this.route.snapshot.paramMap.get('option') || '';
  }
}
