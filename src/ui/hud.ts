import { CATALOG, CATALOG_ORDER } from '../sim/catalog';
import { PARCEL_INFO, SimEngine } from '../sim/engine';
import {
  BuildingCategory,
  BuildingId,
  BuildingInstance,
  OverlayMode,
} from '../sim/types';

export interface HudCallbacks {
  onSelectTool: (tool: BuildingId | null) => void;
  onToggleBulldoze: () => void;
  onTogglePilings: () => void;
  onRotate: () => void;
  onStartNew: (showcase: boolean) => void;
  onLoadSave: () => void;
  onSaveGame: () => void;
  onExportSave: () => void;
  onToggleMute: () => void;
  onFocusFounders: () => void;
  onFocusStadium: () => void;
  onFocusParcel: (parcelIdx: number) => void;
  onSnapIso: () => void;
  onSetSky: (skyTick: number) => void;
  onToggleBrightNight: () => boolean;
  onCapturePostcard: (framed: boolean) => void;
  onSelectBuilding: (id: number | null) => void;
}

const CATEGORIES: { id: BuildingCategory; label: string }[] = [
  { id: 'paths', label: 'Paths & Bridges' },
  { id: 'academics', label: 'Core Campus' },
  { id: 'colleges', label: 'Colleges (12)' },
  { id: 'life', label: 'Campus Life' },
  { id: 'venues', label: 'Venues' },
  { id: 'town', label: 'College Town' },
  { id: 'defense', label: 'Swamp & Power' },
  { id: 'athletics', label: 'Athletics' },
  { id: 'nature', label: 'Nature' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}k`;
  return `${sign}$${Math.round(a)}`;
}

export class HudController {
  private root: HTMLElement;
  private sim: SimEngine;
  private cb: HudCallbacks;

  showTitle = true;
  activeCat: BuildingCategory = 'academics';
  selectedTool: BuildingId | null = null;
  bulldozeMode = false;
  pilingsMode = false;
  selectedBuildingId: number | null = null;
  openPopover: 'none' | 'overlays' | 'director' | 'almanac' | 'land' = 'none';
  photoMode = false;
  photoFramed = true;
  brightNight = true;
  muted = false;
  dismissedReportName = '';
  hasSavedGame = false;

  // Cursor hint element updated directly on mousemove (zero full DOM rebuilds)
  private hintEl: HTMLDivElement;
  private lastHudHash = '';

  constructor(root: HTMLElement, sim: SimEngine, cb: HudCallbacks) {
    this.root = root;
    this.sim = sim;
    this.cb = cb;

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'cursor-hint';
    this.hintEl.style.display = 'none';
    document.body.appendChild(this.hintEl);

    this.hasSavedGame = Boolean(this.safeGetSave());
    this.render(true);
  }

  private safeGetSave(): string | null {
    try {
      return localStorage.getItem('bayou_state_2d_save');
    } catch {
      return null;
    }
  }

  setCursorHint(visible: boolean, x: number, y: number, title: string, warning?: string): void {
    if (!visible || this.showTitle) {
      this.hintEl.style.display = 'none';
      return;
    }
    this.hintEl.style.display = 'block';
    this.hintEl.style.left = `${Math.min(window.innerWidth - 265, x + 16)}px`;
    this.hintEl.style.top = `${Math.max(60, y - 14)}px`;
    this.hintEl.innerHTML = `${title}${warning ? `<span class="warn-txt">${warning}</span>` : ''}`;
  }

  render(force = false): void {
    const s = this.sim.state;
    const activeGoal = s.goals[s.activeGoalIdx];
    const selB = this.selectedBuildingId !== null ? s.buildings[this.selectedBuildingId] : null;
    const hash = [
      this.showTitle,
      this.activeCat,
      this.selectedTool,
      this.bulldozeMode,
      this.pilingsMode,
      this.selectedBuildingId,
      selB?.tier,
      selB?.pilings,
      selB?.flooded,
      selB?.powered,
      selB?.hp,
      this.openPopover,
      this.photoMode,
      this.photoFramed,
      this.brightNight,
      this.muted,
      s.economy.cash,
      s.economy.students,
      s.economy.prestige,
      s.economy.happiness,
      s.economy.ecology,
      s.economy.campusLevel,
      s.economy.xp,
      s.economy.collegesFounded,
      s.economy.activePrograms,
      s.collegeTownUnlocked,
      s.ownedParcels.filter(Boolean).length,
      s.levelUpToast?.level,
      s.day,
      s.skyPhase,
      s.speed,
      s.overlay,
      s.storm.active,
      s.storm.phase,
      Math.round(s.storm.currentSurgeFt * 10),
      s.storm.lastReport?.name,
      this.dismissedReportName,
      s.football.active,
      s.football.quarter,
      s.football.homeScore,
      s.football.awayScore,
      s.football.playLog[0]?.text,
      s.parade.active,
      Math.floor(s.parade.tick / 10),
      s.activeDilemma?.id,
      s.mosquitoIndex,
      s.gatorRelocations,
      s.nutriaBurrows,
      s.stormInsurance,
      s.activeToast?.id,
      s.activeToast ? Math.floor(s.activeToast.ticksLeft / 5) : 0,
      activeGoal?.id,
      activeGoal?.progressText,
      activeGoal?.buildHint,
      activeGoal?.steps?.map((st) => (st.done ? '1' : '0')).join(''),
      s.ticker[0]?.id,
    ].join('|');

    if (!force && hash === this.lastHudHash) return;
    this.lastHudHash = hash;

    const eco = s.economy;
    const nextLvlXp = eco.campusLevel * eco.campusLevel * 55;
    const curLvlXp = (eco.campusLevel - 1) * (eco.campusLevel - 1) * 55;
    const xpPct = Math.max(0, Math.min(100, Math.round(((eco.xp - curLvlXp) / Math.max(1, nextLvlXp - curLvlXp)) * 100)));

    // Dedicated Postcard Photo Mode (clean 100% 3D viewport + floating postcard studio bar!)
    if (this.photoMode && !this.showTitle) {
      this.root.innerHTML = `
        ${
          this.photoFramed
            ? `<div class="postcard-frame-preview">
                 <div class="postcard-caption">
                   <span>GREETINGS FROM BAYOU STATE UNIVERSITY</span>
                   <small>Year ${s.year} · ${eco.students.toLocaleString()} Students · Prestige ${eco.prestige} · Campus Lv.${eco.campusLevel}</small>
                 </div>
               </div>`
            : ''
        }
        <div class="photo-bar">
          <span class="photo-title">📸 Postcard Studio</span>
          <label class="photo-slider">
            <span>Sky</span>
            <input type="range" min="0" max="299" value="${Math.round(s.skyTick)}" id="photo-sky-range" />
          </label>
          <button class="pill-tonal" data-act="photo-frame">${this.photoFramed ? '🖼️ Postcard Frame: ON' : '🖼️ Clean Frame'}</button>
          <button class="pill-cta" data-act="photo-snap">⬇ Download PNG</button>
          <button class="pill-tonal" data-act="photo-exit">Exit (Esc)</button>
        </div>
      `;
      const slider = this.root.querySelector<HTMLInputElement>('#photo-sky-range');
      if (slider) {
        slider.oninput = () => this.cb.onSetSky(Number(slider.value));
      }
      this.bindClicks();
      return;
    }

    const skyIcon =
      s.storm.active
        ? '🌀'
        : s.rainRate > 0.1
          ? '🌧️'
          : s.skyPhase === 'night'
            ? '🌙'
            : s.skyPhase === 'golden' || s.skyPhase === 'dusk'
              ? '🌅'
              : '☀️';

    const overlayNames = ['None', 'Flood Risk', 'Elevation', 'Power Grid', 'Ecology', 'Mosquitoes'];
    const parts: string[] = [];

    // 1. TOP APP BAR
    parts.push(`
      <div class="app-bar">
        <div class="brand-badge">
          <span class="brand-dot">B</span>
          BAYOU STATE 2D
        </div>
        <div class="stat-strip">
          <button class="stat-chip ${eco.cash < 250_000 ? 'warn' : ''}" data-act="pop" data-v="almanac" title="Open Campus Almanac & Budget (Net/mo: ${fmtMoney(eco.monthlyIncome - eco.monthlyExpense)})">
            <span class="s-icon">💰</span>
            <span class="s-val">${fmtMoney(eco.cash)}</span>
          </button>
          <button class="stat-chip" data-act="pop" data-v="almanac" title="Enrolled Students (Beds: ${eco.capacity.beds} · Seats: ${eco.capacity.seats})">
            <span class="s-icon">🎓</span>
            <span class="s-val">${eco.students.toLocaleString()}</span>
            <span class="s-lbl">Students</span>
          </button>
          <div class="stat-chip" title="University Prestige (0-100)">
            <span class="s-icon">⭐</span>
            <span class="s-val">${eco.prestige}</span>
          </div>
          <div class="stat-chip" title="Student Happiness (0-100)">
            <span class="s-icon">😊</span>
            <span class="s-val">${eco.happiness}</span>
          </div>
          <div class="stat-chip" title="Bayou Ecology Score (0-100)">
            <span class="s-icon">🌿</span>
            <span class="s-val">${eco.ecology}</span>
          </div>
          <button class="stat-chip level-chip" data-act="pop" data-v="almanac" title="Campus Level ${eco.campusLevel} (${xpPct}% to Lv.${eco.campusLevel + 1}) · College Town unlocks at Lv.10">
            <span class="s-icon">🏛️</span>
            <div class="lvl-stack">
              <span class="s-val">Lv.${eco.campusLevel}</span>
              <span class="lvl-xp-track"><span class="lvl-xp-fill" style="width:${xpPct}%"></span></span>
            </div>
          </button>
        </div>
        <div class="spacer"></div>
        <div class="date-chip" title="Calendar & Sky Phase">
          <span>${skyIcon}</span>
          <span>${MONTHS[(s.month - 1) % 12]} ${s.dom}, Y${s.year}</span>
        </div>
        <div class="speed-group">
          <button class="speed-btn ${s.speed === 0 ? 'active' : ''}" data-act="speed" data-v="0" title="Pause (Space)">⏸</button>
          <button class="speed-btn ${s.speed === 1 ? 'active' : ''}" data-act="speed" data-v="1">1×</button>
          <button class="speed-btn ${s.speed === 2 ? 'active' : ''}" data-act="speed" data-v="2">2×</button>
          <button class="speed-btn ${s.speed === 4 ? 'active' : ''}" data-act="speed" data-v="4">4×</button>
        </div>
        <button class="bar-btn ${this.openPopover === 'land' ? 'active' : ''}" data-act="pop" data-v="land" title="Land Office — Buy State Land Expansion Parcels">
          📜 Land
        </button>
        <button class="bar-btn ${s.overlay !== OverlayMode.None || this.openPopover === 'overlays' ? 'active' : ''}" data-act="pop" data-v="overlays" title="Map Overlays (F = Flood Risk)">
          🗺️ ${s.overlay === OverlayMode.None ? 'Layers' : overlayNames[s.overlay]}
        </button>
        <button class="bar-btn" data-act="photo-enter" title="Postcard Photo Mode (C) — Snap & Download a Campus Postcard">
          📸
        </button>
        <button class="bar-btn gold" data-act="pop" data-v="director" title="Trigger Night Games, Hurricanes, Mardi Gras, Time of Day & Camera Views">
          🎬 Director
        </button>
        <button class="bar-btn" data-act="mute" title="Toggle Audio">
          ${this.muted ? '🔇' : '🔊'}
        </button>
      </div>
    `);

    if (!this.showTitle) {
      // 2. GOAL CARD (Top-Left) — shows live multi-step checklist & dynamically advances the Build CTA!
      if (activeGoal && !s.goals.every((g) => g.completed)) {
        const stepsHtml =
          activeGoal.steps && activeGoal.steps.length > 1
            ? `<div class="goal-steps">
                 ${activeGoal.steps
                   .map((st, idx) => {
                     const isCurrent = !st.done && activeGoal.steps!.findIndex((x) => !x.done) === idx;
                     return `<div class="goal-step ${st.done ? 'done' : isCurrent ? 'current' : ''}">
                               <span class="gs-dot">${st.done ? '✓' : idx + 1}</span>
                               <span>${st.label}</span>
                             </div>`;
                   })
                   .join('')}
               </div>`
            : '';

        const ctaHtml = activeGoal.buildHint
          ? `<button class="pill-cta" data-act="goal-build" data-v="${activeGoal.buildHint}">Build: ${CATALOG[activeGoal.buildHint].shortName}</button>`
          : activeGoal.id === 'cauldron'
            ? s.buildings.some((b) => b && b.type === 'stadium' && b.tier >= 1)
              ? `<button class="pill-cta" data-act="night-game">🏈 Launch Night Game!</button>`
              : `<button class="pill-cta" data-act="cam-stadium">🏟️ Inspect Stadium</button>`
            : '';

        parts.push(`
          <div class="goal-card">
            <div class="goal-kicker">
              <span>GOAL ${s.activeGoalIdx + 1} OF ${s.goals.length}</span>
              <span>+${fmtMoney(activeGoal.rewardCash)}</span>
            </div>
            <div class="goal-title">${activeGoal.title}</div>
            ${stepsHtml || `<div class="goal-sub">${activeGoal.subtitle}</div>`}
            <div class="goal-bar-track">
              <div class="goal-bar-fill" style="width:${Math.round(activeGoal.progressFrac * 100)}%"></div>
            </div>
            <div class="goal-actions">
              <span style="font-size:11.5px;font-weight:700;color:var(--on-surface-variant)">${activeGoal.progressText}</span>
              ${ctaHtml}
            </div>
          </div>
        `);
      }

      // 3. OVERLAYS OR DIRECTOR POPOVER
      if (this.openPopover === 'overlays') {
        parts.push(`
          <div class="popover">
            <h3>3D Terrain Overlays</h3>
            <div class="pop-grid">
              <button class="pop-btn ${s.overlay === OverlayMode.None ? 'active' : ''}" data-act="overlay" data-v="0">None</button>
              <button class="pop-btn ${s.overlay === OverlayMode.FloodRisk ? 'active' : ''}" data-act="overlay" data-v="1">🌊 Flood Risk (F)</button>
              <button class="pop-btn ${s.overlay === OverlayMode.Elevation ? 'active' : ''}" data-act="overlay" data-v="2">⛰️ Elevation</button>
              <button class="pop-btn ${s.overlay === OverlayMode.Utilities ? 'active' : ''}" data-act="overlay" data-v="3">⚡ Power Grid</button>
              <button class="pop-btn ${s.overlay === OverlayMode.Ecology ? 'active' : ''}" data-act="overlay" data-v="4">🌿 Ecology</button>
              <button class="pop-btn ${s.overlay === OverlayMode.Mosquito ? 'active' : ''}" data-act="overlay" data-v="5">🦟 Mosquitoes</button>
            </div>
            <div style="font-size:11.5px;color:var(--on-surface-variant);line-height:1.4">
              Flood Risk shows 5-ft surge exposure in <strong style="color:#c9303e">red/orange</strong> and levee-protected basins in <strong style="color:#1b6d3f">emerald</strong> (${s.protectedCount} protected). Campus Mosquito Index: <strong>${s.mosquitoIndex}%</strong>.
            </div>
          </div>
        `);
      } else if (this.openPopover === 'land') {
        const ownedCnt = s.ownedParcels.filter(Boolean).length;
        parts.push(`
          <div class="popover" style="width:335px">
            <h3>📜 State Land Office (${ownedCnt} / 16 Parcels)</h3>
            <div style="font-size:11.5px;color:var(--on-surface-variant);margin-bottom:8px">
              Expand your university charter across the Bayou, Western Cheniers, and Northgate Town District.
            </div>
            <div class="parcel-grid">
              ${PARCEL_INFO.map((p, idx) => {
                const owned = s.ownedParcels[idx];
                return `
                  <button class="parcel-cell ${owned ? 'owned' : ''}" data-act="parcel" data-v="${idx}" title="${p.name}">
                    <span class="p-name">${p.name}</span>
                    <span class="p-price">${owned ? '✓ Owned' : fmtMoney(p.price)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `);
      } else if (this.openPopover === 'almanac') {
        const bd = eco.breakdown;
        const net = eco.monthlyIncome - eco.monthlyExpense;
        const nextLvlXp = eco.campusLevel * eco.campusLevel * 55;
        const curLvlXp = (eco.campusLevel - 1) * (eco.campusLevel - 1) * 55;
        const xpPct = Math.max(0, Math.min(100, Math.round(((eco.xp - curLvlXp) / Math.max(1, nextLvlXp - curLvlXp)) * 100)));
        parts.push(`
          <div class="popover" style="width:320px">
            <h3>🏛️ Campus Almanac · Level ${eco.campusLevel}</h3>
            <div class="goal-bar-track" style="margin-bottom:6px">
              <div class="goal-bar-fill" style="width:${xpPct}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--on-surface-variant);margin-bottom:10px">
              <span><strong>${eco.collegesFounded} / 15</strong> Academic Units</span>
              <span><strong>${eco.activePrograms}</strong> Degree Programs</span>
            </div>
            <h3>Capacity &amp; Enrollment</h3>
            <div class="almanac-rows">
              <div><span>Beds</span><strong>${eco.capacity.beds.toLocaleString()}</strong></div>
              <div><span>Classroom Seats</span><strong>${eco.capacity.seats.toLocaleString()}</strong></div>
              <div><span>Dining Capacity</span><strong>${eco.capacity.dining.toLocaleString()}</strong></div>
              <div><span>Football Record</span><strong>${eco.wins}–${eco.losses} (Rtg ${eco.teamRating})</strong></div>
            </div>
            <h3 style="margin-top:10px">Swamp &amp; Wildlife Ops</h3>
            <div class="almanac-rows">
              <div><span>Mosquito Index</span><strong>${s.mosquitoIndex}%</strong></div>
              <div><span>Gators Relocated</span><strong>${s.gatorRelocations}</strong></div>
              <div><span>Nutria Burrows</span><strong>${s.nutriaBurrows}</strong></div>
              <div><span>Storm Insurance</span><strong>${s.stormInsurance ? 'Active (50% off)' : 'None'}</strong></div>
            </div>
            <h3 style="margin-top:10px">Monthly Ledger (${net >= 0 ? '+' : ''}${fmtMoney(net)}/mo)</h3>
            <div class="almanac-rows">
              <div><span>Tuition</span><strong style="color:var(--success)">+${fmtMoney(bd.tuition)}</strong></div>
              <div><span>State &amp; Alumni</span><strong style="color:var(--success)">+${fmtMoney(bd.state + bd.alumni)}</strong></div>
              <div><span>Research Grants</span><strong style="color:var(--success)">+${fmtMoney(bd.research)}</strong></div>
              <div><span>Venues &amp; Parking</span><strong style="color:var(--success)">+${fmtMoney(bd.venues)}</strong></div>
              <div><span>Upkeep &amp; Faculty</span><strong style="color:var(--danger)">-${fmtMoney(bd.upkeep + bd.staff)}</strong></div>
            </div>
          </div>
        `);
      } else if (this.openPopover === 'director') {
        parts.push(`
          <div class="popover">
            <h3>🎬 Spectacle &amp; Director</h3>
            <div class="pop-grid">
              <button class="pop-btn purple full" data-act="night-game">🏈 Launch Saturday Night Game!</button>
              <button class="pop-btn full" style="background:linear-gradient(90deg,#ede2ff,#fff2cc,#dcf4e5);color:#22094a;font-weight:700" data-act="mardi-gras">🎭 Launch Mardi Gras Parade!</button>
              <button class="pop-btn full" data-act="dilemma">⚖️ Board of Regents / Student Card</button>
              <button class="pop-btn danger full" data-act="hurricane" data-v="3">🌀 Trigger Cat 3 Hurricane Surge</button>
              <button class="pop-btn danger full" data-act="hurricane" data-v="4">⛈️ Trigger Cat 4 Monster Storm</button>
              <button class="pop-btn full" data-act="repair-levees">🔧 Repair All Levees</button>
            </div>
            <h3>Time of Day &amp; Night Visibility</h3>
            <div class="pop-grid">
              <button class="pop-btn" data-act="sky" data-v="75">☀️ High Noon</button>
              <button class="pop-btn" data-act="sky" data-v="162">🌅 Golden Hour</button>
              <button class="pop-btn" data-act="sky" data-v="240">🌙 Bayou Night</button>
              <button class="pop-btn ${this.brightNight ? 'active' : ''}" data-act="bright-night">💡 Night: ${this.brightNight ? 'Bright' : 'Dim'}</button>
              <button class="pop-btn" data-act="cam-founders">🏛️ Founders'</button>
              <button class="pop-btn" data-act="cam-stadium">🏟️ Stadium</button>
            </div>
            <h3>Campus Save &amp; Showcase</h3>
            <div class="pop-grid">
              <button class="pop-btn" data-act="save">💾 Save Local</button>
              <button class="pop-btn" data-act="export">📤 Export JSON</button>
              <button class="pop-btn" data-act="cam-iso">📐 Iso Snap</button>
              <button class="pop-btn" data-act="pop" data-v="almanac">📊 Almanac</button>
              <button class="pop-btn full" data-act="new-showcase">✨ Load Flagship Campus</button>
              <button class="pop-btn full" data-act="new-charter">🌱 Start Fresh Charter</button>
            </div>
          </div>
        `);
      }

      // 4. ACTIVE SET PIECE BANNER: FOOTBALL SCOREBUG
      if (s.football.active) {
        const fg = s.football;
        const latest = fg.playLog[0];
        parts.push(`
          <div class="setpiece-banner">
            <div class="score-row">
              <div class="score-team">
                <span class="team-pip" style="background:#461d7c"></span>
                <span>BAYOU STATE</span>
                <span class="score-num">${fg.homeScore}</span>
              </div>
              <div style="text-align:center;font-size:11.5px;font-weight:700;color:var(--on-surface-variant)">
                <div>Q${fg.quarter} · ${fg.nightGame ? '🌙 NIGHT GAME' : '☀️ DAY GAME'}</div>
                <div>${fg.attendance.toLocaleString()} fans</div>
              </div>
              <div class="score-team">
                <span class="score-num" style="color:${fg.opponentColor}">${fg.awayScore}</span>
                <span>${fg.opponent.toUpperCase()}</span>
                <span class="team-pip" style="background:${fg.opponentColor}"></span>
              </div>
              <button class="pill-tonal" data-act="skip-setpiece">Skip ⏭</button>
            </div>
            ${latest ? `<div class="play-log"><strong>Q${latest.quarter} ${latest.clock}</strong> — ${latest.text}</div>` : ''}
          </div>
        `);
      } else if (s.storm.active) {
        // 5. ACTIVE SET PIECE BANNER: HURRICANE LANDFALL
        const st = s.storm;
        parts.push(`
          <div class="setpiece-banner storm-banner">
            <div class="storm-head">
              <span>🌀 HURRICANE ${st.name.toUpperCase()} · CATEGORY ${st.category}</span>
              <button class="pill-tonal" data-act="skip-setpiece">Skip ⏭</button>
            </div>
            <div class="storm-metrics">
              <span>Phase: <strong>${st.phase.toUpperCase()}</strong></span>
              <span>Surge: <strong>${st.currentSurgeFt.toFixed(1)} / ${st.targetSurgeFt.toFixed(1)} ft</strong></span>
              <span>Protected tiles: <strong>${s.protectedCount}</strong></span>
            </div>
          </div>
        `);
      } else if (s.parade.active) {
        // 5b. ACTIVE SET PIECE BANNER: MARDI GRAS PARADE!
        const pct = Math.min(100, Math.round((s.parade.tick / Math.max(1, s.parade.duration)) * 100));
        parts.push(`
          <div class="setpiece-banner parade-banner">
            <div class="storm-head" style="color:var(--primary)">
              <span>🎭 MARDI GRAS PARADE · LAISSEZ LES BONS TEMPS ROULER!</span>
              <button class="pill-tonal" data-act="skip-setpiece">Skip ⏭</button>
            </div>
            <div class="storm-metrics">
              <span>3 Floats Rolling</span>
              <span>Festival Gate: <strong>+${fmtMoney(s.parade.revenue)}</strong></span>
              <span>Route: <strong>${pct}%</strong></span>
            </div>
          </div>
        `);
      }

      // 6. INTERACTIVE DECISION TOAST
      if (s.activeToast) {
        const t = s.activeToast;
        const pct = Math.max(0, Math.round((t.ticksLeft / t.maxTicks) * 100));
        parts.push(`
          <div class="decision-toast">
            <div class="toast-title">${t.title}</div>
            <div class="toast-body">${t.body}</div>
            <div class="toast-actions">
              <button class="pill-tonal" data-act="toast-no">${t.noLabel}</button>
              <button class="pill-cta" data-act="toast-yes">${t.yesLabel}</button>
            </div>
            <div class="toast-timer"><div class="toast-timer-fill" style="width:${pct}%"></div></div>
          </div>
        `);
      }

      // 6b. LEVEL UP CELEBRATION BANNER
      if (s.levelUpToast) {
        parts.push(`
          <div class="levelup-banner">
            <strong>🏆 CAMPUS LEVEL ${s.levelUpToast.level}!</strong>
            <span>${
              s.levelUpToast.unlockedTown
                ? 'College Town District Unlocked — build Town Center, Beignet Café & Zydeco Hall!'
                : 'Your Bayou State flagship continues to rise!'
            }</span>
          </div>
        `);
      }

      // 7. INSPECT CARD
      if (selB) {
        parts.push(this.renderInspectCard(selB));
      }

      // 7b. OVERLAY COLOR LEGEND (when an overlay is active and popover closed)
      if (s.overlay !== OverlayMode.None && this.openPopover === 'none') {
        const legendHtml =
          s.overlay === OverlayMode.FloodRisk
            ? `<span><i class="legend-swatch" style="background:#e63946"></i>Surge Risk</span><span><i class="legend-swatch" style="background:#20d69a"></i>Levee Protected (${s.protectedCount})</span>`
            : s.overlay === OverlayMode.Elevation
              ? `<span><i class="legend-swatch" style="background:#d67a29"></i>Low Marsh</span><span><i class="legend-swatch" style="background:#3bb558"></i>High Ridge</span>`
              : s.overlay === OverlayMode.Utilities
                ? `<span><i class="legend-swatch" style="background:#f5c842"></i>Powered Grid Coverage</span>`
                : s.overlay === OverlayMode.Mosquito
                  ? `<span><i class="legend-swatch" style="background:#d92662"></i>Mosquito Hotspot</span><span><i class="legend-swatch" style="background:#28b878"></i>Low (${s.mosquitoIndex}% idx)</span>`
                  : `<span><i class="legend-swatch" style="background:#20e070"></i>Wetland Preserve</span><span><i class="legend-swatch" style="background:#3ba86b"></i>Marsh Belt</span>`;
        parts.push(`<div class="overlay-legend">${legendHtml}</div>`);
      }

      // 8. NEWS TICKER (Bottom-Right, hidden while a decision toast is open so they never collide)
      const recent = s.activeToast ? [] : s.ticker.slice(0, 3);
      if (recent.length > 0) {
        parts.push(`
          <div class="ticker-strip">
            ${recent.map((it) => `<div class="ticker-pill ${it.kind}">${it.text}</div>`).join('')}
          </div>
        `);
      }

      // 9. BOTTOM BUILD DOCK
      const items = CATALOG_ORDER.map((id) => CATALOG[id]).filter((d) => d.category === this.activeCat);
      const townLocked = this.activeCat === 'town' && !s.collegeTownUnlocked && s.economy.campusLevel < 10;
      parts.push(`
        <div class="build-dock">
          <div class="dock-top">
            <div class="cat-tabs">
              ${CATEGORIES.map(
                (c) =>
                  `<button class="cat-tab ${this.activeCat === c.id ? 'active' : ''}" data-act="cat" data-v="${c.id}">${
                    c.id === 'town' && !s.collegeTownUnlocked && s.economy.campusLevel < 10 ? '🔒 ' : ''
                  }${c.label}</button>`,
              ).join('')}
            </div>
            <div class="tool-mods">
              <button class="mod-btn ${this.pilingsMode ? 'active' : ''}" data-act="pilings" title="Elevate eligible buildings 3 ft on Pilings (+40% cost, flood-safe)">
                🪵 Pilings (P): ${this.pilingsMode ? 'ON' : 'OFF'}
              </button>
              <button class="mod-btn" data-act="rotate" title="Rotate Building Footprint (R)">↻ Rotate (R)</button>
              <button class="mod-btn danger ${this.bulldozeMode ? 'active' : ''}" data-act="bulldoze" title="Demolish / Clear Tile (X)">
                🚜 Bulldoze (X)
              </button>
            </div>
          </div>
          ${
            townLocked
              ? `<div class="town-lock-bar">
                   <span>🏘️ <strong>College Town</strong> unlocks at <strong>Campus Level 10</strong> (you are Lv.${s.economy.campusLevel} — build halls, upgrade venues &amp; complete goals to earn XP!).</span>
                   <button class="pill-cta" data-act="unlock-town">✨ Unlock Early (Sandbox)</button>
                 </div>`
              : `<div class="dock-items">
                  ${items
                    .map(
                      (d) => `
                    <button class="build-item ${this.selectedTool === d.id && !this.bulldozeMode ? 'selected' : ''}"
                            data-act="tool" data-v="${d.id}" title="${d.description}">
                      <div class="b-swatch" style="background:${d.accentColor}"></div>
                      <div class="b-name">${d.shortName}</div>
                      <div class="b-cost">${d.cost === 0 ? 'FREE' : fmtMoney(d.cost)}${d.drag ? ' / tile' : ''}</div>
                    </button>
                  `,
                    )
                    .join('')}
                </div>`
          }
        </div>
      `);

      // 10b. BOARD OF REGENTS / STUDENT VOICE DILEMMA CARD
      if (s.activeDilemma) {
        const d = s.activeDilemma;
        parts.push(`
          <div class="report-card dilemma-card">
            <div class="title-kicker" style="margin-bottom:8px">${d.source}</div>
            <h2>${d.title}</h2>
            <p style="font-size:13px;line-height:1.45;color:var(--on-surface-variant);margin:6px 0 16px">${d.body}</p>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${d.choices
                .map(
                  (c, idx) => `
                <button class="dilemma-choice" data-act="dilemma-pick" data-v="${idx}">
                  <strong>${c.label}</strong>
                  <span>${c.effectText}</span>
                </button>
              `,
                )
                .join('')}
            </div>
          </div>
        `);
      }

      // 10. POST-STORM REPORT MODAL
      if (s.storm.lastReport && s.storm.lastReport.name !== this.dismissedReportName && !s.storm.active) {
        const rep = s.storm.lastReport;
        parts.push(`
          <div class="report-card">
            <h2>${rep.held ? '🏆 Campus Held Dry!' : '🌊 Post-Storm Report'} — Hurricane ${rep.name}</h2>
            <div style="font-size:12.5px;color:var(--on-surface-variant)">
              Category ${rep.category} storm cleared after peaking at <strong>${rep.peakSurgeFt.toFixed(1)} ft</strong> surge.
            </div>
            <div class="report-stats">
              <div class="r-stat">Flooded Buildings<strong>${rep.floodedCount}</strong></div>
              <div class="r-stat">Levee-Protected Tiles<strong>${rep.protectedTiles}</strong></div>
              <div class="r-stat">Storm Cleanup<strong>${fmtMoney(rep.damageCost)}</strong></div>
              <div class="r-stat">Power Grid<strong>${rep.blackoutOccurred ? 'Blackout!' : 'Held Steady'}</strong></div>
            </div>
            <button class="hero-btn primary" style="width:100%" data-act="close-report">Continue Building</button>
          </div>
        `);
      }
    }

    // 11. TITLE SCREEN OVERLAY
    if (this.showTitle) {
      parts.push(`
        <div class="title-scrim">
          <div class="title-card">
            <div class="title-kicker">HD 2D Isometric Campus Simulation</div>
            <h1 class="title-wordmark">BAYOU STATE</h1>
            <div class="title-accent"></div>
            <div class="title-tagline">Build the campus. Beat the swamp. Fill the stadium.</div>
            <div class="title-desc">
              Charter a 1920s Italian Renaissance Revival university on a Louisiana natural-levee ridge in handcrafted
              <strong>HD 2D Isometric</strong> diorama art. Engineer levees, canals &amp; flood pilings against Gulf hurricanes — then pack
              <strong>The Cauldron</strong> for a roaring Saturday night game under the lights.
            </div>
            <div class="title-btns">
              <button class="hero-btn primary" data-act="start-showcase">✨ Explore Flagship 2D Campus (Instant Tour)</button>
              <button class="hero-btn gold" data-act="start-new">🏛️ Start New Charter from Scratch</button>
              ${this.hasSavedGame ? `<button class="hero-btn ghost" data-act="start-load">💾 Continue Saved Campus</button>` : ''}
            </div>
            <div class="controls-foot">
              <strong>Controls:</strong> WASD / Drag to Pan · Scroll to Zoom · <strong>F</strong> Flood Risk · <strong>P</strong> Pilings · <strong>C</strong> Postcard
            </div>
          </div>
        </div>
      `);
    }

    this.root.innerHTML = parts.join('');
    this.bindClicks();
  }

  private renderInspectCard(b: BuildingInstance): string {
    const def = CATALOG[b.type];
    const nextTier = def.maxTier && b.tier < def.maxTier ? b.tier + 1 : null;
    const upgradeCost = nextTier !== null ? def.tierCosts?.[nextTier] ?? 0 : 0;
    const upgradeName = nextTier !== null ? def.tierNames?.[nextTier] ?? 'Next Tier' : '';
    const canGame = (b.type === 'stadium' || (b.type === 'practice_field' && b.tier >= 1)) && b.built >= 1;

    return `
      <div class="inspect-card">
        <div class="inspect-head">
          <div>
            <div class="inspect-name">${b.name}</div>
            <div class="inspect-type">${def.name}${b.pilings ? ' · On 3-ft Pilings' : ''}</div>
          </div>
          <button class="close-x" data-act="close-inspect">✕</button>
        </div>
        <div class="badge-row">
          <span class="status-badge ${b.powered ? 'ok' : 'bad'}">${b.powered ? '⚡ Powered' : '⚡ No Power'}</span>
          <span class="status-badge ${b.watered ? 'ok' : 'bad'}">${b.watered ? '💧 Watered' : '💧 No Water'}</span>
          ${b.flooded ? `<span class="status-badge bad">🌊 Flooded!</span>` : `<span class="status-badge ok">Dry</span>`}
          ${b.hp < 0.99 ? `<span class="status-badge gold">HP ${Math.round(b.hp * 100)}%</span>` : ''}
          ${b.type === 'generator' ? `<span class="status-badge gold">Fuel: ${b.fuelDays}d</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--on-surface-variant);line-height:1.4">
          ${def.tierDesc?.[b.tier] ?? def.description}
        </div>
        ${
          def.programs && def.programs.length > 0
            ? `<div class="prog-section">
                 <div class="prog-head">Departments &amp; Programs (${def.programs.length})</div>
                 <div class="prog-tags">${def.programs.map((p) => `<span class="prog-tag">${p}</span>`).join('')}</div>
               </div>`
            : ''
        }
        <div class="inspect-actions">
          ${canGame ? `<button class="pill-cta" data-act="night-game">🏈 Play Home Game</button>` : ''}
          ${
            nextTier !== null
              ? `<button class="pill-cta" data-act="upgrade-b" data-v="${b.id}">⬆ ${upgradeName.split(' (')[0]} (${fmtMoney(upgradeCost)})</button>`
              : ''
          }
          ${
            def.canPilings && !b.pilings
              ? `<button class="pill-tonal" data-act="retrofit-b" data-v="${b.id}">🪵 Add Pilings (${fmtMoney(Math.round(def.cost * 0.4))})</button>`
              : ''
          }
          ${
            b.hp < 0.99
              ? `<button class="pill-tonal" data-act="repair-b" data-v="${b.id}">🔧 Repair</button>`
              : ''
          }
          ${
            b.type === 'generator'
              ? `<button class="pill-tonal" data-act="refuel-b" data-v="${b.id}">⛽ Refuel ($5k)</button>`
              : ''
          }
          ${
            b.type !== 'founders_hall'
              ? `<button class="pill-tonal" style="background:var(--danger-bg);color:var(--danger)" data-act="demolish-b" data-v="${b.id}">Demolish</button>`
              : ''
          }
        </div>
      </div>
    `;
  }

  private bindClicks(): void {
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('button[data-act]');
    buttons.forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const val = btn.dataset.v ?? '';

        switch (act) {
          case 'start-showcase':
            this.showTitle = false;
            this.cb.onStartNew(true);
            break;
          case 'start-new':
            this.showTitle = false;
            this.cb.onStartNew(false);
            break;
          case 'start-load':
            this.showTitle = false;
            this.cb.onLoadSave();
            break;
          case 'speed':
            this.sim.state.speed = Number(val) as 0 | 1 | 2 | 4;
            break;
          case 'pop':
            this.openPopover =
              this.openPopover === val ? 'none' : (val as 'overlays' | 'director' | 'almanac' | 'land');
            break;
          case 'parcel': {
            const pIdx = Number(val);
            if (this.sim.state.ownedParcels[pIdx]) {
              this.cb.onFocusParcel(pIdx);
              this.openPopover = 'none';
            } else {
              const r = this.sim.buyParcel(pIdx);
              if (r.ok) this.cb.onFocusParcel(pIdx);
              else if (r.reason) alert(r.reason);
            }
            break;
          }
          case 'unlock-town':
            this.sim.unlockCollegeTown();
            break;
          case 'photo-enter':
            this.photoMode = true;
            this.openPopover = 'none';
            this.selectedTool = null;
            this.bulldozeMode = false;
            this.cb.onSelectTool(null);
            break;
          case 'photo-exit':
            this.photoMode = false;
            break;
          case 'photo-frame':
            this.photoFramed = !this.photoFramed;
            break;
          case 'photo-snap':
            this.cb.onCapturePostcard(this.photoFramed);
            break;
          case 'bright-night':
            this.brightNight = this.cb.onToggleBrightNight();
            break;
          case 'overlay':
            this.sim.state.overlay = Number(val) as OverlayMode;
            this.sim.state.terrainDirty = true;
            this.openPopover = 'none';
            break;
          case 'mute':
            this.cb.onToggleMute();
            break;
          case 'cat':
            this.activeCat = val as BuildingCategory;
            break;
          case 'tool': {
            const id = val as BuildingId;
            this.bulldozeMode = false;
            this.selectedTool = this.selectedTool === id ? null : id;
            this.cb.onSelectTool(this.selectedTool);
            break;
          }
          case 'goal-build': {
            const id = val as BuildingId;
            this.activeCat = CATALOG[id].category;
            this.bulldozeMode = false;
            this.selectedTool = id;
            this.cb.onSelectTool(id);
            break;
          }
          case 'pilings':
            this.cb.onTogglePilings();
            break;
          case 'rotate':
            this.cb.onRotate();
            break;
          case 'bulldoze':
            this.cb.onToggleBulldoze();
            break;
          case 'night-game': {
            this.openPopover = 'none';
            const res = this.sim.triggerHomeGame(true);
            if (res.ok) this.cb.onFocusStadium();
            else alert(res.reason);
            break;
          }
          case 'hurricane':
            this.openPopover = 'none';
            this.sim.triggerHurricane(Number(val) || 3);
            break;
          case 'mardi-gras':
            this.openPopover = 'none';
            this.sim.triggerMardiGras();
            this.cb.onFocusFounders();
            break;
          case 'dilemma':
            this.openPopover = 'none';
            this.sim.triggerDilemma();
            break;
          case 'dilemma-pick':
            this.sim.resolveDilemma(Number(val));
            break;
          case 'repair-levees':
            this.openPopover = 'none';
            this.sim.repairAllLevees();
            break;
          case 'sky':
            this.cb.onSetSky(Number(val));
            break;
          case 'cam-iso':
            this.cb.onSnapIso();
            break;
          case 'cam-founders':
            this.cb.onFocusFounders();
            break;
          case 'cam-stadium':
            this.cb.onFocusStadium();
            break;
          case 'save':
            this.cb.onSaveGame();
            this.openPopover = 'none';
            break;
          case 'export':
            this.cb.onExportSave();
            this.openPopover = 'none';
            break;
          case 'new-showcase':
            this.openPopover = 'none';
            this.cb.onStartNew(true);
            break;
          case 'new-charter':
            this.openPopover = 'none';
            this.cb.onStartNew(false);
            break;
          case 'skip-setpiece':
            this.sim.skipActiveSetPiece();
            break;
          case 'toast-yes':
            this.sim.resolveToast(true);
            break;
          case 'toast-no':
            this.sim.resolveToast(false);
            break;
          case 'close-inspect':
            this.cb.onSelectBuilding(null);
            break;
          case 'upgrade-b': {
            const r = this.sim.upgradeBuilding(Number(val));
            if (!r.ok && r.reason) alert(r.reason);
            break;
          }
          case 'retrofit-b': {
            const r = this.sim.retrofitPilings(Number(val));
            if (!r.ok && r.reason) alert(r.reason);
            break;
          }
          case 'repair-b':
            this.sim.repairBuilding(Number(val));
            break;
          case 'refuel-b':
            this.sim.refuelGenerator(Number(val));
            break;
          case 'demolish-b': {
            const b = this.sim.state.buildings[Number(val)];
            if (b) {
              this.sim.demolish(b.tx, b.ty);
              this.cb.onSelectBuilding(null);
            }
            break;
          }
          case 'close-report':
            if (this.sim.state.storm.lastReport) {
              this.dismissedReportName = this.sim.state.storm.lastReport.name;
            }
            break;
        }
        this.render(true);
      };
    });
  }
}
