/** Thin Drive v3 / Sheets v4 client over Backend.request. */
import type { Backend } from './backend';
import type { SheetCell } from '../core/time';
import type { SheetFile, SheetTab } from '../core/model';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveItem {
  id: string;             // the spreadsheet id (target id for shortcuts)
  name: string;
  modifiedTime: string;
  owner?: string;
  canEdit?: boolean;
  viaShortcut?: boolean;
}

const q = (s: string) => encodeURIComponent(s);
export const quoteTab = (t: string) => `'${t.replace(/'/g, "''")}'`;

export async function findFolders(b: Backend, name = 'Health Tracker'): Promise<{ id: string; name: string; modifiedTime: string }[]> {
  const query = `mimeType='${FOLDER_MIME}' and name contains '${name.replace(/'/g, "\\'")}' and trashed=false`;
  const r = await b.request('GET', `${DRIVE}/files?q=${q(query)}&fields=${q('files(id,name,modifiedTime)')}&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return (r.files ?? []).sort((a: any, b2: any) => (a.name.trim() === name ? -1 : 0) - (b2.name.trim() === name ? -1 : 0));
}

/** Every spreadsheet in the folder, following shortcuts to sheets shared by others. */
export async function listFolderSheets(b: Backend, folderId: string): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken = '';
  const fields = 'nextPageToken,files(id,name,mimeType,modifiedTime,owners(emailAddress),capabilities(canEdit),shortcutDetails(targetId,targetMimeType))';
  do {
    const r = await b.request('GET', `${DRIVE}/files?q=${q(`'${folderId}' in parents and trashed=false`)}&fields=${q(fields)}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const f of r.files ?? []) {
      if (f.mimeType === SHEET_MIME) {
        items.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, owner: f.owners?.[0]?.emailAddress, canEdit: f.capabilities?.canEdit });
      } else if (f.mimeType === SHORTCUT_MIME && f.shortcutDetails?.targetMimeType === SHEET_MIME) {
        try {
          const t = await b.request('GET', `${DRIVE}/files/${f.shortcutDetails.targetId}?fields=${q('id,name,modifiedTime,trashed,owners(emailAddress),capabilities(canEdit)')}&supportsAllDrives=true`);
          if (!t.trashed) items.push({ id: t.id, name: t.name, modifiedTime: t.modifiedTime, owner: t.owners?.[0]?.emailAddress, canEdit: t.capabilities?.canEdit, viaShortcut: true });
        } catch {
          /* target no longer shared with us — skip, don't crash */
        }
      }
    }
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  // de-duplicate (a sheet and a shortcut to it)
  return [...new Map(items.map(i => [i.id, i])).values()];
}

function toCell(v: any): SheetCell {
  if (!v) return {};
  const cell: SheetCell = {};
  if (v.formattedValue != null) cell.f = v.formattedValue;
  const ev = v.effectiveValue;
  if (ev?.numberValue != null) cell.n = ev.numberValue;
  if (ev?.stringValue != null) cell.s = ev.stringValue;
  if (ev?.boolValue != null) cell.s = String(ev.boolValue);
  const t = v.effectiveFormat?.numberFormat?.type;
  if (t) cell.t = t;
  else if (ev?.stringValue != null) cell.t = 'TEXT';
  if (v.userEnteredValue?.formulaValue || (!v.userEnteredValue && ev)) cell.fx = true;
  return cell;
}

export async function fetchSheetFile(b: Backend, item: DriveItem): Promise<SheetFile> {
  const fields = 'sheets(properties(sheetId,title,hidden),data(rowData(values(formattedValue,effectiveValue,userEnteredValue,effectiveFormat/numberFormat))))';
  const r = await b.request('GET', `${SHEETS}/${item.id}?includeGridData=true&fields=${q(fields)}`);
  const tabs: SheetTab[] = (r.sheets ?? []).map((s: any) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
    hidden: !!s.properties.hidden,
    rows: (s.data?.[0]?.rowData ?? []).map((row: any) => (row.values ?? []).map(toCell)),
  }));
  return { id: item.id, name: item.name, modifiedTime: item.modifiedTime, owner: item.owner, viaShortcut: item.viaShortcut, canEdit: item.canEdit, tabs };
}

