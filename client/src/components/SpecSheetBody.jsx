import { CheckSquare, FileText, Square } from 'lucide-react'

import {
  FormSheet,
  FormSheetBlock,
  FormSheetBlockTitle,
  FormSheetHead,
  SheetAddRow,
  SheetRow,
  SheetSpecRow,
} from '@/components/FormSheet'

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
  // Parça blocks replace the single İŞİN ADI + custom-rows body: with them on
  // the sheet there is no one job name for the künye to carry, since each
  // block names its own.
  const showsComponentCards = hasCatalog && selectedComponents.length > 0

  /* The fixed rows — the ones the form always carries, whoever filled it in:
     stamps the form writes about itself (who asked, when, who delivered, who
     approved) plus the fields the künye always names. Rows, not a block: they
     read as part of the same continuous sheet as everything above them, and
     the caller decides where in it they land. */
  const fixedKunyeRows = (
    <>
      {/* ADET — dedicated field on the Baskı Onay Formu, auto-filled from a
          live sipariş order or the borrowed ozalit sheet (see the load
          effect); the leader can still correct it. */}
      {variant.adetField && (
        <SheetRow
          label={variant.adetLabel}
          name={variant.adetField}
          value={form[variant.adetField] ?? ''}
          onChange={onChange}
          readOnly={readOnly}
          required
        />
      )}
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

      {/* One continuous sheet: the job name, the rows the user added, then
          the fixed rows as its foot — all on the same block so every rule
          between them is the same hairline and the form reads as one
          document, not as sections stacked on top of each other. */}
      {!showsComponentCards && (
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
              readOnly={readOnly}
            />
          ))}
          {!readOnly && <SheetAddRow onClick={onAddCustomRow} />}
          {fixedKunyeRows}
        </FormSheetBlock>
      )}

      {/* Per-component picker — only when the project has product info.
          Pure editing control: it never goes on paper. */}
      {hasCatalog && !readOnly && (
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
              const checked = selectedComponents.some((s) => s.id === c.id)
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
                  <span className="shrink-0 text-[10px] text-muted-foreground">{c.rows.length} satır</span>
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

      {/* Selected parçalar, stacked as blocks of the same sheet — each one
          prints as its own page. Edits here flow back to Ürün Bilgileri on
          save. With no catalog, or nothing selected, there are no parça
          blocks and the added rows above are the sheet's whole spec. */}
      {showsComponentCards &&
        selectedComponents.map((c) => (
          <div key={c.id} className="border-b last:border-b-0">
            <FormSheetBlockTitle>{c.component}</FormSheetBlockTitle>
            <FormSheetBlock className="border-b-0">
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
                  readOnly={readOnly}
                />
              ))}
              {!readOnly && <SheetAddRow onClick={() => onAddComponentRow(c.id)} />}
            </FormSheetBlock>
          </div>
        ))}

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
