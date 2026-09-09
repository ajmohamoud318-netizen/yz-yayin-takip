import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { useAuth } from './useAuth'
import { useProject, useProjects } from './useProjects'
import { useDesignerCelebration } from './useCelebration'
import { useNotifications } from './useNotifications'
import api, { ORDER_STEP_LABELS } from '@/api'
import {
  isActiveOrder, availableActions, advanceActionLabel, approveActionLabel,
  demoOzalitStatusLabel, parcaPanelViewer,
} from '@/domain/services/project-detail'
import { awaitsOzalitReceipt, unsentParcalar } from '@/domain'

import { useProjectDetailData, useProjectDetailSSE } from './useProjectDetailData'
import { useProjectDelivery } from './useProjectDelivery'
import { useParcaQueue, useProjectParcaState } from './useParcaQueue'
import { useParcaSnapshot } from './useParcaSnapshot'
import { useProjectCatalog } from './useProjectCatalog'
import { useProjectSubtasks } from './useProjectSubtasks'

/**
 * Thin composer hook for the project detail page.
 *
 * Composes the focused hooks and owns:
 *   - dialog/form visibility state (approve, edit, delete, demo/ozalit/baski
 *     form dialogs, ekran-demo reject dialog)
 *   - computed display values (trackedOrders, allDesigners, action labels,
 *     historyWithAttempts, etc.)
 *   - the advance-action handler + deep-link `?action=teslim` trigger
 *   - project-level mutations (delete, restore)
 *
 * Delegates to:
 *   - useProjectDetailData(id)  — orders/handovers/users fetch + order handlers
 *   - useProjectDelivery(...)   — delivery/teslim mutations + TESLIM_CONFIRMS
 *   - useProjectSubtasks(...)   — subtask mutations + local edit state
 */
