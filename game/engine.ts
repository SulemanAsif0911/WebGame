import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';
import { GameAudio } from './audio';
import type { GameSettings } from './settings';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const MAG_SIZE = 30;
const RESERVE_MAX = 90;
const RELOAD_TIME = 2.35;
const FIRE_INTERVAL = 0.078;
const WALK = 5.05;
const SPRINT = 8.35;
const CROUCH_SPEED = 2.35;
const GRAVITY = 26;
const JUMP_VEL = 8.1;
const PLAYER_RADIUS = 0.38;
const STAND_EYE = 1.62;
const CROUCH_EYE = 1.12;
const STAND_H = 1.78;
const CROUCH_H = 1.22;

export type KillLine = { id: number; text: string; head: boolean; at: number };
export type ScoreRow = {
  id: number;
  name: string;
  kills: number;
  deaths: number;
  health: number;
  alive: boolean;
  you: boolean;
};
export type HudState = {
  health: number;
  mag: number;
  reserve: number;
  reloading: boolean;
  ads: boolean;
  sprint: boolean;
  grounded: boolean;
  alive: boolean;
  kills: number;
  deaths: number;
  players: number;
  ping: number;
  connected: boolean;
  connecting: boolean;
  hitmarker: number;
  hurt: number;
  killfeed: KillLine[];
  scoreboard: ScoreRow[];
  killedBy: string | null;
  respawnIn: number;
  load: number;
  loadMsg: string;
  ammoFlash: number;
  headshot: boolean;
  adsBlend: number;
};

export type EngineHooks = {
  onHud: (h: HudState) => void;
  onPause: (paused: boolean) => void;
};

type RemoteVis = {
  id: number;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  reload: THREE.AnimationAction;
  name: THREE.Sprite;
  hpFill: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  tpitch: number;
  alive: boolean;
  reloading: boolean;
  lastShoot: number;
  health: number;
};

function makeLabel(text: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 128);
  g.font = '700 44px Rajdhani, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 256, 64);
  g.fillStyle = '#f4f0e6';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.6, 0.4, 1);
  spr.position.y = 2.18;
  return spr;
}

function makeHpBar() {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x1a0808, depthTest: false, transparent: true, opacity: 0.85 })
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x9dff6a, depthTest: false })
  );
  fill.name = 'hpFill';
  fill.position.z = 0.002;
  g.add(bg);
  g.add(fill);
  g.position.y = 1.92;
  return { group: g, fill };
}

export class ArenaEngine {
  private canvas: HTMLCanvasElement;
  private settings: GameSettings;
  private hooks: EngineHooks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private audio = new GameAudio();

  private mapRoot: THREE.Object3D | null = null;
  private colliders: THREE.Mesh[] = [];
  private template: THREE.Object3D | null = null;
  private clip: THREE.AnimationClip | null = null;
  private localRoot = new THREE.Group();
  private localMixer: THREE.AnimationMixer | null = null;
  private localReload: THREE.AnimationAction | null = null;
  private fpvIdle: THREE.AnimationAction | null = null;
  private fpvFire: THREE.AnimationAction | null = null;
  private muzzleBone: THREE.Object3D | null = null;
  private lensObj: THREE.Object3D | null = null;
  private fpvArmMeshes: THREE.Mesh[] = [];
  private fpvLensMeshes: THREE.Mesh[] = [];
  private adsBlend = 0;
  private adsVel = 0;
  private lookBufX = 0;
  private lookBufY = 0;
  private gunPos = new THREE.Vector3();
  private gunRot = new THREE.Euler(0, 0, 0, 'YXZ');
  private charScale = 1;
  private charOffsetY = 0;
  private arenaCenter = new THREE.Vector3();
  private arenaRadius = 46;

  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private muzzleLight: THREE.PointLight;
  private tracerPool: THREE.Line[] = [];
  private impactPool: THREE.Mesh[] = [];

  private keys = new Set<string>();
  private mouseDown = new Set<number>();
  private yaw = 0;
  private pitch = 0;
  private pos = new THREE.Vector3(8, 6, 8);
  private vel = new THREE.Vector3();
  private grounded = false;
  private crouch = false;
  private ads = false;
  private sprinting = false;
  private health = 100;
  private mag = MAG_SIZE;
  private reserve = RESERVE_MAX;
  private reloading = false;
  private reloadT = 0;
  private fireCd = 0;
  private recoil = 0;
  private sway = 0;
  private bob = 0;
  private footT = 0;
  private alive = true;
  private kills = 0;
  private deaths = 0;
  private killedBy: string | null = null;
  private respawnAt = 0;
  private myId = 0;
  private myName = 'Operator';
  private paused = false;
  private locked = false;
  private everLocked = false;

  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = true;
  private ping = 0;
  private lastPing = 0;
  private lastSend = 0;
  private remotes = new Map<number, RemoteVis>();
  private scores = new Map<number, ScoreRow>();
  private killfeed: KillLine[] = [];
  private feedSeq = 0;
  private hitmarker = 0;
  private hurt = 0;
  private ammoFlash = 0;
  private headshotFx = false;
  private load = 0;
  private loadMsg = 'Mounting renderer';
  private lastHud = 0;
  private raycaster = new THREE.Raycaster();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private mtx1 = new THREE.Matrix4();
  private mtx2 = new THREE.Matrix4();
  private up = new THREE.Vector3(0, 1, 0);
  private spawnY = 2;
  private mapBox = new THREE.Box3();
  private invuln = 0;

