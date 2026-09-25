import type { Sample } from './telemetry';
import type { WaypointResult } from './waypoints';
import { SPEED_LIMIT_KMH } from './world';

export type MetricScore = {
  id: string;
  nameTr: string;
  nameEn: string;
  score: number; // 0-100
  valueLabel: string;
  reasons: string[];
  proxyNote?: string;
};

/** Personal style baseline — written only in Kalibrasyon (clean sessions). */
export type Baseline = {
  ready: boolean;
  meanSpeed: number;
  meanAccelAbs: number;
  meanYawAbs: number;
  meanSteerAbs: number;
  /** 0–1 hit rate: Space before significant steer */
  mirrorBeforeSteerRate: number;
};

/** Explicit session modes (map: eğitim↔kalibrasyon, profil↔değerlendirme). */
export type SessionMode = 'kalibrasyon' | 'degerlendirme' | 'serbest';

export type RiskLevel = 'Düşük' | 'Orta' | 'Yüksek' | 'Riskli';

export type LiveAlert = {
  id: string;
  message: string;
  kind: 'warn' | 'info' | 'baseline';
};

/** Weighted session components (must sum conceptually to overall). */
export type SessionComponents = {
  guvenlik: number; // 30% — hard events + crash
  kural: number; // 25% — offroad, wrongway, limit
  tarama: number; // 20% — mirror proxy / attention
  puruzsuzluk: number; // 15% — jerk, hard brake/accel/corner, steer
  gorev: number; // 10% — waypoints
};

/** 5 radar axes for Karne (aggression stored inverted as safetyAggression). */
export type SessionAxes = {
  smoothness: number;
  compliance: number;
  scanProxy: number;
  /** High = safer / less aggressive */
  safetyAggression: number;
  taskEfficiency: number;
};

export type SessionResult = {
  overall: number;
  components: SessionComponents;
  axes: SessionAxes;
  riskLevel: RiskLevel;
  /** Optional style match — does NOT inflate güvenlik */
  styleAdherence: number | null;
  coachTip: string;
  scores: MetricScore[];
  hardFail: boolean;
  cleanEnoughForCalibration: boolean;
  baselineReady: boolean;
  mode: SessionMode;
  alertTimeline: { id: string; message: string; kind: LiveAlert['kind'] }[];
  /** 0–1: short sessions shrink toward neutral (~70) */
  confidence: number;
  distanceKm: number;
};

const WEIGHTS = {
  guvenlik: 0.3,
  kural: 0.25,
  tarama: 0.2,
  puruzsuzluk: 0.15,
  gorev: 0.1,
} as const;

/** Prolonged wrong-way threshold (seconds) for hard-fail. */
const WRONGWAY_HARD_FAIL_SEC = 4;
/** Max collisions still "clean enough" to offer calibration save. */
const CLEAN_MAX_COLLISIONS = 1;
/** Min session length before full confidence (no shrink-to-70). */
const MIN_CONFIDENT_SEC = 50;
const MIN_CONFIDENT_KM = 0.45;
/** Neutral prior for short-session shrink. */
const NEUTRAL_PRIOR = 70;

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

function clampScore(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x)));
}

/** Slow EMA: next = (1-α)·prev + α·obs. α typically 0.15–0.25. */
export function ema(prev: number, obs: number, alpha = 0.18): number {
  return (1 - alpha) * prev + alpha * obs;
}

export function emptyBaseline(): Baseline {
  return {
    ready: false,
    meanSpeed: 0,
    meanAccelAbs: 0,
    meanYawAbs: 0,
    meanSteerAbs: 0,
    mirrorBeforeSteerRate: 0,
  };
}

export class MetricsEngine {
  baseline: Baseline = emptyBaseline();

  /** When true, baseline alerts are style-info only (evaluation mode). */
  private styleAlertsEnabled = false;
  private sessionMode: SessionMode = 'kalibrasyon';

  private baselineUntil = 60; // seconds
  private lastAlertAt = new Map<string, number>();
  private prevSteer = 0;
  private mirrorBeforeSteerHits = 0;
  private significantSteerEvents = 0;
  private idleGapCount = 0;
  private idleAccum = 0;
  private lastInputActive = true;

  // live counters (Safety Floor signals)
  hardBrake = 0;
  hardAccel = 0;
  hardCorner = 0;
  extremeAccel = 0;
  collisionCount = 0;
  /** Extra penalty points from crashes (negative contribution). */
  crashPenalty = 0;
  hardCrashEnded = false;
  private wasHardCorner = false;
  /** Recent speed samples for sudden stop / punch detection (km/h, t sec). */
  private speedHist: { t: number; kmh: number }[] = [];
  private sessionClock = 0;
  private hardBrakeCoolUntil = 0;
  private hardAccelCoolUntil = 0;
  private extremeCoolUntil = 0;
  offroadTime = 0;
  wrongwayTime = 0;
  reverseTime = 0;
  overSpeedTime = 0;
  private lastCollision = false;
  private alertLog: LiveAlert[] = [];

