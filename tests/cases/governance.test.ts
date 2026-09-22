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
