import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSafeMailConfig } from './mail.js'

/**
 * Production safety tests for the SMTP_HOST boot guard.
 *
 * Without `SMTP_HOST` set, services/mail.js falls back to a console
 * transport that prints the rendered message — and the rendered message
 * carries the opaque password-reset / invitation token. In dev that's
 * exactly what we want (copy the link out of the terminal). In
 * production that lands in `docker logs` for anyone with log access to
 * read.
 *
 * `assertSafeMailConfig()` is called from main() next to the
 * SEED_ON_BOOT production guard. These tests lock the three behaviours:
 * production without SMTP_HOST exits, production with SMTP_HOST boots,
 * and dev without SMTP_HOST boots (console transport still allowed).
 *
 * Pure-config tests — no DB, no SMTP server, no Fastify, no env
 * mutation. The guard reads `(smtpHost, nodeEnv)` with defaults from
 * the live config + env; tests pass explicit values to drive each
 * scenario without touching process.env or busting the config.js
 * module cache.
 */

/**
 * Wrap `process.exit` so the production guard's exit(1) returns to the
 * test instead of killing the runner. Records the requested code so the
 * test can assert it.
 */
function spyProcessExit() {
  const original = process.exit
  let exitCode = null
  process.exit = (code) => {
    exitCode = code
    // Throw so control unwinds out of assertSafeMailConfig() back into
    // the test. Without this, a real `process.exit(1)` would terminate
    // the runner mid-suite.
    throw new Error(`__process_exit_called_with_${code}__`)
  }
  return {
    get code() { return exitCode },
    restore() { process.exit = original },
  }
}

test('assertSafeMailConfig: refuses to boot in production without SMTP_HOST', () => {
  // Production + no SMTP_HOST. This is the misconfig the guard exists
  // to catch: every invitation + reset link would land in `docker
  // logs` and leak the next password-reset token.
  const spy = spyProcessExit()
  try {
    assert.throws(
      () => assertSafeMailConfig({ smtpHost: '', nodeEnv: 'production' }),
      /__process_exit_called_with_1__/,
    )
    assert.equal(spy.code, 1, 'process.exit must be called with 1')
  } finally {
    spy.restore()
  }
})

test('assertSafeMailConfig: loads normally in production with SMTP_HOST set', () => {
  // Production + SMTP_HOST set: the console fallback is bypassed
  // entirely (getTransport() builds a real SMTP transport), so the
  // guard must be silent and let boot continue.
  const spy = spyProcessExit()
  try {
    assertSafeMailConfig({
      smtpHost: 'smtp.resend.com',
      nodeEnv: 'production',
    }) // must not throw
    assert.equal(spy.code, null, 'process.exit must NOT be called')
  } finally {
    spy.restore()
  }
})

test('assertSafeMailConfig: loads normally in development without SMTP_HOST', () => {
  // Development + no SMTP_HOST: the console fallback is exactly what
  // dev wants (copy the invite link out of the terminal). The guard
  // must stay out of the way so dev keeps working without a mailpit.
  const spy = spyProcessExit()
  try {
    assertSafeMailConfig({
      smtpHost: '',
      nodeEnv: 'development',
    }) // must not throw
    assert.equal(spy.code, null, 'process.exit must NOT be called')
  } finally {
    spy.restore()
  }
})

test('assertSafeMailConfig: defaults match live config + env', () => {
  // The default behaviour at boot is identical to passing the live
  // config + env explicitly — `assertSafeMailConfig()` (no args) must
  // produce the same exit decision as the explicit form. Locks the
  // default-args path so a future refactor (e.g. swapping the config
  // abstraction) can't silently diverge the production call site.
  //
  // We use ONE non-throwing spy shared across both calls — a
  // throw-style spy would mask any disagreement, since the second call
  // would never run if the first exited. Both outcomes are valid
  // (test env ≠ production, so both stay silent; production-shaped
  // env, so both record 1); the invariant is just that they agree.
  const codes = []
  const originalExit = process.exit
  process.exit = (code) => {
    codes.push(code)
    // Do NOT throw — both calls must complete so we can compare.
  }
  try {
    assertSafeMailConfig()
    assertSafeMailConfig({
      smtpHost: process.env.SMTP_HOST ?? '',
      nodeEnv: process.env.NODE_ENV,
    })
    // codes[0]/codes[1] are either both undefined (silent) or both 1.
    // A divergence (one fires, the other doesn't) is the bug we're
    // guarding against.
    assert.equal(codes[0], codes[1], 'default and explicit-args paths must agree')
  } finally {
    process.exit = originalExit
  }
})