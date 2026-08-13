/** @type {import('tailwindcss').Config} */
module.exports = {
  // Every place a Tailwind class string can appear. lib/ is included because
  // lib/schedule-display.js holds the static per-player color classes
  // (PLAYER_STYLES) that PlayerChip renders — without this they would be
  // compiled away. They are plain literals, so no safelist is required.
  content: [
    './pages/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        // Used by the court cards via animate-[fadeIn_0.35s_ease-out].
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
