// First-match-wins lookup: most specific paths come first so /projects/:id
// doesn't fall through to the "/projects" generic page label.
const PAGE_TITLES = [
  { match: (p) => p === '/', label: 'Genel Bakış' },
  { match: (p) => p.startsWith('/kanban'), label: 'İş Akışı' },
  { match: (p) => p.startsWith('/approvals/siparis'), label: 'Baskı Teslimi' },
  { match: (p) => p.startsWith('/approvals'), label: 'Onaylar' },
  { match: (p) => p.startsWith('/team'), label: 'Ekip' },
  { match: (p) => p.startsWith('/deleted-projects'), label: 'Silinen Projeler' },
  { match: (p) => p.startsWith('/plan'), label: 'Yıllık Plan' },
  { match: (p) => p.startsWith('/demo'), label: 'Demo' },
  { match: (p) => p.startsWith('/my-projects'), label: 'Projelerim' },
  { match: (p) => p.startsWith('/documents'), label: 'Dökümanlar' },
  { match: (p) => p.startsWith('/urun-bilgileri'), label: 'Ürün Bilgileri' },
  { match: (p) => p.startsWith('/baski-receteleri'), label: 'Baskı Reçeteleri' },
  { match: (p) => p.startsWith('/urunler'), label: 'Ürünler' },
  { match: (p) => p.startsWith('/siparis-talebi'), label: 'Taleplerim' },
  { match: (p) => p.startsWith('/siparis-talepleri'), label: 'Baskı Talepleri' },
  { match: (p) => p.startsWith('/siparis-onay'), label: 'Baskı Onayları' },
  { match: (p) => p.startsWith('/baski-listesi'), label: 'Baskı Listesi' },
  { match: (p) => p.startsWith('/hedef-projeler'), label: 'Hedef Projeler' },
  { match: (p) => p.startsWith('/toplanti'), label: 'Toplantılar' },
  { match: (p) => p.startsWith('/teslim-talepleri'), label: 'Teslim Talepleri' },
  { match: (p) => p.startsWith('/teslim-onaylari'), label: 'Teslim Onayları' },
  { match: (p) => p.startsWith('/projects/'), label: 'Proje Detayı' },
  { match: (p) => p === '/projects', label: 'Tüm Projeler' },
]

export default function Breadcrumb({ pathname }) {
  const page = PAGE_TITLES.find((x) => x.match(pathname))?.label ?? 'Panel'
  return (
    <nav aria-label="Breadcrumb" className="hidden text-sm sm:block">
      <span className="font-medium text-foreground">{page}</span>
    </nav>
  )
}