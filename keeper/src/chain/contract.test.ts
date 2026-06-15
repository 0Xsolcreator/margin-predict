import { describe, it, expect } from 'vitest';
import { decodeU64, decodeAddress } from './contract.js';

describe('decodeU64', () => {
  it('decodes a little-endian BCS u64', () => {
    expect(decodeU64(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]))).toBe(1n);
    expect(decodeU64(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0n);
    expect(decodeU64(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]))).toBe(2n ** 56n);
    expect(decodeU64(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]))).toBe(2n ** 64n - 1n);
  });

  it('decodes a realistic raw DBUSDC amount (4_000_000, 6 decimals)', () => {
    // 4_000_000 = 0x3D0900, little-endian bytes:
    expect(decodeU64(new Uint8Array([0x00, 0x09, 0x3d, 0, 0, 0, 0, 0]))).toBe(4_000_000n);
  });

  it('decodes a realistic raw SUI amount (10_000_000_000, 9 decimals)', () => {
    // 10_000_000_000 = 0x2_540B_E400, little-endian bytes:
    expect(decodeU64(new Uint8Array([0x00, 0xe4, 0x0b, 0x54, 0x02, 0, 0, 0]))).toBe(10_000_000_000n);
  });
});

describe('decodeAddress', () => {
  it('hex-encodes raw bytes with a 0x prefix', () => {
    expect(decodeAddress(new Uint8Array(32).fill(0))).toBe('0x' + '00'.repeat(32));
  });

  it('preserves byte order (no endianness swap for addresses)', () => {
    const bytes = new Uint8Array(32);
    bytes[0] = 0xde;
    bytes[1] = 0xad;
    bytes[31] = 0xff;
    expect(decodeAddress(bytes)).toBe('0x' + 'dead' + '00'.repeat(29) + 'ff');
  });
});
