import { TestBed } from '@angular/core/testing';
import { AttendanceSummary } from '../../../core/services/my-attendance.service';
import { ExcuseRequest } from '../../../core/services/workspace-api.service';
import { AttendanceSummaryComponent } from './attendance-summary';

const summary: AttendanceSummary = {
  rows: [
    {
      event: {
        id: 'E1', name: 'Missed event', date: '2030-01-01', startTime: '08:00', endTime: '10:00',
        venue: 'Gym', description: '', graceMinutes: 15, sections: [], seats: [],
      },
      status: 'Absent',
      required: true,
    },
  ],
  counted: 1, attended: 0, present: 0, late: 0, absent: 1, excused: 0, percentage: 0,
};

function request(status: ExcuseRequest['status']): ExcuseRequest {
  return {
    id: 'X1', eventId: 'E1', eventName: 'Missed event', studentId: 'S', studentName: 'S',
    section: 'A', reason: 'a reason', status, reviewerNote: 'Bring a certificate',
    createdAt: '', reviewedAt: null, reviewedBy: null, hasPhoto: false,
  };
}

describe('AttendanceSummaryComponent', () => {
  function render(excuses: ExcuseRequest[], allow = true) {
    const fixture = TestBed.createComponent(AttendanceSummaryComponent);
    fixture.componentRef.setInput('summary', summary);
    fixture.componentRef.setInput('excuses', excuses);
    fixture.componentRef.setInput('allowExcuse', allow);
    fixture.detectChanges();
    return fixture;
  }

  it('offers to ask for an excuse when a required event was missed', () => {
    const fixture = render([]);
    const emitted: string[] = [];
    fixture.componentInstance.excuse.subscribe((id) => emitted.push(id));

    const button = fixture.nativeElement.querySelector('button.link') as HTMLButtonElement;
    expect(button.textContent).toContain('Ask to be excused');
    button.click();
    expect(emitted).toEqual(['E1']);
  });

  it('lets the student send an excuse while the event is running', () => {
    for (const status of ['Ongoing'] as const) {
      const fixture = TestBed.createComponent(AttendanceSummaryComponent);
      fixture.componentRef.setInput('summary', {
        ...summary,
        rows: [{ ...summary.rows[0], status }],
      });
      fixture.componentRef.setInput('excuses', []);
      fixture.componentRef.setInput('allowExcuse', true);
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector('button.link') as HTMLButtonElement;
      expect(button?.textContent).toContain('Ask to be excused');
    }
  });

  it('opens early excuses only the day before the event', () => {
    const fixture = render([]);
    const row = { ...summary.rows[0], status: 'Upcoming' as const };
    const component = fixture.componentInstance;
    expect(component.canExcuse(row, new Date('2029-12-31T09:00:00+08:00'))).toBe(true); // event 2030-01-01
    expect(component.canExcuse(row, new Date('2029-11-18T09:00:00+08:00'))).toBe(false); // weeks ahead
  });

  it('does not offer an excuse once the student has attendance recorded', () => {
    const fixture = TestBed.createComponent(AttendanceSummaryComponent);
    fixture.componentRef.setInput('summary', {
      ...summary,
      rows: [
        {
          ...summary.rows[0],
          status: 'Ongoing',
          record: {
            id: 'A', eventId: 'E1', studentId: 'S', timeIn: new Date().toISOString(),
            timeOut: null, durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced',
          },
        },
      ],
    });
    fixture.componentRef.setInput('excuses', []);
    fixture.componentRef.setInput('allowExcuse', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button.link')).toBeNull();
  });

  it('lets the student withdraw a pending request', () => {
    const fixture = render([request('pending')]);
    const withdrawn: string[] = [];
    fixture.componentInstance.withdraw.subscribe((id) => withdrawn.push(id));

    expect(fixture.nativeElement.textContent).toContain('Waiting for the admin');
    (fixture.nativeElement.querySelector('button.link') as HTMLButtonElement).click();
    expect(withdrawn).toEqual(['X1']);
  });

  it('shows why a request was rejected and allows asking again', () => {
    const fixture = render([request('rejected')]);

    expect(fixture.nativeElement.textContent).toContain('Bring a certificate');
    expect(fixture.nativeElement.querySelector('button.link').textContent).toContain('Ask again');
  });

  it('shows no excuse actions when they are not allowed', () => {
    const fixture = render([], false);

    expect(fixture.nativeElement.querySelector('button.link')).toBeNull();
  });
});

describe('AttendanceSummaryComponent cards', () => {
  it('always shows an Excused card, even when it is zero', () => {
    const fixture = TestBed.createComponent(AttendanceSummaryComponent);
    fixture.componentRef.setInput('summary', summary);
    fixture.detectChanges();
    const labels = [...fixture.nativeElement.querySelectorAll('.stat span')].map((el) => (el as HTMLElement).textContent?.trim());
    expect(labels).toContain('Excused');
    const excused = [...fixture.nativeElement.querySelectorAll('.stat')].find((el) => (el as HTMLElement).textContent?.includes('Excused')) as HTMLElement;
    expect(excused.querySelector('strong')?.textContent?.trim()).toBe('0');
  });
});

describe('AttendanceSummaryComponent filter', () => {
  const ev = (id: string, date: string) => ({
    id, name: id, date, startTime: '08:00', endTime: '10:00', venue: 'Gym', description: '',
    graceMinutes: 15, sections: [], seats: [],
  });
  const mixed: AttendanceSummary = {
    rows: [
      { event: ev('later', '2030-03-20'), status: 'Upcoming', required: true },
      { event: ev('soon', '2030-03-12'), status: 'Upcoming', required: true },
      { event: ev('went', '2030-03-01'), status: 'Present', required: true },
      { event: ev('late-one', '2030-02-20'), status: 'Late', required: true },
      { event: ev('missed', '2030-02-10'), status: 'Absent', required: true },
      { event: ev('sick', '2030-02-01'), status: 'Excused', required: true },
    ],
    counted: 3, attended: 2, present: 1, late: 1, absent: 1, excused: 1, percentage: 67,
  };

  function render() {
    const fixture = TestBed.createComponent(AttendanceSummaryComponent);
    fixture.componentRef.setInput('summary', mixed);
    fixture.detectChanges();
    const names = () => [...fixture.nativeElement.querySelectorAll('.row .main strong')].map((el) => (el as HTMLElement).textContent?.trim());
    const choose = (label: string) => {
      const button = [...fixture.nativeElement.querySelectorAll('.filters button')].find((el) => (el as HTMLElement).textContent?.trim().startsWith(label)) as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
    };
    return { fixture, names, choose };
  }

  it('shows everything at first, with a count on each filter', () => {
    const { fixture, names } = render();
    expect(names()).toHaveLength(6);
    const buttons = [...fixture.nativeElement.querySelectorAll('.filters button')].map((el) => (el as HTMLElement).textContent?.replace(/\s+/g, ' ').trim());
    expect(buttons).toEqual(['All 6', 'Upcoming 2', 'Attended 2', 'Absent 1', 'Excused 1']);
  });

  it('keeps upcoming events apart from the ones already attended', () => {
    const { names, choose } = render();
    choose('Upcoming');
    expect(names()).toEqual(['soon', 'later']); // soonest first
    choose('Attended');
    expect(names()).toEqual(['went', 'late-one']);
    choose('Absent');
    expect(names()).toEqual(['missed']);
    choose('Excused');
    expect(names()).toEqual(['sick']);
    choose('All');
    expect(names()).toHaveLength(6);
  });
});
