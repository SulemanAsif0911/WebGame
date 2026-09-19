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

function hudBits(name: string) {
  const tex = labelTexture(name);
  const nameSpr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  nameSpr.scale.set(1.7, 0.42, 1);
  nameSpr.position.y = 2.22;

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

  const setName = (n: string) => {
    const t = labelTexture(n);
    const old = nameSpr.material.map;
    nameSpr.material.map = t;
    nameSpr.material.needsUpdate = true;
    old?.dispose();
  };

  return { nameSpr, hpFill, hpG, setName };
}

function ghostMat() {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });
}

/** Wrap opponent.glb so it stays visible, hittable, and named. */
export function mountOpponent(
  clone: THREE.Object3D,
  name: string,
  scale: number,
  offsetY: number
): OperatorRig {
  const group = new THREE.Group();
  clone.scale.setScalar(scale);
  clone.position.set(0, offsetY, 0);
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.visible = true;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  group.add(clone);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.72, 3, 8), ghostMat());
  torso.position.y = 0.98;
  torso.userData.isHead = false;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), ghostMat());
  head.position.y = 1.64;
  head.userData.isHead = true;
  group.add(torso, head);

  const { nameSpr, hpFill, hpG, setName } = hudBits(name);
  group.add(nameSpr, hpG);
  group.frustumCulled = false;

  return {
    group,
    head,
    torso,
    hitMeshes: [torso, head],
    nameSpr,
    hpFill,
    gun: group,
    setName,
  };
}

export function buildOperator(name: string, accent = 0xd6ff3a): OperatorRig {
  const group = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: 0x3a4036, roughness: 0.72, metalness: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c18, roughness: 0.7 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const torso = add(new THREE.BoxGeometry(0.52, 0.68, 0.3), uniform, 0, 1.18, 0);
  const head = add(new THREE.BoxGeometry(0.34, 0.34, 0.34), dark, 0, 1.62, 0);
  add(new THREE.BoxGeometry(0.2, 0.68, 0.22), uniform, -0.15, 0.42, 0);
  add(new THREE.BoxGeometry(0.2, 0.68, 0.22), uniform, 0.15, 0.42, 0);
  head.userData.isHead = true;
  torso.userData.isHead = false;
  const { nameSpr, hpFill, hpG, setName } = hudBits(name);
  group.add(nameSpr, hpG);
  group.frustumCulled = false;
  const gun = new THREE.Group();
  group.add(gun);
  return { group, head, torso, hitMeshes: [torso, head], nameSpr, hpFill, gun, setName };
}
