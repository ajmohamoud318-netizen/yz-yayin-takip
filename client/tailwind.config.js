/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bcd2ff',
          300: '#8eb4ff',
          400: '#598bff',
          500: '#3563eb',
          600: '#2348c8',
          700: '#1d3aa0',
          800: '#1d3382',
          900: '#1d2f6b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
