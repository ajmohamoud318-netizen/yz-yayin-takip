import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { STAGE_LABELS } from '@/api'

const APPROVAL_STAGES = new Set(['demo_onay', 'ozalit_onay', 'cin_demo_onay'])
const TESLIM_STAGES = new Set(['demo_teslim', 'ozalit_teslim'])

/**
 * Invisible component that watches the global project list and fires
 * in-app toasts when state changes are relevant to the current user.
 * Mounted once at the app root — produces no DOM output.
 */
export default function NotificationSync() {
  const { user } = useAuth()
  const { projects } = useProjectsStore()
  const prevRef = useRef(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    // Skip the very first load — don't spam notifications on login.
    if (!initializedRef.current) {
      initializedRef.current = true
      prevRef.current = projects
      return
    }
    if (!user || !prevRef.current) {
      prevRef.current = projects
      return
    }

    const prev = prevRef.current
    const prevMap = new Map(prev.map((p) => [p.id, p]))

    for (const p of projects) {
      const old = prevMap.get(p.id)

      // Newly added project
      if (!old) {
        if (user.role === 'designer' && isAssigned(p, user.id)) {
          toast.info(`Yeni proje atandı: ${p.title}`, { duration: 6000 })
        }
        // (No "proje oluşturuldu" toast for the team leader — NewProjectDialog
        // already shows one immediately on save, and showing a second one via
        // the store-watcher is just duplicate noise.)
        continue
      }

      if (old.stage === p.stage && old.progress === p.progress) continue

      const stageChanged = old.stage !== p.stage

      // Production milestones broadcast to whoever is signed in.
      //   • uretime_hazir → Matbaa can now take it into production ("Üretime Al")
      //   • uretimde       → everyone learns it was taken into production
      //   • satista        → everyone learns it went on sale
      if (stageChanged) {
        if (p.stage === 'uretime_hazir' && user.role === 'printer') {
          toast.info(`${p.title} — Üretime hazır, üretime alabilirsiniz.`, { duration: 7000 })
        } else if (p.stage === 'uretimde') {
          toast.success(`${p.title} — Üretime alındı.`, { duration: 6000 })
        } else if (p.stage === 'satista') {
          toast.success(`${p.title} — Satışa çıktı! 🎉`, { duration: 6000 })
        }
      }

      // Notifications for designers
      if (user.role === 'designer' && isAssigned(p, user.id)) {
        if (stageChanged && p.stage === 'tasarim' && old.demo_attempt !== p.demo_attempt) {
          toast.error(`${p.title} — Demo reddedildi, revizyon gerekiyor.`, { duration: 8000 })
        } else if (stageChanged && p.stage === 'ozalit_teslim' && p.type === 'TR') {
          toast.info(`${p.title} — Ozalit isteyebilirsiniz.`, { duration: 7000 })
        }
        // Progress hit 100 %
        if (!stageChanged && old.progress < 100 && p.progress === 100) {
          toast.info(`${p.title} — Tasarım %100 tamamlandı.`)
        }
      }

      // Notifications for team leader
      if (user.role === 'team_leader' && stageChanged) {
        if (APPROVAL_STAGES.has(p.stage)) {
          toast.info(`${p.title} — ${STAGE_LABELS[p.stage]} onayınızı bekliyor.`, { duration: 6000 })
        }
        if (p.stage === 'demo_teslim' || p.stage === 'cin_demo_teslim') {
          toast.info(`${p.title} — Demo teslim edildi.`)
        }
        if (!p.stage.includes('tasarim') && old.progress < 100 && p.progress === 100) {
          // design completed notification (picked up via stage or progress)
        }
      }

      // Notifications for printer
      if (user.role === 'printer' && stageChanged && p.type === 'TR') {
        if (TESLIM_STAGES.has(p.stage)) {
          toast.info(`${p.title} — ${STAGE_LABELS[p.stage]}: incelemenizi bekliyor.`, { duration: 6000 })
        }
      }
    }

    prevRef.current = projects
  }, [projects, user])

  return null
}

function isAssigned(project, userId) {
  return (project.assignees ?? []).some((a) => a.id === userId)
}
