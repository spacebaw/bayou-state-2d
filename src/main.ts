import './style.css';
import { SoundEngine } from './audio/sound';
import {
  hapticHeavy,
  hapticPlace,
  hapticSuccess,
  hapticTap,
  hapticWarning,
  initNativeIOS,
  saveOrSharePostcard,
} from './native/ios';
import { Renderer2D } from './render2d/renderer2d';
import { CATALOG } from './sim/catalog';
import { SimEngine } from './sim/engine';
import { idx, inBounds } from './sim/terrain';
import { BuildingId, OverlayMode } from './sim/types';
import { HudController } from './ui/hud';

void initNativeIOS();

const SAVE_KEY = 'bayou_state_2d_save';

const canvasRoot = document.getElementById('canvas-root')!;
const hudRoot = document.getElementById('hud-root')!;

// Boot Flagship Showcase behind the title card for a vivid live 2D diorama backdrop!
const sim = new SimEngine(1860, true);
const renderer = new Renderer2D(canvasRoot);
const sound = new SoundEngine();

let toolRot: 0 | 1 | 2 | 3 = 0;
let hoverTx = -1;
let hoverTy = -1;
let lastMouseX = 0;
let lastMouseY = 0;

let isPanDragging = false;
let isBuildDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;

const keys = new Set<string>();

function focusFounders(): void {
  renderer.camera.focusOnTile(sim.state.plot.foundersTx + 1, sim.state.plot.foundersTy + 4, 1.12);
}

function focusStadium(): void {
  const st = sim.state.buildings.find((b) => b && (b.type === 'stadium' || b.type === 'practice_field'));
  if (st) {
    renderer.camera.focusOnTile(st.tx + st.w * 0.5, st.ty + st.h * 0.5, 1.15);
  } else {
    renderer.camera.focusOnTile(sim.state.plot.chenierCenter.tx, sim.state.plot.chenierCenter.ty, 1.05);
  }
}

