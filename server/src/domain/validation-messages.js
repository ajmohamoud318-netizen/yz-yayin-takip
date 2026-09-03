/**
 * Translate Fastify v5 Ajv validation errors into user-friendly Turkish
 * messages.
 *
 * The default Fastify response carries the raw Ajv string ("body must NOT
 * have additional properties", "body/stage must be equal to one of the
 * allowed values") which is English, doesn't name the offending field,
 * and leaks internals like `items.0.stage` and stage codes
 * (`baskida`/`gumruk`/`satista`). The users here are team leaders,
 * designers, printers, and sales — book-production people, not
 * developers — and they shouldn't have to recognise any of that.
 *
 * This module is the single source of truth for translating those errors
 * into the same warm, direct Turkish the rest of the app uses
 * (e.g. `domain/errors.js`'s "Yetkisiz erişim", `client/src/api.js`'s
 * existing toast strings). Every message:
 *
 *   - names the field with a real Turkish label ("kitap adı", "e-posta",
 *     "hedef ay") via `FIELD_LABELS`, never the raw internal key;
 *   - translates enum codes via `ENUM_LABELS` (which re-uses
 *     `STAGE_LABELS`, `ROLE_LABELS`, `PASS_KIND_LABEL`, etc.) so the user
 *     sees "Baskıda, Gümrükte, Satışta" instead of "baskida, gumruk,
 *     satista";
 *   - swaps Ajv type names (`string`, `integer`, `boolean`) for plain
 *     Turkish words ("yazı", "tam sayı", "evet/hayır");
 *   - turns snake/camel-case keys into a friendly fallback
 *     (`target_month` → "hedef ay" via the map, or "target month" if not
 *     mapped), so even unmapped fields render readably;
 *   - uses array indices to render row context ("3. satırdaki aşama")
 *     for paths like `/items/2/stage` so the user knows which row to fix
 *     in a list-based form.
 *
 * Each error becomes `{ path, keyword, message }`. The full list is
 * returned, not just the first one, so future forms can render
 * per-field errors from a single round trip. Today the SPA reads
 * `response.data.error` for the top-line toast — that field stays as the
 * first translated message, so nothing on the client has to change.
 *
 * `context` is Fastify's `validationContext`: 'body' | 'querystring' |
 * 'params' | 'headers'. Used only as a final fallback when no field
 * label applies.
 */

import { STAGE_LABELS } from './stages.js'

/**
 * Friendly Turkish labels for the most common internal field names.
 * Anything not listed here falls back to `prettifyFieldName` so the
 * message still reads as plain words rather than `target_month`.
 *
 * "Common" here means: fields whose names appear in user-facing messages
 * elsewhere in the codebase. The list is intentionally long because the
 * schemas index.js has ~80 distinct keys; building the label once at
 * boot is cheaper than rendering raw keys forever.
 */
const FIELD_LABELS = {
  // Project (projects/ projectsImport)
  title: 'kitap adı',
  type: 'tür',
  target_month: 'hedef ay',
  pass_kind: 'baskı türü',
  assigned_to: 'atanan kişi',
  assignees: 'atanan kişiler',
  subtasks: 'alt görevler',
  subtaskAssignees: 'alt görev atamaları',
  pageCount: 'sayfa sayısı',
  stickerCount: 'sticker sayısı',
  productInfo: 'ürün bilgileri',
  hidden: 'gizlilik',
  // Auth / users
  email: 'e-posta',
  password: 'şifre',
  currentPassword: 'mevcut şifre',
  newPassword: 'yeni şifre',
  name: 'ad',
  token: 'davet kodu',
  user_id: 'kullanıcı',
  role: 'rol',
  // Project sub-objects
  stage: 'aşama',
  status: 'durum',
  kind: 'tür',
  reason: 'sebep',
  note: 'not',
  notes: 'notlar',
  quantity: 'adet',
  attempt: 'deneme sayısı',
  payload: 'form içeriği',
  silent: 'sessiz kayıt',
  // Subtask
  total_pages: 'toplam sayfa',
  pages_done: 'yapılan sayfa',
  total_stickers: 'toplam sticker',
  stickers_done: 'yapılan sticker',
  is_done: 'tamamlandı',
  needs_revize: 'revize gerekli',
  // Demo / ozalit
  demo_id: 'demo kayıt numarası',
  // Forms (orders)
  order_id: 'sipariş',
  expectedVersion: 'sürüm',
  route: 'yön',
  revizeIds: 'revize edilecek görevler',
  reject_target: 'geri gönderilecek yer',
  rejectTarget: 'geri gönderilecek yer',
  // Spec form / ürün bilgileri
  components: 'parça bilgileri',
  component: 'parça',
  fields: 'alanlar',
  k: 'alan adı',
  v: 'değer',
  date: 'tarih',
  adet: 'adet',
  tarih: 'tarih',
  basimYeri: 'baskı yeri',
  hazirlayan: 'hazırlayan',
  // Meetings / ideas
  meeting_at: 'toplantı zamanı',
  project_id: 'proje',
  link: 'bağlantı',
  links: 'bağlantılar',
  body: 'metin',
  days: 'gün',
  // Item / collection containers
  items: 'liste',
}

