import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/extension/pet-mischief.js', import.meta.url), 'utf8');
function harness({ reduced = false, width = 1000, height = 800, withRange = false } = {}) {
  let now = 0, nextId = 0, resizeCallback, mutationCallback;
  const frames = new Map(), timers = new Map(), events = new Map(), rootChildren = [], candidates = [], paints = [], fragments = new Map();
  const observerState = { observing: false, observes: 0, disconnects: 0 };
  const root = { append(node) { rootChildren.push(node); node.parent = root; }, children: rootChildren };
  function node(tag) {
    const value = { tagName: tag.toUpperCase(), dataset: {}, style: {}, attributes: {}, children: [],
      append(child) { this.children.push(child); child.parent = this; },
      setAttribute(name, value) { this.attributes[name] = value; },
      attachShadow() { this.shadowRoot = node('shadow'); return this.shadowRoot; },
      remove() { const collection = this.parent?.children; if (collection) { const index = collection.indexOf(this); if (index >= 0) collection.splice(index, 1); } },
      getContext() { return new Proxy({}, { set(target, key, value) { target[key] = value; return true; }, get(target, key) { return target[key] || ((...args) => paints.push({ key, args })); } }); }
    };
    return value;
  }
  const document = {
    documentElement: root,
    querySelectorAll(selector) { assert.equal(selector, 'img,h1,h2,h3,p'); return candidates; },
    createElement: node,
    addEventListener(type, fn) { events.set(type, fn); }, removeEventListener(type) { events.delete(type); },
    getSelection() { throw new Error('must not alter document selection'); }
  };
  if (withRange) document.createRange = () => {
    let selected;
    return { selectNodeContents(element) { selected = element; }, getClientRects() { return fragments.get(selected) || []; }, detach() {} };
  };
  const context = vm.createContext({...configGlobals(),
    document, innerWidth: width, innerHeight: height, devicePixelRatio: 3,
    performance: { now: () => now }, matchMedia: () => ({ matches: reduced }), getComputedStyle: () => ({ opacity: '1', visibility: 'visible', display: 'block' }),
    addEventListener(type, fn) { events.set(type, fn); }, removeEventListener(type) { events.delete(type); },
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    ResizeObserver: class { constructor(fn) { resizeCallback = fn; } observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(fn) { mutationCallback = fn; } observe() { observerState.observing = true; observerState.observes++; } disconnect() { observerState.observing = false; observerState.disconnects++; } }
  });
  vm.runInContext(source, context);
  function target(rect, { tag = 'P', excluded = false, lines } = {}) {
    let current = rect;
    const element = { tagName: tag, isConnected: true, closest: () => excluded, getBoundingClientRect: () => current };
    for (const key of ['textContent', 'value', 'src', 'style']) Object.defineProperty(element, key, { get() { throw new Error(`must not read ${key}`); }, set() { throw new Error(`must not write ${key}`); } });
    candidates.push(element);
    if (lines) fragments.set(element, lines);
    return { element, move(rect) { current = rect; } };
  }
  async function advance(ms) {
    now += ms;
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now));
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }
  return { api: context.PetMischief, target, frames, timers, paints, rootChildren, events, observerState, advance, resize: () => resizeCallback?.(), mutate: () => mutationCallback?.() };
}
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('scratch placement keeps paws inside visible content and hind feet in the viewport without reading content', () => {
  const app = harness({ width: 390, height: 600 });
  const text = app.target(rect(20, 300, 350, 28));
  const placement = app.api.place(text.element, 170, { x: .5, y: .3 });
  assert.ok(placement.pawX > 20 && placement.pawX < 370);
  assert.ok(placement.pawY >= 300 && placement.pawY <= 328);
  assert.ok(placement.y >= 10 && placement.y + placement.size * .9375 <= 588.01);
  assert.equal(placement.y + placement.size * .3, placement.pawY);
  assert.equal(app.api.place(app.target(rect(5, 575, 370, 20)).element, 170), null);
});

