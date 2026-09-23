# Open-source community governance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicize Velocity Rush with MIT/open-source governance and enforce that every new code pull request declares `Qwen3.8-flash-next` authorship through a base-controlled required GitHub check.

**Architecture:** Keep the game unchanged. Add a pure, tested pull-request policy module and a GitHub Actions job that posts the `Qwen provenance` status from the trusted default branch. Run the existing quality/functional/visual gates in ordinary CI, then protect `main` with review and required checks after bootstrapping the governance files into the default branch.

**Tech Stack:** Node.js ESM, GitHub Actions, `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, Playwright/Chromium, Vite, TypeScript, Three.js `0.168.x`.

**Spec:** `docs/superpowers/specs/2026-09-22-open-source-community-governance-design.md`

## Global Constraints

- The required model identifier is exactly `Qwen3.8-flash-next` in all policies, docs, templates, tests, topics, and validation.
- Only non-Markdown pull-request changes are code. A documentation-only pull request is accepted when it checks the exact docs-only declaration.
- A code pull request passes provenance only when both exact lines are present:
  - `- [x] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.`
  - `- Model ID: Qwen3.8-flash-next`
- The required commit-status context is exactly `Qwen provenance`.
- Required CI job display names are exactly `Quality`, `Functional`, and `Visual`.
- The policy workflow uses `pull_request_target`, checks out the default/base branch, and never checks out or executes pull-request code.
- The required status is posted with `actions/checkout@v7`, `actions/setup-node@v7`, and `actions/upload-artifact@v7` only where the plan specifies them.
- No game source, gameplay data, rendering, visual battery, performance behavior, or runtime dependency may be changed by this plan.
- The existing `280` untracked local artifact may remain untracked. Never `git add 280`.
- The GitHub Actions event policy must allow `pull_request_target` for the repository. If it does not, the controlled validation must fail and stop; do not delete or mark the policy check optional.
- Before the bootstrap pull request is merged, GitHub does not run workflows that only exist on that pull request. Do not wait for those bootstrap-only workflows; merge the bootstrap changes first, then validate future workflow behavior.
- Use `--no-edit` when creating a commit message? No, use `-m` and exact commands in each task.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/pr-policy.mjs` | Pure provenance classifier and policy decision maker. No HTTP, Actions, or filesystem behavior. |
| `scripts/check-pr-policy.mjs` | GitHub Actions entry point: fetch PR files, call the policy, post the required commit status. |
| `tests/cases/community.test.ts` | Tests every policy rule against known PR bodies and changed-file lists. |
| `tests/cases/governance.test.ts` | Validates package metadata, MIT license, templates, README, and community policies. |
| `tests/cases/workflows.test.ts` | Validates the required CI/provenance workflow structure and commands. |
| `package.json` | Publishes the package as MIT/open-source and exposes the public repository metadata. |
| `LICENSE` | Authoritative MIT legal terms. |
| `README.md` | Public project overview, screenshots, controls, gates, and contribution rules. |
| `CONTRIBUTING.md` | Workflow and gate contract for contributors. |
| `CODE_OF_CONDUCT.md` | Community behavior and false-provenance consequences. |
| `SECURITY.md` | Private security-report process and required diagnostic context. |
| `.github/ISSUE_TEMPLATE/config.yml` | Disables blank issues and adds security/contribution links. |
| `.github/ISSUE_TEMPLATE/bug-report.yml` | Structured bug report form. |
| `.github/ISSUE_TEMPLATE/feature-request.yml` | Structured feature form including Qwen-policy acknowledgement. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Supplies exact, unchecked attestation controls. |
| `.github/workflows/ci.yml` | Runs quality, functional, and visual gates on pull requests and `main`. |
| `.github/workflows/qwen-policy.yml` | Trusted base-controlled provenance checker. |

---

## Task 1: Provenance policy and Actions entry point

**Files:**
- Create: `scripts/pr-policy.mjs`
- Create: `scripts/check-pr-policy.mjs`
- Create: `tests/cases/community.test.ts`
- Create: `tests/cases/policy-entry.test.ts`
- Modify: `tests/all.ts:1-17`
- Modify: `tests/harness.ts` (async test bodies)
- Test: `tests/cases/community.test.ts`
- Test: `tests/cases/policy-entry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `evaluatePullRequestPolicy(body: string, files: string[]): { pass: boolean; description: string }`
  - `runPolicy({ env, fetcher = globalThis.fetch, log = console }): Promise<number>` — testable entry-point seam; direct CLI execution reads `process.env` and sets `process.exitCode`.
  - exact constants `QWEN_MODEL_ID`, `CODE_ATTESTATION`, `MODEL_ID_FIELD`, `DOCS_ONLY_DECLARATION`, `REQUIRED_STATUS_CONTEXT`, `MAX_CHANGED_FILES`, `OVERSIZED_DESCRIPTION`.

- [ ] **Step 1: Write the failing policy test**

Create `tests/cases/community.test.ts` with exactly:

```ts
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
```

Create `tests/all.ts` with exactly:

```ts
import { runAll } from './harness'
import './cases/camera.test'
import './cases/drive.test'
import './cases/track.test'
import './cases/shortcut.test'
import './cases/lap.test'
import './cases/ai.test'
import './cases/fx.test'
import './cases/ui.test'
import './cases/perf.test'
import './cases/assets.test'
import './cases/community.test'

const ok = await runAll()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
npm run test
```

Expected: compilation fails because `scripts/pr-policy.mjs` does not exist. Stop if the command succeeds.

- [ ] **Step 3: Create the pure policy module**

Create `scripts/pr-policy.mjs` with exactly:

```js
export const QWEN_MODEL_ID = 'Qwen3.8-flash-next'
export const CODE_ATTESTATION = `- [x] I confirm that all code changes in this pull request were authored by ${QWEN_MODEL_ID}.`
export const MODEL_ID_FIELD = `- Model ID: ${QWEN_MODEL_ID}`
export const DOCS_ONLY_DECLARATION = '- [x] This pull request changes documentation/content only.'
export const REQUIRED_STATUS_CONTEXT = 'Qwen provenance'
export const MAX_CHANGED_FILES = 300
export const OVERSIZED_DESCRIPTION = 'Pull request is too large for reliable provenance classification'

