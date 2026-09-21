import * as THREE from 'three'
import { ChaseCamera, type CarView } from '../../src/camera/ChaseCamera'
import { assert, test } from '../harness'

const carView = (pos: THREE.Vector3, yaw: number): CarView => ({
  pos,
  yaw,
  speed: 0,
  nitro: false,
  drift: 0,
  airborne: false,
  airHeight: 0,
})

const settleChase = (chase: ChaseCamera, car: CarView): void => {
  chase.snapTo(car)
  for (let i = 0; i < 240; i++) chase.update(1 / 60, car, 16 / 9)
}

const forwardOf = (obj: THREE.Object3D): THREE.Vector3 =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion.clone()).normalize()

for (const yaw of [0, Math.PI / 2]) {
  test(`chase rig trails and faces the hero car at yaw ${yaw.toFixed(2)}`, () => {
    const car = carView(new THREE.Vector3(12, 1.5, 34), yaw)
    const chase = new ChaseCamera(16 / 9)
    const carForward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const behind = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))

    settleChase(chase, car)

    const cameraOffset = chase.camera.position.clone().sub(car.pos)
    cameraOffset.y = 0
    assert(
      cameraOffset.clone().normalize().dot(behind) > 0.95,
      `chase rig must trail the car at yaw ${yaw.toFixed(2)}`,
    )

    const camForward = forwardOf(chase.camera)
    const camForwardXZ = new THREE.Vector3(camForward.x, 0, camForward.z)
    if (camForwardXZ.lengthSq() > 1e-6) camForwardXZ.normalize()
    assert(
      camForwardXZ.dot(carForward) > 0.95,
      `chase rig must look along the car heading at yaw ${yaw.toFixed(2)}`,
    )
  })
}
