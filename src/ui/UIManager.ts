import { AUDIO, NITRO, PAINTS, UI, VEHICLE } from '../config'
import type { PaintDef } from '../config'
import { fmtTime, hexToCss } from '../util'

/* ------------------------------------------------------------------------- *
 * DOM wiring for the shipped screens (spec §15): loading progress, title +
 * paint picker, countdown board, HUD, popups, results and pause — all read
 * from one HudData record the Game fills each frame, all user intents routed
 * back through the UiHost seam (which the Game answers via the central
 * Input), never raw listeners scattered through the UI.
 *
 * The rules below this line marked PURE are DOM-free (countdown cue policy,
 * results row building, popup TTL, wrong-way/shortcut/nitro-ready/gear
 * predicates) and unit-tested headless.
 * ------------------------------------------------------------------------- */

/* ============================== pure policy ============================== */

export type CountdownCue = '3' | '2' | '1' | 'go'

/** Cue fired when the clock crosses each whole second (GO once at the flag). */
export function countdownCueFor(prevRemaining: number, curRemaining: number): CountdownCue | null {
  if (prevRemaining > 3 && curRemaining <= 3) return '3'
  if (prevRemaining > 2 && curRemaining <= 2) return '2'
  if (prevRemaining > 1 && curRemaining <= 1) return '1'
  if (prevRemaining > 0 && curRemaining <= 0) return 'go'
  return null
}

/** The board never shows a number bigger than UI.countdownTop. */
export function countdownLabelFor(remaining: number): string {
  return String(Math.max(1, Math.min(UI.countdownTop, Math.ceil(remaining))))
}

/** Popup TTL policy: a ticket is dead once its age passes the configured span. */
export function popupExpired(bornAt: number, now: number, ttlSec: number = UI.popupTtlSec): boolean {
  return now - bornAt >= ttlSec * 1000
}

export interface StandingLike {
  readonly id: number
  readonly position: number
  readonly finished: boolean
  readonly finishTime: number
}
export interface ResultRow { pos: number; name: string; time: string; me: boolean }

/** Results table: rows in director position order, player marked, times formatted. */
export function buildResultRows(standings: readonly StandingLike[], playerCarId: number, names: readonly string[]): ResultRow[] {
  return standings.map((s) => ({
    pos: s.position,
    name: names[s.id] ?? `CAR ${s.id}`,
    time: s.finished ? fmtTime(s.finishTime * 1000) : '—',
    me: s.id === playerCarId,
  }))
}

/** Podium badge ('1ST', '2ND', '3RD', '4TH' ...). */
export function ordinalBadge(pos: number): string {
  const teens = pos % 100 >= 11 && pos % 100 <= 13
  const suffix = !teens && pos % 10 === 1 ? 'ST' : !teens && pos % 10 === 2 ? 'ND' : !teens && pos % 10 === 3 ? 'RD' : 'TH'
  return `${pos}${suffix}`
}

/** Nitro tank fraction above which the bar is 'ready' (can ignite). */
export const NITRO_READY_FRAC = NITRO.minToActivate / NITRO.max
/** true on the frame the tank crosses the ignition threshold upward */
export function nitroReadyEdge(prevLevel: number, level: number): boolean {
  return prevLevel < NITRO_READY_FRAC && level >= NITRO_READY_FRAC
}
/** lit segment count of the segmented nitro bar */
export function nitroSegmentsOn(level: number, count: number = UI.nitroSegments): number {
  return Math.round(Math.max(0, Math.min(1, level)) * count)
}

/** Wrong-way latch state (hysteresis so a spin-out moment never flickers). */
export interface WrongWayState { on: boolean; heldFor: number; clearFor: number }
export const freshWrongWay = (): WrongWayState => ({ on: false, heldFor: 0, clearFor: 0 })

/**
 * Update the latch: `headingDot` is dot(carHeading, trackHeading); the
 * indicator latches only after UI.wrongWayHoldSec of sustained wrong-way
 * driving above the speed floor, and clears after the release window.
 */
export function wrongWayStep(st: WrongWayState, headingDot: number, speed: number, dt: number): WrongWayState {
  const driving = speed >= UI.wrongWaySpeedMin
  const wrong = driving && headingDot < UI.wrongWayDot
  if (wrong) {
    st.heldFor += dt
    st.clearFor = 0
    if (st.heldFor >= UI.wrongWayHoldSec) st.on = true
  } else {
    st.clearFor += dt
    st.heldFor = 0
    if (st.clearFor >= UI.wrongWayClearSec) st.on = false
  }
  return st
}

