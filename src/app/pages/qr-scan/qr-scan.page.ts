
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { ZXingScannerModule } from '@zxing/ngx-scanner';
import { LocalDataService } from '../../services/local-data.service';
import { TeacherService } from '../../services/teacher.service';
import { BarcodeFormat } from '@zxing/library';

interface StudentSheetQr {
  subjectId: number;
  studentId: number;
  sheetId: string;
}

interface ValidatedSheetQr extends StudentSheetQr {
  classId: number;
}

@Component({
  selector: 'app-qr-scan',
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    ZXingScannerModule
  ],
  templateUrl: './qr-scan.page.html',
  styleUrls: ['./qr-scan.page.scss']
})
export class QrScanPage {
  scanning = true;
  processing = false;
  message = 'Point the camera at the student QR code.';
  scannedSheet: StudentSheetQr | null = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private alertCtrl: AlertController,
    private teacherService: TeacherService
  ) {}
  BarcodeFormat = BarcodeFormat;
  debugStatus = 'Waiting for QR detection...';
  selectedDevice?: MediaDeviceInfo;

  async onCodeResult(result: string): Promise<void> {
    // ZXing can emit the same QR several times.
    if (!result || this.processing) {
      return;
    }

    this.processing = true;
    this.scanning = false;
    this.debugStatus = 'QR detected. Validating sheet...';

    try {
      const parsed: unknown = JSON.parse(result);

      if (!this.isValidSheetQr(parsed)) {
        await this.showMessage(
          'Invalid QR Code',
          'This QR code does not contain valid subject, student, and sheet information.'
        );
        return;
      }

      const sheet = this.validateAndExtractClassId(parsed);

      if (!sheet) {
        await this.showMessage(
          'Invalid Sheet ID',
          'The sheet ID does not match the subject and student IDs in this QR code.'
        );
        return;
      }

      this.scannedSheet = sheet;
      this.message = 'Checking whether this sheet has already been scanned...';
      this.debugStatus = `Checking sheet: ${sheet.sheetId}`;

      // Load the local saved data first.
      await LocalDataService.load();

      const localResults = LocalDataService.getResultsBySubject(
        sheet.classId,
        sheet.subjectId
      );

      const localDuplicate = this.hasMatchingStudent(
        localResults,
        sheet.studentId
      );

      // Refresh Firestore instead of relying on a potentially stale cache.
      const remoteResponse = await this.teacherService.loadSubjectResults(
        sheet.classId,
        sheet.subjectId,
        { refresh: true }
      );

      if (!remoteResponse.success) {
        console.error(
          'Could not verify saved scans:',
          remoteResponse.error
        );

        await this.showMessage(
          'Could Not Verify Previous Scans',
          'The app could not check the saved results online. Please check your internet connection and scan the QR code again. The app will not proceed until it can verify whether this sheet was already scanned.'
        );
        return;
      }

      const remoteDuplicate = this.hasMatchingStudent(
        remoteResponse.results,
        sheet.studentId
      );

      // Refresh the local subject results with the latest remote results.
      // Merge rather than overwrite, so local-only results are not discarded.
      const mergedResults = [
        ...remoteResponse.results,
        ...localResults.filter(local =>
          !remoteResponse.results.some(remote =>
            String(remote.id) === String(local.id)
          )
        )
      ];

      LocalDataService.setSubjectResults(
        sheet.classId,
        sheet.subjectId,
        mergedResults
      );

      if (localDuplicate || remoteDuplicate) {
        await this.promptScanAgain(sheet);
        return;
      }

      this.debugStatus = 'Sheet verified. Opening the answer scanner...';
      this.message = 'QR verified. Opening scanner...';

      await this.openRealScanner(sheet);
    } catch (error) {
      console.error('QR processing failed:', error);

      await this.showMessage(
        'QR Processing Error',
        'The QR code could not be processed. Please make sure it is a valid EduScan answer-sheet QR code.'
      );
    } finally {
      // If navigation did not occur, let the user try again.
      this.processing = false;

      if (this.router.url.startsWith('/qr-scan')) {
        this.scanning = true;
        this.message = 'Point the camera at the student QR code.';
        this.debugStatus = 'Waiting for QR detection...';
      }
    }
  }

  private validateAndExtractClassId(
    data: StudentSheetQr
  ): ValidatedSheetQr | null {
    // Expected format: KES-{classId}-{subjectId}-{studentId}
    const match = /^KES-(\d+)-(\d+)-(\d+)$/i.exec(data.sheetId.trim());

    if (!match) {
      return null;
    }

    const classId = Number(match[1]);
    const subjectIdFromSheet = Number(match[2]);
    const studentIdFromSheet = Number(match[3]);

    if (
      !Number.isSafeInteger(classId) ||
      classId <= 0 ||
      subjectIdFromSheet !== Number(data.subjectId) ||
      studentIdFromSheet !== Number(data.studentId)
    ) {
      return null;
    }

    return {
      classId,
      subjectId: Number(data.subjectId),
      studentId: Number(data.studentId),
      sheetId: data.sheetId.trim()
    };
  }

  private isValidSheetQr(value: unknown): value is StudentSheetQr {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const data = value as Partial<StudentSheetQr>;

    return (
      Number.isSafeInteger(data.subjectId) &&
      Number(data.subjectId) > 0 &&
      Number.isSafeInteger(data.studentId) &&
      Number(data.studentId) > 0 &&
      typeof data.sheetId === 'string' &&
      data.sheetId.trim().length > 0
    );
  }

  private hasMatchingStudent(
    results: Array<{ studentId?: number | null }>,
    studentId: number
  ): boolean {
    return results.some(result =>
      result.studentId != null &&
      Number(result.studentId) === studentId
    );
  }

  private async promptScanAgain(
    sheet: ValidatedSheetQr
  ): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sheet Already Scanned',
      message:
        `A saved scan already exists for this student's sheet ` +
        `(${sheet.sheetId}). Do you want to scan it again?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Scan Again',
          role: 'confirm'
        }
      ],
      backdropDismiss: false
    });

    await alert.present();

    const { role } = await alert.onDidDismiss();

    if (role === 'confirm') {
      await this.openRealScanner(sheet);
    }
  }

  private async openRealScanner(
    sheet: ValidatedSheetQr
  ): Promise<void> {
    await this.router.navigate(['/scan'], {
      queryParams: {
        classId: sheet.classId,
        subjectId: sheet.subjectId,
        studentId: sheet.studentId,
        sheetId: sheet.sheetId
      }
    });
  }

  private async showMessage(
    header: string,
    message: string
  ): Promise<void> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK'],
      backdropDismiss: false
    });

    await alert.present();
    await alert.onDidDismiss();
  }

  onCamerasFound(cameras: MediaDeviceInfo[]): void {
    console.log('Available cameras:', cameras);

    const rearCamera = cameras.find(camera =>
      /back|rear|environment/i.test(camera.label)
    );

    this.selectedDevice = rearCamera ?? cameras[cameras.length - 1];

    this.debugStatus = this.selectedDevice
      ? `Using camera: ${this.selectedDevice.label || 'Selected camera'}`
      : 'No camera selected.';
  }

  onCamerasNotFound(): void {
    this.debugStatus = 'No cameras found.';
    console.error('ZXing could not find a camera.');
  }

  onScanFailure(error: unknown): void {
    // ZXing may emit this repeatedly while no QR is visible.
    console.debug('QR not decoded:', error);
  }

  onScanError(error: unknown): void {
    this.debugStatus = 'Scanner error. Check the browser console.';
    console.error('ZXing scanner error:', error);
  }

  goBack(): void {
    this.router.navigate(['/teacher-dashboard']);
  }
}
