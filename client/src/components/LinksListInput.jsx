import { Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * A repeatable list of plain URL inputs — one row per link, each with its
 * own remove button, plus an "add" button under the list. Used by both
 * Hedef Projeler and Toplantı's create/edit dialogs, which each store
 * `links` as a flat string array on the record.
 */
export function LinksListInput({ links, onChange, max = 10 }) {
  function updateAt(index, value) {
    const next = [...links]
    next[index] = value
    onChange(next)
  }

  function removeAt(index) {
    onChange(links.filter((_, i) => i !== index))
  }

  function add() {
    if (links.length >= max) return
    onChange([...links, ''])
  }

  return (
    <div className="space-y-2">
      {links.map((link, index) => (
        // eslint-disable-next-line react/no-array-index-key -- rows have no stable id, only reordered by add/remove
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={link}
            onChange={(e) => updateAt(index, e.target.value)}
            maxLength={2000}
            placeholder="https://…"
          />
          <button
            type="button"
            onClick={() => removeAt(index)}
            aria-label="Linki kaldır"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {links.length < max && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
          Link ekle
        </Button>
      )}
    </div>
  )
}
