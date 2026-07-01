/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // ─────────────────────────────────────────────────────────────────────
      // PlayLive "carbon + red" futuristic theme (1 June 2026 UI passover).
      //
      // The two legacy token families (`felt`, `gold`) are REPOINTED rather than
      // renamed so the whole app re-skins in one move — every existing
      // `bg-felt-800` / `text-gold-400` class instantly adopts the new look:
      //   felt → near-black carbon graphite (was poker-felt green)
      //   gold → PlayLive red, lifted from the analytics overlay/negative red
      //          (#ef4444 / rgb(220,50,50))
      // New explicit `brand` (red) + `steel` (titanium grey) families are added
      // for fresh work; prefer those going forward.
      // ─────────────────────────────────────────────────────────────────────
      colors: {
        felt: {
          950: '#050507', // page void
          900: '#0a0a0d', // base surface
          800: '#101014', // glass panel
          700: '#17181d', // raised / hover
        },
        gold: {
          400: '#ff5a5a', // bright accent (active text, icons)
          500: '#ef2b2b', // core PlayLive red
          600: '#c81d1d', // deep
        },
        brand: {
          300: '#ff8a8a',
          400: '#ff5a5a',
          500: '#ef2b2b',
          600: '#cf1d1d',
          700: '#a51616',
        },
        steel: {
          100: '#e9ebee', // bright titanium highlight
          300: '#aab0b8',
          400: '#7c828b',
          500: '#565b62',
          700: '#2b2e33', // brushed metal mid
          800: '#1b1d21',
          900: '#121317',
        },
      },
      fontFamily: {
        // `display` repointed Playfair-serif → Space Grotesk (modern geometric).
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        // `brand` = Orbitron, the futuristic wordmark + big-numeral face.
        brand: ['"Orbitron"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(239,43,43,0.55)',
        'glow-lg': '0 0 48px -8px rgba(239,43,43,0.65)',
        titanium: 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.5), 0 8px 24px -12px rgba(0,0,0,0.8)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'sheen': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        sheen: 'sheen 6s linear infinite',
      },
    },
  },
  plugins: [],
}
