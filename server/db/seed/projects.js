/**
 * Seed projects — mirrors `client/src/infrastructure/mock/seed/projects.js`.
 *
 * Subtask data is omitted here: the seed is intentionally a flat
 * representation of "where every book sits right now". Per-project
 * subtasks and history are generated on demand by the same logic in
 * the client (and in the HTTP `project-detail` route) — keeping the
 * seed small and the timeline deterministic.
 */

export const SEED_PROJECTS = [
  { id: 'p-x1', title: 'CIRT / CIRTLI / OKUMAYI / ÖĞRETEN / KİTAP', type: 'TR', stage: 'uretime_hazir', assigned_to: 'u-feyza', created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-16T00:00:00', updated_at: '2026-06-17T00:00:00' },
  { id: 'p-x2', title: 'Konuşturan / Kitap',                       type: 'TR', stage: 'uretime_hazir', assigned_to: 'u-nur',   created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-03T00:00:00', updated_at: '2026-06-09T00:00:00' },
  { id: 'p-x3', title: 'İLKOKULA / HAZIRLIK / SETİ / KİTAPLARI',  type: 'TR', stage: 'uretime_hazir', assigned_to: 'u-feyza', created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-17T00:00:00', updated_at: '2026-06-18T00:00:00' },
  { id: 'p-x4', title: 'Konuşturan / oyuncak',                     type: 'TR', stage: 'uretime_hazir', assigned_to: 'u-feyza', created_by: 'u-ayse', target_month: '2026-05-01', demo_attempt: 0, progress: 100, created_at: '2026-05-20T00:00:00', updated_at: '2026-05-22T00:00:00' },
  { id: 'p-x5', title: 'Mim / reklam',                             type: 'TR', stage: 'ozalit_teslim', assigned_to: 'u-feyza', created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-05T00:00:00', updated_at: '2026-06-09T00:00:00' },
  { id: 'p-x6', title: 'Konuşmayı / Geliştiren / Şarkılı / Masallar', type: 'TR', stage: 'uretime_hazir', assigned_to: 'u-nur', created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-03T00:00:00', updated_at: '2026-06-08T00:00:00' },
  { id: 'p-x7', title: 'Melodiko / - / İlk / Piyano / Kitabım',    type: 'TR', stage: 'ozalit_teslim', assigned_to: 'u-nur',   created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-05T00:00:00', updated_at: '2026-06-05T00:00:00' },
  { id: 'p-x8', title: 'Keçemino / Çiftlik / Kutu',                type: 'TR', stage: 'uretime_hazir', assigned_to: 'u-feyza', created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-04T00:00:00', updated_at: '2026-06-04T00:00:00' },
  { id: 'p-x9', title: 'PARMAK / BOYAMA',                          type: 'TR', stage: 'uretime_hazir', assigned_to: 'u-feyza', created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-02T00:00:00', updated_at: '2026-06-02T00:00:00' },
  { id: 'p-s1', title: 'POFİDİK OYUN SETİ',                       type: 'TR', stage: 'satista',      assigned_to: 'u-feyza', created_by: 'u-ayse', target_month: '2026-06-01', demo_attempt: 0, progress: 100, created_at: '2026-06-01T00:00:00', updated_at: '2026-06-15T00:00:00' },
]

export const SEED_ORDER_REQUESTS = [
  {
    id: 'or-demo-1',
    project_id: 'p-s1',
    requested_by: 'u-esra',
    status: 'pending',
    payload: { quantity: 500, items: [{ name: 'Kutu', quantity: 500 }, { name: 'Sticker', quantity: 500 }] },
    history: [
      { step: 'pending', signed_by_id: 'u-esra', notes: 'Okul dönemine hazırlık için acil gerekiyor.', created_at: '2026-06-18T08:00:00.000Z' },
    ],
  },
  {
    id: 'or-demo-2',
    project_id: 'p-x1',
    requested_by: 'u-esra',
    status: 'goruldu',
    payload: { quantity: 10000, items: [{ name: 'Kitap', quantity: 10000 }] },
    history: [
      { step: 'pending',  signed_by_id: 'u-esra',  notes: 'Temmuz sezonu öncesi hazır olmalı.', created_at: '2026-06-17T09:00:00.000Z' },
      { step: 'goruldu',  signed_by_id: 'u-ayse',  notes: 'Tasarım ekibine iletildi.',          created_at: '2026-06-17T11:00:00.000Z' },
    ],
  },
]

export const SEED_TITLES = Object.fromEntries(
  SEED_PROJECTS.map((p) => [p.id, p.title]),
)
