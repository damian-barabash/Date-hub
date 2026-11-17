<script lang="ts" module>
  // Собственный набор иконок AI DATE HUB (сетка 24, линия 1.6, геометрия из простых примитивов).
  export const ICONS: Record<string, string> = {
    grid: '<rect x="3" y="3" width="10" height="7" rx="2"/><rect x="15" y="3" width="6" height="7" rx="2"/><rect x="3" y="12" width="6" height="9" rx="2"/><rect x="11" y="12" width="10" height="9" rx="2"/>',
    ask: '<path d="M4 5h16v11h-9l-5 4v-4H4z"/><path d="M9 12.500v-2M12 12.500V8.500M15 12.500v-3"/>',
    users: '<circle cx="9" cy="8" r="3.200"/><path d="M3 20c0-3.300 2.700-5.500 6-5.500s6 2.200 6 5.500"/><path d="M16 5.200a3.200 3.200 0 0 1 0 5.600M18 14.900c1.900.800 3 2.600 3 5.100"/>',
    store: '<path d="M4 10v10h16V10"/><path d="M3 10l2-6h14l2 6z"/><path d="M9 20v-5h6v5M9 4l-1 6M15 4l1 6"/>',
    map: '<path d="M3 19l4-9h10l4 9z"/><path d="M12 14.500V8"/><circle cx="12" cy="5.500" r="2.500"/>',
    pin: '<path d="M12 21l-5.500-7.200a6.800 6.800 0 1 1 11 0z"/><circle cx="12" cy="9.600" r="1.900"/>',
    box: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M4 8l2.500-4h11L20 8M12 4v9M9.500 13h5"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.500h18M15 15h2.500"/>',
    report: '<rect x="5" y="3" width="14" height="18" rx="2.500"/><path d="M9 16.500v-3M12 16.500V9M15 16.500v-5"/>',
    compass: '<path d="M4 20v-5M8 20V10M12 20v-3"/><circle cx="15.500" cy="9" r="4.500"/><path d="M19 12.500l2.500 2.500"/>',
    database: '<rect x="4" y="4" width="16" height="4.500" rx="2.200"/><rect x="4" y="9.750" width="16" height="4.500" rx="2.200"/><rect x="4" y="15.500" width="16" height="4.500" rx="2.200"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    chat: '<path d="M4 5h16v11h-9l-5 4v-4H4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10.500 11v5M13.500 11v5"/>',
    chevron: '<path d="M6.500 9.500l5.500 5 5.500-5"/>',
    right: '<path d="M9.500 6.500l5 5.500-5 5.500"/>',
    left: '<path d="M14.500 6.500l-5 5.500 5 5.500"/>',
    arrowUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
    arrowUpRight: '<path d="M7 17L17 7M9 7h8v8"/>',
    clip: '<path d="M8 12.500l5-5a3 3 0 0 1 4.200 4.200l-7 7a4.500 4.500 0 0 1-6.400-6.400L10 6"/>',
    menu: '<path d="M4 7h16M4 12h10M4 17h16"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M5.500 8.500h1M5.500 11.500h1"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M4 12h11M11 8l4 4-4 4"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.500M12 17.200v.010"/>',
    trendUp: '<path d="M3 17l5-5 4 3 8-9"/><path d="M15 6h5v5"/>',
    trendDown: '<path d="M3 7l5 5 4-3 8 9"/><path d="M15 18h5v-5"/>',
    coins: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.700 3.100 3 7 3s7-1.300 7-3V7M5 12v5c0 1.700 3.100 3 7 3s7-1.300 7-3v-5"/>',
    percent: '<path d="M18 6L6 18"/><rect x="4.500" y="4.500" width="5" height="5" rx="2.500"/><rect x="14.500" y="14.500" width="5" height="5" rx="2.500"/>',
    layers: '<path d="M12 4l9 4.500-9 4.500-9-4.500z"/><path d="M4.500 13L12 16.800l7.500-3.800M4.500 16.700L12 20.500l7.500-3.800"/>',
    upload: '<path d="M12 15V4M7.500 8.500L12 4l4.500 4.500"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4v11M7.500 10.500L12 15l4.500-4.500"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    link: '<rect x="3" y="8" width="10" height="8" rx="4"/><rect x="11" y="8" width="10" height="8" rx="4"/>',
    refresh: '<path d="M20 12a8 8 0 0 1-14 5.300M4 12a8 8 0 0 1 14-5.300"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="10.500" cy="10.500" r="6.500"/><path d="M15.500 15.500L21 21"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5M13 5l-2 14"/>',
    bookmark: '<path d="M7 3h10v18l-5-4-5 4z"/>',
    printer: '<path d="M7 9V4h10v5"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    cube: '<path d="M12 3l8 4.500v9L12 21l-8-4.500v-9z"/><path d="M4 7.500l8 4.500 8-4.500M12 12v9"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v3M20 12v2"/>',
    eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>',
    bolt: '<path d="M13 3L5 13.500h6L10 21l9-11h-6.500z"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    calendar: '<rect x="3.500" y="5" width="17" height="15.500" rx="3"/><path d="M3.500 10h17M8 3v4M16 3v4M8 14h2M14 14h2"/>',
  };
</script>

<script lang="ts">
  let { name, size = 18, stroke = 1.6, class: cls = '' }: { name: string; size?: number; stroke?: number; class?: string } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" class="shrink-0 {cls}" aria-hidden="true">
  {@html ICONS[name === 'sparkles' ? 'ask' : name] ?? ''}
</svg>
