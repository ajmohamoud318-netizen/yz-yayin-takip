import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import api from '@/api'
import { saveComponentsForProject } from '@/data/productCatalog'
import { stampSpecSignature } from '@/components/SpecFormDialog'

/**
 * Every action on a sipariş's OZALIT ROUND that isn't the step's own signature
 * — split out of TalepSignDialog.jsx (slice: client god-components).
 *
 * The printer's "İşlemi Başlatın" and their answer to a change request, the
 * team leader's cancel / edit / request-change, and the matbaa_onay receipt
 * gate. Full parity with the main pipeline's demo/ozalit started flow
 * (migrations 048/049), scoped to the order's own round (051).
 *
 * They share one busy flag on purpose: they are alternatives on the same
 * round, and any one of them in flight should quiet the rest.
 */
export function useOrderOzalitRound({ order, user, comps, originalRef, open, onSigned, onUpdated, onOpenChange }) {
  const [ozalitBusy, setOzalitBusy] = useState(false)
  const [changeNote, setChangeNote] = useState('')
  // matbaa_onay receipt gate — "Teslim Alındı" / "Teslim Alınamadı".
  const [matbaaBusy, setMatbaaBusy] = useState(false)
  const [confirmMatbaaNotReceived, setConfirmMatbaaNotReceived] = useState(false)

  // Each (re)open starts the receipt-gate confirm prompts collapsed — a
  // stale "are you sure" from a previously opened order shouldn't carry over.
  useEffect(() => {
    if (!open) return
    setConfirmMatbaaNotReceived(false)
  }, [open, order?.id])

  // Matbaa marks physical work begun — after this, the team leader's free
  // cancel/edit closes and a change request is required instead.
  async function handleStartOzalit() {
    setOzalitBusy(true)
    try {
      const updated = await api.startOrderOzalit(order.id)
      toast.success('Başlatıldı olarak işaretlendi.')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Team leader edits the product spec while it's still sitting with the
  // matbaa, pre-start — saves to the shared Ürün Bilgileri catalog (same
  // path the designer's own goruldu edit uses) and logs+notifies via the
  // dedicated route, since this step's generic submit belongs to the
  // printer (the owner of tasarimci_onay), not the leader.
  async function handleSaveOzalitEdit() {
    // Short-circuit when nothing was actually edited. `originalRef.current`
    // is the JSON snapshot taken when the dialog opened; comparing the live
    // `comps` against it is the same diff the main sign step uses (see
    // `compsChanged` below), so a leader who opens this dialog, doesn't
    // touch anything, and clicks "Düzeltmeyi Matbaaya Gönderin" no longer
    // re-stamps product_info's updated_by and pushes a notification with
    // nothing to review.
    const compsChanged = JSON.stringify(comps) !== originalRef.current
    if (!compsChanged) {
      toast.info('Değişiklik yapılmadı, matbaaya bildirim gönderilmedi.')
      onOpenChange(false)
      return
    }
    setOzalitBusy(true)
    try {
      // notifyOrderOzalitEdit runs computeOrderOzalitEdit, which refuses once
      // the matbaa has hit "Başladım" — so it goes FIRST. Writing the shared
      // catalog before it meant a leader whose page predated that click
      // changed the spec for good and got told only "İşlem başarısız", while
      // the printer worked on from the version they started with.
      const updated = await api.notifyOrderOzalitEdit(order.id)
      // Same shared, server-side catalog Ürün Bilgileri and the Demo/Ozalit
      // forms read from.
      await saveComponentsForProject(order.project_id, comps)
      toast.success('Ürün bilgileri güncellendi, matbaa bilgilendirildi.')
      onOpenChange(false)
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Team leader cancels a pending (not-yet-started) ozalit request outright
  // — closes the dialog and sends the order back to goruldu.
  async function handleCancelOzalit() {
    setOzalitBusy(true)
    try {
      const updated = await api.cancelOrderOzalit(order.id)
      toast.success('Ozalit talebi iptal edildi.')
      onOpenChange(false)
      onSigned?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Team leader asks the matbaa to accept a cancel/edit once they've already
  // started — doesn't close the dialog, the round stays at tasarimci_onay
  // either way until the printer responds.
  async function handleRequestOzalitChange() {
    setOzalitBusy(true)
    try {
      const updated = await api.requestOrderOzalitChange(order.id, changeNote.trim())
      toast.success('Değişiklik talebiniz matbaaya iletildi.')
      setChangeNote('')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Matbaa accepts the pending change-request — un-starts the round so the
  // leader's free cancel/edit reopens.
  async function handleAcceptOzalitChange() {
    setOzalitBusy(true)
    try {
      const updated = await api.acceptOrderOzalitChange(order.id)
      toast.success('Değişiklik talebi kabul edildi.')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Matbaa declines — round stays started, nothing else changes.
  async function handleDeclineOzalitChange() {
    setOzalitBusy(true)
    try {
      const updated = await api.declineOrderOzalitChange(order.id)
      toast.success('Değişiklik talebi reddedildi.')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // "Teslim Alındı" — the matbaa_onay receipt gate. This is a one-question
  // dialog (see the compact early-return render below), so it closes once
  // answered rather than chaining into the full approval form — approving is
  // a separate, deliberate action the user takes later via the list's own
  // "Onayla" button. Not onSigned: the order hasn't left the queue, just
  // picked up matbaa_received, so onUpdated pushes the fresh order back up
  // to keep the parent's list in sync.
  async function handleMatbaaReceive() {
    setMatbaaBusy(true)
    try {
      const updated = await api.matbaaReceiveOrder(order.id)
      // Same stamp the main pipeline's ozalit ack writes (SpecFormDialog's
      // handleReceiveOzalit): the acknowledgment is the sheet's TESLİM ALAN
      // KİŞİ row. This dialog signs the round without ever mounting the sheet,
      // so it has to write the stamp itself — the sipariş's sheet is keyed by
      // the ORDER, and stampSpecSignature only needs the project's id.
      stampSpecSignature('ozalit', { id: order.project_id }, {
        teslimAlanKisi: user?.name ?? '',
      }, { order }).catch(() => {})
      toast.success('Matbaa ozaliti teslim alındı.')
      onUpdated?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setMatbaaBusy(false)
    }
  }

  // "Teslim Alınamadı" — the counterpart. The order actually leaves
  // matbaa_onay here (back to tasarimci_onay for re-delivery), so this DOES
  // close the dialog and call onSigned, same as a rejection.
  async function handleMatbaaNotReceived() {
    setMatbaaBusy(true)
    try {
      const updated = await api.matbaaNotReceivedOrder(order.id)
      toast.success('Matbaa teslimi alınamadı, matbaaya geri gönderildi.')
      setConfirmMatbaaNotReceived(false)
      onOpenChange(false)
      onSigned?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setMatbaaBusy(false)
    }
  }

  return {
    ozalitBusy,
    changeNote,
    setChangeNote,
    matbaaBusy,
    confirmMatbaaNotReceived,
    setConfirmMatbaaNotReceived,
    handleStartOzalit,
    handleSaveOzalitEdit,
    handleCancelOzalit,
    handleRequestOzalitChange,
    handleAcceptOzalitChange,
    handleDeclineOzalitChange,
    handleMatbaaReceive,
    handleMatbaaNotReceived,
  }
}
