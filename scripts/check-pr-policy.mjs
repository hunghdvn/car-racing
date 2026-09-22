import {
  evaluatePullRequestPolicy,
  MAX_CHANGED_FILES,
  REQUIRED_STATUS_CONTEXT,
} from './pr-policy.mjs'

const api = process.env.GITHUB_API_URL ?? 'https://api.github.com'
const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
const repository = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
const prNumber = process.env.PR_NUMBER
const prSha = process.env.PR_SHA
const prBody = process.env.PR_BODY ?? ''
const targetUrl = `${serverUrl}/${repository}/actions/workflows/qwen-policy.yml`

function requireConfig(name, value) {
  if (!value) throw new Error(`Missing required environment variable ${name}`)
}

function requestHeaders() {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json; api-version=2022-11-28',
    'user-agent': 'velocity-rush-qwen-policy',
    'content-type': 'application/json',
  }
}

async function fetchTotalChangedFiles() {
  const url = `${api}/repos/${repository}/pulls/${prNumber}`
  const response = await fetch(url, { headers: requestHeaders() })
  if (!response.ok) throw new Error(`Cannot read pull-request metadata (${response.status})`)

  const pr = await response.json()
  const total = pr ? pr.changed_files : undefined
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    throw new Error('Pull-request metadata is missing a valid changed_files total')
  }

  return total
}

async function fetchChangedFiles() {
  const files = []
  let page = 1

  while (true) {
    const url = `${api}/repos/${repository}/pulls/${prNumber}/files?per_page=100&page=${page}`
    const response = await fetch(url, { headers: requestHeaders() })
    if (!response.ok) throw new Error(`Cannot list pull-request files (${response.status})`)

    const batch = await response.json()
    if (!Array.isArray(batch) || batch.length === 0) break

    for (const entry of batch) files.push(entry.filename)
    if (files.length >= MAX_CHANGED_FILES || batch.length < 100) break
    page += 1
  }

  return files
}

async function collectChangedFiles() {
  const total = await fetchTotalChangedFiles()
  if (total <= MAX_CHANGED_FILES) return await fetchChangedFiles()
  return Array.from({ length: total }, (_, index) => `beyond-listed/file-${index}.md`)
}

async function postStatus(state, description) {
  const url = `${api}/repos/${repository}/statuses/${prSha}`
  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({
      state,
      context: REQUIRED_STATUS_CONTEXT,
      description: description.slice(0, 145),
      target_url: targetUrl,
    }),
  })

  if (!response.ok) throw new Error(`Cannot post the Qwen provenance status (${response.status})`)
}

requireConfig('GITHUB_REPOSITORY', repository)
requireConfig('GITHUB_TOKEN', token)
requireConfig('PR_NUMBER', prNumber)
requireConfig('PR_SHA', prSha)

try {
  const files = await collectChangedFiles()
  const result = evaluatePullRequestPolicy(prBody, files)
  await postStatus(result.pass ? 'success' : 'failure', result.description)
  console.log(`Qwen provenance: ${result.pass ? 'PASS' : 'FAIL'} — ${result.description}`)
  process.exitCode = result.pass ? 0 : 1
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown provenance policy failure'
  try {
    await postStatus('failure', message)
  } catch (statusError) {
    console.error(`Could not report provenance failure: ${String(statusError)}`)
  }
  console.error(`Qwen provenance policy error: ${message}`)
  process.exitCode = 1
}