  reset() {
    this.baseline = emptyBaseline();
    this.styleAlertsEnabled = false;
    this.sessionMode = 'kalibrasyon';
    this.lastAlertAt.clear();
    this.prevSteer = 0;
    this.mirrorBeforeSteerHits = 0;
    this.significantSteerEvents = 0;
    this.idleGapCount = 0;
    this.idleAccum = 0;
    this.lastInputActive = true;
    this.hardBrake = 0;
    this.hardAccel = 0;
    this.hardCorner = 0;
    this.extremeAccel = 0;
    this.collisionCount = 0;
    this.crashPenalty = 0;
    this.hardCrashEnded = false;
    this.wasHardCorner = false;
    this.speedHist = [];
    this.sessionClock = 0;
    this.hardBrakeCoolUntil = 0;
    this.hardAccelCoolUntil = 0;
    this.extremeCoolUntil = 0;
    this.offroadTime = 0;
    this.wrongwayTime = 0;
    this.reverseTime = 0;
    this.overSpeedTime = 0;
    this.lastCollision = false;
    this.alertLog = [];
  }

  setSessionMode(mode: SessionMode) {
    this.sessionMode = mode;
    // Style (baseline-dışı) alerts only in evaluation
    this.styleAlertsEnabled = mode === 'degerlendirme';
  }

  getSessionMode(): SessionMode {
    return this.sessionMode;
  }

  /**
   * Inject a stored profile baseline for evaluation.
   * Safety Floor is never relaxed by this — only style-info alerts use it.
   */
  injectBaseline(b: Baseline) {
    this.baseline = {
      ready: !!b.ready,
      meanSpeed: b.meanSpeed,
      meanAccelAbs: b.meanAccelAbs,
      meanYawAbs: b.meanYawAbs,
      meanSteerAbs: b.meanSteerAbs,
      mirrorBeforeSteerRate: b.mirrorBeforeSteerRate ?? 0,
    };
  }

  getBaselineSnapshot(): Baseline {
    return { ...this.baseline };
  }

  getMirrorHitRate(): number {
    return this.significantSteerEvents > 0
      ? this.mirrorBeforeSteerHits / this.significantSteerEvents
      : 0;
  }

  /** Seconds until baseline window completes (kalibrasyon). */
  getBaselineUntil(): number {
    return this.baselineUntil;
  }

  extendBaseline(extraSec: number) {
    this.baselineUntil += Math.max(10, extraSec);
    this.baseline.ready = false;
  }

  /** End kalibrasyon baseline now from current samples (if enough data). */
  finishBaselineEarly(samples: Sample[], sessionSec: number) {
    this.baselineUntil = Math.min(this.baselineUntil, Math.max(5, sessionSec));
    this.updateBaselineFromSamples(samples, sessionSec);
    if (!this.baseline.ready && samples.length > 10) {
      this.baselineUntil = sessionSec;
      this.updateBaselineFromSamples(samples, sessionSec);
      this.baseline.ready = true;
    }
  }

  /**
   * Weighted overall from components — görev never outweighs güvenlik.
   * Prefer computeSessionResult for full scoring.
   */
  sessionOverall(scores: MetricScore[]): number {
    // Backward-compatible fallback: if caller only has flat scores, average them.
    if (!scores.length) return 0;
    return Math.round(scores.reduce((a, m) => a + m.score, 0) / scores.length);
  }

  weightedOverall(c: SessionComponents): number {
    return clampScore(
      c.guvenlik * WEIGHTS.guvenlik +
        c.kural * WEIGHTS.kural +
        c.tarama * WEIGHTS.tarama +
        c.puruzsuzluk * WEIGHTS.puruzsuzluk +
        c.gorev * WEIGHTS.gorev
    );
  }

  /** Session clean enough to offer "Kalibrasyonu kaydet". */
  isCleanEnoughForCalibration(): boolean {
    if (this.hardCrashEnded) return false;
    if (this.collisionCount > CLEAN_MAX_COLLISIONS) return false;
    if (this.wrongwayTime >= WRONGWAY_HARD_FAIL_SEC) return false;
    return true;
  }

