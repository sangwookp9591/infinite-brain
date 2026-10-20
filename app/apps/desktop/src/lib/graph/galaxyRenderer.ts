// SPDX-License-Identifier: Apache-2.0
// Independent implementation inspired by dgreenheck/webgpu-galaxy (MIT):
// instanced billboards, additive dust and bloom; no upstream source is copied.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, uv, pass, positionView, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GALAXY_RADIUS, recentBrightness, starRandom } from './galaxyLayout';

export interface GalaxyNode {
  id: string;
  title: string;
  path: string;
  x: number;
  y: number;
  r: number;
  color: [number, number, number];
  modified?: number;
  /** File size in bytes, when the tree knows it: sets the star's temperature. */
  size?: number;
  z?: number;
  core?: boolean;
  arm?: number;
  arms?: number;
  dim?: number;
}
interface Callbacks {
  hover: (node: GalaxyNode | null, x: number, y: number) => void;
  open: (node: GalaxyNode) => void;
  fail: (error: unknown) => void;
}

// Opacity falloffs over `d`, the distance from the sprite centre (0 centre, 1 edge).
type Distance = ReturnType<typeof unitDistance>;
const unitDistance = () => uv().sub(0.5).length().mul(2);
/** Note stars: a bright spike core over a soft halo. */
const spike = (d: Distance) => d.mul(-6).exp().add(d.mul(-32).exp().mul(3)).mul(d.oneMinus().max(0));
/** Nebula dust: wide and faint. */
const haze = (d: Distance) => d.pow(2).mul(-5).exp().mul(d.oneMinus().max(0)).mul(0.045);
/** Dark dust lanes. */
const lane = (d: Distance) => d.pow(2).mul(-7).exp().mul(0.2);
/** Backdrop stars: plain soft dots with no spike, so only notes glow. */
const dot = (d: Distance) => d.mul(-5).exp().mul(d.oneMinus().max(0));

function particles(count: number, shape: (d: Distance) => ReturnType<typeof spike> = spike) {
  const positions = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const sizes = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  positions.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  sizes.setUsage(THREE.DynamicDrawUsage);
  const material = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  material.positionNode = instancedBufferAttribute(positions, 'vec3');
  material.colorNode = instancedBufferAttribute<'vec3'>(colors, 'vec3').mul(float(3000).div(positionView.z.negate().max(500)).pow(0.7).clamp(0.2, 1.5));
  material.scaleNode = instancedBufferAttribute<'float'>(sizes, 'float');
  material.opacityNode = shape(unitDistance());
  const sprite = new THREE.Sprite(material);
  // Sprite shares a quad globally; filter rebuilds must only dispose their own geometry.
  sprite.geometry = sprite.geometry.clone();
  sprite.count = count;
  sprite.frustumCulled = false;
  return { sprite, positions, colors, sizes, dispose() {
    sprite.geometry.dispose(); material.dispose();
  } };
}
type Particles = ReturnType<typeof particles>;
/** Signals drawn at once in the Neuron theme; the rest of the links stay still. */
const SIGNALS = 420;

