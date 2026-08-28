import { useCallback, useRef, useState } from 'react'
import axios from 'axios'
import { toast } from 'sonner'

import api from '@/api'
import { isSubtaskDone, countsTowardProgress } from '@/domain/services/progress'

/**
 * Owns every subtask/page mutation for the project detail page: toggling,
 * saving, redo, revize, and the per-page click/rework/assign handlers
 * with their AbortController-based concurrency guards.
 */
export function useProjectSubtasks(project, refetch, setProject, user, allUsers, isLeader, isAssigned, celebrate) {
  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const [toggling, setToggling] = useState(null)
  const [localDone, setLocalDone] = useState({})
  const [saving, setSaving] = useState(false)
  const [activePage, setActivePage] = useState(null) // { key, status }
  const inflightPagesRef = useRef(new Map()) // key -> AbortController

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  // Stages where a designer may still work on the subtasks after submitting an
  // early demo.
  const DEMO_STAGES = ['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay']

  const canEditBase =
    !project?.deleted_at &&
    user?.role === 'designer' &&
    isAssigned &&
    (project?.stage === 'tasarim' ||
      (DEMO_STAGES.includes(project?.stage) && (project?.progress ?? 0) < 100))

  const canLogUpdate = !project?.deleted_at && user?.role === 'designer' && isAssigned

  const inRevision =
    project?.stage === 'tasarim' && (project?.subtasks ?? []).some((s) => s.needs_revize)

  // Per-subtask editability.
  const canEditSubtask = useCallback((sub) => {
    if (!canEditBase) return false
    if (sub.kind !== 'pages' && sub.assigned_to && sub.assigned_to !== user?.id) return false
    if (inRevision && !sub.needs_revize && sub.is_done) return false
    return true
  }, [canEditBase, inRevision, user?.id])

  const canEditSubtasks = canEditBase

  const subtasksSafe = project?.subtasks ?? []
  const progressCountedSubtasks = subtasksSafe.filter(countsTowardProgress)
  const hasSubtaskChanges =
    subtasksSafe.some(
      (s) => localDone[s.id] !== undefined && localDone[s.id] !== s.is_done,
    ) ?? false
  const pendingRevize = subtasksSafe.some((s) => s.needs_revize)

  function subtaskChecked(sub) {
    if (!sub) return false
    return localDone[sub.id] !== undefined ? localDone[sub.id] : isSubtaskDone(sub)
  }

  // ---------------------------------------------------------------------------
  // Subtask handlers
  // ---------------------------------------------------------------------------

  // Toggle local state only — changes are saved with the "Değişiklikleri Kaydet" button.
  function toggleSubtask(sub) {
    setLocalDone((prev) => {
      const current = prev[sub.id] !== undefined ? prev[sub.id] : sub.is_done
      return { ...prev, [sub.id]: !current }
    })
  }

  // migration 055 — per-page auto-save on chip click. Optimistic update
  // keeps the grid snappy: the local page flips immediately, then the PATCH
  // resolves the rest of the project (pages_done/is_done/etc.) and the
  // returned full project shape replaces state in one go — same contract as
  // PATCH /subtasks/:id uses for checkbox toggles.
  //
  // Concurrent clicks are guarded by per-chip AbortControllers, not a single
  // in-flight flag. The previous `activePageRef` only blocked clicks on the
  // same chip while its request was pending — a click on chip A, then B,
  // then A again fired three concurrent PATCHes whose responses arrived in
  // arbitrary order, and the slow one always won the final setProject merge.
  // Now the newer click aborts the older one, so only the most recent PATCH
  // per chip ever resolves. `activePage` stays for the UI disabled-state.
  async function handlePageClick(sub, pageIndex, currentStatus) {
    if (!canEditSubtask(sub)) return
    const key = `${sub.id}:${pageIndex}`
    // Cancel any in-flight request for the same chip before starting a new
    // one — otherwise a rapid second click on the same chip lands a redundant
    // PATCH that races with the first one.
    inflightPagesRef.current.get(key)?.abort()
    // pending → done, done → pending (undo), rework → done (resolve the flag
    // and ship it). The dedicated "Revize" action below is the explicit
    // rework signal — keeping it off the main click path means a designer
    // who taps a finished chip by mistake gets an undo, not a rework flag.
    const next = currentStatus === 'pending' ? 'done'
      : currentStatus === 'done' ? 'pending'
      : 'done'
    const controller = new AbortController()
    inflightPagesRef.current.set(key, controller)
    setActivePage({ key, status: next })
    try {
      const { project: updated } = await api.setSubtaskPage(sub.id, pageIndex, next, { signal: controller.signal })
      if (updated) setProject((prev) => ({ ...prev, ...updated }))
    } catch (err) {
      // A cancel we triggered ourselves is not a user-facing failure.
      if (err?.name !== 'CanceledError' && !axios.isCancel(err)) {
        toast.error(err.message || 'Sayfa kaydedilemedi.')
      }
    } finally {
      // Only clear if WE are still the active controller for this key — a
      // newer click has already replaced us and will clear in its own finally.
      if (inflightPagesRef.current.get(key) === controller) {
        inflightPagesRef.current.delete(key)
        setActivePage(null)
      }
    }
  }

  async function handlePageRework(sub, pageIndex) {
    if (!canEditSubtask(sub)) return
    const key = `${sub.id}:${pageIndex}`
    inflightPagesRef.current.get(key)?.abort()
    const controller = new AbortController()
    inflightPagesRef.current.set(key, controller)
    setActivePage({ key, status: 'rework' })
    try {
      const { project: updated } = await api.setSubtaskPage(sub.id, pageIndex, 'rework', { signal: controller.signal })
      if (updated) setProject((prev) => ({ ...prev, ...updated }))
    } catch (err) {
      if (err?.name !== 'CanceledError' && !axios.isCancel(err)) {
        toast.error(err.message || 'Revize kaydedilemedi.')
      }
    } finally {
      if (inflightPagesRef.current.get(key) === controller) {
        inflightPagesRef.current.delete(key)
        setActivePage(null)
      }
    }
  }

  /**
   * Leader reassigns a single page to a different designer — or clears the
   * assignment entirely (`assignedTo === null`). Mirrors handlePageClick /
   * handlePageRework: abort any in-flight request for the same chip, set
   * the active-page flag so the chip stays disabled while the PATCH is
   * out, optimistically flip the chip's owner locally, then reconcile
   * with the server's full project shape on success. A server-side
   * `error` field (the route returns `{ project, page }` for the happy
   * path or a plain `400` for out-of-range / wrong-kind) becomes a toast
   * and the optimistic flip reverts.
   */
  async function handlePageAssign(sub, pageIndex, assignedTo) {
    if (!isLeader) return
    const key = `${sub.id}:${pageIndex}`
    inflightPagesRef.current.get(key)?.abort()
    const controller = new AbortController()
    inflightPagesRef.current.set(key, controller)
    setActivePage({ key, status: 'assign' })
    // Snapshot the affected pages array BEFORE the optimistic flip so a
    // server-side reject can roll the chip back to exactly what it was.
    // Reading `project` from the closure is fine here — this handler is
    // only ever called from the user's chip click, and a fresh handlePage
    // closure over a stale project would still hold the same shape we
    // need to revert.
    const before = project?.subtasks?.find((s) => s.id === sub.id)?.pages ?? null
    setProject((prev) => {
      if (!prev) return prev
      const subs = (prev.subtasks ?? []).map((s) => {
        if (s.id !== sub.id) return s
        const nextPages = (s.pages ?? []).map((p) => {
          if (p.i !== pageIndex) return p
          return {
            ...p,
            assigned_to: assignedTo,
            assigned_to_name: assignedTo
              ? allUsers.find((u) => u.id === assignedTo)?.name ?? null
              : null,
          }
        })
        return { ...s, pages: nextPages }
      })
      return { ...prev, subtasks: subs }
    })
    try {
      const { project: updated } = await api.assignSubtaskPage(
        sub.id, pageIndex, assignedTo, { signal: controller.signal },
      )
      if (updated) setProject((prev) => ({ ...prev, ...updated }))
    } catch (err) {
      if (err?.name !== 'CanceledError' && !axios.isCancel(err)) {
        // Revert the optimistic flip on a real failure. We only restore
        // the affected `pages` slice — every other field on the project
        // may have moved in the meantime (a chip click on another page
        // for example) and shouldn't be wiped.
        if (before) {
          setProject((prev) => {
            if (!prev) return prev
            const subs = (prev.subtasks ?? []).map((s) => {
              if (s.id !== sub.id) return s
              return { ...s, pages: before }
            })
            return { ...prev, subtasks: subs }
          })
        }
        toast.error(err.message || 'Atama kaydedilemedi.')
      }
    } finally {
      if (inflightPagesRef.current.get(key) === controller) {
        inflightPagesRef.current.delete(key)
        setActivePage(null)
      }
    }
  }

  async function saveSubtaskChanges() {
    if (!hasSubtaskChanges) return
    setSaving(true)
    const wasInRevision = inRevision
    const revizeSubs = subtasksSafe.filter((s) => s.needs_revize)
    const revizeJustCompleted =
      wasInRevision &&
      revizeSubs.length > 0 &&
      revizeSubs.every((s) => {
        const done = localDone[s.id] !== undefined ? localDone[s.id] : s.is_done
        return done
      })
    const hitFullProgress =
      user?.role === 'designer' &&
      isAssigned &&
      !wasInRevision &&
      (project?.progress ?? 0) < 100 &&
      progressCountedSubtasks.every((s) =>
        localDone[s.id] !== undefined ? localDone[s.id] : s.is_done,
      )
    try {
      const changed = subtasksSafe.filter(
        (s) => localDone[s.id] !== undefined && localDone[s.id] !== s.is_done,
      )
      for (const sub of changed) {
        await api.setSubtaskDone(sub.id, localDone[sub.id])
      }
      setLocalDone({})
      await refetch()
      toast.success('Değişiklikler kaydedildi.')
      if (revizeJustCompleted || hitFullProgress) celebrate()
    } catch (err) {
      toast.error(err.message || 'Kayıt sırasında hata oluştu.')
    } finally {
      setSaving(false)
    }
  }

  // A completed subtask can be worked on again without unchecking it (e.g.
  // a designer redoes a page after a verbal note from the leader, with no
  // formal rejection/revize flag involved) — this just logs a timeline
  // entry via the same "subtask note" endpoint the designer's notes use,
  // it doesn't touch is_done.
  async function handleRedo(sub) {
    setToggling(sub.id)
    try {
      const { project: updated } = await api.addSubtaskUpdate(sub.id, {
        note: 'Yeniden çalışıldı.',
      })
      setProject((prev) => ({ ...prev, subtasks: updated.subtasks, history: updated.history }))
      toast.success(`${sub.title}, yeniden çalışıldı olarak kaydedildi.`)
    } catch (err) {
      toast.error(err.message || 'Kaydedilemedi.')
    } finally {
      setToggling(null)
    }
  }

  // Designer clears a subtask's revision flag once reworked. The subtask stays
  // complete (progress unchanged); this just logs a "revize edildi" entry and
  // drops the flag. Once none remain, the resubmit button unlocks.
  async function handleRevize(sub) {
    setToggling(sub.id)
    try {
      await api.reviseSubtask(sub.id)
      await refetch()
      toast.success(`${sub.title}, revize edildi.`)
    } catch (err) {
      toast.error(err.message || 'Revize kaydedilemedi.')
    } finally {
      setToggling(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // Computed
    canEditBase, canEditSubtask, canEditSubtasks, canLogUpdate, inRevision,
    subtasksSafe, progressCountedSubtasks, hasSubtaskChanges, pendingRevize,

    // State
    toggling, saving, localDone, activePage,

    // Helpers + handlers
    subtaskChecked, toggleSubtask,
    handlePageClick, handlePageRework, handlePageAssign,
    saveSubtaskChanges, handleRedo, handleRevize,
  }
}
