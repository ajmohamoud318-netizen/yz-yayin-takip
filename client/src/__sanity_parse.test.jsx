// Pure smoke test that uses the project's own Vite transformer (the same
// pipeline `npm run dev` and `npm run build` use). Sits at src/__sanity_parse.test.jsx
// so the relative imports for App.jsx (./App.jsx) and the components
// (./components/<name>.jsx) resolve correctly under Vitest's import-analysis.
import { describe, it, expect } from 'vitest'

describe('JSX parse smoke (Vite transformer)', () => {
  it('NewProjectDialog.jsx parses + resolves', async () => {
    const mod = await import('./components/NewProjectDialog.jsx')
    expect(typeof mod.default).toBe('function')
  })
})