const hud = new HudController(hudRoot, sim, {
  onSelectTool: (tool) => {
    hud.selectedTool = tool;
    if (tool) hud.selectedBuildingId = null;
  },
  onToggleBulldoze: () => {
    hud.bulldozeMode = !hud.bulldozeMode;
    if (hud.bulldozeMode) {
      hud.selectedTool = null;
      hud.selectedBuildingId = null;
    }
  },
  onTogglePilings: () => {
    hud.pilingsMode = !hud.pilingsMode;
  },
  onRotate: () => {
    toolRot = ((toolRot + 1) % 4) as 0 | 1 | 2 | 3;
  },
  onStartNew: (showcase) => {
    sound.unlock();
    sim.newGame(1860, showcase);
    hud.selectedTool = showcase ? null : 'founders_hall';
    hud.activeCat = 'academics';
    hud.bulldozeMode = false;
    hud.selectedBuildingId = null;
    hud.dismissedReportName = '';
    focusFounders();
    hud.render(true);
  },
  onLoadSave: () => {
    sound.unlock();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw && sim.deserialize(raw)) {
        hud.selectedTool = null;
        hud.selectedBuildingId = null;
        focusFounders();
      }
    } catch {
      // ignore
    }
    hud.render(true);
  },
  onSaveGame: () => {
    try {
      localStorage.setItem(SAVE_KEY, sim.serialize());
      hud.hasSavedGame = true;
      sim.state.ticker.unshift({
        id: Date.now(),
        day: sim.state.day,
        text: 'Campus saved to browser storage!',
        kind: 'info',
      });
    } catch {
      // ignore
    }
  },
  onExportSave: () => {
    const blob = new Blob([sim.serialize()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bayou-state-2d-y${sim.state.year}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  onToggleMute: () => {
    sound.unlock();
    hud.muted = !hud.muted;
    sound.setMuted(hud.muted);
  },
  onFocusFounders: focusFounders,
  onFocusStadium: focusStadium,
  onFocusParcel: (parcelIdx) => {
    const px = parcelIdx % 4;
    const py = Math.floor(parcelIdx / 4);
    renderer.camera.focusOnTile(px * 16 + 8, py * 16 + 8, 0.95);
  },
  onSnapIso: () => renderer.camera.snapDefault(),
  onSetSky: (skyTick) => {
    sim.state.skyTick = skyTick;
    sim.state.skyProgress = skyTick / 300;
    if (skyTick < 28) sim.state.skyPhase = 'dawn';
    else if (skyTick < 150) sim.state.skyPhase = 'day';
    else if (skyTick < 178) sim.state.skyPhase = 'golden';
    else if (skyTick < 204) sim.state.skyPhase = 'dusk';
    else sim.state.skyPhase = 'night';
  },
  onToggleBrightNight: () => {
    renderer.camera.brightNight = !renderer.camera.brightNight;
    return renderer.camera.brightNight;
  },
  onCapturePostcard: (framed) => {
    const dataUrl = renderer.capturePostcard(sim.state, framed);
    void saveOrSharePostcard(dataUrl, `bayou-state-2d-postcard-y${sim.state.year}.png`);
  },
  onSelectBuilding: (id) => {
    hud.selectedBuildingId = id;
  },
});

sim.onEvent((ev) => {
  sound.handleEvent(ev);
  if (ev.type === 'place' || ev.type === 'upgrade') hapticPlace();
  else if (ev.type === 'demolish') hapticTap();
  else if (ev.type === 'goal_complete' || ev.type === 'game_win') hapticSuccess();
  else if (ev.type === 'storm_warn' || ev.type === 'blackout') hapticWarning();
  if (ev.type === 'touchdown') {
    renderer.camera.addShake(1.4);
    hapticHeavy();
  } else if (ev.type === 'lightning') {
    renderer.camera.addShake(0.7);
    hapticHeavy();
  }
});

renderer.camera.focusOnTile(40, 17, 1.02);

function pickTile(clientX: number, clientY: number): { tx: number; ty: number } | null {
  const rect = renderer.canvas.getBoundingClientRect();
  const { w, h } = renderer.getSize();
  return renderer.camera.screenToTile(clientX - rect.left, clientY - rect.top, w, h, sim.state);
}

function resolveToolCoords(toolId: BuildingId, rawTx: number, rawTy: number): { tx: number; ty: number; snapped: boolean } {
  if (keys.has('shift')) return { tx: rawTx, ty: rawTy, snapped: false };
  return sim.findSnapPosition(toolId, rawTx, rawTy, toolRot, hud.pilingsMode);
}

function tryApplyToolAt(tx: number, ty: number): void {
  if (!inBounds(tx, ty)) return;
  if (hud.bulldozeMode) {
    sim.demolish(tx, ty);
    hud.render(true);
    return;
  }
  if (hud.selectedTool) {
    const def = CATALOG[hud.selectedTool];
    const resolved = resolveToolCoords(hud.selectedTool, tx, ty);
    const res = sim.place(hud.selectedTool, resolved.tx, resolved.ty, toolRot, hud.pilingsMode);
    if (res.ok) {
      if (!def.drag && !def.isNature) hud.selectedTool = null;
      hud.render(true);
    }
  }
}

interface DragTrailNode {
  tx: number;
  ty: number;
  valid: boolean;
  cost: number;
}
let dragTrail: DragTrailNode[] = [];

function makeTrailNode(toolId: BuildingId, tx: number, ty: number): DragTrailNode {
  const check = sim.canPlace(toolId, tx, ty, toolRot, hud.pilingsMode);
  return { tx, ty, valid: check.ok, cost: check.ok ? check.cost : 0 };
}

/**
 * Extends the drag-build preview trail orthogonally toward (targetTx, targetTy),
 * OR reverses course by truncating back to any earlier tile the pointer moves back over!
 */
function extendOrReverseTrail(toolId: BuildingId, targetTx: number, targetTy: number): void {
  if (!inBounds(targetTx, targetTy)) return;
  if (dragTrail.length === 0) {
    dragTrail.push(makeTrailNode(toolId, targetTx, targetTy));
    return;
  }

  // Direct backtrack check: moving over any earlier tile in the trail trims back to it!
  const hitIdx = dragTrail.findIndex((n) => n.tx === targetTx && n.ty === targetTy);
  if (hitIdx >= 0) {
    dragTrail.length = hitIdx + 1;
    return;
  }

  // Walk orthogonal 1-tile steps from tail toward target so fast drags never leave gaps
  let cx = dragTrail[dragTrail.length - 1].tx;
  let cy = dragTrail[dragTrail.length - 1].ty;
  let guard = 0;
  while ((cx !== targetTx || cy !== targetTy) && guard < 40) {
    guard++;
    const dx = targetTx - cx;
    const dy = targetTy - cy;
    if (Math.abs(dx) >= Math.abs(dy)) cx += Math.sign(dx);
    else cy += Math.sign(dy);

    const prevIdx = dragTrail.findIndex((n) => n.tx === cx && n.ty === cy);
    if (prevIdx >= 0) {
      dragTrail.length = prevIdx + 1;
    } else {
      dragTrail.push(makeTrailNode(toolId, cx, cy));
    }
  }
}

function commitDragTrail(): void {
  if (dragTrail.length === 0 || !hud.selectedTool) {
    dragTrail = [];
    return;
  }
  const toolId = hud.selectedTool;
  let placedAny = false;
  for (const node of dragTrail) {
    const res = sim.place(toolId, node.tx, node.ty, toolRot, hud.pilingsMode);
    if (res.ok) placedAny = true;
  }
  dragTrail = [];
  if (placedAny) hud.render(true);
}

const dom = renderer.canvas;
dom.style.touchAction = 'none';
dom.addEventListener('contextmenu', (e) => e.preventDefault());

// Multi-touch pointer tracker for smooth iPhone/iPad pinch-to-zoom & 2-finger pan!
const activePointers = new Map<number, { x: number; y: number }>();
let pinchPrevDist = 0;
let pinchPrevMidX = 0;
let pinchPrevMidY = 0;
let isPinching = false;

function getPinchMetrics(): { dist: number; midX: number; midY: number } | null {
  if (activePointers.size < 2) return null;
  const pts = Array.from(activePointers.values());
  const a = pts[0];
  const b = pts[1];
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    midX: (a.x + b.x) * 0.5,
    midY: (a.y + b.y) * 0.5,
  };
}

