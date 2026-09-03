import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, Package, Inbox, FileText } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import TalepSignDialog from '@/components/TalepSignDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import { canApproveMatbaaOnayNow, isOrderAssignedToDesigner, orderOzalitFormMode } from '@/domain/constants/orders'
import { cn, formatNumber } from '@/lib/utils'

export default function SiparisOnay() {
  const { user } = useAuth()
  const { projects } = useProjects()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [signOrder, setSignOrder] = useState(null)
  // This sipariş's OWN Ozalit Üretim Formu (migration 053) — the same
  // component and the same reçete source the project pipeline uses, kept
  // under the order's id so its round number and its İSTEM/TESLİM/ONAY
  // stamps belong to this reprint and not to the product at large. It used
  // to open the PROJECT's sheet read-only, which showed whatever the last
  // project round said, no matter what this order was sent with.
  const [ozalitFor, setOzalitFor] = useState(null) // { order, project }

  async function openOzalit(order) {
    try {
      setOzalitFor({ order, project: await api.getProject(order.project_id) })
    } catch {
      toast.error('Ozalit formu açılamadı.')
    }
  }

  // Fallback only — see isOrderAssignedToDesigner. Orders carry their own
  // assignee list; this covers legacy rows written before that was populated.
  const myProjectIds = useMemo(
    () => new Set(projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user?.id)).map((p) => p.id)),
    [projects, user?.id],
  )

  // Does this order still owe THIS designer something? Extracted so the
  // initial fetch and the in-place updates below can't drift apart — the
  // ozalit form completes rounds as well as mutating them, and an order it
  // sent on to Baskı Onayı has to leave the queue.
  const belongsHere = useMemo(() => (r) => {
    if (!isOrderAssignedToDesigner(r, user?.id, myProjectIds)) return false
    // The designer's two steps (migration 054): the checks, then the ozalit
    // request. Both are theirs, so both stay in the queue.
    if (r.status === 'tasarimciya_atandi' || r.status === 'kontroller_tamam') return true
    // imza_bekleniyor is multi-party — stay in the queue until THIS designer has
    // approved, even if a leader already has.
    if (r.status === 'imza_bekleniyor') {
      return !(r.matbaa_approvals ?? []).some((a) => a.id === user?.id)
    }
    return false
  }, [myProjectIds, user?.id])

  useEffect(() => {
    api.listOrderRequests()
      .then((reqs) => setOrders(reqs.filter(belongsHere)))
      .finally(() => setLoading(false))
  }, [belongsHere])

  function handleSigned(updated) {
    // Merge, then re-apply the queue rule rather than dropping the row
    // outright: signing the checks step advances the order to
    // 'kontroller_tamam', which is still this designer's — the card has to
    // stay and flip its button to "Ozalit İsteyin" (same shape as
    // handleOzalitDone below).
    setOrders((prev) => prev
      .map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
      .filter(belongsHere))
    setSignOrder(null)
  }

  // "Teslim Alındı" doesn't remove the order from the queue — it just
  // updates the held order in place so the card's button flips to "Onayla"
  // (see TalepSignDialog's onUpdated contract; the dialog itself closes).
  function handleUpdated(updated) {
    setOrders((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
    setSignOrder((prev) => (prev ? { ...prev, ...updated } : updated))
  }

  /**
   * The ozalit sheet reports back for both kinds of outcome: an in-place one
   * ("Teslim Alındı", one vote of a multi-party approval, a correction) and
   * a completing one (the last approval sends the order to Baskı Onayı).
   * Merge either way, keep the open dialog on the fresh row, then re-apply
   * the queue rule so a finished order doesn't linger as a dead card.
   */
  function handleOzalitDone(updated) {
    setOzalitFor((prev) => (prev ? { ...prev, order: { ...prev.order, ...updated } } : prev))
    setOrders((prev) => prev
      .map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
      .filter(belongsHere))
  }

  return (
    <>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Baskı Onayı</h1>
        </header>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="grid place-items-center gap-2 p-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Onay bekleyen baskı yok.</p>
              <p className="text-xs text-muted-foreground">
                Ekip lideri bir talebi onayına gönderdiğinde burada görünecek.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <DesignerOrderCard
                key={order.id}
                order={order}
                onSign={() => setSignOrder(order)}
                onOzalit={() => openOzalit(order)}
              />
            ))}
          </div>
        )}
      </div>

      <TalepSignDialog
        order={signOrder}
        open={!!signOrder}
        onOpenChange={(v) => !v && setSignOrder(null)}
        onSigned={handleSigned}
        onUpdated={handleUpdated}
      />
      <OzalitFormDialog
        open={!!ozalitFor}
        onOpenChange={(v) => !v && setOzalitFor(null)}
        project={ozalitFor?.project}
        order={ozalitFor?.order}
        mode={orderOzalitFormMode(ozalitFor?.order, user)}
        onDone={handleOzalitDone}
      />
    </>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function DesignerOrderCard({ order, onSign, onOzalit }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const items = normalizeItems(order.items, order.quantity)
  const date = order.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(order.created_at))
    : '—'

  // Find the görüldü step to show who signed it
  const tasarimciya_atandiStep = (order.order_history ?? []).find((h) => h.step === 'tasarimciya_atandi')
  // imza_bekleniyor is a different action from the designer's own two steps —
  // here they approve a delivered ozalit, not edit the spec or request one.
  const isMatbaaOnay = order.status === 'imza_bekleniyor'
  // "Ozalit İsteyin" — the designer's second step, which opens the ozalit
  // sheet itself (mode 'advance', see orderOzalitFormMode) instead of the
  // sign dialog.
  const isOzalitRequest = order.status === 'kontroller_tamam'
  // Leader-first: once the ozalit is received, a designer can't approve
  // until a team leader already has (see canApproveMatbaaOnayNow). Hide
  // "Onayla" rather than show a button that just bounces off the dialog's
  // own gate.
  const signLabel = order.status === 'tasarimciya_atandi'
    ? 'Kontrolleri Yapın'
    : order.status === 'kontroller_tamam'
      ? 'Ozalit İsteyin'
      : !order.matbaa_received ? 'Teslim Alın' : 'Onaylayın'
  const canAct = !isMatbaaOnay || !order.matbaa_received || canApproveMatbaaOnayNow(user, order)

  return (
    <Card
      tabIndex={0}
      aria-label={`${order.project_title} – proje detaylarını aç`}
      className="cursor-pointer border-amber-200 transition-colors hover:border-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => navigate(`/projects/${order.project_id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/projects/${order.project_id}`)
        }
      }}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <Package className="h-5 w-5 text-amber-600" />
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="font-semibold leading-snug">
              {order.project_title?.replace(/ \/ /g, ' ')}
            </p>
            <p className="text-sm text-muted-foreground">
              Talep eden: {order.requested_by_name} · {date}
            </p>

            {items.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {items.map((item) => (
                  <span
                    key={item.name}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
                  >
                    {item.name}
                    <span className="font-normal text-primary/70">
                      · {formatNumber(item.quantity)}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">{formatNumber(order.quantity)} adet</p>
            )}

            {order.notes && (
              <p className="text-xs text-muted-foreground">Not: {order.notes}</p>
            )}

            {tasarimciya_atandiStep && (
              <p className="text-xs text-blue-600">
                ✓ {tasarimciya_atandiStep.signed_by_name} tarafından görüldü
                {tasarimciya_atandiStep.notes ? `, "${tasarimciya_atandiStep.notes}"` : ''}
              </p>
            )}
          </div>

          <div className="flex w-full flex-col items-end gap-2 sm:w-auto sm:shrink-0">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[11px]">
              {isMatbaaOnay
                ? 'Matbaa Onayı Bekliyor'
                : order.status === 'kontroller_tamam' ? 'Ozalit İsteği Bekliyor' : 'Onay Bekliyor'}
            </Badge>
            <div className="flex flex-wrap justify-end gap-1.5">
              {/* At the request step the primary button opens this very sheet
                  (to be filled in and sent), so a second button onto it would
                  just be the same door twice. */}
              {!isOzalitRequest && (
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onOzalit() }}>
                  <FileText className="h-3.5 w-3.5" />
                  Ozalit Formu
                </Button>
              )}
              {canAct ? (
                <Button
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); if (isOzalitRequest) onOzalit(); else onSign() }}
                >
                  {signLabel}
                </Button>
              ) : (
                <span className="flex items-center px-2.5 text-xs text-muted-foreground">
                  Lider onayı bekleniyor
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