/** Drift-chain tracker mirroring the drive-layer gates (read-only mirror). */
export interface DriftChainState { hold: number; cool: number; chains: number }
export const freshDriftChain = (): DriftChainState => ({ hold: 0, cool: 0, chains: 0 })
/** advances the hold clock; returns true on the frame a new chain completes */
export function driftChainStep(st: DriftChainState, drifting: boolean, dt: number): boolean {
  if (drifting) {
    st.hold += dt
    st.cool = VEHICLE.driftEndGrace
    return false
  }
  const wasHolding = st.hold > 0
  st.cool -= dt
  const ended = st.cool <= 0
  const done = ended && wasHolding && st.hold >= VEHICLE.driftChainHold
  if (ended) st.hold = 0
  if (done) { st.chains++; return true }
  return false
}

/* gear feel: gates are fractions of the top speed (UI.gearTops) */
export function gearIndexOf(speed01: number): number {
  const tops = UI.gearTops
  for (let g = 0; g < tops.length; g++) if (speed01 <= tops[g]) return g
  return tops.length - 1
}
export function gearLabelFor(speed01: number, reverse: boolean): string {
  return reverse ? 'R' : `D${gearIndexOf(speed01) + 1}`
}
/** tach position: idleRpm floor, ramp to 1 at the shift point inside a gear */
export function rpmFor(speed01: number, reverse: boolean): number {
  if (reverse) return AUDIO.idleRpm
  const tops = UI.gearTops
  const g = gearIndexOf(speed01)
  const base = g === 0 ? 0 : tops[g - 1]
  const span = Math.max(1e-4, tops[g] - base)
  const t = Math.min(1, (speed01 - base) / span)
  return AUDIO.idleRpm + (1 - AUDIO.idleRpm) * Math.min(1, t / AUDIO.shiftPoint)
}

export interface ShortcutState { inside: boolean; armed: boolean }
export const freshShortcut = (): ShortcutState => ({ inside: false, armed: true })
/**
 * Shortest distance from (x,z) to the shortcut polyline (planar segments).
 * Pure + deterministic — the Game grants NITRO.bonusShortcut once per spur
 * traversal when the probe says inside.
 */
export function distToPolyline(xs: ArrayLike<number>, zs: ArrayLike<number>, x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i + 1 < xs.length; i++) {
    const ax = xs[i], az = zs[i], bx = xs[i + 1], bz = zs[i + 1]
    const dx = bx - ax, dz = bz - az
    const len2 = dx * dx + dz * dz
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0
    const px = ax + dx * t - x, pz = az + dz * t - z
    const d = Math.hypot(px, pz)
    if (d < best) best = d
  }
  return best
}
/** edge detector: true exactly on the entering frame of the spur */
export function shortcutEnterEdge(st: ShortcutState, inside: boolean): boolean {
  const entered = inside && !st.inside
  st.inside = inside
  return entered
}

/** rival display names: paints in AI slot order, player is 'YOU' */
export function buildCarNames(paints: readonly PaintDef[], playerCarId: number): string[] {
  return paints.map((p, i) => (i === playerCarId ? 'YOU' : p.name.toUpperCase()))
}

export type UiMode = 'title' | 'racing'

/**
 * Countdown/GO board visibility policy: the board is a RACE-screen element.
 * The director phase alone is not authority — paused->MAIN MENU mid-countdown
 * returns to the title while the director may still sit at 'countdown', and a
 * phase read straight off the director would then repaint a ghost board over
 * the title. Show only while the UI is on the racing screen, and only for the
 * live countdown phase or the GO hold window (goT > 0, owned by flagDropped).
 */
export function countdownBoardVisible(mode: UiMode, phase: HudData['phase'], goT: number): boolean {
  return mode === 'racing' && (phase === 'countdown' || goT > 0)
}

/* ================================ DOM part =============================== */

export interface HudData {
  phase: 'idle' | 'countdown' | 'racing' | 'finished'
  /** a race is on screen (grid -> flag) */
  active: boolean
  speed: number
  reverse: boolean
  nitroLevel: number
  nitroActive: boolean
  position: number
  total: number
  raceTime: number
  /** m/s world speed (wind/feel), used for gear scaling */
  topSpeedRef: number
  progress: number
  countdown: number
  standings: readonly StandingLike[]
  headingDot: number
  drifting: boolean
}

