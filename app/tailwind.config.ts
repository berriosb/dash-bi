/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Theme tokens (consumed via CSS variables in layouts-themes.md)
        border: 'hsl(var(--color-border))',
        input: 'hsl(var(--color-border))',
        ring: 'hsl(var(--color-primary))',
        background: 'hsl(var(--color-background))',
        foreground: 'hsl(var(--color-text))',
        primary: {
          DEFAULT: 'hsl(var(--color-primary))',
          foreground: 'hsl(var(--color-background))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--color-secondary))',
          foreground: 'hsl(var(--color-background))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--color-danger))',
          foreground: 'hsl(var(--color-background))',
        },
        muted: {
          DEFAULT: 'hsl(var(--color-muted))',
          foreground: 'hsl(var(--color-text-muted))',
        },
        accent: {
          DEFAULT: 'hsl(var(--color-accent))',
          foreground: 'hsl(var(--color-background))',
        },
        success: {
          DEFAULT: 'hsl(var(--color-success))',
          foreground: 'hsl(var(--color-background))',
        },
        warning: {
          DEFAULT: 'hsl(var(--color-warning))',
          foreground: 'hsl(var(--color-background))',
        },
        popover: {
          DEFAULT: 'hsl(var(--color-surface))',
          foreground: 'hsl(var(--color-text))',
        },
        card: {
          DEFAULT: 'hsl(var(--color-surface))',
          foreground: 'hsl(var(--color-text))',
        },
      },
      borderRadius: {
        lg: 'var(--spacing-border-radius)',
        md: 'calc(var(--spacing-border-radius) * 0.75)',
        sm: 'calc(var(--spacing-border-radius) * 0.5)',
      },
      fontFamily: {
        sans: ['var(--font-family)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-family-mono)', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};