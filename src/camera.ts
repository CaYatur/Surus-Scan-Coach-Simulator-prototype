import * as THREE from 'three';
import type { Car } from './car';
import { getCameraMode, setCameraMode } from './profiles';

export type CameraMode = 'fp' | 'chase';

/** Screen-fixed cockpit: frames + glass, open windshield view. CaYaDev-ish white/black cabin. */
function buildCockpitOverlay(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fp-cockpit';

  const paint = new THREE.MeshStandardMaterial({
    color: 0xf4f6f8,
    metalness: 0.42,
    roughness: 0.32,
  });
  const paintDark = new THREE.MeshStandardMaterial({
    color: 0xe8eaee,
    metalness: 0.38,
    roughness: 0.38,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x12151c,
    roughness: 0.82,
    metalness: 0.18,
  });
  const softDark = new THREE.MeshStandardMaterial({
    color: 0x1c222c,
    roughness: 0.78,
    metalness: 0.22,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xb8d4ec,
    transparent: true,
    opacity: 0.11,
    metalness: 0.05,
    roughness: 0.04,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sideGlass = new THREE.MeshStandardMaterial({
    color: 0xa8c4dc,
    transparent: true,
    opacity: 0.14,
    metalness: 0.05,
    roughness: 0.06,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0x9aa8b8,
    metalness: 0.85,
    roughness: 0.22,
  });
  const leather = new THREE.MeshStandardMaterial({
    color: 0x1a1a1e,
    roughness: 0.7,
    metalness: 0.08,
  });

  // Dashboard shelf
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.18, 0.52), dark);
  dash.position.set(0, -0.5, -0.56);
  g.add(dash);

  // Soft top pad on dash
  const dashPad = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.04, 0.36), softDark);
  dashPad.position.set(0, -0.4, -0.52);
  g.add(dashPad);

  // Instrument cluster (subtle emissive cyan/blue)
  const cluster = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.15, 0.12),
    new THREE.MeshStandardMaterial({
      color: 0x060a10,
      emissive: 0x1a6090,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.3,
    })
  );
  cluster.position.set(0, -0.33, -0.48);
  g.add(cluster);

  // Tiny cluster bezel
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.03, 0.14), chrome);
  bezel.position.set(0, -0.25, -0.48);
  g.add(bezel);

  // Center stack hint
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.1), softDark);
  stack.position.set(0.22, -0.42, -0.42);
  g.add(stack);

  // Steering wheel (rim + hub)
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.175, 0.026, 8, 24),
    leather
  );
  wheel.position.set(-0.14, -0.35, -0.38);
  wheel.rotation.x = 1.15;
  g.add(wheel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.04, 12), softDark);
  hub.position.set(-0.14, -0.35, -0.38);
  hub.rotation.x = 1.15;
  g.add(hub);

  // A-pillars (white paint frames) — keep thin so road stays open
  for (const sx of [-0.78, 0.78]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.08, 0.085), paint);
    pillar.position.set(sx, 0.08, -0.3);
    pillar.rotation.z = sx > 0 ? -0.09 : 0.09;
    g.add(pillar);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.02, 0.025), chrome);
    trim.position.set(sx * 0.93, 0.08, -0.26);
    g.add(trim);
  }

  // Roof header / windshield top frame
  const header = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.065, 0.1), paint);
  header.position.set(0, 0.56, -0.24);
  g.add(header);

  // Inner header liner
  const headerIn = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.08), paintDark);
  headerIn.position.set(0, 0.52, -0.22);
  g.add(headerIn);

  // Bottom windshield sill
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.045, 0.07), chrome);
  sill.position.set(0, -0.2, -0.4);
  g.add(sill);

  // Door sills (lower cabin edge)
  for (const sx of [-0.72, 0.72]) {
    const doorSill = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.55), dark);
    doorSill.position.set(sx, -0.48, -0.55);
    g.add(doorSill);
  }

  // Windshield — low opacity, no heavy fogging
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.82), glass);
  windshield.position.set(0, 0.16, -0.36);
  windshield.rotation.x = -0.1;
  g.add(windshield);

  // Side window hints
  for (const sx of [-0.82, 0.82]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), sideGlass);
    side.position.set(sx, 0.06, -0.52);
    side.rotation.y = sx > 0 ? -Math.PI / 2.15 : Math.PI / 2.15;
    g.add(side);
  }

  // White hood visible through glass (slightly lower so it doesn't crowd)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.035, 0.9), paint);
  hood.position.set(0, -0.54, -1.15);
  hood.rotation.x = -0.08;
  g.add(hood);

  // Hood center crease hint
  const crease = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.75), paintDark);
  crease.position.set(0, -0.52, -1.1);
  crease.rotation.x = -0.08;
  g.add(crease);

  // Mirror stalks (visual only; HUD mirrors separate)
  for (const sx of [-0.68, 0.68]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.16), dark);
    stalk.position.set(sx, 0.04, -0.2);
    g.add(stalk);
    const glassHint = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.06, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x8899aa,
        metalness: 0.7,
        roughness: 0.15,
      })
    );
    glassHint.position.set(sx * 1.05, 0.04, -0.12);
    g.add(glassHint);
  }

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  });
  return g;
}

export class CameraController {
  mode: CameraMode;
  private yawSmooth = 0;
  private camera: THREE.PerspectiveCamera;
  private cockpit: THREE.Group;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.mode = getCameraMode();
    this.yawSmooth = 0;
    this.cockpit = buildCockpitOverlay();
    this.camera.add(this.cockpit);
    this.cockpit.visible = this.mode === 'fp';
  }

  toggle(): CameraMode {
    this.mode = this.mode === 'fp' ? 'chase' : 'fp';
    setCameraMode(this.mode);
    this.cockpit.visible = this.mode === 'fp';
    return this.mode;
  }

  setMode(mode: CameraMode) {
    this.mode = mode;
    setCameraMode(mode);
    this.cockpit.visible = mode === 'fp';
  }

  apply(car: Car, dt: number) {
    car.setFirstPerson(this.mode === 'fp');
    this.cockpit.visible = this.mode === 'fp';

    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);

    if (this.mode === 'fp') {
      let dy = car.yaw - this.yawSmooth;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yawSmooth += dy * Math.min(1, 14 * dt);

      const eye = car.eyeWorld();
      const lookYaw = this.yawSmooth;
      const lx = Math.sin(lookYaw);
      const lz = Math.cos(lookYaw);

      this.camera.position.lerp(eye, 1 - Math.pow(0.00005, dt));
      if (this.camera.position.distanceTo(eye) > 2) this.camera.position.copy(eye);
      this.camera.fov = 70;
      this.camera.near = 0.05;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(eye.x + lx * 18, eye.y - 0.12, eye.z + lz * 18);
    } else {
      this.yawSmooth = car.yaw;
      const back = 8.5;
      const height = 4.2;
      const desired = new THREE.Vector3(
        car.position.x - fx * back,
        car.position.y + height,
        car.position.z - fz * back
      );
      this.camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
      this.camera.fov = 60;
      this.camera.near = 0.1;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(car.position.x + fx * 4, car.position.y + 0.8, car.position.z + fz * 4);
    }
  }
}
