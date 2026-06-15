import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThumbsUp, ThumbsDown, Inbox, Send } from 'lucide-react'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import AppShell from '@/components/AppShell'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ApprovalDialog from '@/components/ApprovalDialog'
import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import { formatMonthYear } from '@/lib/utils'

/**
 * Approval queue.
 *  • Printer (matbaa): receives Demo/Özalit Teslim and forwards them to the
 *    team leader's approval.
 *  • Team leader: approves or rejects (reason required) at the *_Onay stages.
 */
export default function Approvals() {
  const { user } = useAuth()
  const { projects, loading } = useProjects()
  const [tab, setTab] = useState('demo')
  const [dialog, setDialog] = useState(null)
  const navigate = useNavigate()

  const isPrinter = user?.role === 'printer'

  const queue = useMemo(() => {
    return projects.filter((p) => {
      if (isPrinter) {
        if (p.type !== 'TR') return false
        if (tab === 'demo') return p.stage === 'demo_teslim'
        if (tab === 'ozalit') return p.stage === 'ozalit_teslim'
        return false
      }
      // team leader
      if (tab === 'demo') return p.stage === 'demo_onay' || p.stage === 'cin_demo_onay'
      if (tab === 'ozalit') return p.stage === 'ozalit_onay'
      return false
    })
  }, [projects, tab, isPrinter])

  function onDone() {
    // ApprovalDialog already called updateOne — global state is updated.
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Onay Kuyruğu</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isPrinter
              ? 'Demo ve Özalit teslimlerini alıp lider onayına gönderin.'
              : 'Matbaadan gelen demo ve özalit onaylarını değerlendirin.'}
          </p>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="demo">Demo</TabsTrigger>
            <TabsTrigger value="ozalit">Özalit</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <Card>
            <CardContent className="grid place-items-center gap-2 p-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Şu an bekleyen iş yok.</p>
              <p className="text-xs text-muted-foreground">Yeni bir teslim geldiğinde burada görünecek.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {queue.map((p) => (
              <Card key={p.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {p.assigned_name} · {formatMonthYear(p.target_month)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline">{TYPE_LABELS[p.type]}</Badge>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
                    <span className="font-medium">Aşama:</span> {STAGE_LABELS[p.stage]}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      Detay
                    </Button>
                    {isPrinter ? (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => setDialog({ project: p, mode: 'advance' })}
                      >
                        <Send className="h-4 w-4" />
                        Onaya Gönder
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1"
                          onClick={() => setDialog({ project: p, mode: 'reject' })}
                        >
                          <ThumbsDown className="h-4 w-4" />
                          Reddet
                        </Button>
                        <Button
                          size="sm"
                          variant="success"
                          className="flex-1"
                          onClick={() => setDialog({ project: p, mode: 'approve' })}
                        >
                          <ThumbsUp className="h-4 w-4" />
                          Onayla
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ApprovalDialog
        open={!!dialog}
        onOpenChange={(v) => setDialog(v ? dialog : null)}
        project={dialog?.project}
        mode={dialog?.mode ?? 'approve'}
        advanceLabel="Onaya Gönder"
        onDone={onDone}
      />
    </AppShell>
  )
}
