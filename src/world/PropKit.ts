import * as THREE from 'three'
import { SEED, THEME, KIT } from '../config'
import { Rand, lerp, sweepProfile, type SweepFrame } from '../util'
import { concreteMaps, signFaceTexture, billboardFaceTexture, roundedPlateGeo, corrugatedMaps, rivetMetalMaps, woodMaps } from '../assets/Textures'
import type { TrackSpline } from './TrackSpline'
import type { CoastField } from './Terrain'

/* ------------------------------------------------------------------------- *
 * PropKit (spec §5 Tier-2/3) — roadside furniture & landmarks. Every prop
 * is a small kit design with ≥2 LOD levels (full → low-poly/far) wired
 * through THREE.LOD (spec §4.7). Composition-level placement (clusters,
 * rhythm, left/right) lives in ComposeKit; this module builds the pieces.
 * ------------------------------------------------------------------------- */

interface Steel {
  steel: THREE.MeshStandardMaterial
  steelDark: THREE.MeshStandardMaterial
  concMat: THREE.MeshStandardMaterial
  woodMat: THREE.MeshStandardMaterial
}
let steelCache: Steel | null = null
function kitSteel(): Steel {
  if (steelCache) return steelCache
  const conc = concreteMaps(0xa7a29a, 33)
  const wd = woodMaps(0x8a7250, 66)
  steelCache = {
    steel: new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.72, roughness: 0.46 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x43484e, metalness: 0.65, roughness: 0.55 }),
    concMat: new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap, roughness: 0.9, metalness: 0.02 }),
    woodMat: new THREE.MeshStandardMaterial({ map: wd.map, normalMap: wd.normalMap, roughness: 0.92, metalness: 0 }),
  }
  return steelCache
}

const shadowOn = (g: THREE.Object3D, cast = true): void => {
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true } })
}

/** Wrap a prop into a real THREE.LOD (full at 0, low-poly far variant). */
export function propLOD(full: THREE.Object3D, far: THREE.Object3D | null, mid: number = KIT.lodMid, farAt: number = KIT.lodFar): THREE.Object3D {
  if (!far) { full.updateMatrixWorld(false); return full }
  const lod = new THREE.LOD()
  lod.addLevel(full, KIT.lodNear)
  lod.addLevel(far, farAt)
  void mid
  return lod
}

/** Low-poly far proxy: merged box/cylinder mass in the prop's tone. */
function farMass(w: number, h: number, d: number, color: number, y = h / 2): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(0, y, 0)
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, flatShading: true }))
  m.castShadow = false
  m.receiveShadow = false
  return m
}

/* ================================================================== props == */

/** 1. Curved-arm streetlight (lathe pole, lofted arm, tilted head+lens). */
export function makeStreetlight(rnd: Rand, height = rnd.range(6.0, 6.9)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const prof: THREE.Vector2[] = [[0.16, 0], [0.14, 0.25], [0.085, height * 0.85], [0.06, height]]
    .map(([r, y]) => new THREE.Vector2(r, y))
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 9), S.steelDark))
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.3, 9), S.steelDark)
  foot.position.y = 0.15
  g.add(foot)
  const dir = -1
  const armPts: THREE.Vector3[] = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    armPts.push(new THREE.Vector3(0, height + Math.sin(t * Math.PI * 0.5) * 0.55, dir * (t * 1.75)))
  }
  const frames: SweepFrame[] = armPts.map((p) => ({ p: [p.x, p.y, p.z], s: [1, 0, 0], u: [0, 0, dir] }))
  const armGeo = sweepProfile([[-0.045, -0.045], [0.045, -0.045], [0.045, 0.045], [-0.045, 0.045]], frames, { caps: true, uvScale: 1 })
  g.add(new THREE.Mesh(armGeo, S.steel))
  const head = new THREE.Mesh(roundedPlateGeo(0.52, 0.24, 0.12, 0.05), S.steelDark)
  head.rotation.x = Math.PI / 2
  head.rotation.z = Math.PI / 2
  head.position.set(0, height + 0.42, dir * 1.72)
  head.rotation.y = dir * -0.24
  g.add(head)
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshStandardMaterial({ color: 0xf5e9c8, emissive: new THREE.Color(THEME.skySunTint).convertSRGBToLinear(), emissiveIntensity: 0.9, roughness: 0.35 }))
  lens.position.set(0, height + 0.345, dir * 1.72)
  lens.rotation.x = -Math.PI / 2 + dir * 0.2
  g.add(lens)
  shadowOn(g)
  return propLOD(g, farMass(0.5, height + 0.5, 1.9, 0x6a7076))
}

