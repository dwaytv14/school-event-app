import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { DemoStoreService } from '../core/services/demo-store.service';
import { HomePage } from './home.page';
import { addDaysToKey, schoolDateKey } from '../core/services/time-format';

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

  it('shows only approved events by default', () => {
    const store = TestBed.inject(DemoStoreService);
    const event = {
      name: 'Campus day',
      date: '2099-01-01',
      startTime: '08:00',
      endTime: '16:00',
      venue: 'Quadrangle',
      description: 'School event',
      graceMinutes: 0,
      sections: [],
      seats: [],
    };
    store.replace({
      ...store.state(),
      events: [
        { ...event, id: 'approved', approvalStatus: 'approved' },
        { ...event, id: 'rejected', approvalStatus: 'rejected' },
      ],
    });
    component.eventFilter.set('all');

    expect(component.eventStatusFilter()).toBe('approved');
    expect(component.visibleEvents().map((item) => item.id)).toEqual(['approved']);
  });

  it('offers admin-configured section names at student signup', () => {
    component.signupForm.course = 'BSIT';
    component.signupForm.yearLevel = '1st Year';
    component.schoolSections.set([
      { id: 'bsit-1-c', course: 'BSIT', yearLevel: '1st Year', name: 'C' },
      { id: 'bsit-1-d', course: 'BSIT', yearLevel: '1st Year', name: 'D' },
    ]);

    expect(component.signupSectionNames()).toEqual(['C', 'D']);
  });

  it('searches and toggles multiple required sections in the event picker', () => {
    component.schoolSections.set([
      { id: 'bsit-1-c', course: 'BSIT', yearLevel: '1st Year', name: 'C' },
      { id: 'bsit-1-d', course: 'BSIT', yearLevel: '1st Year', name: 'D' },
      { id: 'bsit-2-a', course: 'BSIT', yearLevel: '2nd Year', name: 'A' },
      { id: 'bsed-1-a', course: 'BSED', yearLevel: '1st Year', name: 'A' },
    ]);
    component.eventSectionSearch = 'BSIT 1st Year';

    expect(component.filteredEventSections().map((section) => section.id)).toEqual([
      'bsit-1-c',
      'bsit-1-d',
    ]);
    const scopeLabels = component.eventSectionScopes().map((scope) => scope.label);
    expect(scopeLabels).toContain('All Years & Levels');
    expect(scopeLabels).toContain('All BSIT');
    expect(scopeLabels).toContain('All BSED');
    expect(scopeLabels).toContain('All 1st Year');
    expect(scopeLabels).toContain('All 2nd Year');
    expect(scopeLabels).toContain('All BSIT 1st Year');
    expect(scopeLabels).toContain('All BSIT 2nd Year');

    const scope = component.eventSectionScopes().find(
      (item) => item.key === 'course-year:BSIT:1st Year',
    );
    expect(scope?.sectionIds).toEqual(['bsit-1-c', 'bsit-1-d']);
    if (!scope) return;
    component.toggleEventSectionScope(scope);

    expect(component.eventSectionChoices().map((section) => section.name)).toEqual([
      'C',
      'D',
    ]);
    component.toggleRequiredSection('bsit-1-c');
    expect(component.eventSectionChoices().map((section) => section.name)).toEqual(['D']);

    component.toggleEventSectionScope(scope);
    expect(component.selectedEventRequiredSections().sort()).toEqual([
      'bsit-1-c',
      'bsit-1-d',
    ]);
    component.toggleEventSectionScope(scope);
    expect(component.selectedEventRequiredSections()).toEqual([]);
  });

  it('counts expected attendees from the selected sections', () => {
    const store = TestBed.inject(DemoStoreService);
    component.schoolSections.set([
      { id: 'bsit-1-c', course: 'BSIT', yearLevel: '1st Year', name: 'C' },
    ]);
    component.selectedEventRequiredSections.set(['bsit-1-c']);
    store.replace({
      ...store.state(),
      students: [
        ...Array.from({ length: 300 }, (_, index) => ({
          id: `BSIT-${index}`,
          name: `Student ${index}`,
          section: 'BSIT 1st Year C',
          sectionId: 'bsit-1-c',
          mobile: '',
        })),
        {
          id: 'OTHER-1',
          name: 'Other student',
          section: 'BSIT 2nd Year A',
          sectionId: 'bsit-2-a',
          mobile: '',
        },
      ],
    });
    const event = {
      id: 'EVT-300',
      name: 'Campus day',
      date: '2099-01-01',
      startTime: '08:00',
      endTime: '16:00',
      venue: 'Quadrangle',
      description: '',
      graceMinutes: 0,
      sections: ['BSIT 1st Year C'],
      requiredSections: ['bsit-1-c'],
      seats: [],
    };

    expect(component.selectedEventAttendeeCount()).toBe(300);
    expect(component.eventAttendeeCount(event)).toBe(300);
  });

  it('uses the workspace attendee count when a student sees the event', () => {
    const store = TestBed.inject(DemoStoreService);
    component.auth.role.set('student');
    store.replace({
      ...store.state(),
      role: 'student',
      students: [
        {
          id: 'student-1',
          name: 'Student',
          section: 'BSIT 1st Year C',
          sectionId: 'bsit-1-c',
          mobile: '',
        },
      ],
    });
    const event = {
      id: 'EVT-300',
      name: 'Campus day',
      date: '2099-01-01',
      startTime: '08:00',
      endTime: '16:00',
      venue: 'Quadrangle',
      description: '',
      graceMinutes: 0,
      sections: ['BSIT 1st Year C'],
      seats: [],
      expectedAttendeeCount: 300,
    };

    expect(component.eventAttendeeCount(event)).toBe(300);
  });

  it('does not accept a date in the past', () => {
    component.setEventDate('2000-01-01');

    expect(component.eventForm.date).toBe('');
    expect(component.eventError()).toBe('Choose today or a future date.');
  });

  it('asks for a name and a sensible start and end time', () => {
    component.eventForm.date = component.minimumEventDate;
    component.eventForm.name = '   ';
    component.saveEvent();
    expect(component.eventError()).toBe('Enter the event name.');

    component.eventForm.name = 'Foundation Day';
    component.eventForm.startTime = '16:00';
    component.eventForm.endTime = '08:00';
    component.saveEvent();
    expect(component.eventError()).toBe('The end time must be after the start time.');
  });

  it('counts what the admin needs to know on the home screen', () => {
    const store = TestBed.inject(DemoStoreService);
    const day = (offset: number) => addDaysToKey(schoolDateKey(), offset);
    const make = (id: string, date: string, extra: object = {}) => ({
      id, name: id, date, startTime: '08:00', endTime: '10:00', venue: 'Gymnasium',
      description: '', graceMinutes: 15, sections: [], seats: [], approvalStatus: 'approved' as const, ...extra,
    });
    store.replace({
      ...store.state(),
      events: [
        make('today', day(0)),
        make('soon', day(3)),
        make('later', day(9), { approvalStatus: 'pending' }),
        make('old', day(-5)),
        make('cancelled', day(2), { cancelled: true }),
        make('rejected', day(4), { approvalStatus: 'rejected' }),
      ],
    });

    expect(component.adminStats().today).toBe(1);
    expect(component.adminStats().upcoming).toBe(1);
    expect(component.adminStats().pending).toBe(1);
    // Only what is still to come: no past, cancelled or rejected events.
    expect(component.adminUpcomingEvents().map((e) => e.id)).toEqual(['today', 'soon', 'later']);
  });

  it('does not call anyone absent in the report until the event is over', () => {
    const store = TestBed.inject(DemoStoreService);
    const event = {
      id: 'EVT-r', name: 'Report day', date: schoolDateKey(), startTime: '08:00', endTime: '10:00',
      venue: 'Gymnasium', description: '', graceMinutes: 15, sections: ['BSIT 1A'], seats: [],
      approvalStatus: 'approved' as const,
    };
    store.replace({
      ...store.state(),
      selectedEventId: 'EVT-r',
      students: [
        { id: 'S1', name: 'Ana', section: 'BSIT 1A', mobile: '1' },
        { id: 'S2', name: 'Ben', section: 'BSIT 1A', mobile: '2' },
        { id: 'S3', name: 'Cy', section: 'BSIT 1A', mobile: '3' },
      ],
      events: [event],
      attendance: [
        { id: 'A1', eventId: 'EVT-r', studentId: 'S1', timeIn: new Date().toISOString(), timeOut: null, durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced' },
        { id: 'A2', eventId: 'EVT-r', studentId: 'S2', timeIn: '', timeOut: null, durationMinutes: null, status: 'Excused', syncStatus: 'Synced', excused: true, manual: true },
      ],
    });

    const during = component.sectionReport()[0];
    expect(during.notYet).toBe(1); // Cy has not come yet
    expect(during.absent).toBe(0);
    // Excused students are not counted as checked in on the scan page.
    expect(component.scannedCount()).toBe(1);
    expect(component.scannedList().map((row) => row.name)).toEqual(['Ana']);

    store.update((state) => {
      state.events[0].finishedAt = new Date().toISOString();
    });
    const after = component.sectionReport()[0];
    expect(after.notYet).toBe(0);
    expect(after.absent).toBe(1);
  });

  it('opens scanning by itself when midnight passes with the app left open', () => {
    const store = TestBed.inject(DemoStoreService);
    component.auth.role.set('super_admin');
    const tomorrow = addDaysToKey(schoolDateKey(), 1);
    store.replace({
      ...store.state(),
      selectedEventId: 'EVT-t',
      events: [{
        id: 'EVT-t', name: 'Tomorrow fest', date: tomorrow, startTime: '08:00', endTime: '10:00',
        venue: 'Gymnasium', description: '', graceMinutes: 15, sections: [], seats: [],
        approvalStatus: 'approved' as const,
      }],
    });
    expect(component.actions().scan).toBe(false); // not started yet
    expect(component.scannableEvents()).toHaveLength(0);

    // It becomes the event day while the app stays open: no data changed at all.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${tomorrow}T09:00:00+08:00`));
    try {
      component.schoolDay.set(tomorrow);
      expect(component.actions().scan).toBe(true);
      expect(component.scannableEvents()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the message fixed to the screen, offers Undo, and goes away by itself', () => {
    vi.useFakeTimers();
    try {
      let undone = 0;
      component['showToast']('Marked excused', 'success', () => { undone += 1; });
      fixture.detectChanges();
      const box = fixture.nativeElement.querySelector('.app-toast') as HTMLElement;
      expect(box?.textContent).toContain('Marked excused');
      expect(box?.textContent).toContain('Undo');
      expect(getComputedStyle(box).position).not.toBe('static');

      component.undoToast();
      expect(undone).toBe(1);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.app-toast')).toBeNull();

      component['showToast']('Saved');
      vi.advanceTimersByTime(3300);
      expect(component.toastState()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('a student\'s events', () => {
    const day = (offset: number) => addDaysToKey(schoolDateKey(), offset);
    const make = (id: string, date: string, extra: object = {}) => ({
      id, name: id, date, startTime: '08:00', endTime: '10:00', venue: 'Gymnasium', description: '',
      graceMinutes: 15, sections: [], seats: [], requiredSections: ['sec-a'],
      approvalStatus: 'approved' as const, ...extra,
    });
    const attended = (eventId: string) => ({
      id: 'A-' + eventId, eventId, studentId: 'PPY-1', timeIn: new Date().toISOString(),
      timeOut: new Date().toISOString(), durationMinutes: 60, status: 'Present' as const, syncStatus: 'Synced' as const,
    });

    function setUp(events: ReturnType<typeof make>[], attendance: ReturnType<typeof attended>[] = []) {
      const store = TestBed.inject(DemoStoreService);
      component.auth.role.set('student');
      store.replace({
        ...store.state(),
        role: 'student',
        studentId: 'PPY-1',
        students: [{ id: 'PPY-1', name: 'Ana', section: 'BSIT 1st Year A', sectionId: 'sec-a', mobile: '1' }],
        events,
        attendance,
        selectedEventId: events[0]?.id ?? '',
      });
    }

    it('lists upcoming events, and past ones only if the student went and it was not cancelled', () => {
      setUp(
        [
          make('soon', day(3)),
          make('today', day(0)),
          make('went', day(-5)),
          make('missed', day(-6)),
          make('cancelled-past', day(-7), { cancelled: true }),
          make('cancelled-soon', day(4), { cancelled: true }),
          make('other-section', day(2), { requiredSections: ['sec-z'] }),
        ],
        [attended('went'), attended('cancelled-past')],
      );
      expect(component.myEvents().map((e) => e.id).sort()).toEqual(['cancelled-soon', 'soon', 'today', 'went']);
    });

    it('offers an excuse letter on the event itself, from the day before', () => {
      setUp([make('tomorrow', day(1)), make('far', day(5))]);
      component.myExcuses.set([]);
      expect(component.eventExcuse()?.canSend).toBe(true); // opens the day before

      component.events.select('far');
      const far = component.eventExcuse();
      expect(far?.canSend).toBe(false);
      expect(far?.opensOn).toBe(day(4));
    });

    it('shows the state of a letter already sent, and nothing for an event the student attended', () => {
      setUp([make('today', day(0))]);
      component.myExcuses.set([{
        id: 'X', eventId: 'today', eventName: 'today', studentId: 'PPY-1', studentName: 'Ana', section: 'A',
        reason: 'sick for the day', status: 'pending', reviewerNote: null, createdAt: '', reviewedAt: null,
        reviewedBy: null, hasPhoto: false,
      }]);
      expect(component.eventExcuse()?.canSend).toBe(false);
      expect(component.eventExcuse()?.request?.status).toBe('pending');

      setUp([make('today', day(0))], [attended('today')]);
      component.myExcuses.set([]);
      expect(component.eventExcuse()?.canSend).toBe(false);
    });
  });

  describe('the Who is attending box', () => {
    const sections = [
      { id: 'it1a', course: 'BSIT', yearLevel: '1st Year', name: 'A' },
      { id: 'it1b', course: 'BSIT', yearLevel: '1st Year', name: 'B' },
      { id: 'it2a', course: 'BSIT', yearLevel: '2nd Year', name: 'A' },
      { id: 'ba1a', course: 'BSBA', yearLevel: '1st Year', name: 'A' },
      { id: 'ba2a', course: 'BSBA', yearLevel: '2nd Year', name: 'A' },
    ];
    const labels = () => component.eventSectionChips().map((chip) => chip.label);

    beforeEach(() => component.schoolSections.set(sections));

    it('shows "All Years & Levels" as one tag, not every section', () => {
      component.toggleEventSectionScope(component.eventSectionScopes()[0]);
      expect(component.selectedEventRequiredSections()).toHaveLength(5);
      expect(labels()).toEqual(['All Years & Levels']);
    });

    it('shows a whole course as one tag and the rest one by one', () => {
      const bsit = component.eventSectionScopes().find((scope) => scope.key === 'course:BSIT')!;
      component.toggleEventSectionScope(bsit);
      component.toggleRequiredSection('ba1a');
      expect(labels()).toEqual(['All BSIT', 'BSBA 1st Year A']);
    });

    it('shows a single section as that section, and a half-chosen group section by section', () => {
      component.toggleRequiredSection('it1a');
      expect(labels()).toEqual(['BSIT 1st Year A']);
      component.toggleRequiredSection('it1b');
      expect(labels()).toEqual(['All BSIT 1st Year']);
      component.toggleRequiredSection('it2a');
      expect(labels()).toEqual(['All BSIT']);
    });

    it('removing a group tag removes everything in it', () => {
      component.toggleEventSectionScope(component.eventSectionScopes()[0]);
      component.removeEventSectionChip(component.eventSectionChips()[0]);
      expect(component.selectedEventRequiredSections()).toEqual([]);
      expect(component.eventSectionChips()).toEqual([]);
    });
  });

  it('opens username, password and contact number as pop-ups, not pages', () => {
    const go = vi.spyOn(component, 'go');
    component.openSecurityForm('settings-username');
    expect(component.securityModal()).toBe('username');
    expect(component.securityTitle()).toBe('Change username');
    component.openSecurityForm('settings-password');
    expect(component.securityModal()).toBe('password');
    component.openContactForm();
    expect(component.securityModal()).toBe('contact');
    expect(component.securityTitle()).toBe('Change contact number');
    expect(go).not.toHaveBeenCalled(); // nothing navigated away

    component.securityError.set('Something');
    component.closeSecurityModal();
    expect(component.securityModal()).toBeNull();
    expect(component.securityError()).toBeNull();
  });

  it('will not change the username without the current password, and never contacts the server', async () => {
    const change = vi.spyOn(component['workspaceApi'], 'changeUsername');
    component.openSecurityForm('settings-username');
    component.securityForm.newUsername = 'prank.name';
    component.securityForm.currentPassword = '';

    await component.saveNewUsername();

    expect(component.securityError()).toBe('Enter your current password.');
    expect(change).not.toHaveBeenCalled();
    expect(component.securityModal()).toBe('username'); // stays open
  });

  it('says there is no ongoing event, instead of showing a scanner that cannot be used', () => {
    const store = TestBed.inject(DemoStoreService);
    component.auth.authenticated.set(true);
    component.auth.role.set('super_admin');
    store.replace({
      ...store.state(),
      role: 'super_admin',
      selectedEventId: 'EVT-later',
      events: [{
        id: 'EVT-later', name: 'Later fest', date: addDaysToKey(schoolDateKey(), 5), startTime: '08:00',
        endTime: '10:00', venue: 'Gymnasium', description: '', graceMinutes: 15, sections: [], seats: [],
        approvalStatus: 'approved' as const,
      }],
    });
    component.page.set('scan');
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('No ongoing event');
    expect(page.textContent).toContain('There is no currently ongoing event to use the scanner.');
    expect(page.querySelector('.scanner-frame')).toBeNull();
    expect(page.textContent).not.toContain('Open camera scanner');
  });

  describe('the section report on a long list', () => {
    const labels = ['BSIT 1st Year A', 'BSIT 4th Year A', 'BSIT 4th Year B', 'BSED 4th Year A', 'BSBA 2nd Year B'];

    beforeEach(() => {
      const store = TestBed.inject(DemoStoreService);
      store.replace({
        ...store.state(),
        selectedEventId: 'EVT-big',
        students: labels.map((section, i) => ({ id: 'S' + i, name: 'Student ' + i, section, mobile: '1' })),
        events: [{
          id: 'EVT-big', name: 'Big event', date: schoolDateKey(), startTime: '08:00', endTime: '10:00',
          venue: 'Gymnasium', description: '', graceMinutes: 15, sections: labels, seats: [],
          approvalStatus: 'approved' as const,
        }],
        attendance: [],
      });
    });

    it('lists every section, with the courses and years to choose from', () => {
      expect(component.visibleReportSections().map((s) => s.section)).toHaveLength(5);
      expect(component.reportCourses()).toEqual(['BSBA', 'BSED', 'BSIT']);
      expect(component.reportYears()).toEqual(['1st Year', '2nd Year', '4th Year']);
    });

    it('narrows to a course, a year, or what you type', () => {
      component.reportCourse.set('BSIT');
      expect(component.visibleReportSections().map((s) => s.section)).toEqual(['BSIT 1st Year A', 'BSIT 4th Year A', 'BSIT 4th Year B']);
      component.reportYear.set('4th Year');
      expect(component.visibleReportSections().map((s) => s.section)).toEqual(['BSIT 4th Year A', 'BSIT 4th Year B']);
      component.reportSearch.set('year b');
      expect(component.visibleReportSections().map((s) => s.section)).toEqual(['BSIT 4th Year B']);
      component.clearReportFilters();
      expect(component.visibleReportSections()).toHaveLength(5);
    });

    it('groups the sections under their course', () => {
      expect(component.reportGroups().map((g) => [g.course, g.sections.length])).toEqual([
        ['BSIT', 3], ['BSED', 1], ['BSBA', 1],
      ]);
      component.reportYear.set('4th Year');
      expect(component.reportGroups().map((g) => [g.course, g.sections.length])).toEqual([['BSIT', 2], ['BSED', 1]]);
    });

    it('adds up the whole event, not counting excused students against anyone', () => {
      const store = TestBed.inject(DemoStoreService);
      store.update((state) => {
        state.attendance = [
          { id: 'A0', eventId: 'EVT-big', studentId: 'S0', timeIn: new Date().toISOString(), timeOut: new Date().toISOString(), durationMinutes: 60, status: 'Present', syncStatus: 'Synced' },
          { id: 'A1', eventId: 'EVT-big', studentId: 'S1', timeIn: '', timeOut: null, durationMinutes: null, status: 'Excused', syncStatus: 'Synced', excused: true, manual: true },
        ];
        state.events[0].finishedAt = new Date().toISOString(); // the event is over, so the rest are absent
      });
      const total = component.reportOverall();
      expect(total).toMatchObject({ students: 5, excused: 1, absent: 3 });
      expect(total.percentage).toBe(25); // 1 attended of the 4 who were expected
    });

    it('keeps only one section open, so the page stays short', () => {
      component.toggleReportSection('BSIT 4th Year A');
      expect(component.selectedReportSection()).toBe('BSIT 4th Year A');
      component.toggleReportSection('BSED 4th Year A');
      expect(component.selectedReportSection()).toBe('BSED 4th Year A');
      component.toggleReportSection('BSED 4th Year A');
      expect(component.selectedReportSection()).toBe('');
    });
  });

  it('shows no report for an event that has not started, only for events that have', () => {
    const store = TestBed.inject(DemoStoreService);
    component.auth.authenticated.set(true);
    component.auth.role.set('super_admin');
    const make = (id: string, date: string) => ({
      id, name: id, date, startTime: '08:00', endTime: '10:00', venue: 'Gymnasium', description: '',
      graceMinutes: 15, sections: [], seats: [], approvalStatus: 'approved' as const,
    });
    store.replace({
      ...store.state(),
      role: 'super_admin',
      selectedEventId: 'later',
      events: [make('later', addDaysToKey(schoolDateKey(), 3)), make('today', schoolDateKey()), make('old', addDaysToKey(schoolDateKey(), -4))],
    });
    expect(component.reportEvents().map((e) => e.id).sort()).toEqual(['old', 'today']);
    expect(component.actions().report).toBe(false); // the open event ('later') has not started

    component.page.set('reports');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No attendance to report yet');
    expect((fixture.nativeElement as HTMLElement).querySelector('.sr-summary')).toBeNull();
  });

  it('shows an organizer only a few events on the home page, soonest first', () => {
    const store = TestBed.inject(DemoStoreService);
    component.auth.role.set('organizer');
    const day = (offset: number) => addDaysToKey(schoolDateKey(), offset);
    const make = (id: string, date: string, extra: object = {}) => ({
      id, name: id, date, startTime: '08:00', endTime: '10:00', venue: 'Gymnasium', description: '',
      graceMinutes: 15, sections: [], seats: [], approvalStatus: 'approved' as const, ...extra,
    });
    store.replace({
      ...store.state(),
      role: 'organizer',
      events: [
        ...Array.from({ length: 9 }, (_, i) => make('e' + (i + 1), day(i + 1))),
        make('old', day(-3)),
        make('cancelled', day(2), { cancelled: true }),
        make('rejected', day(3), { approvalStatus: 'rejected' as const }),
        make('today', day(0)),
      ],
    });

    expect(component.organizerNext()?.id).toBe('today'); // featured
    expect(component.organizerMore().map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']); // just five
    expect(component.organizerEvents().some((e) => ['old', 'cancelled', 'rejected'].includes(e.id))).toBe(false);
    expect(component.myEvents().length).toBe(13); // the Events page still has the full list
  });

  describe('the admin is asked before approving or rejecting', () => {
    const pending = {
      id: 'EVT-p', name: 'Pending fest', date: addDaysToKey(schoolDateKey(), 7), startTime: '08:00',
      endTime: '10:00', venue: 'Gymnasium', description: '', graceMinutes: 15, sections: [], seats: [],
      approvalStatus: 'pending' as const,
    };
    const excuse = {
      id: 'X1', eventId: 'EVT-p', eventName: 'Pending fest', studentId: 'PPY-1', studentName: 'Ana Cruz',
      section: 'BSIT 1st Year A', reason: 'I was sick for the whole day', status: 'pending' as const,
      reviewerNote: null, createdAt: '', reviewedAt: null, reviewedBy: null, hasPhoto: false,
    };
    const askMock = (answer: boolean) =>
      vi.spyOn(component as unknown as { confirm: (...args: unknown[]) => Promise<boolean> }, 'confirm').mockResolvedValue(answer);

    beforeEach(() => {
      const store = TestBed.inject(DemoStoreService);
      component.auth.role.set('super_admin');
      store.replace({ ...store.state(), events: [pending], selectedEventId: 'EVT-p' });
      vi.spyOn(component, 'syncWorkspace').mockResolvedValue();
    });

    it('does not approve an event unless the admin confirms', async () => {
      const ask = askMock(false);
      await component.approveEvent('EVT-p');
      expect(ask).toHaveBeenCalledWith('Approve this event?', expect.stringContaining('Pending fest'), 'Approve', false);
      expect(TestBed.inject(DemoStoreService).state().events[0].approvalStatus).toBe('pending');

      askMock(true);
      await component.approveEvent('EVT-p');
      expect(TestBed.inject(DemoStoreService).state().events[0].approvalStatus).toBe('approved');
    });

    it('does not approve an excuse unless the admin confirms', async () => {
      const review = vi.spyOn(component['workspaceApi'], 'reviewExcuse').mockResolvedValue(excuse);
      vi.spyOn(component, 'loadExcuses').mockResolvedValue();
      component.excuseDetail.set(excuse);

      askMock(false);
      await component.decideExcuse('approved');
      expect(review).not.toHaveBeenCalled();
      expect(component.excuseDetail()).not.toBeNull(); // still open, nothing decided

      const ask = askMock(true);
      await component.decideExcuse('approved');
      expect(ask).toHaveBeenCalledWith('Approve this excuse?', expect.stringContaining('Ana Cruz'), 'Approve', false);
      expect(review).toHaveBeenCalledTimes(1);
    });

    it('asks once more after the reason before rejecting an excuse', async () => {
      const review = vi.spyOn(component['workspaceApi'], 'reviewExcuse').mockResolvedValue(excuse);
      vi.spyOn(component, 'loadExcuses').mockResolvedValue();
      vi.spyOn(component as unknown as { askReason: (...args: unknown[]) => Promise<string | null> }, 'askReason').mockResolvedValue('Bring a certificate');
      component.excuseDetail.set(excuse);

      askMock(false);
      await component.decideExcuse('rejected');
      expect(review).not.toHaveBeenCalled();

      const ask = askMock(true);
      await component.decideExcuse('rejected');
      expect(ask).toHaveBeenCalledWith('Send this rejection?', expect.stringContaining('Bring a certificate'), 'Reject excuse');
      expect(review).toHaveBeenCalledWith(expect.anything(), 'X1', 'rejected', 'Bring a certificate');
    });
  });

  describe('the admin side: reports, resetting a password, sign out', () => {
    const make = (id: string, date: string) => ({
      id, name: id, date, startTime: '08:00', endTime: '10:00', venue: 'Gymnasium', description: '',
      graceMinutes: 15, sections: [], seats: [], approvalStatus: 'approved' as const,
    });

    function adminWithEvents() {
      const store = TestBed.inject(DemoStoreService);
      component.auth.authenticated.set(true);
      component.auth.role.set('super_admin');
      store.replace({
        ...store.state(),
        role: 'super_admin',
        selectedEventId: 'latest',
        events: [make('latest', schoolDateKey()), make('older', addDaysToKey(schoolDateKey(), -5)), make('later', addDaysToKey(schoolDateKey(), 4))],
      });
    }

    it('makes the admin choose the event before opening a report', () => {
      adminWithEvents();
      const go = vi.spyOn(component, 'go').mockImplementation(() => undefined);
      component.openReportPicker();
      expect(component.reportPicking()).toBe(true);
      expect(go).toHaveBeenCalledWith('reports');
      // only events that have started can be chosen, newest first; the one in the future cannot
      expect(component.reportPickList().map((e) => e.id)).toEqual(['latest', 'older']);

      component.chooseReportEvent('older');
      expect(component.reportPicking()).toBe(false);
      expect(component.state().selectedEventId).toBe('older'); // the one they chose, not the latest

      component.reportBack(); // Back returns to the list, not to an event page
      expect(component.reportPicking()).toBe(true);
    });

    it('opens the report of an event straight away from the event itself', () => {
      adminWithEvents();
      const go = vi.spyOn(component, 'go').mockImplementation(() => undefined);
      component.openReport();
      expect(component.reportPicking()).toBe(false);
      component.reportBack();
      expect(go).toHaveBeenLastCalledWith('event-details');
    });

    it('resets an organizer password in a pop-up without asking for their current password', async () => {
      adminWithEvents();
      const reset = vi.spyOn(component['workspaceApi'], 'resetAccountPassword').mockResolvedValue({ username: 'org1', passwordReset: true } as never);
      component.openResetModal('org1');
      expect(component.resetModal()).toBe('org1');

      component.resetAccountPassword = 'short';
      component.resetConfirm = 'short';
      await component.submitResetModal();
      expect(component.accountError()).toBe('The new password must be 8–128 characters.');

      component.resetAccountPassword = 'a-long-new-password';
      component.resetConfirm = 'something-else-entirely';
      await component.submitResetModal();
      expect(component.accountError()).toBe('The new password and its confirmation do not match.');
      expect(reset).not.toHaveBeenCalled();

      component.resetConfirm = 'a-long-new-password';
      await component.submitResetModal();
      expect(reset).toHaveBeenCalledWith(expect.anything(), 'org1', 'a-long-new-password'); // no current password involved
      expect(component.resetModal()).toBeNull();
    });

    it('shows Sign out only on the main Settings page', () => {
      adminWithEvents();
      const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
      component.page.set('settings');
      fixture.detectChanges();
      expect(text()).toContain('Sign out');
      for (const sub of ['settings-sections', 'settings-organizers', 'settings-activity', 'settings-app']) {
        component.page.set(sub);
        fixture.detectChanges();
        expect(text()).not.toContain('Sign out');
      }
    });

    it('does not repeat Event approvals and Excuse requests as cards on the admin home', () => {
      adminWithEvents();
      component.page.set('home');
      fixture.detectChanges();
      const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.quick-grid button')].map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
      expect(cards.some((c) => c.includes('Create event'))).toBe(true);
      expect(cards.some((c) => c.includes('Event approvals'))).toBe(false);
      expect(cards.some((c) => c.includes('Excuse requests'))).toBe(false);
    });
  });

  it('rejects a fractional grace period', () => {
    component.eventForm.date = component.minimumEventDate;
    component.eventForm.name = 'Foundation Day';
    component.eventForm.startTime = '08:00';
    component.eventForm.endTime = '16:00';
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

  it('lets each name part contain letters and spaces only', () => {
    const typed = typeInto('  Juan  D3la Cruz!! #1 Ñandú-Jr.');
    component.normalizeName(typed.event, 'lastName');

    expect(component.signupForm.lastName).toBe('Juan Dla Cruz ÑandúJr');
    expect(typed.input.value).toBe('Juan Dla Cruz ÑandúJr');
  });

  it('keeps the extension to letters and a dot', () => {
    const typed = typeInto('Jr.#1');
    component.normalizeExtension(typed.event);

    expect(component.signupForm.extension).toBe('Jr.');
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
      firstName: 'Juan 2nd',
      middleName: 'Santos',
      lastName: 'Dela Cruz',
      extension: '',
      course: 'BSIT',
      yearLevel: '1st Year',
      section: 'A',
      mobile: '09123456789',
    };
    await component.submitAuth();
    expect(component.auth.error()).toBe('Names can contain letters and spaces only.');

    component.signupForm.middleName = '';
    await component.submitAuth();
    expect(component.auth.error()).toBe('Enter your first name, middle name, and last name.');

    component.signupForm.firstName = 'Juan';
    component.signupForm.middleName = 'Santos';
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
          date: schoolDateKey(),
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
    expect(component.monitorTableStudents().map((student) => student.id)).toEqual([
      'S2',
      'S1',
      'S3',
    ]);
    component.attendeePrintSection.set('BSIT 1A');
    expect(component.attendeePrintRows().map(({ student }) => student.id)).toEqual([
      'S2',
      'S1',
    ]);
    expect(
      component.studentYearSection({
        id: 'S5',
        name: 'Eli',
        section: 'BSIT 4th Year A',
        course: 'BSIT',
        yearLevel: '4th Year',
        mobile: '',
      }),
    ).toBe('BSIT-4A');
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
