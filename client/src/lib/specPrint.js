/**
 * Shared print for Demo / Ozalit / Baskı Onay spec forms.
 *
 * A product can have several parçalar (kitap + kutu + …). Each parça prints as
 * its own sheet, but they must all come out of a SINGLE print job — opening
 * one window per parça trips pop-up blockers (only the first survives) and
 * forces the user through several print dialogs. This builds one HTML document
 * with a page break between sheets and prints once.
 *
 * Two sheet layouts share that job:
 *   - the classic single-column list (demo / ozalit) — sheetSection()
 *   - the boxed Baskı Onay Formu (`layout: 'form'`) — formSection(). The baskı
 *     onay sheet is what the matbaa physically prints from, so it comes out as
 *     an actual form: title block, a boxed künye grid, then the spec table.
 *     Like the classic sheet it carries NO signature blocks — every signer is
 *     a künye row, and only once the app actually stamped one.
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * Build the [label, value] rows for one parça sheet.
 *
 * @param component  { component, rows: [{label,value}] } | null
 * @param form       the saved form object (dates / requester / approver)
 * @param kind       'demo' | 'ozalit' | 'baski_onay'
 */
export function buildSpecRows({ component, form, kind }) {
  const rows = [['İŞİN ADI', component?.component ?? form?.isinAdi ?? '']]
  if (kind === 'baski_onay' && form?.baskiOnayAdet) rows.push(['ADET', form.baskiOnayAdet])
  for (const r of component?.rows ?? []) rows.push([r.label, r.value])
  if (kind === 'ozalit') {
    rows.push(['OZALİT İSTEM TARİHİ', form?.ozalitIstemTarihi ?? ''], ['OZALİT İSTEYEN KİŞİ', form?.ozalitIsteyenKisi ?? ''])
  } else if (kind === 'baski_onay') {
    rows.push(['BASKI ONAY TARİHİ', form?.baskiOnayTarihi ?? ''])
    if (form?.basimYeri) rows.push(['BASIM YERİ', form.basimYeri])
    rows.push(['HAZIRLAYAN', form?.baskiOnayHazirlayan ?? ''])
  } else {
    rows.push(['DEMO İSTEM TARİHİ', form?.demoIstemTarihi ?? ''], ['DEMO İSTEYEN KİŞİ', form?.demoIsteyenKisi ?? ''])
  }
  if (form?.teslimTarihi || form?.teslimEdenKisi) {
    rows.push(['TESLİM TARİHİ', form?.teslimTarihi ?? ''], ['TESLİM EDEN KİŞİ', form?.teslimEdenKisi ?? ''])
  }
  // Both of these are printed only once the event actually stamped them —
  // otherwise an undelivered / unapproved sheet reads as already signed. The
  // on-screen ClassicSheet shows the same two rows under the same rule.
  if (form?.matbaaYetkilisi) rows.push(['MATBAA YETKİLİSİ', form.matbaaYetkilisi])
  if (form?.onaylayanKisi) rows.push(['ONAYLAYAN KİŞİ', form.onaylayanKisi])
  return rows
}

/**
 * Build ONE Baskı Onay Formu sheet — the boxed `layout: 'form'` shape that
 * formSection() renders. Same inputs as buildSpecRows, but the fields are
 * grouped the way the paper form is laid out instead of flattened into one
 * list: künye (İŞİN ADI + ADET/TARİH/BASIM YERİ/HAZIRLAYAN) and the parça's
 * own spec rows.
 *
 * @param component  { component, rows: [{label,value}] } | null
 * @param form       baskiOnayAdet / baskiOnayTarihi / basimYeri / baskiOnayHazirlayan …
 * @param title      the job / book name, printed under the form's title. The
 *                   İŞİN ADI row stays the parça, and the head drops the
 *                   subtitle when the two are the same (single-parça jobs).
 * @param attemptLabel  e.g. '2. BASKI ONAY' — blank on the sipariş side, which
 *                      has no attempt counter.
 */
export function buildBaskiOnayForm({ component, form, title, attemptLabel = '' }) {
  const isinAdi = component?.component ?? form?.isinAdi ?? title ?? ''
  const pairs = [
    ['ADET', form?.baskiOnayAdet ?? ''],
    ['TARİH', form?.baskiOnayTarihi ?? ''],
    ['BASIM YERİ', form?.basimYeri ?? ''],
    ['HAZIRLAYAN', form?.baskiOnayHazirlayan ?? ''],
  ]
  // Delivery only exists once the matbaa actually stamped it — an
  // undelivered sheet must not print a teslim row at all.
  if (form?.teslimTarihi || form?.teslimEdenKisi) {
    pairs.push(['TESLİM TARİHİ', form?.teslimTarihi ?? ''], ['TESLİM EDEN KİŞİ', form?.teslimEdenKisi ?? ''])
  }
  // Same rule as buildSpecRows: a signer prints only once the event actually
  // stamped them, so an unapproved sheet never reads as already signed.
  if (form?.matbaaYetkilisi) pairs.push(['MATBAA YETKİLİSİ', form.matbaaYetkilisi])
  if (form?.onaylayanKisi) pairs.push(['ONAYLAYAN KİŞİ', form.onaylayanKisi])
  return {
    layout: 'form',
    formTitle: 'BASKI ONAY FORMU',
    title: title ?? isinAdi,
    attemptLabel,
    isinAdi,
    pairs,
    specRows: (component?.rows ?? []).map((r) => [r.label, r.value]),
  }
}

