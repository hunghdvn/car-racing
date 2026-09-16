import * as THREE from 'three'
import { canvasTexture, normalFromHeightCanvas, heightCanvasFrom, clamp01, fbm2, Rand, roundRectPath } from '../util'

/* ------------------------------------------------------------------------- *
 * Procedural PBR texture library (original canvases, ≤1024² budget).
 * Phase 2 slice covers the hero car; more families land in Phase 4 (Gate M).
 * ------------------------------------------------------------------------- */

const cache = new Map<string, unknown>()
function cached<T>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined
  if (!t) { t = make(); cache.set(key, t) }
  return t
}

/** Metallic-paint micro variation: orange-peel normal + roughness jitter. */
export function carPaintMaps(seed = 7): { normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  return {
    normalMap: cached(`paintN${seed}`, () => {
      const h = heightCanvasFrom((x, y, w, hh) => 0.5 + 0.5 * fbm2(x / 7 + seed, y / 7 + seed * 1.7, 3, 2.3, 0.5), 256, 256)
      const n = normalFromHeightCanvas(h, 0.16)
      const t = new THREE.CanvasTexture(n)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(2, 2)
      t.needsUpdate = true
      return t
    }),
    roughnessMap: cached(`paintR${seed}`, () =>
      canvasTexture(128, 128, (ctx, w, hh) => {
        const img = ctx.createImageData(w, hh)
        const rnd = new Rand(seed)
        for (let i = 0; i < w * hh; i++) {
          const v = 88 + Math.floor(rnd.next() * 42)
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
          img.data[i * 4 + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
      }, { repeatX: 3, repeatY: 3 }),
    ),
  }
}

/** Tire tread band normal (circumferential grooves + sipes). */
export function tireTreadNormal(): THREE.Texture {
  return cached('tireN', () => {
    const h = heightCanvasFrom((x, y, w, hh) => {
      const groove = Math.abs(Math.sin((x / w) * Math.PI * 2 * 13))
      const sip = Math.abs(Math.sin((y / hh) * Math.PI * 2 * 3))
      return clamp01(groove * 0.75 + 0.18 + sip * 0.06)
    }, 256, 128)
    const n = normalFromHeightCanvas(h, 1.7)
    const t = new THREE.CanvasTexture(n)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1, 1)
    t.needsUpdate = true
    return t
  })
}

/** Alloy face subtle brushed roughness. */
export function alloyRoughness(): THREE.Texture {
  return cached('alloyR', () =>
    canvasTexture(128, 128, (ctx, w, hh) => {
      const img = ctx.createImageData(w, hh)
      const rnd = new Rand(21)
      for (let y = 0; y < hh; y++) {
        const band = 0.22 + 0.1 * Math.sin(y * 0.9)
        for (let x = 0; x < w; x++) {
          const v = clamp01(band + rnd.next() * 0.16 - 0.08) * 255
          const i = (y * w + x) * 4
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v
          img.data[i + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
    }, { repeatX: 2, repeatY: 2 }),
  )
}

/** Rounded rect three Shape (bevel-ready profiles for plates/panels). */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2, y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}


/**
 * ExtrudeGeometry leaves zero-length normals on some bevel/side seams 
 * those poison the PBR fragment path (NaN out) and bloom spreads it across
 * the frame. Replace any invalid normal with the position-welded average
 * of its incident face normals.
 */
function repairExtrudeNormals(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute
  const idx = g.getIndex() as THREE.BufferAttribute | null
  const n = pos.count
  const faceAcc = new Map<string, number[]>()
  const key = (i: number): string => `${Math.round(pos.getX(i) * 1e4)}|${Math.round(pos.getY(i) * 1e4)}|${Math.round(pos.getZ(i) * 1e4)}`
  const add = (ia: number, ib: number, ic: number): void => {
    const ux = pos.getX(ib) - pos.getX(ia), uy = pos.getY(ib) - pos.getY(ia), uz = pos.getZ(ib) - pos.getZ(ia)
    const vx = pos.getX(ic) - pos.getX(ia), vy = pos.getY(ic) - pos.getY(ia), vz = pos.getZ(ic) - pos.getZ(ia)
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    if (!Number.isFinite(fx + fy + fz) || fx * fx + fy * fy + fz * fz < 1e-12) return
    for (const vi of [ia, ib, ic]) {
      const k = key(vi)
      let a = faceAcc.get(k)
      if (!a) { a = [0, 0, 0]; faceAcc.set(k, a) }
      a[0] += fx; a[1] += fy; a[2] += fz
    }
  }
  if (idx) for (let f = 0; f < idx.count; f += 3) add(idx.getX(f), idx.getX(f + 1), idx.getX(f + 2))
  else for (let f = 0; f + 2 < n; f += 3) add(f, f + 1, f + 2)
  const cur = g.getAttribute("normal") as THREE.BufferAttribute | null
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    let x = cur ? cur.getX(i) : 0, y = cur ? cur.getY(i) : 0, z = cur ? cur.getZ(i) : 0
    let len = Number.isFinite(x + y + z) ? Math.sqrt(x * x + y * y + z * z) : 0
    if (len < 1e-4) {
      const a = faceAcc.get(key(i))
      if (a) { x = a[0]; y = a[1]; z = a[2] } else { x = 0; y = 0; z = 1 }
      len = Math.sqrt(x * x + y * y + z * z)
      if (!Number.isFinite(len) || len < 1e-6) { x = 0; y = 0; z = 1; len = 1 }
    }
    arr[i * 3] = x / len; arr[i * 3 + 1] = y / len; arr[i * 3 + 2] = z / len
  }
  g.setAttribute("normal", new THREE.Float32BufferAttribute(arr, 3))
}

/** Beveled rounded box substitute — plates, bumpers, spoilers, panels. */
export function roundedPlateGeo(w: number, h: number, t: number, r: number, bevel = 0.015): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w, h, Math.min(r, w / 2 - 0.001, h / 2 - 0.001)), {
    depth: t - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  })
  g.translate(0, 0, -(t - bevel * 2) / 2)
  repairExtrudeNormals(g)
  return g
}

