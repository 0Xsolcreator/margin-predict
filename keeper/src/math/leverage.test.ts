import { describe, it, expect } from 'vitest';
import {
  getLeverageRange,
  assertValidLeverageBps,
  computeBorrowAmount,
  computeSoftLiqDebt,
} from './leverage.js';

describe('getLeverageRange', () => {
  it('mirrors the on-chain bounds', () => {
    expect(getLeverageRange()).toEqual({
      minBps: 11_000,
      maxBps: 14_000,
      min: 1.1,
      max: 1.4,
    });
  });
});

describe('assertValidLeverageBps', () => {
  it('returns the value when within bounds', () => {
    expect(assertValidLeverageBps(11_000)).toBe(11_000);
    expect(assertValidLeverageBps(14_000)).toBe(14_000);
    expect(assertValidLeverageBps(12_500)).toBe(12_500);
  });

  it('rejects values below the minimum', () => {
    expect(() => assertValidLeverageBps(10_999)).toThrow(
      'leverageBps must be in [11000, 14000] (1.10x – 1.40x), got 10999',
    );
  });

  it('rejects values above the maximum', () => {
    expect(() => assertValidLeverageBps(14_001)).toThrow(
      'leverageBps must be in [11000, 14000] (1.10x – 1.40x), got 14001',
    );
  });

  it('rejects non-integers', () => {
    expect(() => assertValidLeverageBps(12_000.5)).toThrow(
      'leverageBps must be an integer (got 12000.5)',
    );
  });

  it('rejects non-numbers', () => {
    expect(() => assertValidLeverageBps('12000')).toThrow(
      'leverageBps must be an integer (got "12000")',
    );
    expect(() => assertValidLeverageBps(undefined)).toThrow(
      'leverageBps must be an integer (got undefined)',
    );
    expect(() => assertValidLeverageBps(null)).toThrow(
      'leverageBps must be an integer (got null)',
    );
  });
});

describe('computeBorrowAmount', () => {
  it('computes B = C * (L - 1)', () => {
    expect(computeBorrowAmount(100, 12_000)).toBeCloseTo(20, 10); // 1.2x -> 20% borrow
    expect(computeBorrowAmount(100, 14_000)).toBeCloseTo(40, 10); // 1.4x -> 40% borrow
    expect(computeBorrowAmount(100, 11_000)).toBeCloseTo(10, 10); // 1.1x -> 10% borrow
  });

  it('returns 0 at 1.0x leverage', () => {
    expect(computeBorrowAmount(100, 10_000)).toBe(0);
  });

  it('returns 0 when collateral value is 0', () => {
    expect(computeBorrowAmount(0, 12_000)).toBe(0);
  });
});

describe('computeSoftLiqDebt', () => {
  it('splits 25% off the recorded debt, floor-divided', () => {
    expect(computeSoftLiqDebt(10_000n)).toEqual({ repayAmount: 2_500n, newDebt: 7_500n });
    expect(computeSoftLiqDebt(1_000_000n)).toEqual({ repayAmount: 250_000n, newDebt: 750_000n });
  });

  it('matches on-chain floor-division for non-exact splits', () => {
    // 3 * 7500 / 10000 = 2.25 -> floors to 2; repay = 3 - 2 = 1
    expect(computeSoftLiqDebt(3n)).toEqual({ repayAmount: 1n, newDebt: 2n });
  });

  it('handles zero debt', () => {
    expect(computeSoftLiqDebt(0n)).toEqual({ repayAmount: 0n, newDebt: 0n });
  });

  it('handles a debt of 1 (entire amount repaid)', () => {
    // 1 * 7500 / 10000 = 0.75 -> floors to 0; repay = 1
    expect(computeSoftLiqDebt(1n)).toEqual({ repayAmount: 1n, newDebt: 0n });
  });
});
