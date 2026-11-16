import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { DemoStoreService } from '../core/services/demo-store.service';
import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([])],
    }).compileComponents();
    // Screens call router.navigate; these tests do not define any routes.
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not accept a date in the past', () => {
    component.setEventDate('2000-01-01');

    expect(component.eventForm.date).toBe('');
    expect(component.eventError()).toBe('Choose today or a future date.');
  });

  it('rejects a fractional grace period', () => {
    component.eventForm.date = component.minimumEventDate;
    component.eventForm.graceMinutes = 1.5;

    component.saveEvent();

    expect(component.eventError()).toBe(
      'Grace period must be a whole number from 0 to 120 minutes.',
    );
  });

  it('opens the selected event in edit mode', () => {
    const store = TestBed.inject(DemoStoreService);
    store.replace({
      ...store.state(),
      selectedEventId: 'EVT-1',
      events: [
        {
          id: 'EVT-1',
          name: 'Campus day',
          date: '2030-01-01',
          startTime: '08:00',
          endTime: '16:00',
          venue: 'Quadrangle',
          description: 'School event',
          graceMinutes: 15,
          sections: ['BSIT 1st Year A'],
          seats: [],
          requiredSections: ['section-a'],
        },
      ],
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    component.editEvent();

    expect(component.editingEventId()).toBe('EVT-1');
    expect(component.eventForm.name).toBe('Campus day');
    expect(navigate).toHaveBeenCalledWith(['/workspace', 'edit-event']);
  });

  it('updates the selected event instead of creating a duplicate', () => {
    const store = TestBed.inject(DemoStoreService);
    store.replace({
      ...store.state(),
      selectedEventId: 'EVT-1',
      events: [
        {
          id: 'EVT-1',
          name: 'Campus day',
          date: component.minimumEventDate,
          startTime: '08:00',
          endTime: '16:00',
          venue: 'Quadrangle',
          description: 'School event',
          graceMinutes: 15,
          sections: ['BSIT 1st Year A'],
          seats: [],
          requiredSections: ['section-a'],
        },
      ],
    });
    component.page.set('edit-event');
    component.editingEventId.set('EVT-1');
    component.eventForm = {
      name: 'Updated campus day',
      date: component.minimumEventDate,
      startTime: '08:00',
      endTime: '16:00',
      venue: 'Quadrangle',
      description: 'School event',
      graceMinutes: 15,
      requiredSections: ['section-a'],
    };
    component.stepBlockRows(0, 1);
    component.stepBlockSeats(0, -9);
    component.selectedEventRequiredSections.set(['section-a']);
    component.schoolSections.set([
      {
        id: 'section-a',
        course: 'BSIT',
        yearLevel: '1st Year',
        name: 'A',
      },
    ]);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.saveEvent();

    expect(store.state().events).toHaveLength(1);
    expect(store.state().events[0].name).toBe('Updated campus day');
    expect(store.state().events[0].id).toBe('EVT-1');
  });
  it('texts every targeted student when an update is posted', async () => {
    const store = TestBed.inject(DemoStoreService);
    store.replace({
      ...store.state(),
      students: [
        { id: 'PPY-1', name: 'Ana', section: 'BSIT 1st Year A', sectionId: 'sec-a', course: 'BSIT', mobile: '+639170000001' },
        { id: 'PPY-2', name: 'Ben', section: 'BSIT 1st Year B', sectionId: 'sec-b', course: 'BSIT', mobile: '+639170000002' },
        { id: 'PPY-3', name: 'Cy', section: 'BSBA 1st Year A', sectionId: 'sec-c', course: 'BSBA', mobile: '+639170000003' },
      ],
    });
    const sms = vi
      .spyOn(component.sms, 'sendMany')
      .mockResolvedValue([]);
    component.announcementForm = { title: 'Class suspended', body: 'No classes tomorrow.' };
    component.announcementAudience = 'sections';
    component.selectedAnnouncementSectionIds.set(['sec-a', 'sec-c']);

    await component.createAnnouncement();

    expect(store.state().announcements).toHaveLength(1);
    const [recipients, textFor] = sms.mock.calls[0];
    expect(recipients.map((student) => student.id)).toEqual(['PPY-1', 'PPY-3']);
    expect(textFor(recipients[0])).toContain('Class suspended');
    expect(textFor(recipients[0])).toContain('No classes tomorrow.');
  });

  it('texts all students with a phone number for an all-students update', async () => {
    const store = TestBed.inject(DemoStoreService);
    store.replace({
      ...store.state(),
      students: [
        { id: 'PPY-1', name: 'Ana', section: 'A', mobile: '+639170000001' },
        { id: 'PPY-2', name: 'Ben', section: 'B', mobile: '' },
      ],
    });
    const sms = vi
      .spyOn(component.sms, 'sendMany')
      .mockResolvedValue([]);
    component.announcementForm = { title: 'Hello', body: 'Welcome back' };
    component.announcementAudience = 'all';

    await component.createAnnouncement();

    expect(sms.mock.calls[0][0].map((student) => student.id)).toEqual(['PPY-1']);
  });
  function typeInto(value: string): { event: Event; input: HTMLInputElement } {
    const input = document.createElement('input');
    input.value = value;
    return { event: { target: input } as unknown as Event, input };
  }

  it('lets the full name contain letters and spaces only', () => {
    const typed = typeInto('  Juan  D3la Cruz!! #1 Ñandú-Jr.');
    component.normalizeName(typed.event);

    expect(component.signupForm.name).toBe('Juan Dla Cruz ÑandúJr');
    expect(typed.input.value).toBe('Juan Dla Cruz ÑandúJr');
  });

  it('lets the contact number contain digits only, up to 11', () => {
    const typed = typeInto('+63 (917) 123-4567 89');
    component.normalizeMobile(typed.event);

    expect(component.signupForm.mobile).toBe('63917123456');
    expect(typed.input.value).toBe('63917123456');
  });

  it('blocks registration with a bad name or number before contacting the server', async () => {
    component.authMode.set('register');
    component.authUsername = 'juan01';
    component.authPassword = 'password123';
    component.signupForm = {
      studentNumber: '1001',
      name: 'Juan 2nd',
      course: 'BSIT',
      yearLevel: '1st Year',
      section: 'A',
      mobile: '09123456789',
    };
    await component.submitAuth();
    expect(component.auth.error()).toBe('Full name can contain letters and spaces only.');

    component.signupForm.name = 'Juan Dela Cruz';
    component.signupForm.mobile = '0912345';
    await component.submitAuth();
    expect(component.auth.error()).toContain('11 digits starting with 09');
  });
  it('offers take or choose photo when there is no picture yet', () => {
    component.auth.avatar.set(null);
    component.openPhotoMenu();

    expect(component.photoMenuOpen()).toBe(true);
    expect(component.photoMenuLabels()).toEqual(['Take photo', 'Choose photo']);
  });

  it('offers view or change photo once a picture is set', () => {
    component.auth.avatar.set('data:image/jpeg;base64,AAAA');

    expect(component.photoMenuLabels()).toEqual(['View photo', 'Change photo']);
    component.openPhotoMenu();
    component.pickPhoto('view');

    expect(component.photoMenuOpen()).toBe(false);
    expect(component.photoViewerOpen()).toBe(true);
  });
  it('checks the new password before contacting the server', async () => {
    component.securityForm = {
      currentPassword: 'oldpass123',
      newUsername: '',
      newPassword: 'short',
      confirmPassword: 'short',
    };
    await component.saveNewPassword();
    expect(component.securityError()).toContain('8–128 characters');

    component.securityForm.newPassword = 'brandnew123';
    component.securityForm.confirmPassword = 'different123';
    await component.saveNewPassword();
    expect(component.securityError()).toContain('do not match');

    component.securityForm.confirmPassword = 'brandnew123';
    component.securityForm.currentPassword = 'brandnew123';
    await component.saveNewPassword();
    expect(component.securityError()).toContain('different');
  });

  it('checks the new username before contacting the server', async () => {
    component.securityForm.newUsername = 'a b';
    await component.saveNewUsername();
    expect(component.securityError()).toContain('3–64 characters');

    component.securityForm.newUsername = 'valid.name';
    component.securityForm.currentPassword = '';
    await component.saveNewUsername();
    expect(component.securityError()).toContain('current password');
  });
  it('filters events and picks a day on the calendar', () => {
    const store = TestBed.inject(DemoStoreService);
    const base = {
      startTime: '08:00',
      endTime: '09:00',
      venue: 'Gymnasium',
      description: '',
      graceMinutes: 15,
      sections: [],
      seats: [],
    };
    store.replace({
      ...store.state(),
      events: [
        { ...base, id: 'E-old', name: 'Old', date: '2020-01-05' },
        { ...base, id: 'E-new', name: 'New', date: '2099-01-05' },
      ],
    });

    expect(component.visibleEvents().map((event) => event.id)).toEqual(['E-new']);
    component.setEventFilter('past');
    expect(component.visibleEvents().map((event) => event.id)).toEqual(['E-old']);
    component.setEventFilter('all');
    expect(component.visibleEvents()).toHaveLength(2);

    component.setEventView('calendar');
    component.selectDay('2099-01-05');
    expect(component.visibleEvents().map((event) => event.id)).toEqual(['E-new']);
    expect(component.calendarTitle()).toContain('2099');
  });

  it('checks the new contact number before texting a code', async () => {
    component.contactForm = { mobile: '0912', currentPassword: 'pw', code: '' };
    await component.sendContactCode();
    expect(component.securityError()).toContain('11 digits starting with 09');

    component.contactForm = { mobile: '09123456789', currentPassword: '', code: '' };
    await component.sendContactCode();
    expect(component.securityError()).toContain('current password');

    component.contactForm = { mobile: '09123456789', currentPassword: 'pw', code: '12' };
    await component.sendContactCode();
    expect(component.securityError()).toContain('Android app');

    await component.confirmContactCode();
    expect(component.securityError()).toBe('Enter the 6-digit code.');
  });
  it('shows who is here, who is out, and who is missing at the active event', () => {
    const store = TestBed.inject(DemoStoreService);
    const hour = (offset: number) => new Date(Date.now() + offset * 3600000).toISOString();
    store.replace({
      ...store.state(),
      selectedEventId: 'EVT-live',
      students: [
        { id: 'S1', name: 'Ana', section: 'BSIT 1A', sectionId: 'sec-a', mobile: '1' },
        { id: 'S2', name: 'Ben', section: 'BSIT 1A', sectionId: 'sec-a', mobile: '2' },
        { id: 'S3', name: 'Cy', section: 'BSIT 1A', sectionId: 'sec-a', mobile: '3' },
        { id: 'S4', name: 'Di', section: 'BSBA 1A', sectionId: 'sec-b', mobile: '4' },
      ],
      events: [
        {
          id: 'EVT-live',
          name: 'Live',
          date: '2099-01-01',
          startTime: '08:00',
          endTime: '17:00',
          venue: 'Gymnasium',
          description: '',
          graceMinutes: 15,
          sections: [],
          seats: [],
          requiredSections: ['sec-a'],
          approvalStatus: 'approved',
        },
      ],
      attendance: [
        { id: 'A1', eventId: 'EVT-live', studentId: 'S1', timeIn: hour(-1), timeOut: null, durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced' },
        { id: 'A2', eventId: 'EVT-live', studentId: 'S2', timeIn: hour(-2), timeOut: hour(-1), durationMinutes: 60, status: 'Present', syncStatus: 'Synced' },
      ],
    });

    const summary = component.monitorSummary();
    expect(summary?.total).toBe(3); // only the required section
    expect(summary?.here).toBe(1);
    expect(summary?.out).toBe(1);
    expect(summary?.notYet).toBe(1);
    expect(component.monitorState('S3')?.label).toBe('Not yet here');
  });

  it('lets an organizer edit only their own unapproved events', () => {
    component.auth.role.set('organizer');
    component.auth.userId.set('org-1');
    const base = {
      name: 'E', date: '2099-01-01', startTime: '08:00', endTime: '09:00', venue: 'Gym',
      description: '', graceMinutes: 15, sections: [], seats: [],
    };

    expect(component.canEditEvent({ ...base, id: '1', createdBy: 'org-1', approvalStatus: 'pending' })).toBe(true);
    expect(component.canEditEvent({ ...base, id: '2', createdBy: 'org-1', approvalStatus: 'rejected' })).toBe(true);
    expect(component.canEditEvent({ ...base, id: '3', createdBy: 'org-1', approvalStatus: 'approved' })).toBe(false);
    expect(component.canEditEvent({ ...base, id: '4', createdBy: 'org-2', approvalStatus: 'pending' })).toBe(false);
  });
  it('moves an event and tells the students', async () => {
    const store = TestBed.inject(DemoStoreService);
    store.replace({
      ...store.state(),
      selectedEventId: 'EVT-move',
      events: [
        {
          id: 'EVT-move', name: 'Sports Fest', date: '2099-03-01', startTime: '08:00',
          endTime: '12:00', venue: 'Gymnasium', description: '', graceMinutes: 15,
          sections: [], seats: [], requiredSections: ['sec-a'], approvalStatus: 'approved',
        },
      ],
    });
    component.auth.role.set('super_admin');
    vi.spyOn(component.sms, 'sendMany').mockResolvedValue([]);

    component.postponeForm = { date: '2099-03-01', startTime: '08:00', endTime: '12:00', reason: 'Rain' };
    await component.savePostpone();
    expect(component.postponeError()).toContain('Change the date or the time');

    component.postponeForm = { date: '2099-03-08', startTime: '13:00', endTime: '12:00', reason: 'Rain' };
    await component.savePostpone();
    expect(component.postponeError()).toContain('end time must be after');

    component.postponeForm = { date: '2099-03-08', startTime: '08:00', endTime: '12:00', reason: 'Rain' };
    await component.savePostpone();

    const moved = store.state().events[0];
    expect(moved.date).toBe('2099-03-08');
    expect(moved.postponedFrom).toEqual({ date: '2099-03-01', startTime: '08:00', endTime: '12:00' });
    expect(store.state().announcements[0].title).toBe('Moved: Sports Fest');
    expect(store.state().announcements[0].audience).toEqual({ type: 'sections', sectionIds: ['sec-a'] });
  });

  it('cannot scan a cancelled event', () => {
    const store = TestBed.inject(DemoStoreService);
    component.auth.role.set('super_admin');
    store.replace({
      ...store.state(),
      selectedEventId: 'E',
      events: [
        {
          id: 'E', name: 'Called off', date: '2099-03-01', startTime: '08:00', endTime: '12:00',
          venue: 'Gym', description: '', graceMinutes: 15, sections: [], seats: [],
          approvalStatus: 'approved', cancelled: true,
        },
      ],
    });

    expect(component.canScanActiveEvent()).toBe(false);
  });

  it('groups the activity log and counts what each organizer did', () => {
    expect(component.auditGroup('event_approved')).toBe('events');
    expect(component.auditGroup('announcement')).toBe('events');
    expect(component.auditGroup('attendance_manual')).toBe('attendance');
    expect(component.auditGroup('excuse_approved')).toBe('excuses');
    expect(component.auditGroup('account_deleted')).toBe('accounts');

    const store = TestBed.inject(DemoStoreService);
    store.replace({
      ...store.state(),
      events: [
        { id: 'E1', name: 'A', date: '2099-01-01', startTime: '08:00', endTime: '09:00', venue: 'G', description: '', graceMinutes: 1, sections: [], seats: [], createdBy: 'org-1' },
        { id: 'E2', name: 'B', date: '2099-01-02', startTime: '08:00', endTime: '09:00', venue: 'G', description: '', graceMinutes: 1, sections: [], seats: [], createdBy: 'org-2' },
      ],
      attendance: [
        { id: 'A1', eventId: 'E1', studentId: 'S', timeIn: 'x', timeOut: null, durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced', recordedBy: 'org-1' },
        { id: 'A2', eventId: 'E1', studentId: 'T', timeIn: 'x', timeOut: null, durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced', recordedBy: 'org-1' },
      ],
    });
    component.managedAccounts.set([
      { id: 'org-1', username: 'organizer1', role: 'organizer', studentId: null, createdAt: '' },
      { id: 'org-2', username: 'organizer2', role: 'organizer', studentId: null, createdAt: '' },
    ]);

    expect(component.organizerList().map((item) => [item.account.username, item.events, item.scans])).toEqual([
      ['organizer1', 1, 2],
      ['organizer2', 1, 0],
    ]);
  });

  it('checks an excuse request before sending it', async () => {
    component.startExcuse('E1');
    component.excuseDraft.reason = 'too short';
    await component.submitExcuse();

    expect(component.excuseError()).toContain('10 to 500 characters');
  });
  it('checks the school year settings before saving them', async () => {
    component.schoolYearForm = { enabled: true, endDate: '' };
    await component.saveSchoolYear();
    expect(component.schoolYearError()).toContain('Choose the date');

    component.schoolYearForm = { enabled: true, endDate: '2000-01-01' };
    await component.saveSchoolYear();
    expect(component.schoolYearError()).toContain('cannot be in the past');
  });
});