  /** Per-frame bookkeeping for events + alerts */
  tick(sample: Sample, dt: number, inputActive: boolean, idleSec: number): LiveAlert[] {
    const alerts: LiveAlert[] = [];

    this.sessionClock += dt;
    const kmh = sample.speedKmh;
    this.speedHist.push({ t: this.sessionClock, kmh });
    // Keep ~0.7 s window
    const tMin = this.sessionClock - 0.7;
    while (this.speedHist.length && this.speedHist[0].t < tMin) this.speedHist.shift();

    // Sudden hard brake: was going ≥28 km/h and dropped ≥20 km/h within the window,
    // with strong deceleration — gradual coast/brake does not count.
    let suddenBrake = false;
    if (
      this.sessionClock >= this.hardBrakeCoolUntil &&
      kmh >= 5 &&
      sample.accel < -5.5 &&
      this.speedHist.length >= 4
    ) {
      let peak = kmh;
      for (const s of this.speedHist) peak = Math.max(peak, s.kmh);
      const drop = peak - kmh;
      if (peak >= 28 && drop >= 20) suddenBrake = true;
    }
    if (suddenBrake) {
      this.hardBrake++;
      this.hardBrakeCoolUntil = this.sessionClock + 1.2; // debounce one event
      this.speedHist = [{ t: this.sessionClock, kmh }]; // reset peak after event
    }

    // Sudden hard accel: punch the throttle — big speed jump in a short window only.
    // Gentle ramp (slow increase) does NOT count.
    let suddenAccel = false;
    if (
      this.sessionClock >= this.hardAccelCoolUntil &&
      sample.accel > 7.2 &&
      sample.throttle > 0.45 &&
      this.speedHist.length >= 5
    ) {
      let trough = kmh;
      for (const s of this.speedHist) trough = Math.min(trough, s.kmh);
      const rise = kmh - trough;
      // ≥24 km/h rise within ~0.7s ending at ≥30 km/h
      if (rise >= 24 && kmh >= 30) suddenAccel = true;
    }
    if (suddenAccel) {
      this.hardAccel++;
      this.hardAccelCoolUntil = this.sessionClock + 1.8;
    }

    // Extreme ivme: rare event with cooldown — NOT every physics frame
    let extremeHit = false;
    if (
      this.sessionClock >= this.extremeCoolUntil &&
      Math.abs(sample.accel) > 11.5 &&
      kmh > 15
    ) {
      // Require also a real speed swing in the window (not a one-sample spike)
      let peak = kmh;
      let trough = kmh;
      for (const s of this.speedHist) {
        peak = Math.max(peak, s.kmh);
        trough = Math.min(trough, s.kmh);
      }
      if (peak - trough >= 12) extremeHit = true;
    }
    if (extremeHit) {
      this.extremeAccel++;
      this.extremeCoolUntil = this.sessionClock + 2.0;
    }

    const hc = Math.abs(sample.yawRate) > 1.7 && sample.speedKmh > 28;
    if (hc && !this.wasHardCorner) this.hardCorner++;
    this.wasHardCorner = hc;

    if (sample.offroad) this.offroadTime += dt;
    if (sample.wrongway && sample.speedKmh > 5) this.wrongwayTime += dt;
    if (sample.reversing) this.reverseTime += dt;
    if (sample.speedKmh > SPEED_LIMIT_KMH + 2) this.overSpeedTime += dt;

    if (sample.collision && !this.lastCollision) this.collisionCount++;
    this.lastCollision = sample.collision;

    // Mirror proxy: Space before significant steer change
    const steerDelta = Math.abs(sample.steer - this.prevSteer);
    if (steerDelta > 0.45 && sample.speedKmh > 8) {
      this.significantSteerEvents++;
      if (sample.mirror) this.mirrorBeforeSteerHits++;
    }
    this.prevSteer = sample.steer;

    // Attention / idle gaps
    if (!inputActive && sample.speedKmh > 3) {
      this.idleAccum += dt;
      if (this.idleAccum > 2.5 && this.lastInputActive) {
        this.idleGapCount++;
        this.lastInputActive = false;
      }
    } else {
      this.idleAccum = 0;
      this.lastInputActive = true;
    }
    if (idleSec > 4 && sample.speedKmh > 5) {
      this.pushAlert(alerts, sample.t, 'idle', 'Dikkat proxy: uzun girdi boşluğu', 'info');
    }

    // ——— Safety Floor alerts (ALWAYS) ———
    if (sample.offroad) {
      this.pushAlert(alerts, sample.t, 'offroad', 'Şerit dışı / off-road', 'warn');
    }
    if (sample.wrongway && sample.speedKmh > 8) {
      this.pushAlert(alerts, sample.t, 'wrong', 'Ters yön', 'warn');
    }
    if (sample.collision) {
      this.pushAlert(alerts, sample.t, 'col', 'Çarpışma −puan (araç/bina)', 'warn');
    }
    if (sample.speedKmh > SPEED_LIMIT_KMH + 5) {
      this.pushAlert(
        alerts,
        sample.t,
        'limit',
        `Hız limiti aşıldı (${SPEED_LIMIT_KMH} km/h)`,
        'warn'
      );
    }
    if (extremeHit) {
      this.pushAlert(alerts, sample.t, 'extreme', 'Aşırı ivme (Safety Floor)', 'warn');
    } else if (suddenAccel) {
      this.pushAlert(alerts, sample.t, 'hardacc', 'Ani sert gaz', 'warn');
    } else if (suddenBrake) {
      this.pushAlert(alerts, sample.t, 'hardbrk', 'Ani sert fren', 'warn');
    }

    // ——— Style / baseline-dışı: only evaluation mode, info only ———
    if (this.styleAlertsEnabled && this.baseline.ready) {
      const zSpeed =
        this.baseline.meanSpeed > 0.1
          ? (sample.speed - this.baseline.meanSpeed) /
            Math.max(1, this.baseline.meanSpeed * 0.35)
          : 0;
      if (zSpeed > 2.2) {
        this.pushAlert(
          alerts,
          sample.t,
          'zspeed',
          'Stil: hız kişisel baseline üstü (bilgi)',
          'info'
        );
      }
      if (Math.abs(sample.accel) > this.baseline.meanAccelAbs * 3 + 4) {
        this.pushAlert(alerts, sample.t, 'zacc', 'Stil: ani ivme — baseline dışı', 'info');
      }
      if (Math.abs(sample.yawRate) > this.baseline.meanYawAbs * 3 + 1.2) {
        this.pushAlert(alerts, sample.t, 'zyaw', 'Stil: sert dönüş — baseline dışı', 'info');
      }
    }

    for (const a of alerts) this.alertLog.push(a);
    return alerts;
  }

