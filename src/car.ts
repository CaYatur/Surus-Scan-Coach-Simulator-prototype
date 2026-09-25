import * as THREE from 'three';
import type { InputState } from './input';

/** Arcade car: simple accel / steer / friction. Units: world meters, speed m/s. */
export class Car {
  mesh: THREE.Group;
  /** Exterior body group — hidden in first-person. */
  exterior: THREE.Group;
  /** Interior dashboard / windshield frame — shown in FP. */
  interior: THREE.Group;

  velocity = 0;
  yaw = 0;
  angularVel = 0;
  position = new THREE.Vector3(0, 0, 0);

  readonly maxSpeed = 28;
  readonly maxReverse = 8;
  readonly accelForce = 14;
  readonly brakeForce = 22;
  readonly drag = 0.8;
  readonly steerSpeed = 2.2;

  private prevVelocity = 0;
  accelLong = 0;
  yawRate = 0;

  constructor() {
    this.mesh = new THREE.Group();
    this.exterior = this.buildExterior();
    this.interior = this.buildInterior();
    this.mesh.add(this.exterior);
    this.mesh.add(this.interior);
    this.setFirstPerson(true);
  }

  private buildExterior(): THREE.Group {
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf5f7fa,
      metalness: 0.62,
      roughness: 0.24,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 3.8), bodyMat);
    body.position.y = 0.48;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Hood slope
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(1.72, 0.16, 1.15),
      new THREE.MeshStandardMaterial({ color: 0xeceef2, metalness: 0.65, roughness: 0.22 })
    );
    hood.position.set(0, 0.74, 0.95);
    hood.rotation.x = -0.12;
    hood.castShadow = true;
    g.add(hood);

    // Roof / cabin glass shell
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.48, 1.55),
      new THREE.MeshStandardMaterial({
        color: 0x0c1520,
        metalness: 0.35,
        roughness: 0.14,
        transparent: true,
        opacity: 0.78,
      })
    );
    cabin.position.set(0, 0.94, -0.15);
    cabin.castShadow = true;
    g.add(cabin);

    // Roof panel (lighter strip)
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.06, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe8eaee, metalness: 0.5, roughness: 0.3 })
    );
    roof.position.set(0, 1.18, -0.15);
    g.add(roof);

    // Front / rear bumpers
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.65, metalness: 0.15 });
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.22, 0.28), bumperMat);
    bumperF.position.set(0, 0.34, 1.96);
    g.add(bumperF);
    const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.2, 0.22), bumperMat);
    bumperR.position.set(0, 0.34, -1.96);
    g.add(bumperR);

    // Headlights
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xfff8e0,
      emissive: 0xffe090,
      emissiveIntensity: 0.95,
      roughness: 0.25,
      metalness: 0.2,
    });
    for (const sx of [-0.55, 0.55]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.15, 0.08), lightMat);
      hl.position.set(sx, 0.5, 1.98);
      g.add(hl);
    }

    // Taillights
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0xcc2020,
      emissive: 0x880808,
      emissiveIntensity: 0.65,
      roughness: 0.35,
    });
    for (const sx of [-0.55, 0.55]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.06), tailMat);
      tl.position.set(sx, 0.5, -1.98);
      g.add(tl);
    }

    // Wheels + simple rim
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.88 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 });
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 14);
    const rimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10);
    const offsets: [number, number, number][] = [
      [-0.95, 0.34, 1.2],
      [0.95, 0.34, 1.2],
      [-0.95, 0.34, -1.2],
      [0.95, 0.34, -1.2],
    ];
    for (const [x, y, z] of offsets) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, y, z);
      w.castShadow = true;
      g.add(w);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      rim.position.set(x, y, z);
      g.add(rim);
    }

    // Side mirrors (chase view)
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
    for (const sx of [-0.98, 0.98]) {
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.18), mirrorMat);
      mir.position.set(sx, 0.85, 0.55);
      g.add(mir);
    }

    // Accent plate (player marker)
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.1, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x664400, emissiveIntensity: 0.35 })
    );
    nose.position.set(0, 0.42, 2.05);
    g.add(nose);

    return g;
  }

  /**
   * FP cockpit is camera-attached (see camera.ts) so it never clips the view.
   * Car-local interior kept empty; exterior alone is used in chase mode.
   */
  private buildInterior(): THREE.Group {
    return new THREE.Group();
  }

  setFirstPerson(fp: boolean) {
    this.exterior.visible = !fp;
    this.interior.visible = fp;
  }

  reset(x = 0, z = 0, yaw = 0) {
    this.position.set(x, 0, z);
    this.yaw = yaw;
    this.velocity = 0;
    this.angularVel = 0;
    this.accelLong = 0;
    this.yawRate = 0;
    this.prevVelocity = 0;
    this.syncMesh();
  }

  update(dt: number, input: InputState) {
    const speed = this.velocity;
    const absSpeed = Math.abs(speed);

    let force = 0;
    if (input.throttle > 0) {
      force += input.throttle * this.accelForce;
    } else if (input.throttle < 0) {
      if (speed > 0.5) {
        force -= this.brakeForce;
      } else {
        force += input.throttle * this.accelForce * 0.6;
      }
    }

    if (input.brake > 0 && speed > 0.2 && input.throttle >= 0) {
      force -= input.brake * this.brakeForce;
    }

    force -= Math.sign(speed) * this.drag * absSpeed;
    if (absSpeed < 0.05 && Math.abs(input.throttle) < 0.01) {
      this.velocity = 0;
    } else {
      this.velocity += force * dt;
    }

    this.velocity = Math.max(-this.maxReverse, Math.min(this.maxSpeed, this.velocity));

    const steerFactor = Math.min(1, absSpeed / 6);
    const targetYawRate = input.steer * this.steerSpeed * steerFactor * Math.sign(speed || 1);
    const yawRate =
      absSpeed < 0.3
        ? input.steer * 0.4 * (input.throttle !== 0 ? 1 : 0)
        : targetYawRate;

    this.yaw += yawRate * dt;
    this.yawRate = yawRate;

    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    this.position.x += forwardX * this.velocity * dt;
    this.position.z += forwardZ * this.velocity * dt;

    this.accelLong = (this.velocity - this.prevVelocity) / Math.max(dt, 1e-4);
    this.prevVelocity = this.velocity;

    this.syncMesh();
  }

  private syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  speedKmh(): number {
    return Math.abs(this.velocity) * 3.6;
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Driver eye world position for FP camera (~1.35 m, seat back). */
  eyeWorld(): THREE.Vector3 {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    return new THREE.Vector3(
      this.position.x - fx * 0.45,
      this.position.y + 1.35,
      this.position.z - fz * 0.45
    );
  }
}
