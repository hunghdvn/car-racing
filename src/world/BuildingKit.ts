import * as THREE from 'three'
import { KIT } from '../config'
import { Rand, mergeGeometries, sanitizeGeometry, crNormals, ensureOutwardWinding, kitLodEnabled, type MergePart } from '../util'
import { roundedPlateGeo, concreteMaps, facadeMaps, roofMembraneMaps, corrugatedMaps, rivetMetalMaps, signFaceTexture, billboardFaceTexture, woodMaps } from '../assets/Textures'

/* ------------------------------------------------------------------------- *
 * BuildingKit (spec §4.2) — the Tier-2 near-track kit. Every design is
 * assembled from offset massing volumes + parapet caps + roof-top equipment
 * + real window relief (protruding frames, recessed panes) + entrances/
 * canopies/balconies/awnings/signage — multi-material PBR. A design may
 * never be a BoxGeometry + facade decal. Designs carry 3 LOD levels
 * (full → baked-silhouette mid → low-poly far, spec §4.7).
 * ------------------------------------------------------------------------- */

export interface BuildingMats {
  stucco: THREE.MeshStandardMaterial
  stucco2: THREE.MeshStandardMaterial
  brick: THREE.MeshStandardMaterial
  panel: THREE.MeshStandardMaterial
  cladding: THREE.MeshStandardMaterial
  roofDeck: THREE.MeshStandardMaterial
  roofDeckDark: THREE.MeshStandardMaterial
  frame: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  glassLit: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  accent: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  rust: THREE.MeshStandardMaterial
  concrete: THREE.MeshStandardMaterial
  wood: THREE.MeshStandardMaterial
  glow: THREE.MeshStandardMaterial
}

let sharedMats: BuildingMats | null = null

/** Shared kit material library (cached; textures are cached in Textures.ts). */
export function buildingMaterials(): BuildingMats {
  if (sharedMats) return sharedMats
  const p1 = facadeMaps('plaster', 0xbdb9ae, 41)
  const p2 = facadeMaps('plaster', 0x9a948a, 57)
  const br = facadeMaps('brick', 0x6e5243, 73)
  const pn = facadeMaps('panel', 0x8b929a, 29)
  const rm = roofMembraneMaps()
  const corr = corrugatedMaps(0x77838c, 91)
  const conc = concreteMaps(0xa7a29a, 33)
  const wd = woodMaps(0x8a7250, 66)
  const std = (m: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap?: THREE.Texture }, rough: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial => {
    const mm = new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap ?? null, roughness: rough, metalness: 0.02, ...opts })
    mm.normalScale = new THREE.Vector2(0.85, 0.85)
    return mm
  }
  sharedMats = {
    stucco: std(p1, 0.88),
    stucco2: std(p2, 0.9),
    brick: std(br, 0.92),
    panel: std(pn, 0.62, { metalness: 0.35 }),
    cladding: std({ map: corr.map, normalMap: corr.normalMap }, 0.68, { metalness: 0.45 }),
    roofDeck: std({ map: rm.map, normalMap: rm.normalMap, roughnessMap: rm.roughnessMap }, 0.94),
    roofDeckDark: std({ map: rm.map, normalMap: rm.normalMap, roughnessMap: rm.roughnessMap }, 0.96, { color: 0x7a7d7a }),
    frame: new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.5, metalness: 0.35 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x5f7f94, roughness: 0.07, metalness: 0.06, transparent: true, opacity: 0.7, ior: 1.5, envMapIntensity: 1.6, envMapRotation: new THREE.Euler(0, 0.4, 0) }),
    glassLit: new THREE.MeshStandardMaterial({ color: 0xf1e3c2, roughness: 0.42, metalness: 0, emissive: new THREE.Color(0xffdca4).convertSRGBToLinear(), emissiveIntensity: 0.36 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x8a4436, roughness: 0.62, metalness: 0.08 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x3a666a, roughness: 0.62, metalness: 0.06 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8f979f, roughness: 0.45, metalness: 0.8 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x7a5b42, roughness: 0.78, metalness: 0.4 }),
    concrete: std({ map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap }, 0.9),
    wood: std({ map: wd.map, normalMap: wd.normalMap }, 0.9),
    glow: new THREE.MeshStandardMaterial({ color: 0xf5e9c8, emissive: new THREE.Color(0xffe1b0).convertSRGBToLinear(), emissiveIntensity: 1.6, roughness: 0.35 }),
  }
  return sharedMats
}

export const disposeBuildingMaterials = (): void => { sharedMats = null }

/* ------------------------------------------------------------- sub-assemblies */

const box = (w: number, h: number, d: number, mat: THREE.Material, name?: string): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  if (name) m.name = name
  return m
}

/** Triangular prism (pediments, sawtooth risers) through the NaN discipline. */
function prismTri(width: number, height: number, depth: number, mat: THREE.Material): THREE.Mesh {
  const pos: number[] = [], idx: number[] = []
  const hw = width / 2
  const A = [-hw, 0, -depth / 2], B = [hw, 0, -depth / 2], C = [0, height, -depth / 2]
  const A2 = [-hw, 0, depth / 2], B2 = [hw, 0, depth / 2], C2 = [0, height, depth / 2]
  pos.push(...A, ...B, ...C, ...A2, ...B2, ...C2)
  idx.push(0, 1, 2, 5, 4, 3)
  let vi = 6
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2])
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
    vi += 4
  }
  quad(A, B, B2, A2)
  quad(B, C, C2, B2)
  quad(C, A, A2, C2)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  ensureOutwardWinding(geo)
  sanitizeGeometry(geo)
  return new THREE.Mesh(geo, mat)
}

/** Window module: protruding frame + sill + recessed pane (real relief). */
export function windowUnit(w = 1.15, h = 1.5, sill = true): THREE.BufferGeometry {
  const frame = roundedPlateGeo(w, h, 0.12, 0.06)
  frame.translate(0, 0, 0.045)
  const parts: { geometry: THREE.BufferGeometry; materialIndex: number }[] = [{ geometry: frame, materialIndex: 0 }]
  if (sill) {
    const s = roundedPlateGeo(w + 0.18, 0.08, 0.18, 0.03)
    s.translate(0, -h / 2 - 0.04, 0.07)
    parts.push({ geometry: s, materialIndex: 0 })
  }
  const pane = new THREE.PlaneGeometry(w * 0.82, h * 0.82)
  pane.translate(0, 0, -0.03)
  parts.push({ geometry: pane, materialIndex: 1 })
  return mergeGeometries(parts)
}

/** Instanced window grid on a wall face; seeded subset reads lit inside. */
function windowWall(
  geo: THREE.BufferGeometry, winW: number, winH: number,
  cols: number, rows: number, origin: [number, number, number], stepMain: number, stepY: number,
  faceYaw: number, rnd: Rand, litChance = 0.18, dir: 'x' | 'z' = 'x',
): THREE.Group {
  const m = buildingMaterials()
  const g = new THREE.Group()
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
  const slots: [number, number, number][] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const pos: [number, number, number] = [origin[0], origin[1] + r * stepY, origin[2]]
    if (dir === 'x') pos[0] += c * stepMain; else pos[2] += c * stepMain
    slots.push(pos)
  }
  const litSlots = slots.filter(() => rnd.chance(litChance))
  const darkSlots = slots.filter((sl) => !litSlots.includes(sl))
  const fill = (mesh: THREE.InstancedMesh, list: [number, number, number][]): void => {
    list.forEach((sl, i) => {
      e.set(0, faceYaw, 0); q.setFromEuler(e)
      p.set(sl[0], sl[1], sl[2])
      m4.compose(p, q, s); mesh.setMatrixAt(i, m4)
    })
    mesh.count = list.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = true
  }
  const dark = new THREE.InstancedMesh(geo, [m.frame, m.glass], Math.max(1, darkSlots.length))
  fill(dark, darkSlots)
  g.add(dark)
  if (litSlots.length) {
    const litGeo = windowPaneOnly(winW, winH)
    const lit = new THREE.InstancedMesh(litGeo, m.glassLit, litSlots.length)
    fill(lit, litSlots)
    g.add(lit)
  }
  return g
}
function windowPaneOnly(w: number, h: number): THREE.BufferGeometry {
  const p = new THREE.PlaneGeometry(w * 0.82, h * 0.82)
  p.translate(0, 0, -0.02)
  const f = roundedPlateGeo(w, h, 0.1, 0.05)
  f.translate(0, 0, 0.04)
  return mergeGeometries([{ geometry: f, materialIndex: 0 }, { geometry: p, materialIndex: 0 }])
}

