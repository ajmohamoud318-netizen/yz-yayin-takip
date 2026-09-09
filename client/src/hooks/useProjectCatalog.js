import { useEffect, useMemo, useState } from 'react'

import api from '@/api'
import { getComponentsForProject, primeProductInfoCache } from '@/data/productCatalog'

/**
 * Every parça this project HAS, as opposed to the ones a round is carrying.
 *
 * The distinction is the whole point. A round's parça list lives on its `demos`
 * snapshot and only holds what was ticked when it was composed; the project's
 * own list lives in Ürün Bilgileri. Nothing tracks the difference, so "which
 * parçalar were never sent to the matbaa?" can only be answered by holding both
 * — which is what the leader's "Kalan Parçaları Gönderin" needs.
 *
 * `getComponentsForProject` reads an in-memory cache that `hydrateProductInfo`
 * primes at boot from one bulk request. That is usually enough, but not always:
 * a project created moments ago, or on another browser, is not in it, and the
 * cache is also a localStorage mirror that can be stale. `useSpecSheet` deals
 * with this by re-fetching the one project it cares about when its dialog opens
 * — the same thing done here, for a page that has to know the answer before any
 * dialog is opened.
 *
 * Failing quietly is the right behaviour: an unanswered fetch leaves the cached
 * (possibly empty) list in place, `unsentParcalar` then finds nothing to send,
 * and the button simply does not appear. The alternative — guessing — would
 * offer to re-send parçalar the round already has.
 *
 * @param {string | undefined} projectId
 * @returns {Array<{ id: string, component: string, rows: any[] }>}
 */
export function useProjectCatalog(projectId) {
  // The cache is not React state, so a landed fetch would not re-render on its
  // own. Bumping this is what tells the memo below to read it again.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!projectId) return undefined
    let cancelled = false
    api.getProductInfo(projectId)
      .then((components) => {
        if (cancelled) return
        primeProductInfoCache([{ project_id: projectId, components }])
        setVersion((v) => v + 1)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId])

  // Memoised on the pair that actually decides the answer. Without this the
  // array is a new identity every render, and the `unsentParcalar` memo
  // downstream — which compares by identity — would recompute forever.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getComponentsForProject(projectId), [projectId, version])
}
