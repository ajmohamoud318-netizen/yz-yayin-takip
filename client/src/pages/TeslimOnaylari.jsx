import { useEffect, useState } from 'react'
import { ClipboardCheck, PackageCheck, CheckCircle2, Clock } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import OrderNoBadge from '@/components/OrderNoBadge'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ConfirmDialog from '@/components/ConfirmDialog'
import { cn } from '@/lib/utils'

const cleanTitle = (t) => String(t ?? '').replace(/ \/ /g, ' ')
const fmtDate = (iso) =>
  iso ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '—'

/**
 * Sales page: confirm receipt ("Alındı") of Matbaa's handover requests.
 *
 * Two kinds land here (migration 081), and confirming them means different
 * things — the card and the dialog have to say which:
 *
 *   • a PROJECT's teslim (`order_id` null) moves the book to Satışta. Still
 *     the only path to that stage.
 *   • a SİPARİŞ's teslim (`order_id` set) takes delivery of a reprint of a
 *     book already on sale. It closes the ORDER and deliberately leaves the
 *     project's stage exactly where it is.
 */
export default function TeslimOnaylari() {
  const [handovers, setHandovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')
  const [savingId, setSavingId] = useState(null)
  // Handover awaiting the "Alındı olarak işaretlensin mi?" confirmation.
  const [confirmH, setConfirmH] = useState(null)

  useEffect(() => {
    api.listHandovers()
      .then(setHandovers)
      .finally(() => setLoading(false))
  }, [])

  const pendingCount = handovers.filter((h) => h.status === 'pending').length
  const filtered = handovers.filter((h) => (tab === 'pending' ? h.status === 'pending' : h.status === 'received'))

  async function confirm(h) {
    setSavingId(h.id)
    try {
      // The endpoint takes no body — the confirming user is read from the
      // session header server-side. It answers { handover, project }, and
      // that `handover` carries only the base columns, so merge it over the
      // existing row instead of replacing it (the list rows also hold the
      // joined project_title / raised_by_name, which the reply omits).
      const { handover: updated } = await api.confirmHandover(h.id)
      setHandovers((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
      setConfirmH(null)
      toast.success(
        h.order_id
          // Not "satışa çıktı": the book has been on sale all along and this
          // path never touched its stage. Claiming otherwise would be the one
          // sentence on the page that is false.
          ? `${cleanTitle(h.project_title)} yeni baskısı teslim alındı.`
          : `${cleanTitle(h.project_title)} teslim alındı, satışa çıktı.`,
      )
    } catch (err) {
      toast.error(err?.message || 'Teslim onaylanamadı.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <div className="mb-2 inline-flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <ClipboardCheck className="h-4 w-4" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Teslim Onayları</h1>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">
            Bekleyen
            {pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="done">Teslim Alındı</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <PackageCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {tab === 'pending' ? 'Bekleyen teslim talebi yok.' : 'Henüz teslim alınan ürün yok.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((h) => (
            <ApprovalRow
              key={h.id}
              handover={h}
              saving={savingId === h.id}
              onConfirm={() => setConfirmH(h)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmH}
        onOpenChange={(v) => !v && setConfirmH(null)}
        title="Teslim alındı olarak işaretlensin mi?"
        description={
          confirmH
            ? confirmH.order_id
              ? `"${cleanTitle(confirmH.project_title)}" yeni baskısı teslim alındı olarak işaretlenecek ve baskı talebi kapanacak. Ürünün satış durumu değişmez. Bu işlem geri alınamaz. Devam edilsin mi?`
              : `"${cleanTitle(confirmH.project_title)}" teslim alındı olarak işaretlenecek ve ürün satışa çıkacak (Satışta). Bu işlem geri alınamaz. Devam edilsin mi?`
            : undefined
        }
        confirmLabel="Alındı"
        busyLabel="Onaylanıyor…"
        variant="success"
        busy={!!confirmH && savingId === confirmH.id}
        onConfirm={() => confirmH && confirm(confirmH)}
      />
    </div>
  )
}

function ApprovalRow({ handover: h, saving, onConfirm }) {
  const received = h.status === 'received'
  const isReprint = !!h.order_id
  return (
    <Card className={cn(!received && 'border-amber-200')}>
      {/* Phones: full title + full-width action stacked; ≥sm one line. */}
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full',
            received ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
          )}
        >
          {received ? <CheckCircle2 className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          {/* Never truncate the title to make room for the badge — it wraps
              underneath on a phone instead. */}
          <p className="text-sm font-semibold leading-snug sm:truncate">{cleanTitle(h.project_title)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {isReprint && (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                Yeni Baskı
              </span>
            )}
            {isReprint && <OrderNoBadge order={h} />}
            <span>Matbaa: {h.raised_by_name ?? '—'} · {fmtDate(h.created_at)}</span>
          </p>
        </div>
        {received ? (
          <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:self-auto">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {isReprint ? 'Teslim alındı' : 'Satışa çıktı'}
          </span>
        ) : (
          <Button size="sm" className="w-full sm:w-auto" onClick={onConfirm} disabled={saving}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {saving ? 'Onaylanıyor…' : 'Alındı'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
