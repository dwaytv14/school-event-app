import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WorkspaceSyncService } from './core/services/workspace-sync.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent {
  private readonly sync = inject(WorkspaceSyncService);

  constructor() {
    void this.sync.initialize();
  }
}
