import { describe, expect, it } from 'vitest';
import { KNOWN_HUBS, KNOWN_NATIVE_HUBS, knownHubsFor, knownNativeHubsFor } from '../src/index.ts';

describe('known hub lists', () => {
  it('keeps USDC and native-MON hubs separate', () => {
    expect(knownHubsFor(143)).toContain('0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0');
    expect(knownNativeHubsFor(143)).not.toContain('0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0');
    expect(knownNativeHubsFor(999)).toEqual([]);
  });

  it('stores addresses lowercase so lookups match', () => {
    for (const list of [KNOWN_HUBS, KNOWN_NATIVE_HUBS]) for (const hubs of Object.values(list)) for (const a of Object.keys(hubs)) expect(a).toBe(a.toLowerCase());
  });
});