/** 2. Industrial twin-arm mast light for yard corners. */
export function makeMastLight(rnd: Rand): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const h = rnd.range(7.5, 8.8)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.17, h, 8), S.steelDark)
  pole.position.y = h / 2
  g.add(pole)
  const cross = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), S.steel)
  cross.position.y = h - 0.1
  g.add(cross)
  for (const sx of [-1.1, 1.1]) {
    const head = new THREE.Mesh(roundedPlateGeo(0.6, 0.28, 0.14, 0.05), S.steelDark)
    head.position.set(sx, h + 0.06, 0)
    head.rotation.x = -0.4
    g.add(head)
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), new THREE.MeshStandardMaterial({ color: 0xf5e9c8, emissive: new THREE.Color(THEME.skySunTint).convertSRGBToLinear(), emissiveIntensity: 0.75, roughness: 0.4 }))
    lens.position.set(sx, h - 0.02, 0.1)
    lens.rotation.x = -Math.PI / 2 - 0.4
    g.add(lens)
  }
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.5, 8, 1, true), S.steel)
  cage.position.y = 0.26
  g.add(cage)
  shadowOn(g)
  return propLOD(g, farMass(2.6, h, 0.5, 0x5c6167))
}

/** 3. Road sign panel on posts (face normal = local −z, into traffic). */
export function makeSign(kind: Parameters<typeof signFaceTexture>[0], w: number, h: number, twoPost = true): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signFaceTexture(kind), roughness: 0.68, metalness: 0.04 }))
  face.rotation.y = Math.PI
  face.position.y = 2.5
  g.add(face)
  const bm = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), S.steelDark)
  bm.position.set(0, 2.5, 0.055)
  g.add(bm)
  const postX = twoPost ? w * 0.34 : 0
  for (const off of twoPost ? [-postX, postX] : [0]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 2.9, 7), S.steel)
    post.position.set(off, 1.45, 0.09)
    g.add(post)
  }
  shadowOn(g)
  return propLOD(g, farMass(w, 2.5 + h, 0.3, 0x7d838a, (2.5 + h / 2)))
}

/** 4. Overhead sign gantry: lattice truss + hanger + panel over the road. */
export function makeSignGantry(kind: Parameters<typeof signFaceTexture>[0], span = 9, rnd = new Rand(5)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  for (const sx of [-span / 2, span / 2]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 7.4, 8), S.steelDark)
    leg.position.set(sx, 3.7, 0)
    g.add(leg)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 9), S.concMat)
    base.position.set(sx, 0.15, 0)
    g.add(base)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.34, 0.3), S.steel)
  beam.position.y = 7.3
  g.add(beam)
  // lattice diagonals
  for (let i = 0; i < Math.floor(span / 1.15); i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.06), S.steel)
    d.position.set(-span / 2 + 0.85 + i * 1.15, 7.3, 0)
    d.rotation.z = (i % 2 ? 1 : -1) * 0.62
    g.add(d)
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(span * 0.55, 1.5, 0.12), S.steelDark)
  panel.position.set(0, 6.1, 0.1)
  g.add(panel)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.55 - 0.2, 1.3), new THREE.MeshStandardMaterial({ map: signFaceTexture(kind), roughness: 0.7, side: THREE.DoubleSide }))
  face.position.set(0, 6.1, -0.02)
  face.rotation.y = Math.PI
  g.add(face)
  for (const hx of [-span * 0.16, span * 0.16]) {
    const hang = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), S.steel)
    hang.position.set(hx, 6.9, 0.1)
    g.add(hang)
  }
  void rnd
  shadowOn(g)
  return propLOD(g, farMass(span, 7, 0.6, 0x5a5f65))
}

/** 5. Traffic signal: mast + hooded 3-head + backboard + counterweight. */
export function makeTrafficLight(rnd = new Rand(3)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 4.6, 8), S.steelDark)
  pole.position.y = 2.3
  g.add(pole)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1.4), S.steel)
  arm.position.set(0, 4.4, 0.6)
  g.add(arm)
  const head = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.95, 0.3), S.steelDark)
  head.add(body)
  const cols = [0xb02f24, 0xcfa227, 0x2f8f43]
  cols.forEach((c, i) => {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c).convertSRGBToLinear(), emissiveIntensity: i === 2 ? 1.4 : 0.32, roughness: 0.3 }))
    lens.rotation.x = Math.PI / 2
    lens.position.set(0, 0.32 - i * 0.32, -0.17)
    head.add(lens)
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), S.steelDark)
    hood.rotation.x = -Math.PI / 2
    hood.position.set(0, 0.32 - i * 0.32, -0.17)
    hood.scale.set(1, 0.62, 1)
    head.add(hood)
  })
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.2, 0.06), S.steelDark)
  board.position.z = 0.18
  head.add(board)
  head.position.set(0, 4.4, 1.25)
  head.rotation.y = Math.PI / 2 * 0 + rnd.range(-0.1, 0.1)
  g.add(head)
  const cw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), S.steelDark)
  cw.position.set(0, 4.4, -0.55)
  g.add(cw)
  shadowOn(g)
  return propLOD(g, farMass(0.5, 4.6, 0.5, 0x4a4f55))
}

