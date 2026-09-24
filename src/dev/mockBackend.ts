/**
 * DEV ONLY — an in-memory fake of Drive/Sheets built from the real sheet fixtures,
 * so the UI can be exercised in a browser without Google credentials.
 * Never included in production builds (guarded by import.meta.env.DEV).
 */
import type { Backend } from '../sync/backend';
import type { SheetCell } from '../core/time';
import fallCut from '../../fixtures/fall-cut-2026.json';
import week01 from '../../fixtures/fb-week-01.json';
import weeks24 from '../../fixtures/fb-weeks-2-4.json';

interface MockTab { title: string; sheetId: number; hidden?: boolean; rows: SheetCell[][] }
interface MockFile { id: string; name: string; modifiedTime: string; owner: string; shortcut?: string; tabs: MockTab[] }

const FOLDER = 'mock-folder';
const files = new Map<string, MockFile>();
const add = (j: any, modifiedTime: string, owner: string, shortcut?: string) =>
  files.set(j.id, { id: j.id, name: j.title, modifiedTime, owner, shortcut, tabs: [{ title: j.tab, sheetId: 0, rows: structuredClone(j.rows) }] });
add(fallCut, '2026-09-24T14:25:57.070Z', 'you@example.com');
add(week01, '2026-08-27T21:53:07.194Z', 'coach@example.com', 'sc-1');
add(weeks24, '2026-09-24T01:17:02.233Z', 'coach@example.com', 'sc-2');

const cache = new Map<string, string>();
let seq = 1;
const bump = (f: MockFile) => { f.modifiedTime = new Date().toISOString(); };

function colIdx(letters: string) { let c = 0; for (const ch of letters) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; }
function parseRange(range: string) {
  const m = decodeURIComponent(range).match(/^'?(.*?)'?!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
  if (!m) throw new Error('bad range ' + range);
  return { tab: m[1].replace(/''/g, "'"), c0: colIdx(m[2]), r0: m[3] ? Number(m[3]) - 1 : 0, c1: m[4] ? colIdx(m[4]) : colIdx(m[2]), r1: m[5] ? Number(m[5]) - 1 : 100000 };
}
function toApi(c: SheetCell) {
  if (!c || (c.f == null && c.n == null && c.s == null)) return {};
  const v: any = { formattedValue: c.f ?? String(c.n ?? c.s ?? '') };
  v.effectiveValue = c.n != null ? { numberValue: c.n } : { stringValue: c.s ?? c.f };
  if (c.t && c.t !== 'TEXT' && !c.t.startsWith('DATE_TEXT')) v.effectiveFormat = { numberFormat: { type: c.t } };
  v.userEnteredValue = c.fx ? { formulaValue: '=…' } : { stringValue: c.f };
  return v;
}
function writeCell(value: string | number, raw: boolean): SheetCell {
  if (typeof value === 'number') return { f: String(value), n: value, t: 'NUMBER' };
  const s = String(value);
  if (!raw && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [m, d, y] = s.split('/').map(Number);
    const serial = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
    return { f: `${m}/${d}`, n: serial, t: 'DATE' };
  }
  if (!raw && /^-?\d+(\.\d+)?$/.test(s)) return { f: s, n: Number(s), t: 'NUMBER' };
  return s ? { f: s, s, t: 'TEXT' } : {};
}

export function mockBackend(): Backend {
  return {
    kind: 'mock',
    authStatus: async () => ({ connected: true, email: 'demo (fixtures)' }),
    authConnect: async () => ({ email: 'demo (fixtures)' }),
    authDisconnect: async () => {},
    cacheGet: async k => cache.get(k) ?? null,
    cachePut: async (k, v) => { cache.set(k, v); },
    cacheClear: async () => cache.clear(),
    deviceName: async () => 'Browser preview',
    appVersion: async () => '0.1.0-dev',
    checkUpdate: async () => ({ available: false }),
    request: (async (method: string, url: string, body: any): Promise<any> => {
      await new Promise(r => setTimeout(r, 60));
      const u = new URL(url);
      const p = u.pathname;
      if (p === '/drive/v3/files' && method === 'GET') {
        const q = u.searchParams.get('q') ?? '';
        if (q.includes("mimeType='application/vnd.google-apps.folder'")) return { files: [{ id: FOLDER, name: 'Health Tracker ', modifiedTime: '2026-09-24T20:31:31Z' }] };
        return {
          files: [...files.values()].map(f => f.shortcut
            ? { id: f.shortcut, name: f.name, mimeType: 'application/vnd.google-apps.shortcut', modifiedTime: f.modifiedTime, shortcutDetails: { targetId: f.id, targetMimeType: 'application/vnd.google-apps.spreadsheet' } }
            : { id: f.id, name: f.name, mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: f.modifiedTime, owners: [{ emailAddress: f.owner }], capabilities: { canEdit: true } }),
        };
      }
      if (p === '/drive/v3/files' && method === 'POST') {
        const id = `mock-${seq++}`;
        files.set(id, { id, name: body.name, modifiedTime: new Date().toISOString(), owner: 'you@example.com', tabs: [{ title: 'Sheet1', sheetId: 0, rows: [] }] });
        return { id };
      }
      let m = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (m) { const f = files.get(m[1])!; return { id: f.id, name: f.name, modifiedTime: f.modifiedTime, owners: [{ emailAddress: f.owner }], capabilities: { canEdit: f.owner.startsWith('you') } }; }
      m = p.match(/^\/v4\/spreadsheets\/([^/:]+)$/);
      if (m && method === 'GET') {
        const f = files.get(m[1])!;
        return { sheets: f.tabs.map(t => ({ properties: { sheetId: t.sheetId, title: t.title, hidden: !!t.hidden }, data: [{ rowData: t.rows.map(r => ({ values: r.map(toApi) })) }] })) };
      }
      m = p.match(/^\/v4\/spreadsheets\/([^/:]+):batchUpdate$/);
      if (m) {
        const f = files.get(m[1])!;
        for (const r of body.requests) {
          if (r.updateSheetProperties) { const t = f.tabs.find(t => t.sheetId === r.updateSheetProperties.properties.sheetId)!; if (r.updateSheetProperties.properties.title) t.title = r.updateSheetProperties.properties.title; }
          if (r.addSheet) f.tabs.push({ title: r.addSheet.properties.title, sheetId: f.tabs.length, hidden: r.addSheet.properties.hidden, rows: [] });
        }
        bump(f);
        return {};
      }
      m = p.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+?)(:append)?$/);
      if (m) {
        const f = files.get(m[1])!;
        const rg = parseRange(m[2]);
        const tab = f.tabs.find(t => t.title === rg.tab)!;
        const raw = u.searchParams.get('valueInputOption') === 'RAW';
        if (method === 'GET') {
          return { values: tab.rows.slice(rg.r0, rg.r1 + 1).map(r => r.slice(rg.c0, rg.c1 + 1).map(c => c?.f ?? '')) };
        }
        let r0 = rg.r0;
        if (m[3]) { r0 = tab.rows.length; while (r0 > 0 && !(tab.rows[r0 - 1] ?? []).some(c => c?.f)) r0--; }
        (body.values as any[][]).forEach((vals, i) => {
          while (tab.rows.length <= r0 + i) tab.rows.push([]);
          vals.forEach((v, j) => { tab.rows[r0 + i][rg.c0 + j] = writeCell(v, raw); });
        });
        bump(f);
        return {};
      }
      throw new Error(`mock: unhandled ${method} ${url}`);
    }) as Backend['request'],
  };
}
