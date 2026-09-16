import * as THREE from 'three'
import { TRACK, THEME, SEED } from '../config'
import { clamp, lerp, smoothstep, fbm2, hash21, makeCanvas, sanitizeGeometry, crNormals } from '../util'
import { groundDetailTexture } from '../assets/Textures'
import type { TrackSpline } from './TrackSpline'

/* ------------------------------------------------------------------------- *
 * Coastal height-field (spec §4.4/§8): designed field — gentle inland,
 * meandering cliff line dropping to a sea floor, hills to the north;
 * the road corridor is blended INTO the field (road-bed profile over a
 * smoothstep falloff) so the road sits embedded, plus an authored pad for
 * the building cluster. Vertex-coloured, no hard texture seams.
 * ------------------------------------------------------------------------- */

const C = TRACK.coast

export class CoastField {
  readonly seaLevel = C.seaLevel
  private spline: TrackSpline
  private pad: { x: number; z: number; r: number; y: number }

  constructor(spline: TrackSpline) {
    this.spline = spline
    const padY = spline.roadY(spline.sFromX(TRACK.cluster.x)) + 0.25
    this.pad = { x: TRACK.cluster.x, z: TRACK.cluster.z, r: TRACK.cluster.padR, y: padY }
  }

  /** Designed natural terrain height at world (x, z). */
  natural(x: number, z: number): number {
    const f = fbm2(x * 0.013 + 5.1, z * 0.013 + 9.7, 4)
    let h = (f - 0.5) * C.fieldAmp - 0.15
    // northern ridge/hills behind the cluster
    if (z > C.northHillStart) {
      const t = smoothstep(C.northHillStart, C.northHillStart + 90, z)
      h += Math.max(0, z - C.northHillStart) * C.northHillRise + t * fbm2(x * 0.008 + 1.3, z * 0.008, 3) * C.northHillNoise
    }
    // meandering cliff line + sea floor
    const zE = z + (fbm2(x * 0.016 + 0.7, 5.1, 2) - 0.5) * C.edgeMeander
    const shelf = 1.4 + fbm2(x * 0.021 + 3.3, 7.7, 3) * C.shelfAmp
    const s1 = smoothstep(C.cliffZTop, C.cliffZTop - 10, zE)
    const s2 = smoothstep(C.cliffZBase + 8, C.cliffZBase, zE)
    h = lerp(h, shelf, s1)
    h = lerp(h, (shelf + C.seaFloor) * 0.5 - 0.8, s1 * s2)
    h = lerp(h, C.seaFloor - fbm2(x * 0.03 + 8.1, 2.7, 2) * 1.6, s2)
    // authored cluster pad
    const pd = Math.hypot(x - this.pad.x, z - this.pad.z)
    const pw = 1 - smoothstep(this.pad.r * 0.62, this.pad.r * 1.35, pd)
    h = lerp(h, this.pad.y, pw * 0.94)
    return h
  }

  /** Road-embedded corridor: blends the engineered road-bed into the field. */
  height(x: number, z: number): number {
    let h = this.natural(x, z)
    const near = this.spline.nearest(x, z)
    const aLat = Math.abs(near.lat)
    const hw = TRACK.halfWidth, so = TRACK.shoulderOuter
    if (aLat < 26) {
      const bed = this.spline.bedY(near.s, clamp(near.lat, -so - 3, so + 3)) - 0.03
      const w = 1 - smoothstep(so - 3.2, 18, aLat)
      if (w > 0) h = lerp(h, bed, w)
    }
    return h
  }

  /** Under water? (for colouring the sea floor darker). */
  private underwater(h: number): boolean { return h < this.seaLevel - 0.25 }

