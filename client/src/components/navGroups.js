import {
  Boxes,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Columns3,
  Factory,
  FolderTree,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Package,
  PackageCheck,
  PackageOpen,
  PrinterCheck,
  ScrollText,
  ShieldCheck,
  Stamp,
  Target,
  Trash2,
  Truck,
  UsersRound,
} from 'lucide-react'

import { WORK_LOG_ENABLED } from '@/lib/work-log.js'

/**
 * Build the role-specific sidebar nav groups. Pure function so AppShell can
 * memoize it on (role, counts, pending*) and so this stays trivially
 * testable without a React tree.
 *
 * Three groups in order:
 *   • Ana menü   — always shown, gated by `roles` per item.
 *   • Onaylar    — only shown when the role has at least one approval item;
 *                  the section heading is suppressed for `satis` because
 *                  their approval row is the only thing in there and it
 *                  reads cleaner without an "Onaylar" eyebrow above it.
 *   • Yönetim    — reference/management links; Çalışma Defteri is dropped
 *                  when WORK_LOG_ENABLED is off (see comment inlined below).
 *
 * Items carry a `roles` array; the .filter() at the end of each group does
 * the role gate in one place rather than spreading conditionals across each
 * line.
 */
export function navGroups(role, counts, pendingOrders = 0, printerOrders = 0, designerOrders = 0, pendingHandovers = 0) {
  // ── Grup 1: Ana menü ──────────────────────────────────────────
  const mainItems = [
    { to: '/', label: 'Genel Bakış', icon: LayoutDashboard, end: true, roles: ['team_leader', 'designer', 'printer'] },
    { to: '/my-projects', label: 'Projelerim', icon: Briefcase, badge: counts.myProjects || designerOrders || undefined, badgeTone: designerOrders > 0 ? 'amber' : 'default', roles: ['designer'] },
    { to: '/kanban', label: 'İş Akışı', icon: Columns3, badge: counts.active, roles: ['team_leader', 'designer', 'printer'] },
    { to: '/projects', label: 'Tüm Projeler', icon: LayoutGrid, end: true, badge: counts.total, roles: ['team_leader', 'designer', 'printer'] },
    { to: '/urunler', label: 'Ürünler', icon: Package, roles: ['satis', 'team_leader'] },
    {
      to: '/hedef-projeler',
      label: 'Hedef Projeler',
      icon: Target,
      roles: ['team_leader', 'designer'],
    },
    { to: '/toplanti', label: 'Toplantılar', icon: CalendarDays, roles: ['team_leader', 'designer', 'printer'] },
    // Sales-only items
    { to: '/siparis-talebi', label: 'Taleplerim', icon: ClipboardPlus, roles: ['satis'] },
  ].filter((i) => !i.roles || i.roles.includes(role))

  // ── Grup 2: Onaylar (sadece printer + team_leader) ────────────
  const approvalItems = [
    {
      // Matbaa İşleri — printer's one-page hub. Sits at the top of the
      // printer's approval group so the headline number on the sidebar
      // (demoApprovals + ozalitApprovals + pending sipariş) lines up with
      // the page it actually opens. The other approval items below stay
      // reachable for back-compat and for the queues that don't fit on the
      // hub (e.g. Baskı Listesi runs on a different stage filter).
      to: '/matbaa-isleri',
      label: 'Matbaa İşleri',
      icon: Factory,
      badge: counts.demoApprovals + counts.ozalitApprovals + printerOrders,
      badgeTone: 'amber',
      highlight: (counts.demoApprovals + counts.ozalitApprovals + printerOrders) > 0,
      roles: ['printer'],
    },
    {
      to: '/approvals/demo',
      label: 'Onaylar',
      icon: ShieldCheck,
      badge: counts.demoApprovals + counts.ozalitApprovals + counts.baskiOnayApprovals,
      badgeTone: 'amber',
      highlight: counts.demoApprovals + counts.ozalitApprovals + counts.baskiOnayApprovals > 0,
      roles: ['printer', 'team_leader'],
    },
    {
      to: '/approvals/baski-onay',
      label: 'Baskı Onayı',
      icon: PrinterCheck,
      badge: counts.baskiOnayApprovals || undefined,
      badgeTone: 'amber',
      highlight: counts.baskiOnayApprovals > 0,
      roles: ['team_leader'],
    },
    {
      to: '/approvals/siparis',
      label: 'Baskı Teslimi',
      icon: Truck,
      badge: printerOrders,
      badgeTone: 'amber',
      highlight: printerOrders > 0,
      roles: ['printer'],
    },
    {
      to: '/approvals/ozalit',
      label: 'Ozalit Onayı',
      icon: Stamp,
      badge: counts.designerOzalitApprovals || undefined,
      badgeTone: 'amber',
      highlight: counts.designerOzalitApprovals > 0,
      roles: ['designer'],
    },
    {
      to: '/siparis-onay',
      label: 'Baskı Onayları',
      icon: ClipboardCheck,
      badge: designerOrders || undefined,
      badgeTone: 'amber',
      highlight: designerOrders > 0,
      roles: ['designer'],
    },
    {
      to: '/siparis-talepleri',
      label: 'Baskı Talepleri',
      icon: ClipboardList,
      badge: pendingOrders,
      badgeTone: 'amber',
      highlight: pendingOrders > 0,
      roles: ['team_leader'],
    },
    {
      to: '/baski-listesi',
      label: 'Baskı Listesi',
      icon: ListChecks,
      badge: counts.production || undefined,
      badgeTone: 'amber',
      highlight: counts.production > 0,
      roles: ['printer'],
    },
    {
      to: '/teslim-talepleri',
      label: 'Teslim Talepleri',
      icon: PackageOpen,
      badge: counts.handoverEligible || undefined,
      badgeTone: 'pink',
      highlight: counts.handoverEligible > 0,
      roles: ['printer'],
    },
    {
      to: '/teslim-onaylari',
      label: 'Teslim Onayları',
      icon: PackageCheck,
      badge: pendingHandovers || undefined,
      badgeTone: 'amber',
      highlight: pendingHandovers > 0,
      roles: ['satis'],
    },
  ].filter((i) => !i.roles || i.roles.includes(role))

  // ── Grup 3: Yönetim / kaynaklar ──────────────────────────────
  const resourceItems = [
    { to: '/team', label: 'Ekip', icon: UsersRound, roles: ['team_leader'] },
    { to: '/documents', label: 'Dökümanlar', icon: FolderTree, roles: ['team_leader', 'designer', 'printer'] },
    { to: '/urun-bilgileri', label: 'Ürün Bilgileri', icon: Boxes, roles: ['team_leader', 'designer'] },
    { to: '/baski-receteleri', label: 'Baskı Reçeteleri', icon: ScrollText, roles: ['team_leader', 'designer'] },
    { to: '/deleted-projects', label: 'Silinen Projeler', icon: Trash2, roles: ['team_leader'] },
    // Çalışma Defteri — behind WORK_LOG_ENABLED (client/src/lib/work-log.js).
    // Dropping the item is what keeps the feature off: WorkLogPill is the only
    // caller of useWorkLog, so with no pill there is no GET /work-log either.
    ...(WORK_LOG_ENABLED ? [{ type: 'worklog', label: 'Çalışma Defteri' }] : []),
  ].filter((i) => !i.roles || i.roles.includes(role))

  const groups = [{ id: 'main', label: null, items: mainItems }]
  if (approvalItems.length > 0) groups.push({ id: 'approvals', label: role === 'satis' ? null : 'Onaylar', items: approvalItems })
  if (resourceItems.length > 0) groups.push({ id: 'resources', label: null, items: resourceItems })
  // No "Acil İşler" group — demo/özalit re-send pressure is already reflected
  // in the per-project "Acil" chips in the pinned list and in the badge of
  // the nav item the work actually lives under.
  return groups
}