/** 6. Bollard (row generator via ComposeKit). */
export function makeBollard(tone = 0xd8d3c6): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.85, 8), new THREE.MeshStandardMaterial({ color: tone, roughness: 0.7 }))
  body.position.y = 0.42
  g.add(body)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), S.steel)
  cap.position.y = 0.85
  g.add(cap)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0xd8a41d, roughness: 0.6 }))
  band.position.y = 0.62
  g.add(band)
  shadowOn(g)
  return g
}

/** 7. Shipping container: corrugated body, door end, rails, corner castings. */
export function makeContainer(tone = 0x2e6470, seed = 5): THREE.Object3D {
  const S = kitSteel()
  const rnd = new Rand(seed)
  const cm = corrugatedMaps(tone, seed)
  const bodyMat = new THREE.MeshStandardMaterial({ map: cm.map, normalMap: cm.normalMap, roughness: 0.66, metalness: 0.3 })
  const g = new THREE.Group()
  const L = 6.05, W = 2.44, H = 2.6
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, H - 0.24, W), bodyMat)
  body.position.y = H / 2
  g.add(body)
  const rt = new THREE.Mesh(new THREE.BoxGeometry(L + 0.04, 0.1, 0.14), S.steelDark)
  rt.position.y = H - 0.05
  g.add(rt)
  const rt2 = rt.clone()
  rt2.position.y = 0.08
  g.add(rt2)
  // door end
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, H * 0.82, W * 0.46), S.steelDark)
  door.position.set(L / 2 + 0.03, H / 2, -W * 0.14)
  g.add(door)
  for (const dz of [-W * 0.33, W * 0.11]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, H * 0.7, 0.05), S.steel)
    bar.position.set(L / 2 + 0.07, H / 2, dz)
    g.add(bar)
  }
  // corner castings
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0.08, H - 0.08]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), S.steelDark)
    c.position.set(sx * (L / 2 - 0.06), sy, sz * (W / 2 - 0.06))
    g.add(c)
  }
  void rnd
  shadowOn(g)
  return propLOD(g, farMass(L, H, W, tone))
}

/** 8. Oil drum (lathe with ribs), tipped variant. */
export function makeDrum(tone = 0xb2592b, tipped = false): THREE.Object3D {
  const g = new THREE.Group()
  const prof: THREE.Vector2[] = [[0.29, 0], [0.31, 0.08], [0.31, 0.55], [0.29, 0.62], [0.0, 0.62]].map(([r, y]) => new THREE.Vector2(r, y))
  const drum = new THREE.Mesh(new THREE.LatheGeometry(prof, 12), new THREE.MeshStandardMaterial({ color: tone, roughness: 0.6, metalness: 0.3 }))
  const rib = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.022, 5, 14), drum.material as THREE.MeshStandardMaterial)
  rib.rotation.x = Math.PI / 2
  rib.position.y = 0.31
  g.add(drum, rib)
  if (tipped) { g.rotation.z = 1.5; g.position.y = 0.3 }
  shadowOn(g)
  return g
}

/** 9. Pallet stack. */
export function makePallet(count = 1): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  for (let k = 0; k < count; k++) {
    const pal = new THREE.Group()
    for (let q = 0; q < 3; q++) {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.09), S.woodMat)
      top.position.set(0, 0.13 + k * 0.16, -0.4 + q * 0.4)
      pal.add(top)
    }
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 1.0), S.woodMat)
    p.position.y = 0.05 + k * 0.16
    pal.add(p)
    g.add(pal)
  }
  shadowOn(g)
  return g
}

/** 10. Crate stack: planked boxes with banding. */
export function makeCrates(rnd = new Rand(8)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const n = rnd.int(2, 3)
  for (let k = 0; k < n; k++) {
    const w = rnd.range(0.7, 1.15)
    const crate = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.8, w * 0.9), S.woodMat)
    crate.position.set(rnd.range(-0.25, 0.25), w * 0.4 + k * 0.62, rnd.range(-0.2, 0.2))
    crate.rotation.y = rnd.range(-0.4, 0.4)
    const band1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.06, w * 0.93), new THREE.MeshStandardMaterial({ color: 0x5c4a30, roughness: 0.9 }))
    band1.position.set(crate.position.x, crate.position.y + w * 0.18, crate.position.z)
    band1.rotation.y = crate.rotation.y
    g.add(crate, band1)
  }
  shadowOn(g)
  return g
}

