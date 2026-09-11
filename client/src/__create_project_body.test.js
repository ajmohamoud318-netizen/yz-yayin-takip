/**
 * Regression test for `POST /api/projects` returning 400.
 *
 * Setup: the team leader fills in the New Project dialog. The dialog
 * hands an array of subtask keys (e.g. ['kapak','sayfalar','sticker'])
 * to `api.createProject()`. The HTTP repo used to forward those keys
 * verbatim as `subtasks: [{ title: key }]` — but the Fastify schema
 * (server/src/schemas/index.js) requires each subtask to carry `kind`,
 * and the numeric kinds (pages / sticker-count) also carry
 * `total_pages` / `total_stickers`. Bare `{ title }` objects were
 * rejected and the team leader saw a 400 with no recovery path.
 *
 * After this fix, the HTTP repo forwards the mapper-normalised subtasks
 * (kind + totals included). This test pins that contract so a future
 * refactor can't regress it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpClient } from '@/infrastructure/http/client.js'

// Stub the network adapter so we can introspect the exact body the SPA
// is about to ship to /api/projects.
function stubAdapter(capture) {
  return (config) => {
    capture.body = typeof config.data === 'string'
      ? JSON.parse(config.data)
      : config.data
    return Promise.resolve({
      data: { id: 'p-new', ...capture.body, progress: 0, stage: 'tasarim' },
      status: 200, statusText: 'OK', headers: {}, config,
    })
  }
}

const stubUserRepo = {
  findById: (id) => ({ id, name: `User ${id}` }),
  listRaw: () => [],
}

let captured = { body: null }
beforeEach(async () => {
  captured = { body: null }
  httpClient.defaults.adapter = stubAdapter(captured)
  // The creation flow needs an auth token present in localStorage so
  // attachUser on the live server would pass; tests are offline so we
  // just make sure the body shape is correct.
  localStorage.setItem('yz_auth_v1', JSON.stringify({ token: 'u-ayse', user: { id: 'u-ayse' } }))
})
afterEach(() => {
  localStorage.clear()
})

describe('createProject HTTP body shape', () => {
  it('forwards subtask kind + total_pages + total_stickers', async () => {
    const { createHttpProjectRepository } = await import(
      '@/infrastructure/http/repositories/http-project.repository.js'
    )
    const repo = createHttpProjectRepository(stubUserRepo)

    await repo.createProject({
      title: 'Yeni macera',
      type: 'TR',
      target_month: '2026-09-01',
      assignees: ['u-aylin', 'u-feyza'],
      subtasks: ['kapak', 'kutu', 'ses', 'sayfalar', 'sticker'],
      pageCount: 32,
      stickerCount: 1,
      subtaskAssignees: {},
    })

    const body = captured.body
    expect(body.title).toBe('Yeni macera')
    expect(body.type).toBe('TR')
    expect(body.target_month).toBe('2026-09-01')
    // assigned_to takes a single id; pick the first designer.
    expect(body.assigned_to).toBe('u-aylin')

    // Each subtask MUST carry kind. The bug regressed this by sending
    // only `{ title: 'kapak' }` — schema 400'd.
    for (const s of body.subtasks) {
      expect(typeof s.title).toBe('string')
      expect(s.title.length).toBeGreaterThan(0)
      expect(['check', 'pages', 'sticker-count']).toContain(s.kind)
    }

    const byTitle = Object.fromEntries(body.subtasks.map((s) => [s.title, s]))
    expect(byTitle['İç Sayfalar'].kind).toBe('pages')
    expect(byTitle['İç Sayfalar'].total_pages).toBe(32)
    expect(byTitle['Sticker'].kind).toBe('sticker-count')
    expect(byTitle['Sticker'].total_stickers).toBe(1)
    expect(byTitle['Kapak'].kind).toBe('check')
  })

  it('works when the dialog sends no page/sticker subtask', async () => {
    const { createHttpProjectRepository } = await import(
      '@/infrastructure/http/repositories/http-project.repository.js'
    )
    const repo = createHttpProjectRepository(stubUserRepo)

    await repo.createProject({
      title: 'Sadece tasarım',
      type: 'CIN',
      assignees: ['u-aylin'],
      subtasks: ['kapak', 'icerik'],
      subtaskAssignees: {},
    })

    expect(captured.body.type).toBe('CIN')
    const kinds = captured.body.subtasks.map((s) => s.kind)
    expect(kinds.every((k) => k === 'check')).toBe(true)
  })

  it('strips empty-string entries from subtaskAssignees', async () => {
    // Regression: the NewProjectDialog seeds `subtaskAssignees` with
    // empty strings for every library key ("" = "inherit from project").
    // The server's projectsCreate schema requires `minLength: 1`, so
    // forwarding `""` 400s the request with
    // `body/subtaskAssignees/kapak must NOT have fewer than 1
    // characters`. Strip the empties here so the SPA never sends them.
    const { createHttpProjectRepository } = await import(
      '@/infrastructure/http/repositories/http-project.repository.js'
    )
    const repo = createHttpProjectRepository(stubUserRepo)

    await repo.createProject({
      title: 'Boş tasarımcılar',
      type: 'TR',
      assignees: ['u-aylin'],
      subtasks: ['kapak'],
      subtaskAssignees: {
        kapak: '',
        kutu: '',
        ses: '',
        sayfalar: '',
        sticker: '',
        yazilim: '',
        media: '',
        // Real override survives the filter
        'custom-oyun-abc12': 'u-feyza',
      },
    })

    expect(captured.body.subtaskAssignees).toEqual({
      'custom-oyun-abc12': 'u-feyza',
    })
  })

  it('omits subtaskAssignees entirely when every entry is empty', async () => {
    const { createHttpProjectRepository } = await import(
      '@/infrastructure/http/repositories/http-project.repository.js'
    )
    const repo = createHttpProjectRepository(stubUserRepo)

    await repo.createProject({
      title: 'Hiç override yok',
      type: 'TR',
      assignees: ['u-aylin'],
      subtasks: ['kapak'],
      subtaskAssignees: { kapak: '', kutu: '', ses: '' },
    })

    expect('subtaskAssignees' in captured.body).toBe(false)
  })

  it('forwards an empty assignees array (leader defers designer choice)', async () => {
    // Yeni davranış: takım lideri projeyi tasarımcı seçmeden
    // oluşturabilir, sonra Ürün Bilgileri'nden veya proje düzenleme
    // diyaloğundan atama yapabilir. NewProjectDialog "Lütfen en az bir
    // tasarımcı seçin" kontrolünü kaldırdı; bu test, http repository'nin
    // boş array'i gerçekten gönderdiğini ve primary assignee'nin null
    // olarak işaretlendiğini sabitleyerek gerileme riskini kapatır.
    const { createHttpProjectRepository } = await import(
      '@/infrastructure/http/repositories/http-project.repository.js'
    )
    const repo = createHttpProjectRepository(stubUserRepo)

    await repo.createProject({
      title: 'Tasarımcı sonra',
      type: 'TR',
      assignees: [],
      subtasks: ['kapak'],
      subtaskAssignees: {},
    })

    expect(captured.body.assignees).toEqual([])
    // assigned_to null: server, primary atamayı array'in ilk elemanından
    // alıyor; boş array ile null primary doğru davranış.
    expect(captured.body.assigned_to).toBeNull()
  })

  it('keys library picks by the subtask title the server looks them up by', async () => {
    // Regression: the dialog keys picks by library key ("kapak") while the
    // subtasks go out as titles ("Kapak"). createProject resolves overrides
    // by title, so the untranslated map never matched — every library
    // subtask fell back to the primary and Feyza dropped off the project.
    const { createHttpProjectRepository } = await import(
      '@/infrastructure/http/repositories/http-project.repository.js'
    )
    const repo = createHttpProjectRepository(stubUserRepo)

    await repo.createProject({
      title: 'İki tasarımcı',
      type: 'TR',
      assignees: ['u-aylin', 'u-feyza'],
      subtasks: ['kapak', 'sayfalar', 'sticker', 'Oyun Kartları'],
      pageCount: 32,
      stickerCount: 2,
      subtaskAssignees: {
        kapak: 'u-feyza',
        sayfalar: '__all__',
        sticker: 'u-feyza',
        'Oyun Kartları': 'u-aylin',
      },
    })

    expect(captured.body.subtaskAssignees).toEqual({
      Kapak: 'u-feyza',
      'İç Sayfalar': '__all__',
      Sticker: 'u-feyza',
      'Oyun Kartları': 'u-aylin',
    })
    const titles = captured.body.subtasks.map((s) => s.title)
    for (const key of Object.keys(captured.body.subtaskAssignees)) {
      expect(titles).toContain(key)
    }
  })
})

describe('updateProject HTTP body shape', () => {
  it('sends the Sticker picker choice to PUT /projects/:id/subtasks', async () => {
    // Regression: the mapper built the Sticker row without `assigned_to`,
    // so the server put it back on the primary on every edit.
    const { createHttpProjectRepository } = await import(
      '@/infrastructure/http/repositories/http-project.repository.js'
    )
    const repo = createHttpProjectRepository(stubUserRepo)

    await repo.updateProject('p-1', {
      title: 'Sticker düzenleme',
      type: 'TR',
      assignees: ['u-aylin', 'u-feyza'],
      subtasks: ['kapak', 'sticker'],
      stickerCount: 3,
      subtaskAssignees: { kapak: 'u-aylin', sticker: 'u-feyza' },
    })

    // The PUT runs after the PATCH, so it is the last body captured.
    const byTitle = Object.fromEntries(captured.body.subtasks.map((s) => [s.title, s]))
    expect(byTitle.Sticker.assigned_to).toBe('u-feyza')
    expect(byTitle.Kapak.assigned_to).toBe('u-aylin')
  })
})