/** Soft radial sprite (smoke/spark/flame particles, Phase 6 — kept here for reuse). */
export function softSprite(white = false): THREE.Texture {
  return cached(white ? 'spriteW' : 'spriteS', () =>
    canvasTexture(64, 64, (ctx, w, hh) => {
      const g = ctx.createRadialGradient(w / 2, hh / 2, 1, w / 2, hh / 2, w / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.45, 'rgba(255,255,255,.55)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, hh)
    }, { srgb: false, clamp: true }),
  )
}

export { roundRectPath }

/* ---------------------------------------------------------------------------
 * Phase 3 — constructed-infrastructure families (spec §7/§11): worn asphalt,
 * formed concrete, curbing, gravel shoulders, patch/crack decals, signage.
 * ------------------------------------------------------------------------- */

/** Worn asphalt: aggregate + stains + hairline cracks (tiled 1 tile = 6 m). */
export function asphaltMaps(): { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const S = 512
  const rnd = new Rand(4711)
  const base = canvasTexture(S, S, (ctx, w, h) => {
    ctx.fillStyle = '#474b52'
    ctx.fillRect(0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    for (let i = 0; i < w * h; i++) {
      const n = (rnd.next() - 0.5) * 34 + (rnd.next() < 0.012 ? -46 : 0)
      const i4 = i * 4
      img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
      img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n) / 255) * 255
      img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n) / 255) * 255
    }
    ctx.putImageData(img, 0, 0)
    // oil blooms + old patch ghosts
    for (let k = 0; k < 8; k++) {
      const x = rnd.next() * w, y = rnd.next() * h, r = 12 + rnd.next() * 40
      const g = ctx.createRadialGradient(x, y, 1, x, y, r)
      g.addColorStop(0, rnd.chance(0.5) ? 'rgba(12,13,16,0.5)' : 'rgba(74,70,62,0.34)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x, y, r * 2, r * 2)
    }
    // hairline crack polylines
    ctx.strokeStyle = 'rgba(18,19,22,0.75)'
    for (let k = 0; k < 7; k++) {
      ctx.lineWidth = 0.8 + rnd.next() * 1.6
      ctx.beginPath()
      let x = rnd.next() * w, y = rnd.next() * h
      ctx.moveTo(x, y)
      for (let q = 0; q < 7; q++) { x += (rnd.next() - 0.45) * 60; y += (rnd.next() - 0.5) * 60; ctx.lineTo(x, y) }
      ctx.stroke()
    }
  }, { srgb: true, repeatX: 1, repeatY: 1 })
  const height = heightCanvasFrom((x, y) => {
    const agg = rnd.next() > 0.72 ? 0.28 : 0
    return clamp01(0.45 + (rnd.next() - 0.5) * 0.22 + agg * fbm2(x / 5, y / 5, 2) * 0.6)
  }, 256, 256)
  const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, 2.1))
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping
  normal.needsUpdate = true
  const rough = canvasTexture(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      const v = clamp01(0.72 + (rnd.next() - 0.5) * 0.3) * 255
      const i4 = i * 4
      img.data[i4] = img.data[i4 + 1] = img.data[i4 + 2] = v
      img.data[i4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  })
  return { map: base, normalMap: normal, roughnessMap: rough }
}

