import { useState } from 'react'
import { Printer, Hourglass, Pencil, MessageSquareWarning, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { parcaEditLocked, parcaChangeRequestable, parcaNames } from '@/domain'
import { cn } from '@/lib/utils'

/**
 * "Matbaadaki parçalar" — what the leader can still change, and what they have
 * to ask for (migration 077).
 *
 * The leader's correction path used to be one whole-sheet button: "Gönderilen
 * Demoyu Düzenleyin" while the matbaa hadn't started, "Değişiklik İste" once
 * they had. Both read `projects.demo_started`, and on a split round that flag
 * is never set — `startParca` leaves it alone so one started parça doesn't hide
 * "İşlemi Başlatın" on the rest. The result was the worst of both: the free
 * edit stayed on offer over a parça already on the press, and the ask that
 * should have replaced it was unreachable.
 *
 * This panel is where that decision moved. It shows the round parça by parça
 * because that is the granularity the answer actually has:
 *
 *   not started      → edit it outright, scoped to this parça
 *   started          → "Değişiklik İste", with a note the printer will read
 *   asked            → waiting on the matbaa
 *   accepted         → the parça is free again and owes a correction
 *
 * The not-started row used to carry no button, on the grounds that the header's
 * whole-sheet edit already covered it. It does cover it — but it opens every
 * parça of the round and names none of them, so the leader who came here to fix
 * KİTAP had to find KİTAP again in a three-parça sheet. Every other row in this
 * panel names its parça in the button; this one now does too, and both go
 * through the same scoped sheet.
 *
 * Locked parçalar are still listed with no edit. A leader looking at a locked
 * KUTU needs to know whether the rest of the sheet is locked as well, and a
 * panel that only showed problems could not answer that.
 *
 * Which is why `snapshotParcalar` is here. Routing rows are materialised the
 * first time somebody acts on a parça (`loadParcaForUpdate`), so on the exact
 * round this panel exists for — matbaa started KUTU, hasn't touched KİTAP or
 * KILAVUZ — only KUTU has a row, and `rows` alone would render a one-line
 * panel that looks like the sheet is one parça. The snapshot is the round's
 * real parça list; anything in it without a row is a parça the matbaa is
 * holding and has not begun.
 */

/**
 * The parçalar the matbaa is holding this round, routed rows first.
 *
 * Exported for its own tests. The synthesised half carries fields no DOM node
 * renders — `gate` above all — so the only way to assert them through the
 * component would be a button that happens to read one, which is exactly the
 * coupling that let the missing `gate` sit here unnoticed.
 *
 * `untouched` is returned alongside because the caller needs to tell a
 * single-parça round the header already covers from a real one.
 *
 * @param {Array<object>} rows
 * @param {Array<string | { component?: string }>} snapshotParcalar
 * @param {'demo' | 'ozalit' | null} gate
 */
export function heldParcalar(rows, snapshotParcalar, gate = null) {
  // Only rows the matbaa is actually holding this round. An approved parça, or
  // one back with the designer, has nothing to do with "can I still change the
  // sheet the printer is working from".
  const routed = (rows ?? []).filter((r) => (
    r?.state === 'with_matbaa' || r?.state === 'in_round'
  ))
  // A parça that has left the matbaa this round — delivered, approved, sent to
  // the designer — is not "unstarted", it is done with them, so it must not be
  // resurrected from the snapshot as though they were still holding it.
  //
  // `gate` has to be handed in rather than read off a row, because these are
  // precisely the parçalar with no row to read it from. It is the one field a
  // synthesised row cannot derive, and the one every caller acting on a parça
  // needs: a project can carry both a demo and an ozalit round, and the gate is
  // what says which sheet a button opens. Left undefined, `gate === 'ozalit'`
  // checks downstream silently take the demo branch — opening the wrong sheet
  // on an ozalit round.
  const known = new Set((rows ?? []).map((r) => r?.parca).filter(Boolean))
  const untouched = parcaNames(snapshotParcalar)
    .filter((parca) => !known.has(parca))
    .map((parca) => ({
      parca, gate, state: 'with_matbaa', started_at: null, fix_pending: false,
    }))
  return { held: [...routed, ...untouched], untouched }
}

/**
 * @param {{
 *   rows: Array<{ parca: string, state?: string, started_at?: string|null,
 *                 fix_pending?: boolean, change_requested_at?: string|null,
 *                 change_requested_note?: string|null, attempt?: number }>,
 *   snapshotParcalar?: Array<string | { component?: string }>,
 *   gate?: 'demo' | 'ozalit',
 *   canAct?: boolean,
 *   busyParca?: string | null,
 *   onRequestChange: (parca: string, note: string) => void,
 *   onEditParca?: (parca: string, gate: string) => void,
 *   className?: string,
 * }} props
 */
export default function ParcaChangeRequestPanel({
  rows = [], snapshotParcalar = [], gate = null, canAct = false, busyParca = null,
  onRequestChange, onEditParca, className,
}) {
  const { held, untouched } = heldParcalar(rows, snapshotParcalar, gate)
  // Nothing to say on a round the matbaa isn't holding, or a single-parça one
  // where the header's own buttons already cover the whole sheet.
  if (held.length === 0 || (held.length === 1 && untouched.length === 1)) return null

  const locked = held.filter(parcaEditLocked)

  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Matbaadaki parçalar
        </p>
        {locked.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            <Printer className="h-3 w-3" />
            {locked.length} parça baskıda
          </span>
        )}
      </div>

      <div className="space-y-2">
        {held.map((row) => (
          <HeldRow
            key={row.parca}
            row={row}
            canAct={canAct}
            busy={busyParca === row.parca}
            onRequestChange={onRequestChange}
            onEditParca={onEditParca}
          />
        ))}
      </div>
    </div>
  )
}