const DOCUMENT_EXTENSIONS = ['.md']

function matchesDocumentExtension(file) {
  const lower = file.toLowerCase()
  return DOCUMENT_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

function hasExactLine(lines, target) {
  return lines.some((line) => line.trimEnd() === target)
}

export function evaluatePullRequestPolicy(body, files) {
  const safeBody = typeof body === 'string' ? body : ''
  const safeFiles = Array.isArray(files) ? files : []
  const lines = safeBody.replace(/\r\n?/g, '\n').split('\n')

  if (safeFiles.length === 0) {
    return { pass: false, description: 'Pull request has no changed files' }
  }

  if (safeFiles.length > MAX_CHANGED_FILES) {
    return { pass: false, description: OVERSIZED_DESCRIPTION }
  }

  const isDocsOnly = safeFiles.every(matchesDocumentExtension)
  const hasDocsDeclaration = hasExactLine(lines, DOCS_ONLY_DECLARATION)

  if (isDocsOnly) {
    if (hasDocsDeclaration) {
      return { pass: true, description: 'Documentation-only contribution accepted' }
    }

    if (hasExactLine(lines, CODE_ATTESTATION) && hasExactLine(lines, MODEL_ID_FIELD)) {
      return { pass: true, description: 'Code contribution provenance accepted' }
    }

    return { pass: false, description: 'Missing Qwen attestation' }
  }

  if (hasDocsDeclaration) {
    return { pass: false, description: 'Documentation-only declaration conflicts with code changes' }
  }

  if (!hasExactLine(lines, CODE_ATTESTATION)) {
    return { pass: false, description: 'Missing Qwen attestation' }
  }

  if (!hasExactLine(lines, MODEL_ID_FIELD)) {
    return { pass: false, description: 'Missing or incorrect model ID' }
  }

  return { pass: true, description: 'Code contribution provenance accepted' }
}
```

- [ ] **Step 4: Run the policy tests to confirm they pass**

Run:

```bash
npm run test
```

Expected: `95 passed, 0 failed` and exit 0.

- [ ] **Step 5: Add the GitHub Actions entry point**

Create `scripts/check-pr-policy.mjs` with exactly:

```js
import {
  evaluatePullRequestPolicy,
  MAX_CHANGED_FILES,
  OVERSIZED_DESCRIPTION,
  REQUIRED_STATUS_CONTEXT,
} from './pr-policy.mjs'

const REQUEST_TIMEOUT_MS = 10000

function requireConfig(env, name) {
  if (!env[name]) throw new Error(`Missing required environment variable ${name}`)
}

function requestHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json; api-version=2022-11-28',
    'user-agent': 'velocity-rush-qwen-policy',
    'content-type': 'application/json',
  }
}

async function withTimeout(fetcher, url, init) {
  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`GitHub API request timed out after ${REQUEST_TIMEOUT_MS} ms`)), REQUEST_TIMEOUT_MS)
    })
    return await Promise.race([Promise.resolve().then(() => fetcher(url, init)), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function runPolicy({ env, fetcher = globalThis.fetch, log = console } = {}) {
  const api = env.GITHUB_API_URL ?? 'https://api.github.com'
  const serverUrl = env.GITHUB_SERVER_URL ?? 'https://github.com'
  const repository = env.GITHUB_REPOSITORY
  const token = env.GITHUB_TOKEN
  const prNumber = env.PR_NUMBER
  const prSha = env.PR_SHA
  const prBody = env.PR_BODY ?? ''
  const targetUrl = `${serverUrl}/${repository}/actions/workflows/qwen-policy.yml`

  async function requestJson(url, label) {
    let response
    try {
      response = await withTimeout(fetcher, url, { headers: requestHeaders(token) })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`GitHub API request failed (${label}): ${detail}`)
    }
    if (!response.ok) throw new Error(`Cannot ${label} (${response.status})`)
    return await response.json()
  }

  async function fetchPullMeta(label) {
    const url = `${api}/repos/${repository}/pulls/${prNumber}`
    const pr = await requestJson(url, label)
    const sha = pr && typeof pr.head?.sha === 'string' ? pr.head.sha : ''
    const total = pr ? pr.changed_files : undefined
    if (!sha) throw new Error('Pull-request metadata is missing a head SHA')
    if (!Number.isInteger(total) || total < 0) {
      throw new Error('Pull-request metadata is missing a valid changed_files total')
    }
    return { sha, total }
  }

  async function fetchChangedFiles() {
    const files = []
    let page = 1

    while (true) {
      const url = `${api}/repos/${repository}/pulls/${prNumber}/files?per_page=100&page=${page}`
      const batch = await requestJson(url, 'list pull-request files')
      if (!Array.isArray(batch)) throw new Error('Pull-request file listing is not an array')
      if (batch.length === 0) break

      for (const entry of batch) {
        const filename = entry && typeof entry.filename === 'string' ? entry.filename : ''
        if (!filename) throw new Error('Pull-request file listing contains an unnamed file')
        files.push(filename)
      }
      if (files.length >= MAX_CHANGED_FILES || batch.length < 100) break
      page += 1
    }

    return files
  }

  async function postStatus(state, description) {
    const url = `${api}/repos/${repository}/statuses/${prSha}`
    const body = JSON.stringify({
      state,
      context: REQUIRED_STATUS_CONTEXT,
      description: description.slice(0, 145),
      target_url: targetUrl,
    })
    let response
    try {
      response = await withTimeout(fetcher, url, { method: 'POST', headers: requestHeaders(token), body })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`GitHub API request failed (post the Qwen provenance status): ${detail}`)
    }
    if (!response.ok) throw new Error(`Cannot post the Qwen provenance status (${response.status})`)
  }

  async function finish(result) {
    await postStatus(result.pass ? 'success' : 'failure', result.description)
    log.log(`Qwen provenance: ${result.pass ? 'PASS' : 'FAIL'} — ${result.description}`)
    return result.pass ? 0 : 1
  }

  try {
    for (const name of ['GITHUB_REPOSITORY', 'GITHUB_TOKEN', 'PR_NUMBER', 'PR_SHA']) requireConfig(env, name)

    const meta = await fetchPullMeta('read pull-request metadata')
    if (meta.sha !== prSha) {
      throw new Error(`Pull-request head SHA mismatch: expected ${prSha}, found ${meta.sha}`)
    }

    if (meta.total > MAX_CHANGED_FILES) {
      return await finish({ pass: false, description: OVERSIZED_DESCRIPTION })
    }

    const files = await fetchChangedFiles()
    if (files.length !== meta.total) {
      throw new Error(`Pull-request file listing mismatch: listed ${files.length} of ${meta.total} changed_files`)
    }

    const rechecked = await fetchPullMeta('recheck pull-request metadata')
    if (rechecked.sha !== prSha) {
      throw new Error('Pull-request head SHA changed while collecting the file listing')
    }

    return await finish(evaluatePullRequestPolicy(prBody, files))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown provenance policy failure'
    try {
      await postStatus('failure', message)
    } catch (statusError) {
      log.error(`Could not report provenance failure: ${String(statusError)}`)
    }
    log.error(`Qwen provenance policy error: ${message}`)
    return 1
  }
}

