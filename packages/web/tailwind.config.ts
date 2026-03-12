import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'monospace'],
      },
      colors: {
        surface: {
          light: '#F0EFEA',
          dark: '#0a0a0a',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
