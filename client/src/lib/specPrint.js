/**
 * Shared print for the Demo / Ozalit / Baskı Onay spec forms.
 *
 * All three come out as the same boxed form — title block, a künye grid, then
 * the spec table — so a sheet is recognisable as this company's form whichever
 * stage produced it. Only the künye fields differ per kind (buildFormKunye).
 *
 * A product can have several parçalar (kitap + kutu + …). Each parça prints as
 * its own sheet, but they must all come out of a SINGLE print job — opening
 * one window per parça trips pop-up blockers (only the first survives) and
 * forces the user through several print dialogs. This builds one HTML document
 * with a page break between sheets and prints once.
 *
 * No signature blocks anywhere: a signer prints as a künye row, and only once
 * the app actually stamped them, so an unsigned sheet never reads as signed.
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const FORM_TITLES = {
  demo: 'DEMO ÜRETİM FORMU',
  ozalit: 'OZALİT ÜRETİM FORMU',
  baski_onay: 'BASKI ONAY FORMU',
}

/**
 * The künye [label, value] pairs for one sheet — the block above the spec
 * table. Exported because the on-screen sheet renders the same list, so the
 * screen and the printout cannot drift apart.
 *
 * @param form  the saved form object (dates / requester / approver)
 * @param kind  'demo' | 'ozalit' | 'baski_onay'
 */
export function buildFormKunye({ form, kind }) {
  const pairs = []
  if (kind === 'baski_onay') {
    pairs.push(
      ['ADET', form?.baskiOnayAdet ?? ''],
      ['TARİH', form?.baskiOnayTarihi ?? ''],
      ['BASIM YERİ', form?.basimYeri ?? ''],
      ['HAZIRLAYAN', form?.baskiOnayHazirlayan ?? ''],
    )
  } else if (kind === 'ozalit') {
    pairs.push(['OZALİT İSTEM TARİHİ', form?.ozalitIstemTarihi ?? ''], ['OZALİT İSTEYEN KİŞİ', form?.ozalitIsteyenKisi ?? ''])
  } else {
    pairs.push(['DEMO İSTEM TARİHİ', form?.demoIstemTarihi ?? ''], ['DEMO İSTEYEN KİŞİ', form?.demoIsteyenKisi ?? ''])
  }
  // Everything below is stamped by an event, never typed: it prints only once
  // that event happened, so an undelivered / unapproved sheet stays blank
  // there instead of reading as already delivered or signed.
  if (form?.teslimTarihi || form?.teslimEdenKisi) {
    pairs.push(['TESLİM TARİHİ', form?.teslimTarihi ?? ''], ['TESLİM EDEN KİŞİ', form?.teslimEdenKisi ?? ''])
  }
  // The other half of the handover: whoever answered "Teslim Aldım" on the
  // receipt gate. Its own row rather than a pair with TESLİM EDEN KİŞİ — the
  // two are stamped by different people at different moments, and printing an
  // empty box next to a filled one reads as a form somebody forgot to finish.
  if (form?.teslimAlanKisi) pairs.push(['TESLİM ALAN KİŞİ', form.teslimAlanKisi])
  if (form?.matbaaYetkilisi) pairs.push(['MATBAA YETKİLİSİ', form.matbaaYetkilisi])
  if (form?.onaylayanKisi) pairs.push(['ONAYLAYAN KİŞİ', form.onaylayanKisi])
  return pairs
}

/**
 * Build ONE printable sheet for one parça.
 *
 * @param component     { component, rows: [{label,value}] } | null
 * @param form          the saved form object
 * @param kind          'demo' | 'ozalit' | 'baski_onay'
 * @param title         the job / book name, printed under the form's title.
 *                      İŞİN ADI stays the parça, and the head drops the
 *                      subtitle when the two are the same (single-parça jobs).
 * @param attemptLabel  e.g. '2. OZALİT' — blank on the sipariş side, which has
 *                      no attempt counter.
 */
export function buildFormSheet({ component, form, kind, title, attemptLabel = '' }) {
  const isinAdi = component?.component ?? form?.isinAdi ?? title ?? ''
  return {
    formTitle: FORM_TITLES[kind] ?? FORM_TITLES.demo,
    title: title ?? isinAdi,
    attemptLabel,
    isinAdi,
    pairs: buildFormKunye({ form, kind }),
    specRows: (component?.rows ?? []).map((r) => [r.label, r.value]),
  }
}

