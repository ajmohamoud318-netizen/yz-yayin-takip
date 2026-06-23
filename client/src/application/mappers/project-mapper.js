import { STAGE_PIPELINE, SUBTASK_LIBRARY } from '../../domain/index.js'

/** @param {{ findUserById: (id: string) => object|undefined, listUsers: () => object[] }} deps */
export function createProjectMapper({ findUserById, listUsers }) {

function normalizeProjectPayload(payload, existing = null) {
  const { assignees, subtasks, pageCount, stickerCount, subtaskAssignees = {}, ...rest } = payload
  const out = { ...rest }

  // assignees: [id, ...] -> [{id, name}, ...] + assigned_to / assigned_name
  if (Array.isArray(assignees)) {
    const objs = assignees
      .map((id) => findUserById(id))
      .filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name }))
    out.assignees = objs
    out.assigned_to = objs[0]?.id ?? null
    out.assigned_name = objs.map((a) => a.name).join(', ') || '—'
  }

  // subtasks: ['kapak', ...] -> [{id, title, kind, is_done, ...}]
  if (Array.isArray(subtasks)) {
    const prev = existing?.subtasks ?? []
    const subs = []
    for (const key of subtasks) {
      if (key === 'sayfalar') continue // page count handled below
      if (key === 'sticker') continue  // sticker count handled below
      const lib = SUBTASK_LIBRARY.find((s) => s.key === key)
      const title = lib ? lib.label : key
      const old = prev.find((s) => s.title === title && s.kind !== 'pages' && s.kind !== 'sticker-count')
      // Per-subtask designer assignment ('' means "inherit from project")
      const assignedTo = subtaskAssignees[key] || null
      const assignedUser = assignedTo ? findUserById(assignedTo) : null
      subs.push({
        id: old?.id ?? `st-${Date.now()}-${key}`,
        title,
        kind: 'check',
        is_done: old?.is_done ?? false,
        done_at: old?.done_at ?? null,
        assigned_to: assignedTo,
        assigned_name: assignedUser?.name ?? null,
      })
    }
    if (subtasks.includes('sayfalar') && pageCount) {
      const old = prev.find((s) => s.kind === 'pages')
      subs.push({
        id: old?.id ?? `st-${Date.now()}-sayfalar`,
        title: 'Sayfa Sayısı',
        kind: 'pages',
        total_pages: Number(pageCount),
        pages_done: old?.pages_done ?? 0,
        is_done: (old?.pages_done ?? 0) >= Number(pageCount),
      })
    }
    if (subtasks.includes('sticker') && stickerCount) {
      const old = prev.find((s) => s.kind === 'sticker-count')
      subs.push({
        id: old?.id ?? `st-${Date.now()}-sticker`,
        title: 'Sticker',
        kind: 'sticker-count',
        total_stickers: Number(stickerCount),
        stickers_done: old?.stickers_done ?? 0,
        is_done: (old?.stickers_done ?? 0) >= Number(stickerCount),
      })
    }
    out.subtasks = subs
    const total = subs.length || 1
    const done = subs.filter((s) => s.is_done).length
    out.progress = subs.length === 0 ? 0 : Math.round((done / total) * 100)
  } else if (!existing) {
    out.progress = 0
  }

  return out
}

/**
 * Builds the full detail shape ProjectDetail expects (subtasks, assignees,
 * history) from a flat mock project. If the project already carries these
 * arrays (e.g. after a subtask toggle), they are reused.
 */
/**
 * Reconstruct a plausible project timeline from current state alone.
 * Walks the pipeline in order and emits entries for every stage the
 * project has been through, including rejection / revision cycles.
 */