/** Formed/poured concrete with form-tie grid (buildings, barriers, pads). */
export function concreteMaps(tone = 0xb9b4a9, seed = 91): { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  return cached(`conc${tone}_${seed}`, () => {
    const rnd = new Rand(seed)
    const hex = `#${tone.toString(16).padStart(6, '0')}`
    const map = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i++) {
        const n = (rnd.next() - 0.5) * 26
        const i4 = i * 4
        img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
        img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n) / 255) * 255
        img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n * 0.8) / 255) * 255
      }
      ctx.putImageData(img, 0, 0)
      ctx.strokeStyle = 'rgba(40,38,34,0.28)'
      ctx.lineWidth = 1.6
      for (const p of [w / 2, 6, w - 6]) {
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke()
      }
      // water staining streaks
      ctx.fillStyle = 'rgba(46,48,42,0.16)'
      for (let k = 0; k < 5; k++) ctx.fillRect(rnd.next() * w, 0, 2 + rnd.next() * 4, h)
    }, { srgb: true })
    const height = heightCanvasFrom((x, y) => {
      const line = (x % 128 < 2 || y % 128 < 2) ? -0.3 : 0
      return clamp01(0.5 + (rnd.next() - 0.5) * 0.3 + line)
    }, 128, 128)
    const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, 1.5))
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.needsUpdate = true
    const rough = canvasTexture(128, 128, (ctx, w, h) => {
      const img = ctx.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const v = clamp01(0.78 + (rnd.next() - 0.5) * 0.24) * 255
        const i4 = i * 4
        img.data[i4] = img.data[i4 + 1] = img.data[i4 + 2] = v
        img.data[i4 + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
    })
    return { map, normalMap: normal, roughnessMap: rough }
  })
}

/** Red/white alternating curb faces + black/yellow rumble blocks (tiled along run). */
export function curbStripeTexture(kind: 'curb' | 'rumble'): THREE.Texture {
  return cached(`stripe${kind}`, () =>
    canvasTexture(256, 32, (ctx, w, h) => {
      const bands = kind === 'curb' ? ['#c23b31', '#e8e6de'] : ['#1c1e22', '#d8a41d']
      for (let b = 0; b < 4; b++) {
        ctx.fillStyle = bands[b % 2]
        ctx.fillRect((b * w) / 4, 0, w / 4, h)
      }
      const rnd = new Rand(1234)
      const img = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i++) {
        const n = (rnd.next() - 0.5) * 30
        const i4 = i * 4
        img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
        img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n) / 255) * 255
        img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n) / 255) * 255
      }
      ctx.putImageData(img, 0, 0)
    }, { srgb: true }),
  )
}

/** Gravel/dirt shoulder blend. */
export function gravelMaps(): { map: THREE.Texture; normalMap: THREE.Texture } {
  return cached('gravel', () => {
    const rnd = new Rand(8801)
    const map = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#7d6f5c'
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i++) {
        const n = (rnd.next() - 0.5) * 52
        const i4 = i * 4
        img.data[i4] = clamp01((img.data[i4] + n * 1.05) / 255) * 255
        img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n * 0.9) / 255) * 255
        img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n * 0.7) / 255) * 255
      }
      ctx.putImageData(img, 0, 0)
      for (let k = 0; k < 130; k++) {
        ctx.fillStyle = rnd.chance(0.5) ? 'rgba(190,180,160,0.6)' : 'rgba(52,46,38,0.5)'
        ctx.fillRect(rnd.next() * w, rnd.next() * h, 1.5 + rnd.next() * 3, 1.5 + rnd.next() * 3)
      }
    }, { srgb: true })
    const height = heightCanvasFrom(() => clamp01(0.5 + (rnd.next() - 0.5) * 0.9), 128, 128)
    const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, 2.8))
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.needsUpdate = true
    return { map, normalMap: normal }
  })
}

