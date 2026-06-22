import { Printer } from 'lucide-react'

export default function BaskiListesi() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Printer className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">Baskı Listesi</h2>
      <p className="mt-1 text-sm text-muted-foreground">Bu özellik yakında eklenecek.</p>
    </div>
  )
}
