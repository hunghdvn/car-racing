import { assertNear, test } from '../harness'
import * as THREE from 'three'
import { VehicleVisual } from '../../src/vehicles/Vehicle'
import type { CarModel, WheelHandle } from '../../src/assets/CarModel'
import type { VehiclePhysics, DriveCommand } from '../../src/vehicles/VehiclePhysics'

/* real-car-models spec: GLB rigs carry per-corner wheel radii, so the visual
 * layer must integrate each wheel's spin against its OWN radius — one shared
 * wheels[0].radius made rear wheels of a real car visibly skate. */

function fakeCar(radii: [number, number, number, number]): { car: CarModel; wheels: WheelHandle[] } {
  const wheels: WheelHandle[] = radii.map((radius, i) => {
    const steer = new THREE.Group()
    const spin = new THREE.Group()
    steer.add(spin)
    return { steer, spin, radius, front: i < 2 }
  })
  const group = new THREE.Group()
  const car = {
    group, wheels,
    paintMats: [], headLights: [], tailLights: [], nitroTips: [],
    setHeadlights() {}, setBrake() {}, setNitro() {},
  } as unknown as CarModel
  return { car, wheels }
}

const driveCmd: DriveCommand = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }

test('vehicle visual: each wheel spins against its OWN radius', () => {
  const { car } = fakeCar([0.3, 0.3, 0.35, 0.35])
  const vv = new VehicleVisual(car)
  const v = {
    forwardSpeed: 1, steerVis: 0, susp: [0, 0, 0, 0],
    x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0,
  } as unknown as VehiclePhysics
  vv.bind(1, v, driveCmd, 0) // one second at 1 m/s → travelled distance 1 m
  assertNear(car.wheels[0].spin.rotation.x, -(1 / 0.3), 1e-9, 'front left spins dist/0.3')
  assertNear(car.wheels[2].spin.rotation.x, -(1 / 0.35), 1e-9, 'rear left spins dist/0.35, not dist/0.3')
})

test('vehicle visual: uniform radii keep the shipped single-radius accumulation', () => {
  const { car } = fakeCar([0.33, 0.33, 0.33, 0.33])
  const vv = new VehicleVisual(car)
  const v = {
    forwardSpeed: 12.5, steerVis: 0, susp: [0, 0, 0, 0],
    x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0,
  } as unknown as VehiclePhysics
  let ref = 0 // the shipped formula, replicated: spin += (speed / R) * dt
  for (let i = 0; i < 120; i++) { ref += (12.5 / 0.33) * (1 / 120); vv.bind(1 / 120, v, driveCmd, 0) }
  assertNear(car.wheels[0].spin.rotation.x, -ref, 1e-12, 'procedural cars stay bit-identical')
})