/** One parça the matbaa holds, and whatever the leader may still do about it. */
function HeldRow({ row, canAct, busy, onRequestChange, onEditParca }) {
  // The ask form is opened per row rather than shown inline for every locked
  // parça: on a 390px screen three open textareas push the parça names off the
  // first screen, and the leader is normally asking about one of them.
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')

  const asked = !!row.change_requested_at
  const awaitingFix = !!row.fix_pending
  const canAsk = canAct && parcaChangeRequestable(row)
  // The free edit, and `parcaEditLocked` is the whole rule — the same predicate
  // the server's guard reads. It already selects exactly the two states where
  // the leader may still rewrite this parça: never started, and released by an
  // accepted change request. A started parça is locked, and an ASKED one is
  // locked too, because asking requires having started. So no separate
  // `!asked` term is needed here; adding one would only imply the states
  // overlap when they cannot.
  //
  // `awaitingFix` gets its own primary button above, so this is the other half.
  const canEdit = canAct && !!onEditParca && !awaitingFix && !parcaEditLocked(row)

  const status = awaitingFix
    ? {
      tone: 'border-blue-200 bg-blue-50/40',
      badge: 'bg-blue-50 text-blue-700 ring-blue-200',
      icon: Pencil,
      label: 'Talebiniz kabul edildi · düzeltmeyi gönderin',
    }
    : asked
      ? {
        tone: 'border-amber-200 bg-amber-50/40',
        badge: 'bg-amber-50 text-amber-700 ring-amber-200',
        icon: Hourglass,
        label: 'Değişiklik istendi · matbaanın yanıtı bekleniyor',
      }
      : row.started_at
        ? {
          tone: 'border-amber-200 bg-amber-50/40',
          badge: 'bg-amber-50 text-amber-700 ring-amber-200',
          icon: Printer,
          label: 'Baskıda · doğrudan düzenlenemez',
        }
        : {
          tone: 'border-border bg-muted/20',
          badge: 'bg-muted text-muted-foreground ring-border',
          icon: Send,
          label: 'Matbaada · henüz başlanmadı',
        }
  const StatusIcon = status.icon

  function submit() {
    onRequestChange?.(row.parca, note.trim())
    setAsking(false)
    setNote('')
  }

  return (
    <div className={cn('rounded-lg border p-3', status.tone)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
        {/* Wraps rather than truncates — the parça name is the subject of the
            row, and a clipped one is the wrong thing to ask about. */}
        <span className="text-sm font-medium text-foreground">{row.parca}</span>
        {row.attempt > 1 && (
          <Badge variant="outline" className="text-[10px]">{row.attempt}. tur</Badge>
        )}
      </div>

      <span className={cn(
        'mt-1.5 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        status.badge,
      )}>
        {status.label}
      </span>

      {/* Read back what was asked. The leader may have written it days ago on
          another device, and "waiting on the matbaa" means little without it. */}
      {asked && row.change_requested_note && (
        <p className="mt-1.5 text-xs italic leading-snug text-muted-foreground">
          “{row.change_requested_note}”
        </p>
      )}

      {awaitingFix && (
        <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
          Matbaa bu parçayı bıraktı ve düzeltilmiş formu bekliyor. Formu
          güncelleyip gönderene kadar yeniden başlayamazlar.
        </p>
      )}

      {/* The way to actually send it. Without this the row announced a debt
          and offered no means of paying it: the only route was the header's
          whole-sheet button, which opens all three parçalar and says nothing
          about which one the matbaa is waiting on. This opens the sheet on
          THIS parça, with the footer already set to notify.

          Primary, unlike the not-started edit below, because this one is OWED:
          the matbaa has stopped and cannot restart until it lands. */}
      {canAct && awaitingFix && onEditParca && (
        <Button
          size="sm"
          className="mt-2.5 w-full gap-1.5 sm:w-auto"
          disabled={busy}
          onClick={() => onEditParca(row.parca, row.gate)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {row.parca} Formunu Düzenleyin
        </Button>
      )}

      {/* The free edit, per parça. The matbaa has this parça but has not
          started it, so the leader may still correct it outright — the same
          window the header's whole-sheet button has always covered.
          Per-parça because that is the granularity the rest of this panel
          already speaks in: a row that says "henüz başlanmadı" and offers
          nothing sends the leader back to a button that opens all three
          parçalar and names none of them.

          Outline, not primary: nothing is owed here. Compare the fix above,
          which the matbaa is actively waiting on. */}
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2.5 w-full gap-1.5 sm:w-auto"
          disabled={busy}
          onClick={() => onEditParca(row.parca, row.gate)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {row.parca} Formunu Düzenleyin
        </Button>
      )}

      {canAsk && !asking && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2.5 w-full gap-1.5 sm:w-auto"
          disabled={busy}
          onClick={() => setAsking(true)}
        >
          <MessageSquareWarning className="h-3.5 w-3.5" />
          Değişiklik İste
        </Button>
      )}

      {canAsk && asking && (
        <div className="mt-2.5 space-y-2">
          {/* Optional, exactly as the project-level request's note is. A leader
              who is standing next to the printer should not be blocked on
              typing what they just said out loud — but the field leads,
              because a note is what makes the answer anything but a guess. */}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={`${row.parca} için neyin değişmesi gerektiğini yazın…`}
            className="text-sm"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button size="sm" className="w-full gap-1.5" disabled={busy} onClick={submit}>
              <MessageSquareWarning className="h-3.5 w-3.5" />
              {busy ? 'Gönderiliyor…' : 'Talebi Gönderin'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              disabled={busy}
              onClick={() => { setAsking(false); setNote('') }}
            >
              Vazgeçin
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