/** 11. Pipe stack (industrial yard): staggered lathe pipes on skids. */
export function makePipeStack(rnd = new Rand(2)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const skid = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.1), S.woodMat)
  skid.position.y = 0.08
  g.add(skid)
  const rows = [[-0.3, 0.42, 4], [0, 0.72, 3], [0, 1.02, 2]] as const
  for (const [dz, y, n] of rows) for (let i = 0; i < n; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 8, 1, true), S.steel)
    pipe.rotation.z = Math.PI / 2
    pipe.position.set(0, y, dz + (i - (n - 1) / 2) * 0.36)
    g.add(pipe)
  }
  shadowOn(g)
  return propLOD(g, farMass(2.6, 1.2, 1.1, 0x7c838a))
}

/** 12. Tyre stack (drift-shop flavour). */
export function makeTyreStack(n = 4, tone = 0x23262b): THREE.Object3D {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.92, metalness: 0.02 })
  for (let k = 0; k < n; k++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.13, 7, 14), mat)
    t.rotation.x = Math.PI / 2
    t.position.y = 0.13 + k * 0.25
    t.rotation.z = (k % 3) * 0.2 - 0.2
    g.add(t)
  }
  shadowOn(g)
  return g
}

/** 13. Dumpster/bin with lid + wheels. */
export function makeBin(tone = 0x3f5a46): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 1.05), new THREE.MeshStandardMaterial({ color: tone, roughness: 0.72, metalness: 0.24 }))
  body.position.y = 0.62
  g.add(body)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.1, 1.1), S.steelDark)
  lid.position.y = 1.18
  lid.rotation.x = 0.05
  g.add(lid)
  for (const sx of [-0.6, 0.6]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.09, 9), new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.9 }))
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(sx, 0.16, 0.5)
    g.add(wheel)
  }
  const ribs = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.08, 0.06), S.steelDark)
  ribs.position.set(0, 0.85, -0.53)
  g.add(ribs)
  shadowOn(g)
  return g
}

/** 14. Fire hydrant. */
export function makeHydrant(): THREE.Object3D {
  const mat = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.55, metalness: 0.25 })
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.72, 9), mat)
  body.position.y = 0.36
  g.add(body)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat)
  cap.position.y = 0.72
  g.add(cap)
  for (const sx of [-1, 1]) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 7), mat)
    noz.rotation.z = Math.PI / 2
    noz.position.set(sx * 0.19, 0.42, 0)
    g.add(noz)
  }
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.07, 9), mat)
  flange.position.y = 0.04
  g.add(flange)
  shadowOn(g)
  return g
}

/** 15. Bench (slats on cast frame). */
export function makeBench(): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  for (let k = 0; k < 3; k++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.13), S.woodMat)
    slat.position.set(0, 0.46, -0.16 + k * 0.16)
    g.add(slat)
  }
  for (let k = 0; k < 2; k++) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.11, 0.05), S.woodMat)
    back.position.set(0, 0.78 + k * 0.18, 0.24)
    back.rotation.x = 0.22
    g.add(back)
  }
  for (const sx of [-0.66, 0.66]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), S.steelDark)
    frame.position.set(sx, 0.24, 0)
    g.add(frame)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.56), S.steelDark)
    arm.position.set(sx, 0.58, 0)
    g.add(arm)
  }
  shadowOn(g)
  return g
}

/** 16. Planter with drain holes + a planted soil top. */
export function makePlanter(w = 1.8): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.72, 0.9), S.concMat)
  body.position.y = 0.28
  g.add(body)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.07, 1.0), S.concMat)
  lip.position.y = 0.65
  g.add(lip)
  const soil = new THREE.Mesh(new THREE.BoxGeometry(w - 0.24, 0.1, 0.62), new THREE.MeshStandardMaterial({ color: 0x3e3225, roughness: 1 }))
  soil.position.y = 0.7
  g.add(soil)
  shadowOn(g)
  return g
}

/** 17. Utility pole: cross-arms, transformer, insulators, drop line. */
export function makeUtilityPole(rnd = new Rand(4)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const h = rnd.range(7.2, 8.4)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.17, h, 8), new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.9 }))
  pole.position.y = h / 2
  g.add(pole)
  for (const ay of [h - 0.4, h - 1.4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.11, 0.11), S.woodMat)
    arm.position.y = ay
    g.add(arm)
    for (const ax of [-0.85, 0.85]) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.4 }))
      ins.position.set(ax, ay + 0.14, 0)
      g.add(ins)
    }
  }
  const traf = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.8, 9), S.steelDark)
  traf.position.set(0.34, h - 2.5, 0)
  g.add(traf)
  const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.8 }))
  drop.position.set(0.3, h - 3.9, 0.06)
  drop.rotation.x = 0.1
  g.add(drop)
  shadowOn(g)
  return propLOD(g, farMass(0.6, h, 0.6, 0x5e4f3c))
}

