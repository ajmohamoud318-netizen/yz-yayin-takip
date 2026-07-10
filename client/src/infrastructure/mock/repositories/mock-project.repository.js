import { httpClient, getCurrentUserId } from '../../http/client.js'
import { PASS_KIND } from '../../../domain/index.js'
import { mockProjects, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound, badRequest } from '../helpers/errors.js'
import { uid } from '../helpers/id.js'
import { createProjectMapper } from '../../../application/mappers/project-mapper.js'
import {
  computeAdvance,
  computeApproval,
  computeRejection,
} from '../helpers/project-transitions.js'
import { buildReopenedProject } from '../helpers/project-passes.js'

/**
 * Project repository.
 *
 * After the 2026-07 split, this file is now purely a persistence layer:
 *   • find / persist
 *   • mockOrHttp wrapping
 *   • delegating to pure helpers for the transition state machine
 *     (project-transitions.js) and pass management (project-passes.js)
 *
 * The 680-line monster is gone — branching logic is in helpers, easy to
 * unit-test, and each public method here is short enough to read in one go.
 */
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

  function persistAt(idx, nextProject) {
    mockProjects[idx] = nextProject
    saveState()
    return { ...nextProject }
  }
  function appendHistory(project, entry) {
    return [...(project.history ?? []), entry]
  }

  // Lightweight pub-sub so the cross-aggregate use cases (orders, handovers)
  // can push a freshly-mutated project into the shared store without going
  // through a refetch — keeps the bell red-dots instant after a reassignment.
  const subscribers = new Set()
  function onProjectChanged(project) {
    for (const fn of subscribers) {
      try { fn(project) } catch { /* swallow subscriber errors */ }
    }
  }

  return {
    buildProjectDetail,
    normalizeProjectPayload,

    // Cross-aggregate use cases call this when they've just persisted a
    // mutation outside the normal CRUD/transition methods (e.g. order
    // reassignment, handover confirmation). Pages that mount a project store
    // can subscribe via projectRepo.subscribe(fn) to keep their cache live.
    onProjectChanged,
    subscribe(fn) {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },

    /* =====================================================================
     *  CRUD
     * =================================================================== */

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
          const merged = {
            ...mockProjects[idx],
            assignees: detail.assignees,
            assigned_name: detail.assigned_name ?? mockProjects[idx].assigned_name,
            subtasks: detail.subtasks,
            history: mockProjects[idx].history ?? detail.history,
          }
          return persistAt(idx, merged)
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
            pass_kind: PASS_KIND.FIRST_EDITION,
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
          return persistAt(idx, { ...mockProjects[idx], ...normalized })
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

    findProjectById(id) {
      const idx = findIndex(id)
      return idx === -1 ? null : mockProjects[idx]
    },

    assignDesigners(projectId, assigneeIds = []) {
      const idx = findIndex(projectId)
      if (idx === -1) return null
      const current = mockProjects[idx]
      const previousIds = (current.assignees ?? []).map((a) => a.id)
      const nextIds = Array.isArray(assigneeIds) ? assigneeIds : []
      const sameSet =
        previousIds.length === nextIds.length &&
        previousIds.every((id) => nextIds.includes(id))
      const normalized = normalizeProjectPayload({ assignees: nextIds }, current)
      // Preserve a rolling reassignment history on the current pass so the
      // original designer isn't lost when the leader swaps the team mid-order.
      const reassignmentLog = current.reassignment_log ?? []
      const log =
        sameSet
          ? reassignmentLog
          : [
              ...reassignmentLog,
              {
                id: uid('rl-'),
                at: new Date().toISOString(),
                previous_ids: previousIds,
                next_ids: nextIds,
              },
            ]
      return persistAt(idx, {
        ...current,
        ...normalized,
        reassignment_log: log,
      })
    },

    /* =====================================================================
     *  Transitions — delegate to the pure helpers in project-transitions.js
     * =================================================================== */

    advanceProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const actor = currentActor()
          const { project: next, history } = computeAdvance(mockProjects[idx], actor)
          if (!history) return { ...mockProjects[idx] }
          return persistAt(idx, {
            ...next,
            history: appendHistory(mockProjects[idx], history),
          })
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
          const actor = currentActor()
          const { project: next, history } = computeApproval(mockProjects[idx], actor)
          if (!history) return { ...mockProjects[idx] }
          return persistAt(idx, {
            ...next,
            history: appendHistory(mockProjects[idx], history),
          })
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
          // Rule: only the team leader may reject. The UI already hides the
          // action from everyone else, but the data layer is the real gate
          // (mirrors the future backend — never trust the client alone).
          if (currentActor()?.role !== 'team_leader') {
            badRequest('Yalnızca takım lideri reddedebilir.')
          }
          if (!reason || !reason.trim()) badRequest('Red sebebi zorunludur.')
          const { project: next, history } = computeRejection(
            mockProjects[idx],
            reason,
            revizeIds,
            target,
            { actorName: currentActorName() },
          )
          return persistAt(idx, {
            ...next,
            history: appendHistory(mockProjects[idx], history),
          })
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

    /* =====================================================================
     *  Pass (baskı) management — delegate to the pure helpers in
     *  project-passes.js. Only acts when the project is at satista.
     * =================================================================== */

    reopenForNewPass(projectId, opts = {}) {
      const idx = findIndex(projectId)
      if (idx === -1) notFound('Proje bulunamadı.')
      const { project: next, reopened } = buildReopenedProject(
        mockProjects[idx],
        buildProjectDetail,
        opts,
      )
      if (!reopened) return { ...mockProjects[idx], reopened: false }
      return persistAt(idx, next)
    },

    /**
     * One-time backfill: seed projects ship without a `history`, so the detail
     * used to fabricate one on every render. We generate it ONCE, tag each
     * entry `seeded: true` (this is imported, pre-system data — not
     * live-recorded), and freeze it into the store. After this, history is
     * canonical and append-only: every real demo/ozalit/approval/rejection
     * adds an untagged entry on top. Idempotent.
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
