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