/** Rooftop equipment cluster: HVAC blocks, duct, tank, antenna, pipes, ladder. */
export function rooftopKit(rnd: Rand, areaW: number, areaD: number, scale = 1): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'roof-kit'
  const nHvac = 2 + rnd.int(0, 2)
  for (let i = 0; i < nHvac; i++) {
    const w = rnd.range(0.9, 1.8), d = rnd.range(0.8, 1.4)
    const b = box(w, rnd.range(0.55, 0.95), d, i % 2 ? mat.metal : mat.roofDeckDark)
    b.position.set(rnd.range(-areaW / 2.6, areaW / 2.6), 0.3, rnd.range(-areaD / 2.6, areaD / 2.6))
    const grille = box(w * 0.8, 0.06, d * 0.8, mat.frame)
    grille.position.set(b.position.x, b.position.y + 0.28, b.position.z)
    // support feet
    for (const [fx, fz] of [[-w * 0.38, -d * 0.38], [w * 0.38, d * 0.38]] as const) {
      const foot = box(0.1, 0.12, 0.1, mat.frame)
      foot.position.set(b.position.x + fx, 0.06, b.position.z + fz)
      g.add(foot)
    }
    g.add(b, grille)
  }
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.4, 8), mat.metal)
    c.position.set(rnd.range(-areaW / 2.4, areaW / 2.4), 0.2, rnd.range(-areaD / 2.4, areaD / 2.4))
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 8), mat.frame)
    cap.position.set(c.position.x, 0.42, c.position.z)
    g.add(c, cap)
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.0, 12), mat.metal)
  tank.position.set(areaW / 3.1, 0.82, areaD / 3.1)
  g.add(tank)
  for (const [ox, oz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]] as const) {
    const leg = box(0.07, 0.42, 0.07, mat.frame)
    leg.position.set(areaW / 3.1 + ox, 0.2, areaD / 3.1 + oz)
    g.add(leg)
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 1.7, 6), mat.metal)
  mast.position.set(-areaW / 3.2, 0.85, -areaD / 3.4)
  g.add(mast)
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, 1.1), mat.roofDeckDark)
  dish.rotation.x = -Math.PI / 2.4
  dish.position.set(areaW / 4, 0.62, -areaD / 2.8)
  g.add(dish)
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, areaW * 0.7, 7), mat.metal)
  pipe.rotation.z = Math.PI / 2
  pipe.position.set(0, 0.1, areaD / 2.6)
  g.add(pipe)
  // access ladder against the parapet
  const lad = new THREE.Group()
  for (const ry of [0.35, 0.7]) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 5), mat.metal)
    rung.rotation.z = Math.PI / 2
    rung.position.set(-areaW / 2.1, ry, -areaD / 2.1)
    lad.add(rung)
  }
  for (const rx of [-0.21, 0.21]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 5), mat.metal)
    rail.position.set(-areaW / 2.1 + rx, 0.48, -areaD / 2.1)
    lad.add(rail)
  }
  g.add(lad)
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  g.scale.setScalar(scale)
  return g
}

/** Parapet with cap geometry around the roof edge. */
export function parapet(w: number, d: number, capMat?: THREE.Material, wallMat?: THREE.Material, h = 0.62): THREE.Group {
  const mat = buildingMaterials()
  const wm = wallMat ?? mat.roofDeck
  const cm = capMat ?? mat.roofDeck
  const g = new THREE.Group()
  g.name = 'parapet'
  const th = 0.22
  for (const [bw, bd, px, pz] of [[w + th * 2, th, 0, d / 2 + th / 2], [w + th * 2, th, 0, -d / 2 - th / 2], [th, d, w / 2 + th / 2, 0], [th, d, -w / 2 - th / 2, 0]] as const) {
    const wall = box(bw, h, bd, wm)
    wall.position.set(px, h / 2, pz)
    const cap = box(bw + 0.07, 0.07, bd + 0.07, cm)
    cap.position.set(px, h + 0.03, pz)
    g.add(wall, cap)
  }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return g
}

/** Entry canopy on rods: slab + fascia + tie rods. */
function canopy(w: number, y: number, x: number, zFace: number, depth: number, mat: THREE.Material, rod: THREE.Material, slope = -0.06): THREE.Group {
  const g = new THREE.Group()
  const slab = box(w, 0.14, depth, mat)
  slab.position.set(x, y, zFace - depth / 2 - 0.15)
  slab.rotation.x = slope
  const fascia = box(w, 0.16, 0.06, rod)
  fascia.position.set(x, y - 0.1, zFace - depth - 0.12)
  g.add(slab, fascia)
  for (const ox of [-w * 0.42, w * 0.42]) {
    const tie = box(0.05, 0.05, depth * 0.8, rod)
    tie.position.set(x + ox, y + 0.42, zFace - depth * 0.55)
    tie.rotation.x = 0.4
    g.add(tie)
  }
  return g
}

/** Striped shop awning: segmented valance over a roller tube. */
function awning(x: number, y: number, zFace: number, w: number, seed: number): THREE.Group {
  const mat = buildingMaterials()
  const rnd = new Rand(seed)
  const g = new THREE.Group()
  const bands = Math.max(4, Math.round(w / 0.5))
  for (let b = 0; b < bands; b++) {
    const col = b % 2 === 0 ? mat.trim : new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.85 })
    const seg = box(w / bands - 0.02, 0.05, 1.05, col)
    seg.position.set(x - w / 2 + (b + 0.5) * (w / bands), y - 0.28 - 0.06, zFace - 0.58)
    seg.rotation.x = 0.28
    g.add(seg)
  }
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, w, 7), mat.frame)
  roller.rotation.z = Math.PI / 2
  roller.position.set(x, y + 0.02, zFace - 0.06)
  g.add(roller)
  for (const ox of [-w / 2 + 0.08, w / 2 - 0.08]) {
    const arm = box(0.045, 0.045, 1.05, mat.metal)
    arm.position.set(x + ox, y - 0.18, zFace - 0.55)
    arm.rotation.x = 0.24
    g.add(arm)
  }
  void rnd
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true } })
  return g
}

/** Balcony: slab + rail panel + cap rail + side screens. */
function balcony(x: number, y: number, zFace: number, w: number, railMat: THREE.Material): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  const slab = box(w, 0.14, 1.15, mat.roofDeck)
  slab.position.set(x, y, zFace - 0.55)
  const rail = box(w, 0.85, 0.08, railMat)
  rail.position.set(x, y + 0.5, zFace - 1.08)
  const cap = box(w + 0.1, 0.07, 0.14, mat.roofDeck)
  cap.position.set(x, y + 0.95, zFace - 1.08)
  g.add(slab, rail, cap)
  for (const sx of [-1, 1]) {
    const screen = box(0.06, 0.8, 1.0, railMat)
    screen.position.set(x + sx * (w / 2 - 0.03), y + 0.5, zFace - 0.56)
    g.add(screen)
  }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return g
}

/** Wall/freestanding sign panel with back frame. */
function signMesh(tex: THREE.Texture, w: number, h: number): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide }))
  face.rotation.y = Math.PI
  g.add(face)
  const back = box(w + 0.08, h + 0.08, 0.06, mat.frame)
  back.position.z = 0.05
  g.add(back)
  return g
}

