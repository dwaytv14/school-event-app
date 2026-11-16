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
  counted: 1, attended: 0, present: 0, late: 0, absent: 1, percentage: 0,
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
