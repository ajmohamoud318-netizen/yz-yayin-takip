import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import api from '@/api'
import DemoFormDialog from '@/components/DemoFormDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import ParcaJobGroup from '@/components/ParcaJobGroup'
import { opensNarrowed } from '@/lib/spec-form-scope'

/**
 * The matbaa's per-parça jobs, wherever they are shown (migration 074).
 *
 * Extracted from MatbaaIsleri because it stopped being the only place that
 * needs it. A round split into parçalar is the matbaa's real unit of work, and
 * the printer reaches that work from three directions: the hub, the Onaylar
 * queue, and the project page they land on from a "Detay" button. All three
 * used to answer differently — only the hub knew about parçalar, so the other
 * two offered a whole-sheet "İşlemi Başlatın" that stamps `demo_started` on the
 * project and unlocks a whole-sheet "Teslim Edin", advancing the round past
 * parçalar the printer never produced (`computeDemoTeslimAdvance` has no parça
 * check — only `deliverParca` gates on `allParcalarDelivered`).
 *
 * So the surface moved here and the pages just place it. One board, one set of
 * rules, one thing to fix next time.
 *
 * Start and deliver never act directly: both open the spec sheet narrowed to
 * the parçalar of that click, and the action is stamped from its footer. The
 * matbaa commits to producing what is on the sheet, so they read it first — the
 * same rule the project-level buttons follow.
 *
 * Answering a change request (migration 077) is the one exception, and for the
 * reason that makes the rule: it commits the printer to nothing. See
 * `respondChange`.
 *
 * @param {{
 *   rows: object[],
 *   onChanged?: () => void,
 *   compact?: boolean,
 * }} props
 *   `rows`   — parça-queue rows for the printer (`useParcaQueue`), already
 *              narrowed to whatever scope the caller is showing.
 *   `compact`— drop the project title from the cards. For the project page,
 *              where the header two inches above already says which book this
 *              is and repeating it costs a line on a 390px screen.
 */
