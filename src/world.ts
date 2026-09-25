import * as THREE from 'three';

/** Dual-lane half-width from centerline to curb. */
export const ROAD_HALF_WIDTH = 5.5;
export const MAIN_ROAD_LENGTH = 360;
export const CROSS_HALF_LENGTH = 70;
export const SPEED_LIMIT_KMH = 50;
/** Visual right lane when facing +Z (FP screen-right = world -X). */
export const RIGHT_LANE_X = -2.2;
export const WORLD_SOFT = 95;

/** Cross-street centers along main Z corridor (sokak araları / intersections). */
export const CROSS_ZS = [50, 110, 170, 230, 290];

export type RoadQuery = {
  lateralOffset: number;
  headingError: number;
  offroad: boolean;
  wrongway: boolean;
  collision: boolean;
  /** Nearest segment axis for HUD / debug */
  axis: 'z' | 'x';
};

export type RoadSegment = {
  axis: 'z' | 'x';
  cx: number;
  cz: number;
  halfLen: number;
  halfW: number;
};

/** Export road network helpers for waypoints / other modules. */
export function buildRoadSegments(): RoadSegment[] {
  const segs: RoadSegment[] = [];
  // Main corridor along +Z, centered at x=0
  const mainCz = MAIN_ROAD_LENGTH / 2 - 20;
  segs.push({
    axis: 'z',
    cx: 0,
    cz: mainCz,
    halfLen: MAIN_ROAD_LENGTH / 2,
    halfW: ROAD_HALF_WIDTH,
  });
  for (const z of CROSS_ZS) {
    segs.push({
      axis: 'x',
      cx: 0,
      cz: z,
      halfLen: CROSS_HALF_LENGTH,
      halfW: ROAD_HALF_WIDTH,
    });
  }
  return segs;
}

export function isOnRoadNetwork(x: number, z: number, margin = 0): boolean {
  const hw = ROAD_HALF_WIDTH + margin;
  // Main Z corridor
  if (Math.abs(x) <= hw && z >= -20 && z <= MAIN_ROAD_LENGTH - 20) return true;
  // Cross streets
  for (const cz of CROSS_ZS) {
    if (Math.abs(z - cz) <= hw && Math.abs(x) <= CROSS_HALF_LENGTH) return true;
  }
  return false;
}

/** Sample a random on-road point (for waypoints). Prefer intersections + midblocks. */
export function randomRoadPoint(rng = Math.random): THREE.Vector3 {
  const pick = rng();
  if (pick < 0.45) {
    // Main corridor lane
    const z = -5 + rng() * (MAIN_ROAD_LENGTH - 30);
    const lane = rng() < 0.5 ? -2.2 : 2.2;
    const x = lane + (rng() - 0.5) * 1.2;
    return new THREE.Vector3(x, 0, z);
  }
  if (pick < 0.8) {
    // Cross street
    const cz = CROSS_ZS[Math.floor(rng() * CROSS_ZS.length)];
    const x = (rng() - 0.5) * CROSS_HALF_LENGTH * 1.6;
    const lane = rng() < 0.5 ? -2.2 : 2.2;
    return new THREE.Vector3(
      THREE.MathUtils.clamp(x, -CROSS_HALF_LENGTH + 4, CROSS_HALF_LENGTH - 4),
      0,
      cz + lane * 0.15 + (rng() - 0.5)
    );
  }
  // Near an intersection
  const cz = CROSS_ZS[Math.floor(rng() * CROSS_ZS.length)];
  const side = rng() < 0.5 ? -1 : 1;
  return new THREE.Vector3(side * (8 + rng() * 20), 0, cz + (rng() - 0.5) * 4);
}

const BUILDING_COLORS = [
  0x3a4558, 0x4a5568, 0x2e3848, 0x5a4a3a, 0x3a4a5a, 0x4a3a4a, 0x2a3a3a, 0x505868,
  0x6a5a48, 0x3d4f5c, 0x554858, 0x2c3e36, 0x485568,
];

/** Axis-aligned building footprint on XZ (with pad). */
export type SolidAABB = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Player / NPC approximate half-extents on XZ (circle radius uses max of these). */
export const CAR_HALF_X = 0.55;
export const CAR_HALF_Z = 1.1;
export const CAR_RADIUS = 0.65;
const BUILDING_PAD = -0.45; // inset: collide at mesh surface, not outside

