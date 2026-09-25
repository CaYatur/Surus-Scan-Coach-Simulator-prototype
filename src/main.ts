import './style.css';
import * as THREE from 'three';
import { Input } from './input';
import { Car } from './car';
import { World, SPEED_LIMIT_KMH, RIGHT_LANE_X } from './world';
import { Waypoints } from './waypoints';
import { Telemetry } from './telemetry';
import { MetricsEngine, emptyBaseline, type SessionMode } from './metrics';
import { HUD, renderProfileList, renderKarneCard } from './hud';
import { buildReportHtml, showReportOverlay } from './report';
import { computeDetailMetrics } from './detailMetrics';
import { CameraController } from './camera';
import { Minimap } from './minimap';
import { Mirrors } from './mirrors';
import { Traffic } from './traffic';
import { CrashFX } from './fx';
import {
  loadProfiles,
  getActiveProfile,
  getActiveProfileId,
  createProfile,
  deleteProfile,
  selectProfile,
  applySessionToKarne,
  setProfileBaseline,
  emaUpdateBaseline,
  type DriverProfile,
} from './profiles';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 500);
scene.add(camera);

const world = new World(scene);
const car = new Car();
scene.add(car.mesh);
car.reset(RIGHT_LANE_X, 10, 0);
const traffic = new Traffic(scene, car.position.x, car.position.z);
const crashFx = new CrashFX(scene);

const input = new Input();
const waypoints = new Waypoints(scene);
const telemetry = new Telemetry();
const metrics = new MetricsEngine();
const hud = new HUD();
const camCtrl = new CameraController(camera);
const minimap = new Minimap();
const mirrors = new Mirrors(renderer, scene);

let sessionStart = performance.now() / 1000;
let running = true;
let pausedForReport = false;
let baselineAnnounced = false;
let lastBaselineSnapshot = metrics.getBaselineSnapshot();
let hardCrashPending = false;
let hardCrashEndAt = 0;
let endReason: string | null = null;
let wasColliding = false;
/** Pending session result for report calibration save */
let lastSessionClean = false;

function activeProfile(): DriverProfile | null {
  return getActiveProfile();
}

/** Map UI: no profile → kalibrasyon; with profile → degerlendirme */
function currentMode(): SessionMode {
  return activeProfile() ? 'degerlendirme' : 'kalibrasyon';
}

function applyProfileToHud() {
  const p = activeProfile();
  const mode = currentMode();
  hud.setProfileLabel(p ? p.name : null, mode);
  hud.setCameraLabel(camCtrl.mode);
}

function beginMetricsForSession() {
  metrics.reset();
  baselineAnnounced = false;
  lastSessionClean = false;
  const mode = currentMode();
  metrics.setSessionMode(mode);
  const p = activeProfile();
  if (mode === 'degerlendirme' && p?.baseline?.ready) {
    // Inject for style-info only — Safety Floor never relaxed
    metrics.injectBaseline(p.baseline);
    baselineAnnounced = true;
    hud.info(`Profil stili yüklendi (değerlendirme): ${p.name} — Safety Floor açık`);
  }
  hud.setCalibSaveVisible(false);
}

function restartSession() {
  telemetry.reset();
  beginMetricsForSession();
  sessionStart = performance.now() / 1000;
  car.reset(RIGHT_LANE_X, 10, 0);
  traffic.resetFleet(car.position.x, car.position.z);
  crashFx.clear();
  hardCrashPending = false;
  hardCrashEndAt = 0;
  endReason = null;
  wasColliding = false;
  waypoints.start(car.position, undefined, car.yaw);
  running = true;
  pausedForReport = false;
  applyProfileToHud();
  const mode = currentMode();
  hud.info(
    `Yeni oturum (${mode === 'degerlendirme' ? 'profil değerlendirme' : 'eğitim/kalibrasyon'}) · limit ${SPEED_LIMIT_KMH} km/h · ${waypoints.total} waypoint · trafik ${traffic.count}`
  );
}

