# Sürüş Scan Coach (Surus-Scan-Coach)

Browser-based lightweight driving coach MVP — **not** an ETS2 clone. Arcade city block, first-person cockpit, driver profiles + **Sürücü Karnesi**.

Tarayıcı tabanlı hafif sürüş koçu. Küçük şehir bloğu, iç açı kamera, sürücü profilleri ve kalıcı karne.

## How to run / Çalıştırma

```bash
cd Surus-Scan-Coach
npm install
npm start
# or: npm run dev
```

Local (Vite base `/scan-coach/`): open **http://localhost:5173/scan-coach/**  
(Vite may redirect `/` → `/scan-coach/`).

Public (CaYaDev proxy → PC `127.0.0.1:5173`): **https://app.cayadev.com/scan-coach/**  
Requires Vite (`npm start`) running on the PC on port 5173.
**Public URL stuck on old `/src/...` 404s?** CaYaDev may cache Vite module responses.
Restart **CaYaTunnelClient** (system tray / Task Manager), then in the project folder stop and re-run `npm start`.
Prefer `npm start` (Vite dev) for the public slug — `assets/` is a reserved CaYaDev path, so `npm run preview` dist assets may not proxy correctly.


```bash
npm run build
npm run preview
# preview also serves under /scan-coach/ on 127.0.0.1:5173
```

## Controls / Kontroller

| Key | Action |
|-----|--------|
| **W / ↑** | Gaz |
| **S / ↓** | Fren / geri |
| **A·D / ←·→** | Direksiyon |
| **Space** | Ayna/omuz **proxy** |
| **C** | Kamera: iç açı ↔ takip |
| **R** | Araç sıfırla |
| **Profiller** | Profil oluştur / seç / sil |
| **Sürücü Karnesi** | Kalıcı not kartı |
| **Oturumu Bitir** | Rapor (+ karnene etki) |

## World / Dünya

Main corridor along Z + **cross streets** (sokak araları) at several Z intervals — intersections, dual-lane asphalt, sidewalks, low-poly buildings, lamps, speed signs. Drive onto cross streets; soft bounds keep you near the road network.

## Camera / Kamera

Default **iç açı (first-person cockpit)**. Exterior body hidden; simple dashboard / windshield frame shown. Toggle chase cam with **C** or HUD button (preference in `localStorage`).

## Profiles & Karne / Profiller

1. First sessions can be **eğitim** (no profile) — learn controls, build ~60s personal baseline.
2. Create / select / delete profiles (`localStorage`: `surus-profiles-v1`).
3. With a profile selected, deviations from stored baseline alert live; session end updates **Sürücü Karnesi** (overall, categories, history).
4. Eğitim report can offer “Bu stile göre profil oluştur”.

## Metrics / Metrikler

~16 rule-based scores (0–100): speed limit/stability, hard events, jerk, steering, reverse, throttle–brake, wrong way, off-road, collisions, waypoints, route deviation, mirror/attention **proxies**.

## Proxy disclaimer

**Mirror / shoulder** = Space timing only — not eye-tracking. **Attention** = keyboard idle — not clinical. Educational prototype only.

## Stack

Vite + TypeScript + Three.js.

## Layout

```
src/
  main.ts camera.ts car.ts world.ts input.ts
  waypoints.ts telemetry.ts metrics.ts
  profiles.ts hud.ts report.ts style.css
```
