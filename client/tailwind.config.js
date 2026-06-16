/** @type {import('tailwindcss').Config} */
export default {
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
        // Brand scale repointed to rose/pink (was blue)
        brand: {
          50: '#fff1f7',
          100: '#ffe0ee',
          200: '#fcc4dc',
          300: '#f49cc0',
          400: '#e96e9f',
          500: '#d94e83',
          600: '#c23a6d',
          700: '#9e2d58',
          800: '#7e2547',
          900: '#66203c',
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
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