if (String(process.argv[1] ?? '').split('/').at(-1) === 'check-pr-policy.mjs') {
  process.exitCode = await runPolicy({ env: process.env })
}
```

- [ ] **Step 6: Cover the Actions entry point**

Replace `tests/harness.ts` with exactly:

```ts
/* minimal node-runnable test harness (no deps; driven by scripts/tests.mjs) */

export interface TestCase { name: string; fn: () => void | Promise<void> }
export const suite: TestCase[] = []

export function test(name: string, fn: () => void | Promise<void>): void {
  suite.push({ name, fn })
}

export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed — ${msg}`)
}

export function assertNear(v: number, target: number, tol: number, msg: string): void {
  assert(Math.abs(v - target) <= tol, `${msg} — got ${v.toFixed(4)}, want ${target} ±${tol}`)
}

export function assertFinite(v: number, msg: string): void {
  assert(Number.isFinite(v), `${msg} — got ${v}`)
}

export async function runAll(): Promise<boolean> {
  let pass = 0, fail = 0
  for (const t of suite) {
    const t0 = Date.now()
    try {
      await t.fn()
      console.log(`  ok   ${t.name} (${Date.now() - t0} ms)`)
      pass++
    } catch (e) {
      console.log(`  FAIL ${t.name}: ${(e as Error).message}`)
      fail++
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  return fail === 0
}
```

Create `tests/cases/policy-entry.test.ts` with exactly:

