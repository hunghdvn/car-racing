#!/usr/bin/env node
/* -------------------------------------------------------------------------
 * Regenerates src/assets/CarRigs.ts from rigs/reports/<id>.report.json — the
 * tail of the asset pipeline (optimize-cars measures, this emits). Exists so
 * the rig table can never drift from the committed GLBs by hand-pasting: the
 * old copy-paste workflow is how a stale caliperColor and mislabelled L/R
 * hubs survived review (PR #21). The reports are COMMITTED (build/ is
 * disposable), which is what lets tests/carassets.test.ts regenerate this
 * file in CI and fail on any diff, and re-hash public/models against each
 * report's glbSha256 — the table stops being hand-maintained trust.
 *
 *   npm run optimize-cars && npm run emit-rigs
 *
 * The interface definition lives here (it IS the pipeline's data contract);
 * TS compilation catches any consumer disagreement.
 * -------------------------------------------------------------------------- */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const REPORTS = join(ROOT, 'rigs', 'reports')
const OUT = join(ROOT, 'src/assets/CarRigs.ts')
const ORDER = ['r34', '930', 's15', 'centenario', 'terzo', 'carrera']

const num = (v) => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite ${v}`)
    return String(v)
  }
  if (Array.isArray(v)) return `[${v.map(num).join(', ')}]`
  throw new Error(`unexpected rig value ${JSON.stringify(v)}`)
}

/* The single FIELDS table is the only place a rig field is named: it drives
 * report validation, the emitted literal order AND the CarRig interface text,
 * so table / validator / type cannot drift apart again (PR #21 r3: wheelPos
 * joined the type late, caliperColor outlived its removal by two rounds).
 * kind checks are strict — lampGlow once would have silently accepted 0/1. */
const FIELDS = [
  { name: 'wheelRadius', ts: '[number, number, number, number]',
    doc: ['/** [fl, fr, rl, rr] metres — per-corner visual/spin radius (tyres may differ per corner) */'],
    check: (v) => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0.24 && n <= 0.44),
    want: '4 finite numbers in [0.24, 0.44] (staggered rears reach 0.24)' },
  { name: 'wheelPos', ts: '[[number, number, number], [number, number, number], [number, number, number], [number, number, number]]',
    doc: ['/** [fl, fr, rl, rr] hub centres in MODEL space (nose convention: −z forward,',
          ' *  world −x = the car\'s left); [x, hubY, z] — hubY is the measured hub height',
          ' *  the physics rides on, NOT radius − sink (tread-dominant corners differ 20-40 mm) */'],
    check: (v) => Array.isArray(v) && v.length === 4 && v.every((t) => Array.isArray(t) && t.length === 3 && t.every((n) => typeof n === 'number' && Number.isFinite(n))),
    want: '4 finite xyz triples' },
  { name: 'groundClearance', ts: 'number',
    doc: ['/** body min-Y when parked on the wheels (m); negative = splitter dips below road */'],
    check: (v) => typeof v === 'number' && Number.isFinite(v) && v >= -0.08 && v <= 0.24,
    want: 'a finite number in [-0.08, 0.24]' },
  { name: 'bakedPaint', ts: 'boolean',
    doc: ['/** true → no paint-* materials in the GLB, garage swatches keep author colours */'],
    check: (v) => typeof v === 'boolean', want: 'a JSON boolean (not 0/1 — runtime flag branches need true/false)' },
  { name: 'lampGlow', ts: 'boolean',
    doc: ['/** add emissive glow planes over baked lamp textures */'],
    check: (v) => typeof v === 'boolean', want: 'a JSON boolean (not 0/1 — runtime flag branches need true/false)' },
  { name: 'lampZ', ts: '[front: number, rear: number]',
    doc: ['/** world z of the head-/brake-light glow planes (percentile body face, pushed outboard) */'],
    check: (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)),
    want: '[front, rear] finite' },
  { name: 'logoAnchor', ts: '[number, number, number]',
    doc: ['/** rear badge decal position (tail side, +z; measured tail face + 20 mm, y off the shell) */'],
    check: (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)),
    want: 'a finite xyz triple' },
  { name: 'nitroAnchor', ts: '[[number, number, number], [number, number, number]]',
    doc: ['/** nitro flame origins, [left, right], measured AT the tail face (no runtime nudge) */'],
    check: (v) => Array.isArray(v) && v.length === 2 && v.every((t) => Array.isArray(t) && t.length === 3 && t.every((n) => typeof n === 'number' && Number.isFinite(n))),
    want: '2 finite xyz triples' },
]

const blocks = []
for (const id of ORDER) {
  const report = JSON.parse(readFileSync(join(REPORTS, `${id}.report.json`), 'utf8'))
  const r = report.rig
  for (const f of FIELDS)
    if (!f.check(r[f.name])) throw new Error(`${id}: rig.${f.name} ${JSON.stringify(r[f.name])} is not ${f.want} — rerun npm run optimize-cars`)
  if ('caliperColor' in r) throw new Error(`${id}: report still carries caliperColor — rerun optimize-cars`)
  // sha256 tie: the committed GLB must be byte-identical to the file measured.
  const glb = join(ROOT, 'public/models', `${id}.glb`)
  if (!existsSync(glb)) throw new Error(`${id}: public/models/${id}.glb missing — rerun npm run optimize-cars`)
  const want = report.glbSha256
  const got = createHash('sha256').update(readFileSync(glb)).digest('hex')
  if (typeof want !== 'string' || want !== got)
    throw new Error(`${id}: public/models/${id}.glb sha256 ${String(got).slice(0, 12)}… != report glbSha256 ${String(want).slice(0, 12)}… — the table is being emitted from a report that did not measure THIS GLB; rerun npm run optimize-cars`)
  blocks.push([
    `  ${JSON.stringify(id)}: {`,
    ...FIELDS.map((f) => `    ${f.name}: ${typeof r[f.name] === 'boolean' ? String(r[f.name]) : num(r[f.name])},`),
    '  },',
  ].join('\n'))
}

const body = `import type { CarId } from '../vehicles/CarSpecs'

/**
 * Per-car runtime rig table for the real-model GLBs (spec §5, Task 4 output).
 * GENERATED by scripts/emit-rigs.mjs from rigs/reports/<id>.report.json —
 * never hand-edit: rerun \`npm run optimize-cars && npm run emit-rigs\`.
 * tests/carassets.test.ts regenerates this file in CI and fails on any diff,
 * and re-hashes every public/models GLB against its report's glbSha256.
 */
export interface CarRig {
${FIELDS.map((f) => [...f.doc, `  ${f.name}: ${f.ts}`].join('\n')).join('\n')}
}

export const CAR_RIGS: Record<CarId, CarRig> = {
${blocks.join('\n')}
}
`
// atomic write through a unique temp name (two emitters must not clobber
// each other's partial file). unlink on failure: a crashed run once left
// three CarRigs.ts.<uuid>.tmp husks beside the real file.
const tmp = `${OUT}.${randomUUID()}.tmp`
try {
  writeFileSync(tmp, body)
  renameSync(tmp, OUT)
} catch (err) {
  try { unlinkSync(tmp) } catch { /* already gone */ }
  throw err
}
console.log(`[rigs] wrote ${OUT.replace(ROOT, '')} for ${ORDER.join(', ')}`)
