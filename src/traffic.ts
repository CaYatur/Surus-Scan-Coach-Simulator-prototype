import * as THREE from 'three';
import {
  MAIN_ROAD_LENGTH,
  RIGHT_LANE_X,
} from './world';

const LEFT_LANE_X = 2.2;
const Z_MIN = -10;
const Z_MAX = MAIN_ROAD_LENGTH - 30;
/** Footprint half-extents (match mesh ~1.9×3.8) — side scrapes count. */
const CAR_HALF_W = 0.95;
const CAR_HALF_L = 1.95;
/** Ground Y for NPC groups — wheel bottoms ≈ 0 with local wheel centers at ~0.32. */
const NPC_GROUND_Y = 0;
const LOOK_AHEAD_NEAR = 12;
const LOOK_AHEAD_FAR = 18;
const HEAD_ON_BRAKE_DIST = 28;

const BODY_COLORS = [
  0x3b7dd8, 0xd94c4c, 0x2f9e6b, 0xe8a838, 0x6b5b95, 0x4a5568, 0xc45c26, 0x1a9aa0,
];

type NpcCar = {
  mesh: THREE.Group;
  x: number;
  z: number;
  yaw: number;
  speed: number; // m/s current
  cruiseSpeed: number; // m/s desired
  lane: 'right' | 'left';
  seed: number;
};

export type PlayerCollisionResult = {
  hit: boolean;
  hardCrash: boolean;
  relativeSpeedKmh: number;
  /** Soft hit that should still penalize score. */
  softHit: boolean;
};

/**
 * Corridor traffic: right lane (+Z at RIGHT_LANE_X=-2.2), left lane (−Z at +2.2).
 * NPCs yield to the player; never shove the player along the road.
 */
export class Traffic {
  readonly group = new THREE.Group();
  private npcs: NpcCar[] = [];
  private nextRespawnTimer = 0;
  private idCounter = 0;
  /** Until this time (perf sec), overlaps do not score as collisions. */
  private collisionGraceUntil = 0;
  /** Continuous push-into-NPC time (sec); sustained shove → hard crash. */
  private pushAccumSec = 0;

  constructor(scene: THREE.Scene, avoidX = RIGHT_LANE_X, avoidZ = 10) {
    scene.add(this.group);
    this.resetFleet(avoidX, avoidZ);
  }

  /** Clear + respawn away from the player; short collision grace. */
  resetFleet(avoidX = RIGHT_LANE_X, avoidZ = 10) {
    for (const n of this.npcs) {
      this.group.remove(n.mesh);
      disposeMesh(n.mesh);
    }
    this.npcs = [];
    this.idCounter = 0;
    const n = 4 + Math.floor(Math.random() * 7); // 4–10
    this.spawnFleet(n, avoidX, avoidZ);
    this.nextRespawnTimer = 8 + Math.random() * 12;
    this.collisionGraceUntil = performance.now() / 1000 + 2.2;
    this.pushAccumSec = 0;
  }

  private spawnFleet(n: number, avoidX: number, avoidZ: number) {
    const rightZs: number[] = [];
    const leftZs: number[] = [];
    const clear = 24; // meters — no spawn on top / immediately behind player

    for (let i = 0; i < n; i++) {
      const lane: 'right' | 'left' = Math.random() < 0.5 ? 'right' : 'left';
      const slots = lane === 'right' ? rightZs : leftZs;
      let z = this.pickSpawnZ(lane, avoidZ, clear, slots);
      slots.push(z);
      this.addNpc(lane, z, this.idCounter++);
    }
    // Safety: shove any residual near-player NPCs forward
    this.pushClearOf(avoidX, avoidZ, clear);
  }

  private pickSpawnZ(
    lane: 'right' | 'left',
    avoidZ: number,
    clear: number,
    slots: number[]
  ): number {
    for (let tries = 0; tries < 24; tries++) {
      let z: number;
      if (lane === 'right') {
        // Same lane as player: only AHEAD (never spawn in the rear bumper)
        const lo = Math.min(Z_MAX - 8, avoidZ + clear);
        const hi = Z_MAX - 4;
        if (hi <= lo) z = Z_MAX - 10;
        else z = lo + Math.random() * (hi - lo);
      } else {
        // Oncoming: well ahead or well behind in Z, not overlapping
        if (Math.random() < 0.55) {
          z = Math.min(Z_MAX - 4, avoidZ + clear + Math.random() * 80);
        } else {
          z = Math.max(Z_MIN + 4, avoidZ - clear - Math.random() * 60);
        }
      }
      if (slots.some((sz) => Math.abs(sz - z) < 10 + Math.random() * 5)) continue;
      if (Math.abs(z - avoidZ) < clear) continue;
      return z;
    }
    return lane === 'right'
      ? Math.min(Z_MAX - 10, avoidZ + clear + 20)
      : Math.min(Z_MAX - 10, avoidZ + clear + 40);
  }

