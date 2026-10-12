import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { QrScanPageRoutingModule } from './qr-scan-routing.module';

import { QrScanPage } from './qr-scan.page';
import { RouterModule } from '@angular/router';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
     QrScanPageRoutingModule,
    RouterModule.forChild([{ path: '', component: QrScanPage }]),
    QrScanPage
  ]
})
export class QrScanPageModule {}