dom.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (hud.showTitle) return;

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  // 2+ fingers down -> switch immediately into smooth pinch-to-zoom + 2-finger pan!
  if (activePointers.size >= 2) {
    const m = getPinchMetrics();
    if (m) {
      isPinching = true;
      isPanDragging = false;
      isBuildDragging = false;
      dragTrail = [];
      pinchPrevDist = Math.max(1, m.dist);
      pinchPrevMidX = m.midX;
      pinchPrevMidY = m.midY;
    }
    return;
  }

  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragMoved = false;

  // Right-click while drafting a reversible path cancels the draft without spending cash!
  if (e.button === 2 && isBuildDragging && dragTrail.length > 0) {
    dragTrail = [];
    isBuildDragging = false;
    return;
  }

  if (e.button === 2 || e.button === 1 || (e.button === 0 && !hud.selectedTool && !hud.bulldozeMode)) {
    isPanDragging = true;
    return;
  }
  if (e.button === 0 && (hud.selectedTool || hud.bulldozeMode)) {
    const hit = pickTile(e.clientX, e.clientY);
    if (hit) {
      hoverTx = hit.tx;
      hoverTy = hit.ty;
      if (hud.selectedTool && CATALOG[hud.selectedTool].drag) {
        // Start reversible drag-preview trail instead of committing immediately!
        dragTrail = [makeTrailNode(hud.selectedTool, hit.tx, hit.ty)];
        isBuildDragging = true;
      } else {
        tryApplyToolAt(hit.tx, hit.ty);
        if (hud.bulldozeMode) {
          isBuildDragging = true;
        }
      }
    }
  }
});

window.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (isPinching && activePointers.size >= 2) {
    const m = getPinchMetrics();
    if (m) {
      const ratio = m.dist / Math.max(1, pinchPrevDist);
      if (Math.abs(ratio - 1) > 0.005) {
        renderer.camera.zoomBy(ratio);
      }
      renderer.camera.panByScreenDelta(m.midX - pinchPrevMidX, m.midY - pinchPrevMidY);
      pinchPrevDist = Math.max(1, m.dist);
      pinchPrevMidX = m.midX;
      pinchPrevMidY = m.midY;
    }
    return;
  }

  const dx = e.clientX - lastMouseX;
  const dy = e.clientY - lastMouseY;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 6) dragMoved = true;

  if (isPanDragging) {
    renderer.camera.panByScreenDelta(dx, dy);
    return;
  }
  if (hud.showTitle) return;

  const hit = pickTile(e.clientX, e.clientY);
  if (hit) {
    hoverTx = hit.tx;
    hoverTy = hit.ty;
    if (isBuildDragging) {
      if (hud.selectedTool && CATALOG[hud.selectedTool].drag) {
        extendOrReverseTrail(hud.selectedTool, hit.tx, hit.ty);
      } else if (hud.bulldozeMode) {
        tryApplyToolAt(hit.tx, hit.ty);
      }
    }
  } else {
    hoverTx = -1;
    hoverTy = -1;
  }
});

