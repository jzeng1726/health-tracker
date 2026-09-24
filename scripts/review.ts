import { readFileSync } from 'node:fs';
import { buildDataset } from '../src/core/ingest';
import { defaultConfig, applySeed } from '../src/core/config';
import { SEED_CONFIG } from '../src/core/seedConfig';
const fx = (f: string) => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));
const asFile = (j: any, m: string) => ({ id: j.id, name: j.title, modifiedTime: m, tabs: [{ title: j.tab, rows: j.rows }] });
const ds = buildDataset([asFile(fx('fall-cut-2026.json'), '2026-09-24T14:25:57Z'), asFile(fx('fb-week-01.json'), '2026-08-27T21:53:07Z'), asFile(fx('fb-weeks-2-4.json'), '2026-09-24T01:17:02Z')], applySeed(defaultConfig(), {}, SEED_CONFIG).config);
for (const r of ds.review) console.log(`[${r.kind}] ${r.title} — ${r.detail}`);
console.log('sets', ds.sets.length, 'endurance', ds.endurance.length, 'bw', ds.bodyweight.length, 'exercises', Object.keys(ds.exercises).length);
