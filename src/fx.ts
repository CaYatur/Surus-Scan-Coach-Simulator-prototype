import * as THREE from 'three';

type Burst = {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
};

/**
 * Lightweight crash explosion — orange/yellow sphere Points, no extra deps.
 */
export class CrashFX {
  private bursts: Burst[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Spawn a short particle burst at world position. */
  explode(x: number, y: number, z: number, intensity = 1) {
    const count = Math.round(36 + intensity * 28);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = x + (Math.random() - 0.5) * 0.4;
      positions[i3 + 1] = y + 0.3 + Math.random() * 0.5;
      positions[i3 + 2] = z + (Math.random() - 0.5) * 0.4;

      const speed = (4 + Math.random() * 10) * (0.7 + intensity * 0.5);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.55;
      velocities[i3] = Math.cos(theta) * Math.sin(phi) * speed;
      velocities[i3 + 1] = Math.cos(phi) * speed * 0.85 + 2;
      velocities[i3 + 2] = Math.sin(theta) * Math.sin(phi) * speed;

      // orange → yellow
      const t = Math.random();
      colors[i3] = 1;
      colors[i3 + 1] = 0.35 + t * 0.55;
      colors[i3 + 2] = 0.05 + t * 0.15;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.35 + intensity * 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: 0.75 + intensity * 0.15,
    });
  }

  update(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const n = arr.length / 3;
      for (let j = 0; j < n; j++) {
        const j3 = j * 3;
        arr[j3] += b.velocities[j3] * dt;
        arr[j3 + 1] += b.velocities[j3 + 1] * dt;
        arr[j3 + 2] += b.velocities[j3 + 2] * dt;
        b.velocities[j3 + 1] -= 14 * dt; // gravity
      }
      pos.needsUpdate = true;

      const mat = b.points.material as THREE.PointsMaterial;
      const u = Math.min(1, b.life / b.maxLife);
      mat.opacity = 1 - u * u;
      mat.size = Math.max(0.05, mat.size * (1 - dt * 0.6));

      if (b.life >= b.maxLife) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        mat.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  clear() {
    for (const b of this.bursts) {
      this.scene.remove(b.points);
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
    }
    this.bursts.length = 0;
  }
}