  /**
   * Build personal baseline from first successful window (kalibrasyon only).
   * Does not mark ready if session already hard-failed mid-build — caller gates save.
   */
  updateBaselineFromSamples(samples: Sample[], sessionSec: number) {
    if (this.baseline.ready) return;
    if (this.sessionMode === 'degerlendirme') return;

    const mirrorRate = this.getMirrorHitRate();

    if (sessionSec < this.baselineUntil && samples.length < 15 * 20) {
      const early = samples.filter((s) => s.t <= Math.min(sessionSec, this.baselineUntil));
      if (early.length > 30) {
        this.baseline.meanSpeed = mean(early.map((s) => s.speed));
        this.baseline.meanAccelAbs = mean(early.map((s) => Math.abs(s.accel)));
        this.baseline.meanYawAbs = mean(early.map((s) => Math.abs(s.yawRate)));
        this.baseline.meanSteerAbs = mean(early.map((s) => Math.abs(s.steer)));
        this.baseline.mirrorBeforeSteerRate = mirrorRate;
      }
      return;
    }
    const window = samples.filter((s) => s.t <= this.baselineUntil);
    if (window.length < 40) return;
    this.baseline = {
      ready: true,
      meanSpeed: mean(window.map((s) => s.speed)),
      meanAccelAbs: mean(window.map((s) => Math.abs(s.accel))),
      meanYawAbs: mean(window.map((s) => Math.abs(s.yawRate))),
      meanSteerAbs: mean(window.map((s) => Math.abs(s.steer))),
      mirrorBeforeSteerRate: mirrorRate,
    };
  }

  /**
   * Snapshot μ from current session for an explicit calibration save.
   * Only call when isCleanEnoughForCalibration().
   */
  buildCalibrationBaseline(samples: Sample[]): Baseline {
    const usable = samples.filter((s) => s.t >= 2);
    const src = usable.length > 20 ? usable : samples;
    if (src.length < 10) {
      return { ...this.baseline, ready: this.baseline.ready };
    }
    return {
      ready: true,
      meanSpeed: mean(src.map((s) => s.speed)),
      meanAccelAbs: mean(src.map((s) => Math.abs(s.accel))),
      meanYawAbs: mean(src.map((s) => Math.abs(s.yawRate))),
      meanSteerAbs: mean(src.map((s) => Math.abs(s.steer))),
      mirrorBeforeSteerRate: this.getMirrorHitRate(),
    };
  }

  private pushAlert(
    out: LiveAlert[],
    t: number,
    id: string,
    message: string,
    kind: LiveAlert['kind']
  ) {
    const last = this.lastAlertAt.get(id) ?? -999;
    if (t - last < 3.5) return;
    this.lastAlertAt.set(id, t);
    out.push({ id, message, kind });
  }

  /** Soft hit / hard crash bookkeeping. */
  registerCrash(opts: { hard: boolean; relativeSpeedKmh?: number }) {
    if (opts.hard) {
      this.crashPenalty += 40;
      this.hardCrashEnded = true;
    } else {
      this.crashPenalty += 10;
    }
  }

  /**
   * ~8–12 report lines from modest ham signals + explanations.
   */
  computeFinal(samples: Sample[], waypoints: WaypointResult[], sessionSec: number): MetricScore[] {
    return this.computeSessionResult(samples, waypoints, sessionSec).scores;
  }

