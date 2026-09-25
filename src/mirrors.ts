import * as THREE from 'three';
import type { Car } from './car';

/**
 * Left / right rear-view mirrors (scissor).
 * Only visible while Space is held (mirror proxy).
 * Placed mid-screen sides so they do not overlap the bottom-right minimap.
 */
export class Mirrors {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private leftCam: THREE.PerspectiveCamera;
  private rightCam: THREE.PerspectiveCamera;
  private leftEl: HTMLElement;
  private rightEl: HTMLElement;
  private readonly size = { w: 200, h: 120 };
  private visible = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.leftCam = new THREE.PerspectiveCamera(50, this.size.w / this.size.h, 0.1, 200);
    this.rightCam = new THREE.PerspectiveCamera(50, this.size.w / this.size.h, 0.1, 200);
    this.leftEl = document.getElementById('mirror-left')!;
    this.rightEl = document.getElementById('mirror-right')!;
    this.hide();
  }

  private hide() {
    this.visible = false;
    this.leftEl.classList.add('hidden');
    this.rightEl.classList.add('hidden');
    this.leftEl.classList.remove('active');
    this.rightEl.classList.remove('active');
  }

  private show() {
    this.visible = true;
    this.leftEl.classList.remove('hidden');
    this.rightEl.classList.remove('hidden');
    this.leftEl.classList.add('active');
    this.rightEl.classList.add('active');
  }

  setActive(on: boolean) {
    if (on) this.show();
    else this.hide();
  }

  /** Call after main render. No-op when Space not held. */
  render(car: Car) {
    if (!this.visible) return;

    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    // Visual driver-right (matches FP / minimap): yaw=0 → (-1,0) = -X
    const rx = -fz;
    const rz = fx;
    const eyeY = car.position.y + 1.35;
    const back = 0.35;
    const side = 0.95;

    const place = (cam: THREE.PerspectiveCamera, sideSign: number) => {
      const px = car.position.x - fx * back + rx * sideSign * side;
      const pz = car.position.z - fz * back + rz * sideSign * side;
      cam.position.set(px, eyeY, pz);
      cam.lookAt(px - fx * 14 + rx * sideSign * 2, eyeY - 0.2, pz - fz * 14 + rz * sideSign * 2);
      cam.aspect = this.size.w / this.size.h;
      cam.updateProjectionMatrix();
    };

    // left = -visualRight, right = +visualRight
    place(this.leftCam, -1);
    place(this.rightCam, 1);

    const canvas = this.renderer.domElement;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const dpr = this.renderer.getPixelRatio();
    const margin = 16;
    // Mid-upper sides — clear of bottom-right minimap (~168px + padding)
    const top = Math.max(96, Math.floor(ch * 0.28));
    const leftRect = { x: margin, y: top, w: this.size.w, h: this.size.h };
    const rightRect = { x: cw - margin - this.size.w, y: top, w: this.size.w, h: this.size.h };

    this.leftEl.style.left = `${leftRect.x}px`;
    this.leftEl.style.top = `${leftRect.y}px`;
    this.rightEl.style.left = `${rightRect.x}px`;
    this.rightEl.style.top = `${rightRect.y}px`;

    let cock: THREE.Object3D | undefined;
    this.scene.traverse((o) => {
      if (o.name === 'fp-cockpit') cock = o;
    });
    const wasCock = cock?.visible;
    if (cock) cock.visible = false;
    const exteriorWas = car.exterior.visible;
    car.exterior.visible = true;

    const draw = (cam: THREE.PerspectiveCamera, r: typeof leftRect) => {
      const x = Math.floor(r.x * dpr);
      const y = Math.floor((ch - r.y - r.h) * dpr);
      const w = Math.floor(r.w * dpr);
      const h = Math.floor(r.h * dpr);
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.renderer.render(this.scene, cam);
    };

    draw(this.leftCam, leftRect);
    draw(this.rightCam, rightRect);

    car.exterior.visible = exteriorWas;
    if (cock && wasCock !== undefined) cock.visible = wasCock;

    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);
  }
}
