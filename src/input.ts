export type InputState = {
  throttle: number;
  brake: number;
  steer: number;
  mirror: boolean;
  anyKey: boolean;
};

export class Input {
  private keys = new Set<string>();
  private mirrorPulse = 0;
  private lastActivity = performance.now();
  private edgeKeys = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.edgeKeys.add(e.code);
      this.keys.add(e.code);
      this.lastActivity = performance.now();
      if (e.code === 'Space') {
        e.preventDefault();
        this.mirrorPulse = 0.55;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number): InputState {
    this.mirrorPulse = Math.max(0, this.mirrorPulse - dt);

    let throttle = 0;
    let brake = 0;
    let steer = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      throttle -= 1;
      brake = 1;
    }
    // Positive steer = left (Three.js +Y yaw). A/Left must increase yaw.
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer += 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer -= 1;

    const anyKey = this.keys.size > 0 || this.mirrorPulse > 0;

    return {
      throttle: Math.max(-1, Math.min(1, throttle)),
      brake,
      steer: Math.max(-1, Math.min(1, steer)),
      mirror: this.mirrorPulse > 0 || this.keys.has('Space'),
      anyKey,
    };
  }

  /** Consume one-shot key edge (keydown). */
  consumeEdge(code: string): boolean {
    if (this.edgeKeys.has(code)) {
      this.edgeKeys.delete(code);
      return true;
    }
    return false;
  }

  idleSeconds(now = performance.now()): number {
    return (now - this.lastActivity) / 1000;
  }

  wasResetPressed(): boolean {
    return this.keys.has('KeyR');
  }
}
