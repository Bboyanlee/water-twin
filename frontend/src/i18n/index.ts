import zhTW from './zh-TW';

// 目前僅繁中；預留切換結構
export const t = zhTW;

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
