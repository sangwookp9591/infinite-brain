// SPDX-License-Identifier: Apache-2.0
// Independent implementation inspired by dgreenheck/webgpu-galaxy (MIT):
// instanced billboards, additive dust and bloom; no upstream source is copied.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, uv, uniform, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clusterPhase, galaxyDepth, recentBrightness } from './galaxyLayout';

export interface GalaxyNode {
  id: string;
  title: string;
  path: string;
  x: number;
  y: number;
  r: number;
  color: [number, number, number];
  modified?: number;
}
interface Callbacks {
  hover: (node: GalaxyNode | null, x: number, y: number) => void;
  open: (node: GalaxyNode) => void;
  fail: (error: unknown) => void;
}

function particles(count: number, soft = false) {
  const positions = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const sizes = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  positions.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  sizes.setUsage(THREE.DynamicDrawUsage);
  const floor = uniform(0);
  const material = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const distance = uv().sub(0.5).length().mul(2);
  material.positionNode = instancedBufferAttribute(positions, 'vec3');
  material.colorNode = instancedBufferAttribute(colors, 'vec3');
  material.scaleNode = instancedBufferAttribute<'float'>(sizes, 'float').max(floor);
  material.opacityNode = soft
    ? distance.pow(2).mul(-5).exp().mul(distance.oneMinus().max(0)).mul(0.045)
    : distance.mul(-6).exp().add(distance.mul(-32).exp().mul(3)).mul(distance.oneMinus().max(0));
  const sprite = new THREE.Sprite(material);
  // Sprite shares a quad globally; filter rebuilds must only dispose their own geometry.
  sprite.geometry = sprite.geometry.clone();
  sprite.count = count;
  sprite.frustumCulled = false;
  return { sprite, positions, colors, sizes, floor, dispose() {
    sprite.geometry.dispose(); material.dispose();
  } };
}
type Particles = ReturnType<typeof particles>;

export class GalaxyRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 1, 50000);
  readonly controls: OrbitControls;
  readonly backend: string;
  private pipeline: THREE.RenderPipeline;
  private scenePass: ReturnType<typeof pass>;
  private bloomPass: ReturnType<typeof bloom>;
  private stars: Particles | null = null;
  private dust = particles(900, true);
  private background = particles(1600);
  private dustGroup = new THREE.Group();
  private lines = new LineSegments2(new LineSegmentsGeometry(), new THREE.Line2NodeMaterial({
    color: '#779acb', transparent: true, opacity: 0.085, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  private rays = new LineSegments2(new LineSegmentsGeometry(), new THREE.Line2NodeMaterial({
    color: '#c2ddff', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  private nodes: GalaxyNode[] = [];
  private lookup = new Map<string, number>();
  private projected = new Float32Array(0);
  private width = 1;
  private height = 1;
  private selected = -1;
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
    this.backend = renderer.backend.constructor.name.includes('WebGL') ? 'WebGL2' : 'WebGPU';
    this.scene.background = new THREE.Color('#070b1d');
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
    this.scene.add(this.lines, this.rays, this.background.sprite, this.dustGroup);
    this.dustGroup.add(this.dust.sprite);
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
      this.background.colors.setXYZ(i, 0.8 + random() * 0.6, 0.9 + random() * 0.5, 1 + random() * 0.3);
      this.background.sizes.setX(i, 10 + random() * 23);
    }
    for (let i = 0; i < this.dust.sprite.count; i++) this.dust.sizes.setX(i, 0.12 + random() * 0.22);
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
    const clusters = new Map<string, GalaxyNode>();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((node, i) => {
      this.lookup.set(node.id, i);
      const folder = node.path.includes('/') ? node.path.split('/')[0] : 'Root';
      if (!clusters.has(folder)) clusters.set(folder, node);
      const z = galaxyDepth(node.x, node.y, clusterPhase(node.path));
      this.stars!.positions.setXYZ(i, node.x, -node.y, z);
      const light = recentBrightness(node.modified, now);
      this.stars!.colors.setXYZ(i, node.color[0] * light * 2.2, node.color[1] * light * 2.2, node.color[2] * light * 2.2);
      this.stars!.sizes.setX(i, Math.max(2, node.r * 6 * Math.sqrt(light)));
      minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
    });
    const arms = [...clusters.values()].slice(0, 12);
    this.dust.sprite.visible = arms.length > 0;
    if (arms.length) {
      for (let i = 0; i < this.dust.sprite.count; i++) {
        const cluster = arms[i % arms.length];
        const phase = clusterPhase(cluster.path);
        const radius = Math.sqrt(((i * 137 + 43) % 900) / 900);
        const angle = phase + radius * 4.5 + Math.sin(i * 78.33) * 0.22;
        this.dust.positions.setXYZ(i, Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78, Math.sin(phase) * 0.06 - 0.18);
        this.dust.colors.setXYZ(i, cluster.color[0] * 0.13, cluster.color[1] * 0.13, cluster.color[2] * 0.13);
      }
      this.dust.positions.needsUpdate = this.dust.colors.needsUpdate = true;
    }
    this.stars.positions.needsUpdate = this.stars.colors.needsUpdate = this.stars.sizes.needsUpdate = true;
    if (nodes.length) {
      const radius = Math.max(300, maxX - minX, maxY - minY) * 0.65;
      this.dustGroup.position.set((minX + maxX) / 2, -(minY + maxY) / 2, -80);
      this.dustGroup.scale.setScalar(radius);
      if (fit) {
        const center = this.dustGroup.position.clone(); center.z = 0;
        const distance = radius * 2.7 / Math.min(1, this.camera.aspect);
        this.controls.target.copy(center);
        this.camera.position.copy(center).add(new THREE.Vector3(0, -distance * 0.28, distance));
        this.camera.lookAt(center);
      }
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
    this.lines.material.opacity = Math.min(0.22, edgeThickness * 0.023) * Math.min(1, 1200 / Math.max(1, nodes.length));
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
    if (!this.dirty) return;
    this.dirty = false;
    if (this.stars) {
      const distance = this.camera.position.distanceTo(this.controls.target);
      this.stars.floor.value = distance * Math.tan(THREE.MathUtils.degToRad(23)) * 2 / this.height * (this.nodes.length > 8000 ? 5 : 8);
    }
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
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };
  private pointerMove = (event: PointerEvent) => {
    const rect = this.input.getBoundingClientRect();
    this.pendingPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  private pointerUp = (event: PointerEvent) => {
    const start = this.pointerStart; this.pointerStart = null; this.pendingPointer = null;
    if (!start || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
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
    this.stars?.dispose(); this.dust.dispose(); this.background.dispose();
    this.lines.geometry.dispose(); this.lines.material.dispose(); this.rays.geometry.dispose(); this.rays.material.dispose();
    this.bloomPass.dispose(); this.scenePass.dispose(); this.pipeline.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove(); this.labelLayer.remove();
  }
}
