import * as THREE from 'three'
import { SEED, THEME } from '../config'
import { Rand, lerp, clamp, smoothstep, fbm2, mergeGeometries, sanitizeGeometry, sweepProfile, type SweepFrame } from '../util'
import { concreteMaps, signFaceTexture, roundedPlateGeo } from '../assets/Textures'
import type { TrackSpline } from './TrackSpline'
import type { CoastField } from './Terrain'

/* ------------------------------------------------------------------------- *
 * Tier-2/3 furniture & landmarks (spec §5): masted signage, curved-arm
 * streetlights with staggered rhythm, containers/drums/pallets, a water
 * tower, a radio mast, a headland gantry crane and the far skyline — all
 * composed, jittered, never uniform runs.
 * ------------------------------------------------------------------------- */

export function placeProps(host: THREE.Group, spline: TrackSpline, field: CoastField): void {
  const rnd = new Rand(SEED ^ 0xd0d5)
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.72, roughness: 0.46 })
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x43484e, metalness: 0.65, roughness: 0.55 })
  const conc = concreteMaps(0xa7a29a, 33)
  const concMat = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap, roughness: 0.9, metalness: 0.02 })

  const at = (s: number, lat: number, dy = 0): THREE.Vector3 => {
    const f = spline.frame(s)
    const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, lat)
    p.y = field.height(p.x, p.z) + dy
    return p
  }
  const shadow = (g: THREE.Object3D, cast = true): void => {
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true } })
  }

  /* ---------------- masted road signs (facing oncoming traffic = -X) ------ */
  const makeSign = (kind: Parameters<typeof signFaceTexture>[0], w: number, h: number, twoPost = true): THREE.Group => {
    const g = new THREE.Group()
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signFaceTexture(kind), roughness: 0.68, metalness: 0.04 }))
    face.rotation.y = -Math.PI / 2
    face.position.y = 2.5
    g.add(face)
    const back = new THREE.BoxGeometry(w, h, 0.07)
    const bm = new THREE.Mesh(back, steelDark)
    bm.rotation.y = -Math.PI / 2
    bm.position.set(-0.055, 2.5, 0)
    g.add(bm)
    const postX = twoPost ? w * 0.34 : 0
    for (const off of twoPost ? [-postX, postX] : [0]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 2.9, 7), steel)
      post.position.set(-0.09, 1.45, off)
      g.add(post)
    }
    shadow(g)
    return g
  }
  // BIG AIR sign before the kicker (right side), speed sign at cluster entry,
  // a tyre-shop directional — placed by hand, facing the racing line
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
  }

  /* ---------------- streetlights: staggered, varied, real curved arm ---- */
  const lampGlass = new THREE.MeshStandardMaterial({ color: 0xf5e9c8, emissive: new THREE.Color(THEME.skySunTint).convertSRGBToLinear(), emissiveIntensity: 0.9, roughness: 0.35 })
  {
    let side = 1
    let s = spline.sFromX(6)
    while (s < spline.sFromX(128)) {
      s += rnd.range(15.5, 22)
      const f = spline.frame(Math.min(s, spline.length - 1))
      const lat = side * rnd.range(8.3, 8.9)
      const base = at(s, lat, -0.05)
      const g = new THREE.Group()
      const hgt = rnd.range(6.0, 6.9)
      // tapered pole via lathe
      const prof: THREE.Vector2[] = [[0.16, 0], [0.14, 0.25], [0.085, hgt * 0.85], [0.06, hgt]]
        .map(([r, y]) => new THREE.Vector2(r, y))
      const pole = new THREE.Mesh(new THREE.LatheGeometry(prof, 9), steelDark)
      g.add(pole)
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.3, 9), steelDark)
      foot.position.y = 0.15
      g.add(foot)
      // curved arm: bezier-lofted tube toward the road
      const dir = -side
      const armPts: THREE.Vector3[] = []
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        armPts.push(new THREE.Vector3(0, hgt + Math.sin(t * Math.PI * 0.5) * 0.55, dir * (t * 1.75)))
      }
      const frames: SweepFrame[] = armPts.map((p) => ({ p: [p.x, p.y, p.z], s: [1, 0, 0], u: [0, 0, dir] }))
      const arm = new THREE.Mesh(sweepProfile([[0, 0], [0.05, 0], [0.05, 0.05], [0, 0.05]] as [number, number][], frames, { caps: true, uvScale: 1 }), steel)
      void arm
      const armGeo = sweepProfile([[-0.045, -0.045], [0.045, -0.045], [0.045, 0.045], [-0.045, 0.045]], frames, { caps: true, uvScale: 1 })
      g.add(new THREE.Mesh(armGeo, steel))
      // head: angled box + glowing strip
      const head = new THREE.Mesh(roundedPlateGeo(0.52, 0.24, 0.12, 0.05), steelDark)
      head.rotation.x = Math.PI / 2
      head.rotation.z = Math.PI / 2
      head.position.set(0, hgt + 0.42, dir * 1.72)
      head.rotation.y = dir * -0.24
      g.add(head)
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), lampGlass)
      lens.position.set(0, hgt + 0.345, dir * 1.72)
      lens.rotation.x = -Math.PI / 2 + dir * 0.2
      g.add(lens)
      g.position.copy(base)
      g.rotation.y = f.yaw + rnd.range(-0.06, 0.06)
      shadow(g)
      host.add(g)
      side = side === 1 ? -1 : 1
      void pole
    }
  }

  /* ---------------- containers / drums / pallets (cluster yard) ---------- */
  const rustTex = concreteMaps(0x8d9ea3, 121)
  void rustTex
  const contMat = new THREE.MeshStandardMaterial({ color: 0x2e6470, roughness: 0.62, metalness: 0.25 })
  const contMat2 = new THREE.MeshStandardMaterial({ color: 0x8a5530, roughness: 0.75, metalness: 0.2 })
  {
    const yard = new THREE.Group()
    const contGeo = (w: number, h: number, d: number, mat: THREE.Material, corrug = true): THREE.Group => {
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), mat)
      body.position.y = h / 2
      g.add(body)
      if (corrug) for (let k = 0; k < 7; k++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(d * 0.96, h * 0.86, 0.06), mat)
        rib.position.set(0, h / 2, -w / 2 + 0.22 + k * (w / 7.8))
        g.add(rib)
      }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 0.82, w * 0.46), steelDark)
      door.position.set(d / 2 + 0.03, h / 2, -w * 0.14)
      g.add(door)
      const rt = new THREE.Mesh(new THREE.BoxGeometry(d + 0.04, 0.1, 0.14), steelDark)
      rt.position.y = h - 0.05
      g.add(rt)
      const rt2 = rt.clone()
      rt2.position.y = 0.08
      g.add(rt2)
      return g
    }
    const c1 = contGeo(2.4, 2.6, 6, contMat); c1.position.set(rnd.range(16, 19), field.natural(17, 34) - 0.06, 34); c1.rotation.y = 0.05
    const c2 = contGeo(2.4, 2.6, 6, contMat2); c2.position.set(rnd.range(21, 24), field.natural(22, 34) - 0.06, 34.4); c2.rotation.y = -0.03
    const c3 = contGeo(2.4, 2.6, 6, contMat); c3.position.set(18.5, field.natural(18.5, 34) + 2.62, 34.1); c3.rotation.y = 0.08
    // weathered teal unit on the sea verge — reads far, then ages
    const c4 = contGeo(2.2, 2.5, 5.4, new THREE.MeshStandardMaterial({ color: 0x3a6f66, roughness: 0.82, metalness: 0.1 }))
    const fV = spline.frame(spline.sFromX(-28))
    const pv = new THREE.Vector3().copy(fV.pos).addScaledVector(fV.side, -12.5)
    c4.position.set(pv.x, field.height(pv.x, pv.z) - 0.1, pv.z)
    c4.rotation.y = fV.yaw + 1.9
    shadow(yard); [c1, c2, c3, c4].forEach((c) => { shadow(c); host.add(c) })
    // drums & pallets
    const drumMat = new THREE.MeshStandardMaterial({ color: 0xb2592b, roughness: 0.6, metalness: 0.3 })
    const drumMat2 = new THREE.MeshStandardMaterial({ color: 0x365f86, roughness: 0.6, metalness: 0.3 })
    for (let k = 0; k < 6; k++) {
      const prof: THREE.Vector2[] = [[0.29, 0], [0.31, 0.08], [0.31, 0.55], [0.29, 0.62], [0.0, 0.62]].map(([r, y]) => new THREE.Vector2(r, y))
      const drum = new THREE.Mesh(new THREE.LatheGeometry(prof, 12), k % 2 ? drumMat : drumMat2)
      const x = 30 + rnd.range(0, 8) + (k % 3) * 3.1
      const z = 31 + rnd.range(-1.2, 1.2)
      drum.position.set(x, field.natural(x, z) + 0.01, z)
      drum.rotation.y = rnd.next() * 3
      if (k === 4) drum.rotation.z = 1.5
      shadow(drum)
      host.add(drum)
    }
    for (let k = 0; k < 3; k++) {
      const pal = new THREE.Group()
      for (let q = 0; q < 3; q++) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.09), new THREE.MeshStandardMaterial({ color: 0x8a7250, roughness: 0.92 }))
        top.position.set(0, 0.13, -0.4 + q * 0.4)
        pal.add(top)
      }
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 1.0), new THREE.MeshStandardMaterial({ color: 0x74603f, roughness: 0.95 }))
      p.position.y = 0.05
      pal.add(p)
      const x = 44 + k * 4.2 + rnd.range(-1, 1), z = 32 + rnd.range(-1.5, 1.5)
      pal.position.set(x, field.natural(x, z), z)
      pal.rotation.y = rnd.next() * 0.6
      shadow(pal)
      host.add(pal)
    }
    host.add(yard)
  }

  /* ---------------- water tower (east, high — a real landmark) ----------- */
  {
    const x = 122, z = 34
    const g = new THREE.Group()
    const gy = field.natural(x, z)
    const legH = 11
    const prof: THREE.Vector2[] = [[0, 0], [2.4, 0], [2.4, 0.5], [0.6, 0.8], [0.55, 2.6], [0.7, 3.1], [0, 3.15]].map(([r, y]) => new THREE.Vector2(r, y))
    const tank = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), new THREE.MeshStandardMaterial({ color: 0x8f9aa4, metalness: 0.55, roughness: 0.52 }))
    tank.position.y = legH
    g.add(tank)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.8, 14), new THREE.MeshStandardMaterial({ color: 0x6f7a84, metalness: 0.6, roughness: 0.48 }))
    cap.position.y = legH + 3.5
    g.add(cap)
    const rail = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.06, 6, 20), steel)
    rail.rotation.x = Math.PI / 2
    rail.position.y = legH + 0.62
    g.add(rail)
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4
      const lx = Math.cos(a), lz = Math.sin(a)
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, legH + 0.4, 6), steelDark)
      leg.position.set(lx * 2.05, (legH + 0.4) / 2, lz * 2.05)
      leg.rotation.set(-lz * 0.09, 0, lx * 0.09)
      g.add(leg)
      for (let q = 1; q <= 3; q++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.3, 5), steel)
        br.position.set(lx * 1.7, q * 2.7, lz * 1.7)
        br.rotation.set(0, a, 1.15)
        g.add(br)
      }
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 7), steelDark)
    pipe.position.set(0, legH - 3.5, 0)
    g.add(pipe)
    g.position.set(x, gy - 0.15, z)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4, 0.7, 12), concMat)
    pad.position.y = -0.2
    g.add(pad)
    shadow(g)
    host.add(g)
  }

  /* ---------------- radio mast on the north ridge ------------------------ */
  {
    const x = 26, z = 92
    const g = new THREE.Group()
    const h1 = 24
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.4, h1, 7), steel)
    mast.position.y = h1 / 2
    g.add(mast)
    for (let q = 0; q < 5; q++) {
      const y = 2.5 + q * 4.2
      const rr = lerp(1.7, 0.55, y / h1)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.05, 5, 12), steel)
      ring.rotation.x = Math.PI / 2
      ring.position.y = y
      g.add(ring)
      for (const a of [0, Math.PI / 2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, rr * 2, 4), steel)
        post.rotation.z = Math.PI / 2
        post.rotation.y = a
        post.position.y = y
        g.add(post)
      }
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff4436, emissive: 0xff2a1a, emissiveIntensity: 2.6, roughness: 0.4 }))
    beacon.position.y = h1 + 0.4
    g.add(beacon)
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5
      const guy = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 14, 4), steel)
      guy.position.set(Math.cos(a) * 3.6, h1 * 0.42, Math.sin(a) * 3.6)
      guy.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)
      g.add(guy)
    }
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.7, 0.5, 10), concMat)
    pad.position.y = 0.15
    g.add(pad)
    g.position.set(x, field.natural(x, z), z)
    shadow(g)
    host.add(g)
  }

  /* ---------------- headland gantry crane (SW, distant silhouette) ------- */
  {
    const x = -86, z = -76
    const g = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a7f5f, roughness: 0.7, metalness: 0.3 })
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.5, 26, 1.5), bodyMat)
    mast.position.y = 13
    g.add(mast)
    const jib = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 30), bodyMat)
    jib.position.set(0, 25, 8)
    jib.rotation.x = 0.04
    g.add(jib)
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 7), bodyMat)
    counter.position.set(0, 25, -9)
    g.add(counter)
    const cw = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 3.4), new THREE.MeshStandardMaterial({ color: 0x5c574a, roughness: 0.8 }))
    cw.position.set(0, 24.2, -11.5)
    g.add(cw)
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), bodyMat)
    hook.position.set(0, 21.5, 15)
    g.add(hook)
    const base = new THREE.Mesh(new THREE.BoxGeometry(8, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0x767164, roughness: 0.9 }))
    base.position.y = 1.2
    g.add(base)
    g.position.set(x, field.natural(x, z) - 0.4, z)
    g.rotation.y = 0.7
    shadow(g, false)
    host.add(g)
  }

  /* ---------------- far skyline (Tier-3, no shadows, fog does the rest) -- */
  {
    const g = new THREE.Group()
    g.name = 'skyline'
    const mats = [0x7a7f88, 0x8a857c, 0x6d737c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.88, metalness: 0.05 }))
    const parts: { geometry: THREE.BufferGeometry; matrix?: THREE.Matrix4; materialIndex?: number }[] = []
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
    for (let k = 0; k < 11; k++) {
      const x = -60 + k * 20 + rnd.range(-8, 8)
      const z = 128 + rnd.range(0, 42)
      const hh = rnd.range(9, 30)
      const w = rnd.range(9, 16), d = rnd.range(8, 14)
      const mi = rnd.int(0, 2)
      const gy = field.natural(x, z)
      e.set(0, rnd.range(-0.5, 0.5), 0)
      q.setFromEuler(e)
      p.set(x, gy + hh / 2 - 0.5, z); s.set(1, 1, 1)
      m4.compose(p, q, s)
      parts.push({ geometry: new THREE.BoxGeometry(w, hh, d), matrix: m4.clone(), materialIndex: mi })
      // parapet cap + one roof block (silhouette reads structured even far)
      e.y += rnd.range(-0.1, 0.1)
      q.setFromEuler(e)
      p.set(x, gy + hh - 0.3, z); s.set(1.04, 0.35, 1.04)
      m4.compose(p, q, s)
      parts.push({ geometry: new THREE.BoxGeometry(w, 0.8, d), matrix: m4.clone(), materialIndex: (mi + 1) % 3 })
      const rw = w * 0.4
      p.set(x + rnd.range(-2, 2), gy + hh + 0.9, z + rnd.range(-2, 2)); s.set(1, 1, 1)
      m4.compose(p, q, s)
      parts.push({ geometry: new THREE.BoxGeometry(rw, 1.8, rw), matrix: m4.clone(), materialIndex: 2 })
    }
    const merged = mergeGeometries(parts)
    const mesh = new THREE.Mesh(merged, mats)
    mesh.castShadow = false
    g.add(mesh)
    host.add(g)
  }
}
