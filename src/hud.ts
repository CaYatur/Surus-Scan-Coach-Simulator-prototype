import type { LiveAlert, SessionMode } from './metrics';
import type { DriverProfile } from './profiles';
import { AXIS_TR, letterGrade } from './profiles';

export class HUD {
  private speedEl = document.getElementById('speed-val')!;
  private targetEl = document.getElementById('target-val')!;
  private wpEl = document.getElementById('wp-val')!;
  private timeEl = document.getElementById('time-val')!;
  private stripEl = document.getElementById('metrics-strip')!;
  private alertsEl = document.getElementById('alerts')!;
  private profileLabel = document.getElementById('profile-label')!;
  private camLabel = document.getElementById('cam-label')!;
  private modeLabel = document.getElementById('mode-label');
  private toastTimers: number[] = [];

  setSpeed(kmh: number) {
    this.speedEl.textContent = String(Math.round(kmh));
  }

  setTargetDistance(m: number | null) {
    this.targetEl.textContent = m == null ? '—' : m.toFixed(0);
  }

  setWaypoint(label: string) {
    this.wpEl.textContent = label;
  }

  setTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    this.timeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }

  setStrip(items: { id: string; label: string; tone: string }[]) {
    this.stripEl.innerHTML = items
      .map((i) => `<span class="metric-chip ${i.tone}">${i.label}</span>`)
      .join('');
  }

  setProfileLabel(name: string | null, mode?: SessionMode) {
    const modeTr =
      mode === 'degerlendirme'
        ? 'Değerlendirme'
        : mode === 'serbest'
          ? 'Serbest'
          : 'Kalibrasyon';
    this.profileLabel.textContent = name
      ? `Profil: ${name}`
      : 'Eğitim / Kalibrasyon (profil yok)';
    if (this.modeLabel) {
      this.modeLabel.textContent = `Mod: ${modeTr}`;
    }
  }

  setCameraLabel(mode: 'fp' | 'chase') {
    this.camLabel.textContent = mode === 'fp' ? 'İç açı (FP)' : 'Takip kamerası';
  }

  setWrongWay(on: boolean) {
    const el = document.getElementById('wrongway-banner');
    if (!el) return;
    el.classList.toggle('visible', on);
  }

  /** Show/hide Kalibrasyonu kaydet affordance during session (optional). */
  setCalibSaveVisible(visible: boolean) {
    const btn = document.getElementById('btn-calib-save') as HTMLButtonElement | null;
    if (!btn) return;
    btn.classList.toggle('hidden', !visible);
    btn.disabled = !visible;
  }

  pushAlerts(alerts: LiveAlert[]) {
    for (const a of alerts) {
      const el = document.createElement('div');
      el.className = `toast ${a.kind === 'warn' ? '' : a.kind}`;
      el.textContent = a.message;
      this.alertsEl.prepend(el);
      const tid = window.setTimeout(() => el.remove(), 3500);
      this.toastTimers.push(tid);
      while (this.alertsEl.children.length > 5) {
        this.alertsEl.lastElementChild?.remove();
      }
    }
  }

  info(message: string) {
    this.pushAlerts([{ id: 'info-' + Math.random(), message, kind: 'info' }]);
  }

  baselineReady() {
    this.pushAlerts([
      {
        id: 'baseline',
        message:
          'Kişisel baseline hazır — temizse “Kalibrasyonu kaydet”; değerlendirmede stil sapmaları yalnızca bilgi',
        kind: 'baseline',
      },
    ]);
  }
}