/** Asphalt patch/crack decal (RGBA) — layered over worn road like real repairs. */
export function patchDecalTexture(): THREE.Texture {
  return cached('patch', () =>
    canvasTexture(256, 256, (ctx, w, h) => {
      const rnd = new Rand(3307)
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2
      const pts: [number, number][] = []
      const n = 11
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const r = 46 + rnd.next() * 52
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8])
      }
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = 'rgba(26,28,31,0.88)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(96,94,88,0.55)'
      ctx.lineWidth = 2.2
      ctx.stroke()
      // radiating cracks
      ctx.strokeStyle = 'rgba(20,21,24,0.7)'
      for (let k = 0; k < 5; k++) {
        ctx.lineWidth = 1 + rnd.next() * 1.4
        ctx.beginPath()
        const a = rnd.next() * Math.PI * 2
        let x = cx + Math.cos(a) * 50, y = cy + Math.sin(a) * 40
        ctx.moveTo(x, y)
        for (let q = 0; q < 5; q++) { x += Math.cos(a) * 16 + (rnd.next() - 0.5) * 22; y += Math.sin(a) * 14 + (rnd.next() - 0.5) * 22; ctx.lineTo(x, y) }
        ctx.stroke()
      }
    }, { srgb: true, clamp: true }),
  )
}

/** Painted warning/venue signage faces (original artwork, canvas-drawn). */
export function signFaceTexture(kind: 'jump' | 'speed' | 'store' | 'cafe' | 'tyres'): THREE.Texture {
  return cached(`sign${kind}`, () =>
    canvasTexture(512, 256, (ctx, w, h) => {
      const rnd = new Rand(kind.length * 131 + 7)
      if (kind === 'jump') {
        ctx.fillStyle = '#e8e6de'
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = '#1b1d21'
        ctx.lineWidth = 14
        ctx.strokeRect(8, 8, w - 16, h - 16)
        ctx.fillStyle = '#b8341f'
        ctx.fillRect(8, 8, w - 16, 54)
        ctx.fillStyle = '#f4f2ea'
        ctx.font = 'bold 42px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('BIG AIR AHEAD', w / 2, 50)
        ctx.fillStyle = '#1b1d21'
        for (let k = 0; k < 2; k++) {
          const y = 108 + k * 64
          ctx.beginPath()
          ctx.moveTo(w / 2 - 90, y + 34); ctx.lineTo(w / 2, y); ctx.lineTo(w / 2 + 90, y + 34)
          ctx.lineTo(w / 2 + 62, y + 34); ctx.lineTo(w / 2, y + 12); ctx.lineTo(w / 2 - 62, y + 34)
          ctx.closePath(); ctx.fill()
        }
      } else if (kind === 'speed') {
        ctx.fillStyle = '#f2efe6'
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = '#c02d24'
        ctx.lineWidth = 26
        ctx.beginPath(); ctx.arc(w / 2, h / 2, 92, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = '#1b1d21'
        ctx.font = 'bold 96px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('60', w / 2, h / 2 + 6)
      } else {
        const bg = kind === 'store' ? '#17585c' : kind === 'cafe' ? '#5c3a26' : '#24502f'
        const ink = '#f4f1e4'
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 8
        ctx.strokeRect(6, 6, w - 12, h - 12)
        ctx.fillStyle = ink
        ctx.textAlign = 'center'
        if (kind === 'store') {
          ctx.font = 'bold 54px sans-serif'
          ctx.fillText('HARBOUR MOTO', w / 2, 96)
          ctx.font = 'bold 30px sans-serif'
          ctx.fillText('OPEN 24 HOURS', w / 2, 168)
        } else if (kind === 'cafe') {
          ctx.font = 'bold 56px sans-serif'
          ctx.fillText('CAFE MARLIN', w / 2, 112)
          ctx.fillStyle = '#e0d9b8'
          ctx.fillRect(w / 2 - 34, 142, 58, 44)
          ctx.beginPath(); ctx.arc(w / 2 + 40, 164, 16, -1.2, 1.2); ctx.lineWidth = 8; ctx.strokeStyle = '#e0d9b8'; ctx.stroke()
        } else {
          ctx.font = 'bold 44px sans-serif'
          ctx.fillText('TYRES - SUSPENSION', w / 2, 96)
          ctx.font = 'bold 34px sans-serif'
          ctx.fillText('BRAKES - EXHAUST', w / 2, 160)
        }
        // weathering
        const img = ctx.getImageData(0, 0, w, h)
        for (let i = 0; i < w * h; i += 2) {
          if (rnd.next() < 0.06) {
            const i4 = i * 4
            img.data[i4 + 3] *= rnd.next() < 0.5 ? 0.82 : 1
          }
        }
        ctx.putImageData(img, 0, 0)
      }
    }, { srgb: true, clamp: true }),
  )
}

/** Kicker ramp launch face: formed concrete + painted launch chevrons. */
export function kickerFaceTexture(): THREE.Texture {
  return cached('kickerFace', () => {
    const rnd = new Rand(881)
    return canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#b0a896'
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i++) {
        const n = (rnd.next() - 0.5) * 26
        const i4 = i * 4
        img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
        img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n) / 255) * 255
        img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n * 0.85) / 255) * 255
      }
      ctx.putImageData(img, 0, 0)
      ctx.strokeStyle = 'rgba(38,36,32,0.4)'
      ctx.lineWidth = 3
      for (const px of [127, 255, 383]) { ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke() }
      // launch chevrons pointing up the ramp
      ctx.fillStyle = '#e6e2d4'
      for (let k = 0; k < 3; k++) {
        const y = 206 - k * 62
        ctx.beginPath()
        ctx.moveTo(w / 2 - 150, y)
        ctx.lineTo(w / 2, y - 44)
        ctx.lineTo(w / 2 + 150, y)
        ctx.lineTo(w / 2 + 150, y - 20)
        ctx.lineTo(w / 2, y - 64)
        ctx.lineTo(w / 2 - 150, y - 20)
        ctx.closePath()
        ctx.fill()
      }
      ctx.strokeStyle = '#c8a228'
      ctx.lineWidth = 8
      ctx.strokeRect(10, 10, w - 20, h - 20)
    }, { srgb: true, clamp: true })
  })
}