  private pushClearOf(avoidX: number, avoidZ: number, clear: number) {
    for (const n of this.npcs) {
      const dx = n.x - avoidX;
      const dz = n.z - avoidZ;
      if (Math.hypot(dx, dz) >= clear) continue;
      if (n.lane === 'right') {
        n.z = avoidZ + clear + 8 + Math.random() * 20;
      } else {
        n.z = avoidZ + clear + 15 + Math.random() * 25;
      }
      n.mesh.position.set(n.x, NPC_GROUND_Y, n.z);
    }
  }

  private addNpc(lane: 'right' | 'left', z: number, seed: number) {
    const x = lane === 'right' ? RIGHT_LANE_X : LEFT_LANE_X;
    const yaw = lane === 'right' ? 0 : Math.PI;
    const cruiseSpeed = 7 + Math.random() * 9; // ~7–16 m/s
    const color = BODY_COLORS[seed % BODY_COLORS.length];
    const mesh = buildNpcMesh(color);
    mesh.position.set(x, NPC_GROUND_Y, z);
    mesh.rotation.y = yaw;
    this.group.add(mesh);
    this.npcs.push({
      mesh,
      x,
      z,
      yaw,
      speed: cruiseSpeed * (0.85 + Math.random() * 0.2),
      cruiseSpeed,
      lane,
      seed,
    });
  }

