import type { MetricScore, SessionResult } from './metrics';
import { SPEED_LIMIT_KMH } from './world';
import { AXIS_TR, type KarneCategories } from './profiles';
import { groupDetailMetrics, type DetailMetric } from './detailMetrics';

function tone(score: number): string {
  if (score >= 80) return '#5dff9a';
  if (score >= 55) return '#f0d060';
  return '#ff8080';
}

function riskTone(r: string): string {
  if (r === 'Düşük') return '#5dff9a';
  if (r === 'Orta') return '#f0d060';
  if (r === 'Yüksek') return '#ff8080';
  return '#ff4040';
}

export type ReportExtra = {
  sessionSec: number;
  waypointsDone: number;
  waypointsTotal: number;
  sampleCount: number;
  profileName?: string | null;
  karneDelta?: number | null;
  /** Offer create-profile CTA when no active profile after a real session */
  offerCreateProfile?: boolean;
  /** Prefer clean+ready styling; false → optional-style CTA copy */
  createProfilePreferClean?: boolean;
  baselineReady?: boolean;
  /** Offer explicit "Kalibrasyonu kaydet" when session clean+ready */
  offerSaveCalibration?: boolean;
  session?: SessionResult | null;
  calibrated?: boolean;
  /** Research-pool metrics for expandable detail lab */
  detailMetrics?: DetailMetric[];
};

function pickStrongWeak(scores: MetricScore[]): { strong: MetricScore[]; weak: MetricScore[] } {
  const base = scores.filter((s) => s.id !== 'style_adherence');
  const nontrivial = (s: MetricScore) =>
    !(s.score >= 95 && /0\s*s|yok|0 kez|0%/i.test(s.valueLabel));
  const preferVariety = (s: MetricScore) => s.score >= 1 && s.score <= 99;

  let pool = base.filter(nontrivial);
  if (!pool.length) pool = base;

  const variety = pool.filter(preferVariety);
  const rankedStrong = [...(variety.length ? variety : pool)].sort((a, b) => b.score - a.score);
  const rankedWeak = [...(variety.length ? variety : pool)].sort((a, b) => a.score - b.score);

  // Fill from full nontrivial/base if variety pool too small
  const fillStrong = [...rankedStrong];
  const fillWeak = [...rankedWeak];
  if (fillStrong.length < 3) {
    for (const s of [...pool].sort((a, b) => b.score - a.score)) {
      if (!fillStrong.includes(s)) fillStrong.push(s);
      if (fillStrong.length >= 3) break;
    }
  }
  if (fillWeak.length < 3) {
    for (const s of [...pool].sort((a, b) => a.score - b.score)) {
      if (!fillWeak.includes(s)) fillWeak.push(s);
      if (fillWeak.length >= 3) break;
    }
  }

  return {
    strong: fillStrong.slice(0, 3),
    weak: fillWeak.slice(0, 3),
  };
}

function axisBars(axes: KarneCategories): string {
  return (Object.keys(axes) as (keyof KarneCategories)[])
    .map((key) => {
      const val = axes[key];
      const meta = AXIS_TR[key];
      return `<div class="axis-row" title="${meta.tip}">
        <div class="axis-label"><strong>${meta.title}</strong><span class="axis-tip">${escapeHtml(meta.tip)}</span></div>
        <div class="axis-track"><div class="axis-fill" style="width:${val}%;background:${tone(val)}"></div></div>
        <div class="axis-val" style="color:${tone(val)}">${val}<small>%</small></div>
      </div>`;
    })
    .join('');
}