/** Alpha card for instanced grass tufts (crossed quads). */
export function grassTuftTexture(): THREE.Texture {
  return cached('grassTuft', () => {
    const rnd = new Rand(4520)
    return canvasTexture(64, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      ctx.lineCap = 'round'
      for (let k = 0; k < 15; k++) {
        const x0 = 4 + rnd.next() * (w - 8)
        const sway = (rnd.next() - 0.5) * 22
        const top = 4 + rnd.next() * 14
        const g = ctx.createLinearGradient(0, h, 0, 0)
        g.addColorStop(0, 'rgba(46,64,26,1)')
        g.addColorStop(1, 'rgba(126,142,58,1)')
        ctx.strokeStyle = g
        ctx.lineWidth = 1.6 + rnd.next() * 2.2
        ctx.beginPath()
        ctx.moveTo(x0, h)
        ctx.quadraticCurveTo(x0 + sway * 0.4, h * 0.5, x0 + sway, top)
        ctx.stroke()
      }
    }, { srgb: true, clamp: true })
  })
}

/* ---------------------------------------------------------------------------
 * Phase 4 — building/prop kit families (spec §4.2/§5): facade styles with
 * normal + roughness relief, ballasted membrane roofs, corrugated cladding,
 * riveted plant metal, original billboard artwork, timber grain.
 * ------------------------------------------------------------------------- */

export type FacadeStyle = 'brick' | 'panel' | 'plaster'