function generateHistory(p, assignees, subtasksDone, subtasksTotal) {
  const isCin = p.type === 'CIN'
  const pipeline = isCin ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
  const demoAttempt = p.demo_attempt ?? 0
  const ozalitAttempt = p.ozalit_attempt ?? 0
  const designer = assignees[0]?.name ?? p.assigned_name ?? 'Tasarımcı'
  const demoStage = isCin ? 'cin_demo_teslim' : 'demo_teslim'
  const demoOnayStage = isCin ? 'cin_demo_onay' : 'demo_onay'
  const currentIdx = pipeline.indexOf(p.stage)

  // Space events evenly — older projects have more history
  const totalEvents = 2 + currentIdx * 2 + demoAttempt * 5 + ozalitAttempt * 4
  let t = Date.now() - totalEvents * 1.8 * 86400000
  const tick = (days = 1) => {
    t += days * 86400000
    return new Date(t).toISOString()
  }

  const h = []

  // ── Project created & designer assigned ────────────────────────────────────
  h.push({
    id: `${p.id}-hc`,
    action: 'create',
    from_stage: null,
    to_stage: 'tasarim',
    done_by_name: 'Ayşenur Kanak',
    created_at: tick(0),
    note: `${designer} atandı`,
  })

  // Nothing more for a brand-new project still in design
  if (currentIdx === 0 && demoAttempt === 0) return h

  // ── Demo rejection cycles ──────────────────────────────────────────────────
  for (let i = 0; i < demoAttempt; i++) {
    const attemptLabel = i === 0
      ? `Tasarım tamamlandı${subtasksTotal > 0 ? ` — ${subtasksDone}/${subtasksTotal} alt görev` : ''}`
      : `${i + 1}. demo — revizyon tamamlandı`
    h.push({
      id: `${p.id}-hd${i}`,
      action: 'advance',
      from_stage: 'tasarim',
      to_stage: demoStage,
      done_by_name: designer,
      created_at: tick(i === 0 ? 3 : 2),
      note: attemptLabel,
    })
    if (!isCin) {
      h.push({
        id: `${p.id}-ht${i}`,
        action: 'advance',
        from_stage: demoStage,
        to_stage: demoOnayStage,
        done_by_name: 'Oktay Şahin',
        created_at: tick(0.5),
        note: `${i + 1}. demo teslim alındı`,
      })
    }
    h.push({
      id: `${p.id}-hr${i}`,
      action: 'reject',
      from_stage: demoOnayStage,
      to_stage: 'tasarim',
      done_by_name: 'Ayşenur Kanak',
      reason: i === demoAttempt - 1
        ? (p.last_reject_reason ?? 'Kapak renkleri marka kılavuzuna uymuyor, lütfen revize edin.')
        : 'Görsel düzenlemeler gerekiyor.',
      created_at: tick(1),
    })
  }

  // Still in revision after last rejection — stop here
  if (p.stage === 'tasarim') return h

  // ── Current demo submission ────────────────────────────────────────────────
  const finalDemoLabel = demoAttempt === 0
    ? `Tasarım tamamlandı${subtasksTotal > 0 ? ` — ${subtasksDone}/${subtasksTotal} alt görev` : ''}`
    : `${demoAttempt + 1}. demo — revizyon tamamlandı`
  h.push({
    id: `${p.id}-hdf`,
    action: 'advance',
    from_stage: 'tasarim',
    to_stage: demoStage,
    done_by_name: designer,
    created_at: tick(demoAttempt === 0 ? 3 : 2),
    note: finalDemoLabel,
  })
  if (p.stage === demoStage) return h

  // ── Printer teslim (TR) ────────────────────────────────────────────────────
  if (!isCin) {
    h.push({
      id: `${p.id}-htf`,
      action: 'advance',
      from_stage: demoStage,
      to_stage: demoOnayStage,
      done_by_name: 'Oktay Şahin',
      created_at: tick(0.5),
      note: `${demoAttempt + 1}. demo teslim alındı`,
    })
  }
  if (p.stage === demoOnayStage) return h

  // ── Demo approved ──────────────────────────────────────────────────────────
  const afterDemoOnay = pipeline[pipeline.indexOf(demoOnayStage) + 1]
  h.push({
    id: `${p.id}-hda`,
    action: 'approve',
    from_stage: demoOnayStage,
    to_stage: afterDemoOnay,
    done_by_name: 'Ayşenur Kanak',
    created_at: tick(0.5),
  })

  if (isCin) {
    // approve landed on 'uretime_hazir' (afterDemoOnay). Order pushes to üretim.
    if (p.stage === 'uretime_hazir') return h
    h.push({ id: `${p.id}-hoh`, action: 'advance', from_stage: 'uretime_hazir', to_stage: 'uretimde', done_by_name: 'Esra Kılıçkan', created_at: tick(2), note: 'Sipariş alındı' })
    if (p.stage === 'uretimde') return h
    h.push({ id: `${p.id}-hug`, action: 'advance', from_stage: 'uretimde', to_stage: 'gumruk', done_by_name: 'Ayşenur Kanak', created_at: tick(7) })
    if (p.stage === 'gumruk') return h
    h.push({ id: `${p.id}-hgs`, action: 'advance', from_stage: 'gumruk', to_stage: 'satista', done_by_name: 'Ayşenur Kanak', created_at: tick(4) })
    return h
  }

  // ── TR — ozalit cycles ─────────────────────────────────────────────────────
  for (let i = 0; i < ozalitAttempt; i++) {
    h.push({
      id: `${p.id}-hot${i}`,
      action: 'advance',
      from_stage: 'ozalit_teslim',
      to_stage: 'ozalit_onay',
      done_by_name: 'Oktay Şahin',
      created_at: tick(1),
      note: `${i + 1}. Ozalit teslim alındı`,
    })
    h.push({
      id: `${p.id}-hor${i}`,
      action: 'reject',
      from_stage: 'ozalit_onay',
      to_stage: 'ozalit_teslim',
      done_by_name: 'Ayşenur Kanak',
      reason: i === ozalitAttempt - 1
        ? (p.last_reject_reason ?? 'Ozalit baskısında renk düzeltmesi gerekiyor.')
        : 'Baskı ayarları hatalı.',
      created_at: tick(1),
    })
  }

  // ── Current ozalit printer teslim ──────────────────────────────────────────
  h.push({
    id: `${p.id}-hotf`,
    action: 'advance',
    from_stage: 'ozalit_teslim',
    to_stage: 'ozalit_onay',
    done_by_name: 'Oktay Şahin',
    created_at: tick(1),
    note: `${ozalitAttempt + 1}. Ozalit teslim alındı`,
  })
  if (p.stage === 'ozalit_teslim' || p.stage === 'ozalit_onay') return h

  // ── Ozalit approved → üretime hazır ───────────────────────────────────────
  h.push({ id: `${p.id}-hoa`, action: 'approve', from_stage: 'ozalit_onay', to_stage: 'uretime_hazir', done_by_name: 'Ayşenur Kanak', created_at: tick(0.5) })
  if (p.stage === 'uretime_hazir') return h

  // ── Sipariş alındı → üretimde ─────────────────────────────────────────────
  h.push({ id: `${p.id}-hoh`, action: 'advance', from_stage: 'uretime_hazir', to_stage: 'uretimde', done_by_name: 'Esra Kılıçkan', created_at: tick(2), note: 'Sipariş alındı' })
  if (p.stage === 'uretimde') return h

  h.push({ id: `${p.id}-hus`, action: 'advance', from_stage: 'uretimde', to_stage: 'satista', done_by_name: 'Ayşenur Kanak', created_at: tick(10) })
  return h
}

