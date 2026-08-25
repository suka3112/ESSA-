/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ESSA brand green scale
        essa: {
          50: '#eef8f0',
          100: '#d7eedd',
          200: '#b0ddbe',
          300: '#7fc697',
          400: '#4daa6e',
          500: '#2e9052',
          600: '#1f7a41', // primary
          700: '#1a6337',
          800: '#174f2e',
          900: '#134127',
          950: '#0a2415',
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
          success: '#1f7a41',
          successBg: '#e8f5ec',
          warning: '#b45309',
          warningBg: '#fef5e7',
          error: '#b91c1c',
          errorBg: '#fdecec',
          info: '#1d4ed8',
          infoBg: '#e8effd',
          pending: '#6d28d9',
          pendingBg: '#f1ecfd',
          draft: '#4b5563',
          draftBg: '#eef0f2',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
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
