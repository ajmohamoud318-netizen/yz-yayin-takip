/**
 * Domain-level errors. Routes catch these and translate to HTTP status
 * codes uniformly. Anything that doesn't throw one of these propagates
 * as a 500.
 */

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const badRequest = (msg) => { throw new HttpError(400, msg, 'bad_request') }
export const unauthorized = (msg = 'Yetkisiz erişim') => { throw new HttpError(401, msg, 'unauthorized') }
export const forbidden = (msg = 'Bu işlem için yetkiniz yok') => { throw new HttpError(403, msg, 'forbidden') }
export const notFound = (msg = 'Bulunamadı') => { throw new HttpError(404, msg, 'not_found') }
export const conflict = (msg) => { throw new HttpError(409, msg, 'conflict') }