/** Building facade families: real relief (mortar/reveal), staining, roughness. */
export function facadeMaps(style: FacadeStyle, tone = 0xb9b2a4, seed = 11): { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  return cached(`facade${style}${tone}_${seed}`, () => {
    const rnd = new Rand(seed * 7 + style.length)
    const hex = `#${tone.toString(16).padStart(6, '0')}`
    const S = 512
    const map = canvasTexture(S, S, (ctx, w, h) => {
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, w, h)
      if (style === 'brick') {
        const bh = 22, bw = 46
        for (let y = 0, row = 0; y < h; y += bh, row++) {
          for (let x = -bw / (row % 2 ? 2 : 1); x < w; x += bw) {
            const v = 0.9 + rnd.next() * 0.2
            const rr = Math.floor(clamp01(((tone >> 16) & 255) / 255 * v) * 255)
            const gg = Math.floor(clamp01(((tone >> 8) & 255) / 255 * v) * 255)
            const bb = Math.floor(clamp01(((tone >> 0) & 255) / 255 * v) * 255)
            ctx.fillStyle = `rgb(${rr},${gg},${bb})`
            ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4)
          }
        }
        ctx.fillStyle = 'rgba(58,52,44,0.30)'
        ctx.fillRect(0, 0, w, 46)
      } else if (style === 'panel') {
        const pw = 128, ph = 96
        for (let y = 0; y < h; y += ph) for (let x = 0; x < w; x += pw) {
          const v = 0.9 + rnd.next() * 0.2
          ctx.fillStyle = `rgba(${Math.floor(255 * ((tone >> 16) & 255) / 255 * v)},${Math.floor(255 * ((tone >> 8) & 255) / 255 * v)},${Math.floor(255 * ((tone >> 0) & 255) / 255 * v)},0.9)`
          ctx.fillRect(x + 3, y + 3, pw - 6, ph - 6)
          ctx.fillStyle = 'rgba(30,30,34,0.4)'
          ctx.fillRect(x + pw - 4, y, 4, ph)
          ctx.fillRect(x, y + ph - 4, pw, 4)
        }
      } else {
        const img = ctx.getImageData(0, 0, w, h)
        for (let i = 0; i < w * h; i++) {
          const n = (rnd.next() - 0.5) * 20
          const i4 = i * 4
          img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
          img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n) / 255) * 255
          img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n * 0.9) / 255) * 255
        }
        ctx.putImageData(img, 0, 0)
      }
      // water staining + grime streaks from the crown
      for (let k = 0; k < 14; k++) {
        const x = rnd.next() * w
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, `rgba(40,38,32,${0.14 + rnd.next() * 0.18})`)
        g.addColorStop(0.4 + rnd.next() * 0.4, 'rgba(42,40,34,0)')
        ctx.fillStyle = g
        ctx.fillRect(x, 0, 3 + rnd.next() * 8, h)
      }
      // damp corner darkening
      ctx.fillStyle = 'rgba(40,44,40,0.12)'
      ctx.fillRect(0, h * 0.86, w, h * 0.14)
    }, { srgb: true })
    const height = heightCanvasFrom((x, y, w, h) => {
      if (style === 'brick') {
        const bh = 22, bw = 46
        const mx = ((x % bw) + bw) % bw, my = ((y % bh) + bh) % bh
        const seam = mx < 2.5 || my < 2.5 ? -0.55 : 0
        return clamp01(0.55 + seam + (rnd.next() - 0.5) * 0.1)
      }
      if (style === 'panel') {
        const mx = x % 128, my = y % 96
        const seam = mx > 124 || my > 92 ? -0.6 : 0
        return clamp01(0.55 + seam + (rnd.next() - 0.5) * 0.08)
      }
      return clamp01(0.5 + (rnd.next() - 0.5) * 0.4 + Math.sin(x / 9) * 0.02 + Math.sin(y / 11) * 0.02)
    }, S / 2, S / 2)
    const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, style === 'plaster' ? 0.9 : 2.0))
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.needsUpdate = true
    const rough = canvasTexture(128, 128, (ctx, w, h) => {
      const img = ctx.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const v = clamp01(0.8 + (rnd.next() - 0.5) * (style === 'panel' ? 0.18 : 0.3)) * 255
        const i4 = i * 4
        img.data[i4] = img.data[i4 + 1] = img.data[i4 + 2] = v
        img.data[i4 + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
    })
    return { map, normalMap: normal, roughnessMap: rough }
  })
}

/** Ballasted flat roof: membrane seams, grit, puddle darkening (roofDeck). */
export function roofMembraneMaps(): { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  return cached('roofMem', () => {
    const rnd = new Rand(771)
    const map = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#585a58'
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i++) {
        const n = (rnd.next() - 0.5) * 30
        const i4 = i * 4
        img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
        img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n) / 255) * 255
        img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n * 0.9) / 255) * 255
      }
      ctx.putImageData(img, 0, 0)
      ctx.strokeStyle = 'rgba(28,29,28,0.65)'
      ctx.lineWidth = 2.4
      for (const p of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(0, p * h); ctx.lineTo(w, p * h); ctx.stroke() }
      for (let k = 0; k < 4; k++) {
        const x = rnd.next() * w, y = rnd.next() * h, r = 10 + rnd.next() * 26
        const g = ctx.createRadialGradient(x, y, 1, x, y, r)
        g.addColorStop(0, 'rgba(24,28,32,0.5)')
        g.addColorStop(1, 'rgba(24,28,32,0)')
        ctx.fillStyle = g
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
      for (let k = 0; k < 900; k++) {
        ctx.fillStyle = rnd.chance(0.5) ? 'rgba(150,146,132,0.35)' : 'rgba(30,31,29,0.4)'
        ctx.fillRect(rnd.next() * w, rnd.next() * h, 1.4, 1.4)
      }
    }, { srgb: true })
    const height = heightCanvasFrom(() => clamp01(0.5 + (rnd.next() - 0.5) * 0.7), 128, 128)
    const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, 2.2))
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.needsUpdate = true
    const rough = canvasTexture(128, 128, (ctx, w, h) => {
      const img = ctx.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const v = clamp01(0.85 + (rnd.next() - 0.5) * 0.2) * 255
        const i4 = i * 4
        img.data[i4] = img.data[i4 + 1] = img.data[i4 + 2] = v
        img.data[i4 + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
    })
    return { map, normalMap: normal, roughnessMap: rough }
  })
}