function mixRgb(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

export class GalaxyRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 1, 50000);
  readonly controls: OrbitControls;
  readonly backend: string;
  private pipeline: THREE.RenderPipeline;
  private scenePass: ReturnType<typeof pass>;
  private bloomPass: ReturnType<typeof bloom>;
  private stars: Particles | null = null;
  private dust = particles(1100, haze);
  private lanes = particles(500, lane);
  private background = particles(1600, dot);
  private dustGroup = new THREE.Group();
  private lines = new LineSegments2(new LineSegmentsGeometry(), new THREE.Line2NodeMaterial({
    transparent: true, opacity: 0.085, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  private rays = new LineSegments2(new LineSegmentsGeometry(), new THREE.Line2NodeMaterial({
    transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  private nodes: GalaxyNode[] = [];
  private lookup = new Map<string, number>();
  private projected = new Float32Array(0);
  private width = 1;
  private height = 1;
  private selected = -1;
  private pointerMoved = false;
  private pointerStart: { x: number; y: number } | null = null;
  private flight: { start: number; from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; node: GalaxyNode } | null = null;
  private disposed = false;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private vector = new THREE.Vector3();
  private lastHover: string | null = null;
  private dirty = true;
  private edgeArray = new Float32Array(0);
  private rayArray = new Float32Array(0);
  private labelScale = 0;
  private labelLayer = document.createElement('div');
  private labels = Array.from({ length: 12 }, () => document.createElement('span'));
  private pendingPointer: { x: number; y: number } | null = null;
  /** Space: stars and nebulae. Neuron: cells, bright axons and signals that
   *  travel along the links (`setTheme`). */
  private theme: 'space' | 'neuron' = 'space';
  private spaceBackground = new THREE.Color('#070b1d');
  private spaceEdge = new THREE.Color('#779acb');
  /** One signal per sampled link, gliding from source to target. */
  private signals = particles(SIGNALS, spike);
  private signalEdges = new Uint32Array(SIGNALS);

  static async create(host: HTMLElement, input: HTMLCanvasElement, callbacks: Callbacks, forceWebGL = false) {
    const canvas = document.createElement('canvas');
    canvas.className = 'graph-galaxy-canvas';
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, forceWebGL });
    try {
      await renderer.init();
      const galaxy = new GalaxyRenderer(renderer, input, callbacks);
      host.append(canvas, galaxy.labelLayer);
      return galaxy;
    } catch (error) {
      renderer.dispose(); canvas.remove(); throw error;
    }
  }

  private constructor(private renderer: THREE.WebGPURenderer, private input: HTMLCanvasElement, private callbacks: Callbacks) {
    this.backend = 'isWebGLBackend' in renderer.backend ? 'WebGL2' : 'WebGPU';
    // Colours come from the --graph-* tokens (graph.css), so the scene follows
    // the app palette. The canvas is opaque (alpha:false): the CSS starfield
    // behind it never shows, so the clear colour must match it.
    const graphStyle = getComputedStyle(input);
    const token = (name: string, fallback: string) => graphStyle.getPropertyValue(name).trim() || fallback;
    this.spaceBackground.set(token('--graph-space-core', '#070b1d'));
    this.spaceEdge.set(token('--graph-edge', '#779acb'));
    this.scene.background = this.spaceBackground.clone();
    this.lines.material.color.copy(this.spaceEdge);
    this.rays.material.color.set(token('--graph-ray', '#c2ddff'));
    renderer.onDeviceLost = (info) => { if (!this.disposed) callbacks.fail(new Error(info.message)); };
    renderer.onError = (message) => { if (!this.disposed) callbacks.fail(new Error(String(message))); };
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera.position.set(0, -650, 2100);
    this.controls = new OrbitControls(this.camera, input);
    this.controls.enableDamping = !this.motion.matches;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 35;
    this.controls.maxDistance = 20000;
    this.controls.addEventListener('change', this.markDirty);
    this.controls.addEventListener('start', this.cancelFlight);
    this.motion.addEventListener('change', this.motionChange);
    this.scene.add(this.lines, this.rays, this.background.sprite, this.dustGroup, this.signals.sprite);
    this.signals.sprite.visible = false;
    this.signals.sprite.count = 0;
    this.dustGroup.add(this.dust.sprite, this.lanes.sprite);
    this.lanes.sprite.material.blending = THREE.NormalBlending;
    this.lanes.sprite.renderOrder = 2;
    this.makeSpace();
    this.labelLayer.className = 'graph-galaxy-labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    this.labelLayer.append(...this.labels);
    this.scenePass = pass(this.scene, this.camera);
    this.bloomPass = bloom(this.scenePass.getTextureNode(), 0.7, 0.55, 0.8);
    this.bloomPass.setResolutionScale(0.5);
    this.pipeline = new THREE.RenderPipeline(renderer, this.scenePass.add(this.bloomPass));
    input.addEventListener('pointerdown', this.pointerDown);
    input.addEventListener('pointermove', this.pointerMove);
    input.addEventListener('pointerup', this.pointerUp);
    input.addEventListener('pointercancel', this.pointerCancel);
    input.addEventListener('pointerleave', this.pointerLeave);
    input.addEventListener('keydown', this.keyDown);
  }

  private markDirty = () => { this.dirty = true; };
  private cancelFlight = () => { this.flight = null; };
  private motionChange = () => { this.controls.enableDamping = !this.motion.matches; this.dirty = true; };

  private makeSpace() {
    let seed = 8127;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < this.background.sprite.count; i++) {
      const angle = random() * Math.PI * 2;
      const z = random() * 2 - 1;
      const radius = 8500;
      this.background.positions.setXYZ(i, Math.cos(angle) * Math.sqrt(1 - z * z) * radius, Math.sin(angle) * Math.sqrt(1 - z * z) * radius, z * radius);
      // Faint enough to stay under the 0.8 bloom threshold in the constructor: only notes glow.
      const light = 0.2 + random() * 0.15;
      this.background.colors.setXYZ(i, light * 0.85, light * 0.92, light);
      this.background.sizes.setX(i, 3 + random() * 5);
    }
    for (let i = 0; i < this.dust.sprite.count; i++) this.dust.sizes.setX(i, 0.12 + random() * 0.22);
  }

  /** Switch the look without rebuilding the scene. Neuron hides the starfield
   *  and nebulae, darkens the space, brightens the links into axons and sends
   *  signals along them (still when the system asks for reduced motion). */
  setTheme(theme: 'space' | 'neuron') {
    if (theme === this.theme) return;
    this.theme = theme;
    const neuron = theme === 'neuron';
    this.background.sprite.visible = !neuron;
    this.dustGroup.visible = !neuron && this.nodes.length > 0;
    (this.scene.background as THREE.Color).set(neuron ? '#03050b' : this.spaceBackground);
    this.lines.material.color.set(neuron ? '#4fd8ff' : this.spaceEdge);
    this.signals.sprite.visible = neuron;
    this.dirty = true;
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.dirty = true;
  }

  setData(nodes: GalaxyNode[], edges: ReadonlyArray<{ source: string; target: string }>, fit: boolean, edgeThickness: number, labelScale: number) {
    if (!this.stars || nodes.length !== this.stars.sprite.count) {
      if (this.stars) { this.scene.remove(this.stars.sprite); this.stars.dispose(); }
      this.stars = particles(Math.max(1, nodes.length));
      this.stars.sprite.count = nodes.length;
      this.scene.add(this.stars.sprite);
      this.projected = new Float32Array(nodes.length * 3);
    }
    this.nodes = nodes;
    this.labelScale = labelScale;
    this.lookup.clear();
    const now = Date.now();
    const sparseScale = Math.max(1, Math.min(3, Math.sqrt(3000 / Math.max(1, nodes.length))));
    // A small vault's notes are a handful of points on a full-size galaxy: draw
    // them larger so each reads as a star, without brightening them (brightness
    // is what the bloom turns into a blob). Fades out by 300 notes.
    const fewNotes = 1 + 1.4 * Math.max(0, 1 - nodes.length / 300);
    const nebulaDensity = Math.min(1, Math.max(0.3, Math.sqrt(nodes.length / 2000)));
    // Each note's place among this vault's file sizes, 0 (smallest) to 1.
    const sized = nodes.filter((node) => node.size !== undefined).map((node) => node.size!).sort((a, b) => a - b);
    const sizeRank = (size: number | undefined) => {
      if (size === undefined || sized.length < 2) return 0.5;
      let lo = 0, hi = sized.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sized[mid] < size) lo = mid + 1; else hi = mid; }
      return lo / (sized.length - 1);
    };
    nodes.forEach((node, i) => {
      this.lookup.set(node.id, i);
      const z = node.z ?? 0;
      this.stars!.positions.setXYZ(i, node.x, -node.y, z);
      const light = recentBrightness(node.modified, now);
      const radius = Math.hypot(node.x, node.y);
      const variation = 0.45 + starRandom(node.id + ':light') ** 3 * 1.4;
      const dim = node.dim ?? 1;
      const intensity = light * variation * Math.sqrt(sparseScale) * (node.core ? 1.5 : 0.85) * dim * (1 - radius / 2500);
      // Hue from the note's folder colour (the graph's own colouring), kept
      // saturated; temperature from its file size, like a real star: small
      // notes burn orange, mid-sized white, the largest blue.
      const rank = sizeRank(node.size);
      const temperature = rank < 0.5
        ? mixRgb([1, 0.58, 0.38], [1, 0.95, 0.88], rank * 2)
        : mixRgb([1, 0.95, 0.88], [0.66, 0.8, 1], (rank - 0.5) * 2);
      for (let channel = 0; channel < 3; channel++) {
        const hue = node.color[channel] * 0.8 + 0.2;
        this.stars!.colors.setComponent(i, channel, (hue * 0.62 + temperature[channel] * 0.38) * intensity);
      }
      this.stars!.sizes.setX(i, (5 + node.r * 2.5) * sparseScale * fewNotes * Math.sqrt(light * variation) * (0.85 + rank * 0.4) * (node.core ? 1.2 : 1));
    });
    this.dustGroup.visible = nodes.length > 0 && this.theme === 'space';
    // Nebula: a warm glow at the core, then soft clouds tinted by the folder
    // colour of the notes they gather around, so each cluster has its own haze.
    // No spiral and no dust lanes.
    const outer = nodes.filter((node) => !node.core);
    for (let i = 0; i < this.dust.sprite.count; i++) {
      const host = outer.length ? outer[(i * 7919) % outer.length] : undefined;
      if (i < 180 || !host) {
        const radius = 170 * Math.sqrt((i % 180) / 180);
        const angle = i * 2.399963;
        this.dust.positions.setXYZ(i, Math.cos(angle) * radius, -Math.sin(angle) * radius, -20);
        this.dust.colors.setXYZ(i, 0.85 * nebulaDensity, 0.45 * nebulaDensity, 0.17 * nebulaDensity);
        this.dust.sizes.setX(i, 250);
        continue;
      }
      const jitter = 60 + starRandom(`dust:${i}:r`) * 170, angle = starRandom(`dust:${i}:a`) * Math.PI * 2;
      this.dust.positions.setXYZ(i, host.x + Math.cos(angle) * jitter, -(host.y + Math.sin(angle) * jitter), -20);
      const tint = 0.32 * nebulaDensity;
      this.dust.colors.setXYZ(i, host.color[0] * tint, host.color[1] * tint, host.color[2] * tint);
      this.dust.sizes.setX(i, 150 + starRandom(`dust:${i}:s`) * 140);
    }
    this.lanes.sprite.visible = false;
    this.dust.positions.needsUpdate = this.dust.colors.needsUpdate = this.dust.sizes.needsUpdate = true;
    this.lanes.positions.needsUpdate = this.lanes.colors.needsUpdate = this.lanes.sizes.needsUpdate = true;
    this.stars.positions.needsUpdate = this.stars.colors.needsUpdate = this.stars.sizes.needsUpdate = true;
    if (nodes.length && fit) {
      const distance = GALAXY_RADIUS * 2.45 / Math.min(1, this.camera.aspect);
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(0, -distance * Math.sin(Math.PI / 3), distance * Math.cos(Math.PI / 3));
      this.camera.lookAt(this.controls.target);
    }
    // LOD caps only distant background links; every note and selected link survives.
    const step = Math.max(1, Math.ceil(edges.length / 18000));
    const maxEdges = Math.ceil(edges.length / step);
    if (this.edgeArray.length !== maxEdges * 6) {
      this.edgeArray = new Float32Array(maxEdges * 6);
      this.lines.geometry.dispose(); this.lines.geometry = new LineSegmentsGeometry();
      if (this.edgeArray.length) this.lines.geometry.setPositions(this.edgeArray);
    }
    this.selected = this.lastHover ? this.lookup.get(this.lastHover) ?? -1 : -1;
    const selectedId = nodes[this.selected]?.id;
    const rays: number[] = [];
    let offset = 0;
    edges.forEach((edge, i) => {
      const a = this.lookup.get(edge.source), b = this.lookup.get(edge.target);
      if (a === undefined || b === undefined) return;
      if (i % step === 0) {
        for (const index of [a, b]) for (let axis = 0; axis < 3; axis++) this.edgeArray[offset++] = this.stars!.positions.array[index * 3 + axis];
      }
      if (edge.source === selectedId || edge.target === selectedId) {
        for (const index of [a, b]) for (let axis = 0; axis < 3; axis++) rays.push(this.stars!.positions.array[index * 3 + axis]);
      }
    });
    const attribute = this.lines.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute | undefined;
    if (attribute) attribute.data.needsUpdate = true;
    this.lines.geometry.instanceCount = offset / 6;
    this.lines.visible = offset > 0;
    this.lines.material.linewidth = edgeThickness;
    this.rays.material.linewidth = edgeThickness * 1.2;
    this.lines.frustumCulled = false;
    const edgeOpacity = Math.min(0.22, edgeThickness * 0.023) * Math.min(1, 1200 / Math.max(1, nodes.length));
    // Neuron: links are the subject, so brighter, but thinned as they multiply
    // so a large vault reads as a network rather than a hairball.
    this.lines.material.opacity = this.theme === 'neuron'
      ? Math.min(0.55, edgeOpacity * 3.2 + 0.08 * Math.min(1, 300 / Math.max(1, nodes.length)))
      : edgeOpacity;
    // Spread the signals evenly over the links this frame draws.
    const links = offset / 6;
    this.signals.sprite.count = Math.min(SIGNALS, links);
    for (let i = 0; i < this.signals.sprite.count; i++) {
      this.signalEdges[i] = Math.floor((i + 0.5) * links / this.signals.sprite.count);
      this.signals.sizes.setX(i, 9 + starRandom('signal:' + i) * 8);
      const hue = starRandom('signal-hue:' + i);
      this.signals.colors.setXYZ(i, 0.55 + hue * 0.45, 0.9, 1.6 - hue * 0.4);
    }
    this.signals.sizes.needsUpdate = this.signals.colors.needsUpdate = true;
    if (this.rayArray.length !== rays.length) {
      this.rayArray = new Float32Array(rays.length);
      this.rays.geometry.dispose(); this.rays.geometry = new LineSegmentsGeometry();
      if (this.rayArray.length) this.rays.geometry.setPositions(this.rayArray);
    }
    this.rayArray.set(rays);
    const rayAttribute = this.rays.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute | undefined;
    if (rayAttribute) rayAttribute.data.needsUpdate = true;
    this.rays.geometry.instanceCount = rays.length / 6;
    this.rays.visible = rays.length > 0;
    this.rays.frustumCulled = false;
    this.dirty = true;
  }

  /** Each signal runs its link source → target in ~1.6 s, staggered. Reduced
   *  motion parks them mid-link: the axons still read as live, nothing moves. */
  private moveSignals(now: number) {
    const still = this.motion.matches;
    for (let i = 0; i < this.signals.sprite.count; i++) {
      const base = this.signalEdges[i] * 6;
      const t = still ? 0.5 : ((now / 1600) + starRandom('signal-phase:' + i)) % 1;
      const ease = t * t * (3 - 2 * t);
      for (let axis = 0; axis < 3; axis++) {
        const a = this.edgeArray[base + axis], b = this.edgeArray[base + 3 + axis];
        this.signals.positions.setComponent(i, axis, a + (b - a) * ease);
      }
    }
    this.signals.positions.needsUpdate = true;
    if (!still) this.dirty = true;
  }

  render() {
    if (this.disposed) return;
    const now = performance.now();
    this.controls.update();
    if (this.flight) {
      const f = this.flight;
      const progress = this.motion.matches ? 1 : Math.min(1, (now - f.start) / 650);
      const eased = progress * progress * (3 - 2 * progress);
      this.camera.position.lerpVectors(f.from, f.to, eased);
      this.controls.target.lerp(f.target, 0.18);
      this.camera.lookAt(this.controls.target);
      this.dirty = true;
      if (progress === 1) { this.flight = null; this.callbacks.open(f.node); }
    }
    if (this.pendingPointer && !this.pointerStart) {
      const { x, y } = this.pendingPointer;
      this.pendingPointer = null;
      this.hover(this.pick(x, y), x, y);
    }
    if (this.theme === 'neuron' && this.signals.sprite.count > 0) this.moveSignals(now);
    if (!this.dirty) return;
    this.dirty = false;
    this.camera.updateMatrixWorld();
    this.project();
    this.paintLabels();
    try {
      this.pipeline.render();
      if (import.meta.env.DEV) {
        this.renderer.domElement.dataset.backend = this.backend;
        this.renderer.domElement.dataset.nodes = String(this.nodes.length);
        this.renderer.domElement.dataset.highlightLinks = String(this.rays.geometry.instanceCount);
        this.renderer.domElement.dataset.frame = String(now);
      }
    }
    catch (error) { this.callbacks.fail(error); }
  }


  private project() {
    if (!this.stars) return;
    for (let i = 0; i < this.nodes.length; i++) {
      this.vector.fromArray(this.stars.positions.array, i * 3).project(this.camera);
      this.projected[i * 3] = (this.vector.x + 1) * this.width / 2;
      this.projected[i * 3 + 1] = (1 - this.vector.y) * this.height / 2;
      this.projected[i * 3 + 2] = this.vector.z;
    }
  }

  private paintLabels() {
    let shown = 0;
    const placed: { x: number; y: number }[] = [];
    const scale = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(23)) * this.camera.position.distanceTo(this.controls.target));
    for (let i = 0; i < this.nodes.length && shown < this.labels.length; i++) {
      if (this.nodes[i].r * scale * this.labelScale < 3) continue;
      const x = this.projected[i * 3], y = this.projected[i * 3 + 1];
      if (Math.abs(this.projected[i * 3 + 2]) > 1 || x < 8 || x > this.width - 150 || y < 100 || y > this.height - 60) continue;
      if (placed.some((p) => Math.abs(p.x - x) < 150 && Math.abs(p.y - y) < 28)) continue;
      const label = this.labels[shown++];
      label.textContent = this.nodes[i].title;
      label.style.transform = `translate(${Math.round(x + 10)}px, ${Math.round(y + 8)}px)`;
      label.hidden = false;
      placed.push({ x, y });
    }
    for (; shown < this.labels.length; shown++) this.labels[shown].hidden = true;
  }

  private pick(x: number, y: number) {
    let best = -1, distance = 13;
    for (let i = 0; i < this.nodes.length; i++) {
      if (Math.abs(this.projected[i * 3 + 2]) > 1) continue;
      const d = Math.hypot(x - this.projected[i * 3], y - this.projected[i * 3 + 1]);
      if (d < distance) { distance = d; best = i; }
    }
    return best;
  }
  private hover(index: number, x: number, y: number) {
    this.selected = index;
    const node = this.nodes[index] ?? null;
    if (node?.id === this.lastHover || (!node && !this.lastHover)) return;
    this.lastHover = node?.id ?? null;
    this.input.classList.toggle('is-hovering-node', !!node);
    this.callbacks.hover(node, x, y);
    this.dirty = true;
  }
  private pointerDown = (event: PointerEvent) => {
    this.flight = null;
    this.input.focus({ preventScroll: true });
    this.pointerMoved = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.pointerStart && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 4) this.pointerMoved = true;
    const rect = this.input.getBoundingClientRect();
    this.pendingPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  private pointerUp = (event: PointerEvent) => {
    const start = this.pointerStart; this.pointerStart = null; this.pendingPointer = null;
    if (!start || this.pointerMoved || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    const rect = this.input.getBoundingClientRect();
    const index = this.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (index >= 0) this.flyTo(index);
  };
  private pointerCancel = () => { this.pointerStart = null; this.pendingPointer = null; };
  private pointerLeave = () => { this.pendingPointer = null; this.hover(-1, 0, 0); };
  private keyDown = (event: KeyboardEvent) => {
    this.pendingPointer = null;
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Enter', '+', '-', '='].includes(event.key)) event.preventDefault();
    if (event.key.startsWith('Arrow') && this.nodes.length) {
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const index = this.selected < 0 ? (direction > 0 ? 0 : this.nodes.length - 1) : (this.selected + direction + this.nodes.length) % this.nodes.length;
      this.hover(index, Math.max(12, Math.min(this.width - 180, this.projected[index * 3])), Math.max(12, Math.min(this.height - 60, this.projected[index * 3 + 1])));
    } else if (event.key === 'Enter' && this.selected >= 0) this.flyTo(this.selected);
    else if (event.key === '+' || event.key === '=' || event.key === '-') {
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(event.key === '-' ? 1.2 : 0.8);
      offset.clampLength(this.controls.minDistance, this.controls.maxDistance);
      this.camera.position.copy(this.controls.target).add(offset); this.dirty = true;
    }
  };
  private flyTo(index: number) {
    if (!this.stars) return;
    const target = new THREE.Vector3().fromArray(this.stars.positions.array, index * 3);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flight = { start: performance.now(), from: this.camera.position.clone(), to: target.clone().addScaledVector(direction, 180), target, node: this.nodes[index] };
    this.dirty = true;
  }

  dispose() {
    this.disposed = true; this.flight = null;
    this.controls.dispose(); this.motion.removeEventListener('change', this.motionChange);
    this.input.removeEventListener('pointerdown', this.pointerDown);
    this.input.removeEventListener('pointermove', this.pointerMove);
    this.input.removeEventListener('pointerup', this.pointerUp);
    this.input.removeEventListener('pointercancel', this.pointerCancel);
    this.input.removeEventListener('pointerleave', this.pointerLeave);
    this.input.removeEventListener('keydown', this.keyDown);
    this.stars?.dispose(); this.dust.dispose(); this.lanes.dispose(); this.background.dispose();
    this.lines.geometry.dispose(); this.lines.material.dispose(); this.rays.geometry.dispose(); this.rays.material.dispose();
    this.signals.dispose();
    this.bloomPass.dispose(); this.scenePass.dispose(); this.pipeline.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove(); this.labelLayer.remove();
  }
}