/**
 * Friendly Turkish words for Ajv's primitive type names. Anything not
 * listed here falls back to the raw type, which only happens for the
 * exotic Ajv keywords our schemas don't currently use.
 */
const TYPE_LABELS_TR = {
  string: 'yazı',
  integer: 'tam sayı',
  number: 'sayı',
  boolean: 'evet/hayır',
  array: 'liste',
  object: 'bilgi grubu',
  null: 'boş',
}

/**
 * Per-field enum value labels. Each entry maps an internal enum key to
 * its user-facing Turkish label, mirroring the maps already exposed by
 * the client (`STAGE_LABELS`, `ROLE_LABELS`, `PASS_KIND_LABEL`, etc.).
 *
 * Schemas that reuse these codes (e.g. `reject_target` ↔ `rejectTarget`
 * between projects and orders) keep their entries side-by-side so the
 * translator doesn't have to know which endpoint it's on.
 */
const ENUM_LABELS = {
  stage: STAGE_LABELS,
  pass_kind: {
    first_edition: 'İlk Baskı',
    reprint: 'Yeniden Baskı',
    redesign: 'Yeniden Tasarım',
  },
  role: {
    team_leader: 'Takım Lideri',
    designer: 'Tasarımcı',
    printer: 'Matbaa',
    satis: 'Satış Ekibi',
  },
  type: { TR: 'TR', CIN: 'ÇİN' },
  kind: {
    demo: 'Demo',
    ozalit: 'Ozalit',
    baski_onay: 'Baskı Onayı',
    check: 'Kontrol',
    pages: 'Sayfalar',
    'sticker-count': 'Sticker',
    main: 'Ana Reçete',
    kutu: 'Kutu Reçetesi',
    kilavuz: 'Kılavuz Reçetesi',
    other: 'Diğer',
  },
  status: {
    pending: 'Beklemede',
    done: 'Tamamlandı',
    rework: 'Revize',
  },
  rejectTarget: {
    matbaa: 'Matbaaya',
    designer: 'Tasarımcıya',
    reassign: 'Yeniden Atama',
  },
  reject_target: {
    matbaa: 'Matbaaya',
    designer: 'Tasarımcıya',
    reassign: 'Yeniden Atama',
  },
  route: {
    ozalit: 'Ozalit',
    ekran: 'Ekran',
    tasarimci_onay: 'Tasarımcı Onayı',
    ekran_onay: 'Ekran Onayı',
  },
}

const CONTEXT_LABELS = {
  body: 'Form',
  querystring: 'Adres çubuğu',
  params: 'Bağlantı',
  headers: 'İstek başlıkları',
}

/**
 * @param {Array} ajvErrors  Fastify v5 `err.validation[]` array.
 * @param {string} [context] Fastify v5 `err.validationContext`.
 * @returns {Array<{ path: string|null, keyword: string, message: string }>}
 */
export function translateValidationErrors(ajvErrors, context = 'body') {
  if (!Array.isArray(ajvErrors) || ajvErrors.length === 0) {
    return [{
      path: null,
      keyword: 'unknown',
      message: 'Form gönderilemedi. Lütfen tekrar deneyin.',
    }]
  }
  return ajvErrors.map((err) => ({
    path: instancePathToDotted(err.instancePath),
    keyword: err.keyword ?? 'unknown',
    message: formatAjvError(err, context),
  }))
}

/**
 * Convert Ajv's JSON-pointer-style `instancePath` ("/items/3/title")
 * into a dot path ("items.3.title") for machine consumption. The
 * user-friendly breadcrumb ("3. satırdaki kitap adı") is built
 * separately by `describePath`.
 */
