export const GROUPS = {
  managers: '#7b61ff',
  locations: '#ff6a3d',
  products: '#ffb020',
  finance: '#e4e4e7',
  alerts: '#f04438',
  ai: '#ff6a3d',
} as const;
export type Group = keyof typeof GROUPS;

const BASE = ['#ff6a3d', '#7b61ff', '#ffb020', '#e4e4e7', '#8d8a93', '#c2410c', '#b3a5ff', '#55535b'];

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
