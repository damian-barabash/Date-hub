// Спецификация диаграммы (её пишет ИИ или страница дашборда) → опция ECharts.
// Модель задаёт только тип и сопоставление колонок — данные берутся из результата запроса.
import { axisFmt, fmt, shortName, type Fmt } from '../format';
import { alpha, gColor, INK, mix, palette } from './theme';
import { echarts } from './echarts';

export type Kind =
  | 'bar' | 'line' | 'area' | 'waterfall' | 'pie' | 'donut' | 'rose' | 'funnel' | 'treemap' | 'sunburst'
  | 'scatter' | 'bubble' | 'heatmap' | 'radar' | 'gauge' | 'sankey' | 'graph'
  | 'bar3d' | 'scatter3d' | 'surface3d' | 'network3d' | 'map';

export interface ChartSpec {
  chart: Kind;
  title?: string;
  subtitle?: string;
  x?: string;
  y?: string[] | string;
  series?: string;
  name?: string;
  value?: string;
  z?: string;
  size?: string;
  source?: string;
  target?: string;
  path?: string[];
  format?: Fmt;
  group?: string;
  horizontal?: boolean;
  stack?: boolean;
  max?: number;
  labels?: Record<string, string>; // подписи серий
}
type Row = Record<string, any>;

export const GL_KINDS: Kind[] = ['bar3d', 'scatter3d', 'surface3d'];
export const KIND_ALIASES: Record<string, Kind> = {
  hbar: 'bar', column: 'bar', columns: 'bar', doughnut: 'donut', ring: 'donut', nightingale: 'rose', bubble3d: 'scatter3d',
  network: 'graph', force: 'graph', '3dbar': 'bar3d', bar_3d: 'bar3d', scatter_3d: 'scatter3d', surface: 'surface3d', network_3d: 'network3d', geo: 'map',
};

const ys = (s: ChartSpec) => (Array.isArray(s.y) ? s.y : s.y ? [s.y] : []);
const n = (v: unknown) => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? null : Number(v));
const label = (s: ChartSpec, k: string) => s.labels?.[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Первая колонка-текст и первая колонка-число — когда модель не указала сопоставление. */
export function guessMapping(spec: ChartSpec, rows: Row[]): ChartSpec {
  if (!rows.length) return spec;
  const cols = Object.keys(rows[0]);
  const numCols = cols.filter((c) => rows.some((r) => typeof r[c] === 'number'));
  const txtCols = cols.filter((c) => !numCols.includes(c));
  const s = { ...spec };
  if (!s.x && txtCols[0]) s.x = txtCols[0];
  if (!ys(s).length) s.y = numCols.filter((c) => c !== s.z && c !== s.size).slice(0, 1);
  if (!s.name) s.name = s.x ?? txtCols[0];
  if (!s.value) s.value = ys(s)[0] ?? numCols[0];
  if (!s.path?.length && s.name) s.path = [s.name];
  return s;
}

const tooltipBase = {
  backgroundColor: 'rgba(21,21,23,0.96)',
  borderColor: 'rgba(255,255,255,0.12)',
  borderWidth: 1,
  padding: [10, 14],
  textStyle: { color: INK[1], fontFamily: 'Manrope', fontSize: 13.5 },
  extraCssText: 'border-radius:14px;box-shadow:0 18px 40px rgba(0,0,0,.45);backdrop-filter:blur(10px);',
};

export function baseOption() {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Manrope', color: INK[2] },
    animationDuration: 1100,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: 650,
    animationEasingUpdate: 'cubicInOut' as const,
    tooltip: { ...tooltipBase },
  };
}

const axisCommon = {
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: INK[2], fontSize: 12.5, fontFamily: 'Manrope' },
  splitLine: { lineStyle: { color: INK.line, type: 'dashed' as const } },
};

function legend(show: boolean) {
  return show ? { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: INK[2], fontSize: 13 } } : { show: false };
}

