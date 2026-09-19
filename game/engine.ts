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

const MAG_SIZE = 20;
const RESERVE_MAX = 80;
const RELOAD_TIME = 3.58;
const FIRE_INTERVAL = 0.092;
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
  spr.position.y = 2.05;
  return spr;
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
  private camBone: THREE.Object3D | null = null;
  private muzzleBone: THREE.Object3D | null = null;
  private chestBone: THREE.Object3D | null = null;

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
    const ads = this.held('ads');
    const sens =
      0.00165 * this.settings.sensitivity * (ads ? this.settings.adsSensitivity : 1);
    this.yaw -= e.movementX * sens;
    const inv = this.settings.invertY ? -1 : 1;
    this.pitch -= e.movementY * sens * inv;
    this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch));
    this.sway += e.movementX * 0.00035;
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

      this.loadMsg = 'Deploying operator rig';
      const charGltf = await loader.loadAsync('/models/opponent.glb', (e) => {
        if (e.total) this.load = 0.58 + 0.32 * (e.loaded / e.total);
        this.pushHud(true);
      });
      this.template = charGltf.scene;
      this.clip = charGltf.animations[0] || null;
      this.setupLocal(SkeletonUtils.clone(this.template) as THREE.Object3D);
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
    this.sun.target.position.copy(c);
    this.spawnY = this.mapBox.max.y * 0.15 + 2;
  }

  private setupLocal(src: THREE.Object3D) {
    const model = src;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const m = mat as THREE.MeshStandardMaterial;
          const name = (m.name || '').toLowerCase();
          if (
            name.includes('hair') ||
            name.includes('mask') ||
            name.includes('glasses') ||
            name.includes('shoes') ||
            name.includes('pants')
          ) {
            mesh.visible = false;
          }
          if (m.depthTest !== undefined) {
            m.depthTest = true;
            m.depthWrite = true;
          }
        }
      }
      if (/CamBone/i.test(o.name)) this.camBone = o;
      if (/MuzzleFlash/i.test(o.name)) this.muzzleBone = o;
      if (/Chest_04/i.test(o.name)) this.chestBone = o;
    });
    this.localRoot.add(model);
    this.localMixer = new THREE.AnimationMixer(model);
    if (this.clip) {
      this.localReload = this.localMixer.clipAction(this.clip);
      this.localReload.setLoop(THREE.LoopOnce, 1);
      this.localReload.clampWhenFinished = true;
      this.localReload.enabled = true;
      this.localReload.paused = true;
      this.localReload.time = 0.02;
      this.localReload.play();
    }
    this.localMixer.addEventListener('finished', () => {
      if (this.localReload) {
        this.localReload.paused = true;
        this.localReload.time = 0.02;
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
      for (const p of msg.players) this.upsertScore(p);
      return;
    }
    if (msg.t === 'state') {
      for (const p of msg.players) {
        this.upsertScore(p);
        if (p.id === this.myId) continue;
        this.syncRemote(p);
      }
      return;
    }
    if (msg.t === 'join') {
      this.upsertScore(msg.player);
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
      if (this.invuln > 0) return;
      this.health = msg.health;
      this.hurt = 1;
      this.audio.hurt();
      this.vel.x += (msg.dirx || 0) * 1.4;
      this.vel.z += (msg.dirz || 0) * 1.4;
      if (this.health <= 0) this.onDeath(this.scores.get(msg.by)?.name || 'Operator');
      return;
    }
    if (msg.t === 'confirm') {
      this.hitmarker = 1;
      this.headshotFx = !!msg.head;
      this.audio.hit(msg.head);
      if (msg.kill) this.audio.kill();
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
      root.add(name);
      this.scene.add(root);
      r = {
        id: p.id,
        root,
        mixer,
        reload: reload!,
        name,
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
      };
      this.remotes.set(p.id, r);
    }
    r.tx = p.x;
    r.ty = p.y;
    r.tz = p.z;
    r.tyaw = p.yaw;
    r.tpitch = p.pitch;
    r.alive = p.alive;
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
      this.localReload.reset();
      this.localReload.paused = false;
      this.localReload.play();
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
    this.recoil += 0.028;
    this.pitch += 0.012;
    this.audio.gunshot(0);
    this.muzzleLight.intensity = 18;

    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.spawnTracer(origin, dir);

    this.raycaster.near = 0.05;
    this.raycaster.far = 120;
    this.raycaster.set(origin, dir);
    const worldHits = this.raycaster.intersectObjects(this.colliders, false);
    const worldT = worldHits[0]?.distance ?? 120;
    if (worldHits[0]) this.spark(worldHits[0].point, 0xffcc77);

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
    }

    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      const to = new THREE.Vector3(r.x, r.y + 1.1, r.z).sub(origin);
      const dist = to.length();
      if (dist > worldT + 0.2) continue;
      const nd = dir.dot(to.normalize());
      const rad = 0.45 / Math.max(1, dist);
      if (nd > 1 - rad * 0.35) {
        this.hitmarker = 0.6;
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
    this.recoil = THREE.MathUtils.lerp(this.recoil, 0, 1 - Math.pow(0.001, dt));
    this.sway = THREE.MathUtils.lerp(this.sway, 0, 1 - Math.pow(0.02, dt));
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 90);

    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }

    this.ads = this.alive && !this.paused && this.held('ads');
    const targetFov = this.ads ? this.settings.fov * 0.62 : this.settings.fov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
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
    next.y += this.vel.y * dt;
    this.resolveFloor(next);
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

  private updateCamera(_dt: number) {
    const eye = this.crouch ? CROUCH_EYE : STAND_EYE;
    const bobX = Math.sin(this.bob) * 0.018 * (this.grounded ? 1 : 0);
    const bobY = Math.abs(Math.cos(this.bob)) * 0.022 * (this.grounded ? 1 : 0);
    this.camera.position.set(
      this.pos.x + bobX,
      this.pos.y + eye + bobY - this.recoil * 0.12,
      this.pos.z
    );
    this.camera.rotation.set(this.pitch - this.recoil * 0.55, this.yaw, -this.sway * 0.35, 'YXZ');
    this.camera.updateMatrixWorld(true);

    this.localRoot.position.set(0, 0, 0);
    this.localRoot.quaternion.identity();
    this.localRoot.scale.set(1, 1, 1);
    this.localRoot.updateMatrixWorld(true);

    if (this.camBone && this.alive) {
      this.mtx1.copy(this.camera.matrixWorld).invert();
      this.mtx1.multiply(this.camBone.matrixWorld);
      this.mtx2.makeTranslation(0, 0, -0.12).multiply(this.mtx1.invert());
      this.mtx2.decompose(this.localRoot.position, this.localRoot.quaternion, this.tmp2);
      this.localRoot.scale.set(1, 1, 1);
    } else {
      this.localRoot.position.set(0.08, -1.56, -0.2);
      this.localRoot.rotation.set(0.02, Math.PI, 0);
    }
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
      r.root.rotation.y = r.yaw;
      r.lastShoot = Math.max(0, r.lastShoot - dt);
      r.name.quaternion.copy(this.camera.quaternion);
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