/** Render profile list panel contents. */
export function renderProfileList(
  container: HTMLElement,
  profiles: DriverProfile[],
  activeId: string | null,
  handlers: {
    onSelect: (id: string | null) => void;
    onDelete: (id: string) => void;
    onCreate: (name: string) => void;
    onShowKarne: (id: string) => void;
    onClose: () => void;
  }
) {
  container.innerHTML = `
    <div class="overlay-header">
      <h2>Sürücü Profilleri</h2>
      <button type="button" class="btn ghost" data-act="close">Kapat</button>
    </div>
    <p class="muted">
      <strong>Eğitim / Kalibrasyon</strong> (profil yok): kişisel baseline yalnızca temiz oturumda yazılır.
      <strong>Profil değerlendirme</strong>: Safety Floor her zaman açık; stil sapmaları yalnızca bilgi.
    </p>
    <div class="profile-actions-row">
      <button type="button" class="btn" data-act="guest">Eğitim / Kalibrasyon (profil yok)</button>
    </div>
    <ul class="profile-list">
      ${profiles
        .map(
          (p) => `
        <li class="profile-item ${p.id === activeId ? 'active' : ''}">
          <div class="profile-main">
            <div class="profile-name">${escapeHtml(p.name)}</div>
            <div class="profile-meta">Karne ${letterGrade(p.karne.overall)} · ${p.karne.overall} · ${p.karne.sessions} oturum · ${p.calibrated || p.baseline.ready ? 'kalibrasyonlu' : 'kalibrasyonsuz'}</div>
          </div>
          <div class="profile-btns">
            <button type="button" class="btn small" data-act="select" data-id="${p.id}">Seç</button>
            <button type="button" class="btn small ghost" data-act="karne" data-id="${p.id}">Karne</button>
            <button type="button" class="btn small danger" data-act="del" data-id="${p.id}">Sil</button>
          </div>
        </li>`
        )
        .join('') || '<li class="muted">Henüz profil yok.</li>'}
    </ul>
    <form class="create-form" data-act="create-form">
      <p class="muted" style="margin:12px 0 6px">Yeni profil — kalibrasyon zorunlu değil; stil kaydı isteğe bağlıdır.</p>
      <label>Yeni profil adı
        <input type="text" name="name" maxlength="24" placeholder="Profil adı" required />
      </label>
      <button type="submit" class="btn">Yeni profil oluştur</button>
    </form>
  `;

  container.querySelector('[data-act="close"]')?.addEventListener('click', handlers.onClose);
  container.querySelector('[data-act="guest"]')?.addEventListener('click', () => {
    handlers.onSelect(null);
    handlers.onClose();
  });
  container.querySelectorAll('[data-act="select"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      handlers.onSelect((btn as HTMLElement).dataset.id!);
      handlers.onClose();
    });
  });
  container.querySelectorAll('[data-act="karne"]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onShowKarne((btn as HTMLElement).dataset.id!));
  });
  container.querySelectorAll('[data-act="del"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      const p = profiles.find((x) => x.id === id);
      if (p && confirm(`“${p.name}” profilini silmek istiyor musunuz?`)) handlers.onDelete(id);
    });
  });
  const form = container.querySelector('form') as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (name) {
      handlers.onCreate(name);
      handlers.onClose();
    }
  });
}

function karneBarTone(score: number): string {
  if (score >= 80) return '#5dff9a';
  if (score >= 55) return '#f0d060';
  return '#ff8080';
}

