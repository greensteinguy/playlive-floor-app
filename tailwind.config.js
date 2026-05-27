/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Lifted from playlive-analytics for visual consistency across the three PlayLive apps.
      colors: {
        felt: {
          950: '#07090a',
          900: '#0d1117',
          800: '#131a1f',
          700: '#1a2530',
        },
        gold: {
          400: '#d4a843',
          500: '#c49a2e',
          600: '#a8821f',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
        body:    ['"DM Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
