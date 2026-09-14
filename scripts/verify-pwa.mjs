import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok - ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL - ${label}`);
}

console.log('Running production build...');
try {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
} catch {
  console.error('FAIL - production build did not succeed');
  process.exit(1);
}

check('dist/index.html exists', existsSync(join(dist, 'index.html')));
const html = existsSync(join(dist, 'index.html'))
  ? readFileSync(join(dist, 'index.html'), 'utf8')
  : '';
check('index.html links the web manifest', html.includes('rel="manifest"') && html.includes('/manifest.webmanifest'));
check('index.html boots the PWA service worker', html.includes('/sw.js') || html.includes('registerSW'));

check('dist/manifest.webmanifest exists', existsSync(join(dist, 'manifest.webmanifest')));
let manifest = {};
if (existsSync(join(dist, 'manifest.webmanifest'))) {
  manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
}
check('manifest display is standalone', manifest.display === 'standalone');
const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
for (const expected of ['192x192', '512x512', '512x512 maskable']) {
  check(`manifest declares ${expected} icon`, sizes.includes(expected));
}

const swPath = join(dist, 'sw.js');
check('dist/sw.js exists', existsSync(swPath));
const sw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';
check('service worker registers a precache', sw.includes('precache'));
check('service worker precaches index.html', /url:"index\.html"/.test(sw));
check('service worker precaches the manifest', /url:"manifest\.webmanifest"/.test(sw));
check('service worker precaches JS/CSS bundles', sw.includes('assets/') && /\.js/.test(sw) && /\.css/.test(sw));
check('service worker precaches icons', /url:"icons\/icon-512\.png"/.test(sw) && /url:"icons\/maskable-512\.png"/.test(sw));
check('service worker provides navigation fallback to index.html', sw.includes('NavigationRoute') && sw.includes('/index.html'));

for (const file of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png']) {
  const path = join(dist, file);
  check(`dist/${file} exists`, existsSync(path));
  if (existsSync(path)) {
    const png = readFileSync(path);
    check(`dist/${file} is a valid PNG`, png.slice(0, 8).toString('hex') === '89504e470d0a1a0a');
  }
}

if (failures > 0) {
  console.error(`PWA verification failed with ${failures} failure(s).`);
  process.exit(1);
}
console.log('PWA verification passed.');
