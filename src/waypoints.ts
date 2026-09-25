import * as THREE from 'three';
import { MAIN_ROAD_LENGTH, RIGHT_LANE_X } from './world';

export type WaypointResult = {
  index: number;
  timeSec: number;
  pathLengthApprox: number;
};

export class Waypoints {
  private markers: THREE.Group[] = [];
  private targets: THREE.Vector3[] = [];
  private current = 0;
  private segmentStart = 0;
  private pathAccum = 0;
  private lastPos = new THREE.Vector3();
  results: WaypointResult[] = [];
  total = 0;
  private scene: THREE.Scene;
  private ringMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ringMat = new THREE.MeshStandardMaterial({
      color: 0x44ff88,
      emissive: 0x118844,
      transparent: true,
      opacity: 0.85,
    });
  }

  /**
   * Right-lane checkpoints from just ahead of the car to the end of the main road.
   * `count` is ignored when nullish; always fills to the road end (~every 28 m).
   */
  start(carPos: THREE.Vector3, count?: number, _yaw = 0) {
    this.clear();
    this.results = [];
    this.current = 0;
    this.pathAccum = 0;
    this.lastPos.copy(carPos);
    this.segmentStart = performance.now() / 1000;

    const laneX = RIGHT_LANE_X;
    const zEnd = MAIN_ROAD_LENGTH - 25;
    const spacing = 28;
    const zFirst = Math.min(Math.max(carPos.z, 8) + 28, zEnd);
    this.targets = [];
    for (let z = zFirst; z <= zEnd + 0.01; z += spacing) {
      this.targets.push(new THREE.Vector3(laneX, 0, Math.min(z, zEnd)));
    }
    // Guarantee a final marker at the road end if the loop landed short
    const last = this.targets[this.targets.length - 1];
    if (!last || last.z < zEnd - 8) {
      this.targets.push(new THREE.Vector3(laneX, 0, zEnd));
    }
    // Optional minimum count (extend with same spacing past last if somehow short)
    if (count != null && this.targets.length < count) {
      let z = (last?.z ?? zFirst) + spacing;
      while (this.targets.length < count && z <= zEnd) {
        this.targets.push(new THREE.Vector3(laneX, 0, z));
        z += spacing;
      }
    }

    this.total = this.targets.length;
    for (const t of this.targets) this.markers.push(this.makeMarker(t));
    this.updateVisibility();
  }

  private makeMarker(pos: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.12, 8, 32), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x33cc66, emissive: 0x115522 })
    );
    pole.position.y = 1.5;
    g.add(pole);
    const flag = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 0.9, 4),
      new THREE.MeshStandardMaterial({ color: 0xffee55, emissive: 0x665500 })
    );
    flag.position.y = 3.2;
    g.add(flag);
    g.position.copy(pos);
    this.scene.add(g);
    return g;
  }

  private clear() {
    for (const m of this.markers) {
      this.scene.remove(m);
      m.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
    }
    this.markers = [];
    this.targets = [];
  }

  private updateVisibility() {
    this.markers.forEach((m, i) => {
      m.visible = i === this.current;
    });
  }

  update(carPos: THREE.Vector3): WaypointResult | null {
    if (this.current >= this.targets.length) return null;
    this.pathAccum += carPos.distanceTo(this.lastPos);
    this.lastPos.copy(carPos);
    const target = this.targets[this.current];
    if (Math.hypot(carPos.x - target.x, carPos.z - target.z) < 3.2) {
      const now = performance.now() / 1000;
      const result: WaypointResult = {
        index: this.current,
        timeSec: now - this.segmentStart,
        pathLengthApprox: this.pathAccum,
      };
      this.results.push(result);
      this.markers[this.current].visible = false;
      this.current++;
      this.segmentStart = now;
      this.pathAccum = 0;
      this.updateVisibility();
      return result;
    }
    return null;
  }

  distanceToCurrent(carPos: THREE.Vector3): number | null {
    if (this.current >= this.targets.length) return null;
    const t = this.targets[this.current];
    return Math.hypot(carPos.x - t.x, carPos.z - t.z);
  }

  progressLabel(): string {
    return `${Math.min(this.current, this.total)}/${this.total}`;
  }

  done(): boolean {
    return this.total > 0 && this.current >= this.total;
  }

  currentTarget(): THREE.Vector3 | null {
    return this.current < this.targets.length ? this.targets[this.current] : null;
  }

  getTargetPoints(): THREE.Vector3[] {
    return this.targets;
  }

  getCurrentIndex(): number {
    return this.current;
  }
}