// designerNames/onaylayanKisi/matbaaYetkilisi are still passed in by callers
// (buildSpecRows prints ONAYLAYAN KİŞİ / MATBAA YETKİLİSİ as plain rows) but
// the signature block itself is removed for now.
function sheetSection({ title, attemptLabel, rows }) {
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  const tableRows = (rows ?? [])
    .map(([l, v]) => `<tr><td class="label">${esc(l)}</td><td class="colon">:</td><td class="val">${esc(v || '')}</td></tr>`)
    .join('')
  return `<section class="sheet">
    <div class="doc-title">${esc(title)}</div>
    <div class="attempt-label">${esc(attemptLabel)}</div>
    <table>${tableRows}</table>
    <div class="date-line">Tarih: ${esc(today)}</div>
  </section>`
}

/* One Baskı Onay Formu sheet: title block, künye grid (İŞİN ADI full width,
   then two fields per row), and the spec table. */
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

  return `<section class="sheet form">
    <div class="form-head">
      <div class="form-title">${esc(formTitle || 'BASKI ONAY FORMU')}</div>
      ${sub ? `<div class="form-sub">${esc(sub)}</div>` : ''}
      ${attemptLabel ? `<div class="form-attempt">${esc(attemptLabel)}</div>` : ''}
    </div>
    <table class="meta">
      <tr><td class="k">İŞİN ADI</td><td class="v" colspan="3">${esc(isinAdi || '')}</td></tr>
      ${metaRows.join('')}
    </table>
    <div class="block-title">Baskı Özellikleri</div>
    <table class="spec">${specBody}</table>
    <div class="date-line">Yazdırma tarihi: ${esc(today)}</div>
  </section>`
}

/**
 * Print an array of sheets in ONE job. Each sheet is either
 *   { title, attemptLabel, rows: [[label,value]], designerNames, onaylayanKisi, matbaaYetkilisi }
 * or a `layout: 'form'` sheet from buildBaskiOnayForm().
 * Returns false if the window couldn't be opened (pop-up blocked).
 */
export function printSpecSheets(sheets, { docTitle = 'Form' } = {}) {
  const list = (sheets ?? []).filter(Boolean)
  if (list.length === 0) return true
  const body = list.map((s) => (s.layout === 'form' ? formSection(s) : sheetSection(s))).join('')
  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/>
  <link href="https://fonts.googleapis.com/css2?family=Alex+Brush&display=swap" rel="stylesheet"/>
  <title>${esc(docTitle)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#000}
    .sheet{padding:18mm 20mm;page-break-after:always}
    .sheet:last-child{page-break-after:auto}
    .doc-title{text-align:center;font-size:15pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:4px}
    .attempt-label{text-align:right;font-size:12pt;font-weight:700;padding:4px 0 8px;border-bottom:1px solid #ccc}
    table{width:100%;border-collapse:collapse}
    tr{border-bottom:1px solid #ddd}
    td{padding:5px 4px;vertical-align:top}
    td.label{width:44%;font-weight:700;font-size:9.5pt;text-transform:uppercase;letter-spacing:.03em}
    td.colon{width:4%;font-weight:700;text-align:center}
    td.val{width:52%;font-size:10.5pt;white-space:pre-wrap}
    .date-line{margin-top:14px;font-size:9.5pt;text-align:right;color:#444}
    .sig-section{margin-top:28px;display:flex}
    .sig-box{flex:1;border:1px solid #000;padding:12px 14px 10px;margin-right:-1px}
    .sig-box:last-child{margin-right:0}
    .sig-role{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:4px}
    .sig-name{font-family:'Alex Brush',cursive;font-size:20pt;color:#3d283499;min-height:22px;margin-bottom:8px}
    .sig-line{border-top:1px solid #000;margin-bottom:4px}
    .sig-hint{font-size:8pt;color:#888;text-align:center}

    /* Baskı Onay Formu — boxed form layout */
    .form .form-head{border:2px solid #000;padding:8px 10px 7px;text-align:center}
    .form .form-title{font-size:15pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
    .form .form-sub{margin-top:3px;font-size:10.5pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#222}
    .form .form-attempt{margin-top:2px;font-size:9pt;font-weight:700;letter-spacing:.06em;color:#555}
    .form table.meta,.form table.spec{border:2px solid #000;border-top:0}
    .form table.meta tr,.form table.spec tr{border-bottom:0}
    .form table.meta td,.form table.spec td{border:1px solid #000;padding:6px 8px;font-size:10.5pt;white-space:pre-wrap;vertical-align:top}
    .form table.meta td.k,.form table.spec td.k{width:22%;background:#f1f1f1;font-weight:700;font-size:9pt;text-transform:uppercase;letter-spacing:.03em}
    .form table.meta td.v{width:28%}
    .form table.spec td.k{width:30%}
    .form table.spec td.empty{color:#888;text-align:center}
    .form .block-title{border:2px solid #000;border-top:0;background:#f1f1f1;padding:5px;text-align:center;font-size:9pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase}

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
