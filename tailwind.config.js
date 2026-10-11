/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./context/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#8b2500',
          hover: '#a82e00',
          light: '#fbeee8',
          border: '#f0c4b4',
        }
      },
      fontFamily: {
        reader: ['"Noto Sans"', '"DejaVu Sans"', '"Times Ext Roman"', '"Indic Times"', '"Doulos SIL"', '"Tahoma"', '"Arial Unicode MS"', '"Gentium"', 'sans-serif'],
        ui: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
