import { expect, it } from 'vitest';
import { makeCarMaterial } from '../src/rendering/VehicleView';

it('creates a disposeable car material', () => {
  const material = makeCarMaterial(0x00e5ff);
  expect(material.color.getHex()).toBe(0x00e5ff);
  material.dispose();
});