  computeSessionResult(
    samples: Sample[],
    waypoints: WaypointResult[],
    sessionSec: number
  ): SessionResult {
    const accels = samples.map((s) => s.accel);
    const steers = samples.map((s) => s.steer);

    const jerks: number[] = [];
    for (let i = 1; i < accels.length; i++) {
      jerks.push(Math.abs(accels[i] - accels[i - 1]) * 15);
    }
    const jerkMean = mean(jerks);

    const overFrac = sessionSec > 0 ? this.overSpeedTime / sessionSec : 0;
    const speedCompliance = clampScore(100 - overFrac * 180);

    // Distance from integrated speed (m/s * sample dt ≈ 1/15 s) + waypoint path fallback
    const SAMPLE_DT = 1 / 15;
    let distanceM = 0;
    for (const s of samples) distanceM += Math.abs(s.speed) * SAMPLE_DT;
    const wpPathM = waypoints.reduce((a, w) => a + (w.pathLengthApprox || 0), 0);
    if (wpPathM > distanceM) distanceM = wpPathM;
    const distanceKm = distanceM / 1000;
    const perKm = distanceKm >= 0.15; // enough distance to normalize rates

    // Event rates: prefer per-km when distance available, else raw counts
    const rate = (count: number, rawWeight: number, perKmWeight: number) => {
      if (perKm) return count / Math.max(0.15, distanceKm) * perKmWeight;
      return count * rawWeight;
    };

    const hardBrakeScore = clampScore(100 - rate(this.hardBrake, 8, 12));
    const hardAccelScore = clampScore(100 - rate(this.hardAccel, 8, 12));
    const hardCornerScore = clampScore(100 - rate(this.hardCorner, 10, 15));
    const jerkScore = clampScore(100 - jerkMean * 2.5);

    const steerDeltas: number[] = [];
    for (let i = 1; i < steers.length; i++) {
      steerDeltas.push(Math.abs(steers[i] - steers[i - 1]));
    }
    const steerIrr = std(steerDeltas) + mean(steerDeltas);
    const steerScore = clampScore(100 - steerIrr * 120);

    let conflict = 0;
    for (const s of samples) {
      if (s.throttle > 0.2 && s.brake > 0.2) conflict++;
    }
    const conflictFrac = samples.length ? conflict / samples.length : 0;
    const tbSmooth = clampScore(100 - conflictFrac * 400 - jerkMean);

    const wrongScore = clampScore(100 - (this.wrongwayTime / Math.max(1, sessionSec)) * 300);
    const offroadScore = clampScore(100 - (this.offroadTime / Math.max(1, sessionSec)) * 250);
    let collisionScore = clampScore(
      100 - rate(this.collisionCount, 35, 45) - this.crashPenalty
    );

    const wpTimes = waypoints.map((w) => w.timeSec);
    const avgWp = wpTimes.length ? mean(wpTimes) : 0;
    const targetTimeScore = wpTimes.length
      ? clampScore(100 - Math.max(0, avgWp - 35) * 2 - Math.max(0, 12 - avgWp) * 1.5)
      : 50;

    let routeDevScore = 70;
    if (waypoints.length) {
      const ratios = waypoints.map((w) => {
        const expected = Math.max(20, w.timeSec * 10);
        return w.pathLengthApprox / expected;
      });
      routeDevScore = clampScore(100 - Math.max(0, mean(ratios) - 1) * 60);
    }

    const mirrorRate = this.getMirrorHitRate();
    const mirrorScore = clampScore(mirrorRate * 100);
    const attentionScore = clampScore(100 - this.idleGapCount * 12);

    const extremePenalty = Math.min(18, rate(this.extremeAccel, 10, 14));

    // ——— Components (Proje-Tübitak weights applied in weightedOverall) ———
    let guvenlik = clampScore(
      (collisionScore * 0.7 + hardBrakeScore * 0.1 + hardAccelScore * 0.1 + hardCornerScore * 0.1) -
        extremePenalty
    );
    let kural = clampScore((speedCompliance + wrongScore + offroadScore) / 3);
    let tarama = clampScore(mirrorScore * 0.75 + attentionScore * 0.25);
    let puruzsuzluk = clampScore(
      (jerkScore + steerScore + tbSmooth + hardBrakeScore + hardAccelScore + hardCornerScore) / 6
    );
    let gorev = clampScore((targetTimeScore + routeDevScore) / 2);

    const hardFail =
      this.collisionCount > 0 ||
      this.wrongwayTime >= WRONGWAY_HARD_FAIL_SEC ||
      this.hardCrashEnded;

    if (hardFail) {
      guvenlik = Math.min(guvenlik, 40);
    }
    if (this.hardCrashEnded) {
      guvenlik = Math.min(guvenlik, 25);
      collisionScore = Math.min(collisionScore, 20);
    }

    // Short-session shrink toward ~70 — NOT after hard crash (that flattened every crash to ~35)
    const confT = Math.min(1, sessionSec / MIN_CONFIDENT_SEC);
    const confD = Math.min(1, distanceKm / MIN_CONFIDENT_KM);
    const confidence = Math.max(
      0.25,
      Math.min(
        confT,
        confD === 0 && distanceKm < 0.05
          ? confT
          : Math.max(confT * 0.4 + confD * 0.6, confT * 0.5)
      )
    );
    // Mild shrink: keep most of the measured score so short runs still differentiate
    const shrink = (v: number) => {
      const w = 0.55 + 0.45 * confidence;
      return clampScore(v * w + NEUTRAL_PRIOR * (1 - w));
    };

    if (!this.hardCrashEnded) {
      guvenlik = shrink(guvenlik);
      kural = shrink(kural);
      tarama = shrink(tarama);
      puruzsuzluk = shrink(puruzsuzluk);
      gorev = shrink(gorev);
    }
    if (hardFail) guvenlik = Math.min(guvenlik, 40);
    if (this.hardCrashEnded) guvenlik = Math.min(guvenlik, 28);

    const components: SessionComponents = {
      guvenlik,
      kural,
      tarama,
      puruzsuzluk,
      gorev,
    };
    let overall = this.weightedOverall(components);

    // Hard crash CAP overall but other axes still differentiate (no flat 35)
    if (this.hardCrashEnded) {
      const restAvg = (kural + tarama + puruzsuzluk + gorev) / 4;
      const hardCap = clampScore(16 + restAvg * 0.42);
      overall = Math.min(overall, hardCap, 55);
    } else if (hardFail) {
      const restAvg = (kural + tarama + puruzsuzluk + gorev) / 4;
      overall = Math.min(overall, clampScore(35 + restAvg * 0.35), 62);
    }
    if (this.collisionCount >= 3) {
      overall = Math.min(overall, 48);
    }
    if (this.wrongwayTime >= WRONGWAY_HARD_FAIL_SEC * 2) {
      overall = Math.min(overall, 52);
    }

    const axes: SessionAxes = {
      smoothness: puruzsuzluk,
      compliance: kural,
      scanProxy: tarama,
      safetyAggression: guvenlik,
      taskEfficiency: gorev,
    };

    let riskLevel: RiskLevel = 'Düşük';
    if (this.hardCrashEnded) {
      riskLevel = 'Riskli';
    } else if (hardFail || guvenlik < 45 || this.collisionCount >= 2) {
      riskLevel = 'Yüksek';
    } else if (overall < 60 || kural < 55 || this.overSpeedTime > 8 || this.offroadTime > 5) {
      riskLevel = 'Orta';
    }

    let styleAdherence: number | null = null;
    if (this.baseline.ready && samples.length > 20) {
      const mSpd = mean(samples.map((s) => s.speed));
      const mAcc = mean(samples.map((s) => Math.abs(s.accel)));
      const mYaw = mean(samples.map((s) => Math.abs(s.yawRate)));
      const mSt = mean(samples.map((s) => Math.abs(s.steer)));
      const rel = (a: number, b: number) => {
        const d = Math.abs(a - b) / Math.max(0.15, Math.abs(b) * 0.5 + 0.1);
        return clampScore(100 - d * 35);
      };
      const mirRel = clampScore(
        100 - Math.abs(mirrorRate - (this.baseline.mirrorBeforeSteerRate || 0)) * 100
      );
      styleAdherence = clampScore(
        (rel(mSpd, this.baseline.meanSpeed) +
          rel(mAcc, this.baseline.meanAccelAbs) +
          rel(mYaw, this.baseline.meanYawAbs) +
          rel(mSt, this.baseline.meanSteerAbs) +
          mirRel) /
          5
      );
    }

    const coachTip = this.pickCoachTip(components, riskLevel, mirrorRate);
    const scores = this.buildReportLines({
      sessionSec,
      speedCompliance,
      overFrac,
      wrongScore,
      offroadScore,
      collisionScore,
      guvenlik,
      kural,
      tarama,
      puruzsuzluk,
      gorev,
      mirrorRate,
      mirrorScore,
      attentionScore,
      jerkMean,
      jerkScore,
      steerIrr,
      steerScore,
      hardBrakeScore,
      hardAccelScore,
      hardCornerScore,
      targetTimeScore,
      routeDevScore,
      avgWp,
      wpTimes,
      waypoints,
      styleAdherence,
      distanceKm,
      perKm,
      confidence,
    });

    const seen = new Set<string>();
    const alertTimeline: SessionResult['alertTimeline'] = [];
    for (let i = this.alertLog.length - 1; i >= 0 && alertTimeline.length < 12; i--) {
      const a = this.alertLog[i];
      const key = a.id + '|' + a.message;
      if (seen.has(key)) continue;
      seen.add(key);
      alertTimeline.unshift({ id: a.id, message: a.message, kind: a.kind });
    }

    return {
      overall,
      components,
      axes,
      riskLevel,
      styleAdherence,
      coachTip,
      scores,
      hardFail,
      cleanEnoughForCalibration: this.isCleanEnoughForCalibration() && (this.baseline.ready || sessionSec >= 30),
      baselineReady: this.baseline.ready,
      mode: this.sessionMode,
      alertTimeline,
      confidence,
      distanceKm,
    };
  }