test('target selection skips hidden geometry, controls and previous target when another nearby target exists', () => {
  const app = harness();
  app.target(rect(10, -90, 300, 20));
  app.target(rect(30, 220, 400, 30), { excluded: true });
  const previous = app.target(rect(100, 200, 300, 25));
  const image = app.target(rect(120, 250, 320, 180), { tag: 'IMG' });
  const chosen = app.api.pickTarget({ size: 144, near: { x: 250, y: 280 }, last: previous.element });
  assert.equal(chosen.element, image.element);
});

test('text contact uses a visible text fragment rather than the empty part of a wide paragraph', () => {
  const app = harness({ withRange: true });
  const text = app.target(rect(40, 180, 850, 60), { lines: [rect(40, 180, 168, 14), rect(40, 205, 120, 14)] });
  const placement = app.api.place(text.element, 144);
  assert.ok(placement.pawX >= 40 && placement.pawX <= 208);
  assert.ok(placement.pawY >= 180 && placement.pawY <= 194);
  const tooShort = app.target(rect(40, 280, 850, 30), { lines: [rect(40, 280, 35, 14)] });
  assert.equal(app.api.place(tooShort.element, 144), null, 'do not fall back to blank block space when no text fragment fits');
  const image = app.target(rect(400, 300, 250, 180), { tag: 'IMG' });
  assert.ok(app.api.place(image.element, 144), 'images continue to use their element geometry');
});

test('scratches use only owned pointer-transparent nodes, is capped, follows geometry and cleans up all work', async () => {
  const app = harness(), target = app.target(rect(100, 200, 400, 100)), layer = app.api.createLayer();
  assert.equal(app.observerState.observing, false, 'no page mutation observation before the first mark');
  for (let i = 0; i < 5; i++) layer.strike(target.element, { x: 220 + i, y: 250 });
  assert.equal(app.rootChildren.length, 1);
  const host = app.rootChildren[0], canvases = host.shadowRoot.children;
  assert.equal(host.style.pointerEvents, 'none'); assert.equal(host.attributes['aria-hidden'], 'true');
  assert.equal(canvases.length, 4);
  assert.equal(app.observerState.observing, true);
  assert.ok(canvases.every(canvas => canvas.style.pointerEvents === 'none' && canvas.width === 480));
  const before = canvases[0].style.transform;
  target.move(rect(100, 150, 400, 100)); app.events.get('scroll')();
  assert.notEqual(canvases[0].style.transform, before);
  await app.advance(300);
  assert.equal(app.frames.size, 0, 'static cracks have no rendering loop');
  assert.ok(app.paints.some(operation => operation.key === 'stroke'));
  layer.clear();
  assert.equal(app.rootChildren.length, 0); assert.equal(app.frames.size, 0); assert.equal(app.timers.size, 0);
  assert.equal(app.observerState.observing, false);
  layer.strike(target.element, { x: 250, y: 190 }); assert.equal(app.rootChildren.length, 1);
  assert.equal(app.observerState.observing, true);
  layer.destroy(); assert.equal(app.rootChildren.length, 0); assert.equal(app.events.size, 0);
  layer.strike(target.element, { x: 250, y: 190 }); assert.equal(app.rootChildren.length, 0);
});

test('reduced motion draws once, and expiry or a removed target clears its patch', async () => {
  const app = harness({ reduced: true }), target = app.target(rect(100, 200, 400, 100)), layer = app.api.createLayer();
  layer.strike(target.element, { x: 240, y: 230 });
  assert.equal(app.frames.size, 0); assert.ok(app.paints.length > 0);
  await app.advance(6500); assert.equal(app.rootChildren.length, 0);
  layer.strike(target.element, { x: 240, y: 230 }); target.element.isConnected = false; app.mutate();
  assert.equal(app.rootChildren.length, 0); assert.equal(app.timers.size, 0);
  layer.destroy();
});

test('ordinary scratches fade and remove themselves within eight seconds without polling', async () => {
  const app = harness(), target = app.target(rect(100, 200, 400, 100)), layer = app.api.createLayer();
  layer.strike(target.element, { x: 240, y: 230 });
  await app.advance(300); assert.equal(app.frames.size, 0);
  const canvas = app.rootChildren[0].shadowRoot.children[0];
  await app.advance(6200); assert.equal(canvas.style.opacity, '0');
  await app.advance(900); assert.equal(app.rootChildren.length, 0); assert.equal(app.timers.size, 0);
  layer.destroy();
});
