import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  isIsoDate,
  localDate,
  localMinuteOfDay,
  weekdayOf,
  zonedDateTime,
} from '../src/time';
import {
  canTransition,
  nextVisitStatus,
  VISIT_STATUSES,
  VISIT_TRANSITIONS,
} from '../src/visit-status';

describe('診所時區', () => {
  it('台北 09:00 是 UTC 01:00', () => {
    expect(zonedDateTime('2026-11-19', 9 * 60).toISOString()).toBe('2026-11-19T01:00:00.000Z');
  });

  it('UTC 深夜已是台北隔天', () => {
    const d = new Date('2026-11-19T17:30:00Z');
    expect(localDate(d)).toBe('2026-11-20');
    expect(localMinuteOfDay(d)).toBe(90);
  });

  it('有日光節約的時區也能正確換算', () => {
    // 紐約 2026-03-08 02:00 開始日光節約，當天 09:00 為 UTC-4
    expect(zonedDateTime('2026-03-08', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-03-08T13:00:00.000Z',
    );
  });

  it('日期運算', () => {
    expect(weekdayOf('2026-11-19')).toBe(4);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDays('2026-11-19', '2026-12-19')).toBe(30);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
  });
});

describe('就診狀態機', () => {
  it('終止狀態不能再轉換', () => {
    expect(VISIT_TRANSITIONS.COMPLETED).toEqual([]);
    expect(VISIT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('不能跳過看診直接完成', () => {
    expect(canTransition('CHECKED_IN', 'COMPLETED')).toBe(false);
    expect(canTransition('WAITING', 'PENDING_CHECKOUT')).toBe(false);
  });

  it('從報到一路按「下一步」會走到完成', () => {
    const path = ['CHECKED_IN'];
    let s = nextVisitStatus('CHECKED_IN');
    while (s) {
      path.push(s);
      s = nextVisitStatus(s);
    }
    expect(path).toEqual([
      'CHECKED_IN',
      'WAITING',
      'IN_CONSULTATION',
      'IN_TREATMENT',
      'PENDING_CHECKOUT',
      'COMPLETED',
    ]);
  });

  it('所有轉換目標都是合法狀態，且不會轉換到自己', () => {
    for (const from of VISIT_STATUSES) {
      for (const to of VISIT_TRANSITIONS[from]) {
        expect(VISIT_STATUSES).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });
});
