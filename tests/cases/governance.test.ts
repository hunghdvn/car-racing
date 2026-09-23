import { readFileSync } from 'node:fs'
import { assert, test } from '../harness'

const read = (path) => readFileSync(path, 'utf8')
const json = (path) => JSON.parse(read(path))

test('package.json is MIT and points at the public repository', () => {
  const pkg = json('package.json')
  assert(pkg.private === false, 'private must be false')
  assert(pkg.license === 'MIT', 'MIT license')
  assert(pkg.repository.type === 'git', 'repository type')
  assert(pkg.repository.url === 'https://github.com/hunghdvn/car-racing.git', 'repository URL')
  assert(pkg.homepage === 'https://github.com/hunghdvn/car-racing#readme', 'homepage')
  assert(Array.isArray(pkg.keywords), 'keywords array')
  for (const keyword of ['arcade-racing', '3d', 'webgl', 'threejs']) {
    assert(pkg.keywords.includes(keyword), `keyword ${keyword}`)
  }
})

test('MIT license names the approved copyright holder', () => {
  const license = read('LICENSE')
  assert(license.includes('MIT License'), 'MIT title')
  assert(license.includes('Copyright © 2026 hunghdvn'), 'copyright holder and year')
})

test('PR template exposes the exact provenance controls', () => {
  const template = read('.github/PULL_REQUEST_TEMPLATE.md')
  assert(template.includes('- [ ] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.'), 'unchecked code attestation')
  assert(template.includes('- Model ID: Qwen3.8-flash-next'), 'model field')
  assert(template.includes('- [ ] This pull request changes documentation/content only.'), 'unchecked docs-only declaration')
  assert(template.includes('## Authorship attestation'), 'attestation section')
})

test('issue configuration disables blank issues', () => {
  const config = read('.github/ISSUE_TEMPLATE/config.yml')
  assert(config.includes('blank_issues_enabled: false'), 'blank issues disabled')
  assert(config.includes('security/advisories/new'), 'private security report path')
})

test('bug and feature templates collect the required context', () => {
  const bug = read('.github/ISSUE_TEMPLATE/bug-report.yml')
  const feature = read('.github/ISSUE_TEMPLATE/feature-request.yml')
  for (const label of ['Expected behavior', 'Actual behavior', 'Reproducible steps', 'Browser and operating system', 'Logs or console output']) {
    assert(bug.includes(`label: ${label}`), `bug field ${label}`)
  }
  for (const label of ['Problem to solve', 'Proposed behavior', 'Explicitly out of scope', 'Qwen-only code authorship policy']) {
    assert(feature.includes(label), `feature field ${label}`)
  }
})

test('README publishes the public gates, Qwen rule, and committed screenshots', () => {
  const readme = read('README.md')
  assert(readme.includes('# Velocity Rush'), 'title')
  assert(readme.includes('shots/slice.png'), 'race screenshot')
  assert(readme.includes('shots/section_coastal.png'), 'coast screenshot')
  assert(readme.includes('shots/section_tunnel.png'), 'tunnel screenshot')
  assert(readme.includes('shots/section_city.png'), 'city screenshot')
  assert(readme.includes('shots/section_finish.png'), 'finish screenshot')
  for (const command of [
    'npm ci',
    'npm run dev',
    'npm run test',
    'npm run typecheck',
    'npm run build',
    'npm run noleak',
    'npm run functional',
    'npm run shots',
    'npm run audit',
  ]) {
    assert(readme.includes(command), command)
  }
  assert(readme.includes('Qwen3.8-flash-next'), 'Qwen policy')
  assert(readme.includes('MIT License'), 'license summary')
  assert(readme.includes('Space'), 'handbrake control')
  assert(readme.includes('Shift'), 'nitro control')
})

test('CONTRIBUTING states the Qwen-only code rule and required gates', () => {
  const guide = read('CONTRIBUTING.md')
  assert(guide.includes('all code changes in this pull request were authored by Qwen3.8-flash-next'), 'policy wording')
  assert(guide.includes('This pull request changes documentation/content only'), 'docs-only rule')
  assert(guide.includes('Existing commit history is grandfathered'), 'history rule')
  for (const command of ['npm run test', 'npm run build', 'npm run noleak', 'npm run shots', 'npm run audit']) {
    assert(guide.includes(command), command)
  }
})

test('code of conduct covers false provenance and private reporting', () => {
  const code = read('CODE_OF_CONDUCT.md')
  assert(code.includes('false provenance attestation'), 'false attestation')
  assert(code.includes('security/advisories/new'), 'private report path')
})

test('SECURITY defines the private vulnerability-report contract', () => {
  const policy = read('SECURITY.md')
  assert(policy.includes('private security advisory'), 'private advisory')
  assert(policy.includes('GPU/renderer'), 'diagnostic GPU context')
})
