/**
 * Regression test for the dashboard-crash bug.
 *
 * When the team leader creates a project, the server's list endpoint
 * (GET /api/projects) didn't hydrate `assigned_name` — the SELECT in
 * listProjects had no JOIN with the users table. So every project card
 * rendered with `assigned_name: null`, ProjectCard called
 * `initials(project.assigned_name)` on that null, the local helper
 * defaulted the parameter to '' (default-arg semantics don't trigger on
 * `null`, only on `undefined`), then `.split(...)` threw and the
 * ErrorBoundary caught the whole dashboard.
 *
 * Two layers of defense:
 *   1. Server: listProjects now LEFT JOINs the assignee and hydrates
 *      `assigned_name` so unassigned projects return null and assigned
 *      ones return the designer's name. Smoke-tested via offline unit.
 *   2. Client: both `lib/utils.js#initials` and the local copy inside
 *      ProjectCard.jsx now guard against null / undefined / empty string
 *      and return '' instead of crashing.
 */
import { describe, expect, it } from 'vitest'
import { initials } from '@/lib/utils.js'

describe('initials() — null-safe', () => {
  it('returns "" for null (not undefined)', () => {
    expect(initials(null)).toBe('')
  })
  it('returns "" for undefined', () => {
    expect(initials(undefined)).toBe('')
  })
  it('returns "" for empty string', () => {
    expect(initials('')).toBe('')
  })
  it('returns "" for whitespace-only string', () => {
    expect(initials('   ')).toBe('')
  })
  it('returns up to two leading letters, uppercased', () => {
    expect(initials('Aylin Ulu')).toBe('AU')
    expect(initials('oğuz kağan')).toBe('OK') // tr-TR uppercase honour
    expect(initials('Aylin')).toBe('A')
  })
  it('ignores empty parts from double spaces', () => {
    expect(initials('Aylin  Ulu')).toBe('AU')
  })
})
