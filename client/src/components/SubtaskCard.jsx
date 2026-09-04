import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Save, User as UserIcon } from 'lucide-react'
import { cn, formatDateTr, initials } from '@/lib/utils'
import PageChipGrid from '@/components/PageChipGrid'

/**
 * Subtask list card — renders each subtask as a checkbox row, with the
 * "İç Sayfalar" pages subtask rendering its own PageChipGrid instead.
 */
export default function SubtaskCard({
  project, user, isLeader, isAssigned,
  canEditSubtask, canEditSubtasks, inRevision,
  subtasksSafe, progressCountedSubtasks, hasSubtaskChanges, pendingRevize,
  localDone, subtaskChecked, toggleSubtask, activePage, allUsers,
  saving, toggling,
  onSaveChanges, onPageClick, onPageRework, onPageAssign,
  onRedo, onRevize,
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Alt Görevler</CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {progressCountedSubtasks.filter((s) => subtaskChecked(s)).length} / {progressCountedSubtasks.length} tamamlandı
          </span>
          {/* migration 055 — Pages subtasks can have individual pages
              flagged for rework. Summing them across every pages subtask
              gives the team leader a single "X revize" indicator next
              to the main counter, so a stuck page is visible without
              having to scroll into the chip grid. */}
          {(() => {
            const reworkTotal = subtasksSafe
              .filter((s) => s.kind === 'pages')
              .reduce(
                (sum, s) =>
                  sum +
                  (Array.isArray(s.pages)
                    ? s.pages.filter((p) => p.status === 'rework').length
                    : 0),
                0,
              )
            if (reworkTotal === 0) return null
            return (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                {reworkTotal} revize
              </span>
            )
          })()}
          {canEditSubtasks && hasSubtaskChanges && (
            <Button size="sm" onClick={onSaveChanges} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydedin'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {(project.subtasks ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            Bu proje için alt görev tanımlanmamış.
          </p>
        ) : (
          <>
            {/* During a revision cycle, the leader-flagged subtasks lead the list. */}
            {inRevision && (
              <p className="pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                {project.last_reject_type === 'ozalit' ? 'Ozalit Revize Görevleri' : 'Demo Revize Görevleri'}
              </p>
            )}

            {(project.subtasks ?? [])
              .filter((s) => s.kind !== 'revize')
              .map((s) => {
                const canEdit = canEditSubtask(s)
                const flagged = inRevision && s.needs_revize
                const lockedDone = inRevision && !s.needs_revize && s.is_done

                // migration 055 — the "İç Sayfalar" subtask renders
                // its own chip grid instead of a single checkbox.
                // Pages split across multiple designers, and each
                // page is independently reworkable, so the same
                // row pattern as the other subtasks doesn't fit.
                if (s.kind === 'pages') {
                  return (
                    <div key={s.id} className="space-y-1.5">
                      <PageChipGrid
                        subtask={s}
                        // Flagged subtasks stay editable so the designer
                        // can mark individual pages for rework — the
                        // previous `!flagged` made the whole grid read-
                        // only right when the leader wanted it touched.
                        canEdit={canEdit}
                        flagged={flagged}
                        user={user}
                        activePage={activePage}
                        // migration 056 — only team_leader gets the
                        // assign popover. Designers still see the
                        // owner pip as an information layer (their
                        // chip border picks it up automatically), but
                        // there's no trigger button on their render.
                        isLeader={isLeader}
                        designers={allUsers}
                        onPageClick={(pageIndex, currentStatus) =>
                          onPageClick(s, pageIndex, currentStatus)
                        }
                        onPageRework={(pageIndex) => onPageRework(s, pageIndex)}
                        onAssign={(pageIndex, assignedTo) =>
                          onPageAssign(s, pageIndex, assignedTo)
                        }
                        // Surface the subtask-level "Revize Edin" CTA
                        // inside the chip grid. Without this, a pages
                        // subtask flagged during a demo/ozalit rejection
                        // has no UI affordance to clear needs_revize, so
                        // the project sits in its redo state (tasarim
                        // for demo-redo, ozalit_onay for ozalit-redo)
                        // forever and the resubmit button stays disabled.
                        onRevize={onRevize}
                        revizing={toggling === s.id}
                        // Mirror the non-pages branch's "Yeniden Çalıştım"
                        // affordance — logs a designer note when the
                        // designer touches a fully-shipped pages subtask
                        // again. Per-page rework is already handled by the
                        // ↻ chip; this one is the subtask-level signal.
                        onRedo={onRedo}
                        redoing={toggling === s.id && !flagged}
                      />
                    </div>
                  )
                }

                return (
                  <div key={s.id} className="space-y-1.5">
                  <label
                    key={s.id}
                    className={cn(
                      'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-background px-3 py-2.5 text-sm transition',
                      flagged
                        ? subtaskChecked(s)
                          ? 'border-emerald-200 bg-emerald-50/40'
                          : 'border-amber-200 bg-amber-50/40 hover:border-amber-300'
                        : subtaskChecked(s)
                          ? 'border-emerald-200 bg-emerald-50/40'
                          : 'hover:border-primary/30',
                      lockedDone && 'opacity-60',
                      localDone[s.id] !== undefined && localDone[s.id] !== s.is_done &&
                        (flagged ? 'ring-2 ring-amber-300' : 'ring-2 ring-primary/30'),
                      !canEdit && 'cursor-default',
                    )}
                  >
                    <Checkbox
                      checked={subtaskChecked(s)}
                      onCheckedChange={() => canEdit && !flagged && toggleSubtask(s)}
                      disabled={!canEdit || flagged}
                    />
                    <span className={cn('min-w-0 flex-1 basis-40', subtaskChecked(s) && 'text-muted-foreground line-through')}>
                      {s.title}
                    </span>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 pl-7 sm:pl-0">
                      {flagged && canEdit && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRevize(s) }}
                          disabled={toggling === s.id}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                        >
                          {toggling === s.id ? 'Kaydediliyor…' : 'Revize Edin'}
                        </button>
                      )}
                      {flagged && !canEdit && (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Revize bekliyor
                        </span>
                      )}
                      {lockedDone && (
                        <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                          Revize gerekmiyor
                        </span>
                      )}
                      {s.assigned_to && (
                        <span
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                          title={`Bu alt görevin tasarımcısı: ${s.assigned_name ?? s.assigned_to}`}
                        >
                          <UserIcon className="h-2.5 w-2.5 shrink-0" />
                          {s.assigned_name ?? initials(s.assigned_to)}
                        </span>
                      )}
                      {localDone[s.id] !== undefined && localDone[s.id] !== s.is_done && (
                        <span className={cn('whitespace-nowrap text-[11px] font-medium', flagged ? 'text-amber-600' : 'text-primary')}>
                          kaydedilmedi
                        </span>
                      )}
                      {!flagged && !lockedDone && subtaskChecked(s) && s.is_done && s.done_at && localDone[s.id] === undefined && (
                        <span className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTr(s.done_at)}</span>
                      )}
                      {!flagged && !lockedDone && canEdit && s.is_done && localDone[s.id] === undefined && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRedo(s) }}
                          disabled={toggling === s.id}
                          title="Bu görev üzerinde tekrar çalıştığınızı kaydedin"
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
                        >
                          {toggling === s.id ? 'Kaydediliyor…' : 'Yeniden Çalıştım'}
                        </button>
                      )}
                    </div>
                  </label>
                  </div>
                )
              })}
          </>
        )}
        {!canEditSubtasks && (
          <p className="pt-2 text-[11px] text-muted-foreground">
            {isLeader
              ? 'Alt görevleri sadece atanmış tasarımcı işaretleyebilir.'
              : isAssigned
                ? 'Bu aşamada alt görev düzenlenemez.'
                : 'Bu projeye atanmadığınız için alt görevleri düzenleyemezsiniz.'}
          </p>
        )}
        {canEditSubtasks && (project.subtasks ?? []).some((s) => s.assigned_to && s.assigned_to !== user?.id) && (
          <p className="pt-1 text-[11px] text-muted-foreground">
            Size atanmayan alt görevler (
            <UserIcon className="inline h-2.5 w-2.5" /> ikonlu) düzenlenemez.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