export async function valuesGet(b: Backend, id: string, range: string): Promise<string[][]> {
  const r = await b.request('GET', `${SHEETS}/${id}/values/${q(range)}?valueRenderOption=FORMATTED_VALUE`);
  return r.values ?? [];
}

/** RAW keeps "1:30" as text so Sheets can't turn it into 1:30 AM. */
export async function valuesUpdate(b: Backend, id: string, range: string, values: (string | number)[][], input: 'RAW' | 'USER_ENTERED' = 'RAW') {
  return b.request('PUT', `${SHEETS}/${id}/values/${q(range)}?valueInputOption=${input}`, { range, majorDimension: 'ROWS', values });
}

export async function valuesAppend(b: Backend, id: string, range: string, values: (string | number)[][], input: 'RAW' | 'USER_ENTERED' = 'RAW') {
  return b.request('POST', `${SHEETS}/${id}/values/${q(range)}:append?valueInputOption=${input}&insertDataOption=INSERT_ROWS`, { range, majorDimension: 'ROWS', values });
}

export async function batchUpdate(b: Backend, id: string, requests: unknown[]) {
  return b.request('POST', `${SHEETS}/${id}:batchUpdate`, { requests });
}

/** Needs the drive.file scope: creates a Google Sheet directly inside the folder. */
export async function createSheetInFolder(b: Backend, name: string, folderId: string): Promise<{ id: string; firstTabId: number }> {
  const f = await b.request('POST', `${DRIVE}/files?supportsAllDrives=true&fields=id`, { name, mimeType: SHEET_MIME, parents: [folderId] });
  const meta = await b.request('GET', `${SHEETS}/${f.id}?fields=${q('sheets(properties(sheetId,title))')}`);
  return { id: f.id, firstTabId: meta.sheets[0].properties.sheetId };
}

export const TRAINING_LOG_HEADERS = ['Date', 'Exercise', 'Weight (lb)', 'Sets', 'Reps', 'Time', 'Distance', 'Notes', 'Logged from'];

export async function createTrainingLog(b: Backend, folderId: string): Promise<string> {
  const { id, firstTabId } = await createSheetInFolder(b, 'Training Log', folderId);
  await batchUpdate(b, id, [
    { updateSheetProperties: { properties: { sheetId: firstTabId, title: 'Log', gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
    // Time + Distance columns stay plain text: typing 1:30 by hand also stays "1:30" (= 1 min 30 s)
    { repeatCell: { range: { sheetId: firstTabId, startColumnIndex: 5, endColumnIndex: 7 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
    { repeatCell: { range: { sheetId: firstTabId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
  ]);
  await valuesUpdate(b, id, `${quoteTab('Log')}!A1:I1`, [TRAINING_LOG_HEADERS]);
  return id;
}

export async function createConfigSheet(b: Backend, folderId: string): Promise<string> {
  const { id, firstTabId } = await createSheetInFolder(b, '_config', folderId);
  await batchUpdate(b, id, [
    { updateSheetProperties: { properties: { sheetId: firstTabId, title: 'README' }, fields: 'title' } },
    { addSheet: { properties: { title: 'config', hidden: true } } },
  ]);
  await valuesUpdate(b, id, `${quoteTab('README')}!A1:A3`, [
    ['Health Tracker app settings (exercise map, goals, column mappings).'],
    ['Managed by the app and shared by all your computers — please don\'t edit the hidden "config" tab by hand.'],
    ['Deleting this file resets the app\'s settings to defaults.'],
  ]);
  await valuesUpdate(b, id, `${quoteTab('config')}!A1:D1`, [['key', 'value', 'updatedAt', 'device']]);
  return id;
}
