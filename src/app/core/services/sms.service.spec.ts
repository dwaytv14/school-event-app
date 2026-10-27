import { DemoStoreService } from './demo-store.service';
import { SmsService } from './sms.service';
import { TestBed } from '@angular/core/testing';

const student = {
  id: 'STU-001',
  name: 'Test Student',
  section: 'Grade 10-A',
  mobile: '+639000000001',
};

describe('SmsService', () => {
  let store: DemoStoreService;
  let sms: SmsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [DemoStoreService, SmsService],
    });
    store = TestBed.inject(DemoStoreService);
    sms = TestBed.inject(SmsService);
  });

  it('persists the outbox and reloads it for the browser preview', async () => {
    await sms.send(student, 'Event reminder', false);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [DemoStoreService, SmsService],
    });
    const reloadedSms = TestBed.inject(SmsService);
    await reloadedSms.initialize();

    expect(reloadedSms.messages()).toHaveLength(1);
    expect(reloadedSms.messages()[0]).toMatchObject({
      recipientName: student.name,
      recipientNumber: student.mobile,
      text: 'Event reminder',
      status: 'Queued',
      syncStatus: 'Pending sync',
    });
    expect(store.state().syncItems).toHaveLength(1);
  });

  it('migrates existing outbox messages into the new SMS storage', async () => {
    store.update((state) => {
      state.messages.push({
        id: 'SMS-legacy',
        recipientName: student.name,
        recipientNumber: student.mobile,
        text: 'Previous reminder',
        createdAt: '2026-10-10T12:00:00.000Z',
        status: 'Queued',
        syncStatus: 'Pending sync',
      });
    });

    await sms.initialize();

    expect(sms.messages()).toHaveLength(1);
    expect(sms.messages()[0].id).toBe('SMS-legacy');
    expect(store.state().messages).toEqual([]);
  });
});
