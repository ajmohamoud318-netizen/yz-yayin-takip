import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, ClipboardPlus, Plus, Truck } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Each role's natural "create" action. Leader still gets the dialog (project
 * creation is multi-step), the other roles get a one-tap navigate to the
 * page where their primary work originates — keeps the topbar balanced
 * across personas without growing the chrome.
 *
 *   leader  → Yeni Proje (opens NewProjectDialog)
 *   satis   → Yeni Talep  → /siparis-talebi (sales-request page)
 *   printer → Yeni Teslim → /teslim-talepleri (handover requests)
 *   designer→ Yeni Demo   → /demo (demo submissions queue)
 *
 * sm+ shows the labelled button; below sm collapses to an icon-only
 * round-corner button so the topbar still fits on a 360 px viewport.
 */
export default function RolePrimaryCta({ role, onNewProject }) {
  const navigate = useNavigate()
  if (role === 'team_leader') {
    return (
      <>
        <Button size="sm" onClick={onNewProject} className="hidden sm:inline-flex">
          <Plus className="h-4 w-4" />
          Yeni Proje
        </Button>
        <Button size="icon" variant="outline" onClick={onNewProject} className="sm:hidden" aria-label="Yeni proje">
          <Plus className="h-4 w-4" />
        </Button>
      </>
    )
  }
  const map = {
    satis:    { to: '/siparis-talebi',    label: 'Yeni Talep',  icon: ClipboardPlus,  short: 'Talep' },
    printer:  { to: '/teslim-talepleri',  label: 'Yeni Teslim', icon: Truck,          short: 'Teslim' },
    designer: { to: '/demo',              label: 'Yeni Demo',   icon: ClipboardCheck,  short: 'Demo' },
  }
  const cta = map[role]
  if (!cta) return null
  const Icon = cta.icon
  return (
    <>
      <Button size="sm" onClick={() => navigate(cta.to)} className="hidden sm:inline-flex">
        <Icon className="h-4 w-4" />
        {cta.label}
      </Button>
      <Button size="icon" variant="outline" onClick={() => navigate(cta.to)} className="sm:hidden" aria-label={cta.label}>
        <Icon className="h-4 w-4" />
      </Button>
    </>
  )
}