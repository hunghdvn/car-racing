import * as THREE from 'three'
import { TRACK } from '../config'
import { TrackSpline } from './TrackSpline'
import { CoastField } from './Terrain'
import { RoadBuilder, rampLiftAt, rampSlopeAt } from './RoadBuilder'
import { buildWater, animateWater, type ShoreMap } from './Water'
import { dressSlice } from './ComposeKit'
import { placeVegetation } from './VegetationKit'
import { placeProps } from './PropKit'
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
  group.add(road.build(2, spline.length - 2))

  placeVegetation(group, spline, field, grassTuftTexture())
  placeProps(group, spline, field)
  group.add(dressSlice({ spline, field }))

  return {
    group, spline, field, water,
    update(t: number, camPos: THREE.Vector3): void {
      animateWater(water, t, camPos)
    },
  }
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
