import * as THREE from 'three'
import { TRACK, SEED } from '../config'
import { Rand } from '../util'
import { TrackSpline } from './TrackSpline'
import { CoastField } from './Terrain'
import { RoadBuilder, rampLiftAt, rampSlopeAt } from './RoadBuilder'
import { buildWater, animateWater, type ShoreMap } from './Water'
import { dressSlice, composePrefab, type PrefabId } from './ComposeKit'
import { dressCircuit } from './CircuitDressing'
import { placeVegetation } from './VegetationKit'
import { placeProps } from './PropKit'
import { mergeStaticGroup } from './StaticMerge'
import { grassTuftTexture } from '../assets/Textures'

/* ------------------------------------------------------------------------- *
 * The Phase-3 representative slice (~330 m coastal, spec §5/§9/§10): one
 * camera-composed vertical slice carrying all three depth layers —
 * foreground road detail, mid-ground cluster/props, background sea/hills/
 * skyline — plus the big-jump kicker. Everything downstream expands from
 * this visual language.
 * ------------------------------------------------------------------------- */

export interface Slice {
  group: THREE.Group
  spline: TrackSpline
  field: CoastField
  water: THREE.Mesh
  /** drive-side animation tick (water swell etc.) */
  update(t: number, camPos: THREE.Vector3): void
}

export function buildTrackSlice(): Slice {
  const group = new THREE.Group()
  group.name = 'track-slice'
  const spline = new TrackSpline()
  const field = new CoastField(spline)

  const terrain = field.mesh()
  group.add(terrain)

  const shore: ShoreMap = field.shoreTexture()
  const water = buildWater(shore)
  group.add(water)

  const road = new RoadBuilder(spline, field)
  const roadGroup = road.build(2, spline.length - 2)
  group.add(roadGroup)

  placeVegetation(group, spline, field, grassTuftTexture())
  placeProps(group, spline, field)
  const sliceComp = dressSlice({ spline, field })
  group.add(sliceComp)
  const northCity = buildNorthCity(spline, field)
  const dressing = dressCircuit(spline, field)
  group.add(northCity)
  group.add(dressing)
  /* Draw-call batching (Phase 9): fold the three profile-indicted density
     groups into per-cell, per-material meshes. The road deck is NOT folded:
     its cell bounds coarsen culling (+92k tris/frame in camera at the
     tunnel_contrast pose) and shift coplanar deck draws — evidence in
     phase-9-report §lever-1. Landmark names the structural probe keys on
     fold into themselves so the probe contract stays intact. */
  const keep = ['tunnel-portal', 'tunnel-shell', 'deck-pylons', 'deck-abutment', 'deck-soffit', 'finish', 'shortcut', 'terrain-tile', 'water']
  mergeStaticGroup(sliceComp, { keepNames: keep })
  mergeStaticGroup(northCity, { keepNames: keep })
  mergeStaticGroup(dressing, { keepNames: keep })

  return {
    group, spline, field, water,
    update(t: number, camPos: THREE.Vector3): void {
      animateWater(water, t, camPos)
    },
  }
}

/* --------------------------------------------------- north-city underpass -- */

/** The city the viaduct flies over (spec §7/§8): low retail runs at the deck
 *  base under the span, scaled street blocks with their office focals in the
 *  flanks outside the deck so no tower touches the soffit. */
function buildNorthCity(spline: TrackSpline, field: CoastField): THREE.Group {
  const g = new THREE.Group()
  g.name = 'north-city'
  const rng = spline.zoneRange('elevated')
  const rnd = new Rand(SEED ^ 0x51de71)
  let i = 0
  for (let s = rng.s0 + 112; s < rng.s1 - 100; s += 50, i++) {
    const f = spline.frame(s)
    const drop = (id: PrefabId, lat: number, sc: number, salt: number): void => {
      const pre = composePrefab(id, { seed: (SEED ^ ((salt * 0x9e37) >>> 0)) >>> 0, field: (x: number, z: number) => field.height(x, z) })
      const x = f.pos.x + f.side.x * lat, z = f.pos.z + f.side.z * lat
      pre.position.set(x, field.height(x, z) - 0.1, z)
      pre.scale.setScalar(sc)
      pre.rotation.y = f.yaw + (lat > 0 ? Math.PI / 2 : -Math.PI / 2)
      g.add(pre)
    }
    const flip = i % 2 ? 1 : -1
    // low street under the deck base (retail/cafe clear the soffit with margin)
    drop('CityBlock_Corner', flip * rnd.range(11, 16), 1, i * 3 + 1)
    // scaled street block in the flank, its office focal standing clear of the span
    drop('CityBlock_Street', -flip * rnd.range(27, 39), 0.6, i * 5 + 2)
    // a second run tight to the deck so the driver sees the city THROUGH the
    // railing, running under the deck line — that is what sells the flight
    drop(i % 2 ? 'CityBlock_Corner' : 'CityBlock_Street', -flip * rnd.range(13, 17), i % 2 ? 0.85 : 0.55, i * 11 + 5)
  }
  return g
}

/* ------------------------------------------------------ pose helpers ------ */

export interface RoadPose {
  pos: [number, number, number]
  yaw: number
  pitch: number
  bank: number
}

/** Car pose sitting on the asphalt at (s, lat), incl. kicker lift/pitch. */
export function roadPose(spline: TrackSpline, s: number, lat = 0): RoadPose {
  const f = spline.frame(s)
  const lift = rampLiftAt(s)
  const slope = rampSlopeAt(s)
  const p = spline.surfacePoint(s, lat, lift, new THREE.Vector3())
  const hLen = Math.hypot(f.tangent.x, f.tangent.z) || 1e-4
  const pitch = Math.atan2(f.tangent.y, hLen) + Math.atan(slope)
  return { pos: [p.x, p.y - 0.005, p.z], yaw: f.yaw, pitch, bank: f.bank }
}

/** Hero composition for the 5-Second Test: chase camera behind the car at
 *  the kicker, sea + sun ahead-left, cluster mid-right, hills behind. */
export interface HeroShot {
  camera: [number, number, number]
  look: [number, number, number]
  fov: number
  car: RoadPose
}

export function heroShot(spline: TrackSpline): HeroShot {
  const carS = TRACK.ramp.sLip - 1.1
  const car = roadPose(spline, carS, 0.35)
  const f = spline.frame(carS)
  const fwd = new THREE.Vector3(-Math.sin(f.yaw), 0, -Math.cos(f.yaw))
  const back = fwd.clone().multiplyScalar(-1)
  const camPos = new THREE.Vector3(car.pos[0], car.pos[1], car.pos[2])
    .addScaledVector(back, 6.6)
    .add(new THREE.Vector3(0, 2.8, 0))
  // never sink the rig under the surface it flies over
  const underY = spline.surfacePoint(Math.max(2, carS - 6.6), 0, 0, new THREE.Vector3()).y
  camPos.y = Math.max(camPos.y, underY + 1.3)
  const look = new THREE.Vector3(car.pos[0], car.pos[1], car.pos[2])
    .addScaledVector(fwd, 9.5)
    .add(new THREE.Vector3(0, 0.62, 0))
  return {
    camera: [camPos.x, camPos.y, camPos.z],
    look: [look.x, look.y, look.z],
    fov: 63,
    car,
  }
}
