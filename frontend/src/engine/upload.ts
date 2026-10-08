// 業主上傳 Excel / CSV：解析、欄位辨識、驗證，以及範本產生。
// Excel 解析使用 SheetJS 官方 CDN（執行時載入，不經 npm）。檔案只在瀏覽器內處理，不會上傳到任何伺服器。
import type { InfluentRow } from './runner';

const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XLSXModule = any;
let xlsx: Promise<XLSXModule> | null = null;
const loadXLSX = () => (xlsx ??= import(/* @vite-ignore */ SHEETJS).catch((e) => { xlsx = null; throw e; }));

export type FlowUnit = 'm3d' | 'm3h';
export interface ParsedUpload {
  rows: InfluentRow[];
  columns: { time: string | null; Q: string; COD: string; NH4: string; TSS: string | null };
  flowUnitGuess: FlowUnit;
  warnings: string[];
  start: number;
  end: number;
}

const PATTERNS: [keyof ParsedUpload['columns'], RegExp][] = [
  ['time', /時間|日期|time|date/i],
  ['COD', /cod/i],
  ['NH4', /氨|nh4|nh3|ammon/i],
  ['Q', /流量|水量|flow|^\s*q\b|cmd|cmh/i],
  ['TSS', /tss|懸浮|^\s*ss\b|\bss\b/i],
];

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function toTime(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number' && v > 20000 && v < 80000) {              // Excel 日期序號（當地時間）
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    return ms + d.getTimezoneOffset() * 60000;
  }
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v.trim().replace(/-/g, '/'));
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export async function parseFile(file: File, fallbackIntervalMin = 15): Promise<ParsedUpload> {
  if (file.size > 15 * 1024 * 1024) throw new Error('檔案超過 15 MB，請縮減資料筆數');
  const X = await loadXLSX();
  const wb = X.read(await file.arrayBuffer(), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const table: unknown[][] = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const headerIdx = table.findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 3);
  if (headerIdx < 0) throw new Error('找不到標題列：第一個工作表需有「時間、流量、COD、氨氮」等欄位名稱');
  const header = table[headerIdx].map((c) => String(c ?? '').trim());
  const col: Record<string, number> = {};
  for (const [key, re] of PATTERNS) {
    const i = header.findIndex((h, j) => h && re.test(h) && !Object.values(col).includes(j));
    if (i >= 0) col[key] = i;
  }
  const missing = (['Q', 'COD', 'NH4'] as const).filter((k) => col[k] === undefined);
  if (missing.length) {
    const zh = { Q: '流量', COD: 'COD', NH4: '氨氮 (NH4-N)' };
    throw new Error(`缺少必要欄位：${missing.map((k) => zh[k]).join('、')}。目前標題列：${header.filter(Boolean).join('、')}`);
  }
  const warnings: string[] = [];
  const rows: InfluentRow[] = [];
  let skipped = 0;
  const body = table.slice(headerIdx + 1);
  body.forEach((r, i) => {
    const Q = toNumber(r[col.Q]), COD = toNumber(r[col.COD]), NH4 = toNumber(r[col.NH4]);
    const TSS = col.TSS !== undefined ? toNumber(r[col.TSS]) : null;
    if (Q === null || COD === null || NH4 === null || Q <= 0 || COD < 0 || NH4 < 0) { if (r.some((c) => c !== null)) skipped++; return; }
    let t = col.time !== undefined ? toTime(r[col.time]) : null;
    if (t === null) t = Date.UTC(2000, 0, 1) + i * fallbackIntervalMin * 60000;
    rows.push({ t, Q, COD, NH4, TSS });
  });
  if (rows.length < 3) throw new Error('有效資料少於 3 筆，請確認數值欄位');
  if (skipped) warnings.push(`已略過 ${skipped} 筆缺值或負值的資料列`);
  if (col.time === undefined) warnings.push(`沒有時間欄，假設每 ${fallbackIntervalMin} 分鐘一筆`);
  rows.sort((a, b) => a.t - b.t);
  const dedup = rows.filter((r, i) => i === 0 || r.t !== rows[i - 1].t);
  if (dedup.length < rows.length) warnings.push(`已合併 ${rows.length - dedup.length} 筆重複時間的資料`);
  const span = (dedup[dedup.length - 1].t - dedup[0].t) / 60000;
  if (span < 120) throw new Error('資料期間少於 2 小時，至少需要 2 小時（建議 1 天以上）');
  if (span > 7 * 1440) warnings.push('資料超過 7 天，只模擬前 7 天');
  const codHigh = dedup.filter((r) => r.COD > 3000).length, nhHigh = dedup.filter((r) => r.NH4 > 200).length;
  if (codHigh) warnings.push(`有 ${codHigh} 筆 COD > 3000 mg/L，已超出市政汙水生物處理模型的適用範圍，結果僅供參考`);
  if (nhHigh) warnings.push(`有 ${nhHigh} 筆氨氮 > 200 mg/L，結果僅供參考`);
  const qHeader = header[col.Q];
  return {
    rows: dedup,
    columns: { time: col.time !== undefined ? header[col.time] : null, Q: qHeader, COD: header[col.COD], NH4: header[col.NH4], TSS: col.TSS !== undefined ? header[col.TSS] : null },
    flowUnitGuess: /\/\s*h|cmh|小時/i.test(qHeader) ? 'm3h' : 'm3d',
    warnings,
    start: dedup[0].t,
    end: dedup[dedup.length - 1].t,
  };
}

