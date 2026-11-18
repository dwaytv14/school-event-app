import { describe, expect, it } from 'vitest';
import { SchoolEvent } from '../models/school-event.models';
import { eventActions } from './event-actions';
import { addDaysToKey, schoolDateKey } from './time-format';

const dayKey = (offset: number) => addDaysToKey(schoolDateKey(), offset);
const base: SchoolEvent = {
  id: 'e1', name: 'Foundation Day', date: dayKey(0), startTime: '08:00', endTime: '10:00',
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
    expect(on(eventActions(e, 'organizer', 'org1', false))).toEqual(['monitor', 'report', 'scan']);
    expect(on(eventActions(e, 'super_admin', 'a', false))).toEqual(
      ['cancel', 'delete', 'edit', 'finish', 'monitor', 'report', 'scan']);
    expect(eventActions(e, 'super_admin', 'a', true).delete).toBe(false);
  });
  it('cancelled events can only be reinstated', () => {
    const e = { ...base, cancelled: true };
    expect(on(eventActions(e, 'super_admin', 'a', true))).toEqual(['reinstate']);
    expect(on(eventActions(e, 'organizer', 'org1', false))).toEqual([]);
  });
});

describe('eventActions by date', () => {
  it('does not allow scanning before the event day', () => {
    const upcoming = { ...base, date: dayKey(1) };
    const actions = eventActions(upcoming, 'organizer', 'org1', false);
    expect(actions.scan).toBe(false);
    // Live attendance opens only once the event has started.
    expect(actions.monitor).toBe(false);
    expect(actions.report).toBe(false);
    const today = eventActions({ ...base, date: dayKey(0) }, 'organizer', 'org1', false);
    expect(today.monitor).toBe(true);
    expect(today.report).toBe(true);
  });
  it('closes scanning and the live monitor after the event day', () => {
    const past = { ...base, date: dayKey(-1) };
    const actions = eventActions(past, 'organizer', 'org1', false);
    expect(actions.scan).toBe(false);
    expect(actions.monitor).toBe(false);
    expect(actions.report).toBe(true);
  });
});