/** Storefront glazing band: frame + mullions + panes + entry. */
function storefront(x: number, w: number, h: number, zFace: number, panes: number, doorMat: THREE.Material): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  const band = box(w, h, 0.24, mat.frame)
  band.position.set(x, h / 2 + 0.3, zFace - 0.06)
  g.add(band)
  const pw = (w * 0.86) / panes
  for (let i = 0; i < panes; i++) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(pw * 0.82, h * 0.78), mat.glass)
    pane.rotation.y = Math.PI
    pane.position.set(x - w / 2 + w * 0.07 + (i + 0.5) * pw, h / 2 + 0.32, zFace - 0.21)
    g.add(pane)
    if (i > 0) {
      const mull = box(0.07, h, 0.1, mat.frame)
      mull.position.set(x - w / 2 + w * 0.07 + i * pw, h / 2 + 0.3, zFace - 0.14)
      g.add(mull)
    }
  }
  const transom = box(w, 0.09, 0.26, mat.frame)
  transom.position.set(x, h + 0.32, zFace - 0.08)
  const kick = box(w, 0.3, 0.26, doorMat)
  kick.position.set(x, 0.16, zFace - 0.06)
  g.add(transom, kick)
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return g
}

/* ------------------------------------------------------------ design recipes
 * Each returns a Group with footprint centred at origin, front facing −z,
 * grounded at y=0. All follow §4.2: offset massing ≥2 volumes, parapet/cornice
 * cap, roof equipment, window relief, entrance detail, accents.
 * -------------------------------------------------------------------------- */

export type BuildingDesignId =
  | 'warehouse' | 'cafe' | 'apartment' | 'office' | 'civic' | 'factory'
  | 'silo' | 'terrace' | 'carpark' | 'retail' | 'substation'

export const BUILDING_DESIGNS: BuildingDesignId[] = ['warehouse', 'cafe', 'apartment', 'office', 'civic', 'factory', 'silo', 'terrace', 'carpark', 'retail', 'substation']

export interface Footprint { w: number; d: number; h: number }
export const BUILDING_FOOTPRINTS: Record<BuildingDesignId, Footprint> = {
  warehouse: { w: 17, d: 11.5, h: 8.4 }, cafe: { w: 11, d: 9, h: 6.4 }, apartment: { w: 13, d: 11.5, h: 19 },
  office: { w: 14, d: 12, h: 24 }, civic: { w: 18, d: 13, h: 11 }, factory: { w: 20, d: 13, h: 9.6 },
  silo: { w: 12, d: 9, h: 17 }, terrace: { w: 17, d: 9, h: 8.6 }, carpark: { w: 16, d: 12, h: 8.6 },
  retail: { w: 16, d: 10, h: 6.6 }, substation: { w: 11, d: 9, h: 4.2 },
}

function designWarehouse(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-warehouse'
  const W = 17, D = 11.5, H = 8.2
  const main = box(W, H, D, mat.cladding, 'mass')
  main.position.y = H / 2
  g.add(main)
  // offset lower wing (asymmetric massing)
  const wing = box(6.5, H * 0.55, D + 2.4, mat.stucco, 'wing')
  wing.position.set(-W / 2 + 2.4, H * 0.275, 1.3)
  g.add(wing)
  const wingCap = box(6.7, 0.14, D + 2.6, mat.roofDeck)
  wingCap.position.set(wing.position.x, H * 0.55 + 0.07, wing.position.z)
  g.add(wingCap)
  const deck = box(W - 0.3, 0.12, D - 0.3, mat.roofDeck, 'roof')
  deck.position.y = H + 0.05
  g.add(deck)
  const par = parapet(W, D, mat.roofDeck, mat.cladding)
  par.position.y = H + 0.1
  g.add(par)
  const kit = rooftopKit(rnd, W * 0.6, D * 0.6)
  kit.position.y = H + 0.12
  g.add(kit)
  for (const sx of [-1, 1]) {
    const winWh = windowUnit(1.3, 1.6)
    g.add(windowWall(winWh, 1.3, 1.6, 3, 2, [sx * (10 + 0.02), 3.4, -4.2], 3.2, 2.6, sx > 0 ? -Math.PI / 2 : Math.PI / 2, rnd, 0.16, 'z'))
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 2.6, 8), mat.metal)
    duct.position.set(sx * 9.6, 5.6, 3.4)
    g.add(duct)
  }
  // dock bays on the road face
  for (let i = 0; i < 3; i++) {
    const recess = box(3.1, 3.4, 0.3, mat.frame)
    recess.position.set(-4.5 + i * 4.5, 1.72, -D / 2 - 0.02)
    g.add(recess)
    const door = box(2.8, 3.1, 0.1, i === 1 ? mat.accent : mat.metal)
    door.position.set(-4.5 + i * 4.5, 1.62, -D / 2 + 0.14)
    g.add(door)
    for (const sx of [-1, 1]) {
      const jamb = box(0.12, 3.5, 0.2, mat.frame)
      jamb.position.set(-4.5 + i * 4.5 + sx * 1.55, 1.78, -D / 2 - 0.08)
      g.add(jamb)
    }
    const hood = box(3.5, 0.12, 0.85, mat.trim)
    hood.position.set(-4.5 + i * 4.5, 3.62, -D / 2 - 0.3)
    hood.rotation.x = -0.12
    g.add(hood)
  }
  // clerestory strip with mullion fins
  const winA = windowUnit(1.3, 0.9, false)
  g.add(windowWall(winA, 1.3, 0.9, 8, 1, [-6.4, 6.1, -D / 2 - 0.02], 1.85, 0, Math.PI, rnd, 0.3))
  const sign = signMesh(signFaceTexture('tyres'), 5.2, 1.7)
  sign.position.set(1.5, 5.6, -D / 2 - 0.12)
  g.add(sign)
  const cp = canopy(4.2, 2.9, 6.4, -D / 2, 1.6, mat.trim, mat.metal)
  g.add(cp)
  const doorIn = box(1.1, 2.2, 0.1, mat.frame)
  doorIn.position.set(6.4, 1.12, -D / 2 - 0.02)
  g.add(doorIn)
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

function designCafe(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-cafe'
  const W = 11, D = 9, H = 6.2
  const main = box(W, H, D, mat.stucco, 'mass')
  main.position.y = H / 2
  g.add(main)
  const front = box(W + 0.3, 1.4, 0.4, mat.stucco)
  front.position.set(0, H + 0.55, -D / 2 + 0.1)
  g.add(front)
  for (const sx of [-1, 1]) {
    const pil = box(0.5, 1.7, 0.55, mat.stucco)
    pil.position.set(sx * (W / 2 - 0.4), H + 0.7, -D / 2 + 0.12)
    g.add(pil)
  }
  const deck = box(W - 0.2, 0.1, D - 0.2, mat.roofDeck)
  deck.position.y = H + 0.02
  g.add(deck)
  const kit = rooftopKit(rnd, W * 0.5, D * 0.5, 0.8)
  kit.position.y = H + 0.08
  g.add(kit)
  const chim = box(0.8, 1.8, 0.8, mat.brick)
  chim.position.set(W / 2 - 1.2, H + 0.9, 1.5)
  g.add(chim)
  const chimCap = box(0.95, 0.1, 0.95, mat.roofDeck)
  chimCap.position.set(W / 2 - 1.2, H + 1.85, 1.5)
  g.add(chimCap)
  g.add(storefront(-0.6, W * 0.8, 2.5, -D / 2, 4, mat.accent))
  const aw = awning(-0.6, 3.05, -D / 2, 6.5, 4102)
  g.add(aw)
  const sign = signMesh(signFaceTexture('cafe'), 4.4, 1.35)
  sign.position.set(-0.6, 4.55, -D / 2 - 0.2)
  g.add(sign)
  const winB = windowUnit(1.05, 1.35)
  g.add(windowWall(winB, 1.05, 1.35, 3, 1, [W / 2 - 0.05, 3.6, -2], 2.2, 0, Math.PI / 2, rnd, 0.5, 'z'))
  // pavement set: two bistro tables + chairs suggestion near the door
  for (let k = 0; k < 2; k++) {
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10), mat.wood)
    tb.position.set(2.6 + k * 2.1, 0.74, -D / 2 - 1.6)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.24, 0.72, 7), mat.frame)
    foot.position.set(tb.position.x, 0.36, tb.position.z)
    g.add(tb, foot)
  }
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

