/**
 * Tailwind / NativeWind 预设（与 design-tokens.ts 保持同步）
 *
 * module.exports = {
 *   presets: [require('./constants/tailwind-preset')],
 *   content: ['./app/**/*.{tsx,ts}', './components/**/*.{tsx,ts}'],
 * };
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        app: {
          bg: '#faf8ff',
          surface: '#ffffff',
          'surface-muted': '#f4f6fb',
          input: '#f2f3ff',
          text: '#131b2e',
          muted: '#424754',
          primary: '#0058be',
          'primary-soft': '#3b82f6',
          secondary: '#006c49',
          tertiary: '#825100',
          danger: '#dc2626',
        },
      },
      borderRadius: {
        card: '18px',
        sheet: '22px',
        pill: '999px',
      },
      spacing: {
        page: '20px',
      },
    },
  },
};
