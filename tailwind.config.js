/** @type {import('tailwindcss').Config} */
// Tailwind is COMPILED at build time (see postcss.config.js and global.css).
// The app no longer loads https://cdn.tailwindcss.com at runtime, so every
// class it uses must be discoverable by the scanner below.
module.exports = {
  content: [
    './pages/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    // lib/player-names.js holds the static per-player color classes.
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        // components/CourtGrid.js uses the arbitrary value
        // animate-[fadeIn_0.35s_ease-out], which needs this keyframe to exist.
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.35s ease-out',
      },
    },
  },
  plugins: [],
}