waypoints.start(car.position, undefined, car.yaw);
beginMetricsForSession();
applyProfileToHud();
hud.info(
  `Sürüşe başla · WASD · Space = ayna proxy (eye-tracking değil) · C = kamera · trafikte ${traffic.count} araç · limit ${SPEED_LIMIT_KMH} km/h`
);

document.getElementById('end-btn')!.addEventListener('click', () => endSession());

document.getElementById('btn-camera')!.addEventListener('click', () => {
  const mode = camCtrl.toggle();
  car.setFirstPerson(mode === 'fp');
  hud.setCameraLabel(mode);
  hud.info(mode === 'fp' ? 'İç açı (kokpit)' : 'Takip kamerası');
});

const profilesOverlay = document.getElementById('profiles-overlay')!;
const profilesPanel = document.getElementById('profiles-panel')!;
const karneOverlay = document.getElementById('karne-overlay')!;
const karnePanel = document.getElementById('karne-panel')!;

function openProfiles() {
  renderProfileList(profilesPanel, loadProfiles(), getActiveProfileId(), {
    onSelect: (id) => {
      selectProfile(id);
      beginMetricsForSession();
      applyProfileToHud();
      hud.info(id ? 'Profil seçildi — değerlendirme modu' : 'Eğitim / Kalibrasyon (profil yok)');
    },
    onDelete: (id) => {
      deleteProfile(id);
      openProfiles();
      applyProfileToHud();
    },
    onCreate: (name) => {
      // Always allow "Yeni profil" without requiring prior calibration.
      // Prefer clean+ready baseline; otherwise attach current/empty (stil isteğe bağlı).
      let snap = emptyBaseline();
      if (lastBaselineSnapshot.ready && (lastSessionClean || metrics.isCleanEnoughForCalibration())) {
        snap = lastBaselineSnapshot;
      } else if (lastBaselineSnapshot.ready) {
        snap = { ...lastBaselineSnapshot }; // ready stil, oturum kirli olabilir
      } else if (
        lastBaselineSnapshot.meanSpeed > 0 ||
        lastBaselineSnapshot.meanAccelAbs > 0 ||
        lastBaselineSnapshot.meanSteerAbs > 0
      ) {
        snap = { ...lastBaselineSnapshot, ready: false };
      }
      createProfile(name, snap);
      applyProfileToHud();
      beginMetricsForSession();
      hud.info(
        snap.ready
          ? `Profil oluşturuldu: ${name} (stil kaydı eklendi)`
          : `Profil oluşturuldu: ${name} (stil kaydı isteğe bağlı / boş)`
      );
    },
    onShowKarne: (id) => {
      const p = loadProfiles().find((x) => x.id === id);
      if (p) openKarne(p);
    },
    onClose: () => profilesOverlay.classList.add('hidden'),
  });
  profilesOverlay.classList.remove('hidden');
}

function openKarne(profile?: DriverProfile | null) {
  const p = profile ?? activeProfile();
  if (!p) {
    hud.info('Karne için önce bir profil seçin veya oluşturun');
    openProfiles();
    return;
  }
  renderKarneCard(karnePanel, p, () => karneOverlay.classList.add('hidden'));
  karneOverlay.classList.remove('hidden');
}

document.getElementById('btn-train-finish')!.addEventListener('click', () => {
  if (activeProfile()) {
    hud.info('Kalibrasyon bitirme yalnız eğitim modunda (profil yokken)');
    return;
  }
  const sessionSec = performance.now() / 1000 - sessionStart;
  metrics.finishBaselineEarly(telemetry.samples, sessionSec);
  lastBaselineSnapshot = metrics.getBaselineSnapshot();
  baselineAnnounced = true;
  hud.baselineReady();
  const clean = metrics.isCleanEnoughForCalibration();
  hud.setCalibSaveVisible(clean && lastBaselineSnapshot.ready);
  hud.info(
    clean
      ? 'Kalibrasyon baseline bitti — temiz oturum; kaydet veya profil oluştur'
      : 'Baseline hesaplandı ama oturum kirli (çarpışma/ters yön) — kaydetme önerilmez'
  );
});
document.getElementById('btn-train-extend')!.addEventListener('click', () => {
  if (activeProfile()) {
    hud.info('Uzatma yalnız eğitim / kalibrasyon sürüşünde');
    return;
  }
  metrics.extendBaseline(30);
  baselineAnnounced = false;
  hud.info(`Kalibrasyon uzatıldı · hedef ~${Math.round(metrics.getBaselineUntil())} sn`);
});

