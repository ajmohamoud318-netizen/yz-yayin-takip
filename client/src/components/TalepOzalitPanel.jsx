import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * The two step-state panels of TalepSignDialog — split out of it (slice:
 * client god-components).
 *
 * TalepOzalitPanel is the tasarimci_onay round: the printer's "İşlemi
 * Başlatın" and their answer to a change request, and the team leader's
 * cancel / save-edit / request-change — full parity with the main pipeline's
 * demo/ozalit started flow (migrations 048/049, order-scoped by 051).
 *
 * TalepMatbaaReceiptBanner is what the matbaa_onay approve is waiting on.
 *
 * Every gate arrives already resolved from the dialog, which also owns the
 * actions; these only say where the round stands.
 */
export function TalepOzalitPanel({
  order,
  user,
  ozalitBusy,
  ozalitStarted,
  ozalitChangePending,
  ozalitFixPending,
  canRespondOzalitChange,
  canRequestOzalitChange,
  canCancelOrEditOzalit,
  changeNote,
  onChangeNote,
  noCatalogChanges,
  onStartOzalit,
  onAcceptOzalitChange,
  onDeclineOzalitChange,
  onRequestOzalitChange,
  onCancelOzalit,
  onSaveOzalitEdit,
}) {
  return (
    <div className="space-y-2.5">
      {user?.role === 'printer' && !ozalitChangePending && (ozalitStarted || !ozalitFixPending) && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <span>
            {ozalitStarted
              ? 'İşe başladığınız işaretlendi.'
              : 'Fiziksel işe başladığınızda işaretleyin — ekip lideri bundan sonra iptal/düzenleme yerine değişiklik talebi gönderir.'}
          </span>
          {!ozalitStarted && (
            <Button type="button" size="sm" variant="outline" onClick={onStartOzalit} disabled={ozalitBusy}>
              {ozalitBusy ? 'İşleniyor…' : 'İşlemi Başlatın'}
            </Button>
          )}
        </div>
      )}
    
      {/* Fix owed, printer's turn to wait — the İşlemi Başlatın block
          above hides itself here, so without this the printer's
          panel goes silently empty with no clue why. */}
      {user?.role === 'printer' && !ozalitChangePending && !ozalitStarted && ozalitFixPending && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <Check className="h-4 w-4 shrink-0" />
          <span>Değişiklik talebini kabul ettiniz, ekip liderinin düzeltmeyi göndermesi bekleniyor.</span>
        </div>
      )}
    
      {canRespondOzalitChange && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p>
            Ekip lideri değişiklik istedi
            {order.ozalit_change_requested_note ? `: "${order.ozalit_change_requested_note}"` : '.'}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="destructive" onClick={onDeclineOzalitChange} disabled={ozalitBusy}>
              Reddedin
            </Button>
            <Button type="button" size="sm" variant="success" onClick={onAcceptOzalitChange} disabled={ozalitBusy}>
              Kabul Edin
            </Button>
          </div>
        </div>
      )}
    
      {user?.role === 'team_leader' && ozalitChangePending && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <Check className="h-4 w-4 shrink-0" />
          <span>Değişiklik talebiniz matbaada bekliyor.</span>
        </div>
      )}
    
      {canRequestOzalitChange && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            Matbaa ozalit çalışmasına başladı — doğrudan iptal veya düzenleme artık yapılamaz, bir değişiklik talebi gönderin.
          </p>
          <Textarea
            rows={2}
            placeholder="Değişiklik notu (isteğe bağlı)…"
            value={changeNote}
            onChange={(e) => onChangeNote(e.target.value)}
            className="resize-none text-sm"
          />
          <Button type="button" size="sm" variant="outline" onClick={onRequestOzalitChange} disabled={ozalitBusy}>
            {ozalitBusy ? 'Gönderiliyor…' : 'Değişiklik İsteyin'}
          </Button>
        </div>
      )}
    
      {/* Stacks on a phone: the two buttons now name their actions in
          full, and side-by-side they left the sentence beside them
          squeezed into a two-word-wide column at 390px. */}
      {canCancelOrEditOzalit && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Matbaa henüz başlamadı — ürün bilgilerini yukarıdan düzenleyip kaydedebilir, veya talebi doğrudan iptal edebilirsiniz.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button" size="sm" variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onCancelOzalit} disabled={ozalitBusy}
            >
              İptal Edin
            </Button>
            {/* onSaveOzalitEdit notifies the matbaa before it
                writes anything — the same action the spec form calls
                by this name, so it is called that here too. The button
                also short-circuits on a no-op open, so an unchanged
                catalog greys it out instead of letting a leader
                notify the matbaa with nothing to review. */}
            <Button
              type="button" size="sm" variant="outline"
              onClick={onSaveOzalitEdit}
              disabled={ozalitBusy || noCatalogChanges}
            >
              {ozalitBusy
                ? 'Gönderiliyor…'
                : noCatalogChanges
                  ? 'Değişiklik Yok'
                  : 'Düzeltmeyi Matbaaya Gönderin'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * matbaa_onay receipt gate — the approve button stays disabled until the
 * proof is acknowledged. The "not yet received" state itself is handled by
 * TalepSignDialog's compact early-return dialog; by the time this renders,
 * receipt has already been confirmed (or this is the reject flow, where the
 * gate is irrelevant and hidden).
 */
export function TalepMatbaaReceiptBanner({ order, matbaaAwaitingLeader, matbaaAlreadyApproved }) {
  return (
    matbaaAwaitingLeader ? (
      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <Check className="h-4 w-4 shrink-0" />
        <span>
          Matbaa ozaliti teslim alındı{order.matbaa_received_by ? `, ${order.matbaa_received_by}` : ''}.
          Onay sırası ekip liderinde, o onayladıktan sonra onaylayabilirsiniz.
        </span>
      </div>
    ) : matbaaAlreadyApproved ? (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
        <Check className="h-4 w-4 shrink-0" />
        <span>Onayınızı verdiniz, diğer onaylar bekleniyor.</span>
      </div>
    ) : (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
        <Check className="h-4 w-4 shrink-0" />
        <span>
          Matbaa ozaliti teslim alındı{order.matbaa_received_by ? `, ${order.matbaa_received_by}` : ''}. Onaylayabilirsiniz.
        </span>
      </div>
    )
  )
}
