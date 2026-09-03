import { Check, CheckCircle2, Pencil, Printer, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'

/**
 * SpecFormDialog's action bar — split out of it (slice: client
 * god-components).
 *
 * Which buttons exist is a function of the mode, the role and the gates the
 * dialog has already resolved; what each one DOES lives in the dialog. So this
 * file is the answer to one question only: given all that, what may be pressed
 * right now, and what does it promise? Every label reads off the same value
 * its handler uses, so a button cannot say one thing and do another.
 */
export default function SpecFormFooter({
  variant,
  user,
  order,
  mode,
  busy,
  readOnly,
  printable,
  missingRequired,
  incompleteSpec,
  onClose,
  onPrint,
  onSave,
  notifyEdit,
  noChangesToSend,
  onStartWork,
  startingWork,
  authoringOrderOzalit,
  rejectContext,
  onAdvance,
  isBaskiOnayApproval,
  baskiOnayPrepared,
  baskiOnayEditOverride,
  onToggleBaskiOnayEdit,
  onPrepareBaskiOnay,
  needsOzalitReceive,
  ozalitAwaitingLeader,
  onApprove,
}) {
  return (
    <DialogFooter className="flex-wrap gap-2">
      <Button type="button" variant="ghost" onClick={onClose}>
        {readOnly ? 'Kapatın' : 'İptal'}
      </Button>
      {printable && (
        <Button type="button" variant="outline" onClick={onPrint}>
          <Printer className="h-4 w-4" />
          Yazdırın
        </Button>
      )}
      {mode === 'view' && user?.role !== 'printer' && (!variant.saveRequiresEditable || !readOnly) && (
        <Button
          disabled={
            busy
            || missingRequired.length > 0
            // Only the save that SHIPS the sheet (notifyEdit) answers to the
            // completeness gate — a plain Kaydet parks a draft, which is
            // exactly what a leader working through the template needs.
            || (!!notifyEdit && incompleteSpec?.length > 0)
            // Once the diff is known to be empty, the matbaa notification
            // is meaningless; the handleSave guard catches the race where
            // someone clicks before this state lands.
            || noChangesToSend
          }
          onClick={onSave}
        >
          {notifyEdit ? <Send className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {busy
            ? (notifyEdit ? 'Gönderiliyor…' : 'Kaydediliyor…')
            : noChangesToSend
              ? 'Değişiklik Yok'
              : (notifyEdit ? 'Düzeltmeyi Matbaaya Gönderin' : 'Taslağı Kaydedin')}
        </Button>
      )}
      {mode === 'view' && onStartWork && (
        <Button variant="success" disabled={startingWork} onClick={onStartWork}>
          <CheckCircle2 className="h-4 w-4" />
          {startingWork ? 'İşleniyor…' : 'İşlemi Başlatın'}
        </Button>
      )}
      {/* Resubmit after a reject-to-designer: the same sheet can go to the
          matbaa for another physical ozalit (the primary button) or
          straight to the team leader as a digital Ekran Onayı. Only
          offered once the order has actually bounced back — a first
          request always takes the matbaa route. */}
      {mode === 'advance' && authoringOrderOzalit && order?.last_reject_type === 'designer' && (
        <Button
          type="button"
          variant="outline"
          disabled={busy || missingRequired.length > 0 || incompleteSpec?.length > 0}
          onClick={() => onAdvance('ekran_onayinda')}
        >
          {busy ? 'Gönderiliyor…' : 'Ekran Onayı İsteyin'}
        </Button>
      )}
      {mode === 'advance' && (
        <Button
          // Reject-to-matbaa confirms the rejection, not a new spec —
          // missing required fields in the original file are the matbaa's
          // problem on redelivery, not the leader's to refuse. Same
          // exemption handleAdvance applies at the handler level.
          //
          // incompleteSpec arrives already scoped to a composer on a
          // Demo / Ozalit sheet, so it needs no exemption of its own —
          // it is empty everywhere the gate should not apply.
          disabled={busy || (!rejectContext && missingRequired.length > 0) || incompleteSpec?.length > 0}
          onClick={() => onAdvance(authoringOrderOzalit && order?.last_reject_type === 'designer' ? 'matbaa_ozalit_yapiyor' : null)}
          variant={rejectContext ? 'destructive' : 'default'}
        >
          <Send className="h-4 w-4" />
          {busy
            ? 'Gönderiliyor…'
            : rejectContext ? 'Reddedin ve Gönderin'
              : authoringOrderOzalit ? 'Ozalit İsteyin'
                : variant.advanceLabel(user)}
        </Button>
      )}
      {isBaskiOnayApproval && !baskiOnayPrepared && (
        <Button disabled={busy || missingRequired.length > 0} onClick={onPrepareBaskiOnay}>
          <Send className="h-4 w-4" />
          {busy ? 'Kaydediliyor…' : 'Hazırlayın ve Onaya Gönderin'}
        </Button>
      )}
      {/* Baskı Onay approve step: the approver signs what was prepared, so the
          form is locked by default. This button lets them opt in to editing if
          they spot something that needs a fix before signing — and re-lock
          after. Never shown in the prepare step (baskiOnayPrepared === false),
          where the leader is meant to be authoring, not signing. */}
      {isBaskiOnayApproval && baskiOnayPrepared && (
        <Button type="button" variant="outline" onClick={onToggleBaskiOnayEdit} disabled={busy}>
          <Pencil className="h-4 w-4" />
          {baskiOnayEditOverride ? 'Kilitleyin' : 'Düzenleyin'}
        </Button>
      )}
      {mode === 'approve' && (!isBaskiOnayApproval || baskiOnayPrepared) && (
        <Button variant="success" disabled={busy || needsOzalitReceive || ozalitAwaitingLeader || missingRequired.length > 0} onClick={onApprove}>
          <Check className="h-4 w-4" />
          {busy ? 'İşleniyor…' : 'Onaylayın'}
        </Button>
      )}
    </DialogFooter>
  )
}