const calibSaveBtn = document.getElementById('btn-calib-save');
if (calibSaveBtn) {
  calibSaveBtn.addEventListener('click', () => {
    saveCalibrationNow();
  });
}

function saveCalibrationNow() {
  if (!metrics.isCleanEnoughForCalibration()) {
    hud.info('Oturum yeterince temiz değil — kalibrasyon kaydedilmedi');
    return;
  }
  const snap = metrics.buildCalibrationBaseline(telemetry.samples);
  lastBaselineSnapshot = snap;
  lastSessionClean = true;
  const profile = activeProfile();
  if (profile) {
    setProfileBaseline(profile, snap, { calibrated: true });
    hud.info(`Kalibrasyon kaydedildi: ${profile.name}`);
  } else {
    hud.info('Kalibrasyon hazır — Profiller’den “bu stile göre profil oluştur”');
  }
  hud.setCalibSaveVisible(false);
}

document.getElementById('btn-profiles')!.addEventListener('click', openProfiles);
document.getElementById('btn-karne')!.addEventListener('click', () => openKarne());

profilesOverlay.addEventListener('click', (e) => {
  if (e.target === profilesOverlay) profilesOverlay.classList.add('hidden');
});
karneOverlay.addEventListener('click', (e) => {
  if (e.target === karneOverlay) karneOverlay.classList.add('hidden');
});