  /** Build the corridor height-field mesh with vertex colours. */
  mesh(): THREE.Mesh {
    const NX = 210, NZ = 172
    const x0 = -220, x1 = 240, z0 = -150, z1 = 190
    const dx = (x1 - x0) / NX, dz = (z1 - z0) / NZ
    const w = NX + 1, hh = NZ + 1
    const pos = new Float32Array(w * hh * 3)
    const col = new Float32Array(w * hh * 3)
    const uv = new Float32Array(w * hh * 2)
    const H = new Float32Array(w * hh)
    // pass 1 — heights (road-corridor embedded)
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < w; i++) {
        const x = x0 + i * dx
        const z = z0 + j * dz
        const k = j * w + i
        const y = this.height(x, z)
        H[k] = y
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z
        uv[k * 2] = x * 0.36
        uv[k * 2 + 1] = z * 0.36
      }
    }
    // pass 2 — colours from heightfield gradients
    const c = new THREE.Color()
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i
        const xl = H[k - (i > 0 ? 1 : 0)], xr = H[k + (i < w - 1 ? 1 : 0)]
        const zd = H[k - (j > 0 ? w : 0)], zu = H[k + (j < hh - 1 ? w : 0)]
        const slope = (Math.abs(xr - xl) / (dx * 2) + Math.abs(zu - zd) / (dz * 2)) * 0.5
        this.paint(x0 + i * dx, z0 + j * dz, H[k], slope, c)
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b
      }
    }
    const idx: number[] = []
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * w + i, b = a + 1, d = a + w, e = d + 1
      idx.push(a, b, d, b, e, d)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    sanitizeGeometry(geo)
    const detail = groundDetailTexture()
    const mat = new THREE.MeshStandardMaterial({
      map: detail, roughness: 0.97, metalness: 0, vertexColors: true,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.name = 'terrain'
    return mesh
  }

  private paint(x: number, z: number, h: number, slope: number, c: THREE.Color): void {
    const v = fbm2(x * 0.05 + 12.7, z * 0.05 + 4.1, 3)
    const near = this.spline.nearest(x, z)
    const aLat = Math.abs(near.lat)
    if (this.underwater(h)) {
      const d = clamp((this.seaLevel - h) / 5, 0, 1)
      c.setRGB(lerp(0.24, 0.1, d), lerp(0.36, 0.16, d), lerp(0.34, 0.2, d))
      return
    }
    // grass/scrub base
    const g1 = { r: 0.26, g: 0.33, b: 0.16 }
    const g2 = { r: 0.42, g: 0.47, b: 0.25 }
    c.setRGB(lerp(g1.r, g2.r, v), lerp(g1.g, g2.g, v), lerp(g1.b, g2.b, v))
    // dry grass patches inland
    const dry = smoothstep(0.66, 0.84, fbm2(x * 0.018 + 2.2, z * 0.018 + 6.6, 3))
    c.setRGB(lerp(c.r, 0.5, dry * 0.34), lerp(c.g, 0.47, dry * 0.34), lerp(c.b, 0.31, dry * 0.34))
    // rock on steep slopes (cliff faces)
    const rock = smoothstep(0.75, 1.7, slope)
    const rv = 0.42 + v * 0.12
    c.setRGB(lerp(c.r, rv, rock), lerp(c.g, rv * 0.96, rock), lerp(c.b, rv * 0.9, rock))
    // sand/gravel near the shoulder + cliff-top dunes
    const band = smoothstep(11, 7.6, aLat) * (aLat > TRACK.shoulderOuter ? 1 : 0)
    const dune = smoothstep(0.71, 0.87, fbm2(x * 0.02 + 9, z * 0.02 + 1, 3)) * smoothstep(-16, -30, z)
    const sand = Math.max(band, dune * 0.85)
    c.setRGB(lerp(c.r, 0.55, sand), lerp(c.g, 0.48, sand), lerp(c.b, 0.34, sand))
    // shoreline light band
    const shore = smoothstep(this.seaLevel + 0.7, this.seaLevel - 0.2, h) * (1 - rock)
    c.setRGB(lerp(c.r, 0.6, shore), lerp(c.g, 0.55, shore), lerp(c.b, 0.42, shore))
    void hash21
  }

  /** Bake a height map of the field for the water shader (depth + foam). */
  shoreTexture(): { texture: THREE.Texture; x0: number; z0: number; spanX: number; spanZ: number } {
    const x0 = -320, z0 = -300, spanX = 640, spanZ = 480
    const W = 512, H = 384
    const { canvas, ctx } = makeCanvas(W, H)
    const img = ctx.createImageData(W, H)
    const yMin = -14, yMax = 10
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = x0 + (i / (W - 1)) * spanX
        const z = z0 + (j / (H - 1)) * spanZ
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
