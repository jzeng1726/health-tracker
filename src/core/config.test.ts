import { describe, it, expect } from 'vitest';
import { defaultConfig, configFromRows, configToRows, mergeConfigs, applySeed } from './config';
import { SEED_CONFIG } from './seedConfig';

describe('_config sync between two computers', () => {
  it('round-trips through sheet rows', () => {
    const c = defaultConfig();
    c.goals.goalWeightLb = 155;
    c.merges = { 'laying leg curl': 'lying leg curl' };
    const rows = configToRows(c, {}, 'MacBook').map(([key, value, updatedAt, device]) => ({ key, value, updatedAt, device }));
    const back = configFromRows(rows).config;
    expect(back.goals.goalWeightLb).toBe(155);
    expect(back.merges['laying leg curl']).toBe('lying leg curl');
  });

  it('newest edit wins per key (Mac edits goals, PC edits merges — both survive)', () => {
    const remote = defaultConfig();
    remote.goals.goalWeightLb = 155;
    remote.merges = { a: 'b' };
    const remoteStamps = { goals: '2026-09-24T10:00:00Z', merges: '2026-09-24T12:00:00Z' };
    const local = structuredClone(remote);
    local.goals.goalWeightLb = 152; // edited on this computer later
    local.merges = {};              // stale
    const localStamps = { goals: '2026-09-24T13:00:00Z', merges: '2026-09-24T09:00:00Z' };
    const m = mergeConfigs(local, localStamps, remote, remoteStamps);
    expect(m.config.goals.goalWeightLb).toBe(152);
    expect(m.config.merges).toEqual({ a: 'b' });
    expect(m.changedKeys).toEqual(['goals']);
  });

  it('seed only fills keys the shared _config does not have yet', () => {
    const remote = defaultConfig();
    remote.goals.goalWeightLb = 150;
    const { config, seeded } = applySeed(remote, { goals: '2026-09-24T00:00:00Z' }, SEED_CONFIG);
    expect(config.goals.goalWeightLb).toBe(150); // not overwritten
    expect(seeded).toContain('merges');
    expect(config.merges['c']).toBe('kneeling band supported triceps extension');
  });

  it('a corrupted cell falls back to defaults instead of crashing', () => {
    const { config } = configFromRows([{ key: 'goals', value: '{not json', updatedAt: 'x', device: 'y' }]);
    expect(config.goals).toEqual({});
  });
});
