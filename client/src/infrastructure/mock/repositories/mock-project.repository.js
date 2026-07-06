import { httpClient, getCurrentUserId } from '../../http/client.js'
import {
  STAGE_PIPELINE,
  subtaskProgress,
  assertCanEnterProduction,
} from '../../../domain/index.js'
import { mockProjects, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound, badRequest } from '../helpers/errors.js'
import { uid } from '../helpers/id.js'
import { createProjectMapper } from '../../../application/mappers/project-mapper.js'

export function createMockProjectRepository(userRepo) {
  const { normalizeProjectPayload, buildProjectDetail } = createProjectMapper({
    findUserById: (id) => userRepo.findById(id),
    listUsers: () => userRepo.listRaw(),
  })

  function findIndex(id) {
    return mockProjects.findIndex((p) => p.id === id)
  }

  function currentActor() {
    return userRepo.findById(getCurrentUserId())
  }
  function currentActorName() {
    return currentActor()?.name ?? 'Bilinmeyen'
  }

  function appendHistory(p, entry) {
    return [...(p.history ?? []), entry]
  }

  return {
    buildProjectDetail,
    normalizeProjectPayload,

    listProjects() {
      return mockOrHttp(
        () =>
          mockProjects.map((p) => {
            if (Array.isArray(p.assignees) && p.assignees.length > 0) return { ...p }
            const resolved = userRepo
              .listRaw()
              .filter((u) => u.id === p.assigned_to)
              .map((u) => ({ id: u.id, name: u.name }))
            return { ...p, assignees: resolved }
          }),
        async () => {
          const { data } = await httpClient.get('/projects')
          return data
        },
      )
    },

    getProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const detail = buildProjectDetail(mockProjects[idx])
          mockProjects[idx] = {
            ...mockProjects[idx],
            assignees: detail.assignees,
            assigned_name: detail.assigned_name ?? mockProjects[idx].assigned_name,
            subtasks: detail.subtasks,
            history: mockProjects[idx].history ?? detail.history,
          }
          saveState()
          return detail
        },
        async () => {
          const { data } = await httpClient.get(`/projects/${id}`)
          return data
        },
      )
    },

    createProject(payload) {
      return mockOrHttp(
        () => {
          const normalized = normalizeProjectPayload(payload)
          const projectId = uid('p-')
          const now = new Date().toISOString()
          const created = {
            id: projectId,
            stage: 'tasarim',
            demo_attempt: 0,
            ozalit_attempt: 0,
            pass_number: 1,
            pass_kind: 'first_edition',
            passes: [],
            created_at: now,
            updated_at: now,
            ...normalized,
            history: [
              {
                id: `${projectId}-hc`,
                action: 'create',
                from_stage: null,
                to_stage: 'tasarim',
                done_by_name: 'Ayşenur Kanak',
                created_at: now,
                note: `${normalized.assigned_name} atandı`,
              },
            ],
          }
          mockProjects.push(created)
          saveState()
          return created
        },
        async () => {
          const { data } = await httpClient.post('/projects', payload)
          return data
        },
      )
    },

    updateProject(id, patch) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const normalized = normalizeProjectPayload(patch, mockProjects[idx])
          mockProjects[idx] = { ...mockProjects[idx], ...normalized }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.patch(`/projects/${id}`, patch)
          return data
        },
      )
    },

    deleteProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx >= 0) {
            mockProjects.splice(idx, 1)
            saveState()
          }
          return { ok: true }
        },
        async () => {
          await httpClient.delete(`/projects/${id}`)
        },
      )
    },

    advanceProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          const now = new Date().toISOString()

          // ── Ozalit-revision resubmit: when an ozalit was rejected back to the
          //    designer, the redesign resubmits straight to Ozalit Teslim (the
          //    demo was already approved — no need to re-demo). ────────────────
          if (p.stage === 'tasarim' && p.last_reject_type === 'ozalit') {
            assertCanEnterProduction('ozalit_teslim', p.progress)
            const entry = {
              id: uid(`${p.id}-h`),
              action: 'advance',
              from_stage: 'tasarim',
              to_stage: 'ozalit_teslim',
              done_by_name: currentActorName(),
              note: 'Ozalit revizyonu tamamlandı — matbaaya gönderildi',
              created_at: now,
            }
            mockProjects[idx] = {
              ...p,
              stage: 'ozalit_teslim',
              last_reject_type: null,
              last_reject_reason: null,
              reject_target: null,
              // The resubmit IS the ozalit request — hand it straight to the
              // matbaa, no separate "Ozalit İste" step needed.
              ozalit_requested: true,
              updated_at: now,
              history: appendHistory(p, entry),
            }
            saveState()
            return { ...mockProjects[idx] }
          }

          // ── Ozalit Teslim is a two-step matbaa handoff (mirrors the demo):
          //    1. the leader/designer "Ozalit İster" → the request is handed to
          //       the matbaa (stays at Ozalit Teslim, ozalit_requested = true);
          //    2. the matbaa "Teslim Eder" → advances to Ozalit Onay.
          //    A reject-to-matbaa (reject_target) skips step 1 — the matbaa just
          //    re-delivers. ──────────────────────────────────────────────────
          if (p.stage === 'ozalit_teslim') {
            const actor = currentActor()
            const isPrinter = actor?.role === 'printer'
            const matbaaLock = p.reject_target === 'matbaa'

            if (!isPrinter) {
              // Leader / designer requesting the ozalit from the matbaa.
              if (p.ozalit_requested) badRequest('Ozalit zaten istendi — matbaa teslimi bekleniyor.')
              const entry = {
                id: uid(`${p.id}-h`),
                action: 'advance',
                from_stage: 'ozalit_teslim',
                to_stage: 'ozalit_teslim',
                done_by_name: actor?.name ?? currentActorName(),
                note: 'Ozalit istendi — matbaa teslimi bekleniyor',
                created_at: now,
              }
              mockProjects[idx] = { ...p, ozalit_requested: true, updated_at: now, history: appendHistory(p, entry) }
              saveState()
              return { ...mockProjects[idx] }
            }

            // Matbaa delivers → advance to Ozalit Onay (needs a prior request,
            // unless it's a re-delivery after a reject-to-matbaa).
            if (!p.ozalit_requested && !matbaaLock) {
              badRequest('Önce ekip lideri veya tasarımcı ozalit istemelidir.')
            }
            assertCanEnterProduction('ozalit_onay', p.progress)
            const entry = {
              id: uid(`${p.id}-h`),
              action: 'advance',
              from_stage: 'ozalit_teslim',
              to_stage: 'ozalit_onay',
              done_by_name: actor?.name ?? currentActorName(),
              note: 'Ozalit teslim edildi — onaya gönderildi',
              created_at: now,
            }
            mockProjects[idx] = {
              ...p,
              stage: 'ozalit_onay',
              ozalit_requested: false,
              reject_target: null,
              updated_at: now,
              history: appendHistory(p, entry),
            }
            saveState()
            return { ...mockProjects[idx] }
          }

          const pipeline = p.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
          const i = pipeline.indexOf(p.stage)
          if (i === -1 || i === pipeline.length - 1) return { ...p }
          const next = pipeline[i + 1]
          // Satışta is reached ONLY when Sales confirms Matbaa's handover
          // ("Alındı") — never by a plain forward advance. Block it here so the
          // generic advance can't skip the teslim flow (TR: uretimde→satista,
          // ÇİN: gumruk→satista).
          if (next === 'satista') {
            badRequest('Satışta aşamasına yalnızca Satış ekibi teslimi onayladığında geçilir.')
          }
          assertCanEnterProduction(next, p.progress)
          const entry = {
            id: uid(`${p.id}-h`),
            action: 'advance',
            from_stage: p.stage,
            to_stage: next,
            done_by_name: currentActorName(),
            created_at: now,
          }
          // Advancing forward releases any matbaa-only teslim lock from a reject
          // and clears the stale reject banner (the demo resubmit path lands here;
          // only the ozalit resubmit path cleared these before, so a demo redesign
          // used to keep showing its old reject reason/label).
          mockProjects[idx] = {
            ...p,
            stage: next,
            reject_target: null,
            last_reject_reason: null,
            last_reject_type: null,
            updated_at: now,
            history: appendHistory(p, entry),
          }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/advance`)
          return data
        },
      )
    },

    approveProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          const now = new Date().toISOString()

          // ── Ozalit dual sign-off: the team leader approves first, then the
          //    assigned designer. Only the second (designer) approval advances
          //    the project into production. ────────────────────────────────
          if (p.stage === 'ozalit_onay') {
            const actor = currentActor()
            const role = actor?.role

            if (!p.ozalit_leader_approved) {
              // First approval — must be the team leader. Stays at ozalit_onay.
              if (role !== 'team_leader') {
                badRequest('Ozalit önce ekip lideri tarafından onaylanmalıdır.')
              }
              const entry = {
                id: uid(`${p.id}-h`),
                action: 'approve',
                from_stage: 'ozalit_onay',
                to_stage: 'ozalit_onay',
                done_by_name: actor?.name ?? currentActorName(),
                note: 'Ozalit — ekip lideri onayladı, tasarımcı onayı bekleniyor',
                created_at: now,
              }
              mockProjects[idx] = {
                ...p,
                ozalit_leader_approved: true,
                ozalit_leader_approved_by: actor?.name ?? null,
                ozalit_leader_approved_at: now,
                updated_at: now,
                history: appendHistory(p, entry),
              }
              saveState()
              return { ...mockProjects[idx] }
            }

            // Designer approvals — EVERY assigned designer must approve (after
            // the leader) before it moves to production.
            const assigneeIds = (p.assignees ?? []).map((a) => a.id)
            const isAssignedDesigner = role === 'designer' && assigneeIds.includes(actor.id)
            if (!isAssignedDesigner) {
              badRequest('Ekip lideri onayladı — sıradaki onay atanmış tasarımcı(lar)dan gelmelidir.')
            }
            const approvedSet = new Set(p.ozalit_designer_approvals ?? [])
            if (approvedSet.has(actor.id)) {
              badRequest('Bu ozaliti zaten onayladınız.')
            }
            approvedSet.add(actor.id)
            const approvals = [...approvedSet]
            const allApproved = assigneeIds.length > 0 && assigneeIds.every((did) => approvedSet.has(did))

            if (allApproved) {
              // Last designer — advance to production and clear all sign-off state.
              assertCanEnterProduction('uretime_hazir', p.progress)
              const entry = {
                id: uid(`${p.id}-h`),
                action: 'approve',
                from_stage: 'ozalit_onay',
                to_stage: 'uretime_hazir',
                done_by_name: actor?.name ?? currentActorName(),
                note: 'Ozalit — tüm tasarımcılar onayladı, üretime alındı',
                created_at: now,
              }
              mockProjects[idx] = {
                ...p,
                stage: 'uretime_hazir',
                ozalit_leader_approved: false,
                ozalit_leader_approved_by: null,
                ozalit_leader_approved_at: null,
                ozalit_designer_approvals: [],
                updated_at: now,
                history: appendHistory(p, entry),
              }
              saveState()
              return { ...mockProjects[idx] }
            }

            // More designers still need to approve — record and stay put.
            const remaining = assigneeIds.length - approvals.length
            const entry = {
              id: uid(`${p.id}-h`),
              action: 'approve',
              from_stage: 'ozalit_onay',
              to_stage: 'ozalit_onay',
              done_by_name: actor?.name ?? currentActorName(),
              note: `Ozalit — ${actor?.name ?? 'tasarımcı'} onayladı, ${remaining} tasarımcı onayı bekleniyor`,
              created_at: now,
            }
            mockProjects[idx] = {
              ...p,
              ozalit_designer_approvals: approvals,
              updated_at: now,
              history: appendHistory(p, entry),
            }
            saveState()
            return { ...mockProjects[idx] }
          }

          // ── Generic approval: advance to the next pipeline stage. ─────────
          const pipeline = p.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
          const i = pipeline.indexOf(p.stage)
          if (i === -1 || i === pipeline.length - 1) return { ...p }
          const next = pipeline[i + 1]
          assertCanEnterProduction(next, p.progress)
          const entry = {
            id: uid(`${p.id}-h`),
            action: 'approve',
            from_stage: p.stage,
            to_stage: next,
            done_by_name: currentActorName(),
            created_at: now,
          }
          mockProjects[idx] = { ...p, stage: next, updated_at: now, history: appendHistory(p, entry) }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/approve`)
          return data
        },
      )
    },

    rejectProject(id, reason, revizeIds = [], target = 'designer') {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          // Rule: only the team leader may reject a demo/ozalit. The UI already
          // hides the reject action from everyone else, but the data layer is the
          // real gate (mirrors the future backend — never trust the client alone).
          if (currentActor()?.role !== 'team_leader') {
            badRequest('Yalnızca takım lideri reddedebilir.')
          }
          // Rule: every rejection must carry a written reason.
          if (!reason || !reason.trim()) badRequest('Red sebebi zorunludur.')
          const isOzalit = p.stage === 'ozalit_onay'
          const nowIso = new Date().toISOString()

          // The leader routes the rejection to whoever must fix it:
          //   • target 'designer' → back to Tasarım for a redesign; the chosen
          //     alt görevler are flagged for revision (progress drops).
          //   • target 'matbaa'   → back to the teslim step to re-deliver; the
          //     design is untouched. For ozalit this locks Ozalit Teslim to the
          //     matbaa (reject_target) so only they can re-send.
          //
          // The teslim stage is derived from the project's OWN pipeline (the step
          // feeding the current *_onay stage) so it can never point at a stage
          // that doesn't exist for its type. ÇİN demos have no matbaa re-delivery
          // step — only TR does — so a matbaa reject on a ÇİN project safely
          // collapses to a normal designer reject (→ Tasarım), never stranding it.
          const pipeline = p.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
          const stageIdx = pipeline.indexOf(p.stage)
          const teslimStage = stageIdx > 0 ? pipeline[stageIdx - 1] : 'tasarim'
          const toMatbaa =
            target === 'matbaa' && p.type === 'TR' && teslimStage.endsWith('_teslim')
          const toStage = toMatbaa ? teslimStage : 'tasarim'

          const entry = {
            id: uid(`${p.id}-h`),
            action: 'reject',
            from_stage: p.stage,
            to_stage: toStage,
            done_by_name: currentActorName(),
            reason,
            reject_target: target,
            created_at: nowIso,
          }

          const base = {
            ...p,
            stage: toStage,
            last_reject_reason: reason,
            last_reject_type: isOzalit ? 'ozalit' : 'demo',
            last_reject_target: target,
            // Lock the teslim step to the matbaa only when they were the target.
            reject_target: toMatbaa ? 'matbaa' : null,
            // A fresh ozalit request is needed after any rejection.
            ozalit_requested: false,
            updated_at: nowIso,
            history: appendHistory(p, entry),
            // Any pending ozalit sign-off (leader + designers) is void once rejected.
            ...(isOzalit
              ? {
                  ozalit_leader_approved: false,
                  ozalit_leader_approved_by: null,
                  ozalit_leader_approved_at: null,
                  ozalit_designer_approvals: [],
                }
              : {}),
          }

          // Correct attempt counter for the stage that was rejected.
          const counter = isOzalit
            ? { ozalit_attempt: (p.ozalit_attempt ?? 0) + 1 }
            : { demo_attempt: (p.demo_attempt ?? 0) + 1 }

          if (toMatbaa) {
            // Matbaa re-delivers — design/subtasks/progress untouched.
            mockProjects[idx] = { ...base, ...counter }
          } else {
            // Designer redesign — flag the chosen subtasks, drop their progress.
            const selected = new Set(revizeIds)
            const baseSubs = (p.subtasks ?? []).filter((s) => s.kind !== 'revize')
            const updatedSubs = baseSubs.map((s) => {
              const needs = selected.has(s.id)
              if (s.kind === 'pages') {
                return needs
                  ? { ...s, needs_revize: true, pages_done: 0, is_done: false }
                  : { ...s, needs_revize: false, pages_done: s.total_pages ?? s.pages_done ?? 0, is_done: true }
              }
              return needs
                ? { ...s, needs_revize: true, is_done: false, done_at: null }
                : { ...s, needs_revize: false, is_done: true, done_at: s.done_at ?? nowIso }
            })
            mockProjects[idx] = {
              ...base,
              ...counter,
              subtasks: updatedSubs,
              progress: subtaskProgress(updatedSubs),
            }
          }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/reject`, {
            reason,
            revize_ids: revizeIds,
            target,
          })
          return data
        },
      )
    },


    findProjectById(id) {
      const idx = findIndex(id)
      return idx === -1 ? null : mockProjects[idx]
    },

    /**
     * Set the designer(s) on a project (its current pass). Used when the team
     * leader assigns a sales/reprint check to the original designer(s) or a
     * different one. Synchronous helper for use inside cross-aggregate use cases.
     * @param {string} projectId
     * @param {string[]} assigneeIds
     */
    assignDesigners(projectId, assigneeIds = []) {
      const idx = findIndex(projectId)
      if (idx === -1) return null
      const normalized = normalizeProjectPayload({ assignees: assigneeIds }, mockProjects[idx])
      mockProjects[idx] = { ...mockProjects[idx], ...normalized }
      saveState()
      return { ...mockProjects[idx] }
    },

    /**
     * One-time backfill: seed projects ship without a `history`, so detail used
     * to fabricate one on every render (with shifting timestamps). Here we
     * generate it ONCE, tag each entry `seeded: true` (this is imported,
     * pre-system data — not live-recorded), and freeze it into the store.
     * After this, history is canonical and append-only: every real demo,
     * ozalit, approval, and rejection adds an untagged entry on top.
     * Idempotent — only fills projects that have no history yet.
     */
    backfillHistories() {
      let changed = false
      for (let i = 0; i < mockProjects.length; i++) {
        const p = mockProjects[i]
        if (Array.isArray(p.history)) continue
        const detail = buildProjectDetail(p)
        const seeded = (detail.history ?? []).map((h) => ({ ...h, seeded: true }))
        mockProjects[i] = { ...p, history: seeded }
        changed = true
      }
      if (changed) saveState()
    },

    /**
     * Open a new pass on a finished (satışta) book — the core of Pass 2.
     * Archives the just-completed pass into `passes[]` and resets the project
     * to a fresh pass resting at `uretime_hazir` (production-ready), ready for
     * the sales/order workflow to drive it through again.
     *
     * Only acts when the project is at `satista`; otherwise it's a no-op so the
     * first sale of a production-ready book stays on the same (first) pass.
     *
     * @param {string} projectId
     * @param {{ kind?: 'reprint'|'redesign', trigger?: {by_id?,by_name?,by_role?,order_id?,note?} }} opts
     */
    reopenForNewPass(projectId, { kind = 'reprint', trigger = {} } = {}) {
      const idx = findIndex(projectId)
      if (idx === -1) notFound('Proje bulunamadı.')
      const p = mockProjects[idx]

      // Only a finished book loops back. Anything else: leave as-is.
      if (p.stage !== 'satista') return { ...p, reopened: false }

      const now = new Date().toISOString()

      // Materialize history so the archived pass keeps a real timeline.
      const history = p.history ?? buildProjectDetail(p).history
      const subtasks = p.subtasks ?? buildProjectDetail(p).subtasks

      const closingNumber = p.pass_number ?? 1
      const archivedPass = {
        number: closingNumber,
        kind: p.pass_kind ?? (closingNumber === 1 ? 'first_edition' : 'reprint'),
        stage_reached: 'satista',
        demo_attempt: p.demo_attempt ?? 0,
        ozalit_attempt: p.ozalit_attempt ?? 0,
        assignees: p.assignees ?? [],
        subtasks,
        history,
        opened_at: p.pass_opened_at ?? p.created_at ?? null,
        closed_at: now,
      }

      const newNumber = closingNumber + 1
      const reopenEntry = {
        id: uid(`${p.id}-hreopen`),
        action: 'reopen',
        from_stage: 'satista',
        to_stage: 'uretime_hazir',
        done_by_name: trigger.by_name ?? 'Esra Kılıç',
        created_at: now,
        pass_number: newNumber,
        pass_kind: kind,
        order_id: trigger.order_id ?? null,
        note:
          trigger.note ??
          `${newNumber}. baskı için yeni tur açıldı — ${trigger.by_name ?? 'Satış'} talebi`,
      }

      mockProjects[idx] = {
        ...p,
        stage: 'uretime_hazir',
        pass_number: newNumber,
        pass_kind: kind,
        pass_opened_at: now,
        // Fresh checkpoint counters for the new run.
        demo_attempt: 0,
        ozalit_attempt: 0,
        last_reject_reason: null,
        last_reject_type: null,
        // Reprint keeps the existing (completed) design — progress stays 100.
        progress: 100,
        passes: [...(p.passes ?? []), archivedPass],
        // New pass starts its own timeline.
        history: [reopenEntry],
        updated_at: now,
      }
      saveState()
      return { ...mockProjects[idx], reopened: true }
    },

    recordOrderHistory(projectId, { orderId, actorName, fromStage, toStage, note }) {
      const pidx = findIndex(projectId)
      if (pidx === -1) return
      const p = mockProjects[pidx]
      if (!p.history) {
        const detail = buildProjectDetail(p)
        mockProjects[pidx] = { ...mockProjects[pidx], history: detail.history }
      }
      mockProjects[pidx] = {
        ...mockProjects[pidx],
        ...(toStage !== fromStage ? { stage: toStage } : {}),
        history: [
          ...(mockProjects[pidx].history ?? []),
          {
            id: uid('oh-proj-'),
            action: 'order',
            order_id: orderId,
            from_stage: fromStage,
            to_stage: toStage,
            done_by_name: actorName,
            created_at: new Date().toISOString(),
            note,
          },
        ],
      }
      saveState()
    },
  }
}