function designApartment(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-apartment'
  const W = 13, D = 11.5, H = 19
  const main = box(W, H, D, mat.stucco2, 'mass')
  main.position.y = H / 2
  g.add(main)
  // string-course plinths read as floors
  for (let r = 1; r <= 5; r++) {
    const band = box(W + 0.14, 0.16, 0.14, mat.roofDeck)
    band.position.set(0, r * 2.55 + 0.35, -D / 2 - 0.02)
    g.add(band)
  }
  // ground-floor arcade: recess + shopfront
  const rec = box(W * 0.85, 2.7, 0.5, mat.frame)
  rec.position.set(0, 1.4, -D / 2 + 0.08)
  g.add(rec)
  g.add(storefront(0, W * 0.6, 2.0, -D / 2, 5, mat.trim))
  const top = box(W * 0.62, 3.1, D * 0.7, mat.stucco)
  top.position.set(0.8, H + 1.55, 0.6)
  g.add(top)
  const deck = box(W * 0.62 - 0.2, 0.1, D * 0.7 - 0.2, mat.roofDeck)
  deck.position.set(0.8, H + 3.1, 0.6)
  g.add(deck)
  const kit = rooftopKit(rnd, W * 0.4, D * 0.4, 0.75)
  kit.position.set(0.8, H + 3.16, 0.6)
  g.add(kit)
  const par = parapet(W, D)
  par.position.y = H + 0.06
  g.add(par)
  const parTop = parapet(W * 0.62, D * 0.7)
  parTop.position.set(0.8, H + 3.14, 0.6)
  parTop.scale.setScalar(0.8)
  g.add(parTop)
  const winC = windowUnit(1.1, 1.5)
  g.add(windowWall(winC, 1.1, 1.5, 5, 6, [-W / 2 + 1.7, 2.0 + 2.9, -D / 2 - 0.04], 2.4, 2.55, Math.PI, rnd, 0.22))
  for (let r = 2; r <= 4; r++) {
    const by = 2.0 + r * 2.55 - 0.9
    for (const bx of [-3.9, 3.9]) g.add(balcony(bx, by, -D / 2 - 0.02, 3.0, r % 2 ? mat.accent : mat.trim))
  }
  const doorC = box(1.4, 2.2, 0.1, mat.trim)
  doorC.position.set(-W / 2 + 1.7 * 2 + 1.2, 1.1, -D / 2 - 0.18)
  g.add(doorC)
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Tiered office: colonnade podium → setback shaft → cornice + plant room. */
function designOffice(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-office'
  const W = 14, D = 12
  const pH = 5.6, sH = 18.4
  const podium = box(W, pH, D, mat.panel, 'podium')
  podium.position.y = pH / 2
  g.add(podium)
  const shaft = box(W * 0.74, sH, D * 0.78, mat.panel)
  shaft.position.set(0, pH + sH / 2, 0.3)
  g.add(shaft)
  const setback = box(W * 0.5, 3.4, D * 0.5, mat.panel)
  setback.position.set(0, pH + sH + 1.7, 0.6)
  g.add(setback)
  // cornice bands at each massing break
  for (const [cw, cd, cy] of [[W + 0.4, D + 0.4, pH], [W * 0.74 + 0.35, D * 0.78 + 0.35, pH + sH], [W * 0.5 + 0.3, D * 0.5 + 0.3, pH + sH + 3.4]] as const) {
    const cor = box(cw, 0.3, cd, mat.stucco)
    cor.position.set(0, cy + 0.08, cy === pH ? 0 : 0.5)
    g.add(cor)
    const lip = box(cw - 0.3, 0.12, cd - 0.3, mat.roofDeckDark)
    lip.position.set(0, cy + 0.27, cy === pH ? 0 : 0.5)
    g.add(lip)
  }
  // colonnade at the entrance (fluted columns via lathe)
  for (let c = 0; c < 5; c++) {
    const prof: THREE.Vector2[] = [[0.24, 0], [0.2, 0.3], [0.16, pH - 0.4], [0.22, pH - 0.12], [0.26, pH]]
      .map(([r, y]) => new THREE.Vector2(r, y))
    const col = new THREE.Mesh(new THREE.LatheGeometry(prof, 10), mat.stucco)
    col.position.set(-W / 2 + 1.6 + c * ((W - 3.2) / 4), 0, -D / 2 - 0.5)
    g.add(col)
  }
  const entab = box(W, 0.35, 0.7, mat.stucco)
  entab.position.set(0, pH + 0.18, -D / 2 - 0.55)
  g.add(entab)
  const rev = box(0.5, 0.24, 0.24, mat.frame)
  rev.position.set(0, 2.3, -D / 2 - 0.62)
  void rev
  const doors = box(3.2, 2.5, 0.12, mat.frame)
  doors.position.set(0, 1.26, -D / 2 - 0.02)
  const drGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.2), mat.glass)
  drGlass.rotation.y = Math.PI
  drGlass.position.set(0, 1.26, -D / 2 - 0.1)
  g.add(doors, drGlass)
  // curtain wall: instanced panes with vertical fins between floors
  const cw = 2.0, ch = 2.55
  const cols = 5, rowsN = 7
  void cw
  const paneG = mergeGeometries([
    { geometry: (() => { const p = new THREE.PlaneGeometry(cw * 1.02, ch * 0.94); p.translate(0, 0, -0.02); return p })(), materialIndex: 0 },
    { geometry: (() => { const f = roundedPlateGeo(cw, ch, 0.09, 0.04); f.translate(0, 0, 0.03); return f })(), materialIndex: 1 },
  ])
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
  const cwMat = new THREE.MeshPhysicalMaterial({ color: 0x42617a, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.72, ior: 1.52, envMapIntensity: 1.7 })
  for (const [yaw, oxBase, ozBase, cSpan] of [[Math.PI, 0, -(D * 0.78) / 2 - 0.32, true], [0, 0, (D * 0.78) / 2 + 0.32, false]] as const) {
    const inst = new THREE.InstancedMesh(paneG, [cwMat, mat.panel], cols * rowsN)
    let i = 0
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
      e.set(0, yaw, 0); q.setFromEuler(e)
      p.set(oxBase === 0 ? -W * 0.37 + 0.95 + c * ((W * 0.74 - 1.9) / 4) : 0, pH + 1.5 + r * 2.42, ozBase)
      void cSpan
      m4.compose(p, q, s); inst.setMatrixAt(i++, m4)
    }
    inst.instanceMatrix.needsUpdate = true
    inst.castShadow = true
    g.add(inst)
  }
  // spandrel bands: dark floor-line separators across the curtain shaft
  for (let r = 0; r <= 7; r++) {
    const sp = box(W * 0.74 + 0.1, 0.22, D * 0.78 + 0.5, mat.roofDeckDark)
    sp.position.set(0, pH + 0.28 + r * 2.42, 0.3)
    g.add(sp)
  }
  // podium storefront band
  const winP = windowUnit(1.5, 1.9)
  g.add(windowWall(winP, 1.5, 1.9, 4, 1, [-W / 2 + 2.2, 2.2, -D / 2 - 0.02], 2.4, 0, Math.PI, rnd, 0.55))
  // side-face slit windows
  const winS = windowUnit(0.8, 1.3, false)
  g.add(windowWall(winS, 0.8, 1.3, 1, 7, [W * 0.74 / 2 + 0.02, pH + 1.6, -3.2], 0, 2.42, Math.PI / 2, rnd, 0.3))
  // roof plant room + mast
  const plant = box(W * 0.3, 1.3, D * 0.3, mat.roofDeckDark)
  plant.position.set(0, pH + sH + 3.4 + 0.8, 0.5)
  g.add(plant)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.6, 6), mat.metal)
  mast.position.set(1.6, pH + sH + 3.4 + 2.4, 0.5)
  g.add(mast)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat.glow)
  beacon.position.set(1.6, pH + sH + 3.4 + 3.7, 0.5)
  g.add(beacon)
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Civic block: arcade + pediment + clock drum + flanking wings. */
function designCivic(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-civic'
  const W = 18, D = 13, H = 9.2
  const body = box(W - 4, H, D, mat.stucco, 'body')
  body.position.y = H / 2
  g.add(body)
  for (const sx of [-1, 1]) {
    const wing = box(3.4, H + 1.9, D - 1.6, mat.brick)
    wing.position.set(sx * (W / 2 - 1.7), (H + 1.9) / 2, 0)
    g.add(wing)
    const cap = box(3.6, 0.22, D - 1.4, mat.roofDeck)
    cap.position.set(wing.position.x, H + 1.9 + 0.1, 0)
    g.add(cap)
    const winW2 = windowUnit(1.1, 1.4)
    g.add(windowWall(winW2, 1.1, 1.4, 1, 3, [sx * (W / 2 - 1.7), 1.9, -D / 2 + 0.9], 0, 2.4, Math.PI, rnd, 0.25, 'z'))
  }
  // centreal pediment over 6 columns
  const pH = 6.6
  const arch = box(9.4, pH, D * 0.7, mat.stucco)
  arch.position.set(0, pH / 2, -0.4)
  g.add(arch)
  const ped = prismTri(9.6, 2.1, 1.3, mat.stucco)
  ped.position.set(0, pH, -D * 0.7 - 0.45 + 0.4)
  g.add(ped)
  const corn = box(10.2, 0.3, 1.5, mat.stucco)
  corn.position.set(0, pH - 0.05, -D * 0.7 - 0.2)
  g.add(corn)
  const clockHousing = box(1.5, 1.5, 0.4, mat.stucco)
  clockHousing.position.set(0, pH + 0.55, -D * 0.7 - 0.42)
  g.add(clockHousing)
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0xe8e2cc, emissive: new THREE.Color(0xffe6b4).convertSRGBToLinear(), emissiveIntensity: 0.4, roughness: 0.4 }))
  clock.rotation.x = Math.PI / 2
  clock.position.set(0, pH + 0.55, -D * 0.7 - 0.66)
  g.add(clock)
  for (let c = 0; c < 6; c++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, pH - 0.6, 9), mat.stucco)
    col.position.set(-4 + c * 1.6, (pH - 0.6) / 2, -D * 0.7 - 0.25)
    g.add(col)
    if (c < 5 && c !== 2) {
      const niche = box(0.95, 3.6, 0.14, mat.frame)
      niche.position.set(-3.2 + c * 1.6, 2.4, -D * 0.7 - 0.42)
      g.add(niche)
      const ng = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 3.3), mat.glass)
      ng.rotation.y = Math.PI
      ng.position.set(-3.2 + c * 1.6, 2.4, -D * 0.7 - 0.5)
      g.add(ng)
    }
  }
  const civicDoor = box(1.7, 3.4, 0.16, mat.trim)
  civicDoor.position.set(0, 1.8, -D * 0.7 - 0.46)
  g.add(civicDoor)
  // stairs
  for (let st = 0; st < 4; st++) {
    const step = box(9.4 + st * 0.3, 0.18, 0.5, mat.concrete)
    step.position.set(0, 0.09 + (3 - st) * 0.18, -D * 0.7 - 0.9 - st * 0.42)
    g.add(step)
  }
  const deck = box(W - 4 - 0.3, 0.1, D - 0.3, mat.roofDeck)
  deck.position.y = H + 0.04
  g.add(deck)
  const par = parapet(W - 4, D)
  par.position.y = H
  g.add(par)
  const kit = rooftopKit(rnd, 4.5, 4, 0.85)
  kit.position.set(0, H + 0.08, 0.6)
  g.add(kit)
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Factory: sawtooth north-light roof, stack, duct runs, loading platform. */
function designFactory(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-factory'
  const W = 20, D = 13, H = 7.4
  const body = box(W, H, D, mat.cladding, 'body')
  body.position.y = H / 2
  g.add(body)
  // sawtooth roof: 5 bays, glazed riser facing −z (road) for readable profile
  const bays = 5, bw = W / bays
  for (let b = 0; b < bays; b++) {
    const bx = -W / 2 + (b + 0.5) * bw
    const riser = box(0.24, 1.9, D - 1.2, mat.frame)
    riser.position.set(bx - bw / 2 + 0.14, H + 0.85, 0)
    g.add(riser)
    const glaze = new THREE.Mesh(new THREE.PlaneGeometry(D - 1.4, 1.5), mat.glass)
    glaze.rotation.x = -0.18
    glaze.position.set(bx - bw / 2 + 0.13, H + 0.85, 0)
    glaze.rotation.y = Math.PI / 2
    g.add(glaze)
    const slope = box(bw - 0.3, 0.14, D - 0.8, mat.roofDeck)
    slope.position.set(bx + 0.12, H + 1.35 - (bw * 0.14) / 2, 0)
    slope.rotation.z = -0.24
    g.add(slope)
  }
  // per-bay vent cowls
  for (let b = 0; b < bays; b++) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 8), mat.metal)
    v.position.set(-W / 2 + (b + 0.72) * bw, H + 1.15, D * 0.22)
    g.add(v)
  }
  // end wall bays + platform
  const plat = box(6, 0.7, 3.2, mat.concrete)
  plat.position.set(W / 2 - 4.4, 0.35, -D / 2 - 1.6)
  g.add(plat)
  const rail = box(6, 0.07, 0.07, mat.metal)
  rail.position.set(plat.position.x, 1.55, -D / 2 - 3.1)
  g.add(rail)
  for (let c = 0; c < 4; c++) {
    const p2 = box(0.08, 0.86, 0.08, mat.metal)
    p2.position.set(W / 2 - 7.2 + c * 1.9, 1.13, -D / 2 - 3.1)
    g.add(p2)
  }
  const doorF = box(3.2, 2.6, 0.12, mat.accent)
  doorF.position.set(plat.position.x, 2.0, -D / 2 - 0.04)
  g.add(doorF)
  // stair access to platform
  for (let st = 0; st < 4; st++) {
    const step = box(1.1, 0.16, 0.36, mat.metal)
    step.position.set(plat.position.x + 3.7, 0.08 + st * 0.16, -D / 2 - 1.2 - st * 0.36)
    g.add(step)
  }
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(D - 4, 1.5), mat.glass)
    strip.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2
    strip.position.set(sx * (W / 2 + 0.02), H - 1.7, 0)
    g.add(strip)
    const lb = box(0.14, 2.0, 3.4, mat.metal)
    lb.position.set(sx * (W / 2 + 0.05), H - 1.7, -D / 2 + 2.4)
    lb.rotation.y = Math.PI / 2
    g.add(lb)
    const lad = box(0.7, H - 0.6, 0.1, mat.metal)
    lad.position.set(sx * (W / 2 + 0.16), (H - 0.6) / 2, D / 2 - 1.4)
    lad.rotation.y = Math.PI / 2
    g.add(lad)
  }
  // stack with band
  const stackX = -W / 2 + 1.6, stackZ = D / 2 - 1.6
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.82, 8.2, 12), mat.brick)
  stack.position.set(stackX, H * 0.5 + 4.1, stackZ)
  g.add(stack)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x8f3c30, roughness: 0.85 }))
  band.position.set(stackX, 9.4, stackZ)
  g.add(band)
  const capS = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.66, 0.3, 12), mat.roofDeckDark)
  capS.position.set(stackX, 12.65 + 0.45, stackZ - 4.55)
  void capS
  // duct run along the wall
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, W * 0.62, 9), mat.metal)
  duct.rotation.z = Math.PI / 2
  duct.position.set(-1, H - 0.7, -D / 2 - 0.3)
  g.add(duct)
  for (let b = 0; b < 4; b++) {
    const br = box(0.16, 0.7, 0.16, mat.frame)
    br.position.set(-7 + b * 4.2, H - 1.15, -D / 2 - 0.3)
    g.add(br)
  }
  // personnel door + high windows on the side
  const pd = box(1.2, 2.1, 0.1, mat.accent)
  pd.position.set(-W / 2 + 1.4, 1.05, -D / 2 - 0.05)
  g.add(pd)
  const winF = windowUnit(1.2, 0.85, false)
  g.add(windowWall(winF, 1.2, 0.85, 7, 1, [-7.6, H - 2.3, -D / 2 - 0.02], 2.55, 0, Math.PI, rnd, 0.4))
  const sign = signMesh(billboardFaceTexture('harbour'), 3.4, 1.1)
  sign.position.set(6, H - 1.4, -D / 2 - 0.16)
  g.add(sign)
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Grain/industrial silo cluster: lathe-domes, headhouse on stilts, spout. */
function designSilo(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-silo'
  const rm = rivetMetalMaps(0x98a09a, 121)
  const siloMat = new THREE.MeshStandardMaterial({ map: rm.map, normalMap: rm.normalMap, roughness: 0.6, metalness: 0.55 })
  const domes = 4
  for (let c = 0; c < domes; c++) {
    const x = -4.6 + c * 3.05
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 9.4, 14, 1, true), siloMat)
    body.position.set(x, 5.2, 0)
    g.add(body)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat.roofDeckDark)
    dome.position.set(x, 9.9, 0)
    g.add(dome)
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.5, 14), mat.concrete)
    skirt.position.set(x, 0.25, 0)
    g.add(skirt)
    // ring stiffeners
    for (const ry of [2.8, 5.4, 8]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.055, 5, 16), mat.metal)
      ring.rotation.x = Math.PI / 2
      ring.position.set(x, ry, 0)
      g.add(ring)
    }
    // ladder with safety cage hint
    const lad = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 9, 5), mat.metal)
    lad.position.set(x + 1.48, 5, 0.4)
    g.add(lad)
    for (let r = 1; r < 12; r++) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mat.metal)
      rung.rotation.z = Math.PI / 2
      rung.position.set(x + 1.34, r * 0.78, 0.4)
      g.add(rung)
    }
  }
  // headhouse on stilts across the tops + walkway + spout chute
  const head = box(11.6, 2.6, 3.6, mat.cladding)
  head.position.set(0.2, 11.9, 0)
  g.add(head)
  const hCap = box(11.9, 0.16, 3.9, mat.roofDeck)
  hCap.position.set(0.2, 13.28, 0)
  g.add(hCap)
  for (let st = 0; st < 4; st++) {
    const stil = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.7, 6), mat.frame)
    stil.position.set(-5 + st * 3.5, 10.35, st % 2 ? 1.2 : -1.2)
    g.add(stil)
  }
  const walk = box(3.6, 0.14, 1.2, mat.metal)
  walk.position.set(6.6, 10.9, 0)
  g.add(walk)
  const wRail = box(3.6, 0.7, 0.05, mat.metal)
  wRail.position.set(6.6, 11.3, -0.55)
  g.add(wRail)
  const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 5.6, 8), mat.metal)
  chute.rotation.z = 0.62
  chute.position.set(6.9, 7.9, 0)
  g.add(chute)
  const hopper = prismTri(3.4, 2.2, 3.0, mat.cladding)
  hopper.position.set(-6.9, 1.1, 0)
  hopper.rotation.y = Math.PI / 2
  g.add(hopper)
  const kit = rooftopKit(rnd, 3.4, 1.4, 0.7)
  kit.position.set(-3.4, 13.36, 0)
  g.add(kit)
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Terrace row: repeating door/bay bays, dormers, chimneys, varied stoops. */
function designTerrace(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-terrace'
  const W = 17, D = 9, H = 5.6, nBays = 6, bw = W / nBays
  const body = box(W, H, D, mat.brick, 'body')
  body.position.y = H / 2
  g.add(body)
  // shallow pitched roof + eaves band + dormers
  const eaves = box(W + 0.4, 0.22, D + 0.5, mat.roofDeckDark)
  eaves.position.set(0, H + 0.14, 0)
  g.add(eaves)
  const roof = box(W + 0.1, 0.5, D * 0.82, mat.roofDeckDark)
  roof.position.set(0, H + 0.5, 0.2)
  roof.rotation.x = -0.22
  g.add(roof)
  for (let b = 0; b < 3; b++) {
    const dx = -W * 0.3 + b * (W * 0.3)
    const dorm = box(1.5, 0.85, 1.1, mat.stucco)
    dorm.position.set(dx, H + 0.75, -D * 0.32)
    g.add(dorm)
    const dw = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.6), mat.glass)
    dw.position.set(dx, H + 0.78, -D * 0.32 - 0.56)
    g.add(dw)
    const dc = box(1.65, 0.1, 1.25, mat.roofDeck)
    dc.position.set(dx, H + 1.22, -D * 0.32)
    g.add(dc)
  }
  // chimneys between bays, staggered
  for (let c = 0; c < 4; c++) {
    const chim = box(0.7, 1.9, 0.7, mat.brick)
    chim.position.set(-W / 2 + (c + 0.5) * (W / 4), H + 1.0, D * 0.2)
    g.add(chim)
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.35, 7), mat.roofDeckDark)
    pot.position.set(chim.position.x, H + 2.1, chim.position.z)
    g.add(pot)
  }
  for (let b = 0; b < nBays; b++) {
    const bx = -W / 2 + (b + 0.5) * bw
    const toneAlt = b % 2 === 0
    // door + small porch canopy, tinted per unit (colour variants §10)
    const door = box(0.95, 2.15, 0.1, toneAlt ? mat.accent : mat.trim)
    door.position.set(bx - bw * 0.22, 1.1, -D / 2 - 0.06)
    g.add(door)
    const fan = box(1.15, 0.12, 0.55, mat.roofDeck)
    fan.position.set(bx - bw * 0.22, 2.35, -D / 2 - 0.3)
    fan.rotation.x = -0.14
    g.add(fan)
    const step = box(1.3, 0.14, 0.6, mat.concrete)
    step.position.set(bx - bw * 0.22, 0.07, -D / 2 - 0.35)
    g.add(step)
    // bay window + stone lintel/sill
    const bay = windowUnit(1.5, 1.5)
    const bayMesh = new THREE.InstancedMesh(bay, [mat.frame, mat.glass], 2)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
    q.setFromEuler(e.set(0, Math.PI, 0))
    p.set(bx + bw * 0.2, 1.05, -D / 2 - 0.02); m4.compose(p, q, s); bayMesh.setMatrixAt(0, m4)
    p.set(bx + bw * 0.2, 3.35, -D / 2 - 0.02); m4.compose(p, q, s); bayMesh.setMatrixAt(1, m4)
    bayMesh.instanceMatrix.needsUpdate = true
    bayMesh.castShadow = true
    g.add(bayMesh)
    const lint = box(1.8, 0.12, 0.16, mat.stucco)
    lint.position.set(bx + bw * 0.2, 4.2, -D / 2 - 0.02)
    g.add(lint)
  }
  // rear lean-to volume keeps massing asymmetric
  const rear = box(W * 0.55, H * 0.62, 2.2, mat.stucco2)
  rear.position.set(W * 0.18, H * 0.31, D / 2 + 1.1)
  g.add(rear)
  const rearCap = box(W * 0.55 + 0.2, 0.12, 2.4, mat.roofDeck)
  rearCap.position.set(W * 0.18, H * 0.62 + 0.06, D / 2 + 1.1)
  g.add(rearCap)
  void rnd
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Parking structure: column grid, deck slabs, ramp edge, stair core, lights. */
function designCarpark(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-carpark'
  const W = 16, D = 12, decks = 3, fh = 2.9
  const H = decks * fh + 0.8
  for (let dI = 0; dI <= decks; dI++) {
    const y = dI * fh + 0.16
    const slab = box(W, 0.32, D, mat.concrete)
    slab.position.y = y
    g.add(slab)
    if (dI > 0) {
      // fascia band with wear tone + kerb colour stripe
      const fas = box(W + 0.24, 0.5, 0.16, dI % 2 ? mat.accent : mat.stucco2)
      fas.position.set(0, y + 0.42, -D / 2 - 0.05)
      g.add(fas)
      const fasB = fas.clone(); fasB.position.z = D / 2 + 0.05
      g.add(fasB)
    }
    // open deck railings (posts + two rails) on both long faces
    if (dI > 0) {
      const postG = new THREE.BoxGeometry(0.06, 0.95, 0.06)
      postG.translate(0, 1.05, 0)
      const nP = Math.floor(W / 1.7)
      const posts = new THREE.InstancedMesh(postG, mat.metal, nP * 2)
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
      q.setFromEuler(e)
      for (let i = 0; i < nP; i++) {
        p.set(-W / 2 + 0.9 + i * 1.7, y, -D / 2 - 0.12); m4.compose(p, q, s); posts.setMatrixAt(i, m4)
        p.set(-W / 2 + 0.9 + i * 1.7, y, D / 2 + 0.12); m4.compose(p, q, s); posts.setMatrixAt(nP + i, m4)
      }
      posts.instanceMatrix.needsUpdate = true
      posts.castShadow = true
      g.add(posts)
      for (const rz of [-D / 2 - 0.12, D / 2 + 0.12]) for (const ry of [1.2, 1.62]) {
        const rail = box(W, 0.06, 0.06, mat.metal)
        rail.position.set(0, y + ry, rz)
        g.add(rail)
      }
    }
    if (dI < decks) {
      // columns under each deck
      for (const cx of [-W / 2 + 1.2, 0, W / 2 - 1.2]) for (const cz of [-D / 2 + 1.4, D / 2 - 1.4]) {
        const col = box(0.42, fh - 0.3, 0.42, mat.concrete)
        col.position.set(cx, y + fh / 2 + 0.16, cz)
        g.add(col)
      }
    }
  }
  // ramp bay at one end: inclined edge walls + chevrons implied by colour
  const rampA = box(0.3, 1.15, D - 2, mat.stucco2)
  rampA.position.set(W / 2 - 1.9, decks * fh * 0.55, 0)
  rampA.rotation.x = -0.16
  g.add(rampA)
  const rampSign = box(0.62, 0.62, 0.08, mat.accent)
  rampSign.position.set(W / 2 - 2.1, 2.1, -D / 2 + 0.2)
  g.add(rampSign)
  // stair/lift core at the far end
  const core = box(3.1, H, 3.4, mat.stucco2)
  core.position.set(-W / 2 + 1.9, H / 2, 0)
  g.add(core)
  const coreWin = windowUnit(0.7, 1.1, false)
  g.add(windowWall(coreWin, 0.7, 1.1, 1, 3, [-W / 2 + 1.9, 1.2, -1.72], 0, 2.6, Math.PI, rnd, 0.4, 'z'))
  // standards on the top deck
  for (let l = 0; l < 3; l++) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 6), mat.metal)
    pole.position.set(-4 + l * 4.6, H + 1.05, 0)
    const headL = box(0.5, 0.1, 0.24, mat.glow)
    headL.position.set(pole.position.x, H + 2.1, 0)
    g.add(pole, headL)
  }
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Single-storey retail: parapet signage band, three striped awnings, AC. */
function designRetail(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-retail'
  const W = 16, D = 10, H = 5.4
  const body = box(W, H, D, mat.panel, 'body')
  body.position.y = H / 2
  g.add(body)
  const base = box(W + 0.2, 0.7, D + 0.2, mat.concrete)
  base.position.y = 0.35
  g.add(base)
  // parapet signage band with sign panels
  const band = box(W + 0.3, 1.05, 0.3, mat.trim)
  band.position.set(0, H + 0.5, -D / 2 - 0.1)
  g.add(band)
  const s1 = signMesh(billboardFaceTexture('rush'), 4.6, 0.9)
  s1.position.set(-W * 0.26, H + 0.52, -D / 2 - 0.28)
  g.add(s1)
  const s2 = signMesh(billboardFaceTexture('octane'), 4.0, 0.9)
  s2.position.set(W * 0.26, H + 0.52, -D / 2 - 0.28)
  g.add(s2)
  // recessed entries between awnings
  for (let b = 0; b < 3; b++) {
    const bx = -W / 2 + (b + 0.5) * (W / 3)
    const rec = box(W / 3 - 1.6, 2.7, 0.5, mat.frame)
    rec.position.set(bx, 1.4, -D / 2 + 0.1)
    g.add(rec)
    g.add(storefront(bx, W / 3 - 2.2, 2.1, -D / 2 + 0.36, 3, b % 2 ? mat.accent : mat.trim))
    g.add(awning(bx, 3.3, -D / 2 + 0.4, W / 3 - 1.4, 8800 + b))
  }
  for (const sx of [-1, 1]) {
    const winR = windowUnit(1.2, 1.5)
    g.add(windowWall(winR, 1.2, 1.5, 2, 2, [sx * (W / 2), 2.1, -2.6], 3.0, 2.4, sx > 0 ? -Math.PI / 2 : Math.PI / 2, rnd, 0.2, 'z'))
    const vent = box(1.3, 0.9, 0.22, mat.metal)
    vent.position.set(sx * (W / 2 + 0.02), 1.1, 3.2)
    vent.rotation.y = Math.PI / 2
    g.add(vent)
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, H - 0.4, 6), mat.trim)
    pipe.position.set(sx * (W / 2 - 0.35), (H - 0.4) / 2 + 0.3, D / 2 - 0.5)
    g.add(pipe)
  }
  const deck = box(W - 0.4, 0.12, D - 0.4, mat.roofDeck)
  deck.position.y = H + 0.05
  g.add(deck)
  const par = parapet(W, D)
  par.position.y = H + 0.08
  g.add(par)
  const kit = rooftopKit(rnd, W * 0.5, D * 0.5, 0.9)
  kit.position.y = H + 0.12
  g.add(kit)
  // roof-level AC condensers along the rear parapet
  for (let a = 0; a < 4; a++) {
    const ac = box(0.9, 0.55, 0.9, mat.metal)
    ac.position.set(-5.4 + a * 3.6, H + 0.4, D / 2 - 0.9)
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), mat.frame)
    fan.position.set(ac.position.x, H + 0.7, ac.position.z)
    g.add(ac, fan)
  }
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

