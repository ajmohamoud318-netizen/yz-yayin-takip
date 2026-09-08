import { CheckSquare, FileText, Square } from 'lucide-react'

import {
  FormSheet,
  FormSheetBlock,
  FormSheetHead,
  SheetAddRow,
  SheetRow,
  SheetSpecRow,
} from '@/components/FormSheet'
import { missingTemplateLabels, parcaKind } from '@/data/parcaTemplates'
import { isAdetLabel } from '@/lib/spec-form-adet'
import { projectHasLivePageCount } from '@/lib/spec-form-resolve'

/**
 * The spec sheet itself — the document half of SpecFormDialog (slice: client
 * god-components).
 *
 * The dialog IS the form: the same document openMultiPrint() puts on paper,
 * rendered live — title block, the spec (added rows or a block per parça),
 * then the künye as the foot. Editing and read-only share the layout; only the
 * fields switch between input and plain text, so a sheet nobody can edit reads
 * as a document rather than a page of dead inputs.
 *
 * Everything here is presentation: it owns no state and makes no decision
 * about who may edit what. `readOnly` / `systemRowReadOnly` arrive already
 * resolved from the dialog, and every edit is handed straight back up.
 */
export default function SpecSheetBody({
  variant,
  project,
  user,
  form,
  onChange,
  readOnly,
  systemRowReadOnly,
  shownAttemptNo,
  customRows,
  onAddCustomRow,
  onUpdateCustomRow,
  onRemoveCustomRow,
  onMoveCustomRow,
  catalogComponents,
  hideParcaPicker = false,
  lockedParcalar = [],
  decisionParcalar = null,
  decisionNotes = null,
  selectedComponents,
  onToggleComponent,
  onSelectAllComponents,
  onClearComponents,
  onAddComponentRow,
  onUpdateComponentRow,
  onRemoveComponentRow,
  onMoveComponentRow,
}) {
  const hasCatalog = catalogComponents.length > 0
  /* Parçalar the matbaa is producing right now (migration 077). Their blocks
     render read-only while the rest of the sheet stays editable: the leader
     may still correct KİTAP while KUTU is on the press, and the server refuses
     exactly the same set (computeDemoEdit + domain/spec-parca-diff.js).
     Name-keyed and Turkish-folded for the same reason lib/spec-form-scope.js
     is — a KILAVUZ that came back as "Kılavuz" must still match its block. */
  const lockedParcaSet = new Set(
    (lockedParcalar ?? [])
      .filter(Boolean)
      .map((n) => String(n).trim().toLocaleUpperCase('tr')),
  )
  const isParcaLocked = (c) => lockedParcaSet.size > 0
    && lockedParcaSet.has(String(c?.component ?? '').trim().toLocaleUpperCase('tr'))
  /* Parçalar the pending decision actually covers (SpecFormDialog →
     decisionParcalar). Marked per block only while the sheet is showing
     something the decision does NOT cover — i.e. after the reader widened a
     one-parça Onaylayın/Reddedin to read the round. Narrowed, every block on
     screen is the decision and the strips would be noise; on a bulk decision
     the scope is the whole sheet and there is nothing to distinguish. Same
     name-keying and Turkish fold as the lock above, for the same reason. */
  const decisionParcaSet = new Set(
    (decisionParcalar ?? [])
      .filter(Boolean)
      .map((n) => String(n).trim().toLocaleUpperCase('tr')),
  )
  const isParcaDecided = (c) => decisionParcaSet.has(String(c?.component ?? '').trim().toLocaleUpperCase('tr'))
  const marksDecision = !!decisionNotes && decisionParcaSet.size > 0
    && selectedComponents.some((c) => !isParcaDecided(c))
  // Parça blocks replace the single İŞİN ADI + custom-rows body: with them on
  // the sheet there is no one job name for the künye to carry, since each
  // block names its own (and prints as that sheet's İŞİN ADI — see
  // specPrint.buildFormSheet).
  //
  // What the sheet CARRIES decides this, not what the catalog still lists: a
  // saved snapshot keeps its parçalar even if the project's Ürün Bilgileri
  // was emptied since, and openMultiPrint prints them from that same
  // selection. Gating on the catalog too made such a sheet fall back to the
  // İŞİN ADI + custom-rows body on screen while still printing parça pages.
  const showsComponentCards = selectedComponents.length > 0
  // The picker is on screen only for someone who may still change the
  // selection — see the block that renders it below for why each of these
  // three conditions is there.
  const showsPicker = hasCatalog && !readOnly && !hideParcaPicker
  // …and while it is up with nothing ticked, this sheet has no body at all.
  //
  // The İŞİN ADI + custom-rows body below is the fallback for a product with
  // NO Ürün Bilgileri, not a second way to spec one that has parçalar: ticking
  // a single box already replaces it. Leaving it on screen while every box was
  // unticked offered a whole form — job name, "Satır Ekleyin", künye — that
  // nobody would ever send, under a send gate refusing it in the name of a
  // block ("X: en az 2 satır doldurun") the sheet isn't really made of. So the
  // document waits for the pick and says so, and the dialog's gates say the
  // same thing above the footer (SpecFormDialog → noParcaSelected).
  const awaitingParcaPick = showsPicker && !showsComponentCards
  // Two parça cards fit beside each other in this dialog; three or more do
  // not, so they stack instead. See the block that renders them for why.
  const stacksParca = selectedComponents.length > 2
  // The SAYFA SAYISI row is owned by project düzenleme (the "Toplam iç sayfa"
  // input under the İç Sayfalar subtask). When the project carries a live
  // count, the spec form displays it read-only — the resolver in
  // useSpecSheet has already substituted the live total_pages for the row's
  // value, and locking here prevents anyone from typing an override that
  // would round-trip back into product_info on save and sever the live link.
  // A project without İç Sayfalar (or with no pages yet) keeps the row user-
  // owned and editable.
  //
  // The lock follows the substitution, so it is scoped the same way: only the
  // `main` parça's SAYFA SAYISI is the count İç Sayfalar owns. A KILAVUZ has
  // its own — two pages inside a 32-page set — and locking that row left it
  // showing the book's number with no way to correct it.
  const hasLivePageCount = projectHasLivePageCount(project)
  const livePageCountLocks = (comp) => hasLivePageCount && parcaKind(comp) === 'main'
  const isSayfaSayisiRow = (label) => String(label ?? '').trim().toUpperCase() === 'SAYFA SAYISI'
  // ADET is a spec row on the Baskı Onay Formu — one per parça, under its
  // SAYFA SAYISI — and the sheet may not go out with any of them blank. Every
  // other sheet carries no ADET row at all, so nothing to mark there.
  const isRequiredRow = (label) => !!variant.requiresAdet && isAdetLabel(label)

  /* The fixed rows — the ones the form always carries, whoever filled it in:
     stamps the form writes about itself (who asked, when, who delivered, who
     approved) plus the fields the künye always names. Rows, not a block: they
     read as part of the same continuous sheet as everything above them, and
     the caller decides where in it they land. */
  const fixedKunyeRows = (
    <>
      {/* ADET is not here: it belongs to the PARÇA, under its SAYFA SAYISI,
          because a sipariş can order 5.000 books in 2.500 boxes and the künye
          has room for one number. See lib/spec-form-adet.js. */}
      {/* İSTEM rows are shown to every role — the matbaa needs to know who
          requested the demo/ozalit and when, not just its own delivery stamp. */}
      <SheetRow label={variant.dateLabel} name={variant.dateField} value={form[variant.dateField]} onChange={onChange} readOnly={systemRowReadOnly} />
      {/* BASIM YERİ — right before HAZIRLAYAN, per the feature ask. */}
      {variant.locationField && (
        <SheetRow
          label={variant.locationLabel}
          name={variant.locationField}
          value={form[variant.locationField] ?? ''}
          onChange={onChange}
          readOnly={readOnly}
          required
        />
      )}
      <SheetRow label={variant.personLabel} name={variant.personField} value={form[variant.personField]} onChange={onChange} readOnly />
      {/* Blank until handleAdvance stamps them at the moment of teslimat. */}
      {(user?.role === 'printer' || form.teslimTarihi || form.teslimEdenKisi) && (
        <>
          <SheetRow label="TESLİM TARİHİ" name="teslimTarihi" value={form.teslimTarihi ?? ''} onChange={onChange} readOnly={systemRowReadOnly} />
          <SheetRow label="TESLİM EDEN KİŞİ" name="teslimEdenKisi" value={form.teslimEdenKisi ?? ''} onChange={onChange} readOnly />
        </>
      )}
      {/* The receipt half of the handover: whoever answered "Teslim Aldım" at
          the gate. Shown only once someone has, like the two signatures below
          it — the matbaa's own empty-row treatment above is for a box THEY are
          about to fill, and nobody fills this one on the matbaa's behalf. */}
      {form.teslimAlanKisi && <SheetRow label="TESLİM ALAN KİŞİ" value={form.teslimAlanKisi} readOnly />}
      {form.matbaaYetkilisi && <SheetRow label="MATBAA YETKİLİSİ" value={form.matbaaYetkilisi} readOnly />}
      {form.onaylayanKisi && <SheetRow label="ONAYLAYAN KİŞİ" value={form.onaylayanKisi} readOnly />}
    </>
  )

  return (
    <FormSheet>
      <FormSheetHead
        title={variant.title}
        subtitle={project.title}
        attemptLabel={`${shownAttemptNo}. ${variant.attemptUpper}`}
        icon={FileText}
      />

      {/* Per-component picker — only when the project has product info.
          Pure editing control: it never goes on paper.

          It sits directly under the head, above everything it governs, in
          BOTH states. Rendered after the no-parça block instead, it fell to
          the foot of the sheet while nothing was selected and jumped to the
          top the moment a box was ticked — on a phone, the control you just
          used teleported a full scroll away and the whole form reflowed
          under your thumb. */}
      {/* Hidden while the sheet is narrowed to one parça (SpecFormDialog's
          `parcaScope`): this picker governs the WHOLE selection — what the
          round carries and what a save writes back — so above a sheet showing
          one of three parçalar it would tick three boxes and contradict the
          document under it. The dialog's "Tüm parçaları gösterin" brings both
          back together. */}
      {showsPicker && (
        <div className="border-b bg-muted/20 px-4 py-3 print:hidden">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Parçalar (ürün bilgilerinden)
            </p>
            <div className="flex items-center gap-3 text-[11px]">
              <button
                type="button"
                onClick={onSelectAllComponents}
                className="font-semibold text-primary hover:underline"
              >
                Tümünü Seç
              </button>
              <button
                type="button"
                onClick={onClearComponents}
                className="font-semibold text-muted-foreground hover:underline"
              >
                Hiçbiri
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {catalogComponents.map((c) => {
              const onSheet = selectedComponents.find((s) => s.id === c.id)
              const checked = !!onSheet
              // Count what this parça carries ON THE SHEET once it is on it —
              // the catalog is a shell on most projects ("0 satır") while the
              // rows actually printed came from the saved sheet or from this
              // form, and a picker saying 0 above a block showing rows reads
              // as one of the two being wrong.
              const rowCount = (onSheet ?? c).rows?.length ?? 0
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onToggleComponent(c.id)}
                  className={`flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-left text-xs transition active:scale-[0.99] ${
                    checked ? 'border-primary/50 ring-1 ring-primary/30' : 'hover:border-primary/30'
                  }`}
                >
                  {checked
                    ? <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                    : <Square className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate font-semibold uppercase tracking-wide">{c.component}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{rowCount} satır</span>
                </button>
              )
            })}
          </div>
          {selectedComponents.length > 0 && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Yazdır / Gönder dediğinizde <strong>{selectedComponents.length}</strong> ayrı form oluşturulur, her parça kendi sayfasında.
            </p>
          )}
        </div>
      )}

      {/* Nothing to fill in yet: the parçalar ARE this sheet, so until one is
          ticked there is no form under the picker — just the reason there
          isn't, and the one-tap way out of it. Screen only; it is part of the
          picker, and the picker never goes on paper. */}
      {awaitingParcaPick && (
        <div className="flex flex-col items-center gap-2 border-b bg-muted/10 px-4 py-8 text-center print:hidden">
          <FileText className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm font-semibold">Önce parça seçin</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            Bu ürün {catalogComponents.length} parçadan oluşuyor. Formu seçtiğiniz
            parçalar oluşturur — her biri kendi sayfasında.
          </p>
          <button
            type="button"
            onClick={onSelectAllComponents}
            className="mt-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary transition active:scale-[0.99] hover:bg-primary/5"
          >
            Tümünü Seçin
          </button>
        </div>
      )}

      {/* One continuous sheet: the job name, the rows the user added, then
          the fixed rows as its foot — all on the same block so every rule
          between them is the same hairline and the form reads as one
          document, not as sections stacked on top of each other. */}
      {!showsComponentCards && !awaitingParcaPick && (
        <FormSheetBlock className="bg-muted/10">
          <SheetRow label="İŞİN ADI" name="isinAdi" value={form.isinAdi} onChange={onChange} readOnly={systemRowReadOnly} />
          {customRows.map((r, i) => (
            <SheetSpecRow
              key={r.id}
              label={r.label}
              value={r.value}
              onLabelChange={(v) => onUpdateCustomRow(r.id, 'label', v)}
              onValueChange={(v) => onUpdateCustomRow(r.id, 'value', v)}
              onRemove={() => onRemoveCustomRow(r.id)}
              onMoveUp={customRows.length > 1 && i > 0 ? () => onMoveCustomRow(r.id, -1) : null}
              onMoveDown={customRows.length > 1 && i < customRows.length - 1 ? () => onMoveCustomRow(r.id, 1) : null}
              readOnly={readOnly || (hasLivePageCount && isSayfaSayisiRow(r.label))}
              required={isRequiredRow(r.label)}
            />
          ))}
          {/* With no parça blocks these rows ARE the product's own sheet, so
              the lead parça's template is what they can be missing. */}
          {!readOnly && (
            <SheetAddRow
              onClick={() => onAddCustomRow()}
              suggestions={missingTemplateLabels('main', customRows)}
              onAddSuggestion={onAddCustomRow}
            />
          )}
          {fixedKunyeRows}
        </FormSheetBlock>
      )}

      {/* The editor learns this from the picker's own line ("… 3 ayrı form
          oluşturulur"), which is part of an editing control and so never
          renders for the matbaa — the one reader who has to know how many
          sheets are coming. Same fact, in the same place, for them. */}
      {showsComponentCards && readOnly && selectedComponents.length > 1 && (
        <p className="border-b bg-muted/20 px-4 py-2 text-center text-[10px] text-muted-foreground print:hidden">
          Bu form <strong>{selectedComponents.length}</strong> parçadan oluşur — her parça kendi sayfasında basılır.
        </p>
      )}

      {/* Selected parçalar — one page each on paper; on screen a pair sits
          side by side and anything longer stacks. Edits here flow back to
          Ürün Bilgileri on save. With no catalog, or nothing selected, there
          are no parça blocks and the added rows above are the sheet's whole
          spec.

          Two columns is the whole allowance: this dialog is max-w-2xl, so a
          third column leaves each card near 200px and folds "SETTEKİ KİTAP
          SAYISI" into four lines. That is also why a three-parça round is not
          simply two-then-one — a card that wraps to a second row reads as an
          afterthought of the pair above it, when the three are equals. Past
          two, every card gets the full width and they run down the sheet in
          order, each one legible, which is how they come off the printer
          anyway. One column below `sm` regardless, since this app is used on
          phones first.

          `print:block` puts the stack back for paper in every case, where the
          cards are not a layout at all — each parça is a separate PAGE,
          headed and signed on its own (the two blocks inside handle that),
          and the card chrome would only print a box around it. */}
      {showsComponentCards && (
        <div className={`grid grid-cols-1 gap-3 border-b bg-muted/20 p-3 print:block print:gap-0 print:border-0 print:bg-transparent print:p-0 ${stacksParca ? '' : 'sm:grid-cols-2'}`}>
          {selectedComponents.map((c, ci) => {
          const parcaLocked = isParcaLocked(c)
          // Context, not the decision: dimmed so a reader scrolling the round
          // can tell the two apart before reading a word. Screen only — on
          // paper this is an ordinary page of the sheet.
          const parcaOutOfDecision = marksDecision && !isParcaDecided(c)
          return (
          <div
            key={c.id}
            className={`overflow-hidden rounded-lg border bg-white print:rounded-none print:border-0 ${parcaOutOfDecision ? 'opacity-70 print:opacity-100' : ''}`}
            {...(ci > 0 ? { 'data-print-page': '' } : {})}
          >
            {/* Every parça starts a new page when the browser prints this
                sheet (index.css → [data-print-page]), so a continuation page
                needs the form's own head again — otherwise the KUTU sheet
                comes out of the printer as a bare block title belonging to no
                form and no job. The Yazdır button heads each parça sheet the
                same way (lib/specPrint.js → formSection); this keeps the two
                print paths producing the same document. */}
            {ci > 0 && (
              <div className="hidden print:block">
                <FormSheetHead
                  title={variant.title}
                  subtitle={project.title}
                  attemptLabel={`${shownAttemptNo}. ${variant.attemptUpper}`}
                />
              </div>
            )}
            {/* The name gets a block of its own so the tint can run edge to
                edge inside the card. It cannot simply be the first row of the
                block below with a background on it: a row bleeding out of its
                block needs negative margins, which widen its grid by the
                padding and shift its 36% label column — and with it the colon
                and the rule down the value column — out of line with every
                row underneath. Two blocks, same padding, same columns. */}
            <FormSheetBlock className="bg-muted/40 px-3 print:bg-transparent">
              {/* The parça names itself with an İŞİN ADI row, exactly as it
                  does on paper (specPrint.js → formSection puts the same row
                  at the top of every sheet it builds) and exactly as the
                  no-parça body above does. It used to be a centred caption
                  instead, which meant the parça blocks were the one place on
                  this form where screen and print disagreed about what the
                  sheet says.

                  Read-only, and NOT one of `c.rows`: the name is the parça's
                  identity — the id the selection, the catalog write-back and
                  the print all key on — and renaming it belongs in Ürün
                  Bilgileri, not here. It is also why the send gate counts two
                  rows BESIDES this one (lib/spec-form-completeness.js): İŞİN
                  ADI comes filled in and proves nothing about the spec.

                  It doubles as the card's head on screen: tinted, and set in
                  the same weight as its label. Both are screen-only — on paper
                  the page break and the repeated form head do this job. */}
              <SheetRow
                label="İŞİN ADI"
                value={c.component}
                readOnly
                className="font-semibold print:font-normal"
                badge={selectedComponents.length > 1 ? (
                  // Only while the cards are stacked — which is every width
                  // for a round of three or more, and the phone width for a
                  // pair. Side by side you can simply see that there are two,
                  // and at ~270px a card has no room for a pill saying so;
                  // stacked, the counter is the only thing telling a reader
                  // scrolling past the fourth block how much sheet is left.
                  <span className={`shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border ${stacksParca ? '' : 'sm:hidden'}`}>
                    Parça {ci + 1}/{selectedComponents.length}
                  </span>
                ) : null}
              />
            </FormSheetBlock>
            {/* What this block IS to the decision waiting in the footer. A
                full-width strip rather than a pill beside İŞİN ADI: the parça
                name is the one thing on the card that must never be squeezed,
                and at 390px a badge next to it would do exactly that. Mirrors
                the locked-parça strip below in shape and position. */}
            {marksDecision && (
              <p className={parcaOutOfDecision
                ? 'bg-muted px-3 py-1.5 text-[11px] font-medium leading-snug text-muted-foreground print:hidden'
                : 'bg-primary/10 px-3 py-1.5 text-[11px] font-semibold leading-snug text-primary print:hidden'}
              >
                {parcaOutOfDecision ? decisionNotes.outScope : decisionNotes.inScope}
              </p>
            )}
            {parcaLocked && (
              <p className="bg-amber-50 px-3 py-1.5 text-[11px] font-medium leading-snug text-amber-800 print:hidden">
                Matbaa bu parçanın baskısına başladı — düzenlemek için değişiklik
                isteyin. Diğer parçaları düzenlemeye devam edebilirsiniz.
              </p>
            )}
            <FormSheetBlock className="border-b-0 px-3">
              {(c.rows ?? []).length === 0 && readOnly && (
                <p className="py-2 text-center text-[11px] text-muted-foreground">Satır yok.</p>
              )}
              {(c.rows ?? []).map((r, i) => (
                <SheetSpecRow
                  key={r.id}
                  label={r.label}
                  value={r.value}
                  onLabelChange={(v) => onUpdateComponentRow(c.id, r.id, 'label', v)}
                  onValueChange={(v) => onUpdateComponentRow(c.id, r.id, 'value', v)}
                  onRemove={() => onRemoveComponentRow(c.id, r.id)}
                  onMoveUp={(c.rows ?? []).length > 1 && i > 0 ? () => onMoveComponentRow(c.id, r.id, -1) : null}
                  onMoveDown={(c.rows ?? []).length > 1 && i < (c.rows ?? []).length - 1 ? () => onMoveComponentRow(c.id, r.id, 1) : null}
                  readOnly={readOnly || parcaLocked || (livePageCountLocks(c) && isSayfaSayisiRow(r.label))}
                  required={isRequiredRow(r.label)}
                />
              ))}
              {!readOnly && !parcaLocked && (
                <SheetAddRow
                  onClick={() => onAddComponentRow(c.id)}
                  suggestions={missingTemplateLabels(parcaKind(c), c.rows)}
                  onAddSuggestion={(label) => onAddComponentRow(c.id, label)}
                />
              )}
            </FormSheetBlock>
            {/* …and its own künye, for the same reason the head is repeated:
                each parça leaves the printer as a STANDALONE sheet, and the
                Yazdır button gives every one of them the stamps (İSTEM /
                TESLİM / ONAY — specPrint.buildFormSheet passes the same
                künye to every sheet it builds). The browser's own print put
                them on the last page only, so the KUTU sheet went to the
                matbaa with no record of who asked for it or when. On screen
                this stays a single document: one künye, at the foot. The
                last parça is followed by that real foot, so it is skipped
                here rather than printing two. */}
            {ci < selectedComponents.length - 1 && (
              <div className="hidden border-t bg-muted/10 print:block">
                <FormSheetBlock className="border-b-0">{fixedKunyeRows}</FormSheetBlock>
              </div>
            )}
          </div>
          )
          })}
        </div>
      )}

      {showsComponentCards && !readOnly && (
        <p className="px-4 py-2 text-[10px] text-muted-foreground print:hidden">
          Buradaki düzenlemeler Ürün Bilgileri'ne de kaydedilir.
        </p>
      )}

      {/* The form's foot. Without parça blocks these rows already close
          the single block above — putting them in a block of their own
          there would cut the sheet in two, which is the one thing this
          form must not do. With parça blocks there is no such block to
          close, so they get one here. */}
      {showsComponentCards && (
        <FormSheetBlock className="bg-muted/10">{fixedKunyeRows}</FormSheetBlock>
      )}
    </FormSheet>
  )
}