function barGradient(c: string, horizontal: boolean) {
  return new echarts.graphic.LinearGradient(horizontal ? 1 : 0, 0, 0, horizontal ? 0 : 1, [
    { offset: 0, color: c },
    { offset: 1, color: mix(c, '#151517', 0.25) },
  ]);
}

export function buildOption(spec0: ChartSpec, rows: Row[]): Record<string, any> {
  const spec = guessMapping(spec0, rows);
  const f = spec.format;
  const pal = palette(spec.group);
  const main = gColor(spec.group);
  const base = baseOption();
  const vf = (v: number) => fmt(v, f);

  switch (spec.chart) {
    case 'bar': case 'line': case 'area': {
      const h = !!spec.horizontal && spec.chart === 'bar';
      const xKey = spec.x!;
      let cats: string[];
      let series: { name: string; data: (number | null)[] }[];
      if (spec.series) {
        cats = [...new Set(rows.map((r) => String(r[xKey])))];
        const names = [...new Set(rows.map((r) => String(r[spec.series!])))];
        const yk = ys(spec)[0];
        series = names.map((nm) => ({ name: nm, data: cats.map((c) => n(rows.find((r) => String(r[xKey]) === c && String(r[spec.series!]) === nm)?.[yk])) }));
      } else {
        cats = rows.map((r) => String(r[xKey]));
        series = ys(spec).map((k) => ({ name: label(spec, k), data: rows.map((r) => n(r[k])) }));
      }
      const single = series.length === 1;
      const catAxis = {
        ...axisCommon, type: 'category' as const, data: cats, inverse: h,
        splitLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => shortName(v, h ? 22 : 14), interval: h ? 0 : 'auto', rotate: !h && cats.length > 8 ? 35 : 0 },
      };
      const valAxis = { ...axisCommon, type: 'value' as const, axisLabel: { ...axisCommon.axisLabel, show: !(h && single), formatter: axisFmt(f) }, splitLine: { ...axisCommon.splitLine, show: !(h && single) } };
      return {
        ...base,
        color: pal,
        tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: spec.chart === 'bar' ? 'shadow' : 'line', shadowStyle: { color: 'rgba(255,255,255,0.03)' }, lineStyle: { color: alpha(main, 0.5) } }, valueFormatter: vf },
        legend: legend(!single),
        grid: { left: 6, right: h && single ? 92 : 18, top: 18, bottom: single ? 6 : 38, containLabel: true },
        xAxis: h ? valAxis : catAxis,
        yAxis: h ? catAxis : valAxis,
        dataZoom: !h && cats.length > 40 ? [{ type: 'inside' }] : undefined,
        series: series.map((s, i) => {
          const c = pal[i % pal.length];
          if (spec.chart === 'bar') {
            return {
              type: 'bar', name: s.name, data: s.data, stack: spec.stack ? 'a' : undefined,
              barMaxWidth: 26, barGap: '18%',
              itemStyle: { color: barGradient(c, h), borderRadius: spec.stack ? 2 : h ? [0, 5, 5, 0] : [5, 5, 0, 0] },
              emphasis: { itemStyle: { color: c } },
              label: single && h ? { show: true, position: 'right', color: INK[1], fontSize: 13, fontWeight: 600, formatter: (p: any) => fmt(p.value, f, true) } : undefined,
              animationDelay: (idx: number) => idx * 45 + i * 120,
            };
          }
          return {
            type: 'line', name: s.name, data: s.data, smooth: 0.35, showSymbol: false, symbolSize: 7, stack: spec.stack ? 'a' : undefined,
            lineStyle: { width: 2.2, color: c },
            itemStyle: { color: c, borderColor: '#0a0a0b', borderWidth: 2 },
            areaStyle: spec.chart === 'area' || single ? { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: alpha(c, 0.32) }, { offset: 1, color: alpha(c, 0) }]) } : undefined,
            emphasis: { focus: 'series' },
            animationDuration: 1600,
          };
        }),
      };
    }

    case 'waterfall': {
      const yk = ys(spec)[0];
      const cats = rows.map((r) => String(r[spec.x!]));
      const vals = rows.map((r) => n(r[yk]) ?? 0);
      let acc = 0;
      const helper: number[] = []; const up: (number | string)[] = []; const down: (number | string)[] = [];
      vals.forEach((v, i) => {
        const last = i === vals.length - 1 && /zysk|profit|wynik|total|razem|suma/i.test(cats[i]);
        if (last) { helper.push(0); up.push(v); down.push('-'); return; }
        if (v >= 0) { helper.push(acc); up.push(v); down.push('-'); acc += v; } else { acc += v; helper.push(acc); down.push(-v); up.push('-'); }
      });
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: 'axis', valueFormatter: vf },
        grid: { left: 6, right: 18, top: 18, bottom: 6, containLabel: true },
        xAxis: { ...axisCommon, type: 'category', data: cats, splitLine: { show: false } },
        yAxis: { ...axisCommon, type: 'value', axisLabel: { ...axisCommon.axisLabel, formatter: axisFmt(f) } },
        series: [
          { type: 'bar', stack: 'w', data: helper, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false } },
          { type: 'bar', stack: 'w', name: '+', data: up, barMaxWidth: 46, itemStyle: { color: barGradient(main, false), borderRadius: 7 }, label: { show: true, position: 'top', color: INK[2], fontSize: 11, formatter: (p: any) => fmt(p.value, f, true) }, animationDelay: (i: number) => i * 160 },
          { type: 'bar', stack: 'w', name: '−', data: down, barMaxWidth: 46, itemStyle: { color: barGradient('#ef6461', false), borderRadius: 7 }, label: { show: true, position: 'bottom', color: INK[2], fontSize: 11, formatter: (p: any) => '−' + fmt(p.value, f, true) }, animationDelay: (i: number) => i * 160 },
        ],
      };
    }

    case 'pie': case 'donut': case 'rose': case 'funnel': {
      let data = rows.map((r) => ({ name: String(r[spec.name!]), value: n(r[spec.value!]) ?? 0 })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
      if (spec.chart !== 'funnel' && data.length > 9) {
        const rest = data.slice(8).reduce((a, d) => a + d.value, 0);
        data = [...data.slice(0, 8), { name: 'Inne', value: rest }];
      }
      const total = data.reduce((a, d) => a + d.value, 0);
      if (spec.chart === 'funnel') {
        return {
          ...base, color: pal,
          tooltip: { ...base.tooltip, trigger: 'item', valueFormatter: vf },
          series: [{ type: 'funnel', left: '8%', width: '84%', top: 10, bottom: 10, sort: 'descending', gap: 4, data,
            itemStyle: { borderColor: '#151517', borderWidth: 2, borderRadius: 8 },
            label: { color: INK[1], fontSize: 12, formatter: (p: any) => `${p.name}  ${fmt(p.value, f, true)}` } }],
        };
      }
      const donut = spec.chart === 'donut';
      return {
        ...base, color: pal,
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: any) => `<b>${p.name}</b><br/>${fmt(p.value, f)} · ${p.percent}%` },
        legend: { ...legend(data.length <= 10), type: 'scroll', pageTextStyle: { color: INK[2] } },
        graphic: donut ? [{ type: 'group', left: 'center', top: data.length <= 10 ? '40%' : '45%', children: [
          { type: 'text', style: { text: fmt(total, f, true), fill: INK[1], font: '700 26px Manrope', textAlign: 'center' }, left: 'center' },
          { type: 'text', top: 36, style: { text: 'Razem', fill: INK[3], font: '500 12.5px Manrope', textAlign: 'center' }, left: 'center' },
        ] }] : undefined,
        series: [{
          type: 'pie',
          radius: donut ? ['52%', '76%'] : spec.chart === 'rose' ? ['14%', '78%'] : [0, '74%'],
          center: ['50%', data.length <= 10 ? '45%' : '50%'],
          roseType: spec.chart === 'rose' ? 'area' : undefined,
          padAngle: donut ? 2.5 : 0,
          itemStyle: { borderRadius: donut ? 8 : 5, borderColor: '#151517', borderWidth: donut ? 0 : 2 },
          label: { color: INK[2], fontSize: 12.5, formatter: (p: any) => (p.percent < 4 ? '' : `${shortName(p.name, 14)}\n{b|${Math.round(p.percent)}%}`), rich: { b: { color: INK[1], fontWeight: 700, fontSize: 15, padding: [3, 0, 0, 0] } } },
          labelLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' }, length: 10, length2: 12, smooth: true, showAbove: false },
          labelLayout: { hideOverlap: true },
          emphasis: { scaleSize: 8, itemStyle: { shadowBlur: 24, shadowColor: 'rgba(0,0,0,0.5)' } },
          animationType: 'scale', animationEasing: 'elasticOut', animationDelay: (i: number) => i * 70,
          data,
        }],
      };
    }

    case 'treemap': case 'sunburst': {
      const path = spec.path?.length ? spec.path : [spec.name!];
      const vk = spec.value!;
      type Node = { name: string; value: number; children?: Node[] };
      const root: Node[] = [];
      for (const r of rows) {
        let level = root;
        path.forEach((p, i) => {
          const nm = String(r[p] ?? '—');
          let node = level.find((x) => x.name === nm);
          if (!node) { node = { name: nm, value: 0, ...(i < path.length - 1 ? { children: [] } : {}) }; level.push(node); }
          node.value += n(r[vk]) ?? 0;
          if (node.children) level = node.children;
        });
      }
      const colored = root.sort((a, b) => b.value - a.value).map((nd, i) => ({ ...nd, itemStyle: { color: mix(pal[i % pal.length], '#151517', 0.12) } }));
      if (spec.chart === 'sunburst') {
        return {
          ...base,
          tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: any) => `<b>${p.name}</b><br/>${fmt(p.value, f)}` },
          series: [{ type: 'sunburst', data: colored, radius: ['12%', '92%'], sort: 'desc',
            itemStyle: { borderColor: '#151517', borderWidth: 2, borderRadius: 6 },
            label: { color: '#0a0a0b', fontWeight: 700, fontSize: 11, minAngle: 8 },
            levels: [{}, { r0: '12%', r: '52%' }, { r0: '52%', r: '74%', itemStyle: { opacity: 0.8 } }, { r0: '74%', r: '92%', itemStyle: { opacity: 0.6 } }],
            animationDurationUpdate: 900 }],
        };
      }
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: any) => `<b>${(p.treePathInfo ?? []).slice(1).map((x: any) => x.name).join(' › ')}</b><br/>${fmt(p.value, f)}` },
        series: [{
          type: 'treemap', data: colored, roam: false, nodeClick: 'zoomToNode', width: '100%', height: '100%', top: 0, left: 0,
          breadcrumb: { show: path.length > 1, bottom: 0, itemStyle: { color: '#1b1b1e', borderColor: 'rgba(255,255,255,0.1)', textStyle: { color: INK[2] } } },
          itemStyle: { borderColor: '#151517', borderWidth: 2, gapWidth: 2, borderRadius: 8 },
          label: { show: true, color: '#0a0a0b', fontWeight: 800, fontSize: 12, overflow: 'truncate', formatter: (p: any) => `${p.name}\n{v|${fmt(p.value, f, true)}}`, rich: { v: { fontWeight: 600, fontSize: 11, color: 'rgba(10,10,11,0.68)', padding: [4, 0, 0, 0] } } },
          upperLabel: { show: path.length > 1, height: 26, color: '#f4f4f5', fontWeight: 800, fontSize: 12, formatter: (p: any) => `${p.name}  ·  ${fmt(p.value, f, true)}` },
          levels: path.length > 1 ? [
            { itemStyle: { borderColor: '#0f0f11', borderWidth: 0, gapWidth: 5, borderRadius: 12 } },
            { colorAlpha: [0.45, 1], itemStyle: { borderColor: '#151517', borderWidth: 4, gapWidth: 2, borderRadius: 10 }, upperLabel: { show: true } },
            { colorAlpha: [0.5, 1], itemStyle: { borderColor: '#151517', borderWidth: 1, gapWidth: 2, borderRadius: 6 } },
          ] : [{ itemStyle: { gapWidth: 3, borderRadius: 10 } }],
          animationDurationUpdate: 900,
        }],
      };
    }

    case 'scatter': case 'bubble': {
      const yk = ys(spec)[0];
      const fx = guessFmt(spec.x!, f, rows), fy = guessFmt(yk, f, rows);
      const sizes = spec.size ? rows.map((r) => n(r[spec.size!]) ?? 0) : [];
      const smax = Math.max(1, ...sizes);
      const many = rows.length > 40;
      // много точек → мелкие полупрозрачные; мало → пузыри умеренного размера
      const range = many ? 0 : rows.length > 20 ? 14 : 22;
      const xsv = rows.map((r) => n(r[spec.x!]) ?? 0), ysv = rows.map((r) => n(r[yk]) ?? 0);
      const mean = (a: number[]) => a.reduce((p, c) => p + c, 0) / Math.max(a.length, 1);
      const mx = mean(xsv), my = mean(ysv);
      // подписи: все при малом числе точек, иначе только выбросы
      const idx = rows.map((_, i) => i);
      const labelled = new Set<number>(!many ? idx : [
        ...[...idx].sort((p, q) => xsv[q] - xsv[p]).slice(0, 5),
        ...[...idx].sort((p, q) => ysv[q] - ysv[p]).slice(0, 2),
        ...[...idx].sort((p, q) => ysv[p] - ysv[q]).slice(0, 2),
      ]);
      const avgLine = { color: 'rgba(255,255,255,0.28)', type: 'dashed' as const, width: 1 };
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: any) => {
          if (p.componentType !== 'series') return '';
          const r = rows[p.dataIndex];
          return `<b>${spec.name ? r[spec.name] : ''}</b><br/>${label(spec, spec.x!)}: ${fmt(r[spec.x!], fx)}<br/>${label(spec, yk)}: ${fmt(r[yk], fy)}${spec.size ? `<br/>${label(spec, spec.size)}: ${fmt(r[spec.size], 'num')}` : ''}`;
        } },
        grid: { left: 6, right: 34, top: 30, bottom: 26, containLabel: true },
        xAxis: { ...axisCommon, type: 'value', scale: true, name: label(spec, spec.x!), nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: INK[2], fontSize: 12 }, axisLabel: { ...axisCommon.axisLabel, formatter: axisFmt(fx) } },
        yAxis: { ...axisCommon, type: 'value', scale: true, name: label(spec, yk), nameTextStyle: { color: INK[2], fontSize: 12, align: 'left' }, axisLabel: { ...axisCommon.axisLabel, formatter: axisFmt(fy) } },
        series: [{
          type: 'scatter',
          data: rows.map((r, i) => ({
            value: [n(r[spec.x!]), n(r[yk])], name: spec.name ? String(r[spec.name]) : '',
            symbolSize: many ? 7 : 9 + (spec.size ? Math.sqrt((sizes[i] ?? 0) / smax) * range : 0),
            label: { show: labelled.has(i) },
          })),
          itemStyle: { color: alpha(main, many ? 0.6 : 0.85), borderColor: '#151517', borderWidth: 1 },
          label: { formatter: (p: any) => shortName(p.name, 20), position: 'right', distance: 6, color: INK[1], fontSize: 11.5, fontWeight: 500 },
          labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
          emphasis: { scale: 1.6, itemStyle: { color: main, borderColor: '#fff' }, label: { show: true, fontWeight: 700 } },
          markLine: {
            silent: true, symbol: 'none', animation: true,
            label: { color: INK[2], fontSize: 11, formatter: (p: any) => `śr. ${fmt(p.value, p.data.xAxis !== undefined ? fx : fy, true)}` },
            data: [{ xAxis: mx, lineStyle: avgLine, label: { show: false } }, { yAxis: my, lineStyle: avgLine, label: { position: 'insideEndTop' } }],
          },
          animationDelay: (i: number) => Math.min(i * 8, 900),
        }],
      };
    }

    case 'heatmap': {
      const yk = ys(spec)[0];
      const xs = [...new Set(rows.map((r) => String(r[spec.x!])))];
      const yv = [...new Set(rows.map((r) => String(r[yk])))];
      const vals = rows.map((r) => n(r[spec.value!]) ?? 0);
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: any) => `<b>${xs[p.value[0]]} · ${yv[p.value[1]]}</b><br/>${fmt(p.value[2], f)}` },
        grid: { left: 6, right: 12, top: 10, bottom: 52, containLabel: true },
        xAxis: { ...axisCommon, type: 'category', data: xs, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, rotate: xs.length > 8 ? 35 : 0, formatter: (v: string) => shortName(v, 14) } },
        yAxis: { ...axisCommon, type: 'category', data: yv, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => shortName(v, 18) } },
        visualMap: { min: Math.min(...vals), max: Math.max(...vals), calculable: true, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140, itemWidth: 10, textStyle: { color: INK[3] }, inRange: { color: ['#1b1b1e', mix(main, '#1b1b1e', 0.55), main, mix(main, '#ffffff', 0.35)] }, formatter: (v: number) => fmt(v, f, true) },
        series: [{ type: 'heatmap', data: rows.map((r) => [xs.indexOf(String(r[spec.x!])), yv.indexOf(String(r[yk])), n(r[spec.value!]) ?? 0]),
          itemStyle: { borderColor: '#151517', borderWidth: 3, borderRadius: 6 }, emphasis: { itemStyle: { shadowBlur: 14, shadowColor: alpha(main, 0.6) } },
          animationDelay: (i: number) => i * 6 }],
      };
    }

    case 'radar': {
      const metrics = ys(spec);
      const ind = metrics.map((m) => ({ name: label(spec, m), max: Math.max(...rows.map((r) => n(r[m]) ?? 0)) * 1.08 || 1 }));
      return {
        ...base, color: pal,
        tooltip: { ...base.tooltip, trigger: 'item' },
        legend: legend(rows.length > 1),
        radar: { indicator: ind, radius: '66%', center: ['50%', '48%'], splitNumber: 4, axisName: { color: INK[2], fontSize: 11.5, fontWeight: 600 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }, splitArea: { areaStyle: { color: ['rgba(255,255,255,0.015)', 'transparent'] } }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } } },
        series: [{ type: 'radar', symbol: 'circle', symbolSize: 5,
          data: rows.slice(0, 8).map((r, i) => ({ name: String(r[spec.name!] ?? `#${i + 1}`), value: metrics.map((m) => n(r[m]) ?? 0),
            lineStyle: { width: 2, color: pal[i % pal.length] }, itemStyle: { color: pal[i % pal.length] }, areaStyle: { color: alpha(pal[i % pal.length], 0.16) } })),
          animationDuration: 1300 }],
      };
    }

    case 'gauge': {
      const v = n(rows[0]?.[spec.value!]) ?? 0;
      const max = spec.max ?? (f === 'pct' ? 1 : Math.max(v * 1.3, 1));
      return {
        ...base,
        series: [{
          type: 'gauge', min: 0, max, startAngle: 215, endAngle: -35, radius: '92%', center: ['50%', '58%'],
          progress: { show: true, width: 16, roundCap: true, itemStyle: { color: main } },
          axisLine: { roundCap: true, lineStyle: { width: 16, color: [[1, '#232327']] } },
          axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false },
          title: { show: true, offsetCenter: [0, '38%'], color: INK[3], fontSize: 12 },
          detail: { valueAnimation: true, offsetCenter: [0, '0%'], color: INK[1], fontSize: 30, fontWeight: 800, fontFamily: 'Manrope', formatter: (x: number) => fmt(x, f, true) },
          data: [{ value: v, name: label(spec, spec.value!) }],
          animationDuration: 1800,
        }],
      };
    }

    case 'sankey': case 'graph': {
      const src = spec.source!, tgt = spec.target!, vk = spec.value!;
      const sources = new Set(rows.map((r) => String(r[src])));
      // в sankey нельзя циклы: если имя есть и в источниках, и в целях — разводим
      const tName = (v: string) => (spec.chart === 'sankey' && sources.has(v) ? `${v} ` : v);
      const links = rows.map((r) => ({ source: String(r[src]), target: tName(String(r[tgt])), value: Math.max(n(r[vk]) ?? 0, 0) })).filter((l) => l.value > 0);
      const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
      if (spec.chart === 'sankey') {
        return {
          ...base,
          tooltip: { ...base.tooltip, trigger: 'item', valueFormatter: vf },
          series: [{
            type: 'sankey', left: 8, right: 120, top: 10, bottom: 10, nodeWidth: 12, nodeGap: 8, draggable: true, emphasis: { focus: 'adjacency' },
            data: names.map((nm, i) => ({ name: nm, itemStyle: { color: sources.has(nm) ? pal[i % pal.length] : mix(main, '#151517', 0.2), borderRadius: 4 } })),
            links, lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.32 },
            label: { color: INK[2], fontSize: 11, formatter: (p: any) => shortName(p.name, 22) },
            animationDuration: 1500,
          }],
        };
      }
      const weight = new Map<string, number>();
      links.forEach((l) => { weight.set(l.source, (weight.get(l.source) ?? 0) + l.value); weight.set(l.target, (weight.get(l.target) ?? 0) + l.value); });
      const wmax = Math.max(1, ...weight.values());
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p: any) => (p.dataType === 'edge' ? `${p.data.source} → ${p.data.target}<br/>${fmt(p.data.value, f)}` : `<b>${p.name}</b><br/>${fmt(weight.get(p.name) ?? 0, f)}`) },
        legend: legend(true),
        series: [{
          type: 'graph', layout: 'force', roam: true, draggable: true,
          force: { repulsion: 220, edgeLength: [50, 140], gravity: 0.08, friction: 0.12 },
          categories: [{ name: label(spec, src), itemStyle: { color: pal[0] } }, { name: label(spec, tgt), itemStyle: { color: pal[1] } }],
          data: names.map((nm) => ({ name: nm, category: sources.has(nm) ? 0 : 1, symbolSize: 8 + Math.sqrt((weight.get(nm) ?? 0) / wmax) * (sources.has(nm) ? 46 : 26),
            label: { show: sources.has(nm), color: INK[1], fontWeight: 700, fontSize: 11 } })),
          links: links.map((l) => ({ ...l, lineStyle: { width: 0.6 + Math.sqrt(l.value / wmax) * 4 } })),
          lineStyle: { color: 'source', opacity: 0.35, curveness: 0.12 },
          itemStyle: { borderColor: '#0a0a0b', borderWidth: 1.5, shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.4)' },
          emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.9 } },
          animationDuration: 2000,
        }],
      };
    }

    case 'bar3d': case 'scatter3d': case 'surface3d': {
      const yk = ys(spec)[0];
      const zk = spec.z ?? spec.value ?? ys(spec)[1];
      const isCat = (k: string) => rows.some((r) => typeof r[k] === 'string');
      const xCat = isCat(spec.x!), yCat = isCat(yk);
      const xs = xCat ? [...new Set(rows.map((r) => String(r[spec.x!])))] : [];
      const yv = yCat ? [...new Set(rows.map((r) => String(r[yk])))] : [];
      const zs = rows.map((r) => n(r[zk]) ?? 0);
      const data = rows.map((r) => [xCat ? xs.indexOf(String(r[spec.x!])) : n(r[spec.x!]), yCat ? yv.indexOf(String(r[yk])) : n(r[yk]), n(r[zk]) ?? 0]);
      const ax = (cat: boolean, names: string[], nm: string, fm?: Fmt) => ({
        type: cat ? 'category' : 'value', data: cat ? names : undefined, name: nm, nameTextStyle: { color: INK[2], fontSize: 11 },
        axisLabel: { color: INK[3], fontSize: 10, interval: 0, formatter: cat ? (v: string) => shortName(v, 12) : axisFmt(fm) },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }, axisPointer: { lineStyle: { color: main } },
      });
      const kind = spec.chart === 'bar3d' ? 'bar3D' : spec.chart === 'scatter3d' ? 'scatter3D' : 'surface';
      return {
        ...base,
        tooltip: { ...base.tooltip, formatter: (p: any) => {
          const d = p.value ?? p.data;
          return `<b>${xCat ? xs[d[0]] : fmt(d[0], 'num')} · ${yCat ? yv[d[1]] : fmt(d[1], 'num')}</b><br/>${fmt(d[2], f)}`;
        } },
        visualMap: { show: false, min: Math.min(...zs), max: Math.max(...zs), inRange: { color: [mix(main, '#1b1b1e', 0.7), mix(main, '#1b1b1e', 0.35), main, mix(main, '#ffffff', 0.4)] } },
        xAxis3D: ax(xCat, xs, label(spec, spec.x!)),
        yAxis3D: ax(yCat, yv, label(spec, yk)),
        zAxis3D: ax(false, [], label(spec, zk), f),
        grid3D: {
          top: -10, left: 0, right: 0, bottom: 0,
          boxWidth: 130, boxDepth: 100, boxHeight: 72,
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
          axisPointer: { lineStyle: { color: alpha(main, 0.6) } },
          environment: 'none',
          light: { main: { intensity: 1.15, shadow: true, shadowQuality: 'high', alpha: 40, beta: 30 }, ambient: { intensity: 0.35 } },
          viewControl: { autoRotate: true, autoRotateSpeed: 6, autoRotateAfterStill: 4, distance: 175, alpha: 22, beta: 32, minDistance: 110, maxDistance: 320, damping: 0.85, animationDurationUpdate: 1200 },
        },
        series: [{
          type: kind, data, shading: kind === 'scatter3D' ? undefined : 'lambert', bevelSize: kind === 'bar3D' ? 0.25 : undefined, bevelSmoothness: 4,
          symbolSize: kind === 'scatter3D' ? 12 : undefined,
          itemStyle: { opacity: kind === 'scatter3D' ? 0.9 : 0.96 },
          wireframe: kind === 'surface' ? { show: true, lineStyle: { color: 'rgba(255,255,255,0.12)' } } : undefined,
          emphasis: { itemStyle: { color: mix(main, '#ffffff', 0.5) }, label: { show: false } },
          animationDurationUpdate: 1000, animationEasingUpdate: 'cubicOut',
        }],
      };
    }
    default:
      return { ...base, title: { text: `Nieznany typ wykresu: ${spec.chart}`, textStyle: { color: INK[2], fontSize: 13 } } };
  }
}

function guessFmt(col: string, f: Fmt, rows: Row[] = []): Fmt {
  if (/marz|margin|pct|udzial|share|proc|ratio/i.test(col)) return 'pct';
  const max = rows.reduce((a, r) => Math.max(a, Math.abs(Number(r[col]) || 0)), 0);
  if (/przych|revenue|netto|brutto|zysk|profit|koszt|cost|cena|price|sprzed|obrot|sales|value|kwota/i.test(col)) return 'pln';
  if (/ilosc|qty|szt|count|liczba|punkt|sklep|records|n$/i.test(col)) return 'int';
  if (f === 'pct' && max > 1.5) return 'num';
  return f;
}