```ts
import { assert, test } from '../harness'
import {
  CODE_ATTESTATION,
  DOCS_ONLY_DECLARATION,
  MAX_CHANGED_FILES,
  MODEL_ID_FIELD,
  REQUIRED_STATUS_CONTEXT,
} from '../../scripts/pr-policy.mjs'
import { runPolicy } from '../../scripts/check-pr-policy.mjs'

type FetchCall = { url: string; method: string; payload: Record<string, string> | undefined }
type Plan = { total: number; meta?: unknown[]; pages?: unknown[]; status?: unknown }

const BASE = {
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'hunghdvn/car-racing',
  GITHUB_TOKEN: 'test-token',
  PR_NUMBER: '42',
  PR_SHA: 'cafebab312345678',
}

const silentLog = { log: () => undefined, error: () => undefined }

const codeBody = (extra: string[] = []) => [CODE_ATTESTATION, MODEL_ID_FIELD, ...extra].join('\n')
const docsBody = () => DOCS_ONLY_DECLARATION

function jsonResponse(status: number, payload: unknown) {
  const ok = status >= 200 && status < 300
  return { ok, status, json: async () => payload }
}

function queueReader(initial: unknown[], fallback: unknown) {
  const queue = [...initial]
  return () => {
    if (queue.length > 1) return queue.shift()
    if (queue.length === 1) return queue[0]
    return fallback
  }
}

function makeFetcher(plan: Plan) {
  const calls: FetchCall[] = []
  const nextMeta = queueReader(plan.meta ?? [], { head: { sha: BASE.PR_SHA }, changed_files: plan.total })
  const nextFiles = queueReader(plan.pages ?? [[]], [])
  const fetcher = async (url: string, init: Record<string, unknown> = {}) => {
    const method = String(init.method ?? 'GET')
    const payload = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : undefined
    calls.push({ url, method, payload })
    let result: unknown
    if (method === 'POST') result = plan.status
    else if (url.includes('/files?')) {
      const batch = nextFiles()
      result = Array.isArray(batch)
        ? batch.map((entry: unknown) => (typeof entry === 'string' ? { filename: entry } : entry))
        : batch
    }
    else if (url.includes('/pulls/')) result = nextMeta()
    else throw new Error(`Unexpected request: ${url}`)
    if (result instanceof Error) throw result
    if (typeof result === 'number') return jsonResponse(result, {})
    return jsonResponse(200, result)
  }
  return { calls, fetcher }
}

function statusPosts(calls: FetchCall[]) {
  return calls.filter((call) => call.method === 'POST')
}

function assertPosted(calls: FetchCall[], state: string, description: string) {
  const posts = statusPosts(calls)
  assert(posts.length === 1, `exactly one status post, got ${posts.length}`)
  const post = posts[0]
  assert(post.url.endsWith(`/statuses/${BASE.PR_SHA}`), `status targets the pinned PR SHA, got ${post.url}`)
  assert(post.payload?.state === state, `status state ${state}, got ${post.payload?.state}`)
  assert(post.payload?.context === REQUIRED_STATUS_CONTEXT, `status context, got ${post.payload?.context}`)
  assert(post.payload?.description === description, `status description, got ${post.payload?.description}`)
  assert(String(post.payload?.target_url).includes('/actions/workflows/qwen-policy.yml'), 'status target URL')
}

function run(plan: Plan, overrides: Record<string, string> = {}) {
  const { calls, fetcher } = makeFetcher(plan)
  const env = { ...BASE, PR_BODY: codeBody(), ...overrides }
  const done = runPolicy({ env, fetcher, log: silentLog })
  return { calls, done }
}

test('entry point posts success for a compliant code PR', async () => {
  const { calls, done } = run({ total: 2, pages: [['src/core/Input.ts', 'styles.css']] })
  const exitCode = await done
  assert(exitCode === 0, `exit 0, got ${exitCode}`)
  assertPosted(calls, 'success', 'Code contribution provenance accepted')
})

test('entry point posts success for a docs-only PR', async () => {
  const { calls, done } = run({ total: 1, pages: [['docs/guide.md']] }, { PR_BODY: docsBody() })
  const exitCode = await done
  assert(exitCode === 0, `exit 0, got ${exitCode}`)
  assertPosted(calls, 'success', 'Documentation-only contribution accepted')
})

test('entry point posts failure when the attestation is missing', async () => {
  const { calls, done } = run({ total: 1, pages: [['src/index.ts']] }, { PR_BODY: MODEL_ID_FIELD })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assertPosted(calls, 'failure', 'Missing Qwen attestation')
})

test('entry point fails closed when the reported head SHA mismatches PR_SHA', async () => {
  const { calls, done } = run({
    total: 2,
    meta: [{ head: { sha: 'deadd00dbeef' }, changed_files: 2 }],
    pages: [['src/a.ts', 'src/b.ts']],
  })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assert(!calls.some((call) => call.url.includes('/files?')), 'the file listing is not fetched after a SHA mismatch')
  assertPosted(calls, 'failure', `Pull-request head SHA mismatch: expected ${BASE.PR_SHA}, found deadd00dbeef`)
})

test('entry point fails closed when the head SHA changes before the recheck', async () => {
  const { calls, done } = run({
    total: 2,
    meta: [
      { head: { sha: BASE.PR_SHA }, changed_files: 2 },
      { head: { sha: 'deadd00dbeef' }, changed_files: 2 },
    ],
    pages: [['src/a.ts', 'src/b.ts']],
  })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assert(calls.some((call) => call.url.includes('/files?')), 'the file listing was collected before the recheck')
  assertPosted(calls, 'failure', 'Pull-request head SHA changed while collecting the file listing')
})

test('entry point rejects oversized PRs without trusting the file listing', async () => {
  const { calls, done } = run({ total: MAX_CHANGED_FILES + 1, pages: [['README.md', 'docs/guide.md']] })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assert(!calls.some((call) => call.url.includes('/files?')), 'the capped file listing is never fetched')
  assertPosted(calls, 'failure', 'Pull request is too large for reliable provenance classification')
})

test('entry point fails closed when the file listing is shorter than the total', async () => {
  const { calls, done } = run({ total: 3, pages: [['src/a.ts', 'src/b.ts']] })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assertPosted(calls, 'failure', 'Pull-request file listing mismatch: listed 2 of 3 changed_files')
})

test('entry point fails closed when the file listing is longer than the total', async () => {
  const { calls, done } = run({ total: 2, pages: [['src/a.ts', 'src/b.ts', 'src/c.ts']] })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assertPosted(calls, 'failure', 'Pull-request file listing mismatch: listed 3 of 2 changed_files')
})

test('entry point fails closed on a network error', async () => {
  const { calls, done } = run({ total: 2, meta: [new Error('network down')], pages: [['src/a.ts', 'src/b.ts']] })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assertPosted(calls, 'failure', 'GitHub API request failed (read pull-request metadata): network down')
})

test('entry point fails closed on a server error response', async () => {
  const { calls, done } = run({ total: 2, pages: [500] })
  const exitCode = await done
  assert(exitCode === 1, `exit 1, got ${exitCode}`)
  assertPosted(calls, 'failure', 'Cannot list pull-request files (500)')
})

test('a failing status post still yields a non-zero exit', async () => {
  const { calls, done } = run({ total: 2, pages: [['src/a.ts', 'src/b.ts']], status: 422 })
  const exitCode = await done
  assert(exitCode !== 0, `non-zero exit, got ${exitCode}`)
  assert(statusPosts(calls).length === 2, 'the policy post and the fail-closed post were both attempted')
})
```

Replace `tests/all.ts` with exactly:

```ts
import { runAll } from './harness'
import './cases/camera.test'
import './cases/drive.test'
import './cases/track.test'
import './cases/shortcut.test'
import './cases/lap.test'
import './cases/ai.test'
import './cases/fx.test'
import './cases/ui.test'
import './cases/perf.test'
import './cases/assets.test'
import './cases/community.test'
import './cases/policy-entry.test'

const ok = await runAll()
process.exit(ok ? 0 : 1)
```

Expected: `106 passed, 0 failed` and exit 0. The tests inject a fake fetcher, perform no network I/O, and assert the posted status `state`, `context`, and `description`.

- [ ] **Step 7: Validate the script syntax and rerun tests**

Run:

```bash
node --check scripts/pr-policy.mjs
node --check scripts/check-pr-policy.mjs
npm run test
```

Expected: syntax checks silent and all tests pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/pr-policy.mjs scripts/check-pr-policy.mjs tests/cases/community.test.ts tests/cases/policy-entry.test.ts tests/harness.ts tests/all.ts
git commit -m "feat: validate Qwen pull-request provenance"
```

Expected: one commit on `feature/open-source-governance` containing only those six files.

---

## Task 2: Open-source package metadata, MIT license, and issue/PR templates

**Files:**
- Modify: `package.json:1-30`
- Create: `LICENSE`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/ISSUE_TEMPLATE/bug-report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature-request.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `tests/cases/governance.test.ts`
- Modify: `tests/all.ts:1-15`
- Test: `tests/cases/governance.test.ts`

**Interfaces:**
- Consumes: policy constants already tested in Task 1.
- Produces: public package metadata, MIT terms, and exact PR controls used by policy validation and human reviewers.

- [ ] **Step 1: Write the failing governance metadata test**

Create `tests/cases/governance.test.ts` with exactly:

```ts
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
```

Add the governance test to `tests/all.ts`, replacing that file with exactly:

```ts
import { runAll } from './harness'
import './cases/camera.test'
import './cases/drive.test'
import './cases/track.test'
import './cases/shortcut.test'
import './cases/lap.test'
import './cases/ai.test'
import './cases/fx.test'
import './cases/ui.test'
import './cases/perf.test'
import './cases/assets.test'
import './cases/community.test'
import './cases/governance.test'

