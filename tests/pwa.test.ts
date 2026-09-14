import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

it('declares standalone PWA display and installable icons', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  expect(manifest.display).toBe('standalone');
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(sizes).toContain('512x512 maskable');
});
