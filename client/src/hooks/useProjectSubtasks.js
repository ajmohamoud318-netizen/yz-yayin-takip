import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import api from '@/api'
import { isSubtaskDone, countsTowardProgress, subtaskProgress } from '@/domain/services/progress'

/**
 * Owns every subtask mutation for the project detail page. The
 * per-chip click handlers (`handlePageClick` / `handlePageRework` /
 * `handlePageAssign`) are gone with the chip grid — designers now
 * enter the page count they shipped into a per-designer number input
 * (`handleDesignerCountChange`), and the route sends a single
 * PATCH /subtasks/:id/designer-counts that covers the whole slot.
 *
 * Migration 067 — every chip click used to fan out ~12 SQL statements
 * (SELECT FOR UPDATE on the subtask + project, page SELECT/UPDATE,
 * subtask counter recompute, project progress SELECT/UPDATE,
 * patchProject, logHistory, three re-SELECTs for the response).
 * Switching to one number input per designer collapses that to a
 * single UPSERT + trigger recompute + patchProject per save — the
 * same statement set every other subtask route already uses.
 */
export function useProjectSubtasks(project, refetch, setProject, user, isLeader, isAssigned, celebrate) {
  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const [toggling, setToggling] = useState(null)
  const [localDone, setLocalDone] = useState({})
  const [saving, setSaving] = useState(false)

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  // Stages where a designer may still work on the subtasks after submitting an
  // early demo, plus the ozalit redo leg (project stays on ozalit_onay with
  // last_reject_type='ozalit' instead of bouncing back to tasarım).
  const DEMO_STAGES = ['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay']
  const isOzalitRedoLeg =
    project?.stage === 'ozalit_onay' && project?.last_reject_type === 'ozalit'

  const canEditBase =
    !project?.deleted_at &&
    user?.role === 'designer' &&
    isAssigned &&
    (project?.stage === 'tasarim' ||
      isOzalitRedoLeg ||
      (DEMO_STAGES.includes(project?.stage) && (project?.progress ?? 0) < 100))

  const canLogUpdate = !project?.deleted_at && user?.role === 'designer' && isAssigned

  const inRevision =
    (project?.stage === 'tasarim' || isOzalitRedoLeg) &&
    (project?.subtasks ?? []).some((s) => s.needs_revize)

  // Per-subtask editability. The İç Sayfalar subtask stays editable for
  // its assigned designer(s) too — the page-grid done-state gate in
  // `if (sub.kind !== 'pages' && sub.assigned_to && ...)` is what made
  // a multi-designer pages subtask readable for everyone; we keep that
  // behaviour because each designer's input only writes their own slot,
  // and the server gates that ownership too.
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

  /**
   * Designer pages-done save. One round-trip per call, regardless of
   * how many keystrokes the designer typed before settling on a value.
   * The body always sends a single-entry array: the slot for THIS
   * designer — the server rejects multi-slot payloads from non-leader
   * users (the team leader can fix any slot).
   *
   * Optimistic update keeps the input value in lockstep with server
   * state — the parent `DesignerPagesInput` clears its draft on
   * success and reverts on failure.
   */
  async function handleDesignerCountChange(sub, designerId, pagesDone) {
    if (!canEditSubtask(sub)) return
    // Snapshot the affected subtask so a server-side reject can roll
    // back. Reading `project` from the closure is fine here — the
    // input only fires on user interaction, a fresh handle closure
    // over a stale project would still hold the shape we revert to.
    const before = project?.subtasks?.find((s) => s.id === sub.id) ?? null
    setProject((prev) => {
      if (!prev) return prev
      const subs = (prev.subtasks ?? []).map((s) => {
        if (s.id !== sub.id) return s
        const total = Number(s.total_pages ?? 0)
        const nextCounts = (Array.isArray(s.designer_counts) ? s.designer_counts : []).map((c) => (
          c.designer_id === designerId ? { ...c, pages_done: pagesDone } : c
        ))
        // If the slot doesn't exist yet, materialise it so the optimistic
        // totals reflect the same state the trigger will recompute on the
        // server (the server's UPSERT runs ON CONFLICT DO UPDATE which
        // inserts a new row when one doesn't exist).
        const hasSlot = nextCounts.some((c) => c.designer_id === designerId)
        const finalCounts = hasSlot
          ? nextCounts
          : [...nextCounts, {
              designer_id: designerId,
              designer_name: null,
              pages_done: pagesDone,
              updated_at: new Date().toISOString(),
            }]
        const sum = finalCounts.reduce((acc, c) => acc + Number(c.pages_done ?? 0), 0)
        const pagesDoneClamped = total > 0 ? Math.min(sum, total) : sum
        return {
          ...s,
          designer_counts: finalCounts,
          pages_done: pagesDoneClamped,
          is_done: total > 0 && sum >= total,
        }
      })
      return { ...prev, subtasks: subs, progress: subtaskProgress(subs) }
    })
    try {
      const res = await api.setSubtaskDesignerCounts(
        sub.id,
        [{ designer_id: designerId, pages_done: pagesDone }],
      )
      // Slim response shape:
      //   { subtask_id, project_id, total_pages, pages_done, is_done,
      //     designer_counts: [...], project_progress, project: {...} }
      if (res) {
        setProject((prev) => {
          if (!prev) return prev
          // Trust the server's per-designer array and counters; merge
          // them onto the affected subtask so a stray drift between
          // optimistic and server totals is reconciled by the truth.
          const subs = (prev.subtasks ?? []).map((s) => (
            s.id === res.subtask_id
              ? {
                  ...s,
                  designer_counts: res.designer_counts,
                  pages_done: Number(res.pages_done ?? s.pages_done ?? 0),
                  is_done: !!res.is_done,
                }
              : s
          ))
          const out = { ...prev, subtasks: subs }
          // Project progress + version live on the slim response.
          if (res.project && typeof res.project.progress === 'number') {
            out.progress = res.project.progress
          }
          if (res.project && typeof res.project.version === 'number') {
            out.version = res.project.version
          }
          return out
        })
      }
    } catch (err) {
      // Revert to the snapshotted subtask on a real failure. Mirrors
      // the optimistic-update pattern the per-chip route used — only
      // the affected subtask is restored, the rest of the project is
      // left alone.
      if (before) {
        setProject((prev) => {
          if (!prev) return prev
          const subs = (prev.subtasks ?? []).map((s) => (
            s.id === sub.id ? before : s
          ))
          return { ...prev, subtasks: subs, progress: subtaskProgress(subs) }
        })
      }
      toast.error(err?.message || 'Sayfa sayısı kaydedilemedi.')
      // Re-throw so the input's `<DesignerPagesInput>` keeps its error
      // flag visible across the next edit attempt.
      throw err
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
    toggling, saving, localDone,

    // Helpers + handlers
    subtaskChecked, toggleSubtask,
    handleDesignerCountChange,
    saveSubtaskChanges, handleRedo, handleRevize,
  }
}
