<script lang="ts">
  // 3D-сеть «источник → цели», например «kierownik → punkty». Three.js грузится лениво.
  // Читаемость: источники стоят по кругу (не слипаются), цели — веером наружу от своего источника,
  // подписи с подложкой и суммой, дальние подписи приглушены, при наведении подсвечивается одна группа.
  import { onDestroy, onMount } from 'svelte';
  import { fmt, type Fmt } from '../format';

  let { rows = [], source, target, value, group = 'managers', format = 'pln', height = 560 }:
    { rows: Record<string, any>[]; source: string; target: string; value: string; group?: string; format?: Fmt; height?: number } = $props();

  type Label = { x: number; y: number; name: string; sub: string; color: string; o: number };
  let host: HTMLDivElement;
  let tip = $state<{ x: number; y: number; title: string; sub: string } | null>(null);
  let labels = $state<Label[]>([]);
  let focus = $state<string | null>(null);
  let counts = $state({ src: 0, tgt: 0 });
  let cleanup: (() => void) | null = null;
  const COLORS = ['#ff6a3d', '#7b61ff', '#ffb020', '#e4e4e7', '#b3a5ff', '#ffa489'];

  onMount(() => {
    let disposed = false;
    (async () => {
      const THREE = await import('three');
      if (disposed) return;
      void group;
      const W = () => host.clientWidth, H = () => host.clientHeight;

      // ── данные
      const links = rows.map((r) => ({ s: String(r[source]), t: String(r[target]), v: Math.max(Number(r[value]) || 0, 0) }));
      const weight = new Map<string, number>();
      links.forEach((l) => { weight.set(l.s, (weight.get(l.s) ?? 0) + l.v); weight.set(l.t, (weight.get(l.t) ?? 0) + l.v); });
      const srcNames = [...new Set(links.map((l) => l.s))].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
      const srcSet = new Set(srcNames);
      const owner = new Map<string, string>();
      links.forEach((l) => { if (!srcSet.has(l.t) && !owner.has(l.t)) owner.set(l.t, l.s); });
      const tgtNames = [...owner.keys()];
      counts = { src: srcNames.length, tgt: tgtNames.length };
      const wmax = Math.max(1, ...srcNames.map((s) => weight.get(s) ?? 0));
      const tmax = Math.max(1, ...tgtNames.map((s) => weight.get(s) ?? 0));

      // ── раскладка: источники по кругу, цели веером наружу
      const n = srcNames.length;
      const R = n <= 1 ? 0 : Math.max(46, n * 9);
      const pos = new Map<string, InstanceType<typeof THREE.Vector3>>();
      srcNames.forEach((nm, i) => {
        const th = (i / Math.max(n, 1)) * Math.PI * 2;
        pos.set(nm, new THREE.Vector3(R * Math.cos(th), 0, R * Math.sin(th)));
      });
      for (const s of srcNames) {
        const kids = tgtNames.filter((t) => owner.get(t) === s).sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
        const c = pos.get(s)!;
        const out = n <= 1 ? new THREE.Vector3(1, 0, 0) : c.clone().normalize();
        const tan = new THREE.Vector3(-out.z, 0, out.x);
        kids.forEach((t, j) => {
          // спираль подсолнуха в плоскости (касательная × вертикаль), вынесенная наружу
          const a = j * 2.39996, rr = 7 + Math.sqrt(j + 1) * 5.2;
          pos.set(t, c.clone().add(out.clone().multiplyScalar(20 + rr * 0.55)).add(tan.clone().multiplyScalar(Math.cos(a) * rr)).add(new THREE.Vector3(0, Math.sin(a) * rr, 0)));
        });
      }
      const extent = R + 60;

      // ── сцена
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(W(), H());
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, W() / H(), 1, 2000);
      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(80, 160, 120); scene.add(dl);
      const world = new THREE.Group(); scene.add(world);

      type N = { name: string; own: string; mesh: InstanceType<typeof THREE.Mesh>; mat: InstanceType<typeof THREE.MeshStandardMaterial>; target: InstanceType<typeof THREE.Vector3>; delay: number; src: boolean; color: string; r: number; base: number };
      const nodes: N[] = [];
      const byName = new Map<string, N>();
      const sphere = new THREE.SphereGeometry(1, 28, 20);
      const colorOf = new Map<string, string>();
      srcNames.forEach((nm, i) => colorOf.set(nm, COLORS[i % COLORS.length]));
      [...srcNames, ...tgtNames].forEach((nm, i) => {
        const src = srcSet.has(nm);
        const own = src ? nm : owner.get(nm) ?? '';
        const color = colorOf.get(own) ?? COLORS[0];
        const r = src ? 4.5 + Math.sqrt((weight.get(nm) ?? 0) / wmax) * 5 : 1 + Math.sqrt((weight.get(nm) ?? 0) / tmax) * 2.4;
        const base = src ? 1 : 0.9;
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: src ? 0.35 : 0.18, roughness: 0.45, metalness: 0.1, transparent: true, opacity: base });
        const mesh = new THREE.Mesh(sphere, mat);
        mesh.scale.setScalar(0.001);
        mesh.userData = { name: nm };
        world.add(mesh);
        const node: N = { name: nm, own, mesh, mat, target: pos.get(nm)!, delay: src ? i * 0.07 : 0.5 + (srcNames.indexOf(own) / Math.max(n, 1)) * 1.2, src, color, r, base };
        nodes.push(node); byName.set(nm, node);
      });

      // ── рёбра
      const lineGeo = new THREE.BufferGeometry();
      const lp = new Float32Array(links.length * 6); const lc = new Float32Array(links.length * 6);
      lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
      const paintLines = (f: string | null) => {
        links.forEach((l, i) => {
          const k = !f || l.s === f ? 1 : 0.12;
          const c = new THREE.Color(colorOf.get(l.s) ?? COLORS[0]).multiplyScalar(k);
          lc.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
        });
        lineGeo.attributes.color.needsUpdate = true;
      };
      paintLines(null);
      const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
      world.add(new THREE.LineSegments(lineGeo, lineMat));

      // ── управление
      let rotY = 0.4, rotX = 0.62, dragging = false, moved = false, px = 0, py = 0, idle = 0;
      let dist = extent * 2.05;
      const el = renderer.domElement;
      el.style.cursor = 'grab';
      const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
      const pick = (e: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObjects(nodes.map((x) => x.mesh), false)[0];
        return { node: hit ? byName.get(hit.object.userData.name) ?? null : null, x: e.clientX - rect.left, y: e.clientY - rect.top };
      };
      let hover: string | null = null; let pinned: string | null = null;
      const setFocus = () => { const f = pinned ?? hover; if (f !== focus) { focus = f; paintLines(f); } };
      const down = (e: PointerEvent) => { dragging = true; moved = false; px = e.clientX; py = e.clientY; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; };
      const up = (e: PointerEvent) => {
        dragging = false; el.releasePointerCapture(e.pointerId); el.style.cursor = 'grab'; idle = performance.now();
        if (!moved) { const p = pick(e); pinned = p.node ? (pinned === p.node.own ? null : p.node.own) : null; setFocus(); }
      };
      const move = (e: PointerEvent) => {
        if (dragging) {
          if (Math.abs(e.clientX - px) + Math.abs(e.clientY - py) > 2) moved = true;
          rotY += (e.clientX - px) * 0.006; rotX = Math.max(0.05, Math.min(1.35, rotX + (e.clientY - py) * 0.004)); px = e.clientX; py = e.clientY; return;
        }
        const p = pick(e);
        hover = p.node?.own ?? null; setFocus();
        el.style.cursor = p.node ? 'pointer' : 'grab';
        tip = p.node ? { x: p.x, y: p.y, title: p.node.name, sub: p.node.src ? `${fmt(weight.get(p.node.name) ?? 0, format, true)} · ${tgtNames.filter((t) => owner.get(t) === p.node!.name).length} pkt` : `${fmt(weight.get(p.node.name) ?? 0, format, true)} · ${p.node.own}` } : null;
      };
      const leave = () => { tip = null; hover = null; setFocus(); };
      const wheel = (e: WheelEvent) => { e.preventDefault(); dist = Math.max(extent * 0.9, Math.min(extent * 4, dist + e.deltaY * 0.3)); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave); el.addEventListener('wheel', wheel, { passive: false });
      const ro = new ResizeObserver(() => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });
      ro.observe(host);

      const ease = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
      const t0 = performance.now();
      let raf = 0; let frame = 0;
      const v = new THREE.Vector3();
      const zero = new THREE.Vector3();
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const t = (performance.now() - t0) / 1000;
        if (!dragging && !focus && performance.now() - idle > 2500) rotY += 0.0012;
        world.rotation.set(0, rotY, 0);
        camera.position.set(0, Math.sin(rotX) * dist, Math.cos(rotX) * dist); camera.lookAt(0, -extent * 0.2, 0);
        for (const nd of nodes) {
          const k = ease(Math.max(0, (t - nd.delay) / 1.3));
          const from = nd.src ? zero : byName.get(nd.own)?.target ?? zero;
          nd.mesh.position.lerpVectors(from, nd.target, k);
          nd.mesh.scale.setScalar(Math.max(0.001, nd.r * ease(Math.max(0, (t - nd.delay) / 0.8))));
          const want = !focus || nd.own === focus ? nd.base : 0.1;
          nd.mat.opacity += (want - nd.mat.opacity) * 0.15;
        }
        links.forEach((l, i) => {
          const a = byName.get(l.s)?.mesh.position, b = byName.get(l.t)?.mesh.position;
          if (a && b) lp.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
        });
        lineGeo.attributes.position.needsUpdate = true;
        lineMat.opacity = Math.min(0.45, Math.max(0, (t - 0.7) * 0.4));
        renderer.render(scene, camera);

        // подписи источников: ближние ярче, перекрывающиеся скрываются (ближняя побеждает)
        if (frame++ % 3 === 0) {
          const items = nodes.filter((x) => x.src && t > x.delay + 0.5).map((x) => {
            x.mesh.getWorldPosition(v); const depth = v.distanceTo(camera.position); v.project(camera);
            return { x: (v.x * 0.5 + 0.5) * W(), y: (-v.y * 0.5 + 0.5) * H() - (x.r * H()) / (0.768 * depth) - 8, depth, node: x };
          }).sort((a, b) => a.depth - b.depth);
          const placed: { x: number; y: number; w: number }[] = [];
          const near = items[0]?.depth ?? 0, far = items.at(-1)?.depth ?? 1;
          const out: Label[] = [];
          for (const it of items) {
            const w = Math.max(it.node.name.length * 7.6, 90) + 22;
            const isFocus = focus === it.node.name;
            const clash = placed.some((p) => Math.abs(p.x - it.x) < (p.w + w) / 2 - 6 && Math.abs(p.y - it.y) < 38);
            if (clash && !isFocus) continue;
            placed.push({ x: it.x, y: it.y, w });
            const depthO = 1 - 0.55 * ((it.depth - near) / Math.max(far - near, 1));
            out.push({ x: it.x, y: it.y, name: it.node.name, sub: fmt(weight.get(it.node.name) ?? 0, format, true), color: it.node.color, o: focus ? (isFocus ? 1 : 0.18) : depthO });
          }
          labels = out;
        }
      };
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect();
        renderer.dispose(); sphere.dispose(); lineGeo.dispose();
        el.remove();
      };
    })();
    return () => { disposed = true; };
  });

  onDestroy(() => cleanup?.());