/** Corrugated metal cladding: rib normal, paint fade, rust bleed (warehouses). */
export function corrugatedMaps(tone = 0x7f8a92, seed = 33): { map: THREE.Texture; normalMap: THREE.Texture } {
  return cached(`corr${tone}_${seed}`, () => {
    const rnd = new Rand(seed)
    const hex = `#${tone.toString(16).padStart(6, '0')}`
    const map = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let y = 0; y < h; y++) {
        const fade = 0.86 + Math.sin(y * 0.05) * 0.05
        for (let x = 0; x < w; x++) {
          const rib = 0.88 + 0.12 * Math.abs(Math.sin((x / w) * Math.PI * 2 * 16))
          const n = (rnd.next() - 0.5) * 18
          const i4 = (y * w + x) * 4
          img.data[i4] = clamp01((img.data[i4] * rib * fade + n) / 255) * 255
          img.data[i4 + 1] = clamp01((img.data[i4 + 1] * rib * fade + n) / 255) * 255
          img.data[i4 + 2] = clamp01((img.data[i4 + 2] * rib * fade + n * 0.8) / 255) * 255
        }
      }
      ctx.putImageData(img, 0, 0)
      for (let k = 0; k < 6; k++) {
        const x = rnd.next() * w
        ctx.fillStyle = `rgba(${112 + rnd.next() * 40 | 0},${52 + rnd.next() * 24 | 0},26,${0.16 + rnd.next() * 0.22})`
        ctx.fillRect(x, rnd.next() * h * 0.5, 4 + rnd.next() * 10, h * (0.2 + rnd.next() * 0.6))
      }
    }, { srgb: true })
    const height = heightCanvasFrom((x) => clamp01(0.25 + Math.abs(Math.sin((x / 128) * Math.PI * 2 * 16)) * 0.6), 128, 64)
    const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, 2.6))
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.needsUpdate = true
    return { map, normalMap: normal }
  })
}

/** Riveted plant metal: tank plates, seams, paint band, rust (water towers/silos). */
export function rivetMetalMaps(tone = 0x8f9aa4, seed = 55): { map: THREE.Texture; normalMap: THREE.Texture } {
  return cached(`rivet${tone}_${seed}`, () => {
    const rnd = new Rand(seed)
    const hex = `#${tone.toString(16).padStart(6, '0')}`
    const map = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i++) {
        const n = (rnd.next() - 0.5) * 22
        const i4 = i * 4
        img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
        img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n) / 255) * 255
        img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n * 0.9) / 255) * 255
      }
      ctx.putImageData(img, 0, 0)
      ctx.fillStyle = 'rgba(52,58,64,0.5)'
      for (const p of [64, 128, 192]) ctx.fillRect(0, p, w, 2)
      for (let y = 20; y < h; y += 44) for (let x = 8; x < w; x += 16) {
        ctx.fillStyle = 'rgba(38,42,48,0.55)'
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill()
      }
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = `rgba(${118 + rnd.next() * 30 | 0},60,30,${0.1 + rnd.next() * 0.16})`
        ctx.fillRect(rnd.next() * w, 0, 3 + rnd.next() * 7, h)
      }
    }, { srgb: true })
    const height = heightCanvasFrom((x, y) => {
      const rivet = (x % 16 < 4 && y % 44 < 6) ? 0.8 : 0.4
      return clamp01(rivet + (rnd.next() - 0.5) * 0.1)
    }, 128, 128)
    const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, 1.6))
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.needsUpdate = true
    return { map, normalMap: normal }
  })
}