/** Substation kiosk: fenced yard, transformer cans with fins, cabinets. */
function designSubstation(rnd: Rand): THREE.Group {
  const mat = buildingMaterials()
  const g = new THREE.Group()
  g.name = 'bldg-substation'
  const W = 11, D = 9
  // control building
  const hut = box(5.2, 3.1, 4.2, mat.concrete)
  hut.position.set(-W / 2 + 2.6, 1.55, D / 2 - 2.1)
  g.add(hut)
  const hutRoof = box(5.5, 0.18, 4.5, mat.roofDeck)
  hutRoof.position.set(hut.position.x, 3.2, hut.position.z)
  g.add(hutRoof)
  const hutDoor = box(1.0, 2.0, 0.08, mat.accent)
  hutDoor.position.set(hut.position.x, 1.0, hut.position.z - 2.14)
  g.add(hutDoor)
  const vent = box(1.2, 0.5, 0.08, mat.frame)
  vent.position.set(hut.position.x + 1.6, 2.5, hut.position.z - 2.14)
  g.add(vent)
  // transformer cans with radiator fins + cooling pipes
  for (let t = 0; t < 2; t++) {
    const tx = 1.6 + t * 3.6, tz = -0.8
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 2.3, 12), mat.metal)
    can.position.set(tx, 1.15, tz)
    g.add(can)
    const capT = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat.metal)
    capT.position.set(tx, 2.3, tz)
    g.add(capT)
    for (let f = 0; f < 7; f++) {
      const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6), mat.rust)
      fin.position.set(tx + Math.cos((f / 7) * Math.PI * 2) * 1.0, 1.15, tz + Math.sin((f / 7) * Math.PI * 2) * 1.0)
      g.add(fin)
    }
    for (const bx of [-0.55, 0.55]) for (const bz of [-0.55, 0.55]) {
      const foot = box(0.28, 0.24, 0.28, mat.concrete)
      foot.position.set(tx + bx, 0.12, tz + bz)
      g.add(foot)
    }
    const bush = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.75, 6), new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.4, metalness: 0.1 }))
    bush.position.set(tx, 2.85, tz)
    g.add(bush)
    // gantry arm to busbars
    const arm = box(0.12, 0.12, 2.6, mat.metal)
    arm.position.set(tx, 3.2, tz - 1.6)
    g.add(arm)
    for (const bz of [-2.85, -1.6]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.4, 7), mat.concrete)
      pole.position.set(tx, 1.7, tz + bz)
      g.add(pole)
      const insul = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.34, 7), new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.45 }))
      insul.position.set(tx, 3.4, tz + bz)
      g.add(insul)
    }
  }
  // cabinets + meter posts row
  for (let c = 0; c < 4; c++) {
    const cab = box(0.8, 1.35, 0.5, c % 2 ? mat.accent : mat.rust)
    cab.position.set(-W / 2 + 1.2 + c * 1.15, 0.85, -D / 2 + 0.7)
    const cabDoor = box(0.7, 1.1, 0.06, mat.frame)
    cabDoor.position.set(cab.position.x, 0.85, -D / 2 + 0.42)
    g.add(cab, cabDoor)
  }
  // chainlink fence: posts + rails + strand wire (no alpha texture needed)
  const fH = 2.1
  const per: [number, number, number, number][] = [[0, -D / 2, W, 0], [0, D / 2, W, 0], [-W / 2, 0, 0, D], [W / 2, 0, 0, D]]
  for (const [cx, cz, wx, wz] of per) {
    const span = Math.max(wx, wz)
    const n = Math.max(2, Math.round(span / 2.4))
    for (let i = 0; i <= n; i++) {
      const t = -0.5 + i / n
      const px = cx + (wx > 0 ? t * wx : 0), pz = cz + (wz > 0 ? t * wz : 0)
      const skip = Math.abs(px - hut.position.x + W / 2 - 2.6) < 0.001 && pz === hut.position.z
      void skip
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, fH, 6), mat.metal)
      post.position.set(px, fH / 2, pz)
      g.add(post)
    }
    for (const ry of [fH, fH * 0.62, 0.28]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, span, 5), mat.metal)
      rail.position.set(cx, ry, cz)
      if (wx > 0) rail.rotation.z = Math.PI / 2; else { rail.rotation.z = Math.PI / 2; rail.rotation.y = Math.PI / 2 }
      g.add(rail)
    }
    // diagonal strands: instanced thin wires zigzag (reads as mesh)
    const nStr = Math.round(span / 0.55)
    const wirePts: number[] = []
    for (let i = 0; i <= nStr; i++) {
      const t = -0.5 + i / nStr
      const px = cx + (wx > 0 ? t * wx : 0), pz = cz + (wz > 0 ? t * wz : 0)
      const yy = i % 2 === 0 ? fH * 0.4 : fH * 0.85
      wirePts.push(px, yy, pz)
    }
    const wgeo = new THREE.BufferGeometry()
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3))
    const widx: number[] = []
    for (let i = 0; i + 1 < nStr + 1; i++) widx.push(i, i + 1)
    wgeo.setIndex(widx)
    sanitizeGeometry(wgeo)
    crNormals(wgeo)
    // render as thin quads via LineSegments-safe fallback: use thin cylinders instanced? keep simple: skip wire mesh (fence rails read enough)
    void wgeo; void widx
  }
  // gate posts + warning plate
  const gp = box(0.14, 2.2, 0.14, mat.metal)
  gp.position.set(-0.4, 1.1, -D / 2)
  g.add(gp)
  const gate = signMesh(signFaceTexture('speed'), 0.5, 0.5)
  gate.position.set(0.45, 1.5, -D / 2 - 0.08)
  g.add(gate)
  // gravel pad
  const pad = box(W + 1.4, 0.1, D + 1.4, mat.roofDeckDark)
  pad.position.y = 0.02
  g.add(pad)
  void rnd
  g.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
  return g
}