  private pickCoachTip(c: SessionComponents, risk: RiskLevel, mirrorRate: number): string {
    if (risk === 'Riskli') {
      return 'Ağır kaza oturumu kapattı — güvenlik öncelikli yavaş eğitim sürüşü önerilir.';
    }
    if (c.guvenlik < 50) {
      return 'Çarpışma / sert olaylar skoru düşürüyor; mesafeyi ve hızı düşürün.';
    }
    if (c.kural < 55) {
      return 'Limit, şerit ve yön uyumuna odaklanın — Safety Floor affetmez.';
    }
    if (c.tarama < 55 || mirrorRate < 0.35) {
      return 'Manévra öncesi Space (ayna/omuz proxy) alışkanlığını güçlendirin.';
    }
    if (c.puruzsuzluk < 60) {
      return 'Gaz/fren ve direksiyonu daha yumuşak kullanın; jerk’i azaltın.';
    }
    if (c.gorev < 55) {
      return 'Waypoint rotasını kısaltın; gereksiz sapmalardan kaçının.';
    }
    return 'Güvenli ve dengeli bir oturum — stil tutarlılığını koruyun.';
  }

  private buildReportLines(p: {
    sessionSec: number;
    speedCompliance: number;
    overFrac: number;
    wrongScore: number;
    offroadScore: number;
    collisionScore: number;
    guvenlik: number;
    kural: number;
    tarama: number;
    puruzsuzluk: number;
    gorev: number;
    mirrorRate: number;
    mirrorScore: number;
    attentionScore: number;
    jerkMean: number;
    jerkScore: number;
    steerIrr: number;
    steerScore: number;
    hardBrakeScore: number;
    hardAccelScore: number;
    hardCornerScore: number;
    targetTimeScore: number;
    routeDevScore: number;
    avgWp: number;
    wpTimes: number[];
    waypoints: WaypointResult[];
    styleAdherence: number | null;
    distanceKm: number;
    perKm: boolean;
    confidence: number;
  }): MetricScore[] {
    const lines: MetricScore[] = [
      {
        id: 'guvenlik',
        nameTr: 'Güvenlik / agresyon',
        nameEn: 'Safety / aggression',
        score: p.guvenlik,
        valueLabel: `${this.collisionCount} çarpışma · ceza ${this.crashPenalty}${
          this.hardCrashEnded ? ' · ağır kaza' : ''
        }`,
        reasons: [
          this.collisionCount === 0
            ? 'Araç/bina çarpışması yok.'
            : `Çarpışma kaydı: ${this.collisionCount} (−35/adet + ek ceza).`,
          this.extremeAccel
            ? `Aşırı ivme olayları: ${this.extremeAccel} (Safety Floor).`
            : 'Aşırı ivme eşiği aşılmadı.',
          'Kişisel stil bu bileşeni yumuşatmaz.',
        ],
      },
      {
        id: 'speed_limit',
        nameTr: 'Hız limiti uyumu',
        nameEn: 'Speed limit compliance',
        score: p.speedCompliance,
        valueLabel: `aşım ${(this.overSpeedTime).toFixed(1)}s / limit ${SPEED_LIMIT_KMH}`,
        reasons: [
          p.overFrac < 0.05
            ? 'Çoğunlukla limit altında kaldınız.'
            : `Oturumun %${(p.overFrac * 100).toFixed(0)} kadarında limit aşıldı.`,
        ],
      },
      {
        id: 'wrongway',
        nameTr: 'Ters yön',
        nameEn: 'Wrong way',
        score: p.wrongScore,
        valueLabel: `${this.wrongwayTime.toFixed(1)}s`,
        reasons: [
          this.wrongwayTime < 1
            ? 'Ters yön yok/az.'
            : this.wrongwayTime >= WRONGWAY_HARD_FAIL_SEC
              ? 'Uzun ters yön — hard-fail (güvenlik tavanı).'
              : 'Yol yönüne ters sürüş süreleri.',
        ],
      },
      {
        id: 'offroad',
        nameTr: 'Şerit dışı / off-road',
        nameEn: 'Off-road / lane departure',
        score: p.offroadScore,
        valueLabel: `${this.offroadTime.toFixed(1)}s`,
        reasons: [
          this.offroadTime < 2 ? 'Şerit içinde kaldınız.' : 'Yol dışına çıkışlar kaydedildi.',
        ],
      },
      {
        id: 'puruzsuzluk',
        nameTr: 'Pürüzsüzlük / kontrol',
        nameEn: 'Smoothness / control',
        score: p.puruzsuzluk,
        valueLabel: `jerk≈${p.jerkMean.toFixed(1)} · fren ${this.hardBrake} · gaz ${this.hardAccel} · viraj ${this.hardCorner}`,
        reasons: [
          p.jerkMean < 8 ? 'Akıcı ivme profili.' : 'İvme sık değişiyor — yumuşak geçişler önerilir.',
          `Direksiyon düzensizliği skoru: ${p.steerScore}`,
        ],
      },
      {
        id: 'steering',
        nameTr: 'Direksiyon kontrolü',
        nameEn: 'Steering control',
        score: p.steerScore,
        valueLabel: `irr≈${p.steerIrr.toFixed(3)}`,
        reasons: [
          p.steerIrr < 0.08 ? 'Düzenli direksiyon.' : 'Sık küçük direksiyon düzeltmeleri.',
        ],
      },
      {
        id: 'mirror_proxy',
        nameTr: 'Tarama proxy (ayna/omuz)',
        nameEn: 'Scan proxy (mirror/shoulder)',
        score: p.mirrorScore,
        valueLabel: `%${(p.mirrorRate * 100).toFixed(0)} (${this.mirrorBeforeSteerHits}/${this.significantSteerEvents})`,
        reasons: [
          `Anlamlı direksiyon değişiminden önce Space: ${this.mirrorBeforeSteerHits}/${this.significantSteerEvents}`,
          'Davranışsal proxy; eye-tracking değil.',
        ],
        proxyNote:
          'Space tuşu davranışsal proxy. Gerçek göz takibi veya ayna kontrolü değildir.',
      },
      {
        id: 'attention_proxy',
        nameTr: 'Dikkat proxy',
        nameEn: 'Attention proxy',
        score: p.attentionScore,
        valueLabel: `${this.idleGapCount} boşluk`,
        reasons: [
          `Uzun girdi boşluğu sayısı: ${this.idleGapCount}`,
          'Klavye idle — klinik dikkat ölçümü değil.',
        ],
        proxyNote: 'Klavye idle boşlukları — gerçek dikkat ölçümü değildir.',
      },
      {
        id: 'gorev',
        nameTr: 'Görev / waypoint',
        nameEn: 'Task / waypoints',
        score: p.gorev,
        valueLabel: p.wpTimes.length
          ? `ort ${p.avgWp.toFixed(1)}s · ${p.wpTimes.length} wp · rota ${p.routeDevScore}`
          : 'wp yok',
        reasons: [
          p.wpTimes.length
            ? `Waypoint süreleri: ${p.wpTimes.map((t) => t.toFixed(1) + 's').join(', ')}`
            : 'Hiç waypoint tamamlanmadı.',
          'Görev ağırlığı %10 — güvenliği geçemez.',
        ],
      },
    ];

    if (p.styleAdherence != null) {
      lines.push({
        id: 'style_adherence',
        nameTr: 'Stil uyumu (bilgi)',
        nameEn: 'Style adherence (info)',
        score: p.styleAdherence,
        valueLabel: `${p.styleAdherence}/100`,
        reasons: [
          'Kişisel baseline’a yakınlık — güvenlik puanını şişirmez.',
          this.sessionMode === 'degerlendirme'
            ? 'Değerlendirme modunda stil sapmaları yalnızca bilgi uyarısıdır.'
            : 'Kalibrasyon/serbest modda stil skoru bilgilendiricidir.',
        ],
      });
    }

    // Soft events summary as one line
    lines.push({
      id: 'hard_events',
      nameTr: 'Sert olay özeti',
      nameEn: 'Hard events summary',
      score: clampScore((p.hardBrakeScore + p.hardAccelScore + p.hardCornerScore) / 3),
      valueLabel: `fren ${this.hardBrake} · gaz ${this.hardAccel} · viraj ${this.hardCorner} · aşırı ivme ${this.extremeAccel}${
        p.perKm ? ` · ${p.distanceKm.toFixed(2)} km` : ''
      }`,
      reasons: [
        this.hardBrake + this.hardAccel + this.hardCorner === 0
          ? 'Sert fren/gaz/viraj yok.'
          : 'Sert manévralar pürüzsüzlük ve güvenlik bileşenlerini düşürür.',
        p.perKm
          ? 'Olay oranları mesafe (km) ile normalize edildi.'
          : 'Kısa mesafe — ham olay sayıları kullanıldı.',
        p.confidence < 0.95
          ? `Kısa oturum güveni %${Math.round(p.confidence * 100)} — skor nötr ~70’e çekildi.`
          : 'Oturum süresi/mesafe yeterli — tam güven.',
      ],
    });

    return lines;
  }