/** Compact 5-axis radar (pure SVG, no deps). */
function axisRadarSvg(axes: KarneCategories): string {
  const keys = Object.keys(axes) as (keyof KarneCategories)[];
  const n = keys.length;
  const cx = 90;
  const cy = 90;
  const rMax = 68;
  const levels = [0.25, 0.5, 0.75, 1];
  const angleAt = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, frac: number) => {
    const a = angleAt(i);
    return [cx + Math.cos(a) * rMax * frac, cy + Math.sin(a) * rMax * frac] as const;
  };
  const rings = levels
    .map((lv) => {
      const pts = keys.map((_, i) => pt(i, lv).join(',')).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="#2a3a50" stroke-width="1"/>`;
    })
    .join('');
  const spokes = keys
    .map((_, i) => {
      const [x, y] = pt(i, 1);
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#2a3a50" stroke-width="1"/>`;
    })
    .join('');
  const dataPts = keys.map((k, i) => pt(i, Math.max(0, Math.min(100, axes[k])) / 100));
  const dataPoly = dataPts.map(([x, y]) => `${x},${y}`).join(' ');
  const dots = dataPts
    .map(([x, y], i) => {
      const v = axes[keys[i]];
      return `<circle cx="${x}" cy="${y}" r="3.2" fill="${tone(v)}" stroke="#0a0e14" stroke-width="1"/>`;
    })
    .join('');
  const labels = keys
    .map((k, i) => {
      const [x, y] = pt(i, 1.18);
      const short = AXIS_TR[k].title.split(' ')[0];
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#a8b8d0" font-size="9">${escapeHtml(short)}</text>`;
    })
    .join('');
  return `<svg class="axis-radar" viewBox="0 0 180 180" width="180" height="180" aria-label="5 eksen radar">
    ${rings}${spokes}
    <polygon points="${dataPoly}" fill="rgba(93,255,154,0.22)" stroke="#5dff9a" stroke-width="2"/>
    ${dots}${labels}
  </svg>`;
}

function compareBars(items: MetricScore[], kind: 'strong' | 'weak'): string {
  if (!items.length) return '<p class="muted">—</p>';
  return items
    .map((m) => {
      const col = kind === 'strong' ? tone(m.score) : tone(m.score);
      return `<div class="cmp-row" title="${escapeHtml(m.valueLabel)}">
        <div class="cmp-name">${escapeHtml(m.nameTr)}</div>
        <div class="cmp-track"><div class="cmp-fill" style="width:${m.score}%;background:${col}"></div></div>
        <div class="cmp-val" style="color:${col}">${m.score}<small>%</small></div>
      </div>`;
    })
    .join('');
}