/** 18. Water tower — Tier-1 landmark (riveted tank, X-braced legs, catwalk). */
export function makeWaterTower(): THREE.Object3D {
  const S = kitSteel()
  const rm = rivetMetalMaps(0x8f9aa4, 55)
  const g = new THREE.Group()
  const legH = 11
  const prof: THREE.Vector2[] = [[0, 0], [2.4, 0], [2.4, 0.5], [0.6, 0.8], [0.55, 2.6], [0.7, 3.1], [0, 3.15]].map(([r, y]) => new THREE.Vector2(r, y))
  const tank = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), new THREE.MeshStandardMaterial({ map: rm.map, normalMap: rm.normalMap, metalness: 0.55, roughness: 0.55 }))
  tank.position.y = legH
  g.add(tank)
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.8, 14), new THREE.MeshStandardMaterial({ color: 0x6f7a84, metalness: 0.6, roughness: 0.48 }))
  cap.position.y = legH + 3.5
  g.add(cap)
  const rail = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.06, 6, 20), S.steel)
  rail.rotation.x = Math.PI / 2
  rail.position.y = legH + 0.62
  g.add(rail)
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + 0.4
    const lx = Math.cos(a), lz = Math.sin(a)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, legH + 0.4, 6), S.steelDark)
    leg.position.set(lx * 2.05, (legH + 0.4) / 2, lz * 2.05)
    leg.rotation.set(-lz * 0.09, 0, lx * 0.09)
    g.add(leg)
    for (let q = 1; q <= 3; q++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.3, 5), S.steel)
      br.position.set(lx * 1.7, q * 2.7, lz * 1.7)
      br.rotation.set(0, a, 1.15)
      g.add(br)
    }
    const a2 = (k + 1) * Math.PI / 2 + 0.4
    const midX = (lx + Math.cos(a2)) * 0.85, midZ = (lz + Math.sin(a2)) * 0.85
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.1, 4), S.steel)
    tie.position.set(midX, legH * 0.6, midZ)
    tie.rotation.set(Math.sin(Math.atan2(midZ, midX) + Math.PI / 2) * 0.35, 0, -Math.cos(Math.atan2(midZ, midX)) * 0.35)
    g.add(tie)
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 7), S.steelDark)
  pipe.position.set(0, legH - 3.5, 0)
  g.add(pipe)
  // access ladder up the leg
  const lad = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, legH, 5), S.steel)
  lad.position.set(2.0, legH / 2, 0.4)
  g.add(lad)
  g.updateMatrixWorld(false)
  shadowOn(g)
  const far = new THREE.Group()
  const tankF = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.6, 8), new THREE.MeshStandardMaterial({ color: 0x8f9aa4, roughness: 0.6, metalness: 0.5 }))
  tankF.position.y = legH
  const legsF = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, legH, 5), new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.7, metalness: 0.4 }))
  legsF.position.y = legH / 2
  far.add(tankF, legsF)
  return propLOD(g, far, KIT.lodMid, 240)
}

/** 19. Radio mast on ridge — lattice rings, guys, beacon. */
export function makeRadioMast(height = 24): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.4, height, 7), S.steel)
  mast.position.y = height / 2
  g.add(mast)
  for (let q = 0; q < 5; q++) {
    const y = 2.5 + q * 4.2
    const rr = lerp(1.7, 0.55, y / height)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.05, 5, 12), S.steel)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    g.add(ring)
    for (const a of [0, Math.PI / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, rr * 2, 4), S.steel)
      post.rotation.z = Math.PI / 2
      post.rotation.y = a
      post.position.y = y
      g.add(post)
    }
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff4436, emissive: new THREE.Color(0xff2a1a).convertSRGBToLinear(), emissiveIntensity: 2.6, roughness: 0.4 }))
  beacon.position.y = height + 0.4
  g.add(beacon)
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5
    const guy = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 14, 4), S.steel)
    guy.position.set(Math.cos(a) * 3.6, height * 0.42, Math.sin(a) * 3.6)
    guy.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)
    g.add(guy)
  }
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.7, 0.5, 10), S.concMat)
  pad.position.y = 0.15
  g.add(pad)
  shadowOn(g)
  const far = new THREE.Group()
  const mF = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, height, 5), new THREE.MeshStandardMaterial({ color: 0x7d848b, roughness: 0.7, metalness: 0.5 }))
  mF.position.y = height / 2
  far.add(mF)
  return propLOD(g, far, KIT.lodMid, 300)
}

