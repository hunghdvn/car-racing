import * as THREE from 'three'
import { canvasTexture, normalFromHeightCanvas, heightCanvasFrom, clamp01, fbm2, Rand, roundRectPath } from '../util'

/* ------------------------------------------------------------------------- *
 * Procedural PBR texture library (original canvases, ≤1024² budget).
 * Phase 2 slice covers the hero car; more families land in Phase 4 (Gate M).
 * ------------------------------------------------------------------------- */

const cache = new Map<string, THREE.Texture>()
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key)
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
