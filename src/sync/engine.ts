/**
 * Sync engine: Google Sheets is the source of truth, the local SQLite cache
 * (via Backend.cache*) makes launch instant and keeps everything viewable offline.
 *
 * Refresh triggers: launch, window focus, every N minutes, manual button, after Quick Entry.
 * Change detection: Drive modifiedTime per spreadsheet; unchanged files are never re-downloaded.
 */
import { ApiError, getBackend, type Backend, type UpdateInfo } from './backend';
import {
  findFolders, listFolderSheets, fetchSheetFile, valuesGet, valuesUpdate, valuesAppend, createConfigSheet, createTrainingLog,
  quoteTab, type DriveItem,
} from './google';
import type { SheetFile, Dataset } from '../core/model';
import {
  type AppConfig, type ConfigRow, defaultConfig, configFromRows, configToRows, mergeConfigs, applySeed, CONFIG_KEYS,
} from '../core/config';
import { SEED_CONFIG } from '../core/seedConfig';
import { buildDataset } from '../core/ingest';
import { classifyTab, headerMappingForRow, cellNumber } from '../core/classify';
import { cellDate, colName } from '../core/grid';

export type AuthState = 'unknown' | 'connected' | 'disconnected' | 'expired';
export interface SyncState {
  ready: boolean;
  syncing: boolean;
  auth: AuthState;
  email?: string;
  lastSynced: string | null;
  error: { code: string; message: string } | null;
  folder: { id: string; name: string } | null;
  folderChoices: { id: string; name: string; modifiedTime: string }[] | null;
  files: SheetFile[];
  configFileId: string | null;
  config: AppConfig;
  stamps: Record<string, string>;
  dataset: Dataset;
  device: string;
  version: string;
  update: UpdateInfo | null;
  backendKind: 'tauri' | 'mock';
}

const EMPTY_DATASET: Dataset = { bodyweight: [], sets: [], endurance: [], exercises: {}, review: [], files: [], autoMappings: {} };

let state: SyncState = {
  ready: false, syncing: false, auth: 'unknown', lastSynced: null, error: null, folder: null, folderChoices: null,
  files: [], configFileId: null, config: defaultConfig(), stamps: {}, dataset: EMPTY_DATASET, device: 'this computer',
  version: '', update: null, backendKind: 'tauri',
};
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
export const getState = () => state;
export const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

let backend: Backend;
let timer: ReturnType<typeof setInterval> | null = null;
let pendingConfigPush = false;

const K = { meta: 'meta', config: 'config.local', index: 'files.index', file: (id: string) => `file.${id}` };