  /**
   * Advance NPCs with reactive braking vs player / other NPCs.
   * playerVel is signed m/s along player forward; playerYaw in radians.
   */
  update(
    dt: number,
    playerPos?: THREE.Vector3,
    playerVel = 0,
    playerYaw = 0
  ) {
    const px = playerPos?.x ?? 0;
    const pz = playerPos?.z ?? 0;
    const pFx = Math.sin(playerYaw);
    const pFz = Math.cos(playerYaw);

    for (const n of this.npcs) {
      const fz = Math.cos(n.yaw); // +1 right lane, −1 left
      const lookNear = LOOK_AHEAD_NEAR + Math.random() * 2;
      const lookFar = LOOK_AHEAD_FAR + Math.random() * 2;

      let targetSpeed = n.cruiseSpeed;

      // --- Same-lane NPC ahead ---
      for (const other of this.npcs) {
        if (other === n || other.lane !== n.lane) continue;
        const ahead = (other.z - n.z) * fz;
        if (ahead > 0.5 && ahead < lookFar) {
          const gap = ahead;
          if (gap < lookNear) {
            // Match or stop behind slower vehicle
            const desired = Math.min(other.speed * 0.95, (gap - 4) * 1.2);
            targetSpeed = Math.min(targetSpeed, Math.max(0, desired));
          } else {
            targetSpeed = Math.min(targetSpeed, other.speed + (gap - lookNear) * 0.15);
          }
        }
      }

      // --- Player as obstacle ---
      if (playerPos) {
        const sameLane =
          (n.lane === 'right' && px < -0.4) || (n.lane === 'left' && px > 0.4);
        const lateralOk = Math.abs(px - n.x) < 3.2;

        if (sameLane || lateralOk) {
          const ahead = (pz - n.z) * fz;
          // Player ahead in our travel direction
          if (ahead > 0.8 && ahead < lookFar + 4) {
            // Player component of velocity along our travel axis
            const playerAlongNpc = playerVel * (pFx * 0 + pFz * fz); // ≈ playerVel * fz*pFz
            const closing = n.speed - Math.max(0, playerAlongNpc);
            if (ahead < lookNear || closing > 2) {
              const desired = Math.min(
                Math.max(0, playerAlongNpc * 0.7),
                Math.max(0, (ahead - 5) * 1.4)
              );
              targetSpeed = Math.min(targetSpeed, desired);
            }
          }
          // Player immediately behind / overlapping — yield hard (don't push)
          if (ahead > -4 && ahead < 2.5 && Math.abs(px - n.x) < 2.8) {
            targetSpeed = Math.min(targetSpeed, 0.5);
          }
        }

        // Oncoming left lane: head-on with player traveling +Z on right / or vice versa
        if (n.lane === 'left') {
          const closingZ = n.z - pz; // positive if NPC (going −Z) is still "ahead" toward player
          // NPC goes −Z, player typically +Z: they close when NPC.z > player.z
          const approach = n.speed + Math.max(0, playerVel * pFz);
          if (closingZ > 0 && closingZ < HEAD_ON_BRAKE_DIST && Math.abs(px - n.x) < 5) {
            if (closingZ < 16 || approach > 12) {
              const factor = THREE.MathUtils.clamp(closingZ / HEAD_ON_BRAKE_DIST, 0, 1);
              targetSpeed = Math.min(targetSpeed, n.cruiseSpeed * factor * 0.55);
            }
          }
        } else {
          // Right-lane NPC vs player going wrong-way (−Z) or overlapping approach
          const closingZ = pz - n.z;
          const approach = n.speed + Math.max(0, -playerVel * pFz);
          if (
            playerVel * pFz < -2 &&
            closingZ > 0 &&
            closingZ < HEAD_ON_BRAKE_DIST &&
            Math.abs(px - n.x) < 5
          ) {
            if (closingZ < 16 || approach > 12) {
              const factor = THREE.MathUtils.clamp(closingZ / HEAD_ON_BRAKE_DIST, 0, 1);
              targetSpeed = Math.min(targetSpeed, n.cruiseSpeed * factor * 0.55);
            }
          }
        }
      }

      // Smooth accel / brake toward target
      const accel = targetSpeed < n.speed ? 18 : 6;
      if (n.speed > targetSpeed) {
        n.speed = Math.max(targetSpeed, n.speed - accel * dt);
      } else {
        n.speed = Math.min(targetSpeed, n.speed + accel * dt);
      }

      n.z += fz * n.speed * dt;
      n.x = n.lane === 'right' ? RIGHT_LANE_X : LEFT_LANE_X;

      if (n.lane === 'right') {
        if (n.z > Z_MAX) n.z = Z_MIN + (n.z - Z_MAX);
      } else {
        if (n.z < Z_MIN) n.z = Z_MAX - (Z_MIN - n.z);
      }

      n.mesh.position.set(n.x, NPC_GROUND_Y, n.z);
      n.mesh.rotation.y = n.yaw;
    }

    this.separateSameLaneSoft();
    this.maybeRespawnFar(dt, playerPos);
  }

  /** Soft gap maintain — brake-style, no teleport shove. */
  private separateSameLaneSoft() {
    const minGap = 7.0;
    for (let i = 0; i < this.npcs.length; i++) {
      for (let j = i + 1; j < this.npcs.length; j++) {
        const a = this.npcs[i];
        const b = this.npcs[j];
        if (a.lane !== b.lane) continue;
        const fz = Math.cos(a.yaw);
        const dz = a.z - b.z;
        if (Math.abs(dz) >= minGap) continue;
        // Slow the rear vehicle; nudge positions slightly along travel
        const aAhead = dz * fz > 0;
        const rear = aAhead ? b : a;
        const front = aAhead ? a : b;
        rear.speed = Math.min(rear.speed, front.speed * 0.85, 2);
        const push = (minGap - Math.abs(dz)) * 0.25;
        if (dz >= 0) {
          a.z += push * 0.5;
          b.z -= push * 0.5;
        } else {
          a.z -= push * 0.5;
          b.z += push * 0.5;
        }
        a.mesh.position.z = a.z;
        b.mesh.position.z = b.z;
      }
    }
  }