  liveStrip(
    samples: Sample[],
    sessionSec: number
  ): { id: string; label: string; tone: 'good' | 'warn' | 'bad' | '' }[] {
    const recent = samples.slice(-45);
    const spd = recent.length ? mean(recent.map((s) => s.speedKmh)) : 0;
    const off = this.offroadTime;
    const modeLabel =
      this.sessionMode === 'degerlendirme'
        ? 'Değerlendirme'
        : this.sessionMode === 'serbest'
          ? 'Serbest'
          : 'Kalibrasyon';
    return [
      {
        id: 'mode',
        label: modeLabel,
        tone: this.sessionMode === 'degerlendirme' ? 'warn' : 'good',
      },
      {
        id: 'lim',
        label: `Limit ${SPEED_LIMIT_KMH}`,
        tone: spd > SPEED_LIMIT_KMH + 3 ? 'bad' : 'good',
      },
      {
        id: 'hb',
        label: `Sert fren ${this.hardBrake}`,
        tone: this.hardBrake > 3 ? 'bad' : this.hardBrake > 0 ? 'warn' : '',
      },
      {
        id: 'off',
        label: `Off-road ${off.toFixed(0)}s`,
        tone: off > 2 ? 'bad' : off > 0 ? 'warn' : 'good',
      },
      {
        id: 'col',
        label: `Çarpışma ${this.collisionCount}`,
        tone: this.collisionCount > 0 ? 'bad' : 'good',
      },
      {
        id: 'base',
        label: this.baseline.ready
          ? 'Baseline hazır'
          : `Baseline ${Math.min(this.baselineUntil, Math.floor(sessionSec))}s`,
        tone: this.baseline.ready ? 'good' : 'warn',
      },
      {
        id: 'mir',
        label: `Ayna proxy ${this.mirrorBeforeSteerHits}/${this.significantSteerEvents}`,
        tone: '',
      },
    ];
  }
}
