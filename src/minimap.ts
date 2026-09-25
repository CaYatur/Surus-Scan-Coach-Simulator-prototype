import type { Waypoints } from './waypoints';
import { CROSS_ZS, MAIN_ROAD_LENGTH, ROAD_HALF_WIDTH, CROSS_HALF_LENGTH } from './world';

/** Top-down minimap: up = car forward, right = driver's right (matches FP view). */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private badge: HTMLElement;

  constructor() {
    this.canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    this.badge = document.getElementById('minimap-wrongway')!;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('minimap canvas');
    this.ctx = ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = 168;
    this.canvas.width = css * dpr;
    this.canvas.height = css * dpr;
    this.canvas.style.width = css + 'px';
    this.canvas.style.height = css + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update(carX: number, carZ: number, carYaw: number, waypoints: Waypoints, wrongway: boolean) {
    this.badge.classList.toggle('visible', wrongway);
    this.badge.textContent = wrongway ? 'TERS YÖN' : '';

    const ctx = this.ctx;
    const W = 168;
    const H = 168;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c1420';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2a3a52';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const scale = 1.1;
    // Forward (fx,fz). Visual driver-right matches FP (Three.js look +Z ⇒ screen-right = -X).
    const fx = Math.sin(carYaw);
    const fz = Math.cos(carYaw);
    const rx = -fz;
    const rz = fx;

    const toLocal = (wx: number, wz: number) => {
      const dx = wx - carX;
      const dz = wz - carZ;
      const right = dx * rx + dz * rz; // + = driver's right
      const ahead = dx * fx + dz * fz; // + = ahead
      return {
        x: W / 2 + right * scale,
        y: H / 2 - ahead * scale,
      };
    };

    ctx.fillStyle = '#1a3020';
    ctx.fillRect(4, 4, W - 8, H - 8);

    ctx.strokeStyle = '#3a4250';
    ctx.lineWidth = ROAD_HALF_WIDTH * 2 * scale;
    ctx.lineCap = 'butt';
    const a = toLocal(0, -20);
    const b = toLocal(0, MAIN_ROAD_LENGTH - 20);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    for (const cz of CROSS_ZS) {
      const p0 = toLocal(-CROSS_HALF_LENGTH, cz);
      const p1 = toLocal(CROSS_HALF_LENGTH, cz);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#e0c040';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const pts = waypoints.getTargetPoints();
    const curIdx = waypoints.getCurrentIndex();
    for (let i = 0; i < pts.length; i++) {
      const t = pts[i];
      const p = toLocal(t.x, t.z);
      const current = i === curIdx;
      ctx.fillStyle = current ? '#5dff9a' : i < curIdx ? '#4a6a58' : '#88aacc';
      ctx.beginPath();
      ctx.arc(p.x, p.y, current ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (current) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    const target = waypoints.currentTarget();
    if (target) {
      const tp = toLocal(target.x, target.z);
      const cx = W / 2;
      const cy = H / 2;
      const ang = Math.atan2(tp.y - cy, tp.x - cx);
      const edgeR = 62;
      const ex = cx + Math.cos(ang) * edgeR;
      const ey = cy + Math.sin(ang) * edgeR;
      ctx.fillStyle = '#5dff9a';
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * 10, ey + Math.sin(ang) * 10);
      ctx.lineTo(ex + Math.cos(ang + 2.5) * 8, ey + Math.sin(ang + 2.5) * 8);
      ctx.lineTo(ex + Math.cos(ang - 2.5) * 8, ey + Math.sin(ang - 2.5) * 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(93,255,154,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
    }

    ctx.fillStyle = wrongway ? '#ff6060' : '#4da3ff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2 - 9);
    ctx.lineTo(W / 2 - 6, H / 2 + 7);
    ctx.lineTo(W / 2 + 6, H / 2 + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#6b7c95';
    ctx.font = '10px sans-serif';
    ctx.fillText('WP', 8, 14);
  }
}