  /**
   * Occasional despawn/respawn far from player so density feels random.
   */
  private maybeRespawnFar(dt: number, playerPos?: THREE.Vector3) {
    this.nextRespawnTimer -= dt;
    if (this.nextRespawnTimer > 0) return;
    this.nextRespawnTimer = 6 + Math.random() * 14;

    const pz = playerPos?.z ?? 40;
    const roll = Math.random();

    if (roll < 0.4 && this.npcs.length > 4) {
      // Despawn one far from player
      let best = -1;
      let bestDist = 0;
      for (let i = 0; i < this.npcs.length; i++) {
        const d = Math.abs(this.npcs[i].z - pz);
        if (d > bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best >= 0 && bestDist > 35) {
        const n = this.npcs[best];
        this.group.remove(n.mesh);
        disposeMesh(n.mesh);
        this.npcs.splice(best, 1);
      }
    } else if (roll > 0.55 && this.npcs.length < 10) {
      // Spawn far from player — right lane only ahead (no rear ambush)
      const lane: 'right' | 'left' = Math.random() < 0.5 ? 'right' : 'left';
      let z: number;
      if (lane === 'right') {
        z = Math.min(Z_MAX - 5, pz + 35 + Math.random() * 55);
      } else {
        z =
          Math.random() < 0.5
            ? Math.max(Z_MIN + 5, pz - 40 - Math.random() * 50)
            : Math.min(Z_MAX - 5, pz + 40 + Math.random() * 30);
      }
      if (Math.abs(z - pz) < 28) return;
      if (this.npcs.some((n) => n.lane === lane && Math.abs(n.z - z) < 10)) return;
      this.addNpc(lane, z, this.idCounter++);
    }
  }

  /**
   * Resolve overlap: NPC yields (moves back along travel), tiny lateral nudge on player.
   * Cap push per frame. Prefer not shoving player along Z with NPC velocity.
   */
  resolvePlayerCollision(
    pos: THREE.Vector3,
    playerSpeedMs = 0,
    playerYaw = 0,
    dt = 1 / 60
  ): PlayerCollisionResult {
    const empty: PlayerCollisionResult = {
      hit: false,
      hardCrash: false,
      relativeSpeedKmh: 0,
      softHit: false,
    };
    const now = performance.now() / 1000;
    if (now < this.collisionGraceUntil) {
      // Quietly separate without scoring (spawn safety)
      this.nudgeOverlapsQuiet(pos, playerYaw);
      return empty;
    }
    let hit = false;
    let maxImpactKmh = 0;
    let maxSideImpactKmh = 0;
    let maxFrontImpactKmh = 0;
    const pFx = Math.sin(playerYaw);
    const pFz = Math.cos(playerYaw);
    const MAX_PLAYER_PUSH = 0.14;

    for (const n of this.npcs) {
      const mtv = obbMtv(
        pos.x,
        pos.z,
        playerYaw,
        CAR_HALF_W,
        CAR_HALF_L,
        n.x,
        n.z,
        n.yaw,
        CAR_HALF_W,
        CAR_HALF_L
      );
      if (!mtv) continue;
      hit = true;

      const overlap = mtv.depth;
      const nFx = Math.sin(n.yaw);
      const nFz = Math.cos(n.yaw);
      const playerVelX = pFx * playerSpeedMs;
      const playerVelZ = pFz * playerSpeedMs;
      const npcVelX = nFx * n.speed;
      const npcVelZ = nFz * n.speed;
      // Speed into the contact normal (MTV pushes player out → impact is opposite)
      const relVx = playerVelX - npcVelX;
      const relVz = playerVelZ - npcVelZ;
      const closingInto = Math.max(0, -(relVx * mtv.nx + relVz * mtv.nz));
      const impactKmh = closingInto * 3.6;
      // Rear-end: NPC ahead of player — MTV along contact often under-reads; use closing along player forward
      const ahead = (n.x - pos.x) * pFx + (n.z - pos.z) * pFz;
      const closingAlongFwd = Math.max(0, relVx * pFx + relVz * pFz);
      const rearEndKmh =
        ahead > 0.4 && ahead < 7 && closingAlongFwd > 14 ? closingAlongFwd * 3.6 : 0;
      maxImpactKmh = Math.max(maxImpactKmh, impactKmh, rearEndKmh);
      const alongFwd = Math.abs(mtv.nx * pFx + mtv.nz * pFz);
      if (alongFwd < 0.55) {
        maxSideImpactKmh = Math.max(maxSideImpactKmh, impactKmh);
      } else {
        maxFrontImpactKmh = Math.max(maxFrontImpactKmh, impactKmh);
      }
      if (rearEndKmh >= 55) {
        maxFrontImpactKmh = Math.max(maxFrontImpactKmh, rearEndKmh);
      }

      // Separate: never shove the player through / past the NPC nose.
      n.speed = Math.min(n.speed, 0.35);
      const yieldPush = Math.min(overlap * 0.6, 0.35);
      const back = Math.min(Math.max(overlap * 0.55, 0.04), MAX_PLAYER_PUSH);
      const facingDot = pFx * nFx + pFz * nFz;
      const headOn = facingDot < -0.25;

      if (headOn) {
        // Head-on: both bounce AWAY (player reverse, NPC reverse along their forward)
        pos.x -= pFx * back;
        pos.z -= pFz * back;
        n.x -= nFx * yieldPush;
        n.z -= nFz * yieldPush;
      } else if (ahead > 0.15) {
        // Same-direction rear-end: player stays behind, NPC eases forward
        n.x += nFx * yieldPush;
        n.z += nFz * yieldPush;
        pos.x -= pFx * back;
        pos.z -= pFz * back;
      } else {
        // Side / ambiguous: separate along center line (away from each other)
        let dx = pos.x - n.x;
        let dz = pos.z - n.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        pos.x += dx * back;
        pos.z += dz * back;
        n.x -= dx * yieldPush;
        n.z -= dz * yieldPush;
        // Reject if this still flips us past the NPC along our forward
        const aheadAfter = (n.x - pos.x) * pFx + (n.z - pos.z) * pFz;
        if (ahead >= -0.5 && aheadAfter < -1.0) {
          pos.x -= pFx * back;
          pos.z -= pFz * back;
        }
      }
      n.mesh.position.set(n.x, NPC_GROUND_Y, n.z);
    }

    if (!hit) {
      this.pushAccumSec = 0;
      return empty;
    }

    // Sustained shove (even slow): keep pressing into a car → explode
    const pushing =
      Math.abs(playerSpeedMs) > 0.35 ||
      maxImpactKmh > 3 ||
      maxFrontImpactKmh > 3 ||
      maxSideImpactKmh > 3;
    if (pushing) this.pushAccumSec += Math.max(0, Math.min(dt, 0.05));
    else this.pushAccumSec = Math.max(0, this.pushAccumSec - dt * 2.5);

    const sustainedPush = this.pushAccumSec >= 1.15;

    // Light taps stay soft. Instant hard: strong closing. Sustained push: always hard.
    const playerKmh = Math.abs(playerSpeedMs) * 3.6;
    const hardCrash =
      sustainedPush ||
      maxFrontImpactKmh > 58 ||
      maxSideImpactKmh > 78 ||
      (maxSideImpactKmh > 48 && playerKmh > 95);
    return {
      hit: true,
      hardCrash,
      relativeSpeedKmh: sustainedPush
        ? Math.max(maxImpactKmh, 25)
        : maxImpactKmh,
      softHit: !hardCrash,
    };
  }

  /** Building smash: need high speed into the wall, not a light brush. */
  static isHardCrashFromSpeed(playerSpeedKmh: number, relativeSpeedKmh = 0): boolean {
    return relativeSpeedKmh > 55 || playerSpeedKmh > 85;
  }

  positions(): { x: number; z: number }[] {
    return this.npcs.map((n) => ({ x: n.x, z: n.z }));
  }

  get count(): number {
    return this.npcs.length;
  }

  /** During grace: move NPC clear, do not report hit. */
  private nudgeOverlapsQuiet(pos: THREE.Vector3, playerYaw: number) {
    for (const n of this.npcs) {
      const mtv = obbMtv(
        pos.x,
        pos.z,
        playerYaw,
        CAR_HALF_W,
        CAR_HALF_L,
        n.x,
        n.z,
        n.yaw,
        CAR_HALF_W,
        CAR_HALF_L
      );
      if (!mtv) continue;
      if (n.lane === 'right') n.z = Math.max(n.z, pos.z + 22);
      else n.z = pos.z + 28 + Math.random() * 10;
      n.speed = Math.min(n.speed, 1);
      n.mesh.position.set(n.x, NPC_GROUND_Y, n.z);
    }
  }
}

function disposeMesh(root: THREE.Object3D) {
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  });
}

