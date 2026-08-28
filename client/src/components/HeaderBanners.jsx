import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

import { ozalitLeaderApproved } from '@/domain'

/**
 * Context-aware status banners shown below the action row in the project
 * header card.  Each banner is independent and self-contained; together they
 * communicate the project's current "what's happening / what's blocking"
 * state for whichever role is viewing the page.
 */
export default function HeaderBanners({ d }) {
  const {
    project, user, isAssigned,
    isOzalitOnayStage, canReceiveOzalit,
    lastRejectReason,
  } = d

  return (
    <>
      {/* Ozalit requested — handed to the matbaa, waiting for delivery */}
      {project.stage === 'ozalit_teslim' && project.ozalit_requested && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-blue-800">
              Ozalit istendi, matbaa teslimi bekleniyor
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              {user?.role === 'printer'
                ? 'Ozaliti teslim ettiğinizde ekip lideri ve tasarımcı onayına gönderilecek.'
                : 'Matbaa ozaliti teslim ettiğinde onay aşamasına geçecek.'}
            </p>
          </div>
        </div>
      )}

      {/* Ozalit delivered but not yet acknowledged — the receipt step
          comes before any sign-off, so the approval progress panel below
          would be misleading here (nobody can approve yet). */}
      {isOzalitOnayStage && !project.ozalit_received && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800">
              Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {canReceiveOzalit
                ? 'Ozalit elinize ulaştıysa "Teslim Alındı"ya basın; onay adımı ondan sonra açılır. Ulaşmadıysa "Teslim Alınamadı" ile matbaaya geri gönderin.'
                : 'Ekip lideri veya atanmış tasarımcı ozaliti teslim aldı olarak işaretleyene kadar onay verilemez.'}
            </p>
          </div>
        </div>
      )}

      {/* Ozalit onay — multi-party approval progress. Every team leader
          AND every assigned designer must approve before it advances. */}
      {isOzalitOnayStage && project.ozalit_received && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">
            Ozalit onayı, tüm ekip liderleri ve atanmış tasarımcılar onaylamalı
          </p>
          {/* Leader-first: designers counter-sign after a leader has
              approved, so say whose move it is instead of leaving them
              hunting for a button they don't have yet. */}
          {!ozalitLeaderApproved(project) && (
            <p className="mt-1 text-xs text-emerald-700">
              {user?.role === 'designer'
                ? 'Önce ekip lideri onaylayacak, ardından onayınız açılır.'
                : 'Onay sırası ekip liderinde, tasarımcı onayı ondan sonra verilebilir.'}
            </p>
          )}
          {(project.ozalit_approvals ?? []).length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(project.ozalit_approvals ?? []).map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"
                >
                  <CheckCircle2 className="h-3 w-3" /> {a.name}
                  <span className="text-emerald-500">· {a.role === 'team_leader' ? 'Lider' : 'Tasarımcı'}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-emerald-600">Henüz onay verilmedi.</p>
          )}
        </div>
      )}

      {/* Rejection banner — shown whenever the project is back in tasarım after a rejection */}
      {isAssigned && project.stage === 'tasarim' && ((project.demo_attempt ?? 0) > 0 || (project.ozalit_attempt ?? 0) > 0) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800">
              {project.last_reject_type === 'ozalit'
                ? `Ozalit reddedildi, revizyon gerekiyor (${(project.ozalit_attempt ?? 0) + 1}. deneme)`
                : `Demo reddedildi, revizyon gerekiyor (${(project.demo_attempt ?? 0) + 1}. deneme)`}
            </p>
            {lastRejectReason && (
              <p className="mt-0.5 text-sm text-amber-700">"{lastRejectReason}"</p>
            )}
            <p className="mt-1 text-xs text-amber-600">
              Aşağıdaki revize görevlerini tamamlayın, ardından değişiklikleri kaydedin ve yeniden gönderin.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
