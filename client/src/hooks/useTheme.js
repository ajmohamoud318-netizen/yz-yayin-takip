// Theme switching has been disabled; the app is light-only. This hook is
// kept as a no-op shim so any stray import compiles and returns a stable
// "light" value, but nothing in the DOM is mutated.
export function useTheme() {
  return { theme: 'light', setTheme: () => {}, toggleTheme: () => {} }
}
