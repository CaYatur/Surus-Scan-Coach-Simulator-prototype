import type { Sample } from './telemetry';
import type { WaypointResult } from './waypoints';
import { SPEED_LIMIT_KMH } from './world';

/** Research-pool metric row for the expandable detail lab (not the lean summary). */
export type DetailMetric = {
  id: string;
  nameTr: string;
  category: string;
  /** null = unavailable in sim (grey bar) */
  score0to100: number | null;
  valueLabel: string;
  tip: string;
};

const SAMPLE_DT = 1 / 15;

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))));
  return s[i];
}

function clamp(n: number, a = 0, b = 100): number {
  return Math.max(a, Math.min(b, Math.round(n)));
}

function countBursts(flags: boolean[]): number {
  let n = 0;
  let on = false;
  for (const f of flags) {
    if (f && !on) {
      n++;
      on = true;
    } else if (!f) on = false;
  }
  return n;
}

function durationSec(flags: boolean[]): number {
  return flags.filter(Boolean).length * SAMPLE_DT;
}

/**
 * Build ~40–80 research-pool metrics from existing telemetry only.
 * Sensor / eye-tracking / TTC rows are included as "simde yok" with null score.
 */
export function computeDetailMetrics(
  samples: Sample[],
  waypoints: WaypointResult[],
  sessionSec: number
): DetailMetric[] {
  const out: DetailMetric[] = [];
  const push = (
    id: string,
    nameTr: string,
    category: string,
    score0to100: number | null,
    valueLabel: string,
    tip: string
  ) => {
    out.push({ id, nameTr, category, score0to100, valueLabel, tip });
  };

  const n = samples.length;
  const speeds = samples.map((s) => s.speedKmh);
  const speedMs = samples.map((s) => s.speed);
  const accels = samples.map((s) => s.accel);
  const absAcc = accels.map((a) => Math.abs(a));
  const steers = samples.map((s) => s.steer);
  const absSteer = steers.map((x) => Math.abs(x));
  const yaws = samples.map((s) => s.yawRate);
  const absYaw = yaws.map((y) => Math.abs(y));
  const laterals = samples.map((s) => s.lateralOffset);
  const headings = samples.map((s) => s.headingError);
  const throttles = samples.map((s) => s.throttle);
  const brakes = samples.map((s) => s.brake);

  let distanceM = 0;
  for (const s of samples) distanceM += Math.abs(s.speed) * SAMPLE_DT;
  const wpPathM = waypoints.reduce((a, w) => a + (w.pathLengthApprox || 0), 0);
  if (wpPathM > distanceM) distanceM = wpPathM;
  const distanceKm = distanceM / 1000;
  const perKm = Math.max(0.15, distanceKm);

  const jerks: number[] = [];
  for (let i = 1; i < accels.length; i++) {
    jerks.push(Math.abs(accels[i] - accels[i - 1]) * 15);
  }
  const steerDeltas: number[] = [];
  for (let i = 1; i < steers.length; i++) {
    steerDeltas.push(Math.abs(steers[i] - steers[i - 1]));
  }

  let hardBrake = 0;
  let hardAccel = 0;
  let hardCorner = 0;
  let extremeAccel = 0;
  let conflict = 0;
  let mirrorFrames = 0;
  let reverseFrames = 0;
  let collisionEdges = 0;
  let lastCol = false;
  let significantSteer = 0;
  let mirrorBeforeSteer = 0;
  let prevSteer = 0;
  let idleGaps = 0;
  let idleAccum = 0;
  let lastActive = true;
  let coastFrames = 0;
  let stopFrames = 0;
  let movingFrames = 0;
  let highThrottle = 0;
  let fullBrake = 0;

  for (const s of samples) {
    if (s.accel < -6) hardBrake++;
    if (s.accel > 5) hardAccel++;
    if (Math.abs(s.accel) > 8) extremeAccel++;
    if (Math.abs(s.yawRate) > 1.4 && s.speedKmh > 20) hardCorner++;
    if (s.throttle > 0.2 && s.brake > 0.2) conflict++;
    if (s.mirror) mirrorFrames++;
    if (s.reversing) reverseFrames++;
    if (s.collision && !lastCol) collisionEdges++;
    lastCol = s.collision;
    const dSteer = Math.abs(s.steer - prevSteer);
    if (dSteer > 0.45 && s.speedKmh > 8) {
      significantSteer++;
      if (s.mirror) mirrorBeforeSteer++;
    }
    prevSteer = s.steer;
    const inputActive = s.throttle > 0.05 || s.brake > 0.05 || Math.abs(s.steer) > 0.08;
    if (!inputActive && s.speedKmh > 3) {
      idleAccum += SAMPLE_DT;
      if (idleAccum > 2.5 && lastActive) {
        idleGaps++;
        lastActive = false;
      }
    } else {
      idleAccum = 0;
      lastActive = true;
    }
    if (s.throttle < 0.05 && s.brake < 0.05 && s.speedKmh > 5) coastFrames++;
    if (s.speedKmh < 1.5) stopFrames++;
    if (s.speedKmh > 5) movingFrames++;
    if (s.throttle > 0.85) highThrottle++;
    if (s.brake > 0.85) fullBrake++;
  }

  const overFlags = samples.map((s) => s.speedKmh > SPEED_LIMIT_KMH + 2);
  const offFlags = samples.map((s) => s.offroad);
  const wrongFlags = samples.map((s) => s.wrongway && s.speedKmh > 5);
  const overSec = durationSec(overFlags);
  const offSec = durationSec(offFlags);
  const wrongSec = durationSec(wrongFlags);
  const reverseSec = reverseFrames * SAMPLE_DT;
  const overFrac = sessionSec > 0 ? overSec / sessionSec : 0;
  const mirrorRate = significantSteer > 0 ? mirrorBeforeSteer / significantSteer : 0;
  const conflictFrac = n ? conflict / n : 0;
  const movingSpeeds = speeds.filter((_, i) => samples[i].speedKmh > 5);
  const meanSpd = mean(speeds);
  const meanMoving = movingSpeeds.length ? mean(movingSpeeds) : 0;
  const p95Spd = percentile(speeds, 95);
  const maxSpd = speeds.length ? Math.max(...speeds) : 0;
  const stdSpd = std(speeds);
  const jerkMean = mean(jerks);
  const jerkP95 = percentile(jerks, 95);
  const lateralStd = std(laterals);
  const headingMean = mean(headings.map(Math.abs));
  const headingStd = std(headings);
  const steerIrr = std(steerDeltas) + mean(steerDeltas);
  const rate = (count: number) => count / perKm;

  // ——— Oturum ———
  push('sess_dur', 'Oturum süresi', 'Oturum', clamp(sessionSec >= 90 ? 100 : (sessionSec / 90) * 100), `${sessionSec.toFixed(1)} s`, 'Kısa oturumlar güveni düşürür.');
  push('sess_samples', 'Örnek sayısı', 'Oturum', clamp(n >= 200 ? 100 : (n / 200) * 100), `${n}`, '15 Hz telemetri örnekleri.');
  push('sess_dist', 'Mesafe', 'Oturum', clamp(distanceKm >= 0.8 ? 100 : (distanceKm / 0.8) * 100), `${distanceKm.toFixed(3)} km`, 'Entegre hız + waypoint yolu.');
  push('sess_moving_frac', 'Hareket oranı', 'Oturum', n ? clamp((movingFrames / n) * 100) : 50, n ? `%${((movingFrames / n) * 100).toFixed(0)}` : '—', 'speed > 5 km/h oranı.');
  push('sess_stop_frac', 'Durma oranı', 'Oturum', n ? clamp(100 - (stopFrames / n) * 80) : 50, n ? `%${((stopFrames / n) * 100).toFixed(0)}` : '—', 'speed < 1.5 km/h.');
  push('sess_coast_frac', 'Serbest yuvarlanma', 'Oturum', n ? clamp(100 - (coastFrames / n) * 60) : 70, n ? `%${((coastFrames / n) * 100).toFixed(0)}` : '—', 'Gaz/fren yok, hız > 5.');

  // ——— Hız ———
  push('spd_mean', 'Ortalama hız', 'Hız', clamp(100 - Math.abs(meanSpd - 35) * 2), `${meanSpd.toFixed(1)} km/h`, 'Tüm örnekler ortalaması.');
  push('spd_mean_moving', 'Hareket halinde ort. hız', 'Hız', clamp(100 - Math.abs(meanMoving - 40) * 2.2), `${meanMoving.toFixed(1)} km/h`, 'Yalnızca moving örnekler.');
  push('spd_p95', 'Hız p95', 'Hız', clamp(100 - Math.max(0, p95Spd - SPEED_LIMIT_KMH) * 4), `${p95Spd.toFixed(1)} km/h`, 'Üst kuyruk hız.');
  push('spd_max', 'Maksimum hız', 'Hız', clamp(100 - Math.max(0, maxSpd - SPEED_LIMIT_KMH) * 3), `${maxSpd.toFixed(1)} km/h`, 'Tepe hız.');
  push('spd_std', 'Hız std (değişkenlik)', 'Hız', clamp(100 - stdSpd * 3), `${stdSpd.toFixed(1)} km/h`, 'Düşük = daha kararlı hız.');
  push('spd_overspeed_sec', 'Limit aşım süresi', 'Hız', clamp(100 - overSec * 8), `${overSec.toFixed(1)} s`, `Limit ${SPEED_LIMIT_KMH} km/h +2.`);
  push('spd_overspeed_frac', 'Limit aşım oranı', 'Hız', clamp(100 - overFrac * 180), `%${(overFrac * 100).toFixed(1)}`, 'Oturum içi aşım oranı.');
  push('spd_overspeed_bursts', 'Limit aşım patlaması', 'Hız', clamp(100 - countBursts(overFlags) * 12), `${countBursts(overFlags)}`, 'Sürekli aşım bölümleri.');
  push('spd_compliance', 'Limit uyum skoru', 'Hız', clamp(100 - overFrac * 180), `${clamp(100 - overFrac * 180)}/100`, 'Safety Floor bileşeni.');
  push('spd_ms_mean', 'Ortalama hız (m/s)', 'Hız', null, `${mean(speedMs).toFixed(2)} m/s`, 'Ham m/s ortalaması (bilgi).');

  // ——— İvme / pürüzsüzlük ———
  push('acc_mean_abs', 'Ortalama |ivme|', 'İvme', clamp(100 - mean(absAcc) * 12), `${mean(absAcc).toFixed(2)} m/s²`, 'Düşük = yumuşak.');
  push('acc_p95', '|ivme| p95', 'İvme', clamp(100 - percentile(absAcc, 95) * 8), `${percentile(absAcc, 95).toFixed(2)} m/s²`, 'Üst kuyruk ivme.');
  push('acc_std', 'İvme std', 'İvme', clamp(100 - std(accels) * 10), `${std(accels).toFixed(2)}`, 'İvme değişkenliği.');
  push('jerk_mean', 'Jerk ortalaması', 'İvme', clamp(100 - jerkMean * 2.5), `${jerkMean.toFixed(1)}`, 'İvme değişim hızı.');
  push('jerk_p95', 'Jerk p95', 'İvme', clamp(100 - jerkP95 * 1.8), `${jerkP95.toFixed(1)}`, 'Ani sarsıntı kuyruğu.');
  push('hard_brake', 'Sert fren sayısı', 'İvme', clamp(100 - rate(hardBrake) * 12), `${hardBrake} (${rate(hardBrake).toFixed(1)}/km)`, 'accel < −6.');
  push('hard_accel', 'Sert gaz sayısı', 'İvme', clamp(100 - rate(hardAccel) * 12), `${hardAccel} (${rate(hardAccel).toFixed(1)}/km)`, 'accel > 5.');
  push('extreme_accel', 'Aşırı ivme', 'İvme', clamp(100 - rate(extremeAccel) * 15), `${extremeAccel}`, '|accel| > 8 (Safety Floor).');
  push('tb_conflict', 'Gaz+fren çakışması', 'İvme', clamp(100 - conflictFrac * 400), `%${(conflictFrac * 100).toFixed(1)}`, 'throttle>0.2 ve brake>0.2.');
  push('high_throttle_frac', 'Tam gaz oranı', 'İvme', n ? clamp(100 - (highThrottle / n) * 200) : 80, n ? `%${((highThrottle / n) * 100).toFixed(1)}` : '—', 'throttle > 0.85.');
  push('full_brake_frac', 'Tam fren oranı', 'İvme', n ? clamp(100 - (fullBrake / n) * 150) : 80, n ? `%${((fullBrake / n) * 100).toFixed(1)}` : '—', 'brake > 0.85.');
  push('throttle_mean', 'Ortalama gaz', 'İvme', clamp(100 - Math.abs(mean(throttles) - 0.35) * 80), mean(throttles).toFixed(2), 'Pedal ortalaması.');
  push('brake_mean', 'Ortalama fren', 'İvme', clamp(100 - mean(brakes) * 120), mean(brakes).toFixed(2), 'Düşük fren = daha akıcı (bağlama bağlı).');

  // ——— Direksiyon / şerit ———
  push('steer_abs_mean', 'Ortalama |direksiyon|', 'Direksiyon', clamp(100 - mean(absSteer) * 80), mean(absSteer).toFixed(3), 'Ortalama sapma.');
  push('steer_std', 'Direksiyon std', 'Direksiyon', clamp(100 - std(steers) * 90), std(steers).toFixed(3), 'Titreme / düzensizlik.');
  push('steer_irr', 'Direksiyon düzensizliği', 'Direksiyon', clamp(100 - steerIrr * 120), steerIrr.toFixed(3), 'Delta ortalama + std.');
  push('steer_delta_mean', 'Direksiyon Δ ort.', 'Direksiyon', clamp(100 - mean(steerDeltas) * 200), mean(steerDeltas).toFixed(3), 'Örnekler arası değişim.');
  push('hard_corner', 'Sert viraj', 'Direksiyon', clamp(100 - rate(hardCorner) * 15), `${hardCorner} (${rate(hardCorner).toFixed(1)}/km)`, '|yaw| > 1.4 & hız > 20.');
  push('yaw_abs_mean', 'Ortalama |yaw rate|', 'Direksiyon', clamp(100 - mean(absYaw) * 40), mean(absYaw).toFixed(3) + ' rad/s', 'Dönüş hızı ort.');
  push('yaw_p95', '|yaw| p95', 'Direksiyon', clamp(100 - percentile(absYaw, 95) * 35), percentile(absYaw, 95).toFixed(3), 'Üst kuyruk yaw.');
  push('sdlp_proxy', 'SDLP proxy (lateral std)', 'Direksiyon', clamp(100 - lateralStd * 25), lateralStd.toFixed(3) + ' m', 'Şerit içi yanal standart sapma — klinik SDLP değil.');
  push('lateral_mean_abs', 'Ortalama |yanal ofset|', 'Direksiyon', clamp(100 - mean(laterals.map(Math.abs)) * 20), mean(laterals.map(Math.abs)).toFixed(2) + ' m', 'Şerit merkezinden sapma.');
  push('heading_mean', 'Ortalama |heading err|', 'Direksiyon', clamp(100 - headingMean * 50), headingMean.toFixed(3), 'Yol yönü hatası.');
  push('heading_std', 'Heading err std', 'Direksiyon', clamp(100 - headingStd * 40), headingStd.toFixed(3), 'Yön kararlılığı.');

  // ——— Güvenlik / kural ———
  push('col_count', 'Çarpışma sayısı', 'Güvenlik', clamp(100 - rate(collisionEdges) * 45), `${collisionEdges}`, 'Araç/bina kenarları.');
  push('col_per_km', 'Çarpışma / km', 'Güvenlik', clamp(100 - rate(collisionEdges) * 50), rate(collisionEdges).toFixed(2) + '/km', 'Mesafe normalize.');
  push('offroad_sec', 'Off-road süresi', 'Güvenlik', clamp(100 - (offSec / Math.max(1, sessionSec)) * 250), `${offSec.toFixed(1)} s`, 'Şerit / yol dışı.');
  push('offroad_bursts', 'Off-road patlaması', 'Güvenlik', clamp(100 - countBursts(offFlags) * 10), `${countBursts(offFlags)}`, 'Ayrı çıkış olayları.');
  push('wrongway_sec', 'Ters yön süresi', 'Güvenlik', clamp(100 - (wrongSec / Math.max(1, sessionSec)) * 300), `${wrongSec.toFixed(1)} s`, '≥4s hard-fail.');
  push('wrongway_bursts', 'Ters yön patlaması', 'Güvenlik', clamp(100 - countBursts(wrongFlags) * 20), `${countBursts(wrongFlags)}`, 'Ayrı ters yön girişleri.');
  push('reverse_sec', 'Geri gitme süresi', 'Güvenlik', clamp(100 - reverseSec * 4), `${reverseSec.toFixed(1)} s`, 'velocity < −0.3.');
  push('hard_events_total', 'Sert olay toplamı', 'Güvenlik', clamp(100 - rate(hardBrake + hardAccel + hardCorner) * 8), `${hardBrake + hardAccel + hardCorner}`, 'Fren+gaz+viraj.');
  push('hard_events_per_km', 'Sert olay / km', 'Güvenlik', clamp(100 - rate(hardBrake + hardAccel + hardCorner) * 10), rate(hardBrake + hardAccel + hardCorner).toFixed(1) + '/km', 'Normalize oran.');

  // ——— Tarama / dikkat proxy ———
  push('mirror_rate', 'Ayna öncesi direksiyon oranı', 'Tarama', clamp(mirrorRate * 100), `%${(mirrorRate * 100).toFixed(0)} (${mirrorBeforeSteer}/${significantSteer})`, 'Space proxy — eye-tracking değil.');
  push('mirror_frames', 'Ayna proxy kare oranı', 'Tarama', n ? clamp(Math.min(100, (mirrorFrames / n) * 400)) : 0, n ? `%${((mirrorFrames / n) * 100).toFixed(1)}` : '—', 'Space basılı örnek oranı.');
  push('sig_steer', 'Anlamlı direksiyon olayı', 'Tarama', significantSteer > 0 ? clamp(Math.min(100, significantSteer * 5)) : 40, `${significantSteer}`, 'Δsteer > 0.45 & hız > 8.');
  push('idle_gaps', 'Girdi boşluğu (dikkat proxy)', 'Tarama', clamp(100 - idleGaps * 12), `${idleGaps}`, 'Klavye idle — klinik değil.');
  push('attention_score', 'Dikkat proxy skoru', 'Tarama', clamp(100 - idleGaps * 12), `${clamp(100 - idleGaps * 12)}/100`, 'Idle gap cezası.');

  // ——— Waypoint / görev ———
  const wpTimes = waypoints.map((w) => w.timeSec);
  const avgWp = wpTimes.length ? mean(wpTimes) : 0;
  const minWp = wpTimes.length ? Math.min(...wpTimes) : 0;
  const maxWp = wpTimes.length ? Math.max(...wpTimes) : 0;
  const totalPath = waypoints.reduce((a, w) => a + w.pathLengthApprox, 0);
  push('wp_count', 'Tamamlanan waypoint', 'Görev', waypoints.length ? clamp((waypoints.length / Math.max(1, waypoints.length)) * 100) : 30, `${waypoints.length}`, 'Bu oturumda biten hedefler.');
  push('wp_avg_time', 'Ort. waypoint süresi', 'Görev', wpTimes.length ? clamp(100 - Math.max(0, avgWp - 35) * 2 - Math.max(0, 12 - avgWp) * 1.5) : 50, wpTimes.length ? `${avgWp.toFixed(1)} s` : 'wp yok', 'Hedef süre bandı ~12–35s.');
  push('wp_min_time', 'En hızlı waypoint', 'Görev', wpTimes.length ? clamp(100 - Math.max(0, 8 - minWp) * 8) : null, wpTimes.length ? `${minWp.toFixed(1)} s` : '—', 'Çok hızlı = agresyon riski.');
  push('wp_max_time', 'En yavaş waypoint', 'Görev', wpTimes.length ? clamp(100 - Math.max(0, maxWp - 45) * 2) : null, wpTimes.length ? `${maxWp.toFixed(1)} s` : '—', 'Uzun süre = verimsizlik.');
  push('wp_time_std', 'Waypoint süre std', 'Görev', wpTimes.length > 1 ? clamp(100 - std(wpTimes) * 4) : null, wpTimes.length > 1 ? std(wpTimes).toFixed(1) + ' s' : '—', 'Tutarlı tempo.');
  push('wp_path_total', 'Toplam rota uzunluğu', 'Görev', totalPath > 0 ? clamp(Math.min(100, totalPath / 10)) : 40, `${totalPath.toFixed(0)} m`, 'Yaklaşık pathLength.');
  push('wp_path_eff', 'Rota verimi proxy', 'Görev', (() => {
    if (!waypoints.length) return 50;
    const ratios = waypoints.map((w) => {
      const expected = Math.max(20, w.timeSec * 10);
      return w.pathLengthApprox / expected;
    });
    return clamp(100 - Math.max(0, mean(ratios) - 1) * 60);
  })(), waypoints.length ? 'bkz. skor' : 'wp yok', 'path / beklenen süre.');

  // ——— Sensör / simde yok (literatür yer tutucu) ———
  const na = (id: string, nameTr: string, tip: string) =>
    push(id, nameTr, 'Sensör (simde yok)', null, 'simde yok', tip);
  na('ttc_min', 'Minimum TTC', 'Çarpışma süresi (time-to-collision) — kamera/radar yok.');
  na('ttc_p05', 'TTC p05', 'Kritik yaklaşma kuyruğu — sim telemetrisinde yok.');
  na('gaze_road_pct', 'Bakış yol yüzdesi', 'Eye-tracking yok — Space yalnızca davranışsal proxy.');
  na('gaze_mirror_pct', 'Bakış ayna yüzdesi', 'Gerçek ayna bakışı ölçülmez.');
  na('fixation_rate', 'Fiksasyon oranı', 'Göz takip cihazı yok.');
  na('pupil_var', 'Pupil değişkenliği', 'Fizyolojik sensör yok.');
  na('head_yaw_std', 'Baş yaw std', 'Head-tracking yok.');
  na('blink_rate', 'Göz kırpma oranı', 'Kamera tabanlı ölçüm yok.');
  na('lane_cam_sdlp', 'Kamera SDLP', 'Ön kamera şerit modeli yok; lateralOffset proxy ayrı.');
  na('obstacle_detect', 'Engel algılama skoru', 'Nesne algılama sensörü yok.');

  return out;
}

/** Group detail metrics by category (insertion order of first appearance). */
export function groupDetailMetrics(list: DetailMetric[]): { category: string; items: DetailMetric[] }[] {
  const order: string[] = [];
  const map = new Map<string, DetailMetric[]>();
  for (const m of list) {
    if (!map.has(m.category)) {
      map.set(m.category, []);
      order.push(m.category);
    }
    map.get(m.category)!.push(m);
  }
  return order.map((category) => ({ category, items: map.get(category)! }));
}
