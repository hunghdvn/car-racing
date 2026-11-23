/* Hand-written types for scripts/check-pr-policy.mjs (R3-4: tests typecheck).
 * Mirrors the runtime signature runPolicy({ env, fetcher, log }). */

export interface PolicyFetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export interface PolicyRunOptions {
  env: Record<string, string | undefined>
  fetcher?: (url: string, init?: Record<string, unknown>) => Promise<PolicyFetchResponse>
  log?: { log: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}

export declare function runPolicy(options?: PolicyRunOptions): Promise<number>
