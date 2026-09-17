import * as THREE from 'three'
import { TRACK, THEME, SEED, type ZoneId } from '../config'
import { clamp, lerp, smoothstep, fbm2, hash21, makeCanvas, sanitizeGeometry, crNormals } from '../util'
import { groundDetailTexture } from '../assets/Textures'
import type { TrackSpline } from './TrackSpline'

/* ------------------------------------------------------------------------- *
 * Circuit height-field (spec §4.4/§8): a designed field per zone — the
 * frozen coastal bay (cliff line, shelf, sea floor, dunes, backing hills), a
 * terraced industrial bench, a rock ridge that BURIES the tunnel bore, a
 * valley floor for the north city under the viaduct, the west ridge the final
 * sector descends, and the headland apron of the start/finish straight. The
 * profiles are blended ALONG the arc (zone weight) so neighbours meet without
 * a step, and they relax to a far field at large |lat| so the world keeps
 * relief outside the corridor. The road corridor is blended INTO the field
 * (road-bed profile over a smoothstep falloff), suppressed under the viaduct
 * deck (pylons, not an earthwork trench) and inside the bore (the ridge is
 * the lid; the cut only opens at the portals). Vertex-coloured, no hard seams.
 * ------------------------------------------------------------------------- */

const C = TRACK.coast
const G = TRACK.terrain
/** Plan bounds of the sea quad / shore bake (Water + shoreTexture agree). */
const BAY = { x0: -320, x1: 320, z0: -300, z1: 180 }

interface Pad { x: number; z: number; r: number; y: number }
type Nearest = { s: number; lat: number; d2: number }

const ZONE_LIST: readonly ZoneId[] = ['coastal', 'industrial', 'tunnel', 'elevated', 'final', 'start']

export class CoastField {
  readonly seaLevel = C.seaLevel
  private spline: TrackSpline
  private pads: Pad[]

  constructor(spline: TrackSpline) {
    this.spline = spline
    const cluster = TRACK.cluster
    const toPad = (x: number, z: number, r: number, y: number): Pad => ({ x, z, r, y })
    const list: Pad[] = [
      toPad(cluster.x, cluster.z, cluster.padR, spline.roadY(spline.sFromX(cluster.x)) + 0.25),
    ]
    // Authored build sites (spec §8): formed ground for yards, aprons and the
    // north-city blocks, addressed by control-point station + driver-right.
    for (const p of TRACK.pads) {
      const s = spline.sAtControl(p.cp)
      const f = spline.frame(s)
      list.push(toPad(f.pos.x + f.side.x * p.lat, f.pos.z + f.side.z * p.lat, p.r, spline.roadY(s) + p.dy))
    }
    this.pads = list
  }

  /** Zone weights along the arc: 1 deep inside a zone, ramping over `blend`. */
  private weights(s: number): number[] {
    const out: number[] = []
    const b = G.blend
    for (const zone of ZONE_LIST) {
      const { s0, s1 } = this.spline.zoneRange(zone)
      const d = s < s0 ? s0 - s : s > s1 ? s - s1 : 0
      out.push(d >= b ? 0 : 1 - smoothstep(b * 0.42, b, d))
    }
    return out
  }

  /** A zone profile only owns the ground near the road; beyond that the far
   *  field takes over so the world has hills outside the corridor. */
  private latGate(lat: number): number {
    const [a, b] = G.farFade
    return 1 - smoothstep(a, b, Math.abs(lat))
  }

  /** Gentle relief anywhere, the fallback canvas the zones are painted on. */
  private farField(x: number, z: number): number {
    return (fbm2(x * 0.0062 + 2.7, z * 0.0062 + 6.1, 3) - 0.46) * G.farRelief - 1.2
  }