const ok = await runAll()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
npm run test
```

Expected: governance metadata assertions fail because the new files do not exist. Stop if it succeeds.

- [ ] **Step 3: Make the package metadata public**

Replace `package.json` with exactly:

```json
{
  "name": "velocity-rush",
  "private": false,
  "version": "1.0.0",
  "license": "MIT",
  "type": "module",
  "description": "Velocity Rush - arcade 3D browser racing game",
  "repository": {
    "type": "git",
    "url": "https://github.com/hunghdvn/car-racing.git"
  },
  "homepage": "https://github.com/hunghdvn/car-racing#readme",
  "keywords": [
    "arcade-racing",
    "3d",
    "webgl",
    "threejs"
  ],
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "build:harness": "tsc --noEmit && VR_HARNESS=1 vite build --outDir build/harness --emptyOutDir",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "node scripts/tests.mjs",
    "shots": "node scripts/shots.mjs",
    "probe": "node scripts/probe.mjs",
    "noleak": "node scripts/noleak.mjs",
    "functional": "node scripts/functional.mjs",
    "audit": "node scripts/audit-shots.mjs"
  },
  "dependencies": {
    "three": "^0.168.0"
  },
  "devDependencies": {
    "@types/three": "^0.168.0",
    "esbuild": "^0.21.5",
    "playwright": "1.63",
    "typescript": "^5.5.4",
    "vite": "^5.4.8"
  }
}
```

- [ ] **Step 4: Add the MIT license**

Create `LICENSE` with exactly:

```text
MIT License

Copyright © 2026 hunghdvn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sub-license, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EITHER
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```

- [ ] **Step 5: Add issue-template configuration**

Create `.github/ISSUE_TEMPLATE/config.yml` with exactly:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Report a security issue privately
    url: "https://github.com/hunghdvn/car-racing/security/advisories/new"
  - name: Read the contribution guide
    url: "https://github.com/hunghdvn/car-racing/blob/main/CONTRIBUTING.md"
```

- [ ] **Step 6: Add the bug-report form**

Create `.github/ISSUE_TEMPLATE/bug-report.yml` with exactly:

```yaml
name: Bug report
description: Report reproducible behavior that differs from the expected result.
title: "[Bug]: "
body:
  - type: markdown
    attributes:
      value: |
        Before opening this issue, run:
        `npm run test`, `npm run typecheck`, `npm run build`, `npm run noleak`,
        `npm run functional`, `npm run shots`, and `npm run audit`.
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      placeholder: What should happen?
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      placeholder: What happened instead?
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Reproducible steps
      description: Include a fresh clone URL and exact commands if possible.
      placeholder: "1. npm ci\n2. npm run dev\n3. ..."
    validations:
      required: true
  - type: input
    id: frequency
    attributes:
      label: Frequency
      description: Every time, sometimes, or first run only?
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Browser and operating system
      description: Include browser version, OS, and GPU/renderer stack.
      placeholder: Chrome 140, macOS 26, Apple M2 / Metal
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Logs or console output
      placeholder: Paste the exact command output or browser console trace.
    validations:
      required: true
```

- [ ] **Step 7: Add the feature-request form**

Create `.github/ISSUE_TEMPLATE/feature-request.yml` with exactly:

```yaml
name: Feature request
description: Propose a focused behavior change for maintainer review.
title: "[Feature]: "
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem to solve
      description: What user or maintainer need is currently unmet?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed behavior
      description: Describe the requested outcome and acceptance evidence.
    validations:
      required: true
  - type: textarea
    id: scope
    attributes:
      label: Explicitly out of scope
      description: List adjacent work this proposal must not include.
    validations:
      required: true
  - type: checkboxes
    id: policy
    attributes:
      label: Contribution model
      description: New code must be authored with Qwen3.8-flash-next.
      options:
        - label: I accept the Qwen-only code authorship policy.
          required: true
  - type: textarea
    id: evidence
    attributes:
      label: Evidence or prototype
      description: Screenshots, recording, logs, test results, or performance data.
    validations:
      required: false
```

- [ ] **Step 8: Add the pull-request template**

Create `.github/PULL_REQUEST_TEMPLATE.md` with exactly:

```markdown
## Summary

Describe the focused change and link the relevant issue.

## Validation

- [ ] `npm run test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run noleak`
- [ ] `npm run functional`
- [ ] `npm run shots`
- [ ] `npm run audit`

Add the exact command output for any skipped or environment-dependent gate.

## Authorship attestation

- [ ] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.
- Model ID: Qwen3.8-flash-next
- Prompt and change summary:

## Documentation-only declaration

- [ ] This pull request changes documentation/content only.

Maintainers review this self-reported declaration against the changed files.
A false declaration violates the code of conduct.
```

- [ ] **Step 9: Run governance metadata tests**

Run:

```bash
npm run test
npm run typecheck
```

Expected: `111 passed, 0 failed`, typecheck passes. Stop if not.

- [ ] **Step 10: Commit**

```bash
git add package.json LICENSE .github/ISSUE_TEMPLATE/config.yml .github/ISSUE_TEMPLATE/bug-report.yml .github/ISSUE_TEMPLATE/feature-request.yml .github/PULL_REQUEST_TEMPLATE.md tests/cases/governance.test.ts tests/all.ts
git commit -m "build: publish velocity rush under the MIT license"
```

Expected: one commit with the eight files above.

---

## Task 3: Public community documentation

**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Modify: `tests/cases/governance.test.ts`
- Test: `tests/cases/governance.test.ts`

**Interfaces:**
- Consumes: Task 2's public package metadata and templates.
- Produces: public-facing contract checked by governance tests.

- [ ] **Step 1: Add failing checks for all four docs**

Append exactly to `tests/cases/governance.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
npm run test
```

Expected: new docs assertions fail because files are absent. Stop if it succeeds.

- [ ] **Step 3: Create the public README**

Create `README.md` with exactly:

