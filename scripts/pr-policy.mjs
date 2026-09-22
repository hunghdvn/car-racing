export const QWEN_MODEL_ID = 'Qwen3.8-flash-next'
export const CODE_ATTESTATION = `- [x] I confirm that all code changes in this pull request were authored by ${QWEN_MODEL_ID}.`
export const MODEL_ID_FIELD = `- Model ID: ${QWEN_MODEL_ID}`
export const DOCS_ONLY_DECLARATION = '- [x] This pull request changes documentation/content only.'
export const REQUIRED_STATUS_CONTEXT = 'Qwen provenance'
export const MAX_CHANGED_FILES = 300

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
    return { pass: false, description: 'Pull request is too large for reliable provenance classification' }
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