  /** Designed natural terrain height at world (x, z). */
  natural(x: number, z: number, near?: Nearest): number {
    const nt = near ?? this.spline.nearest(x, z)
    const { s, lat } = nt
    const w = this.weights(s)
    const gate = this.latGate(lat)
    let h = this.farField(x, z)
    if (gate > 0.001) {
      // ---- coastal bay: the frozen Phase-3 field (hero slice is byte-stable)
      if (w[0] > 0.001) {
        const f = fbm2(x * 0.013 + 5.1, z * 0.013 + 9.7, 4)
        let hcl = (f - 0.5) * C.fieldAmp - 0.15
        // northern ridge/hills behind the cluster
        if (z > C.northHillStart) {
          const t = smoothstep(C.northHillStart, C.northHillStart + 90, z)
          hcl += Math.max(0, z - C.northHillStart) * C.northHillRise + t * fbm2(x * 0.008 + 1.3, z * 0.008, 3) * C.northHillNoise
        }
        let hcs = hcl
        // meandering cliff line + sea floor
        const zE = z + (fbm2(x * 0.016 + 0.7, 5.1, 2) - 0.5) * C.edgeMeander
        const shelf = 0.35 + fbm2(x * 0.021 + 3.3, 7.7, 3) * C.shelfAmp
        const s1 = smoothstep(C.cliffZTop, C.cliffZTop - 26, zE)
        const s2 = smoothstep(C.cliffZBase + 22, C.cliffZBase + 2, zE)
        hcs = lerp(hcs, shelf, s1)
        // break the face: terraced noise over the transition so no flat slab wall
        const wall = s1 * (1 - s2)
        hcs += (fbm2(x * 0.11 + 6.6, zE * 0.16 + 2.4, 3) - 0.5) * 2.4 * wall
        // terrace between cliff face and sea floor — must sit WELL below the
        // waterline so the sea shader reads real depth (no dry-foam sheet over it)
        hcs = lerp(hcs, C.seaFloor - 2.4 - fbm2(x * 0.02 + 5.9, zE * 0.02, 2) * 1.8, s1 * s2)
        hcs = lerp(hcs, C.seaFloor - fbm2(x * 0.03 + 8.1, 2.7, 2) * 1.6, s2)
        // the sea is geometry, not a zone opinion: it is bounded to the bay the
        // water quad actually covers, and survives the far-field relaxation
        const bay = smoothstep(BAY.x0, BAY.x0 + 26, x) * (1 - smoothstep(BAY.x1 - 26, BAY.x1, x))
          * (1 - smoothstep(BAY.z0, BAY.z0 + 26, z))
        const hc = lerp(hcl, hcs, bay)
        h = lerp(h, hc, w[0] * Math.max(gate, Math.min(w[0], bay * s1)))
      }
      // ---- industrial bench: a terraced works platform climbing with the road
      if (w[1] > 0.001) {
        const hi = this.spline.roadY(s) - 1.35 + (fbm2(x * 0.028 + 3.3, z * 0.028 + 7.7, 3) - 0.5) * 1.9
          + Math.max(0, lat - 34) * 0.16
        h = lerp(h, hi, w[1] * gate)
      }
      // ---- tunnel: a rock ridge whose crest passes OVER the bore. The window
      // is the bore PLUS an apron at each end (the generic zone blend is far
      // wider than the tube, which left the shell roofed by nothing near the
      // portals), and the crest is pinned above the tube crown so the lid is
      // real everywhere, not only at the authored rise.
      const tz = this.spline.zoneRange('tunnel')
      const tPad = TRACK.tunnel.apron + 10
      const tD = s < tz.s0 - tPad ? tz.s0 - tPad - s : s > tz.s1 + tPad ? s - (tz.s1 + tPad) : 0
      if (tD < 34) {
        const tw = 1 - smoothstep(10, 34, tD)
        const lid = this.spline.bedY(s, 0) + TRACK.tunnel.tubeRise + 3.2
        const crown = Math.max(this.spline.roadY(s) + G.tunnelRise, lid)
        const ht = crown + Math.min(13, Math.abs(lat) * G.tunnelCross)
          + (fbm2(x * 0.052 + 1.6, z * 0.052 + 4.4, 3) - 0.5) * 1.8
        h = lerp(h, ht, tw * gate)
      }
      // ---- elevated: the north-city valley floor, flown over by the deck.
      // The floor stays flat well out to the flank, then ramps up but is CAPped
      // below the deck — otherwise the far field dips into pits beside the
      // viaduct and the rim reads as a cliff wall from the deck.
      if (w[3] > 0.001) {
        const rng = this.spline.zoneRange('elevated')
        const endD = Math.min(s - rng.s0, rng.s1 - s)
        let floor = this.spline.roadY(s) + G.cityFloor + (fbm2(x * 0.024 + 8.9, z * 0.024 + 2.2, 3) - 0.5) * 2.0
          + Math.max(0, Math.abs(lat) - 60) * 0.24
        floor = Math.min(floor, this.spline.roadY(s) - 1.8)
        // the deck lands on embankments at both ends, not on a cliff edge
        floor = lerp(floor, this.spline.roadY(s) - 1.6, 1 - smoothstep(0, G.deckRise, endD))
        h = lerp(h, floor, w[3] * gate)
      }
      // ---- final: the west ridge, rising away from the descending road
      if (w[4] > 0.001) {
        const hf = this.spline.roadY(s) - 1.5 + (fbm2(x * 0.022 + 4.4, z * 0.022 + 5.5, 4) - 0.4) * 3.4
          + clamp(lat * 0.2, -4, 13)
        h = lerp(h, hf, w[4] * gate)
      }
      // ---- start: headland apron of the start/finish straight
      if (w[5] > 0.001) {
        const hs = this.spline.roadY(s) - 1.1 + (fbm2(x * 0.02 + 6.6, z * 0.02 + 3.3, 3) - 0.5) * 1.7
          + Math.max(0, lat - 30) * 0.1
        h = lerp(h, hs, w[5] * gate)
      }
    }
    // authored pads flatten build sites to formed ground (plateau + feather)
    for (const p of this.pads) {
      const pw = 1 - smoothstep(p.r * 0.62, p.r * 1.35, Math.hypot(x - p.x, z - p.z))
      if (pw > 0.001) h = lerp(h, p.y, pw * 0.94)
    }
    return h
  }

