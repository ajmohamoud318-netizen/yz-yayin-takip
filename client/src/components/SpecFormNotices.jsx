import { ArrowRight, Check, CheckCircle2, FileText, Minus, Pencil, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Everything SpecFormDialog says AROUND the sheet — split out of it (slice:
 * client god-components).
 *
 * Three bands, in the order they appear: what this dialog was opened FOR
 * (SpecFormIntro), what has been changed on it (SpecChangeSummary), and what
 * stands between the user and the buttons (SpecFormGates). None of them own
 * state or decide anything; the dialog resolves every gate and passes the
 * answer down.
 */

/**
 * Why this dialog is open, when the reason isn't the ordinary one: the
 * designer's own ozalit request, or a leader reviewing a sheet on its way
 * back to matbaa.
 */
export function SpecFormIntro({ authoringOrderOzalit, order, rejectContext }) {
  return (
    <>
      {/* The designer's ozalit request (migration 054). The checks are
          already signed off one step back; this sheet is the ask itself, so
          say what pressing send does — and name the second route when the
          order has bounced back and both are on offer. */}
      {authoringOrderOzalit && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-semibold text-foreground">Ozalit isteği</p>
          <p className="mt-0.5 text-muted-foreground">
            Kontrolleriniz kaydedildi. Formu gözden geçirin, gerekirse düzeltin ve gönderin — matbaa
            ozaliti bu formdan basacak.
            {order?.last_reject_type === 'designer'
              && ' Revize sonrası olduğu için, fiziksel ozalit yerine ekip liderinden ekran onayı da isteyebilirsiniz.'}
          </p>
        </div>
      )}

      {/* Reject-to-matbaa review (ApprovalDialog hand-off) — the leader is
          about to send this sheet back to matbaa for redelivery; make that
          explicit and show the reason they just typed. */}
      {rejectContext && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-semibold text-destructive">Matbaaya yeniden gönderilecek</p>
          <p className="mt-0.5 text-muted-foreground">
            Göndermeden önce formu gözden geçirin. Red sebebi: <span className="italic">"{rejectContext.reason}"</span>
          </p>
        </div>
      )}
    </>
  )
}

/**
 * Migration 049 — only rendered on the dedicated "Gönderilen Demoyu/Ozaliti
 * Düzenleyin" path (notifyOnSave), diffed against what the matbaa currently
 * has. Empty diff (nothing edited yet) stays hidden rather than showing an
 * empty box.
 */