export class World {
  group = new THREE.Group();
  readonly segments: RoadSegment[];
  private solidBoxes: SolidAABB[] = [];

  constructor(scene: THREE.Scene) {
    this.segments = buildRoadSegments();
    this.buildGround();
    this.buildRoads();
    this.buildSidewalks();
    this.buildBuildings();
    this.buildStreetLamps();
    this.buildTrees();
    this.buildSigns();
    this.buildLights(scene);
    scene.add(this.group);
  }

  private buildLights(scene: THREE.Scene) {
    // Soft daylight: cool hemisphere sky, warm sun, gentle fill
    const hemi = new THREE.HemisphereLight(0xc5ddff, 0x7a8f5c, 0.72);
    scene.add(hemi);
    const amb = new THREE.AmbientLight(0xfff4e6, 0.42);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffe8c8, 1.55);
    dir.position.set(55, 110, 35);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 8;
    dir.shadow.camera.far = 300;
    dir.shadow.camera.left = -100;
    dir.shadow.camera.right = 100;
    dir.shadow.camera.top = 100;
    dir.shadow.camera.bottom = -100;
    dir.shadow.bias = -0.00025;
    dir.shadow.normalBias = 0.02;
    scene.add(dir);
    // Soft fill from opposite side (no shadow)
    const fill = new THREE.DirectionalLight(0xb0c8e8, 0.28);
    fill.position.set(-40, 40, -30);
    scene.add(fill);
    scene.background = new THREE.Color(0x92bce6);
    scene.fog = new THREE.Fog(0xa6c6e2, 110, 320);
  }

  private buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, MAIN_ROAD_LENGTH + 80),
      new THREE.MeshStandardMaterial({ color: 0x356336, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = MAIN_ROAD_LENGTH / 2 - 20;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private addAsphalt(w: number, l: number, x: number, z: number, rotY = 0) {
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.92, metalness: 0.04 })
    );
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = rotY;
    road.position.set(x, 0.02, z);
    road.receiveShadow = true;
    this.group.add(road);
  }

  private addDashesAlongZ(z0: number, z1: number, x = 0) {
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xffef7a, emissive: 0x554400, emissiveIntensity: 0.35, roughness: 0.5 });
    for (let z = z0; z < z1; z += 8) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 4.2), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.04, z);
      this.group.add(dash);
    }
  }

  private addDashesAlongX(x0: number, x1: number, z: number) {
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xffef7a, emissive: 0x554400, emissiveIntensity: 0.35, roughness: 0.5 });
    for (let x = x0; x < x1; x += 8) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.22), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.045, z);
      this.group.add(dash);
    }
  }

  private addEdgeAlongZ(x: number, z0: number, z1: number) {
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.6, emissive: 0x111114, emissiveIntensity: 0.05 });
    const len = z1 - z0;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.25, len), edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(x, 0.035, (z0 + z1) / 2);
    this.group.add(edge);
  }

  private addEdgeAlongX(z: number, x0: number, x1: number) {
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.6, emissive: 0x111114, emissiveIntensity: 0.05 });
    const len = x1 - x0;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.25), edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set((x0 + x1) / 2, 0.036, z);
    this.group.add(edge);
  }

  private buildRoads() {
    const z0 = -20;
    const z1 = MAIN_ROAD_LENGTH - 20;
    const mainCz = (z0 + z1) / 2;
    const mainLen = z1 - z0;

    // Main asphalt
    this.addAsphalt(ROAD_HALF_WIDTH * 2, mainLen, 0, mainCz);
    this.addDashesAlongZ(z0 + 2, z1 - 2, 0);
    this.addEdgeAlongZ(-ROAD_HALF_WIDTH + 0.15, z0, z1);
    this.addEdgeAlongZ(ROAD_HALF_WIDTH - 0.15, z0, z1);

    // Cross streets (sokak araları)
    for (const cz of CROSS_ZS) {
      this.addAsphalt(CROSS_HALF_LENGTH * 2, ROAD_HALF_WIDTH * 2, 0, cz);
      // Skip dashes through intersection center
      this.addDashesAlongX(-CROSS_HALF_LENGTH + 2, -ROAD_HALF_WIDTH - 1, cz);
      this.addDashesAlongX(ROAD_HALF_WIDTH + 1, CROSS_HALF_LENGTH - 2, cz);
      this.addEdgeAlongX(cz - ROAD_HALF_WIDTH + 0.15, -CROSS_HALF_LENGTH, -ROAD_HALF_WIDTH);
      this.addEdgeAlongX(cz - ROAD_HALF_WIDTH + 0.15, ROAD_HALF_WIDTH, CROSS_HALF_LENGTH);
      this.addEdgeAlongX(cz + ROAD_HALF_WIDTH - 0.15, -CROSS_HALF_LENGTH, -ROAD_HALF_WIDTH);
      this.addEdgeAlongX(cz + ROAD_HALF_WIDTH - 0.15, ROAD_HALF_WIDTH, CROSS_HALF_LENGTH);
    }
  }

  private buildSidewalks() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x555c6c, roughness: 0.88, metalness: 0.04 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x9aa0ac, roughness: 0.72, metalness: 0.05 });
    const sw = 2.2;
    const z0 = -20;
    const z1 = MAIN_ROAD_LENGTH - 20;

    const addWalk = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, l), mat);
      m.position.set(x, 0.06, z);
      m.receiveShadow = true;
      this.group.add(m);
    };

    // Along main road — split around cross streets
    const xs = [-ROAD_HALF_WIDTH - sw / 2, ROAD_HALF_WIDTH + sw / 2];
    for (const x of xs) {
      let cursor = z0;
      const gaps = CROSS_ZS.map((cz) => ({
        a: cz - ROAD_HALF_WIDTH - 0.5,
        b: cz + ROAD_HALF_WIDTH + 0.5,
      }));
      gaps.sort((a, b) => a.a - b.a);
      for (const g of gaps) {
        if (g.a > cursor) {
          const mid = (cursor + g.a) / 2;
          addWalk(sw, g.a - cursor, x, mid);
        }
        cursor = g.b;
      }
      if (cursor < z1) {
        addWalk(sw, z1 - cursor, x, (cursor + z1) / 2);
      }
    }

    // Along cross streets (beyond main corridor)
    for (const cz of CROSS_ZS) {
      for (const side of [-1, 1] as const) {
        const xMid = side * ((ROAD_HALF_WIDTH + CROSS_HALF_LENGTH) / 2);
        const len = CROSS_HALF_LENGTH - ROAD_HALF_WIDTH;
        addWalk(len, sw, xMid, cz - ROAD_HALF_WIDTH - sw / 2);
        addWalk(len, sw, xMid, cz + ROAD_HALF_WIDTH + sw / 2);
      }
    }

    // Visual-only curb lip (does NOT block off-road — not in solidBoxes)
    const addCurbZ = (x: number) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, z1 - z0), curbMat);
      curb.position.set(x, 0.09, (z0 + z1) / 2);
      curb.castShadow = true;
      curb.receiveShadow = true;
      this.group.add(curb);
    };
    addCurbZ(-ROAD_HALF_WIDTH - 0.05);
    addCurbZ(ROAD_HALF_WIDTH + 0.05);
  }

  private buildBuildings() {
    const rng = mulberry32(42);
    // Blocks left/right of main corridor between cross streets
    const zEdges = [-20, ...CROSS_ZS, MAIN_ROAD_LENGTH - 20];
    for (let i = 0; i < zEdges.length - 1; i++) {
      const za = zEdges[i] + (i === 0 ? 4 : ROAD_HALF_WIDTH + 3);
      const zb = zEdges[i + 1] - (i === zEdges.length - 2 ? 4 : ROAD_HALF_WIDTH + 3);
      if (zb - za < 8) continue;
      this.placeBuildingRow(-1, za, zb, rng);
      this.placeBuildingRow(1, za, zb, rng);
    }
    // Along cross street ends (side alleys feel)
    for (const cz of CROSS_ZS) {
      for (const side of [-1, 1] as const) {
        this.placeCrossEndBuildings(side, cz, rng);
      }
    }
  }

  private placeBuildingRow(side: number, za: number, zb: number, rng: () => number) {
    let z = za + 2;
    while (z < zb - 4) {
      const depth = 6 + rng() * 8;
      const width = 5 + rng() * 7;
      const height = 4 + rng() * 14;
      const x =
        side * (ROAD_HALF_WIDTH + 3.5 + depth / 2 + rng() * 4);
      // Skip if would sit on a cross-street asphalt
      if (isOnRoadNetwork(x, z + width / 2, 1.5)) {
        z += width + 2;
        continue;
      }
      this.addBuilding(x, z + width / 2, depth, height, width, rng);
      z += width + 1.5 + rng() * 3;
    }
  }

  private placeCrossEndBuildings(side: number, cz: number, rng: () => number) {
    for (let i = 0; i < 4; i++) {
      const x = side * (ROAD_HALF_WIDTH + 14 + i * 12 + rng() * 3);
      if (Math.abs(x) > CROSS_HALF_LENGTH - 6) continue;
      const depth = 5 + rng() * 6;
      const width = 5 + rng() * 5;
      const height = 5 + rng() * 12;
      const zOff = (rng() < 0.5 ? -1 : 1) * (ROAD_HALF_WIDTH + 3.5 + depth / 2);
      this.addBuilding(x, cz + zOff, depth, height, width, rng);
    }
  }

  private addBuilding(
    x: number,
    z: number,
    depth: number,
    height: number,
    width: number,
    rng: () => number
  ) {
    const color = BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(depth, height, width),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 })
    );
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Footprint: BoxGeometry(depth, height, width) → X=depth, Z=width
    const hx = depth / 2 + BUILDING_PAD;
    const hz = width / 2 + BUILDING_PAD;
    this.solidBoxes.push({
      minX: x - hx,
      maxX: x + hx,
      minZ: z - hz,
      maxZ: z + hz,
    });

    // Window strip / facade inset (emissive for night-ish daylight tint)
    if (height > 5 && rng() > 0.22) {
      const tints = [0x2a4058, 0x334866, 0x3a4a3a, 0x4a3a2a, 0x2a3850, 0x403850];
      const tint = tints[Math.floor(rng() * tints.length)];
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(depth * 0.9, height * 0.5, width * 0.9),
        new THREE.MeshStandardMaterial({
          color: 0x151c28,
          emissive: tint,
          emissiveIntensity: 0.22 + rng() * 0.38,
          roughness: 0.42,
          metalness: 0.18,
        })
      );
      win.position.set(x, height * 0.48, z);
      this.group.add(win);
      // Thin horizontal ledge accent
      if (height > 9 && rng() > 0.4) {
        const ledge = new THREE.Mesh(
          new THREE.BoxGeometry(depth * 1.02, 0.12, width * 1.02),
          new THREE.MeshStandardMaterial({ color: 0xc8c4b8, roughness: 0.7 })
        );
        ledge.position.set(x, height * 0.72, z);
        this.group.add(ledge);
      }
    }
  }

  private buildStreetLamps() {
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x5a5e68, metalness: 0.55, roughness: 0.4 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff0c8,
      emissive: 0xffcc66,
      emissiveIntensity: 1.05,
      roughness: 0.35,
    });
    const place = (x: number, z: number) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), lampMat);
      pole.position.set(x, 2.1, z);
      this.group.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), lampMat);
      arm.position.set(x - Math.sign(x || 1) * 0.5, 4.15, z);
      this.group.add(arm);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), bulbMat);
      bulb.position.set(x - Math.sign(x || 1) * 1.0, 4.0, z);
      this.group.add(bulb);
    };

    for (let z = 10; z < MAIN_ROAD_LENGTH - 30; z += 28) {
      // Skip exact intersection centers
      if (CROSS_ZS.some((cz) => Math.abs(cz - z) < ROAD_HALF_WIDTH + 2)) continue;
      place(-(ROAD_HALF_WIDTH + 1.6), z);
      place(ROAD_HALF_WIDTH + 1.6, z + 14);
    }
    for (const cz of CROSS_ZS) {
      place(-(CROSS_HALF_LENGTH - 8), cz - ROAD_HALF_WIDTH - 1.4);
      place(CROSS_HALF_LENGTH - 8, cz + ROAD_HALF_WIDTH + 1.4);
    }
  }

  private buildTrees() {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b38, roughness: 0.85 });
    const place = (x: number, z: number, s: number) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.8 * s, 6), trunkMat);
      trunk.position.set(x, 0.9 * s, z);
      trunk.castShadow = true;
      this.group.add(trunk);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.1 * s, 8, 6), leafMat);
      canopy.position.set(x, 2.2 * s, z);
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      this.group.add(canopy);
    };
    const rng = mulberry32(99);
    for (let z = 5; z < MAIN_ROAD_LENGTH - 25; z += 22) {
      if (CROSS_ZS.some((cz) => Math.abs(cz - z) < ROAD_HALF_WIDTH + 4)) continue;
      const s = 0.85 + rng() * 0.4;
      place(-(ROAD_HALF_WIDTH + 4.2 + rng()), z + rng() * 4, s);
      place(ROAD_HALF_WIDTH + 4.2 + rng(), z + 10 + rng() * 3, s);
    }
  }

  private buildSigns() {
    const offset = ROAD_HALF_WIDTH + 1.3;
    // Main Z road: both left and right sides
    for (const z of [35, 95, 155, 215, 275]) {
      this.addSign(-offset, z, SPEED_LIMIT_KMH, 'faceEast'); // left curb, face road (+X)
      this.addSign(offset, z, SPEED_LIMIT_KMH, 'faceWest'); // right curb, face road (-X)
    }
    // Cross streets: both sides of a couple of corridors
    for (const cz of [110, 230]) {
      this.addSign(18, cz - offset, SPEED_LIMIT_KMH, 'faceNorth');
      this.addSign(18, cz + offset, SPEED_LIMIT_KMH, 'faceSouth');
      this.addSign(-18, cz - offset, SPEED_LIMIT_KMH, 'faceNorth');
      this.addSign(-18, cz + offset, SPEED_LIMIT_KMH, 'faceSouth');
    }
  }

  private addSign(
    x: number,
    z: number,
    limit: number,
    face: 'faceEast' | 'faceWest' | 'faceNorth' | 'faceSouth' = 'faceEast'
  ) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    pole.position.set(x, 1.1, z);
    this.group.add(pole);

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c03030';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(limit), 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const label = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 28),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    label.position.set(x, 2.25, z);
    // CircleGeometry lies in XY facing +Z by default; rotate to face the roadway.
    if (face === 'faceEast') label.rotation.y = -Math.PI / 2;
    else if (face === 'faceWest') label.rotation.y = Math.PI / 2;
    else if (face === 'faceNorth') label.rotation.y = Math.PI;
    else label.rotation.y = 0; // faceSouth (+Z)
    this.group.add(label);
  }

  /** Nearest road segment in local frame. */
  nearestSegment(x: number, z: number): { seg: RoadSegment; lateral: number; along: number; dist: number } {
    let best = {
      seg: this.segments[0],
      lateral: 0,
      along: 0,
      dist: Infinity,
    };
    for (const seg of this.segments) {
      let lateral: number;
      let along: number;
      if (seg.axis === 'z') {
        lateral = x - seg.cx;
        along = z - seg.cz;
      } else {
        lateral = z - seg.cz;
        along = x - seg.cx;
      }
      const clampedAlong = THREE.MathUtils.clamp(along, -seg.halfLen, seg.halfLen);
      const dLat = Math.abs(lateral) - seg.halfW;
      const dAlong = Math.abs(along) - seg.halfLen;
      let dist: number;
      if (dLat <= 0 && dAlong <= 0) dist = 0;
      else if (dLat <= 0) dist = dAlong;
      else if (dAlong <= 0) dist = dLat;
      else dist = Math.hypot(dLat, dAlong);
      // Prefer on-segment; slight bias for closer center
      const score = dist + Math.abs(along - clampedAlong) * 0.001;
      if (score < best.dist) {
        best = { seg, lateral, along, dist: score };
      }
    }
    return best;
  }

  query(pos: THREE.Vector3, yaw: number): RoadQuery {
    const { seg, lateral } = this.nearestSegment(pos.x, pos.z);
    // Generous margin so curb grass does not spam off-road while on asphalt
    const offroad = !isOnRoadNetwork(pos.x, pos.z, 1.0);

    let roadYaw = 0;
    if (seg.axis === 'z') {
      // Preferred session direction is always +Z on the visual right lane (x≈RIGHT_LANE_X)
      roadYaw = 0;
    } else {
      const a = Math.PI / 2;
      const b = -Math.PI / 2;
      roadYaw = angleDiff(yaw, a) < angleDiff(yaw, b) ? a : b;
    }

    let headingError = yaw - roadYaw;
    while (headingError > Math.PI) headingError -= Math.PI * 2;
    while (headingError < -Math.PI) headingError += Math.PI * 2;

    const nearIntersection = CROSS_ZS.some((cz) => Math.abs(pos.z - cz) < ROAD_HALF_WIDTH + 2.5);
    const fz = Math.cos(yaw);
    // RHT on main corridor (FP right lane = x < 0): right lane legal +Z, left lane legal -Z
    let wrongway = false;
    if (!nearIntersection && Math.abs(pos.x) < ROAD_HALF_WIDTH + 1) {
      if (pos.x < -0.35) wrongway = fz < -0.5;
      else if (pos.x > 0.35) wrongway = fz > 0.5;
    }

    // Only solid buildings count as collision for scoring — not soft curb
    const buildingHit = this.collideCircle(pos.x, pos.z, CAR_RADIUS);
    const collision = buildingHit;

    return {
      lateralOffset: lateral,
      headingError,
      offroad,
      wrongway,
      collision,
      axis: seg.axis,
    };
  }

  /** Circle vs building AABBs — true if overlapping any solid. */
  collideCircle(x: number, z: number, radius: number): boolean {
    for (const b of this.solidBoxes) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  /** Resolve circle against solids; mutates x/z via out, returns hit. */
  resolveCircle(out: { x: number; z: number }, radius: number): boolean {
    let hit = false;
    for (const b of this.solidBoxes) {
      const nearestX = Math.max(b.minX, Math.min(out.x, b.maxX));
      const nearestZ = Math.max(b.minZ, Math.min(out.z, b.maxZ));
      let dx = out.x - nearestX;
      let dz = out.z - nearestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius) continue;
      hit = true;
      if (distSq < 1e-8) {
        // Center inside AABB — push along shallowest axis
        const left = out.x - b.minX;
        const right = b.maxX - out.x;
        const down = out.z - b.minZ;
        const up = b.maxZ - out.z;
        const m = Math.min(left, right, down, up);
        if (m === left) out.x = b.minX - radius;
        else if (m === right) out.x = b.maxX + radius;
        else if (m === down) out.z = b.minZ - radius;
        else out.z = b.maxZ + radius;
      } else {
        const dist = Math.sqrt(distSq);
        const push = (radius - dist) / dist;
        out.x += dx * push;
        out.z += dz * push;
      }
    }
    return hit;
  }


  /** Building hits only. Off-road is allowed; returns true only when hitting a building. */
  resolveCollision(pos: THREE.Vector3): boolean {
    let buildingHit = false;
    const radius = CAR_RADIUS;

    for (let pass = 0; pass < 3; pass++) {
      let passHit = false;
      for (const b of this.solidBoxes) {
        const nearestX = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const nearestZ = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - nearestX;
        let dz = pos.z - nearestZ;
        let distSq = dx * dx + dz * dz;
        if (distSq >= radius * radius) continue;
        passHit = true;
        buildingHit = true;
        if (distSq < 1e-8) {
          const left = pos.x - b.minX;
          const right = b.maxX - pos.x;
          const down = pos.z - b.minZ;
          const up = b.maxZ - pos.z;
          const m = Math.min(left, right, down, up);
          if (m === left) pos.x = b.minX - radius;
          else if (m === right) pos.x = b.maxX + radius;
          else if (m === down) pos.z = b.minZ - radius;
          else pos.z = b.maxZ + radius;
        } else {
          const dist = Math.sqrt(distSq);
          const push = (radius - dist) / dist;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
      if (!passHit) break;
    }

    // Off-road allowed — only clamp at far world edges (not road curbs)
    if (Math.abs(pos.x) > WORLD_SOFT) pos.x = Math.sign(pos.x) * WORLD_SOFT;
    if (pos.z < -40) pos.z = -40;
    if (pos.z > MAIN_ROAD_LENGTH + 20) pos.z = MAIN_ROAD_LENGTH + 20;

    return buildingHit;
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
