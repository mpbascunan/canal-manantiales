/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canal: {
          50: '#f0fafb',
          100: '#d5eef3',
          200: '#a9dce8',
          500: '#3698b0',
          600: '#2b7a8f',
          700: '#226374',
          800: '#1a4f5d',
          900: '#134349'
        }
      }
    }
  },
  plugins: []
}
