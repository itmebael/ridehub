/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./App.tsx"
  ],
  theme: {
    extend: {
      colors: {
        // Secure Mobility palette
        primary: {
          50: '#ECFDF7',
          100: '#D1FAEC',
          200: '#A7F3DB',
          300: '#6EE7C7',
          400: '#34D3B1',
          500: '#14B89F',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
        // Keep blue for secondary actions
        blue: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#007BFF',
          700: '#0056b3',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Modern gray scale
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
        // Accent colors for variety
        accent: {
          green: '#10B981',
          purple: '#8B5CF6',
          teal: '#14B8A6',
          pink: '#EC4899',
        }
      },
      fontFamily: {
        'poppins': ['Poppins', 'sans-serif'],
      },
      borderRadius: {
        '3xl': '1.5rem',
      },
      backgroundImage: {
        'gradient-modern': 'linear-gradient(135deg, #ECFDF7 0%, #E0F2FE 50%, #14B89F 100%)',
        'gradient-orange': 'linear-gradient(135deg, #14B89F 0%, #0D9488 100%)',
      }
    },
  },
  plugins: [],
}
