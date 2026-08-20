import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, Package, Eye, CheckCircle2, FileText } from 'lucide-react'
import { toast } from 'sonner'

import api, { ORDER_STEP_LABELS, ORDER_LEADER_ACTION_STEPS } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import TalepSignDialog, { TalepHistoryViewer } from '@/components/TalepSignDialog'
import SiparisBaskiOnayFormDialog from '@/components/SiparisBaskiOnayFormDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import { cn, formatNumber } from '@/lib/utils'

// Statuses that the team leader acts on — centralized in domain/constants/
// orders.js (ORDER_LEADER_ACTION_STEPS) so this page and AppShell's nav
// badge don't maintain two independent hardcoded copies.
const LEADER_ACTION_STEPS = ORDER_LEADER_ACTION_STEPS

const STATUS_BADGE = {
  pending:             'bg-amber-50 text-amber-700 border-amber-200',
  goruldu:             'bg-blue-50 text-blue-700 border-blue-200',
  tasarimci_onay:      'bg-indigo-50 text-indigo-700 border-indigo-200',
  ekran_onay:          'bg-cyan-50 text-cyan-700 border-cyan-200',
  matbaa_onay:         'bg-violet-50 text-violet-700 border-violet-200',
  siparis_baski_onay:  'bg-purple-50 text-purple-700 border-purple-200',
  onaylandi:           'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export default function SiparisTalepleri() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('action')
  const [signOrder, setSignOrder] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)
  const [ozalitProject, setOzalitProject] = useState(null)
  const [baskiOnayOrder, setBaskiOnayOrder] = useState(null)

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

  // siparis_baski_onay approve closes the form dialog itself and reports
  // back here (mirrors handleSigned) — a bare PATCH /advance can't move
  // this step, it requires the dedicated form-fill-then-approve routes.
  function handleBaskiOnayApproved(updated) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    if (updated.status !== 'siparis_baski_onay') setBaskiOnayOrder(null)
  }

  // "Teslim Alındı" closes its own (compact) dialog — this just keeps the
  // held row in sync so the card's button flips to "Onayla" (see
  // TalepSignDialog's onUpdated contract).
  function handleUpdated(updated) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    setSignOrder(updated)
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
          <h1 className="text-2xl font-semibold tracking-tight">Baskı Talepleri</h1>
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
                onBaskiOnay={() => setBaskiOnayOrder(r)}
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
      <SiparisBaskiOnayFormDialog
        order={baskiOnayOrder}
        open={!!baskiOnayOrder}
        onOpenChange={(v) => !v && setBaskiOnayOrder(null)}
        onApproved={handleBaskiOnayApproved}
      />
    </>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function RequestCard({ request, onSign, onView, onOzalit, onBaskiOnay }) {
  const navigate = useNavigate()
  const statusBadge = STATUS_BADGE[request.status] ?? ''
  const statusLabel = ORDER_STEP_LABELS[request.status] ?? request.status
  const items = normalizeItems(request.items, request.quantity)
  const needsLeaderAction = LEADER_ACTION_STEPS.has(request.status)
  // siparis_baski_onay has no bare "click to advance" action — it needs the
  // print-spec form filled in first, so it opens a different dialog
  // (SiparisBaskiOnayFormDialog) than every other leader-action step.
  const isBaskiOnayStep = request.status === 'siparis_baski_onay'

  const date = request.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(request.created_at))
    : '—'

  // matbaa_onay is multi-party now — a single click here is one vote, not
  // necessarily the final one (see TalepSignDialog's isMatbaaOnayStep note).
  const actionLabel = request.status === 'pending'
    ? 'Tasarımcıya Aktarın'
    : isBaskiOnayStep
      ? 'Baskı Onay Formu'
      : 'Onaylayın'

  return (
    <Card
      tabIndex={0}
      aria-label={`${request.project_title} – proje detaylarını aç`}
      className={cn(
        'cursor-pointer transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        needsLeaderAction && 'border-amber-200',
      )}
      onClick={() => navigate(`/projects/${request.project_id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/projects/${request.project_id}`)
        }
      }}
    >
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
                    <span className="font-normal text-primary/70">· {formatNumber(item.quantity)}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">{formatNumber(request.quantity)} adet</p>
            )}

            {request.notes && (
              <p className="text-xs text-muted-foreground">Not: {request.notes}</p>
            )}

            <p className="text-xs text-muted-foreground">{date}</p>
          </div>

          <div className="flex w-full flex-col items-end gap-2 sm:w-auto sm:shrink-0">
            <Badge variant="outline" className={cn('text-[11px]', statusBadge)}>
              {statusLabel}
            </Badge>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onView() }}>
                <Eye className="h-3.5 w-3.5" />
                Talep
              </Button>
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onOzalit() }}>
                <FileText className="h-3.5 w-3.5" />
                Ozalit Formu
              </Button>
              {needsLeaderAction && (
                <Button
                  size="sm"
                  variant="default"
                  className={cn(request.status === 'pending' && 'bg-amber-500 text-white shadow-sm hover:bg-amber-600')}
                  onClick={(e) => { e.stopPropagation(); (isBaskiOnayStep ? onBaskiOnay : onSign)() }}
                >
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

