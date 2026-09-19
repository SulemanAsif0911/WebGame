import * as THREE from 'three';

/** Viewmodel: recoil kick that recovers, idle breathe, and a physical reload. */
export class GunMotion {
  off = new THREE.Vector3();
  rot = new THREE.Euler(0, 0, 0, 'YXZ');
  private offVel = new THREE.Vector3();
  private rotVel = new THREE.Vector3();
  private time = 0;
  private walk = 0;

  reloadT = 0;
  reloading = false;
  private reloadDur = 2.55;

  update(dt: number) {
    this.time += dt;
    if (this.reloading) {
      this.reloadT += dt;
      const p = Math.min(1, this.reloadT / this.reloadDur);
      this.applyReloadPose(p);
      return;
    }

    const breatheY = Math.sin(this.time * 1.65) * 0.0032 * (1 + this.walk * 0.4);
    const idleX = Math.sin(this.time * 0.62) * 0.002;
    const k = 42;
    const c = 14.5;
    this.offVel.x += (idleX - this.off.x) * k * dt - this.offVel.x * c * dt;
    this.offVel.y += (breatheY - this.off.y) * k * dt - this.offVel.y * c * dt;
    this.offVel.z += (0 - this.off.z) * k * dt - this.offVel.z * c * dt;
    this.off.addScaledVector(this.offVel, dt);

    this.rotVel.x += (0 - this.rot.x) * k * dt - this.rotVel.x * c * dt;
    this.rotVel.y += (0 - this.rot.y) * k * dt - this.rotVel.y * c * dt;
    this.rotVel.z += (0 - this.rot.z) * k * dt - this.rotVel.z * c * dt;
    this.rot.x += this.rotVel.x * dt;
    this.rot.y += this.rotVel.y * dt;
    this.rot.z += this.rotVel.z * dt;
  }

  setWalk(v: number) {
    this.walk = v;
  }

  sway(dx: number, dy: number) {
    const sx = THREE.MathUtils.clamp(dx, -28, 28);
    const sy = THREE.MathUtils.clamp(dy, -28, 28);
    this.rotVel.y += sx * 0.0009;
    this.rotVel.x += sy * 0.0007;
    this.offVel.x += sx * 0.00006;
    this.offVel.y -= sy * 0.00004;
  }

  kick(ads = 0) {
    const s = THREE.MathUtils.lerp(1, 0.42, ads);
    this.offVel.z += 1.15 * s;
    this.offVel.y += 0.28 * s;
    this.offVel.x += (Math.random() - 0.5) * 0.18 * s;
    this.rotVel.x -= 1.15 * s;
    this.rotVel.z += (Math.random() - 0.5) * 0.55 * s;
    this.rotVel.y += (Math.random() - 0.5) * 0.22 * s;
  }

  startReload(dur: number) {
    this.reloading = true;
    this.reloadT = 0;
    this.reloadDur = Math.max(0.8, dur);
  }

  phase() {
    if (!this.reloading) return 0;
    return Math.min(1, this.reloadT / this.reloadDur);
  }

  private applyReloadPose(p: number) {
    // Mag-out cant → drop → seat → slap → bolt → present
    if (p < 0.12) {
      const u = p / 0.12;
      this.off.set(0.05 * u, -0.04 * u, 0.03 * u);
      this.rot.x = 0.42 * u;
      this.rot.y = -0.08 * u;
      this.rot.z = 0.38 * u;
    } else if (p < 0.34) {
      const u = (p - 0.12) / 0.22;
      this.off.set(0.07, -0.06 - 0.03 * u, 0.04);
      this.rot.x = 0.48 + 0.12 * u;
      this.rot.y = -0.1;
      this.rot.z = 0.42 + 0.08 * Math.sin(u * Math.PI);
    } else if (p < 0.5) {
      const u = (p - 0.34) / 0.16;
      this.off.set(0.06, -0.1 + 0.02 * u, 0.05);
      this.rot.x = 0.6 - 0.08 * u;
      this.rot.z = 0.4;
    } else if (p < 0.7) {
      const u = (p - 0.5) / 0.2;
      const slam = Math.sin(u * Math.PI);
      this.off.set(0.04, -0.08 + 0.05 * u, 0.03 - 0.04 * slam);
      this.rot.x = 0.5 - 0.22 * u;
      this.rot.y = 0.06 * slam;
      this.rot.z = 0.32 * (1 - u);
    } else if (p < 0.88) {
      const u = (p - 0.7) / 0.18;
      const rack = Math.sin(u * Math.PI);
      this.off.set(0.015, -0.02, 0.02 + 0.045 * rack);
      this.rot.x = 0.22 - 0.18 * u + rack * 0.08;
      this.rot.y = 0;
      this.rot.z = 0.08 * (1 - u);
    } else {
      const u = (p - 0.88) / 0.12;
      const s = 1 - u;
      this.off.set(0.01 * s, -0.015 * s, 0.01 * s);
      this.rot.x = 0.08 * s;
      this.rot.y = 0;
      this.rot.z = 0.04 * s;
    }
  }
}