function handlePointerEnd(e: PointerEvent): void {
  activePointers.delete(e.pointerId);
  if (isPinching) {
    if (activePointers.size < 2) {
      isPinching = false;
      // Avoid stale pan delta when releasing the second finger
      const remaining = Array.from(activePointers.values())[0];
      if (remaining) {
        lastMouseX = remaining.x;
        lastMouseY = remaining.y;
      }
    }
    return;
  }

  if (isPanDragging && !dragMoved && e.button === 0 && !hud.showTitle) {
    const hit = pickTile(e.clientX, e.clientY);
    if (hit) {
      const owner = sim.state.tiles.owner[idx(hit.tx, hit.ty)];
      hud.selectedBuildingId = owner >= 0 ? owner : null;
      hud.openPopover = 'none';
      if (owner >= 0) hapticTap();
      hud.render(true);
    }
  }
  if (isBuildDragging && dragTrail.length > 0 && e.button === 0) {
    commitDragTrail();
  }
  isPanDragging = false;
  isBuildDragging = false;
  // Clear lingering hover ghost/tooltip after lifting a touch finger
  if (e.pointerType === 'touch') {
    hoverTx = -1;
    hoverTy = -1;
  }
}

window.addEventListener('pointerup', handlePointerEnd);
window.addEventListener('pointercancel', handlePointerEnd);

dom.addEventListener(
  'wheel',
  (e) => {
    if (hud.showTitle) return;
    e.preventDefault();
    renderer.camera.zoomBy(e.deltaY > 0 ? 0.91 : 1.09);
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (hud.showTitle) return;

  if (k === 'escape') {
    if (dragTrail.length > 0) {
      dragTrail = [];
      isBuildDragging = false;
      return;
    }
    hud.photoMode = false;
    hud.selectedTool = null;
    hud.bulldozeMode = false;
    hud.selectedBuildingId = null;
    hud.openPopover = 'none';
    hud.render(true);
  } else if (k === 'c') {
    hud.photoMode = !hud.photoMode;
    hud.openPopover = 'none';
    hud.selectedTool = null;
    hud.render(true);
  } else if (k === ' ') {
    e.preventDefault();
    sim.state.speed = sim.state.speed === 0 ? 1 : 0;
    hud.render(true);
  } else if (k === '1') {
    sim.state.speed = 1;
    hud.render(true);
  } else if (k === '2') {
    sim.state.speed = 2;
    hud.render(true);
  } else if (k === '3' || k === '4') {
    sim.state.speed = 4;
    hud.render(true);
  } else if (k === 'f') {
    sim.state.overlay =
      sim.state.overlay === OverlayMode.FloodRisk ? OverlayMode.None : OverlayMode.FloodRisk;
    hud.render(true);
  } else if (k === 'p') {
    hud.pilingsMode = !hud.pilingsMode;
    hud.render(true);
  } else if (k === 'r') {
    toolRot = ((toolRot + 1) % 4) as 0 | 1 | 2 | 3;
  } else if (k === 'x') {
    hud.bulldozeMode = !hud.bulldozeMode;
    if (hud.bulldozeMode) hud.selectedTool = null;
    hud.render(true);
  } else if (k === 'home') {
    renderer.camera.snapDefault();
  }
});

window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

