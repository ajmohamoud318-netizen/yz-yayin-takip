import { useEffect, useState } from 'react'
import { Package, Eye } from 'lucide-react'

import api, { ORDER_STEP_LABELS } from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TalepHistoryViewer } from '@/components/TalepSignDialog'
import { cn } from '@/lib/utils'

const STATUS_BADGE = {
  pending:        'bg-amber-50 text-amber-700 border-amber-200',
  goruldu:        'bg-blue-50 text-blue-700 border-blue-200',
  tasarimci_onay: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  matbaa_onay:    'bg-violet-50 text-violet-700 border-violet-200',
  onaylandi:      'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const STEP_ORDER = ['pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']

export default function SiparisListesi() {
  const { user } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewOrder, setViewOrder] = useState(null)

  useEffect(() => {
    api.listOrderRequests()
      .then((reqs) => {
        setRequests(reqs.filter((r) => r.requested_by === user?.id || r.requested_by === 'u-esra'))
      })
      .finally(() => setLoading(false))
  }, [user?.id])

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Taleplerim
            {pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 align-middle">
                {pendingCount} beklemede
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gönderdiğiniz sipariş taleplerinin durumu. Yeni sipariş vermek için Ürünler sayfasını kullanın.
          </p>
        </header>

        {requests.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Henüz sipariş talebiniz yok.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} onView={() => setViewOrder(r)} />
            ))}
          </div>
        )}
      </div>

      <TalepHistoryViewer
        order={viewOrder}
        open={!!viewOrder}
        onOpenChange={(v) => !v && setViewOrder(null)}
      />
    </>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function RequestRow({ request, onView }) {
  const statusBadge = STATUS_BADGE[request.status] ?? ''
  const statusLabel = ORDER_STEP_LABELS[request.status] ?? request.status
  const date = request.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(request.created_at))
    : '—'
  const items = normalizeItems(request.items, request.quantity)
  const completedSteps = (request.order_history ?? []).length
  const totalSteps = STEP_ORDER.length

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onView() } }}
      className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardContent className="p-3">
        <div className="flex flex-wrap items-start gap-3">
          <Package className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium sm:truncate">{request.project_title?.replace(/ \/ /g, ' ')}</p>
            {items.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground">· {item.quantity.toLocaleString('tr-TR')} adet</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-xs">
                <span className="font-medium text-foreground">{request.quantity?.toLocaleString('tr-TR')} adet</span>
              </p>
            )}
            {request.notes && <p className="mt-1 text-xs text-muted-foreground">{request.notes}</p>}

            {/* Mini-pipeline progress */}
            <div className="mt-2 flex items-center gap-1">
              {STEP_ORDER.map((step, i) => {
                const done = (request.order_history ?? []).some((h) => h.step === step)
                return (
                  <div key={step} className="flex items-center">
                    <div className={cn('h-2 w-2 rounded-full', done ? 'bg-emerald-500' : 'bg-muted-foreground/20')} />
                    {i < STEP_ORDER.length - 1 && (
                      <span className={cn('mx-0.5 h-px w-3 shrink-0', done ? 'bg-emerald-300' : 'bg-border')} />
                    )}
                  </div>
                )
              })}
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                {completedSteps}/{totalSteps}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', statusBadge)}>{statusLabel}</Badge>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{date}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); onView() }}>
                <Eye className="h-3 w-3" />
                Form
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
