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
