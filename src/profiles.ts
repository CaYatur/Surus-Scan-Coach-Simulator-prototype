import type { Baseline, MetricScore, SessionAxes, SessionResult } from './metrics';
import { ema, emptyBaseline } from './metrics';

export type DriverBaseline = Baseline;

/** 5 Karne axes (aggression inverted as safetyAggression — high = good). */
export type KarneCategories = {
  smoothness: number;
  compliance: number;
  scanProxy: number;
  safetyAggression: number;
  taskEfficiency: number;
};

/** @deprecated legacy keys — migrated on load */
type LegacyCats = {
  hız?: number;
  yumuşaklık?: number;
  şerit?: number;
  dikkatProxy?: number;
  güvenlik?: number;
};

export type KarneHistoryEntry = {
  at: number;
  overall: number;
  delta: number;
};

export type DriverKarne = {
  overall: number;
  sessions: number;
  categories: KarneCategories;
  history: KarneHistoryEntry[];
  /** Optional last style-adherence (info only) */
  lastStyleAdherence?: number | null;
};

export type DriverProfile = {
  id: string;
  name: string;
  createdAt: number;
  baseline: DriverBaseline;
  karne: DriverKarne;
  /** True once an explicit clean kalibrasyon was saved */
  calibrated?: boolean;
};

const STORAGE_KEY = 'surus-profiles-v2';
const STORAGE_KEY_LEGACY = 'surus-profiles-v1';
const ACTIVE_KEY = 'surus-active-profile';
const CAMERA_KEY = 'surus-camera-mode';

/** EWMA blend: 80% history + 20% session — only on clean sessions for baseline. */
const KARNE_ALPHA = 0.32;
const BASELINE_EMA_ALPHA = 0.15;

const DEFAULT_CATS: KarneCategories = {
  smoothness: 70,
  compliance: 70,
  scanProxy: 70,
  safetyAggression: 70,
  taskEfficiency: 70,
};

function uid(): string {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function emptyKarne(): DriverKarne {
  return {
    overall: 70,
    sessions: 0,
    categories: { ...DEFAULT_CATS },
    history: [],
    lastStyleAdherence: null,
  };
}

function migrateCats(raw: KarneCategories & LegacyCats): KarneCategories {
  if (
    typeof raw.smoothness === 'number' &&
    typeof raw.compliance === 'number' &&
    typeof raw.scanProxy === 'number' &&
    typeof raw.safetyAggression === 'number' &&
    typeof raw.taskEfficiency === 'number'
  ) {
    return {
      smoothness: raw.smoothness,
      compliance: raw.compliance,
      scanProxy: raw.scanProxy,
      safetyAggression: raw.safetyAggression,
      taskEfficiency: raw.taskEfficiency,
    };
  }
  // Legacy → new axes
  return {
    smoothness: raw.yumuşaklık ?? 70,
    compliance: raw.şerit ?? raw.hız ?? 70,
    scanProxy: raw.dikkatProxy ?? 70,
    safetyAggression: raw.güvenlik ?? 70,
    taskEfficiency: 70,
  };
}

function migrateBaseline(b: Partial<Baseline> | undefined): DriverBaseline {
  const base = emptyBaseline();
  if (!b) return base;
  return {
    ready: !!b.ready,
    meanSpeed: b.meanSpeed ?? 0,
    meanAccelAbs: b.meanAccelAbs ?? 0,
    meanYawAbs: b.meanYawAbs ?? 0,
    meanSteerAbs: b.meanSteerAbs ?? 0,
    mirrorBeforeSteerRate: b.mirrorBeforeSteerRate ?? 0,
  };
}

function migrateProfile(p: DriverProfile): DriverProfile {
  return {
    ...p,
    baseline: migrateBaseline(p.baseline),
    calibrated: p.calibrated ?? !!p.baseline?.ready,
    karne: {
      ...emptyKarne(),
      ...p.karne,
      categories: migrateCats((p.karne?.categories ?? DEFAULT_CATS) as KarneCategories & LegacyCats),
      history: Array.isArray(p.karne?.history) ? p.karne.history : [],
    },
  };
}

export function loadProfiles(): DriverProfile[] {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(STORAGE_KEY_LEGACY);
    }
    if (!raw) return [];
    const data = JSON.parse(raw) as DriverProfile[];
    if (!Array.isArray(data)) return [];
    const migrated = data.map(migrateProfile);
    // Persist under v2 once
    if (!localStorage.getItem(STORAGE_KEY)) saveProfiles(migrated);
    return migrated;
  } catch {
    return [];
  }
}