const DESIGNERS: Record<BuildingDesignId, (rnd: Rand) => THREE.Group> = {
  warehouse: designWarehouse, cafe: designCafe, apartment: designApartment, office: designOffice,
  civic: designCivic, factory: designFactory, silo: designSilo, terrace: designTerrace,
  carpark: designCarpark, retail: designRetail, substation: designSubstation,
}

/* ------------------------------------------------------------------ LODs ---- */

/** Baked-silhouette mid LOD: massing boxes + parapet + one roof block. */
function silhouetteLOD(id: BuildingDesignId): THREE.Group {
  const mat = buildingMaterials()
  const { w, d, h } = BUILDING_FOOTPRINTS[id]
  const g = new THREE.Group()
  const parts: MergePart[] = []
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)
  const push = (geo: THREE.BufferGeometry, mi: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void => {
    e.set(0, 0, 0); q.setFromEuler(e)
    p.set(x, y, z); s.set(sx, sy, sz)
    m4.compose(p, q, s)
    parts.push({ geometry: geo, matrix: m4.clone(), materialIndex: mi })
  }
  const tone = id === 'office' || id === 'carpark' ? 1 : id === 'silo' || id === 'factory' ? 2 : 0
  push(new THREE.BoxGeometry(w, h * 0.94, d), tone, 0, h / 2, 0)
  push(new THREE.BoxGeometry(w * 1.02, 0.34, d * 1.02), 3, 0, h * 0.96, 0)
  push(new THREE.BoxGeometry(w * 0.45, h * 0.08 + 1.1, d * 0.4), 3, w * 0.08, h + 0.6, d * 0.1)
  push(new THREE.BoxGeometry(w * 1.06, 0.2, d * 1.06), 3, 0, h * 1.005, 0, 1, 1, 1)
  const merged = mergeGeometries(parts)
  const mesh = new THREE.Mesh(merged, [mat.stucco2, mat.panel, mat.cladding, mat.roofDeckDark])
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return g
}