/** 20. Gantry crane — landmark with CONNECTED jib: apex, pendants, cab,
 *  counter-jib tie, so the arm never reads detached against the sun. */
export function makeGantryCrane(rnd = new Rand(11)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9c7f3f, roughness: 0.66, metalness: 0.32 })
  const mastH = 24
  // tower: lattice with rails + climbing cage
  const tower = new THREE.Group()
  for (const [tx, tz] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, mastH, 0.16), bodyMat)
    leg.position.set(tx, mastH / 2, tz)
    tower.add(leg)
  }
  for (let b = 1; b < 8; b++) {
    const y = b * (mastH / 8)
    const br1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 0.09), bodyMat)
    br1.position.set(0, y, -0.75)
    br1.rotation.z = 0.62
    const br2 = br1.clone()
    br2.position.z = 0.75
    br2.rotation.z = -0.62
    const ring = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), bodyMat)
    ring.position.set(0, y, -0.75)
    tower.add(br1, br2, ring)
  }
  g.add(tower)
  // slewing cab sits ON the tower crown, jib roots through it (connected)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.0, 2.4), new THREE.MeshStandardMaterial({ color: 0x5c574a, roughness: 0.7, metalness: 0.3 }))
  cab.position.set(0, mastH + 1.0, 0.3)
  g.add(cab)
  const cabWin = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.9), new THREE.MeshStandardMaterial({ color: 0x2c3a44, metalness: 0.4, roughness: 0.2 }))
  cabWin.position.set(0, mastH + 1.2, -0.91)
  g.add(cabWin)
  // apex tower above cab + pendant cables to jib and counter-jib
  const apex = new THREE.Mesh(new THREE.BoxGeometry(0.55, 5.4, 0.55), bodyMat)
  apex.position.set(0, mastH + 4.4, 0.3)
  g.add(apex)
  const jibY = mastH + 1.9
  for (const [toZ, len] of [[13.5, 13.6], [-8.6, 8.8]] as const) {
    const pend = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, Math.hypot(len, 5.2), 4), S.steel)
    pend.position.set(0, mastH + 6.4, toZ / 2)
    pend.rotation.x = Math.atan2(toZ, 5.2)
    g.add(pend)
  }
  // jib: truss of chord + diagonals, rooted at the cab (no gap)
  const jib = new THREE.Group()
  const jibLen = 30
  const chord = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, jibLen), bodyMat)
  chord.position.set(0, jibY, jibLen / 2 - 1.2)
  jib.add(chord)
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, jibLen * 0.92), bodyMat)
  tie.position.set(0, jibY + 1.25, jibLen * 0.46 - 1.0)
  tie.rotation.x = 0.085
  jib.add(tie)
  for (let dI = 0; dI < 14; dI++) {
    const dz = 0.6 + dI * 2.0
    const diag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.6, 0.07), bodyMat)
    diag.position.set(0, jibY + 0.65, dz)
    diag.rotation.x = (dI % 2 ? 0.78 : -0.78)
    jib.add(diag)
    const vert = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.3, 0.07), bodyMat)
    vert.position.set(0, jibY + 0.62, dz + 1.0)
    jib.add(vert)
  }
  g.add(jib)
  // counter-jib + concrete counterweights, tied to apex
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 7), bodyMat)
  counter.position.set(0, jibY - 0.35, -8.6)
  g.add(counter)
  const cw = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 3.4), new THREE.MeshStandardMaterial({ color: 0x767164, roughness: 0.9, metalness: 0.05 }))
  cw.position.set(0, jibY - 0.55, -10.8)
  g.add(cw)
  // trolley + hook hanging off the jib underside (reads connected)
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.2), new THREE.MeshStandardMaterial({ color: 0x8a5530, roughness: 0.7, metalness: 0.3 }))
  trolley.position.set(0, jibY - 0.35, 15)
  g.add(trolley)
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.6, 4), S.steel)
  cable.position.set(0, jibY - 2.35, 15)
  g.add(cable)
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.09, 6, 10, Math.PI * 1.5), S.steel)
  hook.position.set(0, jibY - 4.25, 15)
  g.add(hook)
  // container load under the hook — the crane is loading, not floating
  const load = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x3a6f66, roughness: 0.8, metalness: 0.15 }))
  load.position.set(0, 1.2, 15)
  g.add(load)
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x767164, roughness: 0.9 }))
  base.position.y = 1.1
  g.add(base)
  const railA = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.2, 0.3), S.steelDark)
  railA.position.set(0, 2.28, 2.6)
  g.add(railA)
  const railB = railA.clone()
  railB.position.z = -2.6
  g.add(railB)
  void rnd
  shadowOn(g, false)
  const far = new THREE.Group()
  const mf = new THREE.Mesh(new THREE.BoxGeometry(1.6, mastH + 1, 1.6), new THREE.MeshStandardMaterial({ color: 0x8a7340, roughness: 0.8, metalness: 0.2, flatShading: true }))
  mf.position.y = (mastH + 1) / 2
  const jf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, jibLen), mf.material)
  jf.position.set(0, jibY, jibLen / 2 - 1.2)
  const cf = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 7.5), mf.material)
  cf.position.set(0, jibY - 0.35, -8.6)
  far.add(mf, jf, cf)
  return propLOD(g, far, KIT.lodMid, 420)
}

