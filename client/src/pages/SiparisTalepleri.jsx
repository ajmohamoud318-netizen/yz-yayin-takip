import { useEffect, useState } from 'react'
import { ShoppingCart, Package, Eye, PenLine, CheckCircle2, FileText } from 'lucide-react'
import { toast } from 'sonner'

import api, { ORDER_STEP_LABELS, ORDER_STEP_NEXT } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import TalepSignDialog, { TalepHistoryViewer } from '@/components/TalepSignDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import { cn } from '@/lib/utils'

// Statuses that the team leader acts on:
//   pending      → görüldü   (first acknowledgement)
//   matbaa_onay  → onaylandi (final approval, flips project to üretimde)
const LEADER_ACTION_STEPS = new Set(['pending', 'matbaa_onay'])

const STATUS_BADGE = {
  pending:        'bg-amber-50 text-amber-700 border-amber-200',
  goruldu:        'bg-blue-50 text-blue-700 border-blue-200',
  tasarimci_onay: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  matbaa_onay:    'bg-violet-50 text-violet-700 border-violet-200',
  onaylandi:      'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export default function SiparisTalepleri() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('action')
  const [signOrder, setSignOrder] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)
  const [ozalitProject, setOzalitProject] = useState(null)

  async function openOzalit(order) {
    try {
      setOzalitProject(await api.getProject(order.project_id))
    } catch {
      toast.error('Ozalit formu açılamadı.')
    }
  }

  useEffect(() => {
    api.listOrderRequests()
      .then(setRequests)
      .finally(() => setLoading(false))
  }, [])

  function handleSigned(updated) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    setSignOrder(null)
  }

  const actionCount = requests.filter((r) => LEADER_ACTION_STEPS.has(r.status)).length

  const filtered = requests.filter((r) => {
    if (tab === 'all') return true
    if (tab === 'action') return LEADER_ACTION_STEPS.has(r.status)
    if (tab === 'progress') return ['goruldu', 'tasarimci_onay'].includes(r.status)
    if (tab === 'done') return r.status === 'onaylandi'
    return r.status === tab
  })

  return (
    <>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Sipariş Talepleri</h1>
        </header>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="action">
              Eylem Gereken
              {actionCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  {actionCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="progress">Süreçte</TabsTrigger>
            <TabsTrigger value="done">Tamamlandı</TabsTrigger>
            <TabsTrigger value="all">Tümü</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <ShoppingCart className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Bu kategoride talep bulunmuyor.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                onSign={() => setSignOrder(r)}
                onView={() => setViewOrder(r)}
                onOzalit={() => openOzalit(r)}
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
      />
      <TalepHistoryViewer
        order={viewOrder}
        open={!!viewOrder}
        onOpenChange={(v) => !v && setViewOrder(null)}
      />
      <OzalitFormDialog
        open={!!ozalitProject}
        onOpenChange={(v) => !v && setOzalitProject(null)}
        project={ozalitProject}
        mode="view"
      />
    </>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function RequestCard({ request, onSign, onView, onOzalit }) {
  const statusBadge = STATUS_BADGE[request.status] ?? ''
  const statusLabel = ORDER_STEP_LABELS[request.status] ?? request.status
  const items = normalizeItems(request.items, request.quantity)
  const needsLeaderAction = LEADER_ACTION_STEPS.has(request.status)

  const date = request.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(request.created_at))
    : '—'

  const actionLabel = request.status === 'pending' ? 'Tasarımcıya Aktar' : 'Son Onay'

  return (
    <Card className={cn(needsLeaderAction && 'border-amber-200')}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            needsLeaderAction ? 'bg-amber-50' : 'bg-primary/10',
          )}>
            <Package className={cn('h-5 w-5', needsLeaderAction ? 'text-amber-600' : 'text-primary')} />
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="font-semibold leading-snug">{request.project_title?.replace(/ \/ /g, ' ')}</p>
            <p className="text-sm text-muted-foreground">Talep eden: {request.requested_by_name}</p>

            {items.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {items.map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                    {item.name}
                    <span className="font-normal text-primary/70">· {item.quantity.toLocaleString('tr-TR')}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">{request.quantity?.toLocaleString('tr-TR')} adet</p>
            )}

            {request.notes && (
              <p className="text-xs text-muted-foreground">Not: {request.notes}</p>
            )}

            <p className="text-xs text-muted-foreground">{date}</p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant="outline" className={cn('text-[11px]', statusBadge)}>
              {statusLabel}
            </Badge>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={onView}>
                <Eye className="h-3.5 w-3.5" />
                Talep
              </Button>
              <Button size="sm" variant="outline" onClick={onOzalit}>
                <FileText className="h-3.5 w-3.5" />
                Ozalit Formu
              </Button>
              {needsLeaderAction && (
                <Button
                  size="sm"
                  variant={request.status === 'matbaa_onay' ? 'default' : 'outline'}
                  onClick={onSign}
                >
                  <PenLine className="h-3.5 w-3.5" />
                  {actionLabel}
                </Button>
              )}
              {request.status === 'onaylandi' && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Tamamlandı
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

