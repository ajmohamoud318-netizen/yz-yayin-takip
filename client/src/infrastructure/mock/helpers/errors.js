export function notFound(message) {
  const err = new Error(message)
  err.status = 404
  throw err
}

export function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  throw err
}

export function unauthorized(message) {
  const err = new Error(message)
  err.status = 401
  throw err
}

export function forbidden(message) {
  const err = new Error(message)
  err.status = 403
  throw err
}

export function conflict(message) {
  const err = new Error(message)
  err.status = 409
  throw err
}