let lastTime = performance.now();
let simAccum = 0;
let autosaveAccum = 0;
let elapsed = 0;

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;

  if (hud.showTitle) {
    // Gentle scenic pan across campus behind the title card
    renderer.camera.desiredX += Math.sin(elapsed * 0.22) * 14 * dt;
  } else {
    let fwd = 0;
    let right = 0;
    if (keys.has('w') || keys.has('arrowup')) fwd += 1;
    if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
    if (keys.has('d') || keys.has('arrowright')) right += 1;
    if (keys.has('a') || keys.has('arrowleft')) right -= 1;
    if (fwd !== 0 || right !== 0) renderer.camera.panByKeys(fwd, right, dt);
  }

  const effectiveSpeed =
    hud.showTitle
      ? 0.5
      : sim.state.storm.active || sim.state.football.active || sim.state.parade.active
        ? 1
        : sim.state.speed;

  if (effectiveSpeed > 0) {
    simAccum += dt * 10 * effectiveSpeed;
    let steps = 0;
    while (simAccum >= 1 && steps < 6) {
      sim.stepTick();
      simAccum -= 1;
      steps++;
    }
    if (simAccum > 4) simAccum = 0;
  }

  // Compute ghost preview with magnetic path snapping & reversible drag trail
  let ghost: {
    toolId: BuildingId | null;
    bulldoze: boolean;
    tx: number;
    ty: number;
    rot: 0 | 1 | 2 | 3;
    pilings: boolean;
    valid: boolean;
    snapped: boolean;
    trail?: { tx: number; ty: number; valid: boolean }[];
  } = {
    toolId: null,
    bulldoze: false,
    tx: -1,
    ty: -1,
    rot: toolRot,
    pilings: hud.pilingsMode,
    valid: false,
    snapped: false,
  };

  if (!hud.showTitle && hud.selectedTool && dragTrail.length > 0) {
    const def = CATALOG[hud.selectedTool];
    const validNodes = dragTrail.filter((n) => n.valid);
    const totalCost = validNodes.reduce((acc, n) => acc + n.cost, 0);
    const costTxt = totalCost === 0 ? 'FREE' : `$${(totalCost / 1000).toFixed(0)}k`;
    ghost = {
      toolId: hud.selectedTool,
      bulldoze: false,
      tx: dragTrail[dragTrail.length - 1].tx,
      ty: dragTrail[dragTrail.length - 1].ty,
      rot: toolRot,
      pilings: hud.pilingsMode,
      valid: validNodes.length > 0,
      snapped: false,
      trail: dragTrail,
    };
    hud.setCursorHint(
      true,
      lastMouseX,
      lastMouseY,
      `${def.name} · ${validNodes.length} tile${validNodes.length === 1 ? '' : 's'} · ${costTxt}`,
      'Release to build · Pull back to reverse · Right-click/Esc to cancel',
    );
  } else if (!hud.showTitle && hud.selectedTool && inBounds(hoverTx, hoverTy)) {
    const resolved = resolveToolCoords(hud.selectedTool, hoverTx, hoverTy);
    const check = sim.canPlace(hud.selectedTool, resolved.tx, resolved.ty, toolRot, hud.pilingsMode);
    const def = CATALOG[hud.selectedTool];
    ghost = {
      toolId: hud.selectedTool,
      bulldoze: false,
      tx: resolved.tx,
      ty: resolved.ty,
      rot: toolRot,
      pilings: hud.pilingsMode,
      valid: check.ok,
      snapped: resolved.snapped,
    };
    const costTxt = check.cost === 0 ? 'FREE' : `$${(check.cost / 1000).toFixed(0)}k`;
    const snapHint = resolved.snapped ? '🧲 Snapped to path (hold Shift for free)' : undefined;
    hud.setCursorHint(true, lastMouseX, lastMouseY, `${def.name} · ${costTxt}`, check.ok ? check.warning || snapHint : check.reason);
  } else if (!hud.showTitle && hud.bulldozeMode && inBounds(hoverTx, hoverTy)) {
    ghost = {
      toolId: null,
      bulldoze: true,
      tx: hoverTx,
      ty: hoverTy,
      rot: 0,
      pilings: false,
      valid: false,
      snapped: false,
    };
    hud.setCursorHint(true, lastMouseX, lastMouseY, 'Bulldoze Tile / Trees / Building', 'Click or drag to clear');
  } else {
    hud.setCursorHint(false, 0, 0, '');
  }

  renderer.camera.update(dt);
  renderer.renderFrame(
    sim.state,
    dt,
    elapsed,
    ghost,
    !hud.showTitle && inBounds(hoverTx, hoverTy) ? { tx: hoverTx, ty: hoverTy } : null,
  );
  sound.updateAmbience(sim.state);
  hud.render(false);

  if (!hud.showTitle) {
    autosaveAccum += dt;
    if (autosaveAccum > 30) {
      autosaveAccum = 0;
      try {
        localStorage.setItem(SAVE_KEY, sim.serialize());
        hud.hasSavedGame = true;
      } catch {
        // ignore
      }
    }
  }
}

(window as unknown as { __BSU2D: unknown }).__BSU2D = {
  sim,
  renderer,
  hud,
  focusFounders,
  focusStadium,
};

requestAnimationFrame(animate);
