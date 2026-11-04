(() => {
  'use strict';
  const excluded = 'input,textarea,select,button,form,[contenteditable],[aria-hidden="true"],[data-pet-companion],[data-pet-effects],[data-pet-focus-panel]';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function inView(rect, minHeight) {
    return rect.width >= 80 && rect.height >= minHeight && rect.right > 12 && rect.left < innerWidth - 12 && rect.bottom > 48 && rect.top < innerHeight - 70;
  }
  function rectOf(element, fragmentIndex) {
    if (!element || element.isConnected === false || element.closest(excluded)) return null;
    const rect = element.getBoundingClientRect();
    const text = /^(H1|H2|H3|P)$/.test(element.tagName);
    if (!inView(rect, text ? 8 : 16)) return null;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
    if (!text || typeof document.createRange !== 'function') return rect;
    const range = document.createRange();
    try {
      range.selectNodeContents(element);
      const fragments = Array.from(range.getClientRects());
      const index = fragmentIndex ?? fragments.findIndex(fragment => inView(fragment, 8));
      const fragment = fragments[index];
      if (!fragment || !inView(fragment, 8)) return null;
      return { left: fragment.left, top: fragment.top, right: fragment.right, bottom: fragment.bottom, width: fragment.width, height: fragment.height, fragmentIndex: index };
    } catch { return null; }
    finally { range.detach?.(); }
  }
  function place(element, preferredSize = 144, anchor = { x: .5, y: .32 }) {
    const rect = rectOf(element);
    if (!rect) return null;
    const top = Math.max(48, rect.top), bottom = Math.min(rect.bottom, innerHeight - 60);
    const pawY = rect.height > 100 ? Math.min(bottom - 4, top + (bottom - top) * .62) : bottom - 3;
    const size = Math.min(preferredSize, (innerHeight - pawY - 12) / (.9375 - anchor.y), (pawY - 10) / anchor.y);
    if (!Number.isFinite(size) || size < 72 || pawY < top) return null;
    const left = Math.max(rect.left + 8, anchor.x * size + 8);
    const right = Math.min(rect.right - 8, innerWidth - (1 - anchor.x) * size - 8);
    if (right < left) return null;
    const pawX = clamp(rect.left + rect.width * .56, left, right);
    return { x: pawX - anchor.x * size, y: pawY - anchor.y * size, size, pawX, pawY };
  }
  function pickTarget({ size = 144, anchor, near = { x: innerWidth / 2, y: innerHeight / 2 }, last } = {}) {
    let best = null, score = Infinity;
    const elements = document.querySelectorAll('img,h1,h2,h3,p');
    for (let i = 0; i < Math.min(elements.length, 80); i++) {
      const element = elements[i], placement = place(element, size, anchor);
      if (!placement) continue;
      const distance = Math.hypot(placement.pawX - near.x, placement.pawY - near.y);
      const candidate = distance + (element === last ? 260 : 0) - (element.tagName === 'IMG' ? 45 : 0);
      if (candidate < score) { score = candidate; best = { element, placement }; }
    }
    return best;
  }
  function scratchPaths(seed) {
    let state = seed >>> 0;
    const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
    return [-1, 0, 1].map(claw => {
      const length = 32 + random() * 9, top = Math.abs(claw) * (2 + random() * 2);
      return Array.from({ length: 9 }, (_, i) => {
        const progress = i / 8;
        return [120 + claw * 7 - 11 * progress + Math.sin(progress * Math.PI) * 1.5 + (i && i < 8 ? (random() - .5) * .7 : 0), 120 + top + progress * length];
      });
    });
  }
  function trace(ctx, points, progress) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    let remaining = length * clamp(progress, 0, 1);
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length && remaining > 0; i++) {
      const a = points[i - 1], b = points[i], segment = Math.hypot(b[0] - a[0], b[1] - a[1]), fraction = Math.min(1, remaining / segment);
      ctx.lineTo(a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction); remaining -= segment;
    }
    ctx.stroke();
  }
  function paint(ctx, paths, progress, dpr, scale) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, 240, 240);
    ctx.save(); ctx.translate(120, 120); ctx.scale(scale, scale); ctx.translate(-120, -120);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [index, path] of paths.entries()) {
      const amount = clamp((progress - index * .035) / .93, 0, 1);
      // A shallow cut with a raised paper edge, drawn along the paw's downward sweep.
      ctx.strokeStyle = 'rgba(57,39,31,.09)'; ctx.lineWidth = 4;
      trace(ctx, path, amount);
      ctx.strokeStyle = 'rgba(57,39,31,.6)'; ctx.lineWidth = 1.35;
      trace(ctx, path, amount);
      ctx.save(); ctx.translate(1.2, .2); ctx.strokeStyle = 'rgba(255,251,240,.95)'; ctx.lineWidth = 1.25;
      trace(ctx, path, amount);
      ctx.restore();
      if (amount > .72) {
        ctx.strokeStyle = 'rgba(255,251,240,.8)'; ctx.lineWidth = .65;
        for (const i of [3, 5]) {
          const point = path[i]; ctx.beginPath(); ctx.moveTo(point[0] + 1, point[1]); ctx.lineTo(point[0] + 2.8, point[1] - 1.4); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  function createLayer() {
    let host, shadow, destroyed = false, serial = 0;
    const marks = [], reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    function remove(mark) {
      cancelAnimationFrame(mark.raf); clearTimeout(mark.hold); clearTimeout(mark.fade);
      mark.canvas.remove(); const index = marks.indexOf(mark); if (index >= 0) marks.splice(index, 1);
      if (!marks.some(item => item.element === mark.element)) resizeObserver?.unobserve(mark.element);
      if (!marks.length) { mutationObserver?.disconnect(); resizeObserver?.disconnect(); host?.remove(); host = shadow = null; }
    }
    function position(mark) {
      const rect = rectOf(mark.element, mark.fragmentIndex);
      if (!rect) { remove(mark); return; }
      const x = rect.left + mark.rx * rect.width, y = rect.top + mark.ry * rect.height;
      mark.canvas.style.transform = `translate3d(${(x - 120).toFixed(2)}px,${(y - 120).toFixed(2)}px,0)`;
    }
    const refresh = () => { for (const mark of [...marks]) position(mark); };
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
    const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => { for (const mark of [...marks]) if (!mark.element.isConnected) remove(mark); }) : null;
    document.addEventListener('scroll', refresh, { passive: true, capture: true });
    addEventListener('resize', refresh, { passive: true });
    function clear() { for (const mark of [...marks]) remove(mark); }
    return {
      strike(element, point) {
        if (destroyed) return;
        const rect = rectOf(element); if (!rect) return;
        if (marks.length === 4) remove(marks[0]);
        if (!host) {
          host = document.createElement('div'); host.dataset.petEffects = ''; host.setAttribute('aria-hidden', 'true');
          Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none', overflow: 'hidden', contain: 'strict', userSelect: 'none' });
          shadow = host.attachShadow({ mode: 'open' }); document.documentElement.append(host);
          mutationObserver?.observe(document.documentElement, { childList: true, subtree: true });
        }
        const canvas = document.createElement('canvas'); canvas.dataset.petEffect = 'paw-scratch'; canvas.width = canvas.height = 240 * dpr;
        Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '240px', height: '240px', pointerEvents: 'none', opacity: '1', transition: reduced ? 'none' : 'opacity 900ms ease-out' });
        const mark = { element, canvas, fragmentIndex: rect.fragmentIndex, rx: clamp((point.x - rect.left) / rect.width, 0, 1), ry: clamp((point.y - rect.top) / rect.height, 0, 1) };
        marks.push(mark); shadow.append(canvas); resizeObserver?.observe(element); position(mark);
        const ctx = canvas.getContext('2d'), paths = scratchPaths(++serial * 7919 + Math.round(point.x + point.y)), started = performance.now(), scale = clamp((point.size || 144) / 144, .5, 1.5);
        if (reduced) paint(ctx, paths, 1, dpr, scale);
        else {
          const grow = now => { const progress = Math.min(1, (now - started) / 260); paint(ctx, paths, progress, dpr, scale); if (progress < 1) mark.raf = requestAnimationFrame(grow); };
          mark.raf = requestAnimationFrame(grow);
        }
        mark.hold = setTimeout(() => { canvas.style.opacity = '0'; if (reduced) remove(mark); else mark.fade = setTimeout(() => remove(mark), 900); }, 6500);
      },
      clear,
      destroy() {
        if (destroyed) return; destroyed = true; clear(); resizeObserver?.disconnect(); mutationObserver?.disconnect();
        document.removeEventListener('scroll', refresh, true); removeEventListener('resize', refresh);
      }
    };
  }
  globalThis.PetMischief = { pickTarget, place, createLayer };
})();
