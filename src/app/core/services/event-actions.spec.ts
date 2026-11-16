import { describe, expect, it } from 'vitest';
import { SchoolEvent } from '../models/school-event.models';
import { eventActions } from './event-actions';

const base: SchoolEvent = {
  id: 'e1', name: 'Foundation Day', date: '2026-12-01', startTime: '08:00', endTime: '10:00',
  venue: 'Gym', description: '', graceMinutes: 15, sections: [], seats: [], createdBy: 'org1',
};
const on = (actions: object) => Object.entries(actions).filter(([, v]) => v).map(([k]) => k).sort();

describe('eventActions', () => {
  it('gives students nothing', () => {
    expect(on(eventActions(base, 'student', 'org1', false))).toEqual([]);
  });
  it('rejected events only allow edit and delete', () => {
    const e = { ...base, approvalStatus: 'rejected' as const };
    expect(on(eventActions(e, 'super_admin', 'a', false))).toEqual(['delete', 'edit']);
    expect(on(eventActions(e, 'organizer', 'org1', false))).toEqual(['delete', 'edit']);
    expect(on(eventActions(e, 'organizer', 'other', false))).toEqual([]);
  });
  it('pending events can be approved by the admin only', () => {
    const e = { ...base, approvalStatus: 'pending' as const };
    expect(on(eventActions(e, 'super_admin', 'a', false))).toEqual(['approve', 'delete', 'edit', 'reject']);
    expect(on(eventActions(e, 'organizer', 'org1', false))).toEqual(['delete', 'edit']);
  });
  it('approved events allow scanning and the admin extras', () => {
    const e = { ...base, approvalStatus: 'approved' as const };
    expect(on(eventActions(e, 'organizer', 'org1', false))).toEqual(['monitor', 'report', 'scan', 'seating']);
    expect(on(eventActions(e, 'super_admin', 'a', false))).toEqual(
      ['cancel', 'delete', 'edit', 'monitor', 'move', 'report', 'scan', 'seating']);
    expect(eventActions(e, 'super_admin', 'a', true).delete).toBe(false);
  });
  it('cancelled events can only be reinstated', () => {
    const e = { ...base, cancelled: true };
    expect(on(eventActions(e, 'super_admin', 'a', true))).toEqual(['reinstate']);
    expect(on(eventActions(e, 'organizer', 'org1', false))).toEqual([]);
  });
});
