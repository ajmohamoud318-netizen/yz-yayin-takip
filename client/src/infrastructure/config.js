/**
 * Toggle mock vs real HTTP backend.
 *
 * Default = mock (in-memory + localStorage) for the fastest local
 * development, and so existing test runs keep working. Flip to `false`
 * when the Fastify server is reachable at /api — use the Vite proxy in
 * dev (localhost:5173 → localhost:4000) or set VITE_API_BASE_URL in
 * production.
 */
export const USE_MOCK = import.meta.env?.VITE_USE_MOCK === 'false' ? false : true
