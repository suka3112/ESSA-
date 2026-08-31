/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ESSA brand green scale
        // ESSA Brand Guidelines (Jul 2026) — Primary Green #2d9a47,
        // Secondary Light Green #6dc781 (scale anchored on the brand values).
        essa: {
          50: '#eef9f1',
          100: '#d8f0e0',
          200: '#b5e3c4',
          300: '#6dc781', // brand secondary — Light Green
          400: '#4cb264',
          500: '#38a653',
          600: '#2d9a47', // brand primary — Primary Green
          700: '#247e3a',
          800: '#1d6530',
          900: '#175226',
          950: '#0b2e15',
        },
        // ESSA Primary Blue #0075a9 / Secondary Dark Blue #0b5b80.
        essablue: {
          50: '#e8f4fa',
          100: '#cfe9f4',
          200: '#9fd3e9',
          300: '#66b8d9',
          400: '#2e97c4',
          500: '#0075a9', // brand primary — Primary Blue
          600: '#066a96',
          700: '#0b5b80', // brand secondary — Dark Blue
          800: '#0c4a67',
          900: '#0b3d55',
        },
        surface: '#ffffff',
        canvas: '#f6f8f7',
        ink: {
          DEFAULT: '#1f2937',
          secondary: '#374151',
          muted: '#4b5563',
          faint: '#6b7280',
        },
        line: {
          DEFAULT: '#e5e7eb',
          soft: '#eef0f2',
          strong: '#d1d5db',
        },
        semantic: {
          success: '#2d9a47',
          successBg: '#e6f5ea',
          warning: '#b45309',
          warningBg: '#fef5e7',
          error: '#b91c1c',
          errorBg: '#fdecec',
          info: '#0075a9',
          infoBg: '#e5f2f9',
          pending: '#6d28d9',
          pendingBg: '#f1ecfd',
          draft: '#4b5563',
          draftBg: '#eef0f2',
        },
      },
      fontFamily: {
        // ESSA Brand Guidelines §4.1 — Segoe UI is the primary typeface.
        sans: [
          'Segoe UI',
          'Segoe UI Variable Text',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.05)',
        pop: '0 4px 16px -2px rgb(16 24 40 / 0.12)',
      },
    },
  },
  plugins: [],
};
