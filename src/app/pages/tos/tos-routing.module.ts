import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { TosPage } from './tos.page';
import { TosResponsePage } from './tos-response.page';

const routes: Routes = [
  {
    path: '',
    component: TosPage
  },
  {
    path: 'responses/:question/:option',
    component: TosResponsePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TosPageRoutingModule {}