/**
 * NPC mesh with wheels on ground when group.y = 0.
 * Wheel radius 0.32, center at y=0.32 → bottom ≈ 0.
 * Proportions roughly match player exterior.
 */

/** 2D OBB vs OBB: returns minimum translation vector or null if separated. */
function obbMtv(
  ax: number,
  az: number,
  aYaw: number,
  aHw: number,
  aHl: number,
  bx: number,
  bz: number,
  bYaw: number,
  bHw: number,
  bHl: number
): { nx: number; nz: number; depth: number } | null {
  // Three.js Y-rot: local +Z → (sin y, cos y), local +X → (cos y, -sin y)
  const aFwd: [number, number] = [Math.sin(aYaw), Math.cos(aYaw)];
  const aRight: [number, number] = [Math.cos(aYaw), -Math.sin(aYaw)];
  const bFwd: [number, number] = [Math.sin(bYaw), Math.cos(bYaw)];
  const bRight: [number, number] = [Math.cos(bYaw), -Math.sin(bYaw)];
  const satAxes: [number, number][] = [aRight, aFwd, bRight, bFwd];

  let minDepth = Infinity;
  let bestNx = 0;
  let bestNz = 0;

  const project = (
    cx: number,
    cz: number,
    right: [number, number],
    fwd: [number, number],
    hw: number,
    hl: number,
    axis: [number, number]
  ) => {
    const c = cx * axis[0] + cz * axis[1];
    const r =
      hw * Math.abs(right[0] * axis[0] + right[1] * axis[1]) +
      hl * Math.abs(fwd[0] * axis[0] + fwd[1] * axis[1]);
    return { min: c - r, max: c + r };
  };

  for (const axis of satAxes) {
    const len = Math.hypot(axis[0], axis[1]) || 1;
    const axn: [number, number] = [axis[0] / len, axis[1] / len];
    const A = project(ax, az, aRight, aFwd, aHw, aHl, axn);
    const B = project(bx, bz, bRight, bFwd, bHw, bHl, axn);
    const dist = Math.min(A.max - B.min, B.max - A.min);
    if (A.max < B.min || B.max < A.min) return null;
    if (dist < minDepth) {
      minDepth = dist;
      // Push A out of B: from B center toward A along axis
      const ac = ax * axn[0] + az * axn[1];
      const bc = bx * axn[0] + bz * axn[1];
      const sign = ac >= bc ? 1 : -1;
      bestNx = axn[0] * sign;
      bestNz = axn[1] * sign;
    }
  }
  if (!Number.isFinite(minDepth) || minDepth <= 0) return null;
  return { nx: bestNx, nz: bestNz, depth: minDepth };
}

