import * as THREE from 'three'
import { SEED, TRACK } from '../config'
import { Rand, mergeGeometries } from '../util'
import { roundedPlateGeo } from '../assets/Textures'
import { concreteMaps, signFaceTexture } from '../assets/Textures'
import type { CoastField } from './Terrain'
import type { TrackSpline } from './TrackSpline'

/* ------------------------------------------------------------------------- *
 * One authored Tier-2 cluster (spec §4.2): offset-mass buildings with
 * parapets + caps, rooftop equipment, window relief (real frames, not
 * decals), entrances/canopies, balconies, signage — multi-material.
 * (The reusable kit passes land in Phase 4; this is the design anchor.)
 * ------------------------------------------------------------------------- */

interface Mats {
  stucco: THREE.MeshStandardMaterial
  stucco2: THREE.MeshStandardMaterial
  roofDeck: THREE.MeshStandardMaterial
  frame: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  trim: THREE.MeshStandardMaterial
  accent: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
}

function makeMats(): Mats {
  const c1 = concreteMaps(0xbdb9ae, 41)
  const c2 = concreteMaps(0x9a948a, 57)
  const c3 = concreteMaps(0x8b8f94, 63)
  const std = (m: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }, rough: number): THREE.MeshStandardMaterial => {
    const mm = new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, roughness: rough, metalness: 0.02 })
    mm.normalScale = new THREE.Vector2(0.85, 0.85)
    return mm
  }
  return {
    stucco: std(c1, 0.88),
    stucco2: std(c2, 0.9),
    roofDeck: std(c3, 0.94),
    frame: new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.5, metalness: 0.35 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x3d5a6d, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.72, ior: 1.5 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x8a4436, roughness: 0.62, metalness: 0.08 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x3a666a, roughness: 0.62, metalness: 0.06 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8f979f, roughness: 0.45, metalness: 0.8 }),
  }
}

const box = (w: number, h: number, d: number, mat: THREE.Material, name?: string): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  if (name) m.name = name
  return m
}

/** Window module: protruding frame + recessed pane (real relief, instanced). */
function windowUnit(mat: Mats, w = 1.15, h = 1.5): THREE.BufferGeometry {
  const frame = roundedPlateGeo(w, h, 0.12, 0.06)
  frame.translate(0, 0, 0.045)
  const sill = roundedPlateGeo(w + 0.18, 0.08, 0.18, 0.03)
  sill.translate(0, -h / 2 - 0.04, 0.07)
  const pane = new THREE.PlaneGeometry(w * 0.82, h * 0.82)
  pane.translate(0, 0, -0.03)
  return mergeGeometries([
    { geometry: frame, materialIndex: 0 },
    { geometry: sill, materialIndex: 0 },
    { geometry: pane, materialIndex: 1 },
  ])
}

/** Rooftop equipment cluster: HVAC blocks, duct, tank, antenna, pipes. */
function rooftopKit(mat: Mats, rnd: Rand, areaW: number, areaD: number): THREE.Group {
  const g = new THREE.Group()
  g.name = 'roof-kit'
  const nHvac = 2 + rnd.int(0, 2)
  for (let i = 0; i < nHvac; i++) {
    const w = rnd.range(0.9, 1.8), d = rnd.range(0.8, 1.4)
    const b = box(w, rnd.range(0.55, 0.95), d, i % 2 ? mat.metal : mat.roofDeck)
    b.position.set(rnd.range(-areaW / 2.6, areaW / 2.6), 0.3, rnd.range(-areaD / 2.6, areaD / 2.6))
    const grille = box(w * 0.8, 0.06, d * 0.8, mat.frame)
    grille.position.set(b.position.x, b.position.y + 0.28, b.position.z)
    g.add(b, grille)
  }
  // vent cowls
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.4, 8), mat.metal)
    c.position.set(rnd.range(-areaW / 2.4, areaW / 2.4), 0.2, rnd.range(-areaD / 2.4, areaD / 2.4))
    g.add(c)
  }
  // water tank on legs
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.0, 12), mat.metal)
  tank.position.set(areaW / 3.1, 0.82, areaD / 3.1)
  g.add(tank)
  for (const [ox, oz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]] as const) {
    const leg = box(0.07, 0.42, 0.07, mat.frame)
    leg.position.set(areaW / 3.1 + ox, 0.2, areaD / 3.1 + oz)
    g.add(leg)
  }
  // antenna + dish
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 1.7, 6), mat.metal)
  mast.position.set(-areaW / 3.2, 0.85, -areaD / 3.4)
  g.add(mast)
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, 1.1), mat.roofDeck)
  dish.rotation.x = -Math.PI / 2.4
  dish.position.set(areaW / 4, 0.62, -areaD / 2.8)
  g.add(dish)
  // pipe run along the parapet
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, areaW * 0.7, 7), mat.metal)
  pipe.rotation.z = Math.PI / 2
  pipe.position.set(0, 0.1, areaD / 2.6)
  g.add(pipe)
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return g
}

