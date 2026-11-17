<script lang="ts">
  // 3D-сеть (источник → цель), например «kierownik → punkty». Three.js грузится лениво.
  // Узлы-источники — крупные светящиеся сферы, цели — кластеры вокруг них; появление с анимацией.
  import { onDestroy, onMount } from 'svelte';
  import { fmt, type Fmt } from '../format';
  import { palette } from './theme';

  let { rows = [], source, target, value, group = 'managers', format = 'pln', height = 420 }:
    { rows: Record<string, any>[]; source: string; target: string; value: string; group?: string; format?: Fmt; height?: number } = $props();

  let host: HTMLDivElement;
  let tip = $state<{ x: number; y: number; text: string } | null>(null);
  let labels = $state<{ x: number; y: number; text: string; color: string; show: boolean }[]>([]);
  let cleanup: (() => void) | null = null;

  onMount(() => {
    let disposed = false;
    (async () => {
      const THREE = await import('three');
      if (disposed) return;
      const pal = palette(group);
      const W = () => host.clientWidth, H = () => host.clientHeight;

      // данные
      const links = rows.map((r) => ({ s: String(r[source]), t: String(r[target]), v: Math.max(Number(r[value]) || 0, 0) }));
      const srcNames = [...new Set(links.map((l) => l.s))];
      const tgtNames = [...new Set(links.map((l) => l.t))].filter((t) => !srcNames.includes(t));
      const weight = new Map<string, number>();
      links.forEach((l) => { weight.set(l.s, (weight.get(l.s) ?? 0) + l.v); weight.set(l.t, (weight.get(l.t) ?? 0) + l.v); });
      const wmax = Math.max(1, ...weight.values());

      // раскладка: источники по сфере Фибоначчи, цели — облаком вокруг своих источников
      const R = 70;
      const pos = new Map<string, InstanceType<typeof THREE.Vector3>>();
      srcNames.forEach((nm, i) => {
        const k = srcNames.length === 1 ? 0 : i / (srcNames.length - 1);
        const phi = Math.acos(1 - 2 * (srcNames.length === 1 ? 0.5 : k));
        const th = Math.PI * (1 + Math.sqrt(5)) * i;
        pos.set(nm, new THREE.Vector3(R * Math.cos(th) * Math.sin(phi), R * Math.cos(phi) * 0.75, R * Math.sin(th) * Math.sin(phi)));
      });
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
      tgtNames.forEach((t) => {
        const ss = links.filter((l) => l.t === t).map((l) => pos.get(l.s)!).filter(Boolean);
        const c = ss.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(ss.length, 1));
        const dir = c.clone().normalize();
        pos.set(t, c.clone().add(dir.multiplyScalar(26)).add(new THREE.Vector3(rnd() * 34, rnd() * 34, rnd() * 34)));
      });

      // сцена
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(W(), H());
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0a0a0b, 160, 360);
      const camera = new THREE.PerspectiveCamera(45, W() / H(), 1, 1000);
      camera.position.set(0, 40, 230);
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(80, 120, 100); scene.add(dl);
      const world = new THREE.Group(); scene.add(world);

      // glow-текстура
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g2 = cv.getContext('2d')!; const grd = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g2.fillStyle = grd; g2.fillRect(0, 0, 64, 64);
      const glowTex = new THREE.CanvasTexture(cv);

      type N = { name: string; mesh: InstanceType<typeof THREE.Mesh>; target: InstanceType<typeof THREE.Vector3>; delay: number; src: boolean; color: string };
      const nodes: N[] = [];
      const sphere = new THREE.SphereGeometry(1, 28, 20);
      const colorOf = new Map<string, string>();
      srcNames.forEach((nm, i) => colorOf.set(nm, pal[i % pal.length]));
      [...srcNames, ...tgtNames].forEach((nm, i) => {
        const src = srcNames.includes(nm);
        const owner = src ? nm : links.find((l) => l.t === nm)?.s ?? '';
        const color = src ? colorOf.get(nm)! : colorOf.get(owner) ?? pal[1];
        const r = src ? 3.5 + Math.sqrt((weight.get(nm) ?? 0) / wmax) * 7 : 1.1 + Math.sqrt((weight.get(nm) ?? 0) / wmax) * 3.2;
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: src ? 0.45 : 0.25, roughness: 0.35, metalness: 0.2, transparent: true, opacity: src ? 1 : 0.85 });
        const mesh = new THREE.Mesh(sphere, mat);
        mesh.scale.setScalar(0.001);
        mesh.userData = { name: nm, r, value: weight.get(nm) ?? 0 };
        if (src) {
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
          glow.scale.setScalar(5.5); mesh.add(glow);
        }
        world.add(mesh);
        nodes.push({ name: nm, mesh, target: pos.get(nm)!, delay: src ? i * 0.08 : 0.35 + (i / Math.max(tgtNames.length, 1)) * 0.9, src, color });
      });

      // рёбра (градиент цвета источник → цель)
      const lineGeo = new THREE.BufferGeometry();
      const lp = new Float32Array(links.length * 6); const lc = new Float32Array(links.length * 6);
      lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
      links.forEach((l, i) => {
        const a = new THREE.Color(colorOf.get(l.s) ?? pal[0]); const b = new THREE.Color(colorOf.get(l.s) ?? pal[0]).lerp(new THREE.Color('#ffffff'), 0.4);
        lc.set([a.r, a.g, a.b, b.r, b.g, b.b], i * 6);
      });
      const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
      world.add(new THREE.LineSegments(lineGeo, lineMat));

      // управление: перетаскивание, колесо, автоповорот
      let rotY = 0.6, rotX = 0.18, vy = 0.0016, dragging = false, px = 0, py = 0, dist = 230, idle = 0;
      const el = renderer.domElement;
      el.style.cursor = 'grab';
      const down = (e: PointerEvent) => { dragging = true; px = e.clientX; py = e.clientY; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; };
      const up = (e: PointerEvent) => { dragging = false; el.releasePointerCapture(e.pointerId); el.style.cursor = 'grab'; idle = performance.now(); };
      const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
      const move = (e: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        if (dragging) { rotY += (e.clientX - px) * 0.006; rotX = Math.max(-1.1, Math.min(1.1, rotX + (e.clientY - py) * 0.004)); px = e.clientX; py = e.clientY; return; }
        mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObjects(nodes.map((n) => n.mesh), false)[0];
        tip = hit ? { x: e.clientX - rect.left, y: e.clientY - rect.top, text: `${hit.object.userData.name} · ${fmt(hit.object.userData.value, format, true)}` } : null;
      };
      const wheel = (e: WheelEvent) => { e.preventDefault(); dist = Math.max(110, Math.min(380, dist + e.deltaY * 0.25)); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', () => (tip = null)); el.addEventListener('wheel', wheel, { passive: false });
      const ro = new ResizeObserver(() => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });
      ro.observe(host);

      const ease = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
      const t0 = performance.now();
      let raf = 0;
      const v = new THREE.Vector3();
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const t = (performance.now() - t0) / 1000;
        if (!dragging && performance.now() - idle > 2500) rotY += vy;
        world.rotation.set(rotX, rotY, 0);
        camera.position.set(0, 40 * (dist / 230), dist); camera.lookAt(0, 0, 0);
        for (const n of nodes) {
          const k = ease(Math.max(0, (t - n.delay) / 1.4));
          n.mesh.position.copy(n.target).multiplyScalar(k);
          n.mesh.scale.setScalar(Math.max(0.001, (n.mesh.userData.r as number) * ease(Math.max(0, (t - n.delay) / 0.9))));
        }
        links.forEach((l, i) => {
          const a = nodes.find((n) => n.name === l.s)?.mesh.position, b = nodes.find((n) => n.name === l.t)?.mesh.position;
          if (a && b) lp.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
        });
        lineGeo.attributes.position.needsUpdate = true;
        lineMat.opacity = Math.min(0.32, Math.max(0, (t - 0.6) * 0.3));
        renderer.render(scene, camera);
        // подписи источников
        if (Math.floor(t * 30) % 2 === 0) {
          labels = nodes.filter((n) => n.src).map((n) => {
            n.mesh.getWorldPosition(v); v.project(camera);
            return { x: (v.x * 0.5 + 0.5) * W(), y: (-v.y * 0.5 + 0.5) * H(), text: n.name, color: n.color, show: v.z < 1 && t > n.delay + 0.6 };
          });
        }
      };
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect();
        renderer.dispose(); sphere.dispose(); lineGeo.dispose(); glowTex.dispose();
        el.remove();
      };
    })();
    return () => { disposed = true; };
  });

  onDestroy(() => cleanup?.());
</script>

<div class="relative w-full overflow-hidden rounded-2xl" style="height:{height}px">
  <div bind:this={host} class="absolute inset-0"></div>
  {#each labels as l (l.text)}
    {#if l.show}
      <div class="pointer-events-none absolute -translate-x-1/2 text-[11px] font-bold whitespace-nowrap transition-opacity duration-500"
        style="left:{l.x}px; top:{l.y - 26}px; color:{l.color}; text-shadow:0 2px 8px #000">{l.text}</div>
    {/if}
  {/each}
  {#if tip}
    <div class="pointer-events-none absolute rounded-xl border border-white/10 bg-[#151517]/95 px-3 py-2 text-xs font-semibold shadow-2xl"
      style="left:{tip.x + 14}px; top:{tip.y + 10}px">{tip.text}</div>
  {/if}
  <div class="pointer-events-none absolute bottom-3 right-4 text-[11px] faint">3D · przeciągnij, aby obrócić</div>
</div>
