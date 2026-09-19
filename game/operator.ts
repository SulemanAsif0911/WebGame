import * as THREE from 'three';

export type OperatorRig = {
  group: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  hitMeshes: THREE.Mesh[];
  nameSpr: THREE.Sprite;
  hpFill: THREE.Mesh;
  gun: THREE.Group;
  setName: (name: string) => void;
};

function mat(color: number, extras: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.12,
    ...extras,
  });
}

function labelTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 128);
  g.font = '700 46px Rajdhani, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.9)';
  g.strokeText(text, 256, 64);
  g.fillStyle = '#f4f0e6';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function buildOperator(name: string, accent = 0xd6ff3a): OperatorRig {
  const group = new THREE.Group();
  const uniform = mat(0x3a4036);
  const dark = mat(0x1a1c18);
  const vest = mat(0x2a261c);
  const boots = mat(0x141512, { roughness: 0.85 });
  const accentM = mat(accent, { emissive: accent, emissiveIntensity: 0.28, metalness: 0.3 });
  const visor = mat(0x0b1014, { metalness: 0.7, roughness: 0.22 });
  const gunMetal = mat(0x2c3034, { metalness: 0.65, roughness: 0.35 });

  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  const torso = add(new THREE.BoxGeometry(0.52, 0.68, 0.30), uniform, 0, 1.18, 0);
  add(new THREE.BoxGeometry(0.48, 0.40, 0.10), vest, 0, 1.28, -0.18);
  add(new THREE.BoxGeometry(0.12, 0.12, 0.10), accentM, -0.14, 1.14, -0.22);
  add(new THREE.BoxGeometry(0.12, 0.12, 0.10), accentM, 0.14, 1.14, -0.22);
  add(new THREE.BoxGeometry(0.54, 0.08, 0.32), accentM, 0, 0.84, 0);
  add(new THREE.BoxGeometry(0.16, 0.14, 0.34), vest, -0.36, 1.46, 0);
  add(new THREE.BoxGeometry(0.16, 0.14, 0.34), vest, 0.36, 1.46, 0);
  add(new THREE.BoxGeometry(0.32, 0.46, 0.12), vest, 0, 1.22, 0.22);

  const head = add(new THREE.BoxGeometry(0.34, 0.34, 0.34), dark, 0, 1.62, 0);
  add(new THREE.BoxGeometry(0.28, 0.09, 0.05), visor, 0, 1.62, -0.18);
  add(new THREE.BoxGeometry(0.38, 0.08, 0.38), uniform, 0, 1.80, 0);
  add(new THREE.BoxGeometry(0.40, 0.04, 0.40), accentM, 0, 1.76, 0);

  const armL = add(new THREE.BoxGeometry(0.15, 0.50, 0.16), uniform, -0.34, 1.28, -0.20);
  armL.rotation.x = -1.12;
  const armR = add(new THREE.BoxGeometry(0.15, 0.50, 0.16), uniform, 0.32, 1.28, -0.24);
  armR.rotation.x = -1.28;

  add(new THREE.BoxGeometry(0.20, 0.68, 0.22), boots, -0.15, 0.42, 0);
  add(new THREE.BoxGeometry(0.20, 0.68, 0.22), boots, 0.15, 0.42, 0);

  const gun = new THREE.Group();
  gun.position.set(0.26, 1.32, -0.34);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.52), gunMetal);
  barrel.position.set(0, 0.02, -0.18);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.07), gunMetal);
  mag.position.set(0, -0.10, 0.02);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.16), gunMetal);
  stock.position.set(0, 0.01, 0.22);
  gun.add(barrel, mag, stock);
  gun.frustumCulled = false;
  group.add(gun);

  head.userData.isHead = true;
  torso.userData.isHead = false;
  const hitBody = torso;
  const hitHead = head;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  group.add(blob);

  const tex = labelTexture(name);
  const nameSpr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  nameSpr.scale.set(1.7, 0.42, 1);
  nameSpr.position.y = 2.22;
  group.add(nameSpr);

  const hpG = new THREE.Group();
  const hpBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x140808, depthTest: false, transparent: true, opacity: 0.85 })
  );
  const hpFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x9dff6a, depthTest: false })
  );
  hpFill.position.z = 0.002;
  hpG.add(hpBg, hpFill);
  hpG.position.y = 1.96;
  group.add(hpG);

  group.frustumCulled = false;

  const setName = (n: string) => {
    const t = labelTexture(n);
    const old = nameSpr.material.map;
    nameSpr.material.map = t;
    nameSpr.material.needsUpdate = true;
    old?.dispose();
  };

  return {
    group,
    head,
    torso,
    hitMeshes: [hitBody, hitHead],
    nameSpr,
    hpFill,
    gun,
    setName,
  };
}
