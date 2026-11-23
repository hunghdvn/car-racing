/* Hand-written types for scripts/pr-policy.mjs (R3-4: the tests typecheck
 * gate compiles tests/, which import this module; the runtime is plain ESM,
 * these declarations mirror its exported shape). */

export declare const QWEN_MODEL_ID: string
export declare const CODE_ATTESTATION: string
export declare const MODEL_ID_FIELD: string
export declare const DOCS_ONLY_DECLARATION: string
export declare const REQUIRED_STATUS_CONTEXT: string
export declare const MAX_CHANGED_FILES: number
export declare const OVERSIZED_DESCRIPTION: string

export interface PolicyVerdict {
  pass: boolean
  description: string
}

export declare function evaluatePullRequestPolicy(
  body: string, files: readonly string[],
): PolicyVerdict