/* One sheet: title block, İŞİN ADI, the spec table, then the künye grid (two
   fields per row) as the form's foot. */
function formSection({ formTitle, title, attemptLabel, isinAdi, pairs, specRows }) {
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  // The head names the job; İŞİN ADI below names the parça. On a single-parça
  // job the two are the same string, and printing it twice reads like a bug.
  const norm = (x) => String(x ?? '').trim().toLocaleLowerCase('tr-TR')
  const sub = norm(title) === norm(isinAdi) ? '' : (title ?? '')

  // Two fields per row; an odd last field spans the rest of the row so the
  // grid never ends with an empty cell.
  const list = pairs ?? []
  const metaRows = []
  for (let i = 0; i < list.length; i += 2) {
    const [k1, v1] = list[i]
    const pair = list[i + 1]
    metaRows.push(pair
      ? `<tr><td class="k">${esc(k1)}</td><td class="v">${esc(v1 || '')}</td><td class="k">${esc(pair[0])}</td><td class="v">${esc(pair[1] || '')}</td></tr>`
      : `<tr><td class="k">${esc(k1)}</td><td class="v" colspan="3">${esc(v1 || '')}</td></tr>`)
  }

  const specBody = (specRows ?? []).length > 0
    ? (specRows ?? [])
      .map(([l, v]) => `<tr><td class="k">${esc(l)}</td><td class="v" colspan="3">${esc(v || '')}</td></tr>`)
      .join('')
    : '<tr><td class="v empty" colspan="4">—</td></tr>'

  // İŞİN ADI, then the spec, then the künye. The spec is what the sheet is FOR,
  // so it sits directly under the job name; the künye rows are stamps — who
  // asked, when, who delivered and approved — and read as the form's foot. One
  // grid, not one per part: every rule between rows is the same weight, so the
  // sheet is a single form rather than three tables stacked up. The on-screen
  // sheet is built the same way, so paper and screen agree.
  return `<section class="sheet">
    <div class="form-head">
      <div class="form-title">${esc(formTitle || '')}</div>
      ${sub ? `<div class="form-sub">${esc(sub)}</div>` : ''}
      ${attemptLabel ? `<div class="form-attempt">${esc(attemptLabel)}</div>` : ''}
    </div>
    <table class="meta">
      <tr><td class="k">İŞİN ADI</td><td class="v" colspan="3">${esc(isinAdi || '')}</td></tr>
      ${specBody}
      ${metaRows.join('')}
    </table>
    <div class="date-line">Yazdırma tarihi: ${esc(today)}</div>
  </section>`
}

/**
 * Print an array of sheets from buildFormSheet() in ONE job.
 * Returns false if the window couldn't be opened (pop-up blocked).
 */
export function printSpecSheets(sheets, { docTitle = 'Form' } = {}) {
  const list = (sheets ?? []).filter(Boolean)
  if (list.length === 0) return true
  const body = list.map(formSection).join('')
  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/>
  <title>${esc(docTitle)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#000}
    .sheet{padding:18mm 20mm;page-break-after:always}
    .sheet:last-child{page-break-after:auto}
    table{width:100%;border-collapse:collapse}
    .date-line{margin-top:14px;font-size:9.5pt;text-align:right;color:#444}

    .form-head{border:2px solid #000;padding:8px 10px 7px;text-align:center}
    .form-title{font-size:15pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
    .form-sub{margin-top:3px;font-size:10.5pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#222}
    .form-attempt{margin-top:2px;font-size:9pt;font-weight:700;letter-spacing:.06em;color:#555}
    table.meta{border:2px solid #000;border-top:0}
    table.meta td{border:1px solid #000;padding:6px 8px;font-size:10.5pt;white-space:pre-wrap;vertical-align:top}
    table.meta td.k{width:22%;background:#f1f1f1;font-weight:700;font-size:9pt;text-transform:uppercase;letter-spacing:.03em}
    table.meta td.v{width:28%}
    table.meta td.empty{color:#888;text-align:center}

    @media print{@page{size:A4;margin:0}}
  </style></head><body>${body}</body></html>`
  const win = window.open('', '_blank', 'width=800,height=1000')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 350)
  return true
}
