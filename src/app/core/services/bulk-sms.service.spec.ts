import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SmsMessage } from '../models/school-event.models';
import { BulkSmsService } from './bulk-sms.service';
import { NativeSmsService } from './native-sms.service';
import { SmsService } from './sms.service';

function message(id: string, number: string): SmsMessage {
  return {
    id,
    recipientName: id,
    recipientNumber: number,
    text: 'GATHER update: Hello',
    createdAt: '2030-01-01T00:00:00.000Z',
    status: 'Queued',
    syncStatus: 'Pending sync',
  };
}

describe('BulkSmsService', () => {
  const send = vi.fn<(to: string, text: string) => Promise<void>>();
  const markSent = vi.fn<(id: string) => Promise<void>>();
  const keepAwake = vi.fn<(enabled: boolean) => Promise<void>>();
  let bulk: BulkSmsService;

  beforeEach(() => {
    send.mockReset().mockResolvedValue(undefined);
    markSent.mockReset().mockResolvedValue(undefined);
    keepAwake.mockReset().mockResolvedValue(undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: NativeSmsService, useValue: { send, keepAwake } },
        { provide: SmsService, useValue: { markSent, messages: () => [] } },
      ],
    });
    bulk = TestBed.inject(BulkSmsService);
    bulk.paceMs = 0;
  });

  it('sends every message from the SIM and marks each as sent', async () => {
    await bulk.run([message('a', '+639170000001'), message('b', '+639170000002')]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('+639170000001', 'GATHER update: Hello');
    expect(markSent).toHaveBeenCalledWith('a');
    expect(markSent).toHaveBeenCalledWith('b');
    expect(bulk.sent()).toBe(2);
    expect(bulk.failed()).toBe(0);
    expect(bulk.running()).toBe(false);
    expect(keepAwake).toHaveBeenLastCalledWith(false);
  });

  it('keeps going after one message fails and can retry it', async () => {
    send.mockRejectedValueOnce({ code: 'SEND_FAILED', message: 'No mobile signal.' });

    await bulk.run([message('a', '1'), message('b', '2'), message('c', '3')]);

    expect(bulk.sent()).toBe(2);
    expect(bulk.failed()).toBe(1);
    expect(bulk.error()).toBe('No mobile signal.');
    expect(markSent).not.toHaveBeenCalledWith('a');

    await bulk.retryFailed();

    expect(bulk.sent()).toBe(3);
    expect(bulk.failed()).toBe(0);
    expect(markSent).toHaveBeenCalledWith('a');
  });

  it('stops everything when the SMS permission is denied', async () => {
    send.mockRejectedValue({ code: 'PERMISSION_DENIED', message: 'SMS permission was denied.' });

    await bulk.run([message('a', '1'), message('b', '2'), message('c', '3')]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(bulk.sent()).toBe(0);
    expect(bulk.running()).toBe(false);
  });
});
