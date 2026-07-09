import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { AdminRegisterPage } from './admin-register.page';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';

describe('AdminRegisterPage', () => {
  let component: AdminRegisterPage;
  let fixture: ComponentFixture<AdminRegisterPage>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [AdminRegisterPage],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: ToastController, useValue: {} }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminRegisterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