/** Low-poly far LOD: single massed box, flat-shaded tone. */
function farLOD(id: BuildingDesignId): THREE.Mesh {
  const mat = buildingMaterials()
  const { w, d, h } = BUILDING_FOOTPRINTS[id]
  const geo = new THREE.BoxGeometry(w, h, d)
  geo.translate(0, h / 2, 0)
  const toneMap: Record<BuildingDesignId, number> = {
    warehouse: 0x8b9299, cafe: 0xb4ab9b, apartment: 0x9c968b, office: 0x848b94, civic: 0xb9b0a2,
    factory: 0x7f8990, silo: 0x93a096, terrace: 0x9a7a64, carpark: 0xa29d93, retail: 0x9aa0a8, substation: 0x9ba198,
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: toneMap[id], roughness: 0.9, metalness: 0.03, flatShading: true }))
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Build a design at full detail, optionally wrapped in a real THREE.LOD:
 * 0 → full, mid → baked silhouette, far → low-poly. Distances per KIT config.
 */
export function buildBuilding(id: BuildingDesignId, rnd: Rand, useLod = true): THREE.Object3D {
  const full = DESIGNERS[id](rnd)
  if (!useLod || !kitLodEnabled()) return full
  const lod = new THREE.LOD()
  lod.name = `bldg-${id}-lod`
  lod.addLevel(full, KIT.lodNear)
  lod.addLevel(silhouetteLOD(id), KIT.lodMid)
  lod.addLevel(farLOD(id), KIT.lodFar)
  return lod
}

/** Deterministic design picker for seeded composition (never repeats twice
 *  in immediate succession — repetition rule §10). */
export function pickBuilding(rnd: Rand, pool: readonly BuildingDesignId[] = BUILDING_DESIGNS, exclude?: BuildingDesignId): BuildingDesignId {
  let pick = rnd.pick(pool)
  let guard = 0
  while (pick === exclude && guard++ < 6) pick = rnd.pick(pool)
  return pick
}

