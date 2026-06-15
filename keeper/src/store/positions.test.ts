import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => files.has(path)),
  readFileSync: vi.fn((path: string) => {
    const data = files.get(path);
    if (data === undefined) throw new Error(`ENOENT: ${path}`);
    return data;
  }),
  writeFileSync: vi.fn((path: string, data: string) => {
    files.set(path, data);
  }),
  mkdirSync: vi.fn(),
}));

import { getPosition, setPosition, deletePosition, listPositions } from './positions.js';

beforeEach(() => {
  files.clear();
});

describe('position store', () => {
  it('returns undefined for an unknown position when no store file exists', () => {
    expect(getPosition('0xabc')).toBeUndefined();
  });

  it('returns an empty object from listPositions when no store file exists', () => {
    expect(listPositions()).toEqual({});
  });

  it('round-trips a record through set/get', () => {
    setPosition('0xabc', { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(getPosition('0xabc')).toEqual({ owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('persists valid JSON that round-trips via listPositions', () => {
    setPosition('0xabc', { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    setPosition('0xdef', { owner: '0xother', updatedAt: '2026-01-02T00:00:00.000Z' });
    expect(listPositions()).toEqual({
      '0xabc': { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' },
      '0xdef': { owner: '0xother', updatedAt: '2026-01-02T00:00:00.000Z' },
    });
  });

  it('overwrites an existing record for the same id', () => {
    setPosition('0xabc', { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    setPosition('0xabc', { owner: '0xowner', updatedAt: '2026-01-02T00:00:00.000Z' });
    expect(getPosition('0xabc')).toEqual({ owner: '0xowner', updatedAt: '2026-01-02T00:00:00.000Z' });
  });

  it('removes a record on delete', () => {
    setPosition('0xabc', { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    deletePosition('0xabc');
    expect(getPosition('0xabc')).toBeUndefined();
    expect(listPositions()).toEqual({});
  });

  it('deleting an unknown id is a no-op', () => {
    setPosition('0xabc', { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(() => deletePosition('0xnope')).not.toThrow();
    expect(listPositions()).toEqual({
      '0xabc': { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('deleting one record leaves the others intact', () => {
    setPosition('0xabc', { owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    setPosition('0xdef', { owner: '0xother', updatedAt: '2026-01-02T00:00:00.000Z' });
    deletePosition('0xabc');
    expect(listPositions()).toEqual({
      '0xdef': { owner: '0xother', updatedAt: '2026-01-02T00:00:00.000Z' },
    });
  });
});
