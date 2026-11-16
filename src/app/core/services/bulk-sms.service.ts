import { computed, inject, Injectable, signal } from '@angular/core';
import { SmsMessage } from '../models/school-event.models';
import { NativeSmsService } from './native-sms.service';
import { SmsService } from './sms.service';

/**
 * Sends a batch of outbox messages one after another from the phone's SIM and
 * tracks progress. Messages that fail stay "Queued" so they can be retried.
 */
@Injectable({ providedIn: 'root' })
export class BulkSmsService {
  private readonly native = inject(NativeSmsService);
  private readonly sms = inject(SmsService);

  readonly total = signal(0);
  readonly sent = signal(0);
  readonly failed = signal(0);
  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly progress = computed(() => {
    const total = this.total();
    return total === 0 ? 0 : (this.sent() + this.failed()) / total;
  });

  /** Pause between messages so the phone is not flooded. */
  paceMs = 900;

  private queue: SmsMessage[] = [];
  private failedMessages: SmsMessage[] = [];
  private stopRequested = false;

  /** Adds messages to the sending queue and starts sending if idle. */
  async run(messages: SmsMessage[]): Promise<void> {
    if (messages.length === 0) return;
    if (!this.running()) {
      this.total.set(0);
      this.sent.set(0);
      this.failed.set(0);
      this.failedMessages = [];
      this.error.set(null);
    }
    const waiting = new Set(this.queue.map((message) => message.id));
    const fresh = messages.filter((message) => !waiting.has(message.id));
    this.queue.push(...fresh);
    this.total.update((total) => total + fresh.length);
    if (!this.running()) await this.drain();
  }

  /** Sends every message still waiting in the outbox. */
  async sendQueued(): Promise<void> {
    if (this.running()) return;
    await this.run(
      this.sms.messages().filter((message) => message.status === 'Queued'),
    );
  }

  async retryFailed(): Promise<void> {
    if (this.running() || this.failedMessages.length === 0) return;
    const retry = this.failedMessages;
    this.failedMessages = [];
    this.failed.set(0);
    this.error.set(null);
    this.total.set(this.sent() + retry.length);
    this.queue.push(...retry);
    await this.drain();
  }

  stop(): void {
    this.stopRequested = true;
  }

  private async drain(): Promise<void> {
    this.running.set(true);
    this.stopRequested = false;
    await this.native.keepAwake(true);
    try {
      while (this.queue.length > 0 && !this.stopRequested) {
        const message = this.queue.shift() as SmsMessage;
        try {
          await this.native.send(message.recipientNumber, message.text);
          await this.sms.markSent(message.id);
          this.sent.update((count) => count + 1);
        } catch (error) {
          this.failed.update((count) => count + 1);
          this.failedMessages.push(message);
          this.error.set(this.describe(error));
          if (this.code(error) === 'PERMISSION_DENIED') {
            this.stopRequested = true;
          }
        }
        if (this.queue.length > 0 && !this.stopRequested && this.paceMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.paceMs));
        }
      }
    } finally {
      // Anything not sent stays "Queued" in the outbox for later.
      this.total.set(this.sent() + this.failed());
      this.queue = [];
      this.running.set(false);
      await this.native.keepAwake(false);
    }
  }

  private code(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  }

  private describe(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return 'A text message could not be sent.';
  }
}