export interface UiHost {
  onStart(): void
  onRestart(): void
  onResume(): void
  onMenu(): void
  onPaint(hex: number): void
}

interface PopupTicket { node: HTMLElement; bornAt: number }

type Vec2 = { x: number; z: number }

export class UIManager {
  private readonly doc: Document
  private readonly $: (id: string) => HTMLElement | null
  private readonly loading: HTMLElement | null
  private readonly loadingFill: HTMLElement | null
  private readonly loadingStepEl: HTMLElement | null
  private readonly title: HTMLElement | null
  private readonly hud: HTMLElement | null
  private readonly results: HTMLElement | null
  private readonly pause: HTMLElement | null
  private readonly countdownEl: HTMLElement | null
  private readonly countdownNum: HTMLElement | null
  private readonly flashEl: HTMLElement | null
  private readonly vignetteEl: HTMLElement | null
  private readonly popupStack: HTMLElement | null
  private readonly wrongWayEl: HTMLElement | null
  private readonly driftScore: HTMLElement | null
  private readonly driftPoints: HTMLElement | null
  private readonly driftMult: HTMLElement | null
  private readonly speedValue: HTMLElement | null
  private readonly rpmFill: HTMLElement | null
  private readonly gearEl: HTMLElement | null
  private readonly nitroSegments: HTMLElement | null
  private readonly positionValue: HTMLElement | null
  private readonly lapTime: HTMLElement | null
  private readonly bestTime: HTMLElement | null
  private readonly progressFg: HTMLElement | null
  private readonly progressPct: HTMLElement | null
  private readonly minimap: HTMLCanvasElement | null
  private readonly mctx: CanvasRenderingContext2D | null
  private readonly swatchHost: HTMLElement | null

  private mode: UiMode = 'title'
  private prevPhase: HudData['phase'] = 'idle'
  /** true while the race HUD (not the title board) is on screen */
  get onScreen(): boolean { return this.mode === 'racing' }
  private prevNitro = 0
  private wwPrev = false
  private readonly ww = freshWrongWay()
  private readonly chain = freshDriftChain()
  private goT = 0
  private bestMs: number | null = null
  private readonly popups: PopupTicket[] = []
  private cad = { speed: 0, ring: 0, map: 0 }
  /* minimap plan projection (bound from the spline once) */
  private mapPts: Float32Array | null = null
  private mapScale = 1; private mapOx = 0; private mapOz = 0

  constructor(doc: Document, private host: UiHost) {
    this.doc = doc
    this.$ = (id) => doc.getElementById(id)
    this.loading = this.$('loading')
    this.loadingFill = this.$('loading-fill')
    this.loadingStepEl = this.$('loading-step')
    this.title = this.$('title-screen')
    this.hud = this.$('hud')
    this.results = this.$('results-screen')
    this.pause = this.$('pause-screen')
    this.countdownEl = this.$('countdown')
    this.countdownNum = this.$('countdown-num')
    this.flashEl = this.$('flash')
    this.vignetteEl = this.$('vignette-nitro')
    this.popupStack = this.$('popup-stack')
    this.wrongWayEl = this.$('wrong-way')
    this.driftScore = this.$('drift-score')
    this.driftPoints = this.$('drift-points')
    this.driftMult = this.$('drift-mult')
    this.speedValue = this.$('speed-value')
    this.rpmFill = this.$('rpm-fill')
    this.gearEl = this.$('gear-indicator')
    this.nitroSegments = this.$('nitro-segments')
    this.positionValue = this.$('position-value')
    this.lapTime = this.$('lap-time')
    this.bestTime = this.$('best-time')
    this.progressFg = this.$('progress-fg')
    this.progressPct = this.$('progress-pct')
    this.minimap = this.$('minimap') as HTMLCanvasElement | null
    this.mctx = this.minimap ? this.minimap.getContext('2d') : null
    this.swatchHost = this.$('paint-swatches')
    this.buildButtons()
    this.buildSwatches(PAINTS, PAINTS[1].color)
    this.buildNitroSegments()
  }

  /* ------------------------------------------------------------ boot screens */