function instancePathToDotted(instancePath) {
  if (!instancePath || typeof instancePath !== 'string') return null
  const trimmed = instancePath.replace(/^\//, '').replace(/\//g, '.')
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Build a plain-Turkish breadcrumb from an Ajv instance path.
 *
 *   "/title"             → "kitap adı"
 *   "/items/2/stage"     → "3. satırdaki aşama"
 *   "/items/0/fields/2"  → "1. satırdaki 3. alan"
 *   "/unknown_key"       → "unknown key"
 *
 * Returns `null` for empty paths (the error isn't bound to any specific
 * field). Used inside `formatAjvError` to prefix every message that
 * names a field.
 */
function describePath(instancePath) {
  if (!instancePath || typeof instancePath !== 'string') return null
  const segments = instancePath.replace(/^\//, '').split('/').filter(Boolean)
  if (segments.length === 0) return null

  const leaf = segments[segments.length - 1]
  const leafLabel = FIELD_LABELS[leaf] ?? prettifyFieldName(leaf)

  // Walk left from the leaf and collect any numeric segments — those are
  // list/array indices and become "X. satırdaki" / "X. alan" prefixes.
  const prefixes = []
  for (let i = segments.length - 2; i >= 0; i--) {
    const seg = segments[i]
    if (/^\d+$/.test(seg)) {
      const idx = Number.parseInt(seg, 10) + 1
      // Decide "satır" (row in a list) vs "alan" (field in an object) by
      // looking at what's on the other side. Numbers under a known
      // array key ("items", "fields", "components", "links") are rows;
      // everything else is a generic ordinal.
      const container = i > 0 ? segments[i - 1] : null
      const word = container && isArrayContainer(container) ? 'satır' : 'alan'
      prefixes.unshift(`${idx}. ${word}`)
    }
  }
  return prefixes.length > 0
    ? `${prefixes.join(' ')}daki ${leafLabel}`
    : leafLabel
}

function isArrayContainer(name) {
  return name === 'items' || name === 'fields' || name === 'components' || name === 'links'
}

/**
 * Last-resort label for an unmapped field name. Strips snake/camel
 * case so `target_month` reads as "target month" rather than
 * "target_month" — never pretty, but at least readable. The "alan"
 * wrapper is added by the caller.
 */
function prettifyFieldName(name) {
  if (!name) return 'bu alan'
  return String(name)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim() || 'bu alan'
}

function friendlyType(type) {
  return TYPE_LABELS_TR[type] ?? type
}

function friendlyEnumValues(leafName, allowed) {
  const map = ENUM_LABELS[leafName]
  if (!Array.isArray(allowed)) return null
  return allowed.map((v) => map?.[v] ?? v).join(', ')
}

function formatAjvError(err, context) {
  const fieldDesc = describePath(err.instancePath)
  const leafName = leafNameFromInstancePath(err.instancePath)
  const params = err?.params ?? {}

  switch (err.keyword) {
    case 'additionalProperties': {
      // Extra field on the body. The user can't fix this — it's a
      // developer bug where the SPA sent a field the schema doesn't
      // know about (usually a stale build). The right UX is to ask
      // them to retry from a fresh page.
      const extra = params.additionalProperty
      return extra
        ? `Form güncellenmedi. Lütfen sayfayı yenileyip tekrar deneyin.`
        : 'Form güncellenmedi. Lütfen sayfayı yenileyip tekrar deneyin.'
    }
    case 'required': {
      // Ajv fires `required` on the parent object with the missing
      // child's name in `params.missingProperty`. Show the child label
      // directly — the parent path is rarely useful to the user.
      const missing = params.missingProperty
      const label = missing
        ? (FIELD_LABELS[missing] ?? prettifyFieldName(missing))
        : 'gerekli bir alan'
      return `${label.charAt(0).toLocaleUpperCase('tr-TR')}${label.slice(1)} alanı boş bırakılamaz.`
    }
    case 'type': {
      const expected = friendlyType(params.type)
      return fieldDesc
        ? `Lütfen ${fieldDesc} alanına ${expected} yazın.`
        : `Lütfen bu alana ${expected} yazın.`
    }
    case 'enum': {
      const allowed = friendlyEnumValues(leafName, params.allowedValues)
      return fieldDesc && allowed
        ? `Lütfen ${fieldDesc} için geçerli bir seçim yapın: ${allowed}.`
        : fieldDesc
          ? `Lütfen ${fieldDesc} için geçerli bir seçim yapın.`
          : 'Lütfen listeden geçerli bir seçim yapın.'
    }
    case 'minLength': {
      const limit = params.limit
      if (limit === 1) {
        return fieldDesc
          ? `${capitalize(fieldDesc)} alanı boş bırakılamaz.`
          : 'Bu alan boş bırakılamaz.'
      }
      return fieldDesc
        ? `${capitalize(fieldDesc)} alanına en az ${limit} harf yazmalısınız.`
        : `Bu alana en az ${limit} harf yazmalısınız.`
    }
    case 'maxLength': {
      const limit = params.limit
      return fieldDesc
        ? `${capitalize(fieldDesc)} alanına en fazla ${limit} harf yazabilirsiniz.`
        : `Bu alana en fazla ${limit} harf yazabilirsiniz.`
    }
    case 'minimum':
    case 'maximum': {
      const limit = params.limit
      const comparison = err.keyword === 'minimum' ? 'en az' : 'en fazla'
      return fieldDesc
        ? `${capitalize(fieldDesc)} için ${comparison} ${limit} olmalı.`
        : `Bu alan için ${comparison} ${limit} olmalı.`
    }
    case 'pattern': {
      // Most patterns in our schemas are dates (target_month) or id
      // shapes. Without knowing the exact regex we can't be more
      // specific, but "doğru formatta değil" is the universal Turkish
      // phrasing and reads naturally for both.
      return fieldDesc
        ? `${capitalize(fieldDesc)} bilgisi doğru formatta değil.`
        : 'Bu alandaki bilgi doğru formatta değil.'
    }
    case 'format': {
      // Email deserves its own wording — the only format the schemas
      // currently declare. Anything else falls through to the generic
      // "doğru formatta değil".
      if (params.format === 'email') {
        return 'E-posta adresi geçersiz. Lütfen kontrol edin.'
      }
      return fieldDesc
        ? `${capitalize(fieldDesc)} bilgisi doğru formatta değil.`
        : 'Bu alandaki bilgi doğru formatta değil.'
    }
    case 'minItems': {
      const limit = params.limit
      return fieldDesc
        ? `Lütfen ${fieldDesc} için en az ${limit} öğe seçin.`
        : `Lütfen en az ${limit} öğe seçin.`
    }
    case 'maxItems': {
      const limit = params.limit
      return fieldDesc
        ? `Lütfen ${fieldDesc} için en fazla ${limit} öğe seçin.`
        : `Lütfen en fazla ${limit} öğe seçin.`
    }
    case 'oneOf':
    case 'anyOf': {
      // oneOf on subtasksPagesBulkAssign: the leader must pick EITHER
      // "tek bir tasarımcıya ata" OR "ekibe dağıt", not both / neither.
      // The keyword alone is enough — no field to point at, the whole
      // form is the issue.
      return 'Lütfen sadece bir seçenek belirleyin.'
    }
    case 'minProperties': {
      const limit = params.limit
      return `Lütfen en az ${limit} bilgi girin.`
    }
    default: {
      // Unknown Ajv keyword. Fall back to the user's label for the
      // request context (body / querystring / etc.) and surface Ajv's
      // raw message in parens so a developer grepping `docker logs`
      // still finds the rule. Non-technical users can ignore the
      // parens — the prefix is plain Turkish.
      const label = CONTEXT_LABELS[context] ?? 'İstek'
      const raw = err.message ?? 'bilinmeyen kural'
      return fieldDesc
        ? `${label}: ${fieldDesc} alanı geçersiz (${raw}).`
        : `${label} geçersiz (${raw}).`
    }
  }
}

function leafNameFromInstancePath(instancePath) {
  if (!instancePath || typeof instancePath !== 'string') return null
  const segments = instancePath.replace(/^\//, '').split('/').filter(Boolean)
  return segments[segments.length - 1] ?? null
}

/**
 * Capitalise the first letter using the Turkish locale so "i" stays
 * dotted (a plain `.toUpperCase()` would lose it). Used to keep the
 * "Alan …" sentence starts looking like the rest of the app's UI.
 */
function capitalize(text) {
  if (!text) return text
  const lower = text.toLocaleLowerCase('tr-TR')
  return lower.charAt(0).toLocaleUpperCase('tr-TR') + lower.slice(1)
}
