export const GROUPS = {
  managers: '#a79df0',
  locations: '#f08556',
  products: '#dcc3a1',
  finance: '#ece8e1',
  alerts: '#ef6461',
  ai: '#f08556',
} as const;
export type Group = keyof typeof GROUPS;

const BASE = ['#f08556', '#a79df0', '#ece8e1', '#dcc3a1', '#8d8a93', '#f8c1a8', '#a4573a', '#cfc8f7', '#55535b'];

export const gColor = (g?: string) => (g && g in GROUPS ? GROUPS[g as Group] : GROUPS.ai);

/** Палитра серий: цвет группы первым, затем остальные. */
export function palette(g?: string): string[] {
  const first = gColor(g);
  return [first, ...BASE.filter((c) => c !== first)];
}

export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function mix(hex: string, to: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export const INK = { 1: '#f4f4f5', 2: '#a1a1aa', 3: '#71717a', line: 'rgba(255,255,255,0.06)', bg: '#151517' };
