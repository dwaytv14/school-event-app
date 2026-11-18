import { describe, expect, it } from 'vitest';
import { clock12, dateTimeLabel, timeOfDay } from './time-format';

describe('time format', () => {
  it('turns stored 24-hour event times into AM/PM', () => {
    expect(clock12('08:00')).toBe('8:00 AM');
    expect(clock12('12:00')).toBe('12:00 PM');
    expect(clock12('00:15')).toBe('12:15 AM');
    expect(clock12('16:30')).toBe('4:30 PM');
    expect(clock12('20:00')).toBe('8:00 PM');
    expect(clock12('')).toBe('');
  });

  it('shows real moments in Philippine time with AM/PM', () => {
    expect(timeOfDay('2026-11-17T23:44:00Z')).toBe('7:44 AM'); // 07:44 on the 18th in Manila
    expect(timeOfDay('2026-11-18T09:19:00Z')).toBe('5:19 PM');
    expect(timeOfDay(null)).toBe('—');
    expect(dateTimeLabel('2026-11-18T09:19:00Z')).toContain('5:19 PM');
  });
});
