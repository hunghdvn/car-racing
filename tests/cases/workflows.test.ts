import { readFileSync } from 'node:fs'
import { assert, test } from '../harness'

const read = (path) => readFileSync(path, 'utf8')
const ci = read('.github/workflows/ci.yml')
const policy = read('.github/workflows/qwen-policy.yml')

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
})

test('provenance check uses the trusted base workflow and default token', () => {
  assert(policy.includes('pull_request_target:'), 'pull_request_target trigger')
  assert(policy.includes('actions/checkout@v7'), 'trusted checkout v7')
  assert(policy.includes('node scripts/check-pr-policy.mjs'), 'policy entry point')
  assert(policy.includes('pull-requests: write'), 'PR file read permission')
  assert(policy.includes('statuses: write'), 'commit status permission')
  assert(policy.includes('GITHUB_TOKEN: ${{ github.token }}'), 'default GitHub token')
  assert(policy.includes('PR_BODY: ${{ github.event.pull_request.body }}'), 'PR body input')
  assert(policy.includes('PR_SHA: ${{ github.event.pull_request.head.sha }}'), 'PR SHA input')
  assert(policy.includes('GITHUB_API_URL: ${{ github.api_url }}'), 'API URL input')
  assert(policy.includes('GITHUB_SERVER_URL: ${{ github.server_url }}'), 'server URL input')
})
