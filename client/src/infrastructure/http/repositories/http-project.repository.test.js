/**
 * The edit-and-notify body, as it actually leaves the browser.
 *
 * This layer rebuilds the request body field by field rather than forwarding
 * the object it was handed, and that is a seam where a field can go missing
 * without anything above or below noticing. It did: `allowParcaAdd` — the flag
 * that authorises "Kalan Parçaları Gönderin" past the server's parça-set guard
 * — was threaded through the dialog, the schema, the service and the FSM, and
 * then dropped here. Every layer had it and the browser never sent it, so the
 * sanctioned add was refused by its own guard, with a message telling the
 * leader to use the button they had just pressed.
 *
 * Neither side's tests could see it: the server suite calls the FSM directly
 * with a ctx it builds itself, and the component suite stops at the api module.
 * These cover the one hop in between.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../client.js', () => ({
  httpClient: { post: vi.fn(), patch: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { httpClient } from '../client.js'
import { createHttpProjectRepository } from './http-project.repository.js'

const sheet = { attempt: 3, payload: { _selectedComponents: [{ component: 'KUTU' }] } }

describe('createHttpProjectRepository — edit-and-notify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    httpClient.post.mockResolvedValue({ data: { id: 'p-1' } })
  })

  it('sends allowParcaAdd when the leader is adding parçalar', async () => {
    const repo = createHttpProjectRepository()
    await repo.notifyDemoEdit('p-1', { ...sheet, allowParcaAdd: true })
    expect(httpClient.post).toHaveBeenCalledWith(
      '/projects/p-1/demo-edit-notify',
      expect.objectContaining({ allowParcaAdd: true }),
    )
  })

  it('sends it on the ozalit leg too', async () => {
    const repo = createHttpProjectRepository()
    await repo.notifyOzalitEdit('p-1', { ...sheet, allowParcaAdd: true })
    expect(httpClient.post).toHaveBeenCalledWith(
      '/projects/p-1/ozalit-edit-notify',
      expect.objectContaining({ allowParcaAdd: true }),
    )
  })

  it('still carries the sheet itself', async () => {
    const repo = createHttpProjectRepository()
    await repo.notifyDemoEdit('p-1', sheet)
    expect(httpClient.post).toHaveBeenCalledWith(
      '/projects/p-1/demo-edit-notify',
      expect.objectContaining({ attempt: 3, payload: sheet.payload }),
    )
  })

  it('does not claim an add on an ordinary correction', async () => {
    // An undefined flag is dropped by JSON serialisation, so the server sees a
    // body without it and refuses any parça-set change — which is the point.
    const repo = createHttpProjectRepository()
    await repo.notifyDemoEdit('p-1', sheet)
    const [, body] = httpClient.post.mock.calls[0]
    expect(body.allowParcaAdd).toBeUndefined()
  })

  it('survives being called with nothing', async () => {
    const repo = createHttpProjectRepository()
    await expect(repo.notifyDemoEdit('p-1')).resolves.toEqual({ id: 'p-1' })
  })
})
