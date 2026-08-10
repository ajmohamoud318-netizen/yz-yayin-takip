import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { RotateCcw } from 'lucide-react'

import api, { STAGE_LABELS, TYPE_LABELS } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatDateTr } from '@/lib/utils'

export default function DeletedProjects() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProjects(await api.listDeletedProjects())
    } catch (err) {
      setError(err.message || 'Silinen projeler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function confirmRestore() {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      await api.restoreProject(restoreTarget.id)
      toast.success('Proje geri yüklendi.')
      setRestoreTarget(null)
      await load()
    } catch (err) {
      toast.error(err.message || 'Proje geri yüklenemedi.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl 3xl:max-w-[88rem] space-y-6 2xl:space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Silinen Projeler</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Silinen projeler burada listelenir ve geri yüklenebilir.
          </p>
        </header>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center">
            <p className="text-sm font-medium text-foreground">Silinen proje yok.</p>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="space-y-2 p-3 sm:hidden">
              {projects.map((p) => (
                <Card key={p.id}>
                  <CardContent className="space-y-2 p-3.5">
                    <p className="text-sm font-semibold leading-snug">{p.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {TYPE_LABELS[p.type]} · {STAGE_LABELS[p.stage] ?? p.stage}
                    </p>
                    <p className="text-[11px] text-muted-foreground/80">
                      {p.deleted_by_name ?? 'Bilinmiyor'} tarafından {formatDateTr(p.deleted_at)} silindi
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setRestoreTarget(p)}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Geri Yükle
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Proje</th>
                    <th className="px-4 py-2.5 font-medium">Tür</th>
                    <th className="px-4 py-2.5 font-medium">Aşama</th>
                    <th className="px-4 py-2.5 font-medium">Silen</th>
                    <th className="px-4 py-2.5 font-medium">Silinme Tarihi</th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 font-medium text-foreground">{p.title}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                          {TYPE_LABELS[p.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {STAGE_LABELS[p.stage] ?? p.stage}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.deleted_by_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTr(p.deleted_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setRestoreTarget(p)}>
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Geri Yükle
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(v) => !v && setRestoreTarget(null)}
        title="Projeyi geri yükle"
        description={restoreTarget ? `"${restoreTarget.title}" geri yüklenecek ve tekrar aktif projeler arasında görünecek.` : ''}
        confirmLabel="Geri Yükle"
        cancelLabel="Vazgeç"
        busy={restoring}
        busyLabel="Geri yükleniyor…"
        onConfirm={confirmRestore}
      />
    </>
  )
}