export function SpecChangeSummary({ changeSummary }) {
  if (!changeSummary || changeSummary.length === 0) return null
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Pencil className="h-3 w-3 text-primary" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Değişiklikler
        </p>
        <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
          {changeSummary.length}
        </span>
      </div>
      <ul className="space-y-1">
        {changeSummary.map((c, i) => (
          <li
            key={i}
            className="flex items-center gap-2 rounded-md border border-black/5 bg-white px-2.5 py-1.5 text-[13px] shadow-sm"
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                c.status === 'removed' && 'bg-rose-100 text-rose-600',
                c.status === 'added' && 'bg-emerald-100 text-emerald-600',
                c.status === 'changed' && 'bg-amber-100 text-amber-600',
              )}
            >
              {c.status === 'removed' && <Minus className="h-2.5 w-2.5" />}
              {c.status === 'added' && <Plus className="h-2.5 w-2.5" />}
              {c.status === 'changed' && <Pencil className="h-2.5 w-2.5" />}
            </span>
            <span className="min-w-0 shrink-0 font-semibold text-foreground/80">{c.label}</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 text-right">
              {c.status === 'changed' && (
                <span className="truncate rounded bg-rose-50 px-1.5 py-0.5 text-rose-600 line-through decoration-rose-400">
                  {c.oldValue}
                </span>
              )}
              {c.status === 'changed' && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              {c.status !== 'removed' && (
                <span className="truncate rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                  {c.newValue}
                </span>
              )}
              {c.status === 'removed' && (
                <span className="truncate rounded bg-rose-50 px-1.5 py-0.5 text-rose-600 line-through decoration-rose-400">
                  {c.oldValue}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The gates between this sheet and the footer's buttons: what has to happen
 * first (ozalit teslim alındı, baskı onay hazırlığı), what has already
 * happened that takes editing away (matbaa started, a fix is owed), and what
 * is still blank.
 */
export function SpecFormGates({
  variant,
  project,
  user,
  round,
  readOnly,
  isOzalitApproval,
  ozalitReceived,
  ozalitAwaitingLeader,
  canAckOzalit,
  confirmReceive,
  onConfirmReceive,
  onCancelReceive,
  onReceiveOzalit,
  receiving,
  isBaskiOnayApproval,
  baskiOnayPrepared,
  lockedByStart,
  lockedByFixPending,
  onStartWork,
  missingRequired,
}) {
  return (
    <>
      {/* Ozalit receipt gate — the approve below stays disabled until the
          proof is acknowledged. The confirm is inline (a second click on the
          same spot) rather than a nested dialog. */}
      {isOzalitApproval && (
        ozalitReceived ? (
          ozalitAwaitingLeader ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <Check className="h-4 w-4 shrink-0" />
              <span>
                Ozalit teslim alındı{round.receivedBy ? `, ${round.receivedBy}` : ''}.
                Onay sırası ekip liderinde, o onayladıktan sonra onaylayabilirsiniz.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
              <Check className="h-4 w-4 shrink-0" />
              <span>
                Ozalit teslim alındı{round.receivedBy ? `, ${round.receivedBy}` : ''}. Onaylayabilirsiniz.
              </span>
            </div>
          )
        ) : (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p>
              Onaydan önce ozalit teslim alınıp <strong>"Teslim Alındı"</strong> olarak
              işaretlenmelidir (atanmış tasarımcı veya ekip lideri).
            </p>
            {canAckOzalit && (
              confirmReceive ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">Ozaliti teslim aldınız mı?</span>
                  <Button type="button" size="sm" variant="success" onClick={onReceiveOzalit} disabled={receiving}>
                    <Check className="h-4 w-4" />
                    {receiving ? 'İşleniyor…' : 'Evet, teslim aldım'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onCancelReceive} disabled={receiving}>
                    Vazgeç
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={onConfirmReceive}>
                  <Check className="h-4 w-4" />
                  Teslim Alındı olarak işaretle
                </Button>
              )
            )}
          </div>
        )
      )}

      {/* Baskı Onayı dual-approval banner — mirrors the ozalit receipt gate's
          inline copy above. Prepared: names who did it (everyone, including
          the preparer, sees the same Onayla button below — the server is
          what actually refuses a same-person approve, see handleApprove /
          computeApproval). Not yet prepared: nudges toward Hazırla. */}
      {isBaskiOnayApproval && (
        baskiOnayPrepared ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
            <Check className="h-4 w-4 shrink-0" />
            <span>
              Baskı onay formunu {project?.baski_onay_prepared_by_name ?? 'bir ekip lideri'} hazırladı.
              Formu hazırlayandan başka bir ekip lideri onaylamalıdır.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <FileText className="h-4 w-4 shrink-0" />
            <span>Önce formu gözden geçirip "Hazırla ve Onaya Gönder" ile onaya açın.</span>
          </div>
        )
      )}

      {/* Matbaa "Başladım" gate (migration 048) — tells the leader/designer
          why this form suddenly stopped taking edits, and where to go
          instead. Only shown to the audience who'd otherwise expect to
          edit; the printer/team_leader-only variants already lock via
          isReadOnly for role reasons and don't need this. */}
      {/* canRequestDemoChange/canRequestOzalitChange are team-leader-only
          (same follow-up as cancel/edit-notify above) — the designer no
          longer has a "Değişiklik İste" button to be pointed at. */}
      {lockedByStart && user?.role === 'team_leader' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <FileText className="h-4 w-4 shrink-0" />
          <span>
            Matbaa {variant.kind === 'demo' ? 'demo' : 'ozalit'} çalışmasına başladı.
            Değişiklik yapmak için "Değişiklik İste" düğmesini kullanın.
          </span>
        </div>
      )}
      {lockedByStart && user?.role === 'designer' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <FileText className="h-4 w-4 shrink-0" />
          <span>
            Matbaa {variant.kind === 'demo' ? 'demo' : 'ozalit'} çalışmasına başladı.
            Değişiklik için ekip liderine bildirin.
          </span>
        </div>
      )}

      {/* Migration 049 (+ team-leader-only follow-up): the matbaa accepted
          a change request and is waiting on the fix. Only the team leader
          can act on it (canEditSentDemoRequest/canEditSentOzalitRequest),
          so only they get pointed at the button — telling a designer to
          click something they don't have would just be confusing. */}
      {lockedByFixPending && user?.role === 'team_leader' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <Pencil className="h-4 w-4 shrink-0" />
          <span>
            Matbaa değişiklik talebinizi kabul etti ve düzeltmenizi bekliyor.
            Düzeltmeyi yapmak için "{variant.kind === 'demo' ? 'Gönderilen Demoyu Düzenleyin' : 'Gönderilen Ozaliti Düzenleyin'}" düğmesini kullanın.
          </span>
        </div>
      )}
      {lockedByFixPending && user?.role === 'designer' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <Pencil className="h-4 w-4 shrink-0" />
          <span>
            Matbaa değişiklik talebinizi kabul etti, ekip lideri düzeltmeyi bekliyor.
          </span>
        </div>
      )}

      {/* Printer reviews the spec sheet before marking demo/ozalit started —
          İşlemi Başlatın below locks the leader/designer's free cancel/edit
          behind a change-request (migration 048), so this warns them here
          rather than only after the fact. */}
      {onStartWork && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            İşlemi başlattığınızda, ekip lideri veya tasarımcının iptal ya da düzenleme yapması
            sizin onayınızı gerektiren bir değişiklik talebine dönüşür.
          </span>
        </div>
      )}

      {/* Says which required field is still blank, right above the buttons
          it disables — the red row wash upstream marks the field itself.
          Shown on the read-only ozalit approve too: the sheet is locked there
          (VARIANTS.ozalit.isReadOnly), so a blank field is the matbaa's to fix
          and the leader would otherwise face a disabled Onaylayın with nothing
          explaining it. */}
      {missingRequired.length > 0 && (!readOnly || isOzalitApproval) && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <FileText className="h-4 w-4 shrink-0" />
          <span>
            {readOnly
              ? `Matbaadan gelen ozalitte ${missingRequired.join(' ve ')} boş. Bu form onay aşamasında düzenlenemez — "Reddedin" ile matbaaya geri gönderin.`
              : `${missingRequired.join(' ve ')} boş bırakılamaz. Formu göndermeden önce doldurun.`}
          </span>
        </div>
      )}
    </>
  )
}
