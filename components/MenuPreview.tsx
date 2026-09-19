'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export default function MenuPreview() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x10151c, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x6f8494, 20, 90);
    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
    scene.add(new THREE.HemisphereLight(0xc9dff2, 0x3b2a1c, 0.8));
    const sun = new THREE.DirectionalLight(0xffe6c8, 2.1);
    sun.position.set(30, 50, 12);
    scene.add(sun);

    let map: THREE.Object3D | null = null;
    let center = new THREE.Vector3();
    const loader = new GLTFLoader();
    loader.load('/models/map.glb', (gltf) => {
      map = gltf.scene;
      map.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = true;
        }
      });
      scene.add(map);
      const box = new THREE.Box3().setFromObject(map);
      center = box.getCenter(new THREE.Vector3());
    });

    let raf = 0;
    let t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = (performance.now() - t0) / 1000;
      const r = 28;
      camera.position.set(
        center.x + Math.cos(t * 0.12) * r,
        center.y + 14 + Math.sin(t * 0.2) * 2,
        center.z + Math.sin(t * 0.12) * r
      );
      camera.lookAt(center.x, center.y + 2, center.z);
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ref} className="menu-canvas" />;
}
