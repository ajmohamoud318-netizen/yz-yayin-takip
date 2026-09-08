import { httpClient } from '../client.js'
import { PASS_KIND } from '../../../domain/index.js'
import { notFound, badRequest } from '../../shared/errors.js'
import { createProjectMapper } from '../../../application/mappers/project-mapper.js'

/**
 * HTTP project repo. Keeps a tiny in-memory `subscribers` set + cache
 * so cross-aggregate use cases (orders/handovers) can subscribe and
 * `findProjectById` works between list refreshes.
 */
export function createHttpProjectRepository(userRepo) {
  const cache = new Map()
  const subscribers = new Set()

  function onProjectChanged(project) {
    if (project?.id) cache.set(project.id, project)
    for (const fn of subscribers) {
      try { fn(project) } catch { /* swallow */ }
    }
  }

  function subscribe(fn) {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  }

  const { normalizeProjectPayload, buildProjectDetail } = createProjectMapper({
    findUserById: (id) => userRepo.findById(id),
    listUsers: () => userRepo.listRaw(),
  })

  async function refresh(id) {
    const { data } = await httpClient.get(`/projects/${id}`)
    cache.set(data.id, data)
    return data
  }

  return {
    buildProjectDetail,
    normalizeProjectPayload,
    onProjectChanged,
    subscribe,

    findProjectById(id) {
      return cache.get(id) ?? null
    },

    assignDesigners(projectId, assigneeIds = []) {
      // Server-side patch is what actually mutates the row. We update the
      // cache synchronously so the cross-aggregate use case (which asked us)
      // sees a consistent shape immediately. The async network call happens
      // out-of-band; errors there surface via the next list refresh.
      const before = cache.get(projectId)
      if (!before) return null
      const next = { ...before, assigned_to: assigneeIds[0] }
      cache.set(projectId, next)
      onProjectChanged(next)
      void httpClient.patch(`/projects/${projectId}`, { assigned_to: assigneeIds[0] })
        .then(({ data }) => { if (data) cache.set(projectId, data) })
        .catch(() => { /* ignore — list refresh will reconcile */ })
      return next
    },

    recordOrderHistory(projectId, entry) {
      // Server already inserted a row in the orders route. We treat this
      // as a no-op signal that emits to subscribers so the bell can refresh.
      const p = cache.get(projectId)
      if (p) onProjectChanged(p)
      return { ...p }
    },

    async listProjects() {
      const { data } = await httpClient.get('/projects')
      for (const p of data) cache.set(p.id, p)
      return data
    },
    async getProject(id) {
      if (!id) notFound('Proje bulunamadı.')
      return refresh(id)
    },
    async createProject(payload) {
      const flat = normalizeProjectPayload(payload)
      // Forward the mapper-normalised subtasks. The server's JSON schema
      // requires each subtask to carry `kind` (and total_pages /
      // total_stickers for the numeric kinds) — the mapper already
      // produces the right shape, so we just hand it over instead of
      // re-flattening to bare titles (which the schema rejects with 400).
      // Per-subtask designer overrides travel in the top-level
      // `subtaskAssignees` map (server reads it back into the subtasks
      // table), NOT inside each subtask object — the projectsCreate
      // schema explicitly forbids additional properties on subtasks.
      const subtasks = (flat.subtasks ?? []).map((s) => ({
        title: s.title,
        kind: s.kind ?? 'check',
        total_pages: s.total_pages ?? null,
        total_stickers: s.total_stickers ?? null,
      }))
      // The NewProjectDialog seeds `subtaskAssignees` with empty strings
      // for every library key ("" means "inherit from the project").
      // The server's schema requires every value in this map to have
      // `minLength: 1`, so an empty-string entry 400s the request
      // (`body/subtaskAssignees/kapak must NOT have fewer than 1
      // characters`). Strip the empty entries before posting — the
      // server's `??` fallback then resolves each subtask to the
      // project primary assignee.
      const subtaskAssignees = Object.fromEntries(
        Object.entries(payload.subtaskAssignees ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0),
      )
      const { data } = await httpClient.post('/projects', {
        title: flat.title,
        type: flat.type,
        target_month: flat.target_month,
        pass_kind: flat.pass_kind ?? PASS_KIND.FIRST_EDITION,
        assigned_to: flat.assigned_to,
        // Forward the multi-designer array too so the server can map it to
        // the project primary + per-subtask overrides.
        assignees: Array.isArray(payload.assignees) ? payload.assignees : undefined,
        ...(Object.keys(subtaskAssignees).length > 0
          ? { subtaskAssignees }
          : {}),
        subtasks,
        // Optional recipe shells (Ana / Kutu / Kılavuz) derived by
        // NewProjectDialog from the leader's subtask selection. The server
        // seeds them inside the same transaction as the project so the
        // project lands on disk with its parça spec already attached.
        // `normalizeProjectPayload` lets unknown top-level keys through via
        // `...rest`, so `payload.productInfo` survives untouched.
        ...(Array.isArray(payload.productInfo) && payload.productInfo.length > 0
          ? { productInfo: payload.productInfo }
          : {}),
      })
      cache.set(data.id, data)
      return data
    },
    /**
     * Import backlist/kayıt products (see AGENTS.md → "Kayıtlı ürünler (legacy)
     * products"). Each item is `{ id?, title, type, stage?, components? }`;
     * the server creates them at a finished stage with `origin: 'legacy'`.
     *
     * Pass `dryRun: true` to get the counts back ({ willCreate, duplicates,
     * missingProductInfo, errors }) without writing anything.
     */
    async importProjects(items, { dryRun = false } = {}) {
      const { data } = await httpClient.post('/projects/import', { items, dryRun })
      for (const p of data?.created ?? []) cache.set(p.id, p)
      return data
    },
    async updateProject(id, patch) {
      // Mirror `createProject`: the NewProjectDialog sends the same
      // un-normalised payload for create AND edit, so we have to map it
      // through `normalizeProjectPayload` to translate the SPA's
      // convenience keys (`assignees`, `subtasks`, `pageCount`,
      // `stickerCount`, `subtaskAssignees`) into the server's real
      // columns / endpoints.
      //
      // Without this, the raw PATCH would only persist title / type /
      // target_month — silently dropping subtask changes. That was the
      // pre-bugfix behaviour too (the server then 500'd on the unknown
      // column), so this is a long-standing gap finally plugged.
      const cached = cache.get(id)
      const flat = normalizeProjectPayload(patch, cached)
      // 1) Save scalar project fields (title / type / target_month / assigned_to).
      const patchBody = {
        title: flat.title,
        type: flat.type,
        target_month: flat.target_month,
        assigned_to: flat.assigned_to,
      }
      const { data } = await httpClient.patch(`/projects/${id}`, patchBody)
      // 2) If the payload mentions subtasks, pageCount or stickerCount,
      //    sync them through the dedicated subtasks endpoint so the
      //    `subtasks` table actually reflects the change.
      const wantsSubtasks =
        Array.isArray(patch.subtasks) ||
        'pageCount' in patch ||
        'stickerCount' in patch ||
        'subtaskAssignees' in patch
      if (wantsSubtasks) {
        // Persist per-subtask designer overrides too — without this the
        // server would replace each subtask with no `assigned_to`, and the
        // team leader's "Kapak → Rahşan, Kutu → Aylin" mapping would be
        // silently dropped on every save.
        const subtasks = (flat.subtasks ?? []).map((s) => ({
          title: s.title,
          kind: s.kind ?? 'check',
          total_pages: s.total_pages ?? null,
          total_stickers: s.total_stickers ?? null,
          is_done: !!s.is_done,
          assigned_to: s.assigned_to ?? null,
        }))
        const putRes = await httpClient.put(`/projects/${id}/subtasks`, {
          // Mirror the leader's full assignee list so the route can run
          // its orphan-designer check. Without this the leader could
          // add a designer via the chip-grid picker and forget to drop
          // them onto a subtask, leaving someone in the project's
          // assignees but on no work.
          assignees: Array.isArray(flat.assignees)
            ? flat.assignees.map((a) => a.id)
            : undefined,
          subtasks,
        })
        cache.set(id, putRes.data.project ?? putRes.data)
        return putRes.data.project ?? putRes.data
      }
      cache.set(id, data)
      return data
    },
    async deleteProject(id) {
      await httpClient.delete(`/projects/${id}`)
      cache.delete(id)
      return { ok: true }
    },
    async listDeletedProjects() {
      const { data } = await httpClient.get('/projects/deleted')
      return data
    },
    async restoreProject(id) {
      const { data } = await httpClient.post(`/projects/${id}/restore`, {})
      cache.set(id, data)
      return data
    },
    // Delist ("kaldır") a product from the Ürünler catalog, or re-list it.
    // `hidden` is sent explicitly rather than toggled server-side so a retry
    // can't flip the product back into the catalog.
    async setProductCatalogHidden(id, hidden) {
      const { data } = await httpClient.post(`/projects/${id}/catalog`, { hidden: !!hidden })
      cache.set(id, data)
      return data
    },
    // `route` ('ozalit' | 'ekran') is the post-revize ozalit choice
    // (migration 061) — physical round via the matbaa, or an Ekran Ozalit
    // straight to the leader. The server refuses it on any other advance, so
    // it is only ever sent when the dialog actually offered the choice.
    async advanceProject(id, route = null) {
      const { data } = await httpClient.post(`/projects/${id}/advance`, route ? { route } : {})
      cache.set(id, data)
      return data
    },
    // Per-parça approval (migrations 068/069/070): `parcalar` is the list of
    // parça names the leader is signing off on THIS click. null/omitted =
    // "approve all still-pending parçalar on this round" (the bulk shortcut).
    // The server resolves the snapshot's `_selectedComponents` independently
    // via its prepare hook, so the client only forwards the leader's subset.
    async approveProject(id, parcalar = null) {
      const cached = cache.get(id)
      if (!cached) badRequest('Proje bilinmiyor, listeyi yenileyin.')
      // snapshotKind lets the prepare hook read the right snapshot: 'demo'
      // for demo_onay, 'ozalit' for ozalit_onay (and ekran), 'baski_onay'
      // for baski_onay.
      const snapshotKind = pickSnapshotKind(cached.stage)
      const body = { stage: cached.stage, parcalar, snapshotKind }
      const { data } = await httpClient.post(`/projects/${id}/approve`, body)
      cache.set(id, data)
      return data
    },
    // Mark a delivered demo "Teslim Alındı" (received) — the gate before Onay.
    async receiveDemo(id) {
      const { data } = await httpClient.post(`/projects/${id}/receive`, {})
      cache.set(id, data)
      return data
    },
    // Report that a delivered demo never reached the leader/designer — sends
    // it back to the matbaa for redelivery.
    async reportDemoNotReceived(id) {
      const { data } = await httpClient.post(`/projects/${id}/demo-not-received`, {})
      cache.set(id, data)
      return data
    },
    // Mark a delivered ozalit "Teslim Alındı" — the gate before Ozalit Onayı.
    async receiveOzalit(id) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-receive`, {})
      cache.set(id, data)
      return data
    },
    // Report that a delivered ozalit never reached the leader/designer —
    // sends it back to the matbaa for redelivery.
    async reportOzalitNotReceived(id) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-not-received`, {})
      cache.set(id, data)
      return data
    },
    // Matbaa marks they've begun physical work on the demo/ozalit — flag
    // only, no stage change. Once set, a cancel/edit needs the change-request
    // accept/decline flow below (migration 048).
    async markDemoStarted(id) {
      const { data } = await httpClient.post(`/projects/${id}/demo-start`, {})
      cache.set(id, data)
      return data
    },
    async markOzalitStarted(id) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-start`, {})
      cache.set(id, data)
      return data
    },
    // Cancel a mistaken demo/ozalit request outright — back to tasarim,
    // without bumping demo_attempt/ozalit_attempt. Only valid before the
    // matbaa has started.
    async cancelDemoRequest(id) {
      const { data } = await httpClient.post(`/projects/${id}/demo-cancel`, {})
      cache.set(id, data)
      return data
    },
    async cancelOzalitRequest(id) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-cancel`, {})
      cache.set(id, data)
      return data
    },
    // Notify the matbaa that a still-in-flight demo/ozalit form was edited.
    // Same free-edit window as cancel; logs history + pings printers only,
    // no project fields change.
    // The corrected sheet is SENT here rather than pre-written through
    // POST /demos, so the route can insert it in the same transaction that
    // authorizes it — a refusal ("matbaa başladı") must leave no snapshot
    // behind. The route stamps the row it created onto the timeline entry
    // (migration 052) so a later correction of the same round, which reuses
    // the attempt slot, can't shadow this one's sheet.
    async notifyDemoEdit(id, { attempt, payload } = {}) {
      const { data } = await httpClient.post(`/projects/${id}/demo-edit-notify`, { attempt, payload })
      cache.set(id, data)
      return data
    },
    async notifyOzalitEdit(id, { attempt, payload } = {}) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-edit-notify`, { attempt, payload })
      cache.set(id, data)
      return data
    },
    // Ask the matbaa to accept a cancel/edit once they've started work.
    async requestDemoChange(id, note) {
      const { data } = await httpClient.post(`/projects/${id}/demo-change-request`, { note })
      cache.set(id, data)
      return data
    },
    async requestOzalitChange(id, note) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-change-request`, { note })
      cache.set(id, data)
      return data
    },
    // Matbaa's answer to a pending change-request.
    async acceptDemoChangeRequest(id) {
      const { data } = await httpClient.post(`/projects/${id}/demo-change-accept`, {})
      cache.set(id, data)
      return data
    },
    async declineDemoChangeRequest(id) {
      const { data } = await httpClient.post(`/projects/${id}/demo-change-decline`, {})
      cache.set(id, data)
      return data
    },
    async acceptOzalitChangeRequest(id) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-change-accept`, {})
      cache.set(id, data)
      return data
    },
    async declineOzalitChangeRequest(id) {
      const { data } = await httpClient.post(`/projects/${id}/ozalit-change-decline`, {})
      cache.set(id, data)
      return data
    },
    // Mark the Baskı Onay Formu "hazırlandı" — the dual-approval gate: any
    // team leader may prepare it, but only notifies OTHER team leaders that
    // approval is now needed (see computeApproval's baski_onay branch).
    // Per-parça payload (migration 070): the leader picks which parçalar
    // they prepared; the maker-checker rule (approver ≠ preparer) applies
    // per parça on the matching approve branch.
    async prepareBaskiOnay(id, parcalar = null) {
      const { data } = await httpClient.post(`/projects/${id}/baski-onay-prepare`, { parcalar })
      cache.set(id, data)
      return data
    },
    /* ---------------------------------------------------------------- */
    /* Per-parça routing (migration 074)                                 */
    /*                                                                   */
    /* These move ONE parça between desks and never change the project,  */
    /* so unlike every other verb in this file they must NOT write the   */
    /* project cache — the server returns a parca_state row, not a       */
    /* project, and caching it under the project id would corrupt the    */
    /* very entry `rejectProject` / `approveProject` read `stage` from.  */
    /* ---------------------------------------------------------------- */

    /** One project's parça routing rows. */
    async listParcaState(id) {
      const { data } = await httpClient.get(`/projects/${id}/parca-state`)
      return data
    },

    /**
     * Every parça on the caller's own desk, across projects. This is what lets
     * the matbaa's queue show one row per parça instead of one per project.
     */
    async listParcaQueue() {
      const { data } = await httpClient.get('/parca-queue')
      return data
    },

    /** Matbaa: began work on this one parça. */
    async startParca(id, parca) {
      const { data } = await httpClient.post(
        `/projects/${id}/parca/${encodeURIComponent(parca)}/start`, {},
      )
      return data
    },

    /** Matbaa: handed this one parça back; it returns to the leader's gate. */
    async deliverParca(id, parca) {
      const { data } = await httpClient.post(
        `/projects/${id}/parca/${encodeURIComponent(parca)}/deliver`, {},
      )
      return data
    },

    /**
     * Leader (or the assigned designer): took delivery of ONE parça, on a round
     * the matbaa is still producing (migration 076). The per-parça "Teslim
     * Alındı" — what opens the approve/reject decision for that parça before
     * the rest of the round has arrived.
     */
    async receiveParca(id, parca) {
      const { data } = await httpClient.post(
        `/projects/${id}/parca/${encodeURIComponent(parca)}/receive`, {},
      )
      return data
    },

    /**
     * Designer: revized this parça and is sending it back round.
     * `route` is 'physical' (matbaa produces it again) or 'ekran' (screen
     * check, straight back to the leader). Required — the server refuses
     * without it, the same way the project-level route picker does.
     */
    async requestParcaRound(id, parca, route) {
      const { data } = await httpClient.post(
        `/projects/${id}/parca/${encodeURIComponent(parca)}/request-round`, { route },
      )
      return data
    },

    // Ekran Demo Onayı — lightweight digital alternative to a physical
    // re-demo for a held demo at 100% progress (migration 050).
    async requestEkranDemoOnay(id) {
      const { data } = await httpClient.post(`/projects/${id}/ekran-demo-request`, {})
      cache.set(id, data)
      return data
    },
    // Per-parça approve (migrations 068/069/070): the leader signs off the
    // chosen parçalar (or all still-pending when null). The prepare hook
    // already loaded the demo snapshot, so the server can resolve the
    // pending set on its own.
    async approveEkranDemo(id, parcalar = null) {
      const { data } = await httpClient.post(`/projects/${id}/ekran-demo-approve`, { parcalar })
      cache.set(id, data)
      return data
    },
    async rejectEkranDemo(id, reason) {
      const { data } = await httpClient.post(`/projects/${id}/ekran-demo-reject`, { reason })
      cache.set(id, data)
      return data
    },
    // Per-parça reject (migrations 068/069/070): `parcalar` is the subset
    // whose approval rows get cleared on this click; null = whole-round
    // reject (full ledger reset, the original behaviour).
    async rejectProject(id, reason, revizeIds, target, parcalar = null) {
      const cached = cache.get(id)
      if (!cached) badRequest('Proje bilinmiyor, listeyi yenileyin.')
      const { data } = await httpClient.post(`/projects/${id}/reject`, {
        stage: cached.stage, reason, reject_target: target, revizeIds, parcalar,
      })
      cache.set(id, data)
      return data
    },
  }
}

/**
 * Which `demos` snapshot kind to read for the per-parça approve / reject
 * gate. Mirrors the route's stage-to-snapshotKind mapping inside
 * `routes/projects.js#approveProject`. Lives here so the http repository can
 * send the right hint in one place.
 *
 *   demo_onay / cin_demo_onay  → 'demo'
 *   ozalit_onay                → 'ozalit' (covers the ekran_ozalit branch too;
 *                                 the screen round uses the same ozalit snapshot)
 *   baski_onay / cin_baski_onay → 'baski_onay'
 */
function pickSnapshotKind(stage) {
  if (stage === 'ozalit_onay') return 'ozalit'
  if (stage === 'baski_onay' || stage === 'cin_baski_onay') return 'baski_onay'
  return 'demo'
}
