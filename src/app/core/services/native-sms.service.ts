import { Injectable } from '@angular/core';
import { Capacitor, PermissionState, registerPlugin } from '@capacitor/core';

interface SmsSenderPlugin {
  send(options: { to: string; text: string }): Promise<{ sent: boolean }>;
  keepAwake(options: { enabled: boolean }): Promise<void>;
  checkPermissions(): Promise<{ sms: PermissionState }>;
  requestPermissions(): Promise<{ sms: PermissionState }>;
}

const SmsSender = registerPlugin<SmsSenderPlugin>('SmsSender');

/**
 * Sends real text messages from the phone's own SIM, using its load or
 * unlimited-text promo. Only available in the Android app.
 */
@Injectable({ providedIn: 'root' })
export class NativeSmsService {
  available(): boolean {
    return (
      Capacitor.getPlatform() === 'android' &&
      Capacitor.isPluginAvailable('SmsSender')
    );
  }

  async ensurePermission(): Promise<boolean> {
    try {
      const current = await SmsSender.checkPermissions();
      if (current.sms === 'granted') return true;
      const requested = await SmsSender.requestPermissions();
      return requested.sms === 'granted';
    } catch {
      return false;
    }
  }

  async send(to: string, text: string): Promise<void> {
    await SmsSender.send({ to, text });
  }

  async keepAwake(enabled: boolean): Promise<void> {
    try {
      await SmsSender.keepAwake({ enabled });
    } catch {
      // Keeping the screen on is a convenience only.
    }
  }
}