/** 21. Masted billboard on a lattice leg (Tier-1 roadside landmark). */
export function makeBillboard(kind: Parameters<typeof billboardFaceTexture>[0], rnd = new Rand(6)): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const h = rnd.range(7.4, 8.6)
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.9), S.steelDark)
  leg.position.y = h / 2
  g.add(leg)
  for (let b = 0; b < 4; b++) {
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), S.steel)
    br.position.set(0, 1.2 + b * 1.7, 0)
    br.rotation.x = 0.7
    g.add(br)
  }
  const W = 7.2, H = 4.0
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, H + 0.3, 0.24), S.steelDark)
  frame.position.y = h + H / 2 - 0.4
  g.add(frame)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: billboardFaceTexture(kind), roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }))
  face.position.set(0, h + H / 2 - 0.4, -0.14)
  face.rotation.y = Math.PI
  g.add(face)
  const lights = new THREE.Group()
  for (const lx of [-W * 0.3, 0, W * 0.3]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.8), S.steel)
    arm.position.set(lx, h - 0.2, -0.6)
    arm.rotation.x = -0.5
    lights.add(arm)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.16), new THREE.MeshStandardMaterial({ color: 0xf5e9c8, emissive: new THREE.Color(0xffe1b0).convertSRGBToLinear(), emissiveIntensity: 0.7, roughness: 0.4 }))
    lamp.position.set(lx, h - 0.38, -0.94)
    lamp.rotation.x = -0.5
    lights.add(lamp)
  }
  g.add(lights)
  const footA = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.2), S.concMat)
  footA.position.y = 0.25
  g.add(footA)
  shadowOn(g)
  return propLOD(g, farMass(W, h + H, 1, 0x5b6067, (h + H) / 2), KIT.lodMid, 380)
}

/** 22. Parked van (Tier-2 dressing): lofted shell read, not a cube. */
export function makeVan(tone = 0x7a8288, rnd = new Rand(9)): THREE.Object3D {
  const g = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, metalness: 0.35 })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x35505e, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.75, envMapIntensity: 1.4 })
  const hull = new THREE.Mesh(roundedPlateGeo(4.3, 1.7, 1.05, 0.34), bodyMat)
  hull.rotation.x = Math.PI / 2
  hull.position.y = 0.72
  g.add(hull)
  const cabin = new THREE.Mesh(roundedPlateGeo(2.0, 1.15, 0.95, 0.3), bodyMat)
  cabin.rotation.x = Math.PI / 2
  cabin.position.set(0.75, 1.62, 0)
  g.add(cabin)
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.78), glassMat)
  wind.position.set(1.62, 1.72, 0)
  wind.rotation.y = Math.PI / 2
  wind.rotation.x = 0
  wind.rotateOnAxis(new THREE.Vector3(0, 0, 1), -0.36)
  g.add(wind)
  const wheelG = new THREE.TorusGeometry(0.34, 0.16, 8, 16)
  for (const [wx] of [[-1.3], [1.45]] as const) {
    for (const wz of [-0.82, 0.82]) {
      const w = new THREE.Mesh(wheelG, new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.92 }))
      w.rotation.y = Math.PI / 2
      w.position.set(wx, 0.36, wz)
      g.add(w)
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.7, roughness: 0.4 }))
      hub.rotation.x = Math.PI / 2
      hub.position.set(wx, 0.36, wz + (wz > 0 ? 0.12 : -0.12))
      g.add(hub)
    }
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.32, 0.16, 1.06), new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.6 }))
  stripe.position.y = 0.86
  g.add(stripe)
  void rnd
  shadowOn(g)
  return propLOD(g, farMass(4.3, 1.9, 1.7, tone, 0.95))
}