</script>

<div class="relative w-full overflow-hidden rounded-2xl" style="height:{height}px">
  <div bind:this={host} class="absolute inset-0"></div>
  {#each labels as l (l.name)}
    <div class="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-[#0f0f11]/85 px-2.5 py-1 text-center whitespace-nowrap transition-opacity duration-300"
      style="left:{l.x}px; top:{l.y}px; opacity:{l.o}">
      <div class="flex items-center gap-1.5 text-[13px] leading-tight font-semibold"><span class="h-2 w-2 shrink-0 rounded-full" style="background:{l.color}"></span>{l.name}</div>
      <div class="text-[12px] leading-tight text-[#a1a1aa]">{l.sub}</div>
    </div>
  {/each}
  {#if tip}
    <div class="pointer-events-none absolute z-10 rounded-xl border border-white/10 bg-[#151517]/95 px-3 py-2 shadow-2xl"
      style="left:{Math.min(tip.x + 14, (host?.clientWidth ?? 600) - 220)}px; top:{tip.y + 12}px">
      <div class="text-[13.5px] font-semibold">{tip.title}</div>
      <div class="text-[12.5px] text-[#a1a1aa]">{tip.sub}</div>
    </div>
  {/if}
  <div class="pointer-events-none absolute bottom-3 left-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[#a1a1aa]">
    <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-full bg-white/70"></span>{source.replace(/_/g, ' ')} ({counts.src})</span>
    <span class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-white/70"></span>{target.replace(/_/g, ' ')} ({counts.tgt})</span>
    <span>wielkość = {value.replace(/_/g, ' ')}</span>
  </div>
  <div class="pointer-events-none absolute right-4 bottom-3 hidden text-[12.5px] text-[#71717a] md:block">najedź lub kliknij grupę · przeciągnij, aby obrócić</div>
</div>