function endSession(reason?: string) {
  if (pausedForReport) return;
  if (reason) endReason = reason;
  running = false;
  pausedForReport = true;
  const sessionSec = performance.now() / 1000 - sessionStart;
  const result = metrics.computeSessionResult(telemetry.samples, waypoints.results, sessionSec);
  const scores = result.scores;
  const overall = result.overall;
  lastBaselineSnapshot = metrics.getBaselineSnapshot();
  lastSessionClean = result.cleanEnoughForCalibration || metrics.isCleanEnoughForCalibration();

  const profile = activeProfile();
  let karneDelta: number | null = null;
  let updatedProfile = profile;

  if (profile) {
    const { delta, profile: updated } = applySessionToKarne(profile, scores, overall, result);
    karneDelta = delta;
    updatedProfile = updated;
    // NEVER overwrite baseline on every endSession — only EMA on clean sessions
    if (lastSessionClean && lastBaselineSnapshot.ready) {
      const emaUpdated = emaUpdateBaseline(updated, lastBaselineSnapshot, true);
      if (emaUpdated) updatedProfile = emaUpdated;
    }
  }

  // Profil oluştur: aktif profil yoksa ve oturumda anlamlı telemetri varsa göster
  // (temiz/baseline şartı gevşetildi — kirli oturumda da CTA; stil isteğe bağlı)
  const hasTelemetry =
    telemetry.samples.length > 30 || sessionSec > 15;
  const offerCreate = !profile && hasTelemetry;
  const preferCleanCreate =
    lastSessionClean && lastBaselineSnapshot.ready;

  const detailMetrics = computeDetailMetrics(
    telemetry.samples,
    waypoints.results,
    sessionSec
  );

  const html = buildReportHtml(scores, {
    sessionSec,
    waypointsDone: waypoints.results.length,
    waypointsTotal: waypoints.total,
    sampleCount: telemetry.samples.length,
    profileName: profile?.name ?? null,
    karneDelta,
    offerCreateProfile: offerCreate,
    createProfilePreferClean: preferCleanCreate,
    baselineReady: lastBaselineSnapshot.ready,
    // Kalibrasyonu kaydet: yalnızca temiz + hazır (önceki gibi)
    offerSaveCalibration:
      !!profile &&
      lastSessionClean &&
      lastBaselineSnapshot.ready &&
      metrics.getSessionMode() !== 'serbest',
    session: result,
    calibrated: !!(updatedProfile?.calibrated || updatedProfile?.baseline.ready),
    detailMetrics,
  });

  showReportOverlay(
    html,
    () => restartSession(),
    () => {
      const name = prompt('Profil adı:', 'Sürücü') || 'Sürücü';
      const snap =
        lastBaselineSnapshot.ready ||
        lastBaselineSnapshot.meanSpeed > 0 ||
        lastBaselineSnapshot.meanAccelAbs > 0
          ? lastBaselineSnapshot
          : emptyBaseline();
      createProfile(name, snap);
      applyProfileToHud();
      hud.info(
        snap.ready
          ? `Profil oluşturuldu: ${name}`
          : `Profil oluşturuldu: ${name} (stil kaydı isteğe bağlı)`
      );
      document.getElementById('report-overlay')!.classList.add('hidden');
      restartSession();
    },
    () => {
      if (!updatedProfile) return;
      if (!metrics.isCleanEnoughForCalibration() && !lastSessionClean) {
        hud.info('Kirli oturum — kalibrasyon kaydedilmedi');
        return;
      }
      const snap = metrics.buildCalibrationBaseline(telemetry.samples);
      setProfileBaseline(updatedProfile, snap, { calibrated: true });
      hud.info(`Kalibrasyon kaydedildi: ${updatedProfile.name}`);
      document.getElementById('report-overlay')!.classList.add('hidden');
      restartSession();
    }
  );
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let prev = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  if (!running || pausedForReport) {
    camCtrl.apply(car, dt);
    renderer.render(scene, camera);
    return;
  }

  const inp = input.update(dt);

  if (input.consumeEdge('KeyC')) {
    const mode = camCtrl.toggle();
    car.setFirstPerson(mode === 'fp');
    hud.setCameraLabel(mode);
    hud.info(mode === 'fp' ? 'İç açı (kokpit)' : 'Takip kamerası');
  }

  if (input.wasResetPressed() && now / 1000 - lastReset > 0.5) {
    lastReset = now / 1000;
    car.reset(RIGHT_LANE_X, Math.max(10, car.position.z), 0);
    hud.info('Araç sıfırlandı (R)');
  }

  if (hardCrashPending) {
    car.velocity = 0;
    car.accelLong = 0;
    crashFx.update(dt);
    camCtrl.apply(car, dt);
    hud.setSpeed(0);
    hud.setTime(now / 1000 - sessionStart);
    renderer.render(scene, camera);
    mirrors.setActive(false);
    if (now / 1000 >= hardCrashEndAt) {
      hardCrashPending = false;
      endSession(endReason ?? 'Ağır kaza');
    }
    return;
  }

  car.update(dt, inp);
  traffic.update(dt, car.position, car.velocity, car.yaw);

  const hitBuilding = world.resolveCollision(car.position);
  const npcHit = traffic.resolvePlayerCollision(car.position, car.velocity, car.yaw, dt);
  const hitNpc = npcHit.hit;

  car.mesh.position.copy(car.position);
  const road = world.query(car.position, car.yaw);
  if (hitBuilding || hitNpc) road.collision = true;

  const collidingNow = hitBuilding || hitNpc;
  const collisionEdge = collidingNow && !wasColliding;
  wasColliding = collidingNow;

  const buildingHard = hitBuilding && Traffic.isHardCrashFromSpeed(car.speedKmh());
  const npcHard = hitNpc && npcHit.hardCrash;
  const anyHard = (npcHard || buildingHard) && !hardCrashPending;

  // Hard crash can start mid-contact (sustained push after a soft bump)
  if (anyHard) {
    const rel = npcHard ? npcHit.relativeSpeedKmh : car.speedKmh();
    metrics.registerCrash({ hard: true, relativeSpeedKmh: rel });
    const at = car.position;
    crashFx.explode(at.x, at.y + 0.5, at.z, npcHard ? 1.2 : 1);
    car.velocity = 0;
    car.accelLong = 0;
    hardCrashPending = true;
    hardCrashEndAt = now / 1000 + 0.85;
    endReason = 'Ağır kaza — oturum bitti';
    hud.info(
      npcHard && npcHit.relativeSpeedKmh <= 30
        ? 'Sürekli itme — ağır kaza'
        : 'Ağır kaza — oturum bitti'
    );
    hud.setCalibSaveVisible(false);
  } else if (collisionEdge) {
    metrics.registerCrash({
      hard: false,
      relativeSpeedKmh: hitNpc ? npcHit.relativeSpeedKmh : car.speedKmh(),
    });
    if (hitNpc && car.velocity > 1.5) car.velocity = Math.min(car.velocity * 0.45, 4);
    hud.info('Çarpışma −puan (Safety Floor)');
    hud.setCalibSaveVisible(false);
  }

  const reached = waypoints.update(car.position);
  if (reached) {
    hud.info(`Waypoint ${reached.index + 1} · ${reached.timeSec.toFixed(1)}s`);
    if (waypoints.done()) {
      hud.info('Tüm hedefler tamamlandı — rapor için Oturumu Bitir');
    }
  }

  const sessionSec = now / 1000 - sessionStart;

  telemetry.update(dt, () => ({
    t: sessionSec,
    speed: car.velocity,
    speedKmh: car.speedKmh(),
    accel: car.accelLong,
    yawRate: car.yawRate,
    steer: inp.steer,
    throttle: Math.max(0, inp.throttle),
    brake: inp.brake,
    lateralOffset: road.lateralOffset,
    headingError: road.headingError,
    offroad: road.offroad,
    wrongway: road.wrongway,
    collision: road.collision || hitBuilding || hitNpc,
    mirror: inp.mirror,
    reversing: car.velocity < -0.3,
  }));

  const last = telemetry.samples[telemetry.samples.length - 1];
  if (last) {
    const alerts = metrics.tick(last, dt, inp.anyKey, input.idleSeconds(now));
    hud.pushAlerts(alerts);
  }

  // Auto-build baseline only in kalibrasyon (no profile / not evaluation inject)
  if (metrics.getSessionMode() === 'kalibrasyon') {
    metrics.updateBaselineFromSamples(telemetry.samples, sessionSec);
  }
  if (metrics.baseline.ready && !baselineAnnounced) {
    baselineAnnounced = true;
    lastBaselineSnapshot = metrics.getBaselineSnapshot();
    hud.baselineReady();
    if (metrics.isCleanEnoughForCalibration()) {
      hud.setCalibSaveVisible(true);
    }
  }
  // Hide calib save if session becomes dirty
  if (!metrics.isCleanEnoughForCalibration()) {
    hud.setCalibSaveVisible(false);
  }

  crashFx.update(dt);
  camCtrl.apply(car, dt);

  hud.setSpeed(car.speedKmh());
  hud.setTargetDistance(waypoints.distanceToCurrent(car.position));
  hud.setWaypoint(waypoints.progressLabel());
  hud.setTime(sessionSec);
  hud.setStrip(metrics.liveStrip(telemetry.samples, sessionSec));
  hud.setWrongWay(road.wrongway);
  minimap.update(car.position.x, car.position.z, car.yaw, waypoints, road.wrongway);

  renderer.render(scene, camera);
  mirrors.setActive(inp.mirror);
  mirrors.render(car);
}

let lastReset = 0;
requestAnimationFrame(frame);