export function useProjectDetail(id) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const celebrate = useDesignerCelebration()
  const { project, loading, refetch, setProject } = useProject(id)
  // The shared list, for the two mutations that add/remove a whole row.
  // `updateOne` (which useProject already calls) only maps over entries that
  // are already there, so it can neither drop a deleted project nor bring a
  // restored one back.
  const { removeOne, refetch: refetchProjects } = useProjects()
  const { subscribe } = useNotifications()

  // ---------------------------------------------------------------------------
  // Composed hooks
  // ---------------------------------------------------------------------------

  const data = useProjectDetailData(id)
  const delivery = useProjectDelivery(project, refetch, user)
  // Per-parça routing rows (migration 074). Loaded here rather than in the
  // page because `availableActions` below needs them: while the round is split
  // across desks the whole-round Onayla/Reddet must not be offered.
  const { rows: parcaRows, refetch: refetchParcaRows } = useProjectParcaState(id)
  /* The matbaa's own parça jobs on THIS project (migration 074).
   *
   * A separate question from `parcaRows` above, and the parça queue is the only
   * thing that can answer it: a first round is split by its snapshot rather
   * than by routing rows, which `deriveTeslimParcalar` derives on the queue's
   * read path and never writes. Without this the project page offered the
   * printer a whole-sheet "İşlemi Başlatın" on a round that Matbaa İşleri was
   * already showing as separate parçalar. */
  const { rows: parcaQueueRows, refetch: refetchParcaJobs } = useParcaQueue(user?.role === 'printer')
  const printerParcaJobs = useMemo(
    () => parcaQueueRows.filter((r) => r.project_id === id),
    [parcaQueueRows, id],
  )
  const isAssigned = (project?.assignees ?? []).some((a) => a.id === user?.id)
  const isLeader = user?.role === 'team_leader'
  const subtasks = useProjectSubtasks(
    project, refetch, setProject, user,
    isLeader, isAssigned, celebrate,
  )

  // SSE: refetch the project whenever a relevant notification arrives.
  // Also refetch the per-parça routing rows — a matbaa/leader action on one
  // parça of this project (migration 074) doesn't change `project.stage`,
  // so the plain project refetch above would leave ParcaChangeRequestPanel
  // and the parça grid showing a stale routing state to anyone else who has
  // this project open.
  useProjectDetailSSE(id, data.projectOrders, subscribe, () => {
    refetch()
    refetchParcaRows()
  })

  // ---------------------------------------------------------------------------
  // Dialog / form visibility state
  // ---------------------------------------------------------------------------

  const [dialog, setDialog] = useState(null) // 'approve' | 'reject' | 'advance'
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const [ozalitFormOpen, setOzalitFormOpen] = useState(false)
  const [ozalitFormMode, setOzalitFormMode] = useState('approve') // 'approve' | 'view'
  const [ozalitFormAttempt, setOzalitFormAttempt] = useState(null)
  const [ozalitFormRound, setOzalitFormRound] = useState(null)
  const [ozalitFormSnapshot, setOzalitFormSnapshot] = useState(null)
  const [ozalitFormNotify, setOzalitFormNotify] = useState(false)
  // Set true only when the matbaa's "İşlemi Başlatın" opens the dialog —
  // mode='view' then carries the start-work button in its footer, so the
  // printer reads the sheet before stamping ozalit_started.
  const [ozalitFormStartWork, setOzalitFormStartWork] = useState(false)

  const [demoFormOpen, setDemoFormOpen] = useState(false)
  const [demoFormMode, setDemoFormMode] = useState('advance') // 'advance' | 'view' | 'history'
  const [demoFormAttempt, setDemoFormAttempt] = useState(null)
  // Round the opened snapshot belongs to — an edit sits one slot past it.
  const [demoFormRound, setDemoFormRound] = useState(null)
  // Exact snapshot a timeline row wrote (migration 052), when it recorded one.
  const [demoFormSnapshot, setDemoFormSnapshot] = useState(null)
  // Set true only when the new "Formu Düzenleyin" button opens the dialog —
  // makes mode='view' Kaydet notify the matbaa instead of saving silently.
  const [demoFormNotify, setDemoFormNotify] = useState(false)
  // Matbaa's "İşlemi Başlatın" — same review-then-start gate as the ozalit
  // one above.
  const [demoFormStartWork, setDemoFormStartWork] = useState(false)

  /* The parçalar a "Kalan Parçaları Gönderin" click is about to put on the
   * round, or null on every other opening of the sheet.
   *
   * It does two jobs, which is why it is a list and not a boolean. The sheet
   * opens with these ticked, so the document matches what the button promised;
   * and its presence is what sets `allowParcaAdd` on the save, which is the
   * only thing that gets an addition past the server's parça-set guard. Every
   * other route into this dialog leaves it null and is refused if it somehow
   * changes the round's parça list — which is the point of the guard.
   *
   * Shared by both legs: a project runs one round at a time, and the dialog
   * that opens is chosen by the stage. */
  const [parcaAddScope, setParcaAddScope] = useState(null)

  const [baskiOnayFormOpen, setBaskiOnayFormOpen] = useState(false)
  const [baskiOnayFormMode, setBaskiOnayFormMode] = useState('approve') // 'approve' | 'view'

  // Ekran Demo Onayı — reject dialog (migration 050).
  const [ekranDemoRejectOpen, setEkranDemoRejectOpen] = useState(false)

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  // Orders worth showing their own tracker for: any still-active one, plus
  // (until the project actually sells) the single most recently approved
  // order — otherwise its tracker would vanish the instant it hits
  // 'baskida', even though it hasn't reached 'Satışta' yet.
  const sold = project?.stage === 'satista'
  const handoverPending = data.projectHandover?.status === 'atama_bekleniyor'
  const trackedOrders = useMemo(() => {
    const active = data.projectOrders.filter(isActiveOrder)
    if (sold) return active
    const lastApproved = data.projectOrders
      .filter((o) => o.status === 'baskida')
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
    return lastApproved ? [...active, lastApproved] : active
  }, [data.projectOrders, sold])

  // isOrderAssignedToDesigner's fallback for legacy orders with no
  // assignee_ids of their own — same check MyProjects/SiparisOnay run
  // against the designer's full project list, narrowed to just this project.
  const fallbackProjectIds = useMemo(
    () => new Set(isAssigned ? [project?.id] : []),
    [isAssigned, project?.id],
  )

  // Distinct designers actually doing work on this project.
  const allDesigners = useMemo(() => {
    const subs = project?.subtasks ?? []
    const byId = new Map()
    for (const s of subs) {
      if (s.assigned_to && !byId.has(s.assigned_to)) {
        byId.set(s.assigned_to, { id: s.assigned_to, name: s.assigned_name ?? null })
      }
    }
    const primaryId = project?.assigned_to
    if (primaryId && byId.has(primaryId)) {
      const primary = project?.assignees?.find((a) => a.id === primaryId)
      if (primary) byId.set(primary.id, { ...primary, name: primary.name ?? byId.get(primary.id).name })
    }
    return Array.from(byId.values())
  }, [project?.assignees, project?.assigned_to, project?.subtasks])

  const isDeleted = !!project?.deleted_at
  const isDemoOnayStage = project?.stage === 'demo_onay' || project?.stage === 'cin_demo_onay'
  const canReceiveDemo =
    isDemoOnayStage && !project?.demo_received && (isLeader || (user?.role === 'designer' && isAssigned))

  const isOzalitOnayStage = project?.stage === 'ozalit_onay'
  // Not every un-received ozalit is awaiting a receipt: a screen round never
  // had a proof, and a rejected one is parked on this stage while the designer
  // revizes. The server refuses both (computeOzalitReceive /
  // computeOzalitNotReceived), so the Teslim Alındı / Alınamadı pair must stay
  // hidden there instead of erroring on click.
  const canReceiveOzalit =
    awaitsOzalitReceipt(project) && (isLeader || (user?.role === 'designer' && isAssigned))

  /* The round's own parça list, off its demo/ozalit snapshot. Lives here rather
   * than in the page because the "never sent" answer below needs it, and two
   * callers would mean two fetches of the same snapshot. The page reads it back
   * out of this hook. */
  const { parcalar: parcaSnapshot, ready: parcaSnapshotReady, ledgerKind } = useParcaSnapshot(project)

  /* The parçalar this project has that the current round never carried.
   *
   * The round's list is on its snapshot; the project's is in Ürün Bilgileri,
   * and nothing joins the two — so a parça left unticked when the round was
   * composed simply stops existing for it. This is what the header's
   * "Kalan Parçaları Gönderin" offers, and `unsentParcalar` is careful about
   * what "never sent" means: a parça out with the designer or already approved
   * is off the round too, and must not be handed to the matbaa as new work.
   *
   * Leader AND assigned designer, not leader-only. The button is still the
   * leader's, but this list now feeds the parça grid as well — a never-sent
   * parça is drawn there as `Gönderilmedi`, and it is the only explanation
   * anybody gets for why the round refuses to close. A designer counter-signing
   * an ozalit round sees the same wall the leader does, so they need the same
   * reason for it. The matbaa never renders this grid, so the catalog fetch
   * stays off their page. */
  const wantsCatalog = isLeader || (user?.role === 'designer' && isAssigned)
  const catalogParcalar = useProjectCatalog(wantsCatalog ? project?.id : undefined)
  const unsent = useMemo(
    () => (wantsCatalog ? unsentParcalar(catalogParcalar, parcaSnapshot, parcaRows) : []),
    [wantsCatalog, catalogParcalar, parcaSnapshot, parcaRows],
  )

  // Available actions + labels
  // parcaRows (migration 074) suppress the whole-round Onayla/Reddet while the
  // round is split across desks; printerParcaJobs does the same for the
  // matbaa's whole-sheet Teslim Edin — see availableActions.
  // parcaSnapshot decides whether the per-parça panel is the approval surface;
  // where it is, the whole-round Onayla is suppressed in favour of it.
  const actions = availableActions({
    project, user, parcaRows, printerParcaJobs, parcaSnapshot, parcaSnapshotReady,
  })

  /* Has the per-parça panel taken the whole-round "Teslim Alındı" pair over?
   *
   * The permission itself (canReceiveDemo / canReceiveOzalit above) is unchanged
   * — this only says where the buttons live, so the header can stop drawing them
   * where the panel does. Both halves are required: a multi-parça round AND a
   * viewer the panel actually draws for. The second is not redundant. An
   * assigned designer may take delivery of a demo but is not a demo approver, so
   * no panel renders for them — hiding their header pair on that alone would
   * leave them with no way to acknowledge a proof they are holding.
   * `parcaPanelViewer` is shared with ProjectDetail's own showParcaGrid so the
   * two answers cannot drift apart. */
  const receiptInPanel = parcaSnapshotReady && parcaSnapshot.length >= 2
    && parcaPanelViewer(user, ledgerKind, { isAssigned })
  const advLabel = project ? advanceActionLabel(project, user?.role) : 'İlerletin'
  const appLabel = project ? approveActionLabel(project) : 'Onaylayın'
  const sentStatus =
    project && user?.role !== 'printer' && !actions.includes('advance')
      ? demoOzalitStatusLabel(project)
      : null

  // Last rejection reason for the designer's revision banner
  const lastRejectReason =
    project?.last_reject_reason ??
    project?.history?.filter((h) => h.action === 'reject').pop()?.reason

  // Pre-compute demo/ozalit attempt numbers for each history entry so the
  // Görüntüle button can open the correct snapshot.
  const historyWithAttempts = useMemo(() => {
    const orderEntries = []
    for (const ord of data.projectOrders) {
      for (const h of (ord.order_history ?? [])) {
        orderEntries.push({
          id: `ord-${ord.id}-${h.step}`,
          action: 'order',
          order_id: ord.id,
          order_step: h.step,
          order_step_label: h.step.startsWith('reject') ? 'Reddedildi' : (ORDER_STEP_LABELS[h.step] ?? h.step),
          done_by_name: h.signed_by_name,
          created_at: h.signed_at,
        })
      }
    }
    const base = (project?.history ?? []).filter(
      (h) => h.action !== 'order' && !String(h.event ?? '').startsWith('order_'),
    )
    const merged = [...base, ...orderEntries].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    )

    let demoN = 0
    let ozalitN = 0
    const DEMO_HISTORY_STAGES = ['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay']
    return merged.map((h) => {
      const isDemoResend =
        h.action === 'advance' &&
        (h.to_stage === 'demo_teslim' || h.to_stage === 'cin_demo_teslim') &&
        DEMO_HISTORY_STAGES.includes(h.from_stage)
      if (isDemoResend) demoN++
      const entry = { ...h, demoAttemptAt: demoN + 1, ozalitAttemptAt: ozalitN + 1 }
      if (h.action === 'reject' && (h.from_stage === 'demo_onay' || h.from_stage === 'cin_demo_onay')) demoN++
      if (h.action === 'reject' && h.from_stage === 'ozalit_onay') ozalitN++
      return entry
    })
  }, [project?.history, data.projectOrders])

  // ---------------------------------------------------------------------------
  // Advance action + deep-link
  // ---------------------------------------------------------------------------

  function handleAdvanceAction() {
    // Ozalit redo leg: project stays on ozalit_onay (no longer bounces
    // back to tasarım) — the designer (or leader) revizes in-place and
    // then reopens the route picker from the same stage.
    if (project.stage === 'ozalit_onay' && project.last_reject_type === 'ozalit') {
      setOzalitFormMode('advance')
      setOzalitFormAttempt(null)
      setOzalitFormOpen(true)
      return
    }
    if (
      project.stage === 'tasarim' ||
      project.stage === 'demo_teslim' ||
      project.stage === 'demo_onay' ||
      project.stage === 'cin_demo_teslim' ||
      project.stage === 'cin_demo_onay'
    ) {
      setDemoFormMode('advance')
      setDemoFormAttempt(null)
      setDemoFormOpen(true)
    } else if (project.stage === 'ozalit_teslim') {
      setOzalitFormMode('advance')
      setOzalitFormAttempt(null)
      setOzalitFormOpen(true)
    } else {
      setDialog('advance')
    }
  }

  // Deep-link: ?action=teslim opens the delivery form directly for the matbaa.
  useEffect(() => {
    if (!project || subtasks.pendingRevize) return
    const params = new URLSearchParams(location.search)
    if (params.get('action') !== 'teslim') return
    if (!actions.includes('advance')) return
    handleAdvanceAction()
    params.delete('action')
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.stage, project?.demo_started, project?.ozalit_started, subtasks.pendingRevize, location.search])

  function onActionDone(updated) {
    setProject((prev) => ({ ...prev, ...updated }))
    refetch()
    // The spec form's "Düzeltmeyi Matbaaya Gönderin" now clears `fix_pending`
    // on the parça rows too (migration 077), so the project refetch alone
    // leaves ParcaChangeRequestPanel still saying a correction is owed for a
    // correction that just landed.
    refetchParcaRows()
  }

  // ---------------------------------------------------------------------------
  // Project-level mutations
  // ---------------------------------------------------------------------------

  async function confirmDeleteProject() {
    if (!project) return
    setDeleting(true)
    try {
      await api.deleteProject(project.id)
      removeOne(project.id)
      toast.success('Proje silindi.')
      navigate('/')
    } catch (err) {
      toast.error(err.message || 'Proje silinemedi.')
      setDeleting(false)
    }
  }

  async function handleRestore() {
    if (!project) return
    setRestoring(true)
    try {
      await api.restoreProject(project.id)
      // refetch() alone only refreshes the detail; the project is missing from
      // the shared list (it was soft-deleted), so the list needs its own pass
      // to put the row back on the dashboard.
      await Promise.all([refetch(), refetchProjects()])
      toast.success('Proje geri yüklendi.')
    } catch (err) {
      toast.error(err.message || 'Proje geri yüklenemedi.')
    } finally {
      setRestoring(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    parcaRows, refetchParcaRows,
    printerParcaJobs, refetchParcaJobs,
    // The matbaa's round is split: HeaderActionRow drops the whole-sheet
    // "İşlemi Başlatın" and the page renders ParcaJobBoard instead.
    printerSplitRound: printerParcaJobs.length > 0,
    // The round's parça list, and the parçalar of this project it left behind.
    parcaSnapshot, ledgerKind,
    unsentParcalar: unsent,
    // Data
    project, loading, refetch, setProject,
    projectOrders: data.projectOrders,
    projectHandover: data.projectHandover,
    allUsers: data.allUsers,

    // Auth / role
    user, isAssigned, isLeader, isDeleted,

    // Dialog state
    dialog, setDialog,
    editOpen, setEditOpen,
    deleteOpen, setDeleteOpen,
    deleting, restoring,

    ozalitFormOpen, setOzalitFormOpen,
    ozalitFormMode, setOzalitFormMode,
    ozalitFormAttempt, setOzalitFormAttempt,
    ozalitFormRound, setOzalitFormRound,
    ozalitFormSnapshot, setOzalitFormSnapshot,
    ozalitFormNotify, setOzalitFormNotify,
    ozalitFormStartWork, setOzalitFormStartWork,

    demoFormOpen, setDemoFormOpen,
    demoFormMode, setDemoFormMode,
    demoFormAttempt, setDemoFormAttempt,
    demoFormRound, setDemoFormRound,
    demoFormSnapshot, setDemoFormSnapshot,
    demoFormNotify, setDemoFormNotify,
    demoFormStartWork, setDemoFormStartWork,
    parcaAddScope, setParcaAddScope,

    baskiOnayFormOpen, setBaskiOnayFormOpen,
    baskiOnayFormMode, setBaskiOnayFormMode,

    ekranDemoRejectOpen, setEkranDemoRejectOpen,

    // Order dialog state (from useProjectDetailData)
    signOrder: data.signOrder, setSignOrder: data.setSignOrder,
    siparisBaskiOnayOrder: data.siparisBaskiOnayOrder, setSiparisBaskiOnayOrder: data.setSiparisBaskiOnayOrder,
    ozalitRequestOrder: data.ozalitRequestOrder, setOzalitRequestOrder: data.setOzalitRequestOrder,

    // Delivery state (from useProjectDelivery)
    ...delivery,

    // Subtask state (from useProjectSubtasks)
    ...subtasks,

    // Computed
    sold, handoverPending, trackedOrders, fallbackProjectIds,
    allDesigners,
    isDemoOnayStage, isOzalitOnayStage, canReceiveDemo, canReceiveOzalit,
    receiptInPanel,
    actions, advanceLabel: advLabel, approveLabel: appLabel, sentStatus,
    historyWithAttempts, lastRejectReason,

    // Mutations
    handleAdvanceAction,
    confirmDeleteProject, handleRestore,
    handleOrderSigned: data.handleOrderSigned,
    handleOrderUpdated: data.handleOrderUpdated,
    handleOrderOzalitRequested: data.handleOrderOzalitRequested,
    handleSiparisBaskiOnayApproved: data.handleSiparisBaskiOnayApproved,
    openOrderAction: data.openOrderAction,
    onActionDone,
  }
}
