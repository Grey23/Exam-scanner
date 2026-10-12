import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QrScanPage } from './qr-scan.page';

describe('QrScanPage', () => {
  let component: QrScanPage;
  let fixture: ComponentFixture<QrScanPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(QrScanPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
