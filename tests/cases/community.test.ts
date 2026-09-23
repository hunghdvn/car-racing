import { assert, test } from '../harness'
import {
  CODE_ATTESTATION,
  DOCS_ONLY_DECLARATION,
  MODEL_ID_FIELD,
  QWEN_MODEL_ID,
  evaluatePullRequestPolicy,
} from '../../scripts/pr-policy.mjs'

const codeBody = (opts = {}) => {
  const lines = []
  if (opts.attestation !== false) lines.push(CODE_ATTESTATION)
  lines.push(opts.model ?? MODEL_ID_FIELD)
  if (opts.docsOnly) lines.push(DOCS_ONLY_DECLARATION)
  return lines.join('\n')
}

test('Qwen provenance constants match the approved policy', () => {
  assert(QWEN_MODEL_ID === 'Qwen3.8-flash-next', 'exact model ID')
  assert(CODE_ATTESTATION === '- [x] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.', 'exact code attestation')
  assert(MODEL_ID_FIELD === '- Model ID: Qwen3.8-flash-next', 'exact model field')
  assert(DOCS_ONLY_DECLARATION === '- [x] This pull request changes documentation/content only.', 'exact docs-only declaration')
})

test('code-only PR passes when attestation and model are exact', () => {
  const result = evaluatePullRequestPolicy(codeBody(), ['src/core/Input.ts'])
  assert(result.pass, 'policy passes')
  assert(result.description === 'Code contribution provenance accepted', result.description)
})

test('docs-only PR passes without code attestation', () => {
  const result = evaluatePullRequestPolicy('- [x] This pull request changes documentation/content only.', ['README.md'])
  assert(result.pass, 'policy passes')
  assert(result.description === 'Documentation-only contribution accepted', result.description)
})

test('docs-only PR may also include code attestation', () => {
  const result = evaluatePullRequestPolicy(codeBody({ docsOnly: true }), ['docs/spec.md'])
  assert(result.pass, 'policy passes')
  assert(result.description === 'Documentation-only contribution accepted', result.description)
})

test('missing code attestation is rejected', () => {
  const result = evaluatePullRequestPolicy('- Model ID: Qwen3.8-flash-next', ['src/index.ts'])
  assert(!result.pass, 'policy fails')
  assert(result.description === 'Missing Qwen attestation', result.description)
})

test('wrong model ID is rejected', () => {
  const result = evaluatePullRequestPolicy(codeBody({ model: '- Model ID: Qwen3.8-plus' }), ['src/index.ts'])
  assert(!result.pass, 'policy fails')
  assert(result.description === 'Missing or incorrect model ID', result.description)
})

test('docs-only declaration cannot cover non-Markdown changes', () => {
  const result = evaluatePullRequestPolicy(codeBody({ docsOnly: true }), ['README.md', 'src/index.ts'])
  assert(!result.pass, 'mixed docs/code fails')
  assert(result.description === 'Documentation-only declaration conflicts with code changes', result.description)
})

test('non-Markdown project files are treated as code', () => {
  for (const file of ['package-lock.json', 'tsconfig.json', '.github/workflows/ci.yml', 'shots/slice.png', 'src/engine/render.ts']) {
    const result = evaluatePullRequestPolicy('', [file])
    assert(!result.pass, `${file} cannot be docs-only`)
    assert(result.description === 'Missing Qwen attestation', result.description)
  }
})

test('Markdown file matching is case-insensitive', () => {
  const result = evaluatePullRequestPolicy('- [x] This pull request changes documentation/content only.', ['README.MD'])
  assert(result.pass && result.description === 'Documentation-only contribution accepted', 'uppercase .MD is docs-only')
})

test('an empty PR is rejected', () => {
  const result = evaluatePullRequestPolicy(codeBody(), [])
  assert(!result.pass, 'zero files fails')
  assert(result.description === 'Pull request has no changed files', result.description)
})

test('an oversized PR is rejected rather than guessed', () => {
  const many = Array.from({ length: 301 }, (_, index) => `src/generated/File${index}.ts`)
  const result = evaluatePullRequestPolicy(codeBody(), many)
  assert(!result.pass, 'oversized fails')
  assert(result.description === 'Pull request is too large for reliable provenance classification', result.description)
})

test('CRLF and trailing whitespace normalize before exact matching', () => {
  const crlf = codeBody().replace(/\n/g, '\r\n')
  const trailing = `${CODE_ATTESTATION}  \n${MODEL_ID_FIELD}\t\n`
  assert(evaluatePullRequestPolicy(crlf, ['src/a.ts']).pass, 'CRLF passes')
  assert(evaluatePullRequestPolicy(trailing, ['src/a.ts']).pass, 'trailing whitespace passes')
})
