import { describe, it, expect } from 'vitest';
import { todayAR } from '../src/utils/dateAr.js';

describe('todayAR', () => {
  it('usa la fecha de Buenos Aires, no UTC', () => {
    expect(todayAR(new Date('2026-06-11T01:00:00Z'))).toBe('2026-06-10');
    expect(todayAR(new Date('2026-06-11T03:00:00Z'))).toBe('2026-06-11');
  });
  it('formato YYYY-MM-DD', () => {
    expect(todayAR()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