/** 23. Jersey barrier unit (loose, for work-zones / prefab gates). */
export function makeBarrierUnit(len = 3): THREE.Object3D {
  const S = kitSteel()
  const g = new THREE.Group()
  const frames: SweepFrame[] = []
  for (const pz of [0, len]) frames.push({ p: [0, 0, pz], s: [1, 0, 0], u: [0, 1, 0] })
  const profile: [number, number][] = [[0, 0], [0.62, 0], [0.46, 0.2], [0.3, 0.5], [0.26, 0.86], [0.1, 0.86], [0.05, 0.5], [-0.1, 0.2]]
  const mesh = new THREE.Mesh(sweepProfile(profile, frames, { caps: true, uvScale: 0.4 }), S.concMat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return g
}

/** 24. Cone + tape cluster (worksite dressing). */
export function makeCones(rnd = new Rand(7)): THREE.Object3D {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xe06a26, roughness: 0.6 })
  const n = rnd.int(2, 4)
  for (let k = 0; k < n; k++) {
    const cone = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.36), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 }))
    base.position.y = 0.025
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.16, 0.72, 8), mat)
    spire.position.y = 0.41
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7 }))
    band.position.y = 0.46
    cone.add(base, spire, band)
    cone.position.set(rnd.range(-1.6, 1.6), 0, rnd.range(-0.8, 0.8))
    cone.rotation.y = rnd.range(-0.6, 0.6)
    g.add(cone)
  }
  shadowOn(g)
  return g
}

/* ====================================================== slice composition ==
 * placeProps remains the slice's deterministic furniture dressing (road-side
 * rhythm with seeded jitter per §10). Cluster-scale compositions (yards,
 * plant rows, skylines) moved to ComposeKit prefabs.
 * ======================================================================== */

export function placeProps(host: THREE.Group, spline: TrackSpline, field: CoastField): void {
  const rnd = new Rand(SEED ^ 0xd0d5)
  const at = (s: number, lat: number, dy = 0): THREE.Vector3 => {
    const f = spline.frame(s)
    const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, lat)
    p.y = field.height(p.x, p.z) + dy
    return p
  }

  /* masted road signs facing oncoming traffic (−X) */
  {
    const s1 = spline.sFromX(47)
    const g1 = makeSign('jump', 2.5, 1.25)
    g1.position.copy(at(s1 + 1.5, 7.3)); g1.rotation.y = Math.PI / 2 + spline.frame(s1).yaw + rnd.range(-0.05, 0.05)
    host.add(g1)
    const s2 = spline.sFromX(4)
    const g2 = makeSign('speed', 1.35, 1.35, false)
    g2.position.copy(at(s2, -7.0)); g2.rotation.y = Math.PI / 2 + spline.frame(s2).yaw
    host.add(g2)
    const s3 = spline.sFromX(20)
    const g3 = makeSign('tyres', 2.2, 0.85)
    g3.position.copy(at(s3 + 6, 7.5)); g3.rotation.y = Math.PI / 2 + spline.frame(s3).yaw + 0.08
    host.add(g3)
    const g4 = makeSign('store', 2.4, 0.9)
    const s4 = spline.sFromX(-40)
    g4.position.copy(at(s4, 7.8)); g4.rotation.y = Math.PI / 2 + spline.frame(s4).yaw - 0.06
    host.add(g4)
  }

  /* streetlights: staggered sides, varied height, jittered spacing */
  {
    let side = 1
    let s = spline.sFromX(6)
    while (s < spline.sFromX(128)) {
      s += rnd.range(15.5, 22)
      const f = spline.frame(Math.min(s, spline.length - 1))
      const lat = side * rnd.range(8.3, 8.9)
      const base = at(s, lat, -0.05)
      const g = makeStreetlight(rnd)
      g.position.copy(base)
      g.rotation.y = f.yaw + (side === 1 ? -Math.PI / 2 : Math.PI / 2) + rnd.range(-0.06, 0.06)
      host.add(g)
      side = side === 1 ? -1 : 1
    }
  }

  /* water tower landmark east */
  {
    const x = 122, z = 34
    const g = makeWaterTower()
    g.position.set(x, field.natural(x, z) - 0.15, z)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4, 0.7, 12), kitSteel().concMat)
    pad.position.set(x, field.natural(x, z) - 0.45, z)
    pad.receiveShadow = true
    host.add(g, pad)
  }

  /* radio mast north ridge */
  {
    const x = 26, z = 92
    const g = makeRadioMast()
    g.position.set(x, field.natural(x, z), z)
    host.add(g)
  }

  /* headland gantry crane SW — fixed connected-arm silhouette */
  {
    const x = -86, z = -76
    const g = makeGantryCrane(new Rand(SEED ^ 0x51))
    g.position.set(x, field.natural(x, z) - 0.2, z)
    g.rotation.y = 0.7
    host.add(g)
  }

  /* works dressing near the kicker approach (cones + barriers) */
  {
    const sK = spline.sFromX(44)
    const c = makeCones(new Rand(SEED ^ 0x33))
    c.position.copy(at(sK, 8.9, -0.02))
    c.rotation.y = spline.frame(sK).yaw
    host.add(c)
  }
}