export function saveProfiles(list: DriverProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveProfileId(id: string | null) {
  if (id == null) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveProfile(): DriverProfile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return loadProfiles().find((p) => p.id === id) ?? null;
}

export function createProfile(name: string, baseline?: DriverBaseline): DriverProfile {
  const profile: DriverProfile = {
    id: uid(),
    name: name.trim() || 'Sürücü',
    createdAt: Date.now(),
    baseline: baseline ? migrateBaseline(baseline) : emptyBaseline(),
    karne: emptyKarne(),
    calibrated: !!(baseline && baseline.ready),
  };
  const list = loadProfiles();
  list.push(profile);
  saveProfiles(list);
  setActiveProfileId(profile.id);
  return profile;
}

export function deleteProfile(id: string): boolean {
  const list = loadProfiles().filter((p) => p.id !== id);
  saveProfiles(list);
  if (getActiveProfileId() === id) setActiveProfileId(null);
  return true;
}

export function updateProfile(profile: DriverProfile) {
  const list = loadProfiles();
  const i = list.findIndex((p) => p.id === profile.id);
  if (i >= 0) {
    list[i] = profile;
    saveProfiles(list);
  }
}

export function selectProfile(id: string | null) {
  setActiveProfileId(id);
}

export function axesFromSession(axes: SessionAxes): KarneCategories {
  return {
    smoothness: axes.smoothness,
    compliance: axes.compliance,
    scanProxy: axes.scanProxy,
    safetyAggression: axes.safetyAggression,
    taskEfficiency: axes.taskEfficiency,
  };
}

/** Map flat metric scores → axes (fallback when SessionResult unavailable). */
export function scoresToCategories(scores: MetricScore[]): KarneCategories {
  const by = (ids: string[]) => {
    const hit = scores.filter((s) => ids.includes(s.id));
    if (!hit.length) return 70;
    return Math.round(hit.reduce((a, s) => a + s.score, 0) / hit.length);
  };
  return {
    smoothness: by(['puruzsuzluk', 'steering', 'hard_events', 'jerk', 'tb_smooth']),
    compliance: by(['speed_limit', 'wrongway', 'offroad']),
    scanProxy: by(['mirror_proxy', 'attention_proxy']),
    safetyAggression: by(['guvenlik', 'collision', 'hard_events']),
    taskEfficiency: by(['gorev', 'target_time', 'route_dev']),
  };
}

export function overallFromCategories(c: KarneCategories): number {
  // Same Proje-Tübitak spirit: safety-weighted, not flat average
  return Math.round(
    c.safetyAggression * 0.3 +
      c.compliance * 0.25 +
      c.scanProxy * 0.2 +
      c.smoothness * 0.15 +
      c.taskEfficiency * 0.1
  );
}

/**
 * Apply session onto persistent karne.
 * - Slower EWMA (~80/20)
 * - Absolute safety (session axes) drives updates more than style match
 * - styleAdherence stored as info only — does NOT inflate güvenlik
 * - Dirty/crash sessions still update karne (truth), but caller must NOT EMA baseline
 */
export function applySessionToKarne(
  profile: DriverProfile,
  scores: MetricScore[],
  sessionOverall: number,
  session?: SessionResult | null
): { delta: number; profile: DriverProfile } {
  const sessionCats = session ? axesFromSession(session.axes) : scoresToCategories(scores);
  const prevOverall = profile.karne.overall;
  const cats = { ...profile.karne.categories };
  const alpha = KARNE_ALPHA;

  for (const key of Object.keys(cats) as (keyof KarneCategories)[]) {
    let a = alpha;
    // Bad safety / compliance pulls a bit harder; great sessions also land
    const gap = sessionCats[key] - cats[key];
    if (gap < -12) a = Math.min(0.45, alpha + 0.1);
    else if (gap > 12) a = Math.min(0.4, alpha + 0.06);
    cats[key] = clamp(Math.round(cats[key] * (1 - a) + sessionCats[key] * a), 0, 100);
  }

  const fromCats = overallFromCategories(cats);
  // Target = mix of this session score and blended categories
  let target = Math.round(sessionOverall * 0.65 + fromCats * 0.35);
  if (session?.riskLevel === 'Riskli') {
    target = Math.min(target, Math.max(sessionOverall, 18), 55);
  } else if (session?.hardFail) {
    target = Math.min(target, Math.max(sessionOverall + 4, 50), 65);
  }
  target = clamp(target, 0, 100);

  // Move toward target: ~40% of gap, capped ±12 so one session can't jump 40 points
  const gap = target - prevOverall;
  let step = Math.round(gap * 0.4);
  if (Math.abs(gap) < 1.5) step = 0;
  else if (step === 0) step = gap > 0 ? 1 : -1;
  step = clamp(step, -12, 12);

  // Confidence softens huge swings on very short sessions
  const conf = session?.confidence ?? 1;
  if (conf < 0.5 && Math.abs(step) > 4) {
    step = Math.round(step * (0.55 + conf * 0.45));
    if (step === 0 && Math.abs(gap) >= 3) step = gap > 0 ? 1 : -1;
  }

  let nextOverall = clamp(prevOverall + step, 0, 100);
  const delta = nextOverall - prevOverall;
  const history = [
    ...profile.karne.history,
    { at: Date.now(), overall: nextOverall, delta },
  ].slice(-20);

  const updated: DriverProfile = {
    ...profile,
    karne: {
      overall: nextOverall,
      sessions: profile.karne.sessions + 1,
      categories: cats,
      history,
      lastStyleAdherence: session?.styleAdherence ?? null,
    },
  };
  updateProfile(updated);
  return { delta, profile: updated };
}

/**
 * Explicit calibration write — ONLY from clean kalibrasyon sessions.
 * Never call on anomaly/crash/endSession indiscriminately.
 */
export function setProfileBaseline(
  profile: DriverProfile,
  baseline: DriverBaseline,
  opts?: { calibrated?: boolean }
): DriverProfile {
  const updated: DriverProfile = {
    ...profile,
    baseline: migrateBaseline(baseline),
    calibrated: opts?.calibrated ?? true,
  };
  updateProfile(updated);
  return updated;
}

/**
 * Slow EMA refresh of personal baseline — ONLY clean sessions.
 * Never overwrite with anomaly/bad/crash.
 */
export function emaUpdateBaseline(
  profile: DriverProfile,
  snapshot: DriverBaseline,
  clean: boolean
): DriverProfile | null {
  if (!clean || !snapshot.ready) return null;
  if (profile.baseline.ready) {
    const b = profile.baseline;
    const next: DriverBaseline = {
      ready: true,
      meanSpeed: ema(b.meanSpeed, snapshot.meanSpeed, BASELINE_EMA_ALPHA),
      meanAccelAbs: ema(b.meanAccelAbs, snapshot.meanAccelAbs, BASELINE_EMA_ALPHA),
      meanYawAbs: ema(b.meanYawAbs, snapshot.meanYawAbs, BASELINE_EMA_ALPHA),
      meanSteerAbs: ema(b.meanSteerAbs, snapshot.meanSteerAbs, BASELINE_EMA_ALPHA),
      mirrorBeforeSteerRate: ema(
        b.mirrorBeforeSteerRate || 0,
        snapshot.mirrorBeforeSteerRate || 0,
        BASELINE_EMA_ALPHA
      ),
    };
    return setProfileBaseline(profile, next, { calibrated: true });
  }
  // First clean calibration
  return setProfileBaseline(profile, snapshot, { calibrated: true });
}

export function letterGrade(overall: number): string {
  if (overall >= 90) return 'A';
  if (overall >= 80) return 'B';
  if (overall >= 70) return 'C';
  if (overall >= 60) return 'D';
  if (overall >= 50) return 'E';
  return 'F';
}

export function getCameraMode(): 'fp' | 'chase' {
  const v = localStorage.getItem(CAMERA_KEY);
  return v === 'chase' ? 'chase' : 'fp';
}

export function setCameraMode(mode: 'fp' | 'chase') {
  localStorage.setItem(CAMERA_KEY, mode);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/** Turkish labels for the 5 axes */
export const AXIS_TR: Record<
  keyof KarneCategories,
  { title: string; tip: string }
> = {
  smoothness: { title: 'Pürüzsüzlük', tip: 'Jerk, sert fren/gaz/viraj, direksiyon' },
  compliance: { title: 'Kural uyumu', tip: 'Limit, off-road, ters yön (Safety Floor)' },
  scanProxy: {
    title: 'Tarama proxy',
    tip: 'Ayna/omuz Space proxy — eye-tracking değil',
  },
  safetyAggression: {
    title: 'Güvenlik (agresyon ters)',
    tip: 'Çarpışma/sert olay azlığı — yüksek = iyi',
  },
  taskEfficiency: { title: 'Görev verimi', tip: 'Waypoint süre/rota — %10 ağırlık' },
};
