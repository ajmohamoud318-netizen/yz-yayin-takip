// Populates the throwaway audit DB with realistic-looking projects via the API.
const API = 'http://localhost:4000/api'
const LEADER = '785ea3f9-0000-0000-0000-000000000000'

const DESIGNERS = [
  'ed551940-0000-0000-0000-000000000000',
  'd24fe938-0000-0000-0000-000000000000',
  'ca0fd9f0-0000-0000-0000-000000000000',
  'eb2cf549-0000-0000-0000-000000000000',
]

const TITLES = [
  ['TR', '8. Sınıf LGS Matematik Soru Bankası — Yeni Nesil Sorular'],
  ['TR', '5. Sınıf Türkçe Konu Anlatımlı Kazanım Testleri'],
  ['CIN', 'Okul Öncesi Etkinlik Seti (Kutulu, 24 Parça)'],
  ['TR', '12. Sınıf TYT-AYT Fizik Denemeleri'],
  ['TR', '4. Sınıf Fen Bilimleri Yaprak Test'],
  ['CIN', 'Manyetik Alfabe Öğrenme Tahtası'],
  ['TR', '9. Sınıf Geometri Konu Özetli Soru Bankası'],
  ['TR', '6. Sınıf Sosyal Bilgiler Kazanım Kavrama Testleri'],
  ['CIN', 'Ahşap Zeka Oyunları Seti — Büyük Boy'],
  ['TR', '3. Sınıf Matematik Beceri Temelli Sorular'],
  ['TR', '11. Sınıf Kimya Konu Anlatım Föyleri'],
  ['TR', '7. Sınıf İngilizce Kelime Defteri ve Test Kitabı'],
]

const STAGES = [
  'tasarim', 'tasarim', 'demo_teslim', 'demo_onay', 'ozalit_teslim',
  'ozalit_onay', 'uretime_hazir', 'uretimde', 'satista', 'tasarim',
  'demo_onay', 'uretimde',
]

const MONTHS = ['2026-03-01', '2026-05-01', '2026-08-01', '2026-09-01', '2026-11-01', '2026-12-01']

async function post(path, body, userId = LEADER) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(path + ' -> ' + res.status + ' ' + text.slice(0, 300))
  return JSON.parse(text || '{}')
}

const created = []
for (let i = 0; i < TITLES.length; i++) {
  const [type, title] = TITLES[i]
  const p = await post('/projects', {
    title,
    type,
    target_month: MONTHS[i % MONTHS.length],
    pass_kind: i % 4 === 0 ? 'reprint' : 'first_edition',
    assignees: [DESIGNERS[i % DESIGNERS.length], DESIGNERS[(i + 1) % DESIGNERS.length]].slice(0, i % 3 === 0 ? 2 : 1),
  })
  created.push({ id: p.id ?? p.project?.id, stage: STAGES[i] })
  console.log('created', title)
}
console.log(JSON.stringify(created, null, 1))