/** 產生並下載範本（2 天、每 15 分鐘，示範日變化） */
export async function downloadTemplate() {
  const X = await loadXLSX();
  const rows: (string | number | Date)[][] = [['時間', '進流流量 (m3/d)', '進流 COD (mg/L)', '進流氨氮 NH4-N (mg/L)', '進流 SS (mg/L)（選填）']];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 2);
  for (let i = 0; i < 2 * 96; i++) {
    const tt = new Date(start.getTime() + i * 15 * 60000);
    const w = 2 * Math.PI * (tt.getHours() + tt.getMinutes() / 60) / 24;
    const fq = 1 + 0.28 * Math.sin(w - 2) + 0.1 * Math.sin(2 * w - 1);
    const fc = 1 + 0.22 * Math.sin(w - 2.4) + 0.08 * Math.sin(2 * w - 1.3);
    rows.push([tt, Math.round(18446 * fq), +(381 * fc).toFixed(1), +(31.6 * fc).toFixed(2), +(213 * fc).toFixed(1)]);
  }
  const ws = X.utils.aoa_to_sheet(rows, { cellDates: true });
  ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 20 }];
  for (let r = 1; r < rows.length; r++) { const c = ws[X.utils.encode_cell({ r, c: 0 })]; if (c) c.z = 'yyyy/mm/dd hh:mm'; }
  const help = X.utils.aoa_to_sheet([
    ['填寫說明'],
    ['1. 第一個工作表放資料，第一列為標題。必要欄位：時間、流量、COD、氨氮；SS 為選填。'],
    ['2. 時間可為 Excel 日期時間或「2026/10/08 08:00」格式；間隔可不固定（1 分鐘～1 小時皆可），系統會內插成每分鐘。'],
    ['3. 流量單位預設 m3/d；若為 m3/h，請在標題寫「m3/h」或於網頁上切換。'],
    ['4. 建議提供 1～7 天資料。系統會依您的平均流量，將 BSM1 標準廠等比例縮放後模擬。'],
    ['5. 檔案只在您的瀏覽器中處理，不會上傳到伺服器。'],
  ]);
  help['!cols'] = [{ wch: 100 }];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, '進流資料');
  X.utils.book_append_sheet(wb, help, '說明');
  X.writeFile(wb, '進流資料範本.xlsx');
}