async function cacheJSON<T>(key: string): Promise<T | null> {
  try { const v = await backend.cacheGet(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
async function putJSON(key: string, v: unknown) { try { await backend.cachePut(key, JSON.stringify(v)); } catch { /* cache is best-effort */ } }

function rebuild(files = state.files, config = state.config) {
  try {
    set({ dataset: buildDataset(files, config) });
  } catch (e) {
    set({ error: { code: 'PARSE', message: `Could not process sheet data: ${(e as Error).message}` } });
  }
}

export async function init() {
  backend = await getBackend();
  const [meta, local, index, device, version] = await Promise.all([
    cacheJSON<{ lastSynced: string | null; folder: SyncState['folder']; configFileId: string | null }>(K.meta),
    cacheJSON<{ config: AppConfig; stamps: Record<string, string>; pending?: boolean }>(K.config),
    cacheJSON<string[]>(K.index),
    backend.deviceName().catch(() => 'this computer'),
    backend.appVersion().catch(() => ''),
  ]);
  const files = (await Promise.all((index ?? []).map(id => cacheJSON<SheetFile>(K.file(id))))).filter((f): f is SheetFile => !!f);
  const config = local?.config ? { ...defaultConfig(), ...local.config } : defaultConfig();
  pendingConfigPush = !!local?.pending;
  set({
    ready: true, backendKind: backend.kind, device, version, files, config, stamps: local?.stamps ?? {},
    lastSynced: meta?.lastSynced ?? null, folder: meta?.folder ?? null, configFileId: meta?.configFileId ?? null,
  });
  rebuild(files, config);

  try {
    const st = await backend.authStatus();
    set({ auth: st.connected ? 'connected' : 'disconnected', email: st.email });
    if (st.connected) await sync();
  } catch (e) {
    handleError(e);
  }
  startTimers();
  backend.checkUpdate().then(u => set({ update: u })).catch(() => {});
}

function startTimers() {
  if (timer) clearInterval(timer);
  const mins = Math.max(1, state.config.settings.refreshMinutes || 5);
  timer = setInterval(() => { if (state.auth === 'connected') sync(); }, mins * 60_000);
}

let focusHooked = false;
export function hookFocus() {
  if (focusHooked || typeof window === 'undefined') return;
  focusHooked = true;
  const onFocus = () => {
    const last = state.lastSynced ? Date.parse(state.lastSynced) : 0;
    if (state.auth === 'connected' && Date.now() - last > 20_000) sync();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onFocus(); });
}

function handleError(e: unknown) {
  const err = e instanceof ApiError ? e : new ApiError('UNKNOWN', (e as Error)?.message ?? String(e));
  if (err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_REQUIRED') {
    set({ auth: err.code === 'AUTH_EXPIRED' ? 'expired' : 'disconnected', error: null });
  } else if (err.code === 'OFFLINE') {
    set({ error: { code: 'OFFLINE', message: "Can't reach Google — showing your cached data." } });
  } else if (err.code === 'CONFIG') {
    set({ error: { code: 'CONFIG', message: err.message } });
  } else {
    set({ error: { code: err.code, message: err.message } });
  }
}

let inflight: Promise<void> | null = null;
export function sync(): Promise<void> {
  if (inflight) return inflight;
  inflight = doSync().finally(() => { inflight = null; });
  return inflight;
}

async function resolveFolder(): Promise<SyncState['folder']> {
  if (state.folder) return state.folder;
  const found = await findFolders(backend);
  const exact = found.filter(f => f.name.trim().toLowerCase() === 'health tracker');
  const pool = exact.length ? exact : found;
  if (!pool.length) throw new ApiError('CONFIG', 'No Google Drive folder named "Health Tracker" was found in your Google Drive.');
  if (pool.length > 1) { set({ folderChoices: pool }); throw new ApiError('CONFIG', 'More than one "Health Tracker" folder — pick one.'); }
  return { id: pool[0].id, name: pool[0].name };
}

export async function chooseFolder(id: string, name: string) {
  set({ folder: { id, name }, folderChoices: null, files: [] });
  await putJSON(K.meta, { lastSynced: state.lastSynced, folder: state.folder, configFileId: null });
  await sync();
}

async function doSync() {
  set({ syncing: true });
  try {
    const folder = await resolveFolder();
    set({ folder });
    const items = await listFolderSheets(backend, folder!.id);
    const cfgItem = items.find(i => i.name.trim().toLowerCase() === '_config');
    const dataItems = items.filter(i => i !== cfgItem);

    const byId = new Map(state.files.map(f => [f.id, f]));
    const files: SheetFile[] = [];
    for (const item of dataItems) {
      const cached = byId.get(item.id);
      if (cached && cached.modifiedTime === item.modifiedTime && cached.name === item.name) { files.push(cached); continue; }
      const fresh = await fetchSheetFile(backend, item);
      files.push(fresh);
      await putJSON(K.file(item.id), fresh);
    }
    await putJSON(K.index, files.map(f => f.id));

    const { config, stamps, configFileId } = await syncConfig(cfgItem, folder!.id);
    set({ files, config, stamps, configFileId, lastSynced: new Date().toISOString(), error: null, auth: 'connected' });
    await putJSON(K.meta, { lastSynced: state.lastSynced, folder: state.folder, configFileId });
    rebuild(files, config);
    // share automatic muscle mappings with the other computer (only when they changed)
    const auto = state.dataset.autoMappings;
    if (JSON.stringify(auto) !== JSON.stringify(config.autoMappings)) await setConfigKey('autoMappings', auto as any);
    startTimers();
  } catch (e) {
    handleError(e);
  } finally {
    set({ syncing: false });
  }
}

async function readRemoteConfig(id: string): Promise<ConfigRow[]> {
  const rows = await valuesGet(backend, id, `${quoteTab('config')}!A2:D200`);
  return rows.filter(r => r[0]).map(r => ({ key: r[0], value: r[1] ?? '', updatedAt: r[2] ?? '', device: r[3] ?? '' }));
}

async function writeRemoteConfig(id: string, config: AppConfig, stamps: Record<string, string>) {
  const rows = configToRows(config, stamps, state.device);
  await valuesUpdate(backend, id, `${quoteTab('config')}!A1:D${rows.length + 1}`, [['key', 'value', 'updatedAt', 'device'], ...rows]);
}

async function syncConfig(cfgItem: DriveItem | undefined, folderId: string) {
  let configFileId = cfgItem?.id ?? null;
  if (!configFileId) configFileId = await createConfigSheet(backend, folderId);
  const remoteRows = await readRemoteConfig(configFileId);
  const remote = configFromRows(remoteRows);
  const merged = mergeConfigs(state.config, pendingConfigPush ? state.stamps : {}, remote.config, remote.stamps);
  const seeded = applySeed(merged.config, merged.stamps, SEED_CONFIG);
  const now = new Date().toISOString();
  const stamps = { ...merged.stamps };
  for (const k of seeded.seeded) stamps[k] = now;
  if (merged.changedKeys.length || seeded.seeded.length || remoteRows.length < CONFIG_KEYS.length) {
    for (const k of CONFIG_KEYS) if (!stamps[k]) stamps[k] = now;
    await writeRemoteConfig(configFileId, seeded.config, stamps);
  }
  pendingConfigPush = false;
  await putJSON(K.config, { config: seeded.config, stamps, pending: false });
  return { config: seeded.config, stamps, configFileId };
}

/** Change one synced setting. Saved locally at once, pushed to _config right away (or on next sync if offline). */
export async function setConfigKey<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
  const config = { ...state.config, [key]: value };
  const stamps = { ...state.stamps, [key]: new Date().toISOString() };
  set({ config, stamps });
  rebuild(state.files, config);
  if (key === 'settings') startTimers();
  pendingConfigPush = true;
  await putJSON(K.config, { config, stamps, pending: true });
  if (state.configFileId && state.auth === 'connected') {
    try {
      await writeRemoteConfig(state.configFileId, config, stamps);
      pendingConfigPush = false;
      await putJSON(K.config, { config, stamps, pending: false });
    } catch (e) {
      handleError(e);
    }
  }
}

export async function connect() {
  try {
    const r = await backend.authConnect();
    set({ auth: 'connected', email: r.email, error: null });
    await sync();
  } catch (e) {
    handleError(e);
    throw e;
  }
}

export async function disconnect() {
  await backend.authDisconnect();
  set({ auth: 'disconnected', email: undefined });
}

export async function clearCache() {
  await backend.cacheClear();
  set({ files: [], lastSynced: null, dataset: EMPTY_DATASET, folder: null, configFileId: null });
  pendingConfigPush = false;
  if (state.auth === 'connected') await sync();
}

// ------------------------------------------------------------------- Quick Entry

const mdY = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;

export function bodyweightTargets() {
  return state.files.filter(f => f.tabs.some(t => classifyTab(t, f.name, state.config.columnMappings[`${f.id}:${t.title}`]).kind === 'bodyweight'))
    .map(f => ({ id: f.id, name: f.name, canEdit: f.canEdit !== false, latest: state.dataset.bodyweight.filter(b => b.fileId === f.id).at(-1)?.date ?? '' }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

export function workoutTargets() {
  return state.files.filter(f => f.tabs.some(t => classifyTab(t, f.name, state.config.columnMappings[`${f.id}:${t.title}`]).kind === 'workout-log'))
    .map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime }))
    .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
}

export type BodyweightWriteResult = { ok: true; where: string } | { ok: false; conflict: number; where: string };

export async function logBodyweight(dateISO: string, weight: number, fileId?: string, overwrite = false): Promise<BodyweightWriteResult> {
  const target = fileId ?? state.config.settings.quickEntryBodyweightFile ?? bodyweightTargets()[0]?.id;
  const file = state.files.find(f => f.id === target);
  if (!file) throw new ApiError('CONFIG', 'No bodyweight sheet found in the folder yet.');
  const tab = file.tabs.find(t => classifyTab(t, file.name, state.config.columnMappings[`${file.id}:${t.title}`]).kind === 'bodyweight')!;
  const cls = classifyTab(tab, file.name, state.config.columnMappings[`${file.id}:${tab.title}`]);
  let cols = cls.mapping!.columns;
  const year = Number(dateISO.slice(0, 4));
  let lastCols = cols;
  for (let r = 0; r < tab.rows.length; r++) {
    const hdr = headerMappingForRow(tab.rows[r] ?? []);
    if (hdr?.type === 'bodyweight') { cols = hdr.columns; lastCols = cols; continue; }
    if (cellDate(tab.rows[r]?.[cols.date!], year) === dateISO) {
      const existing = cellNumber(tab.rows[r]?.[cols.bodyweight!]);
      const where = `${file.name} › ${tab.title}!${colName(cols.bodyweight!)}${r + 1}`;
      if (existing != null && !overwrite && existing !== weight) return { ok: false, conflict: existing, where };
      await valuesUpdate(backend, file.id, `${quoteTab(tab.title)}!${colName(cols.bodyweight!)}${r + 1}`, [[weight]], 'USER_ENTERED');
      await sync();
      return { ok: true, where };
    }
  }
  // no row for that date yet: append one under the last block's columns
  const width = Math.max(lastCols.date!, lastCols.bodyweight!) + 1;
  const row: (string | number)[] = Array(width).fill('');
  row[lastCols.date!] = mdY(dateISO);
  row[lastCols.bodyweight!] = weight;
  await valuesAppend(backend, file.id, `${quoteTab(tab.title)}!A:${colName(width - 1)}`, [row], 'USER_ENTERED');
  await sync();
  return { ok: true, where: `${file.name} › ${tab.title} (new row)` };
}

export interface WorkoutEntry {
  date: string; exercise: string; weight?: number | null; sets?: number | null; reps?: number | null;
  timeText?: string; distanceText?: string; notes?: string;
}

export async function logWorkout(entry: WorkoutEntry, fileId?: string): Promise<{ where: string }> {
  let target = fileId ?? state.config.settings.quickEntryWorkoutFile ?? workoutTargets()[0]?.id;
  if (!target) {
    if (!state.folder) throw new ApiError('CONFIG', 'Folder not loaded yet — refresh first.');
    target = await createTrainingLog(backend, state.folder.id);
    await setConfigKey('settings', { ...state.config.settings, quickEntryWorkoutFile: target });
  }
  const file = state.files.find(f => f.id === target);
  const tabTitle = file?.tabs.find(t => classifyTab(t, file.name).kind === 'workout-log')?.title ?? 'Log';
  const row = [mdY(entry.date), entry.exercise, entry.weight ?? '', entry.sets ?? '', entry.reps ?? '', entry.timeText ?? '', entry.distanceText ?? '', entry.notes ?? '', state.device];
  // RAW: "1:30" is stored as the text 1:30 (read back as 1 min 30 s), never as a clock time
  await valuesAppend(backend, target, `${quoteTab(tabTitle)}!A:I`, [row], 'RAW');
  await sync();
  return { where: `${file?.name ?? 'Training Log'} › ${tabTitle}` };
}

export async function credentialsInfo() { return (await getBackend()).credentialsInfo(); }
export async function saveClientCredentials(json: string) { return (await getBackend()).setClientCredentials(json); }
export async function clearClientCredentials() { return (await getBackend()).clearClientCredentials(); }

export async function installUpdate() {
  if (state.update?.install) await state.update.install();
}
export async function checkForUpdate() {
  const u = await backend.checkUpdate();
  set({ update: u });
  return u;
}
