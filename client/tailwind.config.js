import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // shadcn/ui design tokens — driven by the CSS variables in index.css
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Light mauve sidebar (rule 3)
        sidebar: 'hsl(var(--sidebar))',
        // Brand scale = teal (matches the --primary accent). 500 is kept
        // dark enough that white text / the ✓ glyph on a filled brand-500
        // circle clears WCAG AA.
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#0f766e',
          600: '#115e59',
          700: '#134e4a',
          800: '#0c3b38',
          900: '#07302e',
        },
        // Pastel secondary palette for charts + kanban (rules 9 & 11)
        pastel: {
          lavender: '#C9B6E4',
          mint: '#B6E4CF',
          peach: '#FFC9A8',
          sky: '#A8D8F0',
          rose: '#F4B6CE',
          butter: '#FBE7A1',
          periwinkle: '#B9C2F0',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['Fraunces', 'Georgia', 'serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
        creative: ['"Utter Butter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
