import { expect, it } from 'vitest';
import * as THREE from 'three';
import { attachShadowTarget, updateShadowTarget } from '../src/rendering/Renderer';
import { CameraRig } from '../src/rendering/CameraRig';
import { makeCarMaterial } from '../src/rendering/VehicleView';

it('creates a disposeable car material', () => {
  const material = makeCarMaterial(0x00e5ff);
  expect(material.color.getHex()).toBe(0x00e5ff);
  material.dispose();
});

it('keeps the rig camera aspect in sync with resize', () => {
  const rig = new CameraRig();
  rig.resize(1920, 1080);
  expect(rig.camera.aspect).toBeCloseTo(1920 / 1080, 6);
  rig.resize(390, 844);
  expect(rig.camera.aspect).toBeCloseTo(390 / 844, 6);
});

it('attaches the sun shadow target to the scene exactly once', () => {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const target = attachShadowTarget(scene, sun);
  expect(target).toBe(sun.target);
  expect(scene.children).toContain(target);
  attachShadowTarget(scene, sun);
  expect(scene.children.filter((child) => child === target)).toHaveLength(1);
  updateShadowTarget(sun, { x: 12, y: 0, z: -40 });
  expect(sun.target.position.x).toBe(12);
  expect(sun.target.position.y).toBe(0);
  expect(sun.target.position.z).toBe(-40);
});
