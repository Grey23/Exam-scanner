import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { TeacherGuard } from './guards/teacher.guard';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadChildren: () => import('./pages/login/login.module').then(m => m.LoginPageModule)
  },
  {
    path: 'register',
    loadChildren: () => import('./pages/register/register.module').then(m => m.RegisterPageModule)
  },
  {
    path: 'x7k9m2-admin',
    loadChildren: () => import('./pages/admin-register/admin-register.module').then(m => m.AdminRegisterPageModule)
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./pages/forgot-password/forgot-password.page').then(m => m.ForgotPasswordPage)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./pages/reset-password/reset-password.page').then(m => m.ResetPasswordPage)
  },
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then(m => m.HomePageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./pages/dashboard/dashboard.module').then(m => m.DashboardPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'admin-dashboard',
    loadChildren: () => import('./pages/admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardPageModule),
    canActivate: [AdminGuard]
  },
  {
    path: 'admin-users',
    loadComponent: () => import('./pages/admin-users/admin-users.page').then(m => m.AdminUsersPage),
    canActivate: [AdminGuard]
  },
  {
    path: 'admin-system-monitor',
    loadComponent: () => import('./pages/admin-system-monitor/admin-system-monitor.page').then(m => m.AdminSystemMonitorPage),
    canActivate: [AdminGuard]
  },
  {
    path: 'admin-modules-monitor',
    loadComponent: () => import('./pages/admin-modules-monitor/admin-modules-monitor.page').then(m => m.AdminModulesMonitorPage),
    canActivate: [AdminGuard]
  },
  {
    path: 'admin-schools',
    loadComponent: () => import('./pages/admin-schools/admin-schools.page').then(m => m.AdminSchoolsPage),
    canActivate: [AdminGuard]
  },
  {
    path: 'admin-roster/:schoolId',
    loadComponent: () => import('./pages/admin-roster/admin-roster.page').then(m => m.AdminRosterPage),
    canActivate: [AdminGuard]
  },
  {
    path: 'teacher-dashboard',
    loadChildren: () => import('./pages/teacher-dashboard/teacher-dashboard.module').then(m => m.TeacherDashboardPageModule),
    canActivate: [TeacherGuard]
  },
  {
    path: 'student-dashboard',
    loadChildren: () => import('./pages/student-dashboard/student-dashboard.module').then(m => m.StudentDashboardPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'class-list',
    loadChildren: () => import('./pages/class-list/class-list.module').then(m => m.ClassListPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'subject-list/:id',
    loadChildren: () => import('./pages/subject-list/subject-list.module').then(m => m.SubjectListPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'class-students/:classId',
    loadChildren: () => import('./pages/class-students/class-students.module').then(m => m.ClassStudentsPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'class-students/:classId/:subjectId',
    loadChildren: () => import('./pages/class-students/class-students.module').then(m => m.ClassStudentsPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'tos/:classId/:subjectId',
    loadChildren: () => import('./pages/tos/tos.module').then(m => m.TosPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'answer-sheet-generator/:classId/:subjectId',
    loadChildren: () => import('./pages/answer-sheet-generator/answer-sheet-generator.module').then(m => m.AnswerSheetGeneratorPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'question-generator/:classId/:subjectId',
    loadChildren: () => import('./pages/question-generator/question-generator.module').then(m => m.QuestionGeneratorPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'scan',
    loadChildren: () => import('./pages/scan/scan.module').then( m => m.ScanPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'resultviewer',
    loadChildren: () => import('./pages/resultviewer/resultviewer.module').then( m => m.ResultviewerPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'answer-key/:classId/:subjectId',
    loadChildren: () => import('./pages/answer-key/answer-key.module').then(m => m.AnswerKeyPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'teacher-settings',
    loadComponent: () => import('./pages/teacher-settings/teacher-settings.page').then(m => m.TeacherSettingsPage),
    canActivate: [TeacherGuard]
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