function buildNpcMesh(color: number): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.72, 0.46, 3.5),
    new THREE.MeshStandardMaterial({ color, metalness: 0.48, roughness: 0.38 })
  );
  body.position.y = 0.55;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Short hood hint
  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.12, 0.9),
    new THREE.MeshStandardMaterial({ color, metalness: 0.52, roughness: 0.34 })
  );
  hood.position.set(0, 0.78, 0.9);
  hood.rotation.x = -0.1;
  g.add(hood);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.4, 1.35),
    new THREE.MeshStandardMaterial({
      color: 0x0c141c,
      metalness: 0.28,
      roughness: 0.22,
      transparent: true,
      opacity: 0.8,
    })
  );
  cabin.position.set(0, 0.96, -0.12);
  cabin.castShadow = true;
  g.add(cabin);

  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const bf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.18), bumperMat);
  bf.position.set(0, 0.36, 1.78);
  g.add(bf);
  const br = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.16), bumperMat);
  br.position.set(0, 0.36, -1.78);
  g.add(br);

  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c8,
    emissive: 0xffdd77,
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xb02222,
    emissive: 0x771010,
    emissiveIntensity: 0.55,
  });
  for (const sx of [-0.5, 0.5]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.06), lightMat);
    hl.position.set(sx, 0.52, 1.8);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.06), tailMat);
    tl.position.set(sx, 0.52, -1.8);
    g.add(tl);
  }

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.65, roughness: 0.35 });
  const wheelR = 0.32;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 12);
  const rimGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.28, 8);
  for (const [wx, wz] of [
    [-0.85, 1.1],
    [0.85, 1.1],
    [-0.85, -1.1],
    [0.85, -1.1],
  ] as [number, number][]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, wheelR, wz);
    g.add(w);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, wheelR, wz);
    g.add(rim);
  }

  return g;
}