  loadingStep(text: string, pct: number): void {
    if (this.loadingStepEl) this.loadingStepEl.textContent = text
    if (this.loadingFill) this.loadingFill.style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`
  }
  loadingDone(): void { this.loading?.classList.add('hidden') }

  showTitle(): void {
    this.mode = 'title'
    this.show(this.title, true)
    this.show(this.hud, false)
    this.show(this.results, false)
    this.show(this.pause, false)
    this.show(this.countdownEl, false)
    this.clearTransient()
  }

  /** the title/Enter path entered a race: HUD on, screens off, clocks fresh */
  raceStarted(): void {
    this.mode = 'racing'
    this.show(this.title, false)
    this.show(this.results, false)
    this.show(this.pause, false)
    this.show(this.hud, true)
    this.clearTransient()
    this.chain.chains = 0
    this.prevNitro = 0
    this.ww.on = false; this.ww.heldFor = 0; this.ww.clearFor = 0
  }

  raceToMenu(): void { this.showTitle() }

  showPause(v: boolean): void { this.show(this.pause, v && this.mode === 'racing') }

  /** hide every transient layer (frozen pose capture, restart) */
  clearTransient(): void {
    for (const p of this.popups) p.node.remove()
    this.popups.length = 0
    this.show(this.countdownEl, false)
    this.goT = 0
    if (this.wrongWayEl) this.wrongWayEl.classList.add('hidden')
    if (this.driftScore) this.driftScore.classList.add('hidden')
    if (this.flashEl) (this.flashEl as HTMLElement).style.opacity = '0'
    if (this.vignetteEl) (this.vignetteEl as HTMLElement).style.opacity = '0'
  }

  /* ---------------------------------------------------------------- intents */

  private onClick(el: HTMLElement | null, fn: () => void): void {
    el?.addEventListener('click', () => { (el as HTMLElement).blur(); fn() })
  }
  private buildButtons(): void {
    this.onClick(this.$('btn-start'), () => this.host.onStart())
    this.onClick(this.$('btn-restart'), () => this.host.onRestart())
    this.onClick(this.$('btn-menu'), () => this.host.onMenu())
    this.onClick(this.$('btn-resume'), () => this.host.onResume())
    this.onClick(this.$('btn-restart-pause'), () => this.host.onRestart())
    this.onClick(this.$('btn-menu-pause'), () => this.host.onMenu())
  }

  /** paint swatch row built from PAINTS (spec §15 title picker) */
  buildSwatches(paints: readonly PaintDef[], selectedHex: number): void {
    if (!this.swatchHost) return
    this.swatchHost.textContent = ''
    for (const p of paints) {
      const b = this.doc.createElement('button')
      b.className = 'swatch' + (p.color === selectedHex ? ' selected' : '')
      b.style.background = hexToCss(p.color)
      b.title = p.name
      b.addEventListener('click', () => {
        for (const s of Array.from(this.swatchHost?.children ?? [])) s.classList.remove('selected')
        b.classList.add('selected')
        this.host.onPaint(p.color)
      })
      this.swatchHost.appendChild(b)
    }
  }

  private buildNitroSegments(): void {
    if (!this.nitroSegments) return
    this.nitroSegments.textContent = ''
    for (let i = 0; i < UI.nitroSegments; i++) {
      const s = this.doc.createElement('div')
      s.className = 'nitro-seg'
      this.nitroSegments.appendChild(s)
    }
  }

  /* ---------------------------------------------------------------- popups */

  pushPopup(text: string, tone: '' | 'gold' | 'red' = ''): void {
    if (!this.popupStack) return
    const node = this.doc.createElement('div')
    node.className = 'popup' + (tone ? ` ${tone}` : '')
    node.textContent = text
    this.popupStack.appendChild(node)
    this.popups.push({ node, bornAt: performance.now() })
  }

  flash(strength: number): void {
    if (!this.flashEl) return
    ;(this.flashEl as HTMLElement).style.opacity = String(Math.min(1, strength) * UI.flashPeak)
  }

  /* ------------------------------------------------------------------ HUD */

  /** one frame of HUD bookkeeping + screen sync (Game calls when not paused) */
  update(dt: number, hud: HudData, player: Vec2, ai: readonly Vec2[], aiCount = ai.length): void {
    /* screen transitions driven off the phase/edge contract */
    if (hud.phase === 'countdown' && this.prevPhase === 'idle') this.raceStarted()
    if (this.mode === 'racing' && hud.phase === 'finished' && this.prevPhase !== 'finished') this.showResults(hud)
    this.prevPhase = hud.phase

    /* countdown board — visibility is gated on the UI screen mode, not just
       the director phase (see countdownBoardVisible). The GO hold window is
       owned by flagDropped's timer: tick it off the countdown phase. */
    if (this.mode === 'racing' && hud.phase !== 'countdown' && this.goT > 0) this.goT -= dt
    if (countdownBoardVisible(this.mode, hud.phase, this.goT)) {
      this.show(this.countdownEl, true)
      if (this.countdownNum && hud.phase === 'countdown') {
        this.countdownNum.textContent = countdownLabelFor(hud.countdown)
        this.countdownNum.classList.remove('go')
      }
    } else {
      this.show(this.countdownEl, false)
    }

    if (!hud.active) return

    /* gear/speed/rpm */
    const speed01 = Math.min(1, hud.speed / hud.topSpeedRef)
    this.cad.speed -= dt
    if (this.cad.speed <= 0) {
      this.cad.speed = UI.speedEvery
      if (this.speedValue) this.speedValue.textContent = String(Math.round(hud.speed * 3.6))
      if (this.gearEl) this.gearEl.textContent = gearLabelFor(speed01, hud.reverse)
      if (this.rpmFill) this.rpmFill.style.width = `${(rpmFor(speed01, hud.reverse) * 100).toFixed(1)}%`
    }

    /* nitro segments + ready/active classes */
    if (this.nitroSegments) {
      const on = nitroSegmentsOn(hud.nitroLevel)
      const kids = this.nitroSegments.children
      for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < on)
      this.nitroSegments.classList.toggle('ready', hud.nitroLevel >= NITRO_READY_FRAC && !hud.nitroActive)
      this.nitroSegments.classList.toggle('active', hud.nitroActive)
    }
    if (nitroReadyEdge(this.prevNitro, hud.nitroLevel) && !hud.nitroActive) this.pushPopup('NITRO READY', 'gold')
    this.prevNitro = hud.nitroLevel
    if (this.vignetteEl) (this.vignetteEl as HTMLElement).style.opacity = hud.nitroActive ? String(UI.vignetteNitro) : '0'

    /* position / timers / progress ring */
    if (this.positionValue) this.positionValue.textContent = String(hud.position || '—')
    const totalEl = this.$('position-total')
    if (totalEl) totalEl.textContent = `/${hud.total}`
    if (this.lapTime) this.lapTime.textContent = fmtTime(Math.max(0, hud.raceTime) * 1000)
    if (this.bestTime) this.bestTime.textContent = this.bestMs === null ? 'BEST —' : `BEST ${fmtTime(this.bestMs)}`
    this.cad.ring -= dt
    if (this.cad.ring <= 0) {
      this.cad.ring = UI.ringEvery
      const c = 326.7
      if (this.progressFg) (this.progressFg as unknown as { style: CSSStyleDeclaration }).style.strokeDashoffset = String(c * (1 - Math.min(1, hud.progress)))
      if (this.progressPct) this.progressPct.textContent = `${Math.round(Math.min(1, hud.progress) * 100)}%`
    }

    /* wrong-way latch */
    wrongWayStep(this.ww, hud.headingDot, hud.speed, dt)
    this.wrongWayEl?.classList.toggle('hidden', !this.ww.on)
    if (this.ww.on && !this.wwPrev) this.pushPopup('WRONG WAY', 'red')
    this.wwPrev = this.ww.on

    /* drift chain tracker + score board */
    const chainUp = driftChainStep(this.chain, hud.drifting && hud.speed > VEHICLE.driftTriggerSpeed, dt)
    if (chainUp) this.pushPopup('DRIFT CHAIN!', 'gold')
    if (this.driftScore) {
      const show = this.chain.hold > 0.25
      this.driftScore.classList.toggle('hidden', !show)
      if (show) {
        if (this.driftPoints) this.driftPoints.textContent = String(this.chain.chains * 100 + Math.floor(this.chain.hold * 40))
        if (this.driftMult) this.driftMult.textContent = `x${Math.max(1, this.chain.chains)}`
      }
    }

    /* popups expire on the TTL policy */
    const now = performance.now()
    for (let i = this.popups.length - 1; i >= 0; i--) {
      if (popupExpired(this.popups[i].bornAt, now)) { this.popups[i].node.remove(); this.popups.splice(i, 1) }
    }

    /* decay the impact flash */
    if (this.flashEl) {
      const o = Number.parseFloat((this.flashEl as HTMLElement).style.opacity || '0')
      if (o > 0) (this.flashEl as HTMLElement).style.opacity = String(Math.max(0, o - dt * 3.2))
    }

    /* minimap */
    this.cad.map -= dt
    if (this.cad.map <= 0) { this.cad.map = UI.minimapEvery; this.drawMap(player, ai, aiCount) }
  }

  /** the flag dropped: show GO for its configured hold */
  flagDropped(): void {
    this.goT = UI.goHoldSec
    if (this.countdownEl) this.show(this.countdownEl, true)
    if (this.countdownNum) { this.countdownNum.textContent = 'GO'; this.countdownNum.classList.add('go') }
  }

  private showResults(hud: HudData): void {
    const rows = buildResultRows(hud.standings, 0, this.standingNames)
    const panel = this.$('results-standings')
    if (panel) {
      panel.textContent = ''
      for (const r of rows) {
        const row = this.doc.createElement('div')
        row.className = 'stand-row' + (r.me ? ' me' : '')
        const pos = this.doc.createElement('span'); pos.className = 'stand-pos'; pos.textContent = String(r.pos)
        const nm = this.doc.createElement('span'); nm.className = 'stand-name'; nm.textContent = r.name
        const tm = this.doc.createElement('span'); tm.className = 'stand-time'; tm.textContent = r.time
        row.append(pos, nm, tm)
        panel.appendChild(row)
      }
    }
    const mine = hud.standings.find((s) => s.id === 0)
    if (mine) {
      if (mine.finished) this.bestMs = this.bestMs === null ? mine.finishTime * 1000 : Math.min(this.bestMs, mine.finishTime * 1000)
    }
    const medal = this.$('results-medal')
    if (medal) medal.textContent = ordinalBadge(mine?.position ?? 1)
    const timeEl = this.$('results-time')
    if (timeEl) timeEl.textContent = mine?.finished ? fmtTime(mine.finishTime * 1000) : '—'
    this.show(this.results, true)
    this.show(this.hud, false)
  }

  private standingNames: readonly string[] = []
  /** rival names for the results table (slot order = director ids) */
  setStandingNames(names: readonly string[]): void { this.standingNames = names }

  /* -------------------------------------------------------------- minimap */

  /** bake the circuit outline once (plan projection, centred + scaled) */
  bindTrack(spline: { length: number; frame(s: number): { pos: { x: number; z: number } } }): void {
    const step = 12
    const n = Math.floor(spline.length / step) + 1
    const xs = new Float32Array(n); const zs = new Float32Array(n)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      const f = spline.frame(i * step)
      xs[i] = f.pos.x; zs[i] = f.pos.z
      if (f.pos.x < minX) minX = f.pos.x
      if (f.pos.x > maxX) maxX = f.pos.x
      if (f.pos.z < minZ) minZ = f.pos.z
      if (f.pos.z > maxZ) maxZ = f.pos.z
    }
    const size = this.minimap ? Math.min(this.minimap.width, this.minimap.height) - 18 : 150
    this.mapScale = size / Math.max(1, Math.max(maxX - minX, maxZ - minZ))
    this.mapOx = minX - (size / (this.mapScale) - (maxX - minX)) / 2
    this.mapOz = minZ - (size / (this.mapScale) - (maxZ - minZ)) / 2
    this.mapPts = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { this.mapPts[i * 2] = xs[i]; this.mapPts[i * 2 + 1] = zs[i] }
  }

  private drawMap(player: Vec2, ai: readonly Vec2[], n: number): void {
    const ctx = this.mctx
    if (!ctx || !this.mapPts || !this.minimap) return
    const w = this.minimap.width, h = this.minimap.height
    ctx.clearRect(0, 0, w, h)
    const sx = (x: number): number => (x - this.mapOx) * this.mapScale + 9
    const sz = (z: number): number => (z - this.mapOz) * this.mapScale + 9
    ctx.beginPath()
    for (let i = 0; i < this.mapPts.length / 2; i++) {
      const x = sx(this.mapPts[i * 2]), y = sz(this.mapPts[i * 2 + 1])
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.strokeStyle = 'rgba(140,180,225,0.55)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#ffb427'
    for (let di = 0; di < n; di++) { const c = ai[di]
      ctx.beginPath(); ctx.arc(sx(c.x), sz(c.z), 3, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = '#35e2ff'
    ctx.beginPath(); ctx.arc(sx(player.x), sz(player.z), 4.2, 0, Math.PI * 2); ctx.fill()
  }

  private show(el: HTMLElement | null, v: boolean): void {
    el?.classList.toggle('hidden', !v)
  }
}