/** Original billboard artwork for masted signage / gantries. */
export function billboardFaceTexture(kind: 'rush' | 'octane' | 'tyreking' | 'harbour'): THREE.Texture {
  return cached(`bill${kind}`, () =>
    canvasTexture(512, 288, (ctx, w, h) => {
      const rnd = new Rand(kind.length * 977 + 3)
      const bg: Record<string, [string, string]> = {
        rush: ['#12304e', '#f2b23c'], octane: ['#471322', '#e8e6de'], tyreking: ['#17301c', '#d9e04a'], harbour: ['#0e3c44', '#7fd4e0'],
      }
      const [b, ink] = bg[kind]
      ctx.fillStyle = b
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i += 3) {
        if (rnd.next() < 0.05) { const i4 = i * 4; img.data[i4 + 3] = 210 }
      }
      ctx.putImageData(img, 0, 0)
      ctx.textAlign = 'center'
      const titles: Record<string, [string, string]> = {
        rush: ['VELOCITY RUSH', 'SUNDAY CIRCUIT — COAST SECTOR'],
        octane: ['OCTANE 98', 'FUEL · COFFEE · QUIET NERVES'],
        tyreking: ['TYRE KING', 'DRIFT SET · ROAD · RALLY'],
        harbour: ['HARBOUR MOTO', 'MARINE PARTS · ANTI-FOUL'],
      }
      const [t1, t2] = titles[kind]
      ctx.fillStyle = ink
      let fs = 74
      do { ctx.font = `bold ${fs}px sans-serif`; fs -= 2 } while (ctx.measureText(t1).width > w * 0.88 && fs > 30)
      ctx.fillText(t1, w / 2, h * 0.52)
      ctx.font = 'bold 26px sans-serif'
      ctx.fillStyle = 'rgba(240,236,220,0.85)'
      ctx.fillText(t2, w / 2, h * 0.78)
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 10
      ctx.strokeRect(5, 5, w - 10, h - 10)
    }, { srgb: true, clamp: true }),
  )
}

/** Timber grain for crates/pallets/benches. */
export function woodMaps(tone = 0x8a7250, seed = 66): { map: THREE.Texture; normalMap: THREE.Texture } {
  return cached(`wood${tone}_${seed}`, () => {
    const rnd = new Rand(seed)
    const hex = `#${tone.toString(16).padStart(6, '0')}`
    const map = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      for (let y = 0; y < h; y++) {
        const grain = Math.sin(y * 0.55 + Math.sin(y * 0.13) * 2.2) * 12
        for (let x = 0; x < w; x++) {
          const n = grain + (rnd.next() - 0.5) * 16 + Math.sin(x * 0.02 + y * 0.4) * 5
          const i4 = (y * w + x) * 4
          img.data[i4] = clamp01((img.data[i4] + n) / 255) * 255
          img.data[i4 + 1] = clamp01((img.data[i4 + 1] + n * 0.9) / 255) * 255
          img.data[i4 + 2] = clamp01((img.data[i4 + 2] + n * 0.72) / 255) * 255
        }
      }
      ctx.putImageData(img, 0, 0)
    }, { srgb: true })
    const height = heightCanvasFrom((x, y) => clamp01(0.5 + Math.sin(y * 0.55 + Math.sin(y * 0.13) * 2.2) * 0.18 + (rnd.next() - 0.5) * 0.08 + (x % 64 < 2 ? -0.4 : 0)), 64, 64)
    const normal = new THREE.CanvasTexture(normalFromHeightCanvas(height, 1.4))
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.needsUpdate = true
    return { map, normalMap: normal }
  })
}

/** Fine grain overlay for vertex-coloured terrain (kills flat colour). */
export function groundDetailTexture(): THREE.Texture {
  return cached('groundDetail', () => {
    const rnd = new Rand(6001)
    return canvasTexture(256, 256, (ctx, w, h) => {
      const img = ctx.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const gx = (i % w) / w, gy = (i / w | 0) / h
        // low-frequency wash + restrained grain: patchy variation, no leopard
        const wash = 0.88 + 0.05 * Math.sin(gx * 4.4 + 1.7) * Math.cos(gy * 3.7 - 0.6)
        const v = clamp01(wash + (rnd.next() - 0.5) * 0.04) * 255
        const i4 = i * 4
        img.data[i4] = img.data[i4 + 1] = img.data[i4 + 2] = v
        img.data[i4 + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
      ctx.fillStyle = 'rgba(90,80,60,0.10)'
      for (let k = 0; k < 34; k++) ctx.fillRect(rnd.next() * w, rnd.next() * h, 8 + rnd.next() * 26, 8 + rnd.next() * 26)
    }, { srgb: true, anisotropy: 1 })
  })
}
