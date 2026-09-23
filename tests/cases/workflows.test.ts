import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, test } from '../harness'

const read = (path) => readFileSync(path, 'utf8')
const ci = read('.github/workflows/ci.yml')
const policy = read('.github/workflows/qwen-policy.yml')
const shotsScript = read(join(import.meta.dirname, '../../scripts/shots.mjs'))
const auditScript = read(join(import.meta.dirname, '../../scripts/audit-shots.mjs'))

test('CI runs every repository gate on Node 22', () => {
  assert(ci.includes('actions/checkout@v7'), 'checkout v7')
  assert(ci.includes('actions/setup-node@v7'), 'Node setup v7')
  assert(ci.includes("node-version: '22'"), 'Node 22')
  assert(ci.includes('npm ci'), 'reproducible install')
  assert(ci.includes('npx playwright install --with-deps chromium'), 'Chromium')
  for (const command of [
    'npm run typecheck',
    'npm run test',
    'npm run build',
    'npm run noleak',
    'npm run functional',
    'npm run shots',
    'npm run audit',
  ]) {
    assert(ci.includes(command), command)
  }
  assert(ci.includes('actions/upload-artifact@v7'), 'failure artifact')
  const committedAudit = ci.indexOf('Audit committed visual battery')
  const capture = ci.indexOf('Capture visual battery')
  const regeneratedAudit = ci.indexOf('Audit regenerated visual battery')
  assert(committedAudit >= 0 && committedAudit < capture, 'committed battery is audited before regeneration')
  assert(capture < regeneratedAudit, 'regenerated battery is audited after capture')
  assert(!ci.includes('git diff --quiet --exit-code -- shots/'), 'visual battery must not depend on byte-for-byte GPU output')
})

test('visual capture fails closed on missing or unregenerated frames', () => {
  const finallyMatch = /\}\s*finally\s*\{/u.exec(shotsScript)
  const exitMatch = /\bif\s*\(\s*captureFailures\s*>\s*0\s*\)/u.exec(shotsScript)
  assert(/\bunknown requested shot\(s\)/u.test(shotsScript), 'unknown requested shot names are detected')
  assert(/\bwanted\s*\.\s*filter\s*\([\s\S]*?!names\s*\.\s*includes\s*\(/u.test(shotsScript), 'requested names are checked against the registry')
  assert(/\bno registered shots to capture\b/u.test(shotsScript), 'an empty registry fails the run')
  assert(/\blet browser = null\b[\s]*\blet captureFailures = 0\b[\s]*\btry\s*\{/u.test(shotsScript), 'capture failure counter is declared in the outer capture scope')
  assert(/\bcaptureFailures\+\+/u.test(shotsScript), 'missing captured images are counted')
  assert(finallyMatch && exitMatch && exitMatch.index > finallyMatch.index, 'capture failures fail the run after browser cleanup')
  assert(/\bBoolean\(window\.__vr\)/u.test(auditScript), 'a missing screenshot registry fails the audit')
  assert(/\bthe screenshot registry is empty\b/u.test(auditScript), 'an empty screenshot registry fails the audit')
  assert(!/\breaddirSync\s*\(\s*SHOTS\s*\)/u.test(auditScript), 'the audit cannot fall back to stale PNG files')
  assert(/\bregistered shot is missing\b/u.test(auditScript), 'registered frames without PNG files fail the audit')
  assert(/\bif\s*\(\s*requested === 0\s*\|\|\s*audited !== requested\s*\)/u.test(auditScript), 'only a fully audited selected battery can pass')
})

test('provenance check uses the trusted base workflow and default token', () => {
  assert(policy.includes('pull_request_target:'), 'pull_request_target trigger')
  assert(policy.includes('- ready_for_review'), 'ready_for_review activity type')
  assert(policy.includes('actions/checkout@v7'), 'trusted checkout v7')
  assert(policy.includes('ref: ${{ github.base_ref }}'), 'checkout pins the trusted base ref')
  assert(policy.includes('node scripts/check-pr-policy.mjs'), 'policy entry point')
  assert(policy.includes('pull-requests: read'), 'PR read-only permission')
  assert(!policy.includes('pull-requests: write'), 'no PR write permission')
  assert(policy.includes('statuses: write'), 'commit status permission')
  assert(policy.includes('GITHUB_TOKEN: ${{ github.token }}'), 'default GitHub token')
  assert(policy.includes('PR_BODY: ${{ github.event.pull_request.body }}'), 'PR body input')
  assert(policy.includes('PR_NUMBER: ${{ github.event.pull_request.number }}'), 'PR number input')
  assert(policy.includes('PR_SHA: ${{ github.event.pull_request.head.sha }}'), 'PR SHA input')
  assert(policy.includes('GITHUB_REPOSITORY: ${{ github.repository }}'), 'repository input')
  assert(policy.includes('GITHUB_API_URL: ${{ github.api_url }}'), 'API URL input')
  assert(policy.includes('GITHUB_SERVER_URL: ${{ github.server_url }}'), 'server URL input')
})
