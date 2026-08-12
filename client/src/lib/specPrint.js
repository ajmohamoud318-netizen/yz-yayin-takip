/**
 * Shared print for Demo / Ozalit spec forms.
 *
 * A product can have several parçalar (kitap + kutu + …). Each parça prints as
 * its own classic single-column sheet, but they must all come out of a SINGLE
 * print job — opening one window per parça trips pop-up blockers (only the
 * first survives) and forces the user through several print dialogs. This
 * builds one HTML document with a page break between sheets and prints once.
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * Build the [label, value] rows for one parça sheet.
 *
 * @param component  { component, rows: [{label,value}] } | null
 * @param form       the saved form object (dates / requester / approver)
 * @param kind       'demo' | 'ozalit'
 */
export function buildSpecRows({ component, form, kind }) {
  const rows = [['İŞİN ADI', component?.component ?? form?.isinAdi ?? '']]
  for (const r of component?.rows ?? []) rows.push([r.label, r.value])
  if (kind === 'ozalit') {
    rows.push(['OZALİT İSTEM TARİHİ', form?.ozalitIstemTarihi ?? ''], ['OZALİT İSTEYEN KİŞİ', form?.ozalitIsteyenKisi ?? ''])
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

function sheetSection({ title, attemptLabel, rows, designerNames, onaylayanKisi, matbaaYetkilisi }) {
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  const tableRows = (rows ?? [])
    .map(([l, v]) => `<tr><td class="label">${esc(l)}</td><td class="colon">:</td><td class="val">${esc(v || '')}</td></tr>`)
    .join('')
  const sig = (role, name) =>
    `<div class="sig-box"><p class="sig-role">${esc(role)}</p><p class="sig-name">${esc(name || '')}</p><div class="sig-line"></div><p class="sig-hint">İmza</p></div>`
  return `<section class="sheet">
    <div class="doc-title">${esc(title)}</div>
    <div class="attempt-label">${esc(attemptLabel)}</div>
    <table>${tableRows}</table>
    <div class="date-line">Tarih: ${esc(today)}</div>
    <div class="sig-section">
      ${sig('Tasarımcı', designerNames)}
      ${onaylayanKisi ? sig('Ekip Lideri / Onaylayan', onaylayanKisi) : ''}
      ${matbaaYetkilisi ? sig('Matbaa Yetkilisi', matbaaYetkilisi) : ''}
    </div>
  </section>`
}

/**
 * Print an array of sheets in ONE job. Each sheet:
 *   { title, attemptLabel, rows: [[label,value]], designerNames, onaylayanKisi, matbaaYetkilisi }
 * Returns false if the window couldn't be opened (pop-up blocked).
 */
export function printSpecSheets(sheets, { docTitle = 'Form' } = {}) {
  const list = (sheets ?? []).filter(Boolean)
  if (list.length === 0) return true
  const body = list.map(sheetSection).join('')
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