  constructor(
    canvas: HTMLCanvasElement,
    settings: GameSettings,
    name: string,
    hooks: EngineHooks
  ) {
    this.canvas = canvas;
    this.settings = settings;
    this.hooks = hooks;
    this.myName = name.slice(0, 16) || 'Operator';
    this.audio.setVolume(settings.volume);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.graphics !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping =
      settings.graphics === 'low' ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = settings.graphics !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0b1016, 1);

    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.04, 280);
    this.camera.rotation.order = 'YXZ';
    this.resize();

    this.scene.background = new THREE.Color(0x7ea3c4);
    this.scene.fog = new THREE.Fog(0x8aa8bf, 28, this.fogFar());

    this.hemi = new THREE.HemisphereLight(0xc8ddf2, 0x3a2a1a, 0.72);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe3c2, 2.15);
    this.sun.position.set(42, 68, 18);
    this.sun.castShadow = settings.graphics !== 'low';
    const mapSize = settings.graphics === 'ultra' ? 2048 : settings.graphics === 'high' ? 1536 : 1024;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.camera.left = -55;
    this.sun.shadow.camera.right = 55;
    this.sun.shadow.camera.top = 55;
    this.sun.shadow.camera.bottom = -55;
    this.sun.shadow.bias = -0.0007;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x88aadd, settings.graphics === 'ultra' ? 0.45 : 0.22);
    this.fill.position.set(-30, 20, -40);
    this.scene.add(this.fill);

    this.muzzleLight = new THREE.PointLight(0xffcc66, 0, 8, 2);
    this.scene.add(this.muzzleLight);

    this.scene.add(this.camera);
    this.camera.add(this.localRoot);
    const gunLight = new THREE.PointLight(0xfff0dd, 1.15, 2.4, 2);
    gunLight.position.set(0.08, 0.02, 0.05);
    this.camera.add(gunLight);

    this.buildSky();
    this.buildTracers();
    this.bind();
    this.boot();
  }

  applySettings(s: GameSettings) {
    this.settings = s;
    this.audio.setVolume(s.volume);
    if (!this.ads) this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = s.graphics !== 'low';
    this.sun.castShadow = s.graphics !== 'low';
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.far = this.fogFar();
  }

  private pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this.settings.graphics === 'low') return Math.min(1, dpr * 0.7);
    if (this.settings.graphics === 'medium') return Math.min(1.25, dpr);
    if (this.settings.graphics === 'high') return Math.min(1.75, dpr);
    return Math.min(2, dpr);
  }

  private fogFar() {
    if (this.settings.graphics === 'low') return 90;
    if (this.settings.graphics === 'medium') return 130;
    return 180;
  }

  private buildSky() {
    const geo = new THREE.SphereGeometry(240, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x8eb7d8) },
        mid: { value: new THREE.Color(0xc3d4e2) },
        bot: { value: new THREE.Color(0x6b5340) },
      },
      vertexShader: `varying vec3 v; void main(){ v=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 v; void main(){ float h=clamp(v.y*0.5+0.5,0.0,1.0); vec3 c=mix(bot,mid,smoothstep(0.0,0.48,h)); c=mix(c,top,smoothstep(0.48,1.0,h)); gl_FragColor=vec4(c,1.0); }`,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  private buildTracers() {
    for (let i = 0; i < 16; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, -1),
      ]);
      const m = new THREE.LineBasicMaterial({
        color: 0xffe08a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const line = new THREE.Line(g, m);
      line.visible = false;
      this.scene.add(line);
      this.tracerPool.push(line);
    }
    const ig = new THREE.SphereGeometry(0.04, 6, 6);
    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(
        ig,
        new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0 })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.impactPool.push(mesh);
    }
  }

  private bind() {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onContext = this.onContext.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onLock = this.onLock.bind(this);
    this.onUnlock = this.onUnlock.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onContext);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onLock);
  }

  private onContext(e: Event) {
    e.preventDefault();
  }

  private onLock() {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) this.everLocked = true;
    if (!this.locked && this.everLocked && this.alive && !this.paused) {
      this.paused = true;
      this.hooks.onPause(true);
    }
  }

  private onUnlock() {
    /* handled in pointerlockchange */
  }

  requestLock() {
    if (this.disposed) return;
    this.canvas.requestPointerLock?.();
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) this.requestLock();
    else document.exitPointerLock?.();
  }

  private onResize() {
    this.resize();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private codeFromEvent(e: KeyboardEvent | MouseEvent) {
    if ('code' in e) return e.code;
    return 'Mouse' + (e as MouseEvent).button;
  }

  private isBound(action: keyof GameSettings['bindings'], code: string) {
    return this.settings.bindings[action] === code;
  }

  private held(action: keyof GameSettings['bindings']) {
    const b = this.settings.bindings[action];
    if (b.startsWith('Mouse')) return this.mouseDown.has(Number(b.replace('Mouse', '')));
    return this.keys.has(b);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.repeat && e.code === 'Tab') e.preventDefault();
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Escape') {
      if (!this.paused) {
        this.paused = true;
        this.hooks.onPause(true);
        document.exitPointerLock?.();
      }
      return;
    }
    this.keys.add(e.code);
    if (this.paused) return;
    if (this.isBound('reload', e.code)) this.startReload();
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private onMouseDown(e: MouseEvent) {
    this.mouseDown.add(e.button);
    if (!this.locked && !this.paused && this.alive) {
      this.requestLock();
      return;
    }
    if (this.paused) return;
    if (this.isBound('fire', 'Mouse' + e.button)) this.tryFire();
  }

  private onMouseUp(e: MouseEvent) {
    this.mouseDown.delete(e.button);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.locked || this.paused || !this.alive) return;
    this.lookBufX += e.movementX;
    this.lookBufY += e.movementY;
    this.sway += e.movementX * 0.00018;
  }

  private async boot() {
    try {
      const loader = new GLTFLoader();
      this.loadMsg = 'Streaming district geometry';
      this.pushHud(true);
      const mapGltf = await loader.loadAsync('/models/map.glb', (e) => {
        if (e.total) this.load = 0.08 + 0.42 * (e.loaded / e.total);
        this.pushHud(true);
      });
      this.loadMsg = 'Baking collision';
      this.load = 0.55;
      this.pushHud(true);
      this.setupMap(mapGltf.scene);

      this.loadMsg = 'Mounting carbine FPV';
      const fpvGltf = await loader.loadAsync('/models/fpv.glb', (e) => {
        if (e.total) this.load = 0.56 + 0.18 * (e.loaded / e.total);
        this.pushHud(true);
      });
      this.setupFPV(fpvGltf.scene, fpvGltf.animations || []);

      this.loadMsg = 'Staging operators';
      const charGltf = await loader.loadAsync('/models/opponent.glb', (e) => {
        if (e.total) this.load = 0.76 + 0.18 * (e.loaded / e.total);
        this.pushHud(true);
      });
      this.template = charGltf.scene;
      this.clip = charGltf.animations[0] || null;
      const tbox = new THREE.Box3().setFromObject(this.template);
      const th = Math.max(0.2, tbox.max.y - tbox.min.y);
      this.charScale = 1.82 / th;
      this.charOffsetY = -tbox.min.y * this.charScale;
      this.placeAtSafeSpawn();
      this.load = 1;
      this.loadMsg = 'Linking arena net';
      this.pushHud(true);
      this.connect();
      this.clock.start();
      this.raf = requestAnimationFrame(this.loop);
    } catch (err) {
      console.error(err);
      this.loadMsg = 'Failed to load arena assets';
      this.pushHud(true);
    }
  }

  private setupMap(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const aniso =
      this.settings.graphics === 'ultra' ? 16 : this.settings.graphics === 'high' ? 8 : 4;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = this.settings.graphics !== 'low';
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as THREE.MeshStandardMaterial;
        if (m.map) {
          m.map.anisotropy = aniso;
          m.map.colorSpace = THREE.SRGBColorSpace;
        }
        if (m.transparent && m.opacity >= 0.98) m.transparent = false;
      }
      try {
        (mesh.geometry as any).computeBoundsTree?.();
      } catch {
        /* ignore */
      }
      this.colliders.push(mesh);
    });
    this.scene.add(root);
    this.mapRoot = root;
    this.mapBox.setFromObject(root);
    const c = this.mapBox.getCenter(new THREE.Vector3());
    this.arenaCenter.copy(c);
    const size = this.mapBox.getSize(new THREE.Vector3());
    this.arenaRadius = Math.min(size.x, size.z) * 0.5 - 1.6;
    if (!Number.isFinite(this.arenaRadius) || this.arenaRadius < 10) this.arenaRadius = 46;
    this.sun.target.position.copy(c);
    this.spawnY = this.mapBox.max.y * 0.15 + 2;
  }

  private setupFPV(src: THREE.Object3D, clips: THREE.AnimationClip[]) {
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const lname = (o.name || '').toLowerCase();
      if (/lens/i.test(o.name)) {
        this.lensObj = o;
        if (mesh.isMesh) this.fpvLensMeshes.push(mesh);
      }
      if (/scope/i.test(o.name) && !this.lensObj) this.lensObj = o;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 20;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const m = mat as THREE.MeshStandardMaterial;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.depthTest = true;
          m.depthWrite = true;
          const mn = (m.name || '').toLowerCase();
          if (mn.includes('arm') || lname.includes('armmesh')) this.fpvArmMeshes.push(mesh);
          if (mn.includes('lens') || lname.includes('lens')) {
            this.fpvLensMeshes.push(mesh);
            m.transparent = true;
            m.depthWrite = false;
          }
        }
      }
      if (/muzzle/i.test(o.name)) this.muzzleBone = o;
    });
    src.rotation.y = Math.PI;
    this.localRoot.add(src);
    this.localRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.localRoot);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    src.scale.setScalar(0.78 / maxDim);
    this.localRoot.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(this.localRoot);
    const c = box2.getCenter(new THREE.Vector3());
    src.position.add(new THREE.Vector3(0.18, -0.24, -0.36).sub(c));

    this.localMixer = new THREE.AnimationMixer(src);
    const namedIdle = clips.find((cl) => /idle01|idle/i.test(cl.name) && !/all/i.test(cl.name));
    const namedFire = clips.find((cl) => /@fire|fire/i.test(cl.name) && !/all/i.test(cl.name));
    const namedReload = clips.find((cl) => /@reload|reload/i.test(cl.name) && !/all/i.test(cl.name));
    if (namedIdle) {
      this.fpvIdle = this.localMixer.clipAction(namedIdle);
      this.fpvIdle.setLoop(THREE.LoopRepeat, Infinity);
      this.fpvIdle.play();
    } else if (clips[0]) {
      this.fpvIdle = this.localMixer.clipAction(clips[0]);
      this.fpvIdle.paused = true;
      this.fpvIdle.time = 0.04;
      this.fpvIdle.play();
    }
    if (namedFire) {
      this.fpvFire = this.localMixer.clipAction(namedFire);
      this.fpvFire.setLoop(THREE.LoopOnce, 1);
      this.fpvFire.clampWhenFinished = true;
    }
    if (namedReload) {
      this.localReload = this.localMixer.clipAction(namedReload);
      this.localReload.setLoop(THREE.LoopOnce, 1);
      this.localReload.clampWhenFinished = true;
      this.localReload.timeScale = Math.max(0.85, namedReload.duration / RELOAD_TIME);
    }
    this.localMixer.addEventListener('finished', (e) => {
      if (e.action === this.fpvFire || e.action === this.localReload) {
        if (this.fpvIdle) {
          this.fpvIdle.paused = true;
          this.fpvIdle.time = 0.04;
          this.fpvIdle.enabled = true;
          this.fpvIdle.fadeIn(0.1).play();
        }
      }
    });
  }

  private groundAt(x: number, z: number, fromY = 40) {
    this.raycaster.far = 80;
    this.raycaster.near = 0.01;
    this.raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length) return hits[0].point.y;
    return this.mapBox.min.y;
  }

  private placeAtSafeSpawn(index = Math.floor(Math.random() * 10)) {
    const c = this.mapBox.getCenter(new THREE.Vector3());
    const ring = [
      [16, 14],
      [-15, 13],
      [13, -16],
      [-17, -12],
      [2, 20],
      [-4, -19],
      [20, 3],
      [-19, 5],
      [9, -7],
      [-11, 8],
    ];
    const [dx, dz] = ring[index % ring.length];
    const x = c.x + dx;
    const z = c.z + dz;
    const y = this.groundAt(x, z, this.mapBox.max.y + 8) + 0.05;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(c.x - x, c.z - z);
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    this.connecting = true;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.connecting = false;
      this.connected = false;
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.connecting = false;
      this.ws?.send(JSON.stringify({ t: 'hello', name: this.myName }));
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.connecting = false;
      if (!this.disposed) setTimeout(() => this.connect(), 1800);
    };
    this.ws.onerror = () => {
      this.connecting = false;
    };
    this.ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onNet(msg);
    };
  }

  private onNet(msg: any) {
    if (msg.t === 'welcome') {
      this.myId = msg.id;
      this.health = msg.you.health;
      this.alive = msg.you.alive;
      this.kills = msg.you.kills;
      this.deaths = msg.you.deaths;
      if (msg.you.x) {
        const gy = this.groundAt(msg.you.x, msg.you.z, 40);
        this.pos.set(msg.you.x, gy + 0.05, msg.you.z);
      }
      for (const p of msg.players) {
        this.upsertScore(p);
        if (p.id !== this.myId) this.syncRemote(p);
      }
      return;
    }
    if (msg.t === 'state') {
      const seen = new Set<number>();
      for (const p of msg.players) {
        seen.add(p.id);
        this.upsertScore(p);
        if (p.id === this.myId) {
          if (typeof p.health === 'number' && p.alive) this.health = p.health;
          continue;
        }
        this.syncRemote(p);
      }
      for (const id of [...this.remotes.keys()]) {
        if (!seen.has(id)) {
          const r = this.remotes.get(id);
          if (r) this.scene.remove(r.root);
          this.remotes.delete(id);
          this.scores.delete(id);
        }
      }
      return;
    }
    if (msg.t === 'join') {
      this.upsertScore(msg.player);
      if (msg.player?.id !== this.myId) this.syncRemote(msg.player);
      return;
    }
    if (msg.t === 'leave') {
      this.scores.delete(msg.id);
      const r = this.remotes.get(msg.id);
      if (r) {
        this.scene.remove(r.root);
        this.remotes.delete(msg.id);
      }
      return;
    }
    if (msg.t === 'rename') {
      const s = this.scores.get(msg.id);
      if (s) s.name = msg.name;
      const r = this.remotes.get(msg.id);
      if (r) {
        r.root.remove(r.name);
        r.name = makeLabel(msg.name);
        r.root.add(r.name);
      }
      return;
    }
    if (msg.t === 'shot' && msg.id !== this.myId) {
      const r = this.remotes.get(msg.id);
      if (r) {
        r.lastShoot = 0.08;
        this.audio.gunshot(this.pos.distanceTo(new THREE.Vector3(r.x, r.y, r.z)));
        this.spawnTracer(
          new THREE.Vector3(msg.ox, msg.oy, msg.oz),
          new THREE.Vector3(msg.dx, msg.dy, msg.dz)
        );
      }
      return;
    }
    if (msg.t === 'hurt') {
      this.health = msg.health;
      this.hurt = 1;
      this.audio.hurt();
      this.vel.x += (msg.dirx || 0) * 2.2;
      this.vel.z += (msg.dirz || 0) * 2.2;
      if (this.health <= 0) this.onDeath(this.scores.get(msg.by)?.name || 'Operator');
      return;
    }
    if (msg.t === 'confirm') {
      this.hitmarker = 1;
      this.headshotFx = !!msg.head;
      this.audio.hit(msg.head);
      if (msg.kill) this.audio.kill();
      const s = this.scores.get(msg.target);
      if (s) {
        s.health = msg.health;
        s.alive = msg.health > 0;
      }
      const r = this.remotes.get(msg.target);
      if (r) {
        r.health = msg.health;
        r.alive = msg.health > 0;
        r.root.visible = msg.health > 0;
      }
      return;
    }
    if (msg.t === 'kill') {
      this.pushFeed(
        `${msg.killer}  ▸  ${msg.name}${msg.head ? '  · HS' : ''}`,
        !!msg.head
      );
      if (msg.by === this.myId) this.kills = msg.kills;
      if (msg.id === this.myId) this.deaths = msg.deaths;
      const s = this.scores.get(msg.by);
      if (s) s.kills = msg.kills;
      const v = this.scores.get(msg.id);
      if (v) {
        v.deaths = msg.deaths;
        v.alive = false;
        v.health = 0;
      }
      const dead = this.remotes.get(msg.id);
      if (dead) {
        dead.alive = false;
        dead.health = 0;
        dead.root.visible = false;
      }
      if (msg.id === this.myId && this.alive) {
        this.onDeath(msg.killer || 'Operator');
      }
      return;
    }
    if (msg.t === 'spawn') {
      if (msg.id === this.myId) {
        this.alive = true;
        this.health = 100;
        this.killedBy = null;
        this.invuln = 1.4;
        const gy = this.groundAt(msg.x, msg.z, 40);
        this.pos.set(msg.x, gy + 0.05, msg.z);
        this.vel.set(0, 0, 0);
        this.mag = MAG_SIZE;
      } else {
        const r = this.remotes.get(msg.id);
        if (r) {
          r.alive = true;
          r.health = 100;
          r.root.visible = true;
          r.tx = msg.x;
          r.ty = msg.y;
          r.tz = msg.z;
        }
      }
      const s = this.scores.get(msg.id);
      if (s) {
        s.alive = true;
        s.health = 100;
      }
      return;
    }
    if (msg.t === 'pong') {
      this.ping = Math.max(0, Date.now() - msg.n);
      return;
    }
    if (msg.t === 'hitfx') {
      this.spark(new THREE.Vector3(msg.x, msg.y, msg.z), msg.head ? 0xffe0e0 : 0xff5533);
      if (typeof msg.health === 'number' && msg.id) {
        const s = this.scores.get(msg.id);
        if (s) {
          s.health = msg.health;
          s.alive = msg.health > 0;
        }
        const r = this.remotes.get(msg.id);
        if (r) {
          r.health = msg.health;
          r.alive = msg.health > 0;
          r.root.visible = msg.health > 0;
        }
      }
    }
  }

  private upsertScore(p: any) {
    this.scores.set(p.id, {
      id: p.id,
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      health: p.health,
      alive: p.alive,
      you: p.id === this.myId,
    });
  }

  private pushFeed(text: string, head: boolean) {
    this.killfeed.unshift({ id: ++this.feedSeq, text, head, at: performance.now() });
    this.killfeed = this.killfeed.slice(0, 6);
  }

  private syncRemote(p: any) {
    if (!this.template) return;
    let r = this.remotes.get(p.id);
    if (!r) {
      const clone = SkeletonUtils.clone(this.template) as THREE.Object3D;
      clone.scale.setScalar(this.charScale);
      clone.position.y = this.charOffsetY;
      clone.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = this.settings.graphics !== 'low';
          mesh.frustumCulled = true;
          mesh.visible = true;
        }
      });
      const root = new THREE.Group();
      root.add(clone);
      const mixer = new THREE.AnimationMixer(clone);
      let reload: THREE.AnimationAction | null = null;
      if (this.clip) {
        reload = mixer.clipAction(this.clip);
        reload.setLoop(THREE.LoopOnce, 1);
        reload.clampWhenFinished = true;
        reload.paused = true;
        reload.time = 0.02;
        reload.play();
      }
      const name = makeLabel(p.name || 'Operator');
      const hp = makeHpBar();
      const ghost = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.88, 3, 6), ghost);
      body.position.y = 0.92;
      body.userData.hit = 'body';
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), ghost.clone());
      skull.position.y = 1.64;
      skull.userData.hit = 'head';
      root.add(name);
      root.add(hp.group);
      root.add(body);
      root.add(skull);
      this.scene.add(root);
      r = {
        id: p.id,
        root,
        mixer,
        reload: reload!,
        name,
        hpFill: hp.fill,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        tx: p.x,
        ty: p.y,
        tz: p.z,
        tyaw: p.yaw,
        tpitch: p.pitch,
        alive: p.alive,
        reloading: false,
        lastShoot: 0,
        health: p.health ?? 100,
      };
      this.remotes.set(p.id, r);
    }
    r.tx = p.x;
    r.tz = p.z;
    if (this.colliders.length) {
      const gy = this.groundAt(p.x, p.z, 48);
      r.ty = Number.isFinite(gy) ? gy : p.y;
    } else {
      r.ty = typeof p.y === 'number' ? p.y : r.ty;
    }
    r.tyaw = p.yaw;
    r.tpitch = p.pitch;
    r.alive = p.alive;
    r.health = typeof p.health === 'number' ? p.health : r.health;
    r.root.visible = p.alive;
    if (p.reload && r.reload && !r.reloading) {
      r.reloading = true;
      r.reload.reset();
      r.reload.paused = false;
      r.reload.play();
    }
    if (!p.reload) r.reloading = false;
  }

  private onDeath(by: string) {
    this.alive = false;
    this.health = 0;
    this.deaths += 1;
    this.killedBy = by;
    this.respawnAt = performance.now() + 3200;
    this.ads = false;
  }

  private startReload() {
    if (!this.alive || this.reloading || this.mag === MAG_SIZE || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = RELOAD_TIME;
    this.audio.reload();
    if (this.localReload) {
      this.fpvFire?.stop();
      this.fpvIdle?.fadeOut(0.08);
      this.localReload.reset();
      this.localReload.paused = false;
      this.localReload.fadeIn(0.05).play();
    }
  }

  private finishReload() {
    const need = MAG_SIZE - this.mag;
    const take = Math.min(need, this.reserve);
    this.mag += take;
    this.reserve -= take;
    this.reloading = false;
    this.reloadT = 0;
  }

  private tryFire() {
    if (!this.alive || this.paused || this.reloading) return;
    if (this.fireCd > 0) return;
    if (this.mag <= 0) {
      this.ammoFlash = 1;
      this.startReload();
      return;
    }
    this.mag -= 1;
    this.fireCd = FIRE_INTERVAL;
    const adsKick = THREE.MathUtils.lerp(1, 0.38, this.adsBlend);
    this.recoil += 0.02 * adsKick;
    this.pitch += 0.008 * adsKick;
    this.audio.gunshot(0);
    this.muzzleLight.intensity = 18;
    if (this.fpvFire) {
      this.fpvIdle?.fadeOut(0.04);
      this.fpvFire.reset();
      this.fpvFire.fadeIn(0.02).play();
    }

    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.normalize();
    this.spawnTracer(origin, dir);

    this.raycaster.near = 0.2;
    this.raycaster.far = 140;
    this.raycaster.set(origin, dir);
    const worldHits = this.raycaster.intersectObjects(this.colliders, false);
    if (worldHits[0]) this.spark(worldHits[0].point, 0xffcc77);

    let target: number | null = null;
    let head = false;
    let bestRadial = 1.6;
    let bestDist = 150;
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      const cx = r.x - origin.x;
      const cy = r.y + 1.08 - origin.y;
      const cz = r.z - origin.z;
      const dist = Math.hypot(cx, cy, cz);
      if (dist < 0.3 || dist > 140) continue;
      const inv = 1 / dist;
      const dot = dir.x * cx * inv + dir.y * cy * inv + dir.z * cz * inv;
      if (dot < 0.78) continue;
      const radial = Math.sqrt(Math.max(0, 1 - dot * dot)) * dist;
      const limit = 1.25 + dist * 0.02;
      if (radial > limit) continue;
      if (radial < bestRadial || (Math.abs(radial - bestRadial) < 0.05 && dist < bestDist)) {
        bestRadial = radial;
        bestDist = dist;
        target = r.id;
        head = origin.y + dir.y * dist > r.y + 1.38;
      }
    }

    if (target != null) {
      const r = this.remotes.get(target);
      if (r) {
        const dmg = head ? 100 : 50;
        r.health = Math.max(0, r.health - dmg);
        this.hitmarker = 1;
        this.headshotFx = head;
        this.spark(new THREE.Vector3(r.x, r.y + (head ? 1.6 : 1.1), r.z), head ? 0xffe0e0 : 0xff5533);
        if (r.health <= 0) {
          r.alive = false;
          r.root.visible = false;
        }
      }
    }

    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(
        JSON.stringify({
          t: 'shoot',
          ox: origin.x,
          oy: origin.y,
          oz: origin.z,
          dx: dir.x,
          dy: dir.y,
          dz: dir.z,
          target,
          head,
        })
      );
    }
  }

  private spawnTracer(origin: THREE.Vector3, dir: THREE.Vector3) {
    const line = this.tracerPool.find((l) => !l.visible) || this.tracerPool[0];
    const end = origin.clone().addScaledVector(dir, 42);
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    const start = origin.clone().addScaledVector(dir, 0.45);
    pos.setXYZ(0, start.x, start.y, start.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    (line.material as THREE.LineBasicMaterial).opacity = 0.85;
    line.visible = true;
    (line as any).life = 0.08;
  }

  private spark(p: THREE.Vector3, color: number) {
    const m = this.impactPool.find((x) => !x.visible) || this.impactPool[0];
    m.position.copy(p);
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    (m.material as THREE.MeshBasicMaterial).opacity = 1;
    m.visible = true;
    (m as any).life = 0.18;
  }

  private loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private update(dt: number) {
    this.hitmarker = Math.max(0, this.hitmarker - dt * 3.2);
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    this.ammoFlash = Math.max(0, this.ammoFlash - dt * 2);
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.recoil = THREE.MathUtils.lerp(this.recoil, 0, 1 - Math.pow(0.001, dt));
    this.sway = THREE.MathUtils.lerp(this.sway, 0, 1 - Math.pow(0.02, dt));
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 90);

    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }

    this.ads = this.alive && !this.paused && this.held('ads') && !this.reloading;
    this.applyLook(dt);
    this.stepAds(dt);
    const adsT = this.smooth01(this.adsBlend);
    const targetFov = THREE.MathUtils.lerp(this.settings.fov, 28, adsT);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 18);
    this.camera.near = THREE.MathUtils.lerp(0.045, 0.018, adsT);
    this.camera.updateProjectionMatrix();

    if (this.alive && !this.paused) this.move(dt);
    else this.vel.y = 0;

    if (this.held('fire') && this.locked && this.alive && !this.paused) this.tryFire();

    this.localMixer?.update(dt);
    this.localRoot.visible = this.alive;
    this.updateCamera(dt);
    this.updateRemotes(dt);
    this.updateFx(dt);
    this.netTick();

    if (this.muzzleBone) {
      this.muzzleBone.getWorldPosition(this.tmp);
      this.muzzleLight.position.copy(this.tmp);
    }

    const now = performance.now();
    this.killfeed = this.killfeed.filter((k) => now - k.at < 5200);
    if (now - this.lastHud > 50) {
      this.lastHud = now;
      this.pushHud();
    }
  }

  private move(dt: number) {
    this.crouch = this.held('crouch');
    const wish = new THREE.Vector3();
    if (this.held('forward')) wish.z -= 1;
    if (this.held('back')) wish.z += 1;
    if (this.held('left')) wish.x -= 1;
    if (this.held('right')) wish.x += 1;
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();
    wish.applyAxisAngle(this.up, this.yaw);

    this.sprinting =
      this.held('sprint') && moving && !this.crouch && !this.ads && this.held('forward');
    const speed = this.crouch ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;
    const target = wish.multiplyScalar(speed);
    const accel = this.grounded ? 18 : 6;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * accel);

    if (this.grounded && this.held('jump') && !this.crouch) {
      this.vel.y = JUMP_VEL;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

    const next = this.pos.clone();
    next.x += this.vel.x * dt;
    next.z += this.vel.z * dt;
    this.resolveWalls(next);
    this.clampArena(next);
    next.y += this.vel.y * dt;
    this.resolveFloor(next);
    this.clampArena(next);
    this.pos.copy(next);

    if (this.grounded && moving) {
      this.bob += dt * (this.sprinting ? 14 : 10);
      this.footT += dt;
      const step = this.sprinting ? 0.32 : 0.44;
      if (this.footT > step) {
        this.footT = 0;
        this.audio.foot(this.sprinting);
      }
    } else {
      this.bob *= 1 - dt * 6;
      this.footT = 0;
    }
  }

  private resolveWalls(next: THREE.Vector3) {
    const h1 = this.crouch ? 0.45 : 0.55;
    const h2 = this.crouch ? 1.0 : 1.35;
    const dirs = 8;
    for (let h of [h1, h2]) {
      for (let i = 0; i < dirs; i++) {
        const a = (i / dirs) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        this.raycaster.near = 0.02;
        this.raycaster.far = PLAYER_RADIUS + 0.12;
        this.raycaster.set(new THREE.Vector3(next.x, next.y + h, next.z), dir);
        const hits = this.raycaster.intersectObjects(this.colliders, false);
        if (hits[0] && hits[0].distance < PLAYER_RADIUS) {
          const n = hits[0].face
            ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
            : dir.clone().negate();
          n.y = 0;
          n.normalize();
          const push = PLAYER_RADIUS - hits[0].distance + 0.01;
          next.addScaledVector(n, push);
          const vn = this.vel.dot(n);
          if (vn < 0) this.vel.addScaledVector(n, -vn);
        }
      }
    }
  }

  private clampArena(next: THREE.Vector3) {
    const dx = next.x - this.arenaCenter.x;
    const dz = next.z - this.arenaCenter.z;
    const d = Math.hypot(dx, dz);
    const maxR = this.arenaRadius - PLAYER_RADIUS - 0.15;
    if (d > maxR && d > 0.001) {
      const s = maxR / d;
      next.x = this.arenaCenter.x + dx * s;
      next.z = this.arenaCenter.z + dz * s;
      const nx = dx / d;
      const nz = dz / d;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn > 0) {
        this.vel.x -= vn * nx;
        this.vel.z -= vn * nz;
      }
    }
  }

  private resolveFloor(next: THREE.Vector3) {
    this.raycaster.near = 0.01;
    this.raycaster.far = 3.2;
    this.raycaster.set(new THREE.Vector3(next.x, next.y + 1.4, next.z), new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    const skin = 0.05;
    if (hits[0]) {
      const gy = hits[0].point.y;
      if (next.y <= gy + skin && this.vel.y <= 0.2) {
        next.y = gy;
        this.vel.y = 0;
        this.grounded = true;
        return;
      }
    }
    this.grounded = false;
    if (next.y < this.mapBox.min.y - 8) {
      this.placeAtSafeSpawn();
    }
  }

  private applyLook(dt: number) {
    if (!this.locked || this.paused || !this.alive) {
      this.lookBufX = 0;
      this.lookBufY = 0;
      return;
    }
    const adsT = this.smooth01(this.adsBlend);
    const adsMul = THREE.MathUtils.lerp(1, this.settings.adsSensitivity * 0.42, adsT);
    const consume = 1 - Math.pow(0.00025, dt);
    const mx = this.lookBufX * consume;
    const my = this.lookBufY * consume;
    this.lookBufX -= mx;
    this.lookBufY -= my;
    const sens = 0.00162 * this.settings.sensitivity * adsMul;
    this.yaw -= mx * sens;
    const inv = this.settings.invertY ? -1 : 1;
    this.pitch -= my * sens * inv;
    this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch));
  }

  private stepAds(dt: number) {
    const target = this.ads ? 1 : 0;
    const omega = 15.2;
    const x = this.adsBlend - target;
    const accel = -2 * omega * this.adsVel - omega * omega * x;
    this.adsVel += accel * dt;
    this.adsBlend += this.adsVel * dt;
    if (this.adsBlend < 0) {
      this.adsBlend = 0;
      this.adsVel = 0;
    } else if (this.adsBlend > 1) {
      this.adsBlend = 1;
      this.adsVel = 0;
    } else if (Math.abs(x) < 0.0008 && Math.abs(this.adsVel) < 0.01) {
      this.adsBlend = target;
      this.adsVel = 0;
    }
  }

  private smooth01(t: number) {
    const x = THREE.MathUtils.clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  private updateCamera(dt: number) {
    const adsT = this.smooth01(this.adsBlend);
    const eye = this.crouch ? CROUCH_EYE : STAND_EYE;
    const bobAmt = (this.grounded ? 1 : 0) * (1 - adsT * 0.92);
    const bobX = Math.sin(this.bob) * 0.018 * bobAmt;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.022 * bobAmt;
    const rec = THREE.MathUtils.lerp(1, 0.28, adsT);
    this.camera.position.set(
      this.pos.x + bobX,
      this.pos.y + eye + bobY - this.recoil * 0.1 * rec,
      this.pos.z
    );
    this.camera.rotation.set(
      this.pitch - this.recoil * 0.48 * rec,
      this.yaw,
      -this.sway * THREE.MathUtils.lerp(0.32, 0.05, adsT),
      'YXZ'
    );
    this.camera.updateMatrixWorld(true);

    const hip = new THREE.Vector3(this.sway * 0.35, bobY * 0.55, 0);
    const hipRotX = -this.recoil * 0.22;
    const hipRotY = this.sway * 0.12;
    const hipRotZ = -this.sway * 0.18;

    this.localRoot.position.copy(hip);
    this.localRoot.rotation.set(hipRotX, hipRotY, hipRotZ);
    this.localRoot.updateMatrixWorld(true);

    const adsPos = hip.clone();
    let adsRotX = -this.recoil * 0.06;
    let adsRotY = 0;
    let adsRotZ = 0;
    if (this.lensObj) {
      this.lensObj.getWorldPosition(this.tmp);
      this.camera.worldToLocal(this.tmp);
      adsPos.x += -this.tmp.x;
      adsPos.y += -this.tmp.y;
      adsPos.z += -0.032 - this.tmp.z;
    } else {
      adsPos.set(-0.01, 0.035, 0.09);
    }

    const desired = hip.clone().lerp(adsPos, adsT);
    const follow = 1 - Math.pow(0.00002, dt);
    this.gunPos.lerp(desired, follow);
    this.localRoot.position.copy(this.gunPos);
    this.localRoot.rotation.set(
      THREE.MathUtils.lerp(hipRotX, adsRotX, adsT),
      THREE.MathUtils.lerp(hipRotY, adsRotY, adsT),
      THREE.MathUtils.lerp(hipRotZ, adsRotZ, adsT)
    );

    const hideLens = adsT > 0.62;
    const hideArms = adsT > 0.48;
    for (const m of this.fpvLensMeshes) m.visible = !hideLens;
    for (const m of this.fpvArmMeshes) m.visible = !hideArms;

    if (!this.alive && this.killedBy) this.camera.position.y += 0.4;
  }

  private updateRemotes(dt: number) {
    for (const r of this.remotes.values()) {
      r.mixer.update(dt);
      r.x = THREE.MathUtils.lerp(r.x, r.tx, 1 - Math.pow(0.001, dt));
      r.y = THREE.MathUtils.lerp(r.y, r.ty, 1 - Math.pow(0.001, dt));
      r.z = THREE.MathUtils.lerp(r.z, r.tz, 1 - Math.pow(0.001, dt));
      r.yaw = THREE.MathUtils.lerp(r.yaw, r.tyaw, 1 - Math.pow(0.0008, dt));
      r.root.position.set(r.x, r.y, r.z);
      r.root.rotation.y = r.yaw + Math.PI;
      r.lastShoot = Math.max(0, r.lastShoot - dt);
      r.name.quaternion.copy(this.camera.quaternion);
      const hpParent = r.hpFill.parent;
      if (hpParent) hpParent.quaternion.copy(this.camera.quaternion);
      const hp = Math.max(0, Math.min(1, r.health / 100));
      r.hpFill.scale.x = Math.max(0.04, hp);
      r.hpFill.position.x = -0.43 * (1 - hp);
      (r.hpFill.material as THREE.MeshBasicMaterial).color.setHex(
        hp > 0.5 ? 0x9dff6a : hp > 0.25 ? 0xffcc33 : 0xff4d3a
      );
    }
  }

  private updateFx(dt: number) {
    for (const l of this.tracerPool) {
      if (!l.visible) continue;
      (l as any).life -= dt;
      const mat = l.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, (l as any).life * 10);
      if ((l as any).life <= 0) l.visible = false;
    }
    for (const m of this.impactPool) {
      if (!m.visible) continue;
      (m as any).life -= dt;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, (m as any).life * 6);
      m.scale.setScalar(1 + (0.18 - (m as any).life) * 8);
      if ((m as any).life <= 0) {
        m.visible = false;
        m.scale.setScalar(1);
      }
    }
  }

  private netTick() {
    const t = performance.now();
    if (this.ws && this.ws.readyState === 1 && t - this.lastSend > 50 && this.alive) {
      this.lastSend = t;
      this.ws.send(
        JSON.stringify({
          t: 'input',
          x: this.pos.x,
          y: this.pos.y,
          z: this.pos.z,
          yaw: this.yaw,
          pitch: this.pitch,
          crouch: this.crouch,
          sprint: this.sprinting,
          reload: this.reloading,
        })
      );
    }
    if (this.ws && this.ws.readyState === 1 && t - this.lastPing > 1500) {
      this.lastPing = t;
      this.ws.send(JSON.stringify({ t: 'ping', n: Date.now() }));
    }
  }

  private pushHud(force = false) {
    const scoreboard = [...this.scores.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (this.myId && !scoreboard.find((s) => s.id === this.myId)) {
      scoreboard.unshift({
        id: this.myId,
        name: this.myName,
        kills: this.kills,
        deaths: this.deaths,
        health: this.health,
        alive: this.alive,
        you: true,
      });
    } else {
      for (const s of scoreboard) {
        if (s.id === this.myId) {
          s.you = true;
          s.kills = this.kills;
          s.deaths = this.deaths;
          s.health = this.health;
          s.alive = this.alive;
          s.name = this.myName;
        }
      }
    }
    this.hooks.onHud({
      health: this.health,
      mag: this.mag,
      reserve: this.reserve,
      reloading: this.reloading,
      ads: this.ads,
      sprint: this.sprinting,
      grounded: this.grounded,
      alive: this.alive,
      kills: this.kills,
      deaths: this.deaths,
      players: Math.max(1, this.scores.size || 1),
      ping: this.ping,
      connected: this.connected,
      connecting: this.connecting,
      hitmarker: this.hitmarker,
      hurt: this.hurt,
      killfeed: this.killfeed,
      scoreboard,
      killedBy: this.killedBy,
      respawnIn: this.alive ? 0 : Math.max(0, this.respawnAt - performance.now()),
      load: this.load,
      loadMsg: this.loadMsg,
      ammoFlash: this.ammoFlash,
      headshot: this.headshotFx,
      adsBlend: this.adsBlend,
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLock);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    document.exitPointerLock?.();
    this.colliders.forEach((m) => {
      try {
        (m.geometry as any).disposeBoundsTree?.();
      } catch {
        /* ignore */
      }
    });
    this.renderer.dispose();
  }
}