export default function ParcaJobBoard({ rows = [], onChanged, compact = false }) {
  const navigate = useNavigate()
  // Which sheet is open, and for which parçalar:
  // { project, mode, parca: rows[], scope: string[] }
  const [demoForm, setDemoForm] = useState(null)
  const [ozalitForm, setOzalitForm] = useState(null)
  // Project id of the run in flight — disables that group's buttons so the
  // same parça can't be stamped by both a card and the bulk shortcut.
  const [busy, setBusy] = useState(null)

  // Grouped by ROUND so the matbaa can take a whole sheet in one pass or pick
  // parçalar off it individually — whatever they don't act on stays queued.
  //
  // The key is `order_id ?? project_id`, not `project_id` (migration 080). A
  // sipariş's parçalar are their own round with their own sheet, and two
  // concurrent reprints of one title are two separate jobs — grouping them
  // under the project would put six parçalar from three different rounds on one
  // card and let "Hepsini Başlatın" stamp all of them at once.
  const groups = useMemo(() => {
    const byRound = new Map()
    for (const row of rows) {
      const key = row.order_id ?? row.project_id
      const g = byRound.get(key)
      if (g) g.rows.push(row)
      else {
        byRound.set(key, {
          key,
          projectId: row.project_id,
          orderId: row.order_id ?? null,
          projectTitle: row.project_title,
          rows: [row],
        })
      }
    }
    return [...byRound.values()]
  }, [rows])

  /**
   * Which pipeline a row belongs to, and therefore which endpoint to call.
   *
   * `order_id` is the discriminator the server puts on every queue row. The
   * two sets of verbs are identical in behaviour — that is the whole point of
   * migration 080 — but they address different aggregates, and calling the
   * project one with an order's id would 404 at best.
   */
  const parcaApi = (row) => (row.order_id
    ? {
      start: () => api.startOrderParca(row.order_id, row.parca),
      deliver: () => api.deliverOrderParca(row.order_id, row.parca),
      accept: () => api.acceptOrderParcaChange(row.order_id, row.parca),
      decline: () => api.declineOrderParcaChange(row.order_id, row.parca),
    }
    : {
      start: () => api.startParca(row.project_id, row.parca),
      deliver: () => api.deliverParca(row.project_id, row.parca),
      accept: () => api.acceptParcaChange(row.project_id, row.parca),
      decline: () => api.declineParcaChange(row.project_id, row.parca),
    })

  /**
   * Open the sheet for one parça or a whole group.
   *
   * The sheet opens narrowed to the parçalar of THIS click (`parcaScope`): one
   * card sends one parça, "Hepsini Başlatın" sends every row it is about to
   * stamp. A round's snapshot carries all of its parçalar — a re-round for KUTU
   * alone reuses the sheet the whole round was sent on (`requestParcaRound`
   * writes no new snapshot) — so without the scope the printer opened a
   * three-parça document from a button that names one, and had to work out
   * which page was theirs. The narrowing is display-only; the sheet itself
   * still carries the round (see lib/spec-form-scope.js).
   */
  function openSheet(rowOrRows) {
    const list = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
    const first = list[0]
    if (!first) return
    const form = {
      project: { id: first.project_id, title: first.project_title },
      // A sipariş round has its own sheet, keyed by the ORDER (migration 053).
      // Without this the printer would open the PROJECT's latest ozalit — a
      // different document, possibly from a different round entirely.
      orderId: first.order_id ?? null,
      mode: 'view',
      parca: list,
      scope: list.map((r) => r.parca),
    }
    if (first.gate === 'ozalit') setOzalitForm(form)
    else setDemoForm(form)
  }

  /**
   * Stamp start or delivery for one parça or a whole group, from the sheet's
   * footer.
   *
   * Sequential rather than parallel on purpose: each call takes the project
   * row's lock (`getProjectForUpdate`), and delivering the LAST parça also
   * advances the project — firing them at once would have them queue on that
   * lock anyway, with the advance racing its own siblings.
   */
  async function commit(list, closeForm) {
    const jobs = Array.isArray(list) ? list : [list]
    if (jobs.length === 0) return
    setBusy(jobs[0].order_id ?? jobs[0].project_id)
    const done = []
    try {
      for (const row of jobs) {
        const call = parcaApi(row)
        if (row.state === 'in_round') await call.deliver()
        else await call.start()
        done.push(row.parca)
      }
      const verb = jobs[0].state === 'in_round' ? 'teslim edildi' : 'çalışmasına başlandı'
      toast.success(`${done.join(', ')} ${verb}.`)
      closeForm()
    } catch (err) {
      // Report what DID land — a half-finished bulk run must not look like a
      // no-op, or the printer redoes work they already stamped.
      if (done.length > 0) toast.error(`${done.join(', ')} kaydedildi, kalanı tamamlanamadı: ${err.message}`)
      else toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setBusy(null)
      onChanged?.()
    }
  }

  /**
   * Answer the leader's change request for one parça (migration 077).
   *
   * Direct, with no sheet in between — deliberately unlike every other button
   * on this board. Those are commitments to produce what is on the document, so
   * the printer reads it first; this one is a yes or no to a question whose
   * whole content is the note on the card. Opening a three-page spec sheet to
   * answer it would be ceremony, not care.
   */
  async function respondChange(row, answer) {
    setBusy(row.order_id ?? row.project_id)
    const call = parcaApi(row)
    try {
      if (answer === 'accept') {
        await call.accept()
        toast.success(`${row.parca} için değişiklik kabul edildi, düzeltilmiş form bekleniyor.`)
      } else {
        await call.decline()
        toast.success(`${row.parca} için değişiklik talebi reddedildi, baskıya devam.`)
      }
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setBusy(null)
      onChanged?.()
    }
  }

  /**
   * What the sheet's footer button promises.
   *
   * Names every parça it is about to stamp — a bulk "Hepsini" opened this sheet
   * and the printer has to see, on the button itself, exactly which parçalar it
   * covers before committing.
   */
  function footerLabel(jobs) {
    if (!jobs || jobs.length === 0) return null
    const names = jobs.map((r) => r.parca).join(', ')
    return jobs[0].state === 'in_round'
      ? `${names} · Teslim Edin`
      : `${names} · İşlemi Başlatın`
  }

  if (groups.length === 0) return null

  return (
    <>
      <div className="space-y-2.5">
        {groups.map((g) => (
          <ParcaJobGroup
            key={g.key}
            projectId={g.projectId}
            orderId={g.orderId}
            projectTitle={g.projectTitle}
            rows={g.rows}
            busy={busy === g.key}
            compact={compact}
            onAct={openSheet}
            onActAll={openSheet}
            onRespondChange={respondChange}
            onNavigate={(projectId) => navigate(`/projects/${projectId}`)}
          />
        ))}
      </div>

      <DemoFormDialog
        open={!!demoForm}
        onOpenChange={(v) => setDemoForm(v ? demoForm : null)}
        project={demoForm?.project}
        mode="view"
        onStartWork={demoForm ? () => commit(demoForm.parca, () => setDemoForm(null)) : undefined}
        parcaScope={demoForm?.scope ?? null}
        // …and OPEN on it. `parcaScope` alone only makes the narrowing
        // available; without this the sheet still opened on the whole round and
        // the printer had to find their parça in it — the exact thing the scope
        // was added to prevent. One parça (a card's own button, including a
        // parça bounced back for a reprint) opens narrowed; "Hepsini Başlatın"
        // covers the round and so opens on the round.
        parcaScopeOnly={opensNarrowed(demoForm?.scope)}
        startWorkLabel={footerLabel(demoForm?.parca)}
        startingWork={!!busy}
        onDone={() => setDemoForm(null)}
      />
      <OzalitFormDialog
        open={!!ozalitForm}
        onOpenChange={(v) => setOzalitForm(v ? ozalitForm : null)}
        project={ozalitForm?.project}
        mode="view"
        onStartWork={ozalitForm ? () => commit(ozalitForm.parca, () => setOzalitForm(null)) : undefined}
        parcaScope={ozalitForm?.scope ?? null}
        // See the demo dialog above — same rule on this leg.
        parcaScopeOnly={opensNarrowed(ozalitForm?.scope)}
        startWorkLabel={footerLabel(ozalitForm?.parca)}
        startingWork={!!busy}
        onDone={() => setOzalitForm(null)}
      />
    </>
  )
}