```markdown
# Velocity Rush

A 3D arcade racing browser game: one track, six cars, one race. It targets
60 FPS with keyboard and gamepad input, deterministic visual evidence, and an
open-source contribution policy that ties new code to Qwen3.8-flash-next.

![Race slice](shots/slice.png)
![Coastal section](shots/section_coastal.png)
![Tunnel section](shots/section_tunnel.png)
![City section](shots/section_city.png)
![Finish line](shots/section_finish.png)

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle | `W` or `↑` | Right trigger |
| Brake/reverse | `S` or `↓` | Left trigger |
| Steer | `A`/`←` and `D`/`→` | Left stick or d-pad |
| Handbrake | `Space` | LB |
| Nitro | `Shift` | RB |
| Respawn | `R` | Y |
| Pause | `P` or `Escape` | Start |
| Confirm | `Enter` | A |

## Quickstart

```bash
npm ci
npm run dev
```

Open the Vite URL printed by the development server.

## Validation

Run every gate before requesting review:

```bash
npm run test
npm run typecheck
npm run build
npm run noleak
npm run functional
npm run shots
npm run audit
```

The functional command is intentionally CPU/SwiftShader-compatible and skips
wall-clock timing gates that require a real GPU. GPU performance evidence is
collected separately with:

```bash
node scripts/perf.mjs --mode ladder --gpu --label review
node scripts/perf.mjs --mode tiers --gpu --label tiers
```

The committed `shots/` battery is the visual acceptance evidence. Maintainers
still perform manual audio-listening, physical gamepad-feel, and 5-Second
gameplay reviews before accepting a user-visible change.

## Tech stack

- Vite
- TypeScript strict mode
- Three.js `0.168.x`
- WebGL2
- Node.js test and validation harnesses
- Playwright/Chromium for deterministic screenshot capture

## Repository layout

```text
src/               game code
tests/             headless tests
scripts/         validation harnesses
shots/             committed visual battery
docs/            design and implementation documents
.github/        issue/PR templates and workflows
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting work.

New code, tests, workflows, package metadata, and assets must be authored with
`Qwen3.8-flash-next`. Documentation-only contributions can use the docs-only
declaration instead. The pull-request attestation is self-reported; maintainers
verify the declaration against the changed files and commit evidence. Existing
commit history is grandfathered under this policy.

## License

Velocity Rush is released under the [MIT License](LICENSE).
```

- [ ] **Step 4: Create the contributor guide**

Create `CONTRIBUTING.md` with exactly:

```markdown
# Contributing to Velocity Rush

By contributing, you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Qwen-only code authorship

Every new contribution that changes source, tests, scripts, workflows, package
metadata, screenshots, or other binary/behavior assets must be authored using
`Qwen3.8-flash-next`. Existing commit history is grandfathered under this policy.

A code pull request must contain the exact checked attestation from the pull-request
template:

```markdown
- [x] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.
- Model ID: Qwen3.8-flash-next
```

The base-controlled `Qwen provenance` check validates this declaration against the
pull-request body and changed files. Because a source-host cannot prove which model
was used, the declaration remains subject to maintainer review. Submitting a false
declaration violates the code of conduct.

## Documentation-only contributions

Documentation-only pull requests are limited to `.md` files. Check:

```markdown
- [x] This pull request changes documentation/content only.
```

A checked docs-only declaration with any non-Markdown file is rejected as
contradictory.

## Before you start

1. Search existing issues and pull requests.
2. Open an issue before a substantive behavioral change and wait for maintainer
   direction.
3. Keep one focused change per pull request. Do not bundle refactoring with a
   feature or bug fix.
4. State the files, behavior, and validation evidence you intend to deliver.

## Local development

```bash
npm ci
npm run dev
```

Run all gates locally:

```bash
npm run test
npm run typecheck
npm run build
npm run noleak
npm run functional
npm run shots
npm run audit
```

- `npm run functional` checks gameplay without GPU-specific timing gates.
- `npm run shots` regenerates the visual battery.
- `npm run audit` validates that battery.
- Visual changes require reviewed screenshots and their rationale.
- Performance-relevant changes require fresh `node scripts/perf.mjs` evidence or
  an explanation why the existing committed evidence remains valid.
- Maintainer audio-listening, physical gamepad, and 5-Second gameplay review
  remain required for user-visible gameplay/audio changes.

## Pull-request process

1. Branch from the current `main`.
2. Use Conventional Commit subjects; omit periods and keep subjects imperative.
3. Push and open a pull request from the repository template.
4. Fill the authorship or docs-only declaration.
5. Request maintainer review.
6. Do not force-push after review has started; push follow-up commits and let
   stale approvals be dismissed.
7. `main` requires one approving maintainer review and green `Quality`,
   `Functional`, `Visual`, and `Qwen provenance` checks.

The policy is enforced for new contributions, not retroactively rewritten
commit history.
```

- [ ] **Step 5: Create the code of conduct**

Create `CODE_OF_CONDUCT.md` with exactly:

```markdown
# Contributor Covenant code of conduct

## Our pledge

We are dedicated to making participation in this project a harassment-free
experience for everybody, regardless of experience level, identity,
socioeconomic status, technical background, or other personal characteristic.

## Standards

Positive behavior:

- use welcoming and inclusive language;
- respect different viewpoints and experiences;
- accept constructive criticism;
- prioritize the health and sustainability of the project and community;
- provide honest, reproducible evidence with contributions.

Unacceptable behavior:

- harassment, insults, personal attacks, or public/private pressure;
- publishing another person's private information without explicit permission;
- spam, malicious contributions, or deliberately harmful code;
- submitting a false provenance attestation;
- ignoring maintainer direction about scope, safety, or contribution quality.

## Enforcement and reporting

