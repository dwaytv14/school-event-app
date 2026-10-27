import { computed, inject, Injectable, signal } from '@angular/core';
import { DemoStoreService } from './demo-store.service';
import { SmsService } from './sms.service';

@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly store = inject(DemoStoreService);
  private readonly sms = inject(SmsService);
  private readonly browserOnline = signal(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  readonly isOnline = computed(
    () => this.browserOnline() && !this.store.state().simulatedOffline,
  );
  readonly progress = signal<number | null>(null);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.browserOnline.set(true));
      window.addEventListener('offline', () => this.browserOnline.set(false));
    }
  }

  toggleSimulation(): void {
    this.store.update((state) => {
      state.simulatedOffline = !state.simulatedOffline;
    });
  }

  async syncNow(): Promise<void> {
    if (!this.isOnline()) return;
    this.progress.set(8);
    try {
      for (const value of [34, 68, 100]) {
        await new Promise((resolve) => setTimeout(resolve, 220));
        this.progress.set(value);
      }
      await this.sms.markAllSynced();
      this.store.update((state) => {
        state.syncItems.forEach((item) => {
          item.status = 'Synced';
        });
        state.attendance.forEach((record) => {
          record.syncStatus = 'Synced';
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      this.progress.set(null);
    }
  }
}