  /** How much the engineered road-bed may pull the field down at station s. */
  private embedWeight(s: number): number {
    const zone = this.spline.zoneAt(s)
    if (zone === 'elevated') {
      const rng = this.spline.zoneRange('elevated')
      const endD = Math.min(s - rng.s0, rng.s1 - s)
      return 1 - smoothstep(G.deckRise * 0.35, G.deckRise, endD)
    }
    if (zone === 'tunnel') {
      const rng = this.spline.zoneRange('tunnel')
      const endD = Math.min(s - rng.s0, rng.s1 - s)
      return 1 - smoothstep(TRACK.tunnel.apron * 0.7, TRACK.tunnel.apron + 14, endD)
    }
    return 1
  }

  /** Road-embedded corridor: blends the engineered road-bed into the field. */
  height(x: number, z: number, near?: Nearest): number {
    const nt = near ?? this.spline.nearest(x, z)
    let h = this.natural(x, z, nt)
    const aLat = Math.abs(nt.lat)
    const hw = TRACK.halfWidth, so = TRACK.shoulderOuter
    if (aLat < 26) {
      const emb = this.embedWeight(nt.s)
      if (emb > 0.001) {
        const tz = this.spline.zoneRange('tunnel')
        const inBore = nt.s > tz.s0 - 4 && nt.s < tz.s1 + 4
        const bed = this.spline.bedY(nt.s, clamp(nt.lat, -so - 3, so + 3)) - 0.03
        // at the bore the corridor narrows to the shell soffit, so the ridge
        // hugs the tube and it never shows its flanks to the sky
        const w = (inBore ? 1 - smoothstep(so + 1.3, so + 7, aLat) : 1 - smoothstep(so - 3.2, 18, aLat)) * emb
        if (w > 0) h = lerp(h, bed, w)
      }
    }
    return h
  }

