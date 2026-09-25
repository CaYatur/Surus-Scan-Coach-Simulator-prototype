export type Sample = {
  t: number; // session seconds
  speed: number; // m/s
  speedKmh: number;
  accel: number; // m/s^2 longitudinal
  yawRate: number; // rad/s
  steer: number;
  throttle: number;
  brake: number;
  lateralOffset: number;
  headingError: number;
  offroad: boolean;
  wrongway: boolean;
  collision: boolean;
  mirror: boolean;
  reversing: boolean;
};

const SAMPLE_HZ = 15;
const SAMPLE_DT = 1 / SAMPLE_HZ;

export class Telemetry {
  samples: Sample[] = [];
  private accum = 0;

  reset() {
    this.samples = [];
    this.accum = 0;
  }

  update(dt: number, make: () => Sample) {
    this.accum += dt;
    while (this.accum >= SAMPLE_DT) {
      this.accum -= SAMPLE_DT;
      this.samples.push(make());
    }
  }

  get hz() {
    return SAMPLE_HZ;
  }
}
