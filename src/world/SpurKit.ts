import { CatmullRomCurve3, Vector3 } from 'three'
import { TRACK } from '../config'

export interface SpurGroundReader {
  height(x: number, z: number): number
}

const spurControlPoints = new WeakMap<SpurGroundReader, Vector3[]>()

export function makeSpurControlPoints(field: SpurGroundReader): Vector3[] {
  const cached = spurControlPoints.get(field)
  if (cached) return cached

  const base = TRACK.shortcut.pts.map(([x, z, y]) => new Vector3(x, y, z))
  const curve = new CatmullRomCurve3(base, false, 'centripetal')
  const raw = curve.getPoints(Math.max(560, base.length * 112))
  const acc: number[] = [0]
  for (let i = 1; i < raw.length; i++) acc.push(acc[i - 1] + raw[i].distanceTo(raw[i - 1]))
  const total = acc[acc.length - 1]
  const dense: Vector3[] = []
  let nextS = 0
  for (let i = 0; i < raw.length; i++) {
    if (i === 0 || i === raw.length - 1 || acc[i] >= nextS) {
      dense.push(raw[i].clone())
      nextS = acc[i] + 0.75
    }
  }
  if (dense[dense.length - 1].distanceTo(raw[raw.length - 1]) > 0.01) dense.push(raw[raw.length - 1].clone())
  const ys = dense.map((p) => field.height(p.x, p.z))
  ys[0] = base[0].y
  ys[ys.length - 1] = base[base.length - 1].y
  const points = dense.map((p, i) => new Vector3(p.x, ys[i], p.z))
  spurControlPoints.set(field, points)
  return points
}