export function renderKarneCard(container: HTMLElement, profile: DriverProfile, onClose: () => void) {
  const k = profile.karne;
  const grade = letterGrade(k.overall);
  const cats = (Object.keys(k.categories) as (keyof typeof k.categories)[])
    .map((key) => {
      const val = k.categories[key];
      const meta = AXIS_TR[key] || { title: key, tip: '' };
      return `
      <div class="karne-bar-row" title="${meta.tip}">
        <div class="karne-bar-label">
          <strong>${meta.title}</strong>
          <span class="karne-tip">${meta.tip}</span>
        </div>
        <div class="karne-bar-track"><div class="karne-bar-fill" style="width:${val}%;background:${karneBarTone(val)}"></div></div>
        <div class="karne-bar-val" style="color:${karneBarTone(val)}">${val}<small>%</small></div>
      </div>`;
    })
    .join('');

  const hist = [...k.history].reverse().slice(0, 8);
  const spark =
    k.history.length > 1
      ? buildSparkline(k.history.map((h) => h.overall))
      : '<div class="muted">Henüz trend yok — birkaç oturum sonrası çizilir</div>';

  const histList = hist
    .map((h) => {
      const d = new Date(h.at);
      const label = d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
      const sign = h.delta >= 0 ? `+${h.delta}` : `${h.delta}`;
      return `<li><span>${label}</span><span>${h.overall} <em class="${h.delta >= 0 ? 'up' : 'down'}">${sign}</em></span></li>`;
    })
    .join('');

  const meaning =
    k.overall >= 80
      ? 'İyi: güvenlik ve kural uyumu güçlü.'
      : k.overall >= 55
        ? 'Orta: Safety Floor ve pürüzsüzlüğe dikkat.'
        : 'Zayıf: sık ihlal / çarpışma — kalibrasyon eğitimi önerilir.';

  const styleInfo =
    k.lastStyleAdherence != null
      ? `<p class="muted">Son stil uyumu (bilgi): ${k.lastStyleAdherence}/100 — güvenlik puanını şişirmez.</p>`
      : '';

  container.innerHTML = `
    <div class="karne-card">
      <div class="overlay-header">
        <h2>Sürücü Karnesi</h2>
        <button type="button" class="btn ghost" data-act="close">Kapat</button>
      </div>
      <div class="karne-hero">
        <div class="karne-grade grade-${grade}" title="Harf notu ${grade}"><span class="karne-grade-letter">${grade}</span></div>
        <div class="karne-hero-text">
          <div class="karne-name">${escapeHtml(profile.name)}</div>
          <div class="karne-score">${k.overall}<span>/100</span></div>
          <div class="karne-sessions">${k.sessions} oturum · ${profile.calibrated || profile.baseline.ready ? 'kalibrasyonlu' : 'kalibrasyon yok'}</div>
          <p class="karne-meaning">${meaning}</p>
          ${styleInfo}
        </div>
        <div class="karne-spark">${spark}</div>
      </div>
      <h3>5 eksen (Safety Floor ağırlıklı)</h3>
      <div class="karne-bars">${cats}</div>
      <h3>Son oturumlar (puan değişimi)</h3>
      <ul class="karne-history">${histList || '<li class="muted">Henüz oturum yok</li>'}</ul>
      <div class="karne-disclaimer">
        <strong>Önemli:</strong> Eğitim notudur; ehliyet değildir.
        Tarama / dikkat skorları Space ve klavye idle’dan gelen <em>davranışsal proxy</em>’dir — eye-tracking değildir.
        Karne EWMA (~80/20) ile yavaş güncellenir; baseline yalnızca temiz kalibrasyonda yazılır.
      </div>
    </div>
  `;
  container.querySelector('[data-act="close"]')?.addEventListener('click', onClose);
}

function buildSparkline(values: number[]): string {
  const w = 168;
  const h = 52;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const span = Math.max(1, max - min);
  const coords = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * (w - 8) + 4;
    const y = h - 6 - ((v - min) / span) * (h - 14);
    return { x, y, v };
  });
  const line = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const area = `4,${h - 4} ${line} ${w - 4},${h - 4}`;
  const dots = coords
    .map(
      (c) =>
        `<circle cx="${c.x}" cy="${c.y}" r="2.4" fill="#5dff9a" stroke="#0a1018" stroke-width="1"/>`
    )
    .join('');
  const last = coords[coords.length - 1];
  const label = last
    ? `<text x="${last.x - 2}" y="${last.y - 6}" fill="#8dffb8" font-size="9" text-anchor="end">${Math.round(last.v)}</text>`
    : '';
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="spark-svg" aria-label="Karne trend">
    <polygon points="${area}" fill="rgba(93,255,154,0.12)"/>
    <polyline fill="none" stroke="#5dff9a" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${line}"/>
    ${dots}${label}
  </svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}
