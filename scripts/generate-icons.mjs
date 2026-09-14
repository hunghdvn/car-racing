import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const iconsDir = join(root, 'public', 'icons');
const svgSource = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

const defsMatch = svgSource.match(/<defs>[\s\S]*?<\/defs>/);
if (!defsMatch) {
  throw new Error('icon.svg must define a <defs> block');
}
const scene = svgSource.slice(svgSource.indexOf('</defs>') + 7, svgSource.lastIndexOf('</svg>')).trim();

const maskableSource = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
  defsMatch[0],
  '<rect width="512" height="512" fill="url(#bg)"/>',
  '<g transform="translate(51.2 51.2) scale(0.8)">',
  scene,
  '</g></svg>',
].join('');

function render(source, size, file) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(iconsDir, file), png);
  console.log(`wrote ${join('public', 'icons', file)} (${size}x${size})`);
}

render(svgSource, 192, 'icon-192.png');
render(svgSource, 512, 'icon-512.png');
render(maskableSource, 512, 'maskable-512.png');