function buildProjectDetail(p) {
  // Designers assigned to the project. Tolerate legacy data where assignees
  // were stored as bare user-id strings instead of {id,name} objects.
  let assignees
  if (Array.isArray(p.assignees) && p.assignees.length > 0) {
    assignees = p.assignees.map((a) => {
      if (a && typeof a === 'object') return a
      const u = findUserById(a)
      return { id: a, name: u?.name ?? String(a) }
    })
  } else {
    assignees = listUsers()
      .filter((u) => u.id === p.assigned_to)
      .map((u) => ({ id: u.id, name: u.name }))
  }

  // Subtasks. Three cases:
  //   - missing            -> synthesize from progress (seed projects)
  //   - array of strings   -> legacy keys, convert to objects
  //   - array of objects   -> use as-is
  let subtasks = p.subtasks
  if (!Array.isArray(subtasks)) {
    const total = SUBTASK_LIBRARY.length
    const doneCount = Math.round((p.progress / 100) * total)
    subtasks = SUBTASK_LIBRARY.map((s, i) => ({
      id: `${p.id}-${s.key}`,
      project_id: p.id,
      title: s.label,
      kind: 'check',
      is_done: i < doneCount,
      done_at: i < doneCount ? new Date().toISOString() : null,
    }))
    const totalPages = 48
    const pagesDone = Math.round((p.progress / 100) * totalPages)
    subtasks.push({
      id: `${p.id}-sayfa`,
      project_id: p.id,
      title: 'Sayfa Sayısı',
      kind: 'pages',
      total_pages: totalPages,
      pages_done: pagesDone,
      is_done: pagesDone >= totalPages,
    })
  } else if (subtasks.some((s) => typeof s === 'string')) {
    subtasks = subtasks
      .filter((key) => key !== 'sayfalar' && key !== 'sticker')
      .map((key) => {
        const lib = SUBTASK_LIBRARY.find((l) => l.key === key)
        return {
          id: `${p.id}-${key}`,
          project_id: p.id,
          title: lib ? lib.label : key,
          kind: 'check',
          is_done: false,
          done_at: null,
        }
      })
  }

  const subtasksDone = subtasks.filter((s) => s.is_done).length
  const subtasksTotal = subtasks.length

  // Build a full project timeline from stage + attempt counters.
  // Real history is stored server-side; in mock we reconstruct it deterministically.
  const history = p.history ?? generateHistory(p, assignees, subtasksDone, subtasksTotal)

  return { ...p, assignees, subtasks, history }
}

  return { normalizeProjectPayload, buildProjectDetail, generateHistory }
}
