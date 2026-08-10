import { nanoid } from 'nanoid'
import { badRequest, notFound } from '../domain/errors.js'

/**
 * Work log ("Çalışma Defteri") — what a person did today that isn't the
 * project they're assigned to. See migration 026__work_log.sql.
 *
 * Everything here is owner-scoped by `user_id` in the WHERE clause rather
 * than by a read-then-check, so a caller can never touch someone else's row
 * even if they guess an id.
 */

export const WORK_LOG_KINDS = ['baska_proje', 'toplanti', 'idari', 'egitim', 'diger']

export const WORK_LOG_MAX_BODY = 280

// How far back the history panel walks by default. Two working weeks is
// enough for "what was I doing when that project stalled?" without paging.
export const WORK_LOG_DEFAULT_DAYS = 14

const COLUMNS = `id, user_id, entry_date, kind, body, minutes, created_at, updated_at`

/**
 * Derived `daily_status` for the user payloads that used to read the 025
 * column: the most recent entry logged *today*. Kept as a single exported
 * SQL fragment so /auth/me, the session lookup, the X-User-Id fallback and
 * GET /users can't drift apart. `{alias}` is the users-table alias in the
 * surrounding query.
 */
export function dailyStatusSelect(alias = 'u') {
  return `(SELECT w.body
             FROM work_log_entries w
            WHERE w.user_id = ${alias}.id
              AND w.entry_date = CURRENT_DATE
            ORDER BY w.created_at DESC
            LIMIT 1) AS daily_status`
}

/** Same, but the whole of today's log as a JSON array (oldest → newest). */
export function workLogTodaySelect(alias = 'u') {
  return `COALESCE((SELECT json_agg(e ORDER BY e.created_at)
                      FROM (SELECT ${COLUMNS}
                              FROM work_log_entries w
                             WHERE w.user_id = ${alias}.id
                               AND w.entry_date = CURRENT_DATE) e),
                   '[]'::json) AS work_log_today`
}

/** The caller's own entries, newest day first, capped to `days` back. */
export async function listMine(pool, userId, days = WORK_LOG_DEFAULT_DAYS) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
       FROM work_log_entries
      WHERE user_id = $1
        AND entry_date > CURRENT_DATE - $2::int
      ORDER BY entry_date DESC, created_at DESC`,
    [userId, days],
  )
  return rows
}

export async function create(pool, userId, { kind, body, minutes }) {
  const text = body.trim()
  if (!text) badRequest('Boş bir kayıt eklenemez.')
  const { rows } = await pool.query(
    `INSERT INTO work_log_entries (id, user_id, entry_date, kind, body, minutes)
     VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [`wl-${nanoid(16)}`, userId, kind ?? 'diger', text.slice(0, WORK_LOG_MAX_BODY), minutes ?? null],
  )
  return rows[0]
}

/**
 * Patch one of the caller's own entries. Only the fields present in `patch`
 * move — COALESCE against the existing value keeps the statement to one
 * round-trip instead of a read-modify-write.
 */
export async function update(pool, userId, id, patch) {
  const text = typeof patch.body === 'string' ? patch.body.trim() : null
  if (text === '') badRequest('Boş bir kayıt kaydedilemez.')
  const { rows } = await pool.query(
    `UPDATE work_log_entries
        SET kind    = COALESCE($3, kind),
            body    = COALESCE($4, body),
            -- minutes is nullable and clearable, so it needs an explicit
            -- "did the caller mention it at all?" flag rather than COALESCE.
            minutes = CASE WHEN $5::boolean THEN $6::int ELSE minutes END,
            updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING ${COLUMNS}`,
    [
      id,
      userId,
      patch.kind ?? null,
      text ? text.slice(0, WORK_LOG_MAX_BODY) : null,
      Object.prototype.hasOwnProperty.call(patch, 'minutes'),
      patch.minutes ?? null,
    ],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  return rows[0]
}

export async function remove(pool, userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM work_log_entries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  if (!rowCount) notFound('Kayıt bulunamadı.')
  return true
}
