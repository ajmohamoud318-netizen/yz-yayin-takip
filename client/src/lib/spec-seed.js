/**
 * Which saved sheet a Demo/Ozalit form should take its spec from.
 *
 * Pure decision logic, kept out of SpecFormDialog so it can be tested without
 * mounting the dialog (whose import chain reaches lottie-web and dies under
 * jsdom). The dialog owns the loading — localStorage blob, attempt snapshot,
 * server snapshot — and hands the results here.
 */

/** Does this sheet actually say anything about the product? */
export const hasSpecContent = (d) =>
  (d?.customRows?.length ?? 0) > 0 || (d?.selectedComponents?.length ?? 0) > 0

/**
 * Seed an empty ozalit sheet from the demo sheet.
 *
 * The ozalit sheet is its own `kind`, so on the first ozalit round there is
 * nothing to carry forward — and on a project with no catalog yet there is
 * nothing in `catalogComponents` either. The dialog opened completely blank
 * and the leader was expected to retype the spec the designer had already
 * filled in on the demo sheet. In practice nobody did: the ozalit that got
 * printed, signed and approved carried no spec at all, and the Ürün Bilgileri
 * auto-capture that runs on entering production then had nothing to copy
 * (server/src/services/product-info-capture.js).
 *
 * The last ozalit sheet still wins whenever it has a spec — the caller only
 * reaches here when neither this attempt's snapshot nor the carried ozalit
 * blob said anything. Only the spec travels: rows and parça selection. The
 * demo's header and stamp fields describe that sheet's own round (and use
 * different field names entirely — demoIstemTarihi vs ozalitIstemTarihi), so
 * they stay behind.
 */
export function specWithDemoFallback(data, fromDemo) {
  if (hasSpecContent(data) || !hasSpecContent(fromDemo)) return data
  return {
    ...(data ?? {}),
    customRows: fromDemo.customRows,
    selectedComponents: fromDemo.selectedComponents,
  }
}
