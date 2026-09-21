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
import { buildOperator, mountOpponent, type OperatorRig } from './operator';
import { GunMotion } from './motion';
import { loadGunAlign, saveGunAlign, type GunAlign } from './gunAlign';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const MAG_SIZE = 30;
const RELOAD_TIME = 2.55;
const FIRE_INTERVAL = 0.092;
export const MAX_HP = 200;
const BODY_DMG = 38;
const HEAD_DMG = 95;
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
  reloadProg: number;
  maxHealth: number;
  gunTune: boolean;
  gunAlign: GunAlign;
};

export type EngineHooks = {
  onHud: (h: HudState) => void;
  onPause: (paused: boolean) => void;
};

type RemoteVis = {
  id: number;
  root: THREE.Group;
  rig: OperatorRig;
  mixer: THREE.AnimationMixer | null;
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
  private clipNode: THREE.Object3D | null = null;
  private boltNode: THREE.Object3D | null = null;
  private clipHome = new THREE.Vector3();
  private boltHome = new THREE.Vector3();
  private gunMotion = new GunMotion();
  private pendingPlayers: any[] = [];
  private adsBlend = 0;
  private adsVel = 0;
  private lookBufX = 0;
  private lookBufY = 0;
  private gunPos = new THREE.Vector3();
  private gunRot = new THREE.Euler(0, 0, 0, 'YXZ');
  private gunAlign: GunAlign = loadGunAlign();
  private gunTune = false;
  private hipHold = new THREE.Vector3(0, 0, 0);
  private adsHold = new THREE.Vector3(-0.012, 0.028, 0.1);
  private lastSpawn = -1;
  private muzzleFlash: THREE.Mesh | null = null;
  private recSide = 0;
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
  private health = MAX_HP;
  private mag = MAG_SIZE;
  private reserve = -1;
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
    if (!this.locked && this.everLocked && this.alive && !this.paused && !this.gunTune) {
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
    if (e.code === 'Backquote') {
      e.preventDefault();
      this.toggleGunTune();
      return;
    }
    this.keys.add(e.code);
    if (this.paused || this.gunTune) return;
    if (this.isBound('reload', e.code)) this.startReload();
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private onMouseDown(e: MouseEvent) {
    this.mouseDown.add(e.button);
    if (!this.locked && !this.paused && !this.gunTune && this.alive) {
      this.requestLock();
      return;
    }
    if (this.paused || this.gunTune) return;
    if (this.isBound('fire', 'Mouse' + e.button)) this.tryFire();
  }

  private onMouseUp(e: MouseEvent) {
    this.mouseDown.delete(e.button);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.locked || this.paused || this.gunTune || !this.alive) return;
    const mx = THREE.MathUtils.clamp(e.movementX, -90, 90);
    const my = THREE.MathUtils.clamp(e.movementY, -90, 90);
    this.lookBufX += mx;
    this.lookBufY += my;
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
      if (/^clip$/i.test(o.name) || /magazine|mag$/i.test(o.name)) this.clipNode = o;
      if (/^bolt$/i.test(o.name) || /charging/i.test(o.name)) this.boltNode = o;
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
    if (this.clipNode) this.clipHome.copy(this.clipNode.position);
    if (this.boltNode) this.boltHome.copy(this.boltNode.position);

    const flashGeo = new THREE.PlaneGeometry(0.08, 0.08);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe6a8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlash.position.set(0.02, -0.02, -0.42);
    this.muzzleFlash.visible = false;
    this.localRoot.add(this.muzzleFlash);

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

  private decodePos(x: number, z: number) {
    const c = this.arenaCenter;
    const away = Math.hypot(x - c.x, z - c.z);
    if (away > this.arenaRadius + 8 && Math.hypot(x, z) < 42) {
      return { x: c.x + x, z: c.z + z };
    }
    return { x, z };
  }

  private groundAt(x: number, z: number, fromY = 40) {
    this.raycaster.far = 80;
    this.raycaster.near = 0.01;
    this.raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length) return hits[0].point.y;
    return this.mapBox.min.y;
  }

  private placeAtSafeSpawn(_index?: number) {
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
      [18, -8],
      [-8, 18],
      [6, -18],
      [-18, -6],
    ];
    let index = Math.floor(Math.random() * ring.length);
    if (index === this.lastSpawn) index = (index + 1 + Math.floor(Math.random() * (ring.length - 1))) % ring.length;
    this.lastSpawn = index;
    const [baseX, baseZ] = ring[index];
    const dx = baseX + (Math.random() * 4 - 2);
    const dz = baseZ + (Math.random() * 4 - 2);
    const x = c.x + dx;
    const z = c.z + dz;
    const y = this.groundAt(x, z, this.mapBox.max.y + 8) + 0.05;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(c.x - x, c.z - z) + (Math.random() * 0.6 - 0.3);
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
      this.ws?.send(JSON.stringify({ t: 'join', name: this.myName }));
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
      if (msg.name) this.myName = msg.name;
      this.health = msg.you?.hp ?? msg.you?.health ?? MAX_HP;
      this.alive = msg.you?.alive !== false;
      this.kills = msg.you?.kills || 0;
      this.deaths = msg.you?.deaths || 0;
      this.placeAtSafeSpawn();
      const others = msg.players || [];
      for (const p of others) this.spawnRemote(p);
      return;
    }
    if (msg.t === 'join' && msg.player) {
      if (msg.player.id !== this.myId) this.spawnRemote(msg.player);
      return;
    }
    if (msg.t === 'snap' && Array.isArray(msg.p)) {
      this.applySnap(msg.p);
      return;
    }
    if (msg.t === 'state' && Array.isArray(msg.players)) {
      for (const p of msg.players) {
        if (p.id === this.myId) continue;
        this.spawnRemote(p);
      }
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
      if (r) r.rig.setName(msg.name);
      return;
    }
    if (msg.t === 'shoot' && msg.id !== this.myId) {
      const r = this.remotes.get(msg.id);
      if (r) {
        this.audio.gunshot(this.pos.distanceTo(new THREE.Vector3(r.x, r.y, r.z)));
        const o = msg.o || [msg.ox, msg.oy, msg.oz];
        const d = msg.d || [msg.dx, msg.dy, msg.dz];
        if (o && d) this.spawnTracer(new THREE.Vector3(o[0], o[1], o[2]), new THREE.Vector3(d[0], d[1], d[2]));
      }
      return;
    }
    if (msg.t === 'hp') {
      if (msg.id === this.myId) {
        this.health = msg.hp;
        this.hurt = 1;
        this.audio.hurt();
        if (this.health <= 0) this.onDeath(this.scores.get(msg.from)?.name || 'Operator');
      }
      const s = this.scores.get(msg.id);
      if (s) {
        s.health = msg.hp;
        s.alive = msg.hp > 0;
      }
      const r = this.remotes.get(msg.id);
      if (r) {
        r.health = msg.hp;
        r.alive = msg.hp > 0;
      }
      return;
    }
    if (msg.t === 'hurt') {
      this.health = typeof msg.health === 'number' ? msg.health : this.health;
      this.hurt = 1;
      this.audio.hurt();
      if (this.health <= 0) this.onDeath(this.scores.get(msg.by)?.name || 'Operator');
      return;
    }
    if (msg.t === 'confirm') {
      this.hitmarker = 1;
      this.headshotFx = !!msg.head;
      this.audio.hit(msg.head);
      if (msg.kill) this.audio.kill();
      const r = this.remotes.get(msg.target);
      if (r && typeof msg.health === 'number') {
        r.health = msg.health;
        r.alive = msg.health > 0;
        r.root.visible = msg.health > 0;
      }
      return;
    }
    if (msg.t === 'kill') {
      const killer = msg.killer?.name || msg.killer || 'Operator';
      const victim = msg.victim?.name || msg.name || 'Operator';
      const kid = msg.killer?.id ?? msg.by;
      const vid = msg.victim?.id ?? msg.id;
      this.pushFeed(`${killer}  ▸  ${victim}${msg.head ? '  · HS' : ''}`, !!msg.head);
      if (kid === this.myId) this.kills = msg.killer?.kills ?? this.kills + 1;
      if (vid === this.myId) {
        this.deaths = msg.victim?.deaths ?? this.deaths + 1;
        if (this.alive) this.onDeath(killer);
      }
      const ks = this.scores.get(kid);
      if (ks && msg.killer?.kills != null) ks.kills = msg.killer.kills;
      const vs = this.scores.get(vid);
      if (vs) {
        vs.alive = false;
        vs.health = 0;
        if (msg.victim?.deaths != null) vs.deaths = msg.victim.deaths;
      }
      const dead = this.remotes.get(vid);
      if (dead) {
        dead.alive = false;
        dead.health = 0;
        dead.root.visible = false;
      }
      return;
    }
    if (msg.t === 'respawn' || msg.t === 'spawn') {
      const id = msg.id;
      if (id === this.myId) {
        this.alive = true;
        this.health = msg.hp ?? MAX_HP;
        this.killedBy = null;
        this.invuln = 0.4;
        this.placeAtSafeSpawn();
        this.mag = MAG_SIZE;
      } else {
        const r = this.remotes.get(id);
        if (r) {
          r.alive = true;
          r.health = MAX_HP;
          r.root.visible = true;
          const w = this.decodePos(msg.x || 0, msg.z || 0);
          r.tx = w.x;
          r.tz = w.z;
          const gy = this.groundAt(w.x, w.z, 48);
          r.ty = Number.isFinite(gy) ? gy : r.ty;
        }
      }
      const s = this.scores.get(id);
      if (s) {
        s.alive = true;
        s.health = MAX_HP;
      }
      return;
    }
    if (msg.t === 'pong') {
      this.ping = Math.max(0, Date.now() - msg.n);
      return;
    }
  }

  private applySnap(rows: any[]) {
    const seen = new Set<number>();
    for (const n of rows) {
      const id = n[0];
      const x = n[1], y = n[2], z = n[3], yaw = n[4], pitch = n[5];
      const hp = n[6], alive = n[7] === 1, kills = n[8], deaths = n[9];
      seen.add(id);
      this.scores.set(id, {
        id,
        name: this.scores.get(id)?.name || (id === this.myId ? this.myName : 'Operator'),
        kills,
        deaths,
        health: hp,
        alive,
        you: id === this.myId,
      });
      if (id === this.myId) {
        if (alive) this.health = hp;
        this.kills = kills;
        this.deaths = deaths;
        continue;
      }
      let r = this.remotes.get(id);
      if (!r) {
        this.spawnRemote({ id, name: this.scores.get(id)?.name || 'Operator', x, y, z, yaw, pitch, hp, alive });
        r = this.remotes.get(id);
        if (!r) continue;
      }
      const w = this.decodePos(x, z);
      r.tx = w.x;
      r.tz = w.z;
      if (typeof y === 'number' && y > 0.05) r.ty = y;
      else {
        const gy = this.groundAt(w.x, w.z, 48);
        if (Number.isFinite(gy)) r.ty = gy;
      }
      r.tyaw = yaw;
      r.tpitch = pitch;
      r.health = hp;
      r.alive = alive;
      r.root.visible = alive;
    }
    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) {
        const r = this.remotes.get(id);
        if (r) this.scene.remove(r.root);
        this.remotes.delete(id);
        this.scores.delete(id);
      }
    }
  }

  private spawnRemote(p: any) {
    if (!p || p.id === this.myId) return;
    if (this.remotes.has(p.id)) {
      const r = this.remotes.get(p.id)!;
      if (p.name) r.rig.setName(p.name);
      return;
    }
    let rig: OperatorRig;
    let mixer: THREE.AnimationMixer | null = null;
    if (this.template) {
      const clone = SkeletonUtils.clone(this.template) as THREE.Object3D;
      rig = mountOpponent(clone, p.name || 'Operator', this.charScale, this.charOffsetY);
      if (this.clip) {
        mixer = new THREE.AnimationMixer(clone);
        const pose = mixer.clipAction(this.clip);
        pose.paused = true;
        pose.time = 0.02;
        pose.play();
      }
    } else {
      rig = buildOperator(p.name || 'Operator', 0xd6ff3a);
    }
    rig.hitMeshes.forEach((m) => {
      m.userData.pid = p.id;
    });
    const root = rig.group;
    this.scene.add(root);
    const decoded = this.decodePos(p.x || 0, p.z || 0);
    const px = decoded.x;
    const pz = decoded.z;
    const gy = this.colliders.length ? this.groundAt(px, pz, 48) : p.y || 0;
    const y = Number.isFinite(gy) ? gy : 0;
    const r: RemoteVis = {
      id: p.id,
      root,
      rig,
      mixer,
      x: px,
      y,
      z: pz,
      yaw: p.yaw || 0,
      pitch: p.pitch || 0,
      tx: px,
      ty: y,
      tz: pz,
      tyaw: p.yaw || 0,
      tpitch: p.pitch || 0,
      alive: p.alive !== false,
      health: p.hp ?? p.health ?? MAX_HP,
    };
    root.position.set(r.x, r.y, r.z);
    root.visible = r.alive;
    this.remotes.set(p.id, r);
    this.upsertScore({
      id: p.id,
      name: p.name || 'Operator',
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      health: r.health,
      alive: r.alive,
    });
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

  private onDeath(by: string) {
    this.alive = false;
    this.health = 0;
    this.deaths += 1;
    this.killedBy = by;
    this.respawnAt = performance.now() + 3200;
    this.ads = false;
  }

  private startReload() {
    if (!this.alive || this.reloading || this.mag === MAG_SIZE) return;
    this.reloading = true;
    this.reloadT = RELOAD_TIME;
    this.ads = false;
    this.audio.reload();
    this.gunMotion.startReload(RELOAD_TIME);
    if (this.localReload) {
      this.fpvFire?.stop();
      this.fpvIdle?.fadeOut(0.08);
      this.localReload.reset();
      this.localReload.paused = false;
      this.localReload.fadeIn(0.05).play();
    }
  }

  private animateReloadParts() {
    const p = this.gunMotion.phase();
    if (this.clipNode) {
      if (p <= 0) {
        this.clipNode.position.copy(this.clipHome);
        this.clipNode.rotation.set(0, 0, 0);
        this.clipNode.visible = true;
      } else if (p < 0.12) {
        const u = p / 0.12;
        this.clipNode.position.copy(this.clipHome);
        this.clipNode.position.y -= u * 0.04;
        this.clipNode.rotation.z = u * 0.15;
        this.clipNode.visible = true;
      } else if (p < 0.34) {
        const u = (p - 0.12) / 0.22;
        const grav = u * u;
        this.clipNode.visible = true;
        this.clipNode.position.copy(this.clipHome);
        this.clipNode.position.y -= 0.04 + grav * 0.55;
        this.clipNode.position.x += u * 0.08;
        this.clipNode.rotation.x = u * 1.6;
        this.clipNode.rotation.z = 0.15 + u * 1.2;
      } else if (p < 0.48) {
        this.clipNode.visible = false;
        this.clipNode.position.copy(this.clipHome);
      } else if (p < 0.7) {
        const u = (p - 0.48) / 0.22;
        this.clipNode.visible = true;
        this.clipNode.position.copy(this.clipHome);
        this.clipNode.position.y -= (1 - u) * (1 - u) * 0.28;
        this.clipNode.rotation.x = (1 - u) * 0.7;
        this.clipNode.rotation.z = (1 - u) * 0.2;
      } else {
        this.clipNode.visible = true;
        this.clipNode.position.copy(this.clipHome);
        this.clipNode.rotation.set(0, 0, 0);
      }
    }
    if (this.boltNode) {
      this.boltNode.position.copy(this.boltHome);
      if (p > 0.72 && p < 0.9) {
        const u = (p - 0.72) / 0.18;
        const kick = Math.sin(u * Math.PI);
        this.boltNode.position.z += kick * 0.11;
      }
    }
  }

  private finishReload() {
    this.mag = MAG_SIZE;
    this.reloading = false;
    this.reloadT = 0;
    this.gunMotion.reloading = false;
    if (this.clipNode) {
      this.clipNode.visible = true;
      this.clipNode.position.copy(this.clipHome);
      this.clipNode.rotation.x = 0;
    }
    if (this.boltNode) this.boltNode.position.copy(this.boltHome);
  }

  private poseShotCamera() {
    this.applyLook(0);
    const adsT = this.smooth01(this.adsBlend);
    const eye = this.crouch ? CROUCH_EYE : STAND_EYE;
    const rec = THREE.MathUtils.lerp(1, 0.32, adsT);
    this.camera.position.set(this.pos.x, this.pos.y + eye, this.pos.z);
    this.camera.rotation.set(this.pitch - this.recoil * 0.42 * rec, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld(true);
  }

  private tryFire() {
    if (!this.alive || this.paused || this.reloading) return;
    if (this.fireCd > 0) return;
    if (this.mag <= 0) {
      this.ammoFlash = 1;
      this.startReload();
      return;
    }
    this.poseShotCamera();
    this.mag -= 1;
    this.fireCd = FIRE_INTERVAL;
    const adsKick = THREE.MathUtils.lerp(1, 0.34, this.adsBlend);
    const climb = 0.018 * adsKick + Math.random() * 0.006 * adsKick;
    this.recSide = THREE.MathUtils.clamp(this.recSide + (Math.random() - 0.42) * 0.01 * adsKick, -0.035, 0.035);
    this.recoil = Math.min(0.22, this.recoil + 0.055 * adsKick);
    this.pitch = Math.min(1.25, this.pitch + climb);
    this.yaw -= this.recSide * 0.55;
    this.audio.gunshot(0);
    this.muzzleLight.intensity = 28;
    if (this.muzzleFlash) {
      this.muzzleFlash.visible = true;
      (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = 0.95;
      this.muzzleFlash.rotation.z = Math.random() * Math.PI;
      this.muzzleFlash.scale.setScalar(0.7 + Math.random() * 0.8);
    }
    if (this.fpvFire) {
      this.fpvIdle?.fadeOut(0.04);
      this.fpvFire.reset();
      this.fpvFire.fadeIn(0.02).play();
    }

    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.normalize();
    this.spawnTracer(origin, dir);

    this.raycaster.near = 0.05;
    this.raycaster.far = 140;
    this.raycaster.set(origin, dir);
    const worldHits = this.raycaster.intersectObjects(this.colliders, false);
    if (worldHits[0]) this.spark(worldHits[0].point, 0xffcc77);
    const wallDist = worldHits[0] ? worldHits[0].distance : 999;

    const hitList: THREE.Object3D[] = [];
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      r.root.updateMatrixWorld(true);
      hitList.push(...r.rig.hitMeshes);
    }
    const bodyHits = hitList.length ? this.raycaster.intersectObjects(hitList, false) : [];

    let target: number | null = null;
    let head = false;
    let hitPoint: THREE.Vector3 | null = null;
    for (const hit of bodyHits) {
      const pid = hit.object.userData.pid;
      if (!pid) continue;
      if (hit.distance > wallDist + 0.02) continue;
      target = pid;
      head = !!hit.object.userData.isHead;
      hitPoint = hit.point;
      break;
    }

    if (target != null) {
      const r = this.remotes.get(target);
      if (r) {
        const dmg = head ? HEAD_DMG : BODY_DMG;
        r.health = Math.max(0, r.health - dmg);
        this.hitmarker = 1;
        this.headshotFx = head;
        this.spark(hitPoint || new THREE.Vector3(r.x, r.y + (head ? 1.6 : 1.1), r.z), head ? 0xffe0e0 : 0xff5533);
        if (r.health <= 0) {
          r.alive = false;
          r.root.visible = false;
        }
      }
    }

    this.gunMotion.kick(this.adsBlend);

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
        })
      );
      if (target != null) {
        this.ws.send(
          JSON.stringify({
            t: 'hit',
            target,
            dmg: head ? HEAD_DMG : BODY_DMG,
            head,
            ox: origin.x,
            oy: origin.y,
            oz: origin.z,
            dx: dir.x,
            dy: dir.y,
            dz: dir.z,
          })
        );
      }
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
    this.recoil = THREE.MathUtils.lerp(this.recoil, 0, 1 - Math.pow(0.0004, dt));
    this.recSide = THREE.MathUtils.lerp(this.recSide, 0, 1 - Math.pow(0.02, dt));
    this.sway = THREE.MathUtils.lerp(this.sway, 0, 1 - Math.pow(0.0008, dt));
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 110);
    if (this.muzzleFlash) {
      const mat = this.muzzleFlash.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, mat.opacity - dt * 14);
      if (mat.opacity <= 0.02) this.muzzleFlash.visible = false;
    }

    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }

    this.ads = this.alive && !this.paused && !this.gunTune && this.held('ads') && !this.reloading;
    this.applyLook(dt);
    this.stepAds(dt);
    const adsT = this.smooth01(this.adsBlend);
    const targetFov = THREE.MathUtils.lerp(this.settings.fov, 28, adsT);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 18);
    this.camera.near = THREE.MathUtils.lerp(0.045, 0.018, adsT);
    this.camera.updateProjectionMatrix();

    if (this.alive && !this.paused) this.move(dt);
    else this.vel.y = 0;

    if (this.held('fire') && this.locked && this.alive && !this.paused && !this.gunTune) this.tryFire();

    this.localMixer?.update(dt);
    this.gunMotion.setWalk(this.grounded && (this.vel.length() > 0.4) ? 1 : 0);
    this.gunMotion.update(dt);
    this.animateReloadParts();
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

  private applyLook(_dt: number) {
    if (!this.locked || this.paused || this.gunTune || !this.alive) {
      this.lookBufX = 0;
      this.lookBufY = 0;
      return;
    }
    const adsT = this.smooth01(this.adsBlend);
    const adsMul = THREE.MathUtils.lerp(1, this.settings.adsSensitivity * 0.45, adsT);
    const mx = this.lookBufX;
    const my = this.lookBufY;
    this.lookBufX = 0;
    this.lookBufY = 0;
    const sens = 0.00205 * this.settings.sensitivity * adsMul;
    this.yaw -= mx * sens;
    const inv = this.settings.invertY ? -1 : 1;
    this.pitch -= my * sens * inv;
    this.gunMotion.sway(mx, my);
    this.sway = THREE.MathUtils.clamp(this.sway + mx * 0.00008, -0.08, 0.08);
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
    const bobX = Math.sin(this.bob) * 0.014 * bobAmt;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.016 * bobAmt;
    const rec = THREE.MathUtils.lerp(1, 0.32, adsT);
    const roll = THREE.MathUtils.clamp(-this.sway * THREE.MathUtils.lerp(0.22, 0.04, adsT), -0.06, 0.06);
    this.camera.position.set(
      this.pos.x + bobX,
      this.pos.y + eye + bobY - this.recoil * 0.08 * rec,
      this.pos.z
    );
    this.camera.rotation.set(this.pitch - this.recoil * 0.42 * rec, this.yaw, roll, 'YXZ');
    this.camera.updateMatrixWorld(true);

    const a = this.gunAlign;
    const hip = new THREE.Vector3(
      this.hipHold.x + this.sway * 0.22 + a.x,
      this.hipHold.y + bobY * 0.4 + a.y,
      this.hipHold.z + a.z
    );
    const adsPos = new THREE.Vector3(this.adsHold.x + a.x * 0.25, this.adsHold.y + a.y * 0.25, this.adsHold.z + a.z * 0.2);
    const desired = hip.clone().lerp(adsPos, adsT);
    const follow = this.gunTune ? 1 : 1 - Math.pow(0.0008, dt);
    this.gunPos.lerp(desired, follow);

    const hipRotX = -this.recoil * 0.28 + a.rx;
    const hipRotY = this.sway * 0.08 + a.ry;
    const hipRotZ = -this.sway * 0.12 + a.rz;
    const adsRotX = -this.recoil * 0.08 + a.rx * 0.2;
    this.localRoot.position.copy(this.gunPos).add(this.gunMotion.off);
    this.localRoot.rotation.set(
      THREE.MathUtils.lerp(hipRotX, adsRotX, adsT) + this.gunMotion.rot.x,
      THREE.MathUtils.lerp(hipRotY, a.ry * 0.2, adsT) + this.gunMotion.rot.y,
      THREE.MathUtils.lerp(hipRotZ, a.rz * 0.15, adsT) + this.gunMotion.rot.z
    );

    const hideLens = adsT > 0.62;
    const hideArms = adsT > 0.48;
    for (const m of this.fpvLensMeshes) m.visible = !hideLens;
    for (const m of this.fpvArmMeshes) m.visible = !hideArms;

    if (!this.alive && this.killedBy) this.camera.position.y += 0.4;
  }

  private updateRemotes(dt: number) {
    for (const r of this.remotes.values()) {
      r.x = THREE.MathUtils.lerp(r.x, r.tx, 1 - Math.pow(0.0008, dt));
      r.y = THREE.MathUtils.lerp(r.y, r.ty, 1 - Math.pow(0.0008, dt));
      r.z = THREE.MathUtils.lerp(r.z, r.tz, 1 - Math.pow(0.0008, dt));
      r.yaw = THREE.MathUtils.lerp(r.yaw, r.tyaw, 1 - Math.pow(0.0005, dt));
      r.mixer?.update(dt);
      r.root.position.set(r.x, r.y, r.z);
      r.root.rotation.y = r.yaw + Math.PI;
      r.root.visible = r.alive;
      r.rig.nameSpr.quaternion.copy(this.camera.quaternion);
      const hpParent = r.rig.hpFill.parent;
      if (hpParent) hpParent.quaternion.copy(this.camera.quaternion);
      const hp = Math.max(0, Math.min(1, r.health / MAX_HP));
      r.rig.hpFill.scale.x = Math.max(0.04, hp);
      r.rig.hpFill.position.x = -0.42 * (1 - hp);
      (r.rig.hpFill.material as THREE.MeshBasicMaterial).color.setHex(
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
          t: 'state',
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
      reloadProg: this.reloading ? 1 - this.reloadT / RELOAD_TIME : 0,
      maxHealth: MAX_HP,
      gunTune: this.gunTune,
      gunAlign: { ...this.gunAlign },
    });
  }

  toggleGunTune() {
    this.gunTune = !this.gunTune;
    if (this.gunTune) {
      document.exitPointerLock?.();
    } else {
      saveGunAlign(this.gunAlign);
      this.requestLock();
    }
    this.pushHud(true);
  }

  setGunAlign(partial: Partial<GunAlign>) {
    this.gunAlign = { ...this.gunAlign, ...partial };
    saveGunAlign(this.gunAlign);
    this.pushHud(true);
  }

  resetGunAlign() {
    this.gunAlign = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
    saveGunAlign(this.gunAlign);
    this.pushHud(true);
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
