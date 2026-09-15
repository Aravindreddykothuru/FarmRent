/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-dark': 'var(--brand-dark)',
        primary: {
          DEFAULT: 'var(--brand)',
          container: 'var(--primary-container)',
          fixed: 'var(--primary-fixed)',
          'fixed-dim': 'var(--primary-fixed-dim)',
        },
        secondary: {
          DEFAULT: 'var(--brand-accent)',
          container: 'var(--secondary-container)',
          fixed: 'var(--secondary-fixed)',
        },
        tertiary: {
          DEFAULT: 'var(--tertiary)',
          container: 'var(--tertiary-container)',
        },
        surface: {
          DEFAULT: 'var(--background)',
          container: 'var(--surface-container)',
          'container-low': 'var(--surface-container-low)',
          'container-high': 'var(--surface-container-high)',
          'container-highest': 'var(--surface-container-highest)',
          bright: 'var(--background)',
          dim: 'var(--surface-dim)',
          variant: 'var(--surface-variant)',
        },
        'on-surface': 'var(--foreground)',
        'on-surface-variant': 'var(--on-surface-variant)',
        'on-primary': 'var(--on-primary)',
        'on-primary-container': 'var(--brand-light)',
        outline: 'var(--outline)',
        'outline-variant': 'var(--outline-variant)',
        'inverse-surface': 'var(--inverse-surface)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
}