/** Critical overlay CSS injected with body so bars work even if app style.css misses rules. */
const REPORT_OVERLAY_CSS = `
#report-content .report-hero {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px;
  margin: 8px 0 14px; padding: 16px 18px;
  background: linear-gradient(135deg, #152030, #1a2838);
  border: 1px solid #3a5a7a; border-radius: 12px;
}
#report-content .report-hero .overall { font-size: 48px; font-weight: 800; line-height: 1; }
#report-content .report-hero .risk-badge {
  display: inline-block; padding: 4px 12px; border-radius: 999px;
  font-size: 14px; font-weight: 700; border: 1px solid currentColor;
  background: rgba(0,0,0,0.25);
}
#report-content .tip {
  margin: 10px 0 14px; padding: 10px 12px; background: #152030;
  border-left: 3px solid #3a8ac0; border-radius: 6px; line-height: 1.45;
}
#report-content .axis-panel {
  display: flex; flex-wrap: wrap; gap: 18px 24px; align-items: center;
}
#report-content .axis-bars { display: flex; flex-direction: column; gap: 10px; max-width: 520px; flex: 1 1 280px; }
#report-content .axis-row {
  display: grid; grid-template-columns: minmax(120px, 160px) 1fr 52px; gap: 10px;
  align-items: center; font-size: 13px;
}
#report-content .axis-label strong { color: #e6edf3; display: block; }
#report-content .axis-tip { display: block; font-size: 10px; color: #7a8aa0; margin-top: 2px; line-height: 1.25; }
#report-content .axis-track {
  height: 14px; background: #1a2434; border-radius: 8px; overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.35);
}
#report-content .axis-fill {
  height: 100%; border-radius: 8px;
  box-shadow: 0 0 8px rgba(93,255,154,0.15);
}
#report-content .axis-val {
  font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; font-size: 14px;
}
#report-content .axis-val small { font-size: 10px; opacity: 0.75; margin-left: 1px; }
#report-content .axis-radar-wrap { flex: 0 0 auto; }
#report-content .axis-radar { display: block; background: #0c121c; border-radius: 12px; border: 1px solid #243044; }
#report-content .cmp-bars { display: flex; flex-direction: column; gap: 8px; }
#report-content .cmp-row {
  display: grid; grid-template-columns: 1fr 1.2fr 48px; gap: 8px; align-items: center; font-size: 12px;
}
#report-content .cmp-name { color: #d0dae8; }
#report-content .cmp-track {
  height: 10px; background: #1a2434; border-radius: 6px; overflow: hidden;
}
#report-content .cmp-fill { height: 100%; border-radius: 6px; }
#report-content .cmp-val {
  font-weight: 700; text-align: right; font-variant-numeric: tabular-nums;
}
#report-content .cmp-val small { font-size: 9px; opacity: 0.7; }
#report-content .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 640px) { #report-content .two-col { grid-template-columns: 1fr; } }
#report-content .sw-card {
  background: #0c121c; border: 1px solid #243044; border-radius: 10px; padding: 12px 14px;
}
#report-content .sw-card h3 { font-size: 14px; margin: 0 0 8px; }
#report-content .timeline { list-style: none; margin: 0; padding: 0; }
#report-content .timeline li {
  padding: 6px 10px; margin-bottom: 4px; border-radius: 6px;
  background: #121820; border: 1px solid #243044; font-size: 12px;
}
#report-content .timeline .tl-warn { border-color: #a05050; }
#report-content .timeline .tl-info { border-color: #3a5a8a; }
#report-content .karne-effect {
  margin: 12px 0; padding: 12px 14px; border-radius: 10px;
  background: linear-gradient(135deg, #152030, #1a2838); border: 1px solid #3a5a7a;
}
#report-content .offer-create {
  margin-top: 12px; padding: 12px; background: #15241c;
  border: 1px solid #2d8a5a; border-radius: 10px;
}
#report-content .comp-weights { color: #8b9bb4; font-size: 12px; margin-top: 6px; }
#report-content .score-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;
}
#report-content .score-card {
  background: #0c121c; border: 1px solid #243044; border-radius: 10px; padding: 12px;
}
#report-content .score-card .name { font-size: 12px; color: #8b9bb4; }
#report-content .score-card .score { font-size: 26px; font-weight: 700; }
#report-content .score-card .why { font-size: 12px; color: #a8b8d0; margin-top: 6px; line-height: 1.4; }
#report-content .disclaimer {
  margin-top: 12px; padding: 10px 12px; background: #1a1520;
  border: 1px solid #5a3a60; border-radius: 8px; font-size: 12px; color: #d0b0d8; line-height: 1.45;
}
#report-content details.metrics-details {
  margin: 14px 0; padding: 10px 12px; background: #0c121c;
  border: 1px solid #243044; border-radius: 10px;
}
#report-content details.metrics-details > summary {
  cursor: pointer; font-weight: 600; color: #c8d4e4; user-select: none;
}
#report-content .muted { color: #8b9bb4; font-size: 13px; }
#report-content .style-note { margin: 8px 0; color: #a8c8e0; }
#report-content .method { font-size: 12px; color: #7a8aa0; margin-top: 8px; line-height: 1.4; }
#report-content h2 { font-size: 16px; margin: 18px 0 8px; color: #c8d4e4; }
#report-content h1 { font-size: 22px; margin-bottom: 4px; }
#report-content .sub { color: #8b9bb4; margin-bottom: 12px; font-size: 13px; }
#report-content ul { margin: 8px 0 0 18px; font-size: 13px; color: #c0ccd8; }

#report-content details.detail-lab {
  margin: 16px 0; padding: 12px 14px; background: #0a1018;
  border: 1px solid #2a3a50; border-radius: 10px;
}
#report-content details.detail-lab > summary {
  cursor: pointer; font-weight: 700; color: #b8c8dc; user-select: none;
  font-size: 14px;
}
#report-content .detail-lab-note {
  margin: 10px 0 12px; font-size: 12px; color: #8b9bb4; line-height: 1.45;
}
#report-content .detail-cat { margin: 14px 0 8px; }
#report-content .detail-cat h3 {
  font-size: 13px; margin: 0 0 8px; color: #9ab0c8; text-transform: none;
  letter-spacing: 0.02em;
}
#report-content .detail-row {
  display: grid; grid-template-columns: minmax(140px, 1.2fr) 1fr minmax(72px, 0.7fr);
  gap: 8px; align-items: center; font-size: 12px; margin-bottom: 6px;
}
#report-content .detail-row .dl-name { color: #d0dae8; }
#report-content .detail-row .dl-track {
  height: 8px; background: #1a2434; border-radius: 5px; overflow: hidden;
}
#report-content .detail-row .dl-fill { height: 100%; border-radius: 5px; }
#report-content .detail-row .dl-fill.na { width: 100% !important; background: #3a4454 !important; opacity: 0.55; }
#report-content .detail-row .dl-val {
  font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; color: #a8b8d0;
  font-size: 11px;
}
#report-content .detail-row.na-row .dl-name { color: #7a8898; }
`.trim();


export function buildReportHtml(metrics: MetricScore[], meta: ReportExtra): string {
  const session = meta.session;
  const overall = session?.overall ??
    (metrics.length ? Math.round(metrics.reduce((a, m) => a + m.score, 0) / metrics.length) : 0);
  const risk = session?.riskLevel ?? (overall >= 70 ? 'Düşük' : overall >= 50 ? 'Orta' : 'Yüksek');
  const tip = session?.coachTip ?? 'Oturumu tamamladınız — güvenlik öncelikli sürüşün.';
  const { strong, weak } = pickStrongWeak(metrics);

  const mm = Math.floor(meta.sessionSec / 60);
  const ss = Math.floor(meta.sessionSec % 60);

  const modeLabel =
    session?.mode === 'degerlendirme'
      ? 'Profil değerlendirme'
      : session?.mode === 'serbest'
        ? 'Serbest'
        : 'Eğitim / Kalibrasyon';

  let karneBlock = '';
  if (meta.profileName && meta.karneDelta != null) {
    const sign = meta.karneDelta >= 0 ? `+${meta.karneDelta}` : `${meta.karneDelta}`;
    const col = meta.karneDelta >= 0 ? '#5dff9a' : '#ff8080';
    karneBlock = `<div class="karne-effect">Karnene etkisi (<strong>${escapeHtml(meta.profileName)}</strong>): <span style="color:${col};font-weight:700;font-size:22px">${sign}</span></div>`;
  }

  let offerBlock = '';
  if (meta.offerCreateProfile) {
    const preferClean = !!meta.createProfilePreferClean && !!meta.baselineReady;
    if (preferClean) {
      offerBlock = `<div class="offer-create">
      Bu temiz kalibrasyon oturumundaki stile göre profil oluşturabilirsiniz.
      <div style="margin-top:8px"><button type="button" id="report-create-profile" class="btn">Bu stile göre profil oluştur</button></div>
    </div>`;
    } else {
      offerBlock = `<div class="offer-create">
      <strong>Profil oluştur (stil kaydı isteğe bağlı)</strong>
      <p style="margin:6px 0 0;font-size:13px;color:#b8d0c0;line-height:1.4">Oturum kirli veya baseline hazır değilse stil kaydı boş/kısmi olabilir; profil yine de oluşturulur. Temiz kalibrasyon tercih edilir.</p>
      <div style="margin-top:8px"><button type="button" id="report-create-profile" class="btn">Profil oluştur (stil kaydı isteğe bağlı)</button></div>
    </div>`;
    }
  }
  if (meta.offerSaveCalibration) {
    offerBlock += `<div class="offer-create" style="margin-top:10px">
      Oturum yeterince temiz — kişisel baseline kaydedilebilir.
      <div style="margin-top:8px"><button type="button" id="report-save-calibration" class="btn">Kalibrasyonu kaydet</button></div>
    </div>`;
  }

  const axesBlock = session
    ? `<h2>5 eksen</h2>
       <div class="axis-panel">
         <div class="axis-bars">${axisBars(session.axes)}</div>
         <div class="axis-radar-wrap">${axisRadarSvg(session.axes)}</div>
       </div>
       <p class="comp-weights muted">Ağırlıklar: Güvenlik %30 · Kural %25 · Tarama %20 · Pürüzsüzlük %15 · Görev %10</p>`
    : '';

  const strongList = compareBars(strong, 'strong');
  const weakList = compareBars(weak, 'weak');

  const timeline =
    session?.alertTimeline?.length
      ? `<h2>Uyarı özeti</h2><ul class="timeline">${session.alertTimeline
          .map(
            (a) =>
              `<li class="tl-${a.kind}">${escapeHtml(a.message)}</li>`
          )
          .join('')}</ul>`
      : '';

  const cards = metrics
    .map(
      (m) => `
    <div class="score-card">
      <div class="name">${m.nameTr}</div>
      <div class="score" style="color:${tone(m.score)}">${m.score}</div>
      <div class="why"><strong>${escapeHtml(m.valueLabel)}</strong></div>
      <ul>${m.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      ${m.proxyNote ? `<div class="why" style="color:#d0b0d8;margin-top:6px">⚠ ${escapeHtml(m.proxyNote)}</div>` : ''}
    </div>`
    )
    .join('');

  const styleNote =
    session?.styleAdherence != null
      ? `<p class="style-note">Stil uyumu (bilgi): <strong>${session.styleAdherence}</strong>/100 — güvenlik puanını şişirmez.</p>`
      : '';

  const confNote =
    session && session.confidence < 0.95
      ? `<p class="muted">Kısa oturum güveni %${Math.round(session.confidence * 100)} · ${session.distanceKm.toFixed(2)} km — skor nötr ~70’e çekildi.</p>`
      : session
        ? `<p class="muted">Mesafe ${session.distanceKm.toFixed(2)} km · tam güven.</p>`
        : '';

  const baselineNote = meta.calibrated || meta.baselineReady
    ? `<p><strong>Baseline notu:</strong> Kişisel kalibrasyon ${meta.calibrated ? 'kayıtlı' : 'bu oturumda hazır'}.</p>`
    : `<p><strong>Baseline notu:</strong> Henüz kalibrasyon kaydı yok — Eğitim/Kalibrasyon modunda temiz oturumla kaydedin.</p>`;


  const detailLabBlock = (() => {
    const list = meta.detailMetrics ?? [];
    if (!list.length) return '';
    const groups = groupDetailMetrics(list);
    const body = groups
      .map((g) => {
        const rows = g.items
          .map((m) => {
            const score = m.score0to100;
            const na = score == null;
            const w = na ? 100 : Math.max(0, Math.min(100, score));
            const col = na ? '#3a4454' : tone(score);
            const tip = escapeHtml(m.tip);
            return `<div class="detail-row${na ? ' na-row' : ''}" title="${tip}">
        <div class="dl-name">${escapeHtml(m.nameTr)}</div>
        <div class="dl-track"><div class="dl-fill${na ? ' na' : ''}" style="width:${w}%;background:${col}"></div></div>
        <div class="dl-val">${escapeHtml(m.valueLabel)}${na ? '' : ` · ${score}`}</div>
      </div>`;
          })
          .join('');
        return `<div class="detail-cat"><h3>${escapeHtml(g.category)} (${g.items.length})</h3>${rows}</div>`;
      })
      .join('');
    return `<details class="detail-lab">
    <summary>Detaylı metrik laboratuvarı (araştırma) — ${list.length} metrik</summary>
    <p class="detail-lab-note">Özet karneden ayrıdır; literatür/araştırma havuzu. Eye-tracking yoktur. Gri çubuklar simde olmayan sensör metrikleridir.</p>
    ${body}
  </details>`;
  })();

  const headStyles = `
  body { font-family: system-ui, sans-serif; background:#0a0e14; color:#e6edf3; margin:0; padding:24px; }
  h1 { margin:0 0 4px; font-size:22px; }
  h2 { font-size:16px; margin:18px 0 8px; color:#c8d4e4; }
  .sub { color:#8b9bb4; margin-bottom:12px; font-size:13px; }
  .overall { font-size:42px; font-weight:800; color:${tone(overall)}; }
  .risk { font-size:20px; font-weight:700; color:${riskTone(risk)}; margin-left:8px; }
  .risk-badge { color:${riskTone(risk)}; border-color:${riskTone(risk)}; }
  .tip { margin:10px 0 14px; padding:10px 12px; background:#152030; border-left:3px solid #3a8ac0; border-radius:6px; line-height:1.45; }
  .report-hero { display:flex; flex-wrap:wrap; align-items:center; gap:12px 18px; margin:8px 0 14px; padding:16px 18px; background:linear-gradient(135deg,#152030,#1a2838); border:1px solid #3a5a7a; border-radius:12px; }
  .report-hero .overall { font-size:48px; font-weight:800; line-height:1; }
  .risk-badge { display:inline-block; padding:4px 12px; border-radius:999px; font-size:14px; font-weight:700; border:1px solid currentColor; background:rgba(0,0,0,0.25); }
  .score-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; }
  .score-card { background:#0c121c; border:1px solid #243044; border-radius:10px; padding:12px; }
  .score-card .name { font-size:12px; color:#8b9bb4; }
  .score-card .score { font-size:28px; font-weight:700; }
  .score-card .why { font-size:12px; color:#a8b8d0; margin-top:6px; }
  ul { margin:8px 0 0 18px; font-size:13px; color:#c0ccd8; }
  .disclaimer { margin-top:20px; padding:12px; background:#1a1520; border:1px solid #5a3a60; border-radius:8px; font-size:13px; color:#d0b0d8; line-height:1.45; }
  .karne-effect { margin:12px 0; padding:12px 14px; border-radius:10px; background:#152030; border:1px solid #3a5a7a; }
  .offer-create { margin-top:12px; padding:12px; background:#15241c; border:1px solid #2d8a5a; border-radius:10px; }
  .btn { cursor:pointer; background:#2d8a5a; color:#fff; border:none; border-radius:8px; padding:8px 14px; font-weight:600; }
  .axis-panel { display:flex; flex-wrap:wrap; gap:18px 24px; align-items:center; }
  .axis-bars { display:flex; flex-direction:column; gap:10px; max-width:520px; flex:1 1 280px; }
  .axis-row { display:grid; grid-template-columns:minmax(120px,160px) 1fr 52px; gap:10px; align-items:center; font-size:13px; }
  .axis-label strong { display:block; color:#e6edf3; }
  .axis-tip { display:block; font-size:10px; color:#7a8aa0; margin-top:2px; }
  .axis-track { height:14px; background:#1a2434; border-radius:8px; overflow:hidden; }
  .axis-fill { height:100%; border-radius:8px; }
  .axis-val { font-weight:700; text-align:right; font-size:14px; }
  .axis-val small { font-size:10px; opacity:0.75; }
  .axis-radar { display:block; background:#0c121c; border-radius:12px; border:1px solid #243044; }
  .cmp-bars { display:flex; flex-direction:column; gap:8px; }
  .cmp-row { display:grid; grid-template-columns:1fr 1.2fr 48px; gap:8px; align-items:center; font-size:12px; }
  .cmp-track { height:10px; background:#1a2434; border-radius:6px; overflow:hidden; }
  .cmp-fill { height:100%; border-radius:6px; }
  .cmp-val { font-weight:700; text-align:right; }
  .cmp-val small { font-size:9px; opacity:0.7; }
  .two-col { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:640px){ .two-col{ grid-template-columns:1fr; } }
  .sw-card { background:#0c121c; border:1px solid #243044; border-radius:10px; padding:12px 14px; }
  .sw-card h3 { font-size:14px; margin:0 0 8px; }
  .timeline { list-style:none; margin:0; padding:0; }
  .timeline li { padding:6px 10px; margin-bottom:4px; border-radius:6px; background:#121820; border:1px solid #243044; font-size:12px; }
  .timeline .tl-warn { border-color:#a05050; }
  .timeline .tl-info { border-color:#3a5a8a; }
  .muted { color:#8b9bb4; font-size:13px; }
  .style-note { margin:8px 0; color:#a8c8e0; }
  .method { font-size:12px; color:#7a8aa0; margin-top:8px; line-height:1.4; }
  .comp-weights { color:#8b9bb4; font-size:12px; margin-top:6px; }
  details.metrics-details { margin:14px 0; padding:10px 12px; background:#0c121c; border:1px solid #243044; border-radius:10px; }
  details.metrics-details > summary { cursor:pointer; font-weight:600; color:#c8d4e4; }
  details.detail-lab { margin:16px 0; padding:12px 14px; background:#0a1018; border:1px solid #2a3a50; border-radius:10px; }
  details.detail-lab > summary { cursor:pointer; font-weight:700; color:#b8c8dc; font-size:14px; }
  .detail-lab-note { margin:10px 0 12px; font-size:12px; color:#8b9bb4; line-height:1.45; }
  .detail-cat { margin:14px 0 8px; }
  .detail-cat h3 { font-size:13px; margin:0 0 8px; color:#9ab0c8; }
  .detail-row { display:grid; grid-template-columns:minmax(140px,1.2fr) 1fr minmax(72px,0.7fr); gap:8px; align-items:center; font-size:12px; margin-bottom:6px; }
  .detail-row .dl-name { color:#d0dae8; }
  .detail-row .dl-track { height:8px; background:#1a2434; border-radius:5px; overflow:hidden; }
  .detail-row .dl-fill { height:100%; border-radius:5px; }
  .detail-row .dl-fill.na { width:100% !important; background:#3a4454 !important; opacity:0.55; }
  .detail-row .dl-val { font-weight:600; text-align:right; font-variant-numeric:tabular-nums; color:#a8b8d0; font-size:11px; }
  .detail-row.na-row .dl-name { color:#7a8898; }
`;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<title>Sürüş Scan Coach — Oturum Raporu</title>
<style>
${headStyles}
</style>
</head>
<body>
  <h1>Sürüş Scan Coach — Oturum Raporu</h1>
  <p class="sub">Süre ${mm}:${ss.toString().padStart(2, '0')} · Waypoint ${meta.waypointsDone}/${meta.waypointsTotal} · Örnek ${meta.sampleCount} · Limit ${SPEED_LIMIT_KMH} km/h · Mod: ${modeLabel}${meta.profileName ? ` · Profil: ${escapeHtml(meta.profileName)}` : ''}</p>

  <div class="report-hero">
    <span class="overall" style="color:${tone(overall)}">${overall}</span>
    <div>
      <div style="font-size:13px;color:#8b9bb4;margin-bottom:4px">Genel puan / 100</div>
      <span class="risk-badge" style="color:${riskTone(risk)};border-color:${riskTone(risk)}">Risk: ${risk}</span>
    </div>
  </div>
  <div class="tip"><strong>Koç ipucu:</strong> ${escapeHtml(tip)}</div>
  ${confNote}
  ${karneBlock}
  ${offerBlock}
  ${styleNote}

  ${axesBlock}

  <h2>Güçlü / gelişmeli</h2>
  <div class="two-col">
    <div class="sw-card"><h3 style="color:#5dff9a">Güçlü</h3><div class="cmp-bars">${strongList}</div></div>
    <div class="sw-card"><h3 style="color:#f0d060">Gelişmeli</h3><div class="cmp-bars">${weakList}</div></div>
  </div>

  ${timeline}

    <details class="metrics-details">
    <summary>Metrik satırları (${metrics.length}) — açmak için tıkla</summary>
    <div class="score-grid" style="margin-top:12px">${cards}</div>
  </details>

  ${detailLabBlock}

  <p class="disclaimer" style="margin-top:12px">
    Tarama / ayna-omuz skorları <strong>davranışsal proxy</strong>’dir; eye-tracking değildir.
  </p>

  <h2>Baseline</h2>
  ${baselineNote}

  <h2>Yöntem</h2>
  <p class="method">
    Safety Floor (limit aşımı, ters yön, off-road, çarpışma, aşırı ivme) kişisel stile rağmen affedilmez.
    Genel puan: Güvenlik %30 + Kural %25 + Tarama %20 + Pürüzsüzlük %15 + Görev %10.
    Hard-fail (çarpışma / uzun ters yön) güvenlik bileşenini ve genel puanı tavanlar.
    Kısa oturumlar nötr ~70’e shrink edilir. Stil uyumu yalnızca bilgi.
    MVP eğitim / prototip amaçlıdır; resmi ehliyet değerlendirmesi değildir.
  </p>
</body>
</html>`;
}


function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}

export function showReportOverlay(
  html: string,
  onClose: () => void,
  onCreateProfile?: () => void,
  onSaveCalibration?: () => void
) {
  const overlay = document.getElementById('report-overlay')!;
  const content = document.getElementById('report-content')!;
  const dl = document.getElementById('download-report')!;
  const close = document.getElementById('close-report')!;

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // Head <style> is dropped when only body is injected — re-attach critical CSS.
  content.innerHTML = `<style>${REPORT_OVERLAY_CSS}</style>` + parsed.body.innerHTML;
  overlay.classList.remove('hidden');

  const createBtn = content.querySelector('#report-create-profile') as HTMLButtonElement | null;
  if (createBtn && onCreateProfile) {
    createBtn.addEventListener('click', () => {
      onCreateProfile();
    });
  }
  const saveBtn = content.querySelector('#report-save-calibration') as HTMLButtonElement | null;
  if (saveBtn && onSaveCalibration) {
    saveBtn.addEventListener('click', () => {
      onSaveCalibration();
    });
  }

  const dlHandler = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surus-scan-coach-report-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const closeHandler = () => {
    overlay.classList.add('hidden');
    dl.removeEventListener('click', dlHandler);
    close.removeEventListener('click', closeHandler);
    onClose();
  };

  dl.addEventListener('click', dlHandler);
  close.addEventListener('click', closeHandler);
}
