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
