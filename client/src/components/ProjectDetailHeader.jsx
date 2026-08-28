import { useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  Package,
  Pencil,
  Trash2,
  User as UserIcon,
} from 'lucide-react'

import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import StageBar from '@/components/StageBar'
import { cn, formatDateTr } from '@/lib/utils'
import { canActOnOrder, orderStepPath } from '@/domain/constants/orders'
import {
  DISPLAY_ORDER_STEP_LABELS, orderActionLabel,
} from '@/domain/services/project-detail'

import HeaderActionRow from '@/components/HeaderActionRow'
import HeaderBanners from '@/components/HeaderBanners'

// ---------------------------------------------------------------------------
// OrderProgressStepper — compact stepper for a single sipariş order
// ---------------------------------------------------------------------------

/**
 * Compact stepper for a single sipariş order's own steps (Talep →
 * Satışta) — separate from the project's main design/production pipeline
 * (StageBar), which doesn't move while an order is in flight and says
 * nothing about it. `sold` (project.stage === 'satista') and
 * `handoverPending` (Matbaa raised a teslim request Satış hasn't confirmed
 * yet) advance the two derived final steps as those real events actually
 * happen.
 */
function OrderProgressStepper({ order, sold, handoverPending, canAct, onAct }) {
  const displaySteps = [...orderStepPath(order), 'teslim_bekleniyor', 'satista']
  const currentIndex = sold
    ? displaySteps.length - 1
    : handoverPending
      ? displaySteps.length - 2
      : Math.max(0, displaySteps.indexOf(order.status))
  return (
    <div
      className={cn(
        'w-full rounded-lg border bg-background px-3 py-2.5 transition',
        canAct && 'border-amber-300 bg-amber-50/40',
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Package className="h-3.5 w-3.5" />
        Baskı Talebi
      </div>
      <ol className="flex items-center">
        {displaySteps.map((step, i) => {
          const done = i < currentIndex
          const current = i === currentIndex
          return (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                    done
                      ? 'bg-brand-500 text-white'
                      : current
                        ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span
                  className={cn(
                    'mt-1 max-w-[60px] text-center text-[9px] leading-tight',
                    current ? 'font-semibold text-brand-700' : 'text-muted-foreground',
                  )}
                >
                  {DISPLAY_ORDER_STEP_LABELS[step]}
                </span>
              </div>
              {i < displaySteps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn('mx-1.5 mb-4 h-0.5 flex-1', i < currentIndex ? 'bg-brand-500' : 'bg-muted')}
                />
              )}
            </li>
          )
        })}
      </ol>
      {canAct && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-[11px] font-medium text-amber-700">Aksiyon bekliyor</span>
          <Button
            size="sm"
            className="h-7 px-2.5"
            onClick={(e) => { e.stopPropagation(); onAct() }}
          >
            {orderActionLabel(order)}
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProjectDetailHeader — slim wrapper composing HeaderActionRow + HeaderBanners
// ---------------------------------------------------------------------------

/**
 * Receives the full `useProjectDetail` hook result as `d` to keep the prop
 * count manageable — the header is the largest UI section and touches most
 * of the hook's output.
 */
export default function ProjectDetailHeader({ d }) {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => {
    if (location.key !== 'default') {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  const {
    project, user, isLeader, isDeleted,
    trackedOrders, sold, handoverPending, fallbackProjectIds,
    openOrderAction,
    restoring, setEditOpen, handleRestore,
  } = d

  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={goBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Geri dön
        </Button>
      </div>

      {isDeleted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
          <div className="flex items-start gap-2">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm">
              Bu proje silindi{project.deleted_by_name ? `, ${project.deleted_by_name} tarafından` : ''}
              {project.deleted_at ? `, ${formatDateTr(project.deleted_at)}` : ''}
            </p>
          </div>
          {isLeader && (
            <Button size="sm" variant="outline" onClick={handleRestore} disabled={restoring} loading={restoring}>
              {restoring ? 'Geri yükleniyor…' : 'Geri Yükleyin'}
            </Button>
          )}
        </div>
      )}

      {/* Header */}
      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono">
                  {TYPE_LABELS[project.type]}
                </Badge>
                <Badge variant="outline" className="font-medium">
                  {d.sentStatus ?? STAGE_LABELS[project.stage]}
                </Badge>
                {project.demo_attempt > 0 && (
                  <Badge variant="outline" className="font-medium text-muted-foreground">
                    Demo {project.demo_attempt + 1}
                  </Badge>
                )}
                {project.ozalit_attempt > 0 && (
                  <Badge variant="outline" className="font-medium text-blue-600">
                    Ozalit {project.ozalit_attempt + 1}
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <UserIcon className="h-3.5 w-3.5" />
                  {project.assigned_name}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Hedef: {formatDateTr(project.target_month, { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>

            {!isDeleted && isLeader && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Projeyi Düzenleyin
              </Button>
            )}
          </div>

          {/* Action buttons row */}
          <HeaderActionRow d={d} />

          {/* Status banners */}
          <HeaderBanners d={d} />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>İlerleme</span>
              <span className="font-semibold text-foreground">{project.progress}%</span>
            </div>
            <Progress value={project.progress} className="h-2" />
          </div>

          {/* The main pipeline freezes while a sipariş is in flight */}
          {trackedOrders.length === 0 && (
            <div className="-mx-1 rounded-lg bg-muted/30 py-5">
              <div className="overflow-x-auto px-1">
                <StageBar type={project.type} stage={project.stage} />
              </div>
            </div>
          )}

          {/* Per-order trackers */}
          {trackedOrders.map((o) => (
            <OrderProgressStepper
              key={o.id}
              order={o}
              sold={sold && o.status === 'onaylandi'}
              handoverPending={handoverPending && o.status === 'onaylandi'}
              canAct={canActOnOrder(user, o, fallbackProjectIds)}
              onAct={() => openOrderAction(o)}
            />
          ))}
        </CardContent>
      </Card>
    </>
  )
}