Report concerns privately through
[GitHub security advisories](https://github.com/hunghdvn/car-racing/security/advisories/new).
Mark the title `[Code of Conduct]` so the report is routed privately.

Maintainers review reports promptly and may request additional context.
Consequences range from a private warning to removal of the contribution,
reversion of its work, temporary exclusion, or a permanent ban, based on the
severity and recurrence of the behavior.

Maintainers who do not follow or enforce this code in good faith may be
permanently excluded from project leadership.

## Attribution

This document adapts the Contributor Covenant 1.4.
```

- [ ] **Step 6: Create the security policy**

Create `SECURITY.md` with exactly:

```markdown
# Security policy

Report vulnerabilities privately through
[GitHub security advisories](https://github.com/hunghdvn/car-racing/security/advisories/new).

Do not open a public issue containing credentials, exploits, crash data,
private URLs, or reproducible exploit steps.

Include:

- affected commit/tag and URL;
- browser and operating system;
- GPU/renderer stack;
- minimal reproducible steps;
- expected versus actual behavior;
- console output or crash log;
- proof of concept and impact.

Maintainers aim to acknowledge a report within 7 days and provide a triage
assessment within 14 days. Public disclosure timing is coordinated with the
reporter.
```

- [ ] **Step 7: Run docs validation**

Run:

```bash
npm run test
npm run typecheck
```

Expected: `115 passed, 0 failed`, typecheck passes.

- [ ] **Step 8: Commit**

```bash
git add README.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md tests/cases/governance.test.ts
git commit -m "docs: publish the community contribution contract"
```

---

## Task 4: CI and trusted provenance workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/qwen-policy.yml`
- Create: `tests/cases/workflows.test.ts`
- Modify: `tests/all.ts:1-16`
- Test: `tests/cases/workflows.test.ts`

**Interfaces:**
- Consumes:
  - `scripts/check-pr-policy.mjs` and exact environment names from Task 1.
  - exact job display names from the global constraints.
- Produces: GitHub Actions workflows and required status checks.

- [ ] **Step 1: Write failing workflow-structure tests**

Create `tests/cases/workflows.test.ts` with exactly:

```ts
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
```

Replace `tests/all.ts` with exactly:

```ts
import { runAll } from './harness'
import './cases/camera.test'
import './cases/drive.test'
import './cases/track.test'
import './cases/shortcut.test'
import './cases/lap.test'
import './cases/ai.test'
import './cases/fx.test'
import './cases/ui.test'
import './cases/perf.test'
import './cases/assets.test'
import './cases/community.test'
import './cases/policy-entry.test'
import './cases/governance.test'
import './cases/workflows.test'

const ok = await runAll()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
npm run test
```

Expected: workflow file reads fail because workflow files are absent. Stop if it succeeds.

- [ ] **Step 3: Add the CI workflow**

Create `.github/workflows/ci.yml` with exactly:

```yaml
name: CI

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number ?? github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: Quality
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: npm
      - name: Install
        run: npm ci
      - name: Typecheck
        run: npm run typecheck
      - name: Unit tests
        run: npm run test
      - name: Production build
        run: npm run build
      - name: No-leak audit
        run: npm run noleak

  functional:
    name: Functional
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: npm
      - name: Install
        run: npm ci
      - name: Install Chromium
        run: npx playwright install --with-deps chromium
      - name: Functional checks
        run: npm run functional

  visual:
    name: Visual
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: npm
      - name: Install
        run: npm ci
      - name: Install Chromium
        run: npx playwright install --with-deps chromium
      - name: Capture visual battery
        run: npm run shots
      - name: Audit visual battery
        run: npm run audit
      - name: Upload shots on failure
        if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: visual-shots
          path: shots/
          if-no-files-found: warn
```

- [ ] **Step 4: Add the trusted Qwen policy workflow**

Create `.github/workflows/qwen-policy.yml` with exactly:

```yaml
name: Qwen provenance

on:
  pull_request_target:
    types:
      - opened
      - edited
      - synchronize
      - reopened
      - ready_for_review

permissions:
  contents: read
  pull-requests: read
  statuses: write

jobs:
  policy:
    name: Qwen provenance
    runs-on: ubuntu-latest
    steps:
      - name: Checkout the default policy code
        uses: actions/checkout@v7
        with:
          ref: ${{ github.base_ref }}
      - name: Set up Node
        uses: actions/setup-node@v7
      - name: Evaluate the pull-request attestation
        run: node scripts/check-pr-policy.mjs
        env:
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_SHA: ${{ github.event.pull_request.head.sha }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_TOKEN: ${{ github.token }}
          GITHUB_API_URL: ${{ github.api_url }}
          GITHUB_SERVER_URL: ${{ github.server_url }}
```

- [ ] **Step 5: Run workflow tests**

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Expected: `117 passed, 0 failed`; typecheck/build pass.

- [ ] **Step 6: Run the full existing gates**

Run:

```bash
npm run noleak
npm run functional
npm run shots
npm run audit
```

Expected: every command exits 0. The functional run may report its three GPU-only timing gates as `SKIP`; that is the expected CPU/SwiftShader result.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/qwen-policy.yml tests/cases/workflows.test.ts tests/all.ts
git commit -m "ci: enforce provenance and repository gates"
```

---

## Task 5: Bootstrap merge, public conversion, protection, and controlled policy validation

**Files:**
- No repository files modified by this task.
- GitHub resources modified: repository settings, repository topics, Actions event policy, `main` branch protection.

**Interfaces:**
- Consumes: Tasks 1-4 and the approved spec.
- Produces: public repository with enforced governance and observed controlled PR tests.

- [ ] **Step 1: Confirm the branch is clean and all local work is committed**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: no changes except the local untracked `280`, if it still exists. Expected commits (newest first) are the four task commits created above. Stop and resolve all other changes first.

- [ ] **Step 2: Push the bootstrap governance branch**

```bash
git push -u origin feature/open-source-governance
```

- [ ] **Step 3: Create and request review for the bootstrap pull request**

Create the PR body:

```bash
cat > /var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/bootstrap-body.md <<'BODY'
## Summary

Bootstraps public MIT/open-source governance, CI, and the required
`Qwen provenance` policy for new code contributions.

## Validation

- [x] `npm run test`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run noleak`
- [x] `npm run functional`
- [x] `npm run shots`
- [x] `npm run audit`

## Authorship attestation

- [x] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.
- Model ID: Qwen3.8-flash-next

## Documentation-only declaration

- [ ] This pull request changes documentation/content only.
BODY
```

Create the PR:

```bash
gh pr create --base main --head feature/open-source-governance \
  --title "Open-source community governance bootstrap" \
  --body-file /var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/bootstrap-body.md
```

Pause and ask the maintainer to review it. Do not merge without an explicit maintainer response approving this exact PR.

- [ ] **Step 4: Merge the bootstrap PR after maintainer approval**

```bash
gh pr merge --delete-branch
git switch main
git pull --ff-only origin main
```

Expected: the merge commit is on `main` and local `main` matches `origin/main`.

- [ ] **Step 5: Confirm the first `main` push CI is green**

Wait until the push-triggered CI has completed:

```bash
gh run list --workflow CI --branch main -L 5
```

Expected: the newest `CI` run for the merge commit is `completed` and `success`.

If it is pending, watch its numeric run id:

```bash
gh run watch <run-id> --compact --exit-status
```

If it fails, stop and report the run URL.

- [ ] **Step 6: Make the repository public**

```bash
gh repo edit --visibility public --accept-visibility-change-consequences
gh repo view --json visibility,homepageUrl,repositoryTopics
```

Expected: `visibility` is `public`.

- [ ] **Step 7: Add public repository metadata**

```bash
gh repo edit --homepage "https://github.com/hunghdvn/car-racing#readme" \
  --add-topic arcade-game \
  --add-topic 3d \
  --add-topic webgl \
  --add-topic threejs \
  --add-topic open-source \
  --add-topic qwen \
  --add-topic qwen3-8-flash-next
gh repo view --json homepageUrl,repositoryTopics
```

Expected: homepage is correct and topics include all seven listed topics.

- [ ] **Step 8: Enable private vulnerability reporting**

`gh repo edit` does not expose this setting in the installed CLI. Open:

```text
https://github.com/hunghdvn/car-racing/settings/security_policy
```

Navigate through **Security & analysis** and enable **Private vulnerability reporting**, then confirm the check is enabled.

- [ ] **Step 9: Confirm the policy workflow and Actions event availability**

Run:

```bash
gh workflow list
gh workflow view qwen-policy.yml --yaml
```

Expected:
- `qwen-policy.yml` is active;
- its trigger includes `pull_request_target`;
- `actions/checkout@v7` and Node setup are present.

If GitHub disables `pull_request_target`, stop and report it as the blocker. Do not convert the policy to an ordinary fork workflow.

- [ ] **Step 10: Enable branch protection**

Create `/var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/branch-protection.json` with exactly:

```json
{
  "required_status_checks": [
    "Quality",
    "Functional",
    "Visual",
    "Qwen provenance"
  ],
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_pull_request": {
    "required": true
  },
  "required_linear_history": false,
  "required_signatures": {
    "enabled": false,
    "required_signatures": false
  },
  "enforce_admins": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

Apply it:

```bash
gh api --method PUT repos/hunghdvn/car-racing/branches/main/protection \
  --input /var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/branch-protection.json
gh api repos/hunghdvn/car-racing/branches/main/protection
```

Expected response includes all four required contexts, one approving review, stale review dismissal, PR requirement, force push disabled, deletion disabled, and admin enforcement enabled.

- [ ] **Step 11: Validate a documentation-only PR**

Create its PR body:

```bash
cat > /var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/docs-only-body.md <<'BODY'
Controlled policy validation for documentation-only changes.

- [x] This pull request changes documentation/content only.
BODY
```

Run:

```bash
git switch -c test/governance-docs-only main
git pull --ff-only origin main
printf '%s\n' 'Controlled validation of documentation-only provenance.' > GOVERNANCE_TEST.md
git add GOVERNANCE_TEST.md
git commit -m "docs: validate documentation-only provenance handling"
git push -u origin test/governance-docs-only
gh pr create --base main --head test/governance-docs-only \
  --title "Governance docs-only validation" \
  --body-file /var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/docs-only-body.md
```

Wait for required checks:

```bash
gh pr checks --required --watch --interval 5
```

Expected: exit 0 and all four required checks pass. If any required check fails or remains pending, stop and report the exact check and workflow URL.

Close the validation PR:

```bash
gh pr close --delete-branch
git switch main
git pull --ff-only origin main
```

- [ ] **Step 12: Validate a code PR without attestation**

Create its PR body:

```bash
cat > /var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/missing-attestation-body.md <<'BODY'
Controlled policy validation for a missing Qwen code attestation.

- [ ] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.
- Model ID: Qwen3.8-flash-next
- [ ] This pull request changes documentation/content only.
BODY
```

Run:

```bash
git switch -c test/governance-code-missing-attestation main
git pull --ff-only origin main
mkdir -p scripts/test
printf '%s\n' 'export const governancePolicyTest = true' > scripts/test/governance-policy-test.ts
git add scripts/test/governance-policy-test.ts
git commit -m "test: probe missing provenance attestation"
git push -u origin test/governance-code-missing-attestation
gh pr create --base main --head test/governance-code-missing-attestation \
  --title "Governance missing-attestation validation" \
  --body-file /var/folders/cl/jqg8gj46h001k736stfmwn6h0000gn/T/opencode/missing-attestation-body.md
```

Wait for all checks:

```bash
gh pr checks --watch --interval 5 || true
gh pr checks --json name,state,bucket --jq '.[] | select(.bucket != "pass") | "\(.name): \(.state)"'
```

Expected: the only non-pass line is:

```text
Qwen provenance: failure
```

If any other check failed, stop and report it. Close the validation PR:

```bash
gh pr close --delete-branch
git switch main
git pull --ff-only origin main
```

- [ ] **Step 13: Perform final settings validation**

```bash
gh repo view --json visibility,homepageUrl,repositoryTopics,hasIssuesEnabled
gh api repos/hunghdvn/car-racing/branches/main/protection
gh workflow list
```

Expected:
- `visibility: public`;
- homepage set;
- seven topics present;
- issues enabled;
- branch protection has all four required checks and review rules;
- `qwen-policy.yml` active.

Report:
- the public repository URL;
- the final `main` SHA;
- the four commit SHAs from Tasks 1-4;
- the docs-only test PR number and pass result;
- the missing-attestation PR number and policy failure result;
- confirmation that private vulnerability reporting is checked in the UI.