  /** Under water? (for colouring the sea floor darker). */
  private underwater(h: number): boolean { return h < this.seaLevel - 0.25 }

  /** Zone whose palette the ground reads as (used by paint + dressing). */
  zoneAt(x: number, z: number, near?: Nearest): ZoneId {
    const nt = near ?? this.spline.nearest(x, z)
    const w = this.weights(nt.s)
    let best: ZoneId = 'coastal', bw = -1
    for (let i = 0; i < ZONE_LIST.length; i++) if (w[i] > bw) { bw = w[i]; best = ZONE_LIST[i] }
    return best
  }

  /** Build the corridor height-field as cullable tiles with vertex colours. */
  mesh(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'terrain'
    const b = this.spline.bounds()
    const m = G.margin
    const x0 = Math.floor(b.minX - m), x1 = Math.ceil(b.maxX + m)
    const z0 = Math.floor(b.minZ - m), z1 = Math.ceil(b.maxZ + m)
    const step = G.cell, tile = G.tile
    const detail = groundDetailTexture()
    const mat = new THREE.MeshStandardMaterial({ map: detail, roughness: 0.97, metalness: 0, vertexColors: true })
    for (let tx = x0; tx < x1; tx += tile) {
      for (let tz = z0; tz < z1; tz += tile) {
        const tileMesh = this.tile(Math.max(x0, tx), Math.min(x1, tx + tile), Math.max(z0, tz), Math.min(z1, tz + tile), step, mat)
        if (tileMesh) group.add(tileMesh)
      }
    }
    return group
  }

