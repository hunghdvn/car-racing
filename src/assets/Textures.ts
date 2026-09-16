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
