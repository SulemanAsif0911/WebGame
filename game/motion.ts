import * as THREE from 'three';

/** Critically-damped viewmodel motion: recoil, sway, and a staged reload. */
export class GunMotion {
  off = new THREE.Vector3();
  rot = new THREE.Euler(0, 0, 0, 'YXZ');
  private offVel = new THREE.Vector3();
  private rotVel = new THREE.Vector3();
  private time = 0;
  private walk = 0;

  reloadT = 0;
  reloading = false;
  private reloadDur = 2.35;

  update(dt: number) {
    this.time += dt;
    if (this.reloading) {
      this.reloadT += dt;
      const p = Math.min(1, this.reloadT / this.reloadDur);
      this.applyReloadPose(p);
      return;
    }

    const breatheY = Math.sin(this.time * 2.05) * 0.004 * (1 + this.walk * 0.35);
    const idleX = Math.sin(this.time * 0.72) * 0.0025;
    const k = 36;
    const c = 13;
    const tx = idleX;
    const ty = breatheY;
    this.offVel.x += (tx - this.off.x) * k * dt - this.offVel.x * c * dt;
    this.offVel.y += (ty - this.off.y) * k * dt - this.offVel.y * c * dt;
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
    this.rotVel.y += dx * 0.0016;
    this.rotVel.x += dy * 0.0012;
    this.offVel.x += dx * 0.00012;
    this.offVel.y -= dy * 0.00008;
  }

  kick() {
    this.offVel.z += 0.55;
    this.offVel.y += 0.12;
    this.rotVel.x -= 0.55;
    this.rotVel.z += (Math.random() - 0.5) * 0.18;
  }

  startReload(dur: number) {
    this.reloading = true;
    this.reloadT = 0;
    this.reloadDur = Math.max(0.8, dur);
    this.offVel.y -= 0.55;
    this.rotVel.x += 0.7;
    this.rotVel.z += 0.25;
  }

  /** 0..1 choreography used by the engine to move mag/bolt nodes. */
  phase() {
    if (!this.reloading) return 0;
    return Math.min(1, this.reloadT / this.reloadDur);
  }

  private applyReloadPose(p: number) {
    if (p < 0.22) {
      const u = p / 0.22;
      this.off.y = -0.08 * u;
      this.off.x = 0.04 * u;
      this.rot.x = 0.55 * u;
      this.rot.z = 0.22 * u;
    } else if (p < 0.55) {
      const u = (p - 0.22) / 0.33;
      this.off.y = -0.08 - 0.04 * Math.sin(u * Math.PI);
      this.off.x = 0.05;
      this.rot.x = 0.55 + 0.15 * Math.sin(u * Math.PI);
      this.rot.z = 0.18;
    } else if (p < 0.78) {
      const u = (p - 0.55) / 0.23;
      this.off.y = -0.12 + 0.04 * u;
      this.rot.x = 0.7 - 0.35 * u;
      this.rot.y = 0.12 * Math.sin(u * Math.PI);
    } else {
      const u = (p - 0.78) / 0.22;
      const s = 1 - u;
      this.off.y = -0.08 * s;
      this.off.x = 0.05 * s;
      this.rot.x = 0.35 * s;
      this.rot.z = 0.18 * s;
    }
  }
}