/** Parapet with cap geometry around the roof edge. */
function parapet(wallMat: THREE.Material, w: number, d: number, capMat: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  g.name = 'parapet'
  const th = 0.22, h = 0.62
  for (const [bw, bd, px, pz] of [[w + th * 2, th, 0, d / 2 + th / 2], [w + th * 2, th, 0, -d / 2 - th / 2], [th, d, w / 2 + th / 2, 0], [th, d, -w / 2 - th / 2, 0]] as const) {
    const wall = box(bw, h, bd, wallMat)
    wall.position.set(px, h / 2, pz)
    const cap = box(bw + 0.07, 0.07, bd + 0.07, capMat)
    cap.position.set(px, h + 0.03, pz)
    g.add(wall, cap)
  }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return g
}

function signMesh(kind: Parameters<typeof signFaceTexture>[0], w: number, h: number, mat: Mats, postMat: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signFaceTexture(kind), roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide }))
  g.add(face)
  const back = box(w + 0.08, h + 0.08, 0.06, mat.frame)
  back.position.z = -0.05
  g.add(back)
  void postMat
  return g
}

/* ------------------------------------------ the authored three ---------------- */

export function buildCluster(spline: TrackSpline, field: CoastField): THREE.Group {
  const cluster = new THREE.Group()
  cluster.name = 'building-cluster'
  const mat = makeMats()
  const rnd = new Rand(SEED ^ 0xc1a5)

  const placeOnPad = (o: THREE.Object3D, x: number, z: number, yaw: number): void => {
    o.position.set(x, field.natural(x, z) - 0.12, z)
    o.rotation.y = yaw
  }

  /* ---- A: corrugated warehouse / moto-shop (east end of view) ----------- */
  {
    const g = new THREE.Group()
    g.name = 'bldg-warehouse'
    const W = 17, D = 11.5, H = 8.2
    const main = box(W, H, D, mat.stucco2, 'mass')
    main.position.y = H / 2
    g.add(main)
    // offset lower wing (asymmetric massing, not one box)
    const wing = box(6.5, H * 0.55, D + 2.4, mat.stucco, 'wing')
    wing.position.set(-W / 2 + 2.4, H * 0.275, 1.3)
    g.add(wing)
    const wingCap = box(6.7, 0.14, D + 2.6, mat.roofDeck)
    wingCap.position.set(wing.position.x, H * 0.55 + 0.07, wing.position.z)
    g.add(wingCap)
    // roof + parapet
    const deck = box(W - 0.3, 0.12, D - 0.3, mat.roofDeck, 'roof')
    deck.position.y = H + 0.05
    g.add(deck)
    const par = parapet(mat.roofDeck, W, D, mat.roofDeck)
    par.position.y = H + 0.1
    g.add(par)
    const kit = rooftopKit(mat, rnd, W * 0.6, D * 0.6)
    kit.position.y = H + 0.12
    g.add(kit)
    // dock bays on the road face (+z? faces -z toward road side... cluster sits north of road; road-facing face is -z)
    for (let i = 0; i < 3; i++) {
      const recess = box(3.1, 3.4, 0.3, mat.frame)
      recess.position.set(-4.5 + i * 4.5, 1.72, -D / 2 - 0.02)
      g.add(recess)
      const door = box(2.8, 3.1, 0.1, i === 1 ? mat.accent : mat.metal)
      door.position.set(-4.5 + i * 4.5, 1.62, -D / 2 + 0.14)
      g.add(door)
      // hood over each bay
      const hood = box(3.5, 0.12, 0.85, mat.trim)
      hood.position.set(-4.5 + i * 4.5, 3.62, -D / 2 - 0.3)
      hood.rotation.x = -0.12
      g.add(hood)
    }
    // high clerestory strip windows (relief via real frames)
    const winA = windowUnit(mat, 1.3, 0.9)
    const instA = new THREE.InstancedMesh(winA, [mat.frame, mat.glass], 8)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
    for (let i = 0; i < 8; i++) {
      e.set(0, Math.PI, 0); q.setFromEuler(e)
      p.set(-6.4 + i * 1.85, 6.1, -D / 2 - 0.02)
      m4.compose(p, q, s); instA.setMatrixAt(i, m4)
    }
    instA.instanceMatrix.needsUpdate = true
    instA.castShadow = true
    g.add(instA)
    // wall sign
    const sign = signMesh('tyres', 5.2, 1.7, mat, mat.frame)
    sign.position.set(1.5, 5.6, -D / 2 - 0.1)
    g.add(sign)
    // entrance canopy with rods
    const canopy = box(4.2, 0.14, 1.6, mat.trim)
    canopy.position.set(6.4, 2.9, -D / 2 - 0.7)
    canopy.rotation.x = -0.05
    g.add(canopy)
    for (const ox of [4.8, 8.0]) {
      const rod = box(0.07, 0.9, 0.07, mat.metal)
      rod.position.set(ox, 3.3, -D / 2 - 1.4)
      g.add(rod)
    }
    const doorIn = box(1.1, 2.2, 0.1, mat.frame)
    doorIn.position.set(6.4, 1.12, -D / 2 - 0.02)
    g.add(doorIn)
    g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
    placeOnPad(g, 26, 22, 0.06)
    cluster.add(g)
  }

  /* ---- B: cafe / corner store with canopy --------------------------------- */
  {
    const g = new THREE.Group()
    g.name = 'bldg-cafe'
    const W = 11, D = 9, H = 6.2
    const main = box(W, H, D, mat.stucco, 'mass')
    main.position.y = H / 2
    g.add(main)
    // false-front parapet taller on one side (authored silhouette)
    const front = box(W + 0.3, 1.4, 0.4, mat.stucco)
    front.position.set(0, H + 0.55, -D / 2 + 0.1)
    g.add(front)
    const deck = box(W - 0.2, 0.1, D - 0.2, mat.roofDeck)
    deck.position.y = H + 0.02
    g.add(deck)
    const kit = rooftopKit(mat, rnd, W * 0.5, D * 0.5)
    kit.position.y = H + 0.08
    kit.scale.setScalar(0.8)
    g.add(kit)
    // chimney stack
    const chim = box(0.8, 1.8, 0.8, mat.stucco2)
    chim.position.set(W / 2 - 1.2, H + 0.9, 1.5)
    g.add(chim)
    const chimCap = box(0.95, 0.1, 0.95, mat.roofDeck)
    chimCap.position.set(W / 2 - 1.2, H + 1.85, 1.5)
    g.add(chimCap)
    // storefront: glazing band with mullion frames + recessed entry
    const band = box(W * 0.8, 2.5, 0.24, mat.frame)
    band.position.set(-0.6, 1.55, -D / 2 - 0.06)
    g.add(band)
    for (let i = 0; i < 4; i++) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.1), mat.glass)
      pane.position.set(-0.6 - W * 0.3 + 0.95 + i * 2.15, 1.55, -D / 2 - 0.2)
      g.add(pane)
    }
    const entry = box(1.3, 2.4, 0.16, mat.accent)
    entry.position.set(W / 2 - 1.6, 1.2, -D / 2 + 0.02)
    g.add(entry)
    // fabric canopy on rods
    const canopy = box(6.5, 0.12, 1.9, mat.trim)
    canopy.position.set(-0.6, 3.05, -D / 2 - 0.85)
    canopy.rotation.x = -0.13
    g.add(canopy)
    const skirt = box(6.5, 0.3, 0.06, mat.trim)
    skirt.position.set(-0.6, 2.9, -D / 2 - 1.75)
    g.add(skirt)
    for (const ox of [-3.6, 2.4]) {
      const rod = box(0.06, 1.15, 0.06, mat.metal)
      rod.position.set(ox, 3.55, -D / 2 - 1.6)
      rod.rotation.x = -0.5
      g.add(rod)
    }
    // sign board above storefront
    const sign = signMesh('cafe', 4.4, 1.35, mat, mat.frame)
    sign.position.set(-0.6, 4.55, -D / 2 - 0.14)
    g.add(sign)
    // side windows
    const winB = windowUnit(mat)
    const instB = new THREE.InstancedMesh(winB, [mat.frame, mat.glass], 3)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
    for (let i = 0; i < 3; i++) {
      e.set(0, Math.PI / 2, 0); q.setFromEuler(e)
      p.set(W / 2 - 0.05, 3.6, -2 + i * 2.2)
      m4.compose(p, q, s); instB.setMatrixAt(i, m4)
    }
    instB.instanceMatrix.needsUpdate = true
    instB.castShadow = true
    g.add(instB)
    g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
    placeOnPad(g, 46, 26, -0.1)
    cluster.add(g)
  }

  /* ---- C: apartment block with balconies ---------------------------------- */
  {
    const g = new THREE.Group()
    g.name = 'bldg-apartment'
    const W = 13, D = 11.5, H = 19
    const main = box(W, H, D, mat.stucco2, 'mass')
    main.position.y = H / 2
    g.add(main)
    // setback top floor = stepped massing
    const top = box(W * 0.62, 3.1, D * 0.7, mat.stucco)
    top.position.set(0.8, H + 1.55, 0.6)
    g.add(top)
    const deck = box(W * 0.62 - 0.2, 0.1, D * 0.7 - 0.2, mat.roofDeck)
    deck.position.set(0.8, H + 3.1, 0.6)
    g.add(deck)
    const kit = rooftopKit(mat, rnd, W * 0.4, D * 0.4)
    kit.position.set(0.8, H + 3.16, 0.6)
    kit.scale.setScalar(0.75)
    g.add(kit)
    // lower roof deck + parapet around full footprint
    const par = parapet(mat.roofDeck, W, D, mat.roofDeck)
    par.position.y = H + 0.06
    g.add(par)
    const parTop = parapet(mat.roofDeck, W * 0.62, D * 0.7, mat.roofDeck)
    parTop.position.set(0.8, H + 3.14, 0.6)
    parTop.scale.setScalar(0.8)
    g.add(parTop)
    // window relief: full grid on the road face (real protruding frames)
    const winC = windowUnit(mat)
    const cols = 5, rows = 6
    const instC = new THREE.InstancedMesh(winC, [mat.frame, mat.glass], cols * rows)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
    let wi = 0
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 2) continue // doorway slot
      e.set(0, Math.PI, 0); q.setFromEuler(e)
      p.set(-W / 2 + 1.7 + c * 2.4, 2.0 + r * 2.55, -D / 2 - 0.04)
      m4.compose(p, q, s); instC.setMatrixAt(wi++, m4)
    }
    instC.count = wi
    instC.instanceMatrix.needsUpdate = true
    instC.castShadow = true
    g.add(instC)
    // balconies on floors 2..4 (slab + rail panel + posts)
    for (let r = 2; r <= 4; r++) {
      const by = 2.0 + r * 2.55 - 0.9
      for (const bx of [-3.9, 3.9]) {
        const slab = box(3.0, 0.14, 1.15, mat.roofDeck)
        slab.position.set(bx, by, -D / 2 - 0.55)
        const rail = box(3.0, 0.85, 0.08, mat.stucco)
        rail.position.set(bx, by + 0.5, -D / 2 - 1.1)
        const rc = r % 2 ? mat.accent : mat.trim
        rail.material = rc
        const cap = box(3.1, 0.07, 0.14, mat.roofDeck)
        cap.position.set(bx, by + 0.95, -D / 2 - 1.1)
        g.add(slab, rail, cap)
      }
    }
    // ground-floor arcade: recessed entry + shopfront glass
    const rec = box(W * 0.85, 2.7, 0.5, mat.frame)
    rec.position.set(0, 1.4, -D / 2 + 0.08)
    g.add(rec)
    const shop = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.75, 2.3), mat.glass)
    shop.position.set(0, 1.4, -D / 2 - 0.18)
    g.add(shop)
    const doorC = box(1.4, 2.2, 0.1, mat.trim)
    doorC.position.set(-W / 2 + 1.7 * 2 + 1.2, 1.1, -D / 2 - 0.2)
    g.add(doorC)
    // corner trim band + floor divisions (panel breaks)
    for (let r = 1; r <= 5; r++) {
      const band = box(W + 0.14, 0.16, 0.14, mat.roofDeck)
      band.position.set(0, r * 2.55 + 0.35, -D / 2 - 0.02)
      g.add(band)
    }
    g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
    placeOnPad(g, 66, 21, 0.045)
    cluster.add(g)
  }

  // pad dressing: kerb planters + bollards in front of the shops (right side)
  const dressing = new THREE.Group()
  dressing.name = 'cluster-dressing'
  for (let i = 0; i < 5; i++) {
    const s = spline.sFromX(24 + i * 9.5 + rnd.range(-1.5, 1.5))
    const f = spline.frame(s)
    const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, 8.6)
    p.y = field.height(p.x, p.z)
    const planter = box(1.8, 0.72, 0.9, mat.stucco2)
    planter.position.copy(p).add(new THREE.Vector3(0, 0.28, 0))
    planter.rotation.y = f.yaw + rnd.range(-0.1, 0.1)
    const soil = box(1.3, 0.1, 0.55, new THREE.MeshStandardMaterial({ color: 0x3e3225, roughness: 1 }))
    soil.position.copy(planter.position).add(new THREE.Vector3(0, 0.3, 0))
    soil.rotation.y = planter.rotation.y
    planter.castShadow = soil.castShadow = true
    planter.receiveShadow = soil.receiveShadow = true
    dressing.add(planter, soil)
  }
  cluster.add(dressing)
  void TRACK
  return cluster
}