  private tile(x0: number, x1: number, z0: number, z1: number, step: number, mat: THREE.Material): THREE.Mesh | null {
    const NX = Math.max(1, Math.round((x1 - x0) / step)), NZ = Math.max(1, Math.round((z1 - z0) / step))
    const dx = (x1 - x0) / NX, dz = (z1 - z0) / NZ
    const w = NX + 1, hh = NZ + 1
    const pos = new Float32Array(w * hh * 3)
    const col = new Float32Array(w * hh * 3)
    const uv = new Float32Array(w * hh * 2)
    const H = new Float32Array(w * hh)
    // pass 1 — heights (road-corridor embedded); the nearest query is shared
    // with pass 2 so the field costs one plan-grid lookup per vertex
    const nears = new Array<Nearest>(w * hh)
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < w; i++) {
        const x = x0 + i * dx, z = z0 + j * dz
        const k = j * w + i
        const nt = this.spline.nearest(x, z)
        nears[k] = nt
        const y = this.height(x, z, nt)
        H[k] = y
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z
        uv[k * 2] = x * 0.36
        uv[k * 2 + 1] = z * 0.36
      }
    }
    // cull tiles that are nothing but far field (keeps the loop's empty corners down)
    let min = 1e9, max = -1e9
    for (let k = 0; k < H.length; k++) { if (H[k] < min) min = H[k]; if (H[k] > max) max = H[k] }
    if (max - min < 0.05 && max < this.seaLevel - 3) return null
    // pass 2 — colours from heightfield gradients
    const c = new THREE.Color()
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i
        const xl = H[k - (i > 0 ? 1 : 0)], xr = H[k + (i < w - 1 ? 1 : 0)]
        const zd = H[k - (j > 0 ? w : 0)], zu = H[k + (j < hh - 1 ? w : 0)]
        const slope = (Math.abs(xr - xl) / (dx * 2) + Math.abs(zu - zd) / (dz * 2)) * 0.5
        const x = x0 + i * dx, z = z0 + j * dz
        this.paint(x, z, H[k], slope, c, nears[k])
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b
      }
    }
    const idx: number[] = []
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * w + i, b = a + 1, d = a + w, e = d + 1
      idx.push(a, d, b, d, e, b)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    sanitizeGeometry(geo)
    crNormals(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.name = 'terrain-tile'
    return mesh
  }

  private paint(x: number, z: number, h: number, slope: number, c: THREE.Color, near: Nearest): void {
    const v = fbm2(x * 0.05 + 12.7, z * 0.05 + 4.1, 3)
    // second grain scale at its own patch mask — breaks single-frequency read
    const fine = fbm2(x * 0.055 + 1.7, z * 0.055 + 8.9, 2)
    const patch = smoothstep(0.5, 0.72, fbm2(x * 0.011 + 4.4, z * 0.011 + 2.2, 2))
    const mott = 1 - smoothstep(0.34, 0.58, fbm2(x * 0.085 + 7.1, z * 0.085 + 3.3, 2))
    const aLat = Math.abs(near.lat)
    if (this.underwater(h)) {
      const d = clamp((this.seaLevel - h) / 5, 0, 1)
      const grit = hash21(Math.floor(x * 1.7) + 3, Math.floor(z * 1.7) + 7) > 0.99 ? 0.1 : 0
      c.setRGB(lerp(0.24, 0.1, d) + grit, lerp(0.36, 0.16, d) + grit * 0.8, lerp(0.34, 0.2, d) + grit * 0.6)
      return
    }
    const zone = this.zoneAt(x, z, near)
    // grass/scrub base with scale-varied blotching
    const g1 = { r: 0.26, g: 0.33, b: 0.16 }
    const g2 = { r: 0.42, g: 0.47, b: 0.25 }
    const gv = clamp(v * (1 - patch * 0.35) + fine * 0.28 * patch, 0, 1)
    c.setRGB(lerp(g1.r, g2.r, gv), lerp(g1.g, g2.g, gv), lerp(g1.b, g2.b, gv))
    c.multiplyScalar(lerp(1, 0.78 + patch * 0.22, mott * 0.85))
    // zone palette: works grit under the industrial bench, dry bench scrub on
    // the ridge, mown apron at the straight, scree on the bore's ridge
    const zt = { coastal: 0, industrial: 0, tunnel: 0, elevated: 0, final: 0, start: 0 }
    zt[zone] = 1
    if (zt.industrial + zt.tunnel > 0) {
      const gritv = 0.3 + v * 0.1
      const oil = smoothstep(0.55, 0.8, fbm2(x * 0.03 + 2.2, z * 0.03 + 9.9, 2)) * 0.5
      c.setRGB(lerp(c.r, gritv, (zt.industrial * 0.72 + zt.tunnel * 0.9)),
        lerp(c.g, gritv * (1 - oil * 0.4), (zt.industrial * 0.72 + zt.tunnel * 0.9)),
        lerp(c.b, gritv * 0.82, (zt.industrial * 0.72 + zt.tunnel * 0.9)))
    }
    if (zt.elevated > 0) {
      // the north-city floor reads as packed dirt and CONCRETE dust between
      // blocks — cool grey, so the dusk light does not turn it magenta
      const dust = smoothstep(0.42, 0.72, fbm2(x * 0.02 + 5.5, z * 0.02 + 1.1, 3))
      c.setRGB(lerp(c.r, lerp(0.39, 0.45, dust), 0.7), lerp(c.g, lerp(0.39, 0.44, dust), 0.7), lerp(c.b, lerp(0.4, 0.45, dust), 0.7))
    }
    if (zt.final > 0) {
      const scrub = smoothstep(0.46, 0.76, fbm2(x * 0.026 + 7.7, z * 0.026 + 3.3, 3))
      c.setRGB(lerp(c.r, lerp(0.3, 0.36, scrub), 0.5), lerp(c.g, lerp(0.3, 0.33, scrub), 0.5), lerp(c.b, lerp(0.22, 0.24, scrub), 0.5))
    }
    if (zt.start > 0) {
      const mown = smoothstep(0.4, 0.8, fbm2(x * 0.033 + 9.1, z * 0.033 + 6.6, 2))
      c.setRGB(lerp(c.r, lerp(0.28, 0.34, mown), 0.55), lerp(c.g, lerp(0.38, 0.44, mown), 0.55), lerp(c.b, lerp(0.17, 0.2, mown), 0.55))
    }
    // dry grass patches inland at two scales
    const dry = smoothstep(0.66, 0.84, fbm2(x * 0.018 + 2.2, z * 0.018 + 6.6, 3))
      + smoothstep(0.74, 0.9, fbm2(x * 0.007 + 8.3, z * 0.007 + 0.9, 2)) * 0.7
    const dryT = clamp(dry, 0, 1) * 0.34
    c.setRGB(lerp(c.r, 0.5, dryT), lerp(c.g, 0.47, dryT), lerp(c.b, 0.31, dryT))
    // rock on steep slopes (cliff faces), grainy
    const rock = smoothstep(0.75, 1.7, slope)
    const rv = 0.42 + v * 0.12 + fine * 0.05
    c.setRGB(lerp(c.r, rv, rock), lerp(c.g, rv * 0.96, rock), lerp(c.b, rv * 0.9, rock))
    // sand/gravel near the shoulder + cliff-top dunes, tone-shifted per patch.
    // Phase 5C: WARM sand — the dusk sky's blue tilt used to drag these to a
    // pink/mauve read, so the base pulls red up and blue well down.
    const band = smoothstep(11, 7.6, aLat) * (aLat > TRACK.shoulderOuter ? 1 : 0)
    const dune = smoothstep(0.71, 0.87, fbm2(x * 0.02 + 9, z * 0.02 + 1, 3)) * smoothstep(-16, -30, z)
    const sand = Math.max(band, dune * 0.85)
    const sr = 0.56 + fine * 0.12 + patch * 0.06
    c.setRGB(lerp(c.r, sr, sand), lerp(c.g, sr * 0.92, sand), lerp(c.b, sr * 0.55, sand))
    // sea-side land reads beach sand, not scrub — kills the green shelf slab
    const zE = z + (fbm2(x * 0.016 + 0.7, 5.1, 2) - 0.5) * C.edgeMeander
    const beach = smoothstep(C.cliffZTop + 18, C.cliffZTop - 6, zE) * (1 - rock)
    c.setRGB(lerp(c.r, 0.62 + fine * 0.1, beach), lerp(c.g, 0.565 + fine * 0.085, beach), lerp(c.b, 0.34 + fine * 0.06, beach))
    // wet/dry shore gradient: damp darkening hugging the waterline
    const wet = smoothstep(this.seaLevel + 0.12, this.seaLevel + 2.6, h)
    c.multiplyScalar(lerp(0.62, 1, wet))
    // scattered shell grit flecks
    if (hash21(Math.floor(x * 0.45) + 11, Math.floor(z * 0.45) + 5) > 0.965) c.multiplyScalar(1.2)
  }

  /** Bake a height map of the field for the water shader (depth + foam). */
  shoreTexture(): { texture: THREE.Texture; x0: number; z0: number; spanX: number; spanZ: number } {
    const x0 = -320, z0 = -300, spanX = 640, spanZ = 480
    const W = 512, H = 384
    const { canvas, ctx } = makeCanvas(W, H)
    const img = ctx.createImageData(W, H)
    const yMin = -14, yMax = 10
    for (let j = 0; j < H; j++) {
      const z = z0 + (j / (H - 1)) * spanZ
      // North of the shelf the field is dry land everywhere (the sea only
      // exists below the cliff line), so the bake saturates without sampling.
      if (z > C.cliffZTop + 26) {
        const v = 255
        for (let i = 0; i < W; i++) { const k = (j * W + i) * 4; img.data[k] = v; img.data[k + 1] = v; img.data[k + 2] = v; img.data[k + 3] = 255 }
        continue
      }
      for (let i = 0; i < W; i++) {
        const x = x0 + (i / (W - 1)) * spanX
        const y = clamp(this.natural(x, z), yMin, yMax)
        const v = ((y - yMin) / (yMax - yMin)) * 255
        const k = (j * W + i) * 4
        img.data[k] = v; img.data[k + 1] = v; img.data[k + 2] = v; img.data[k + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return { texture, x0, z0, spanX, spanZ }
  }
}

void SEED; void THEME; void crNormals
