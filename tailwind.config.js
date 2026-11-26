/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'xiangqi-red': '#C0392B',
        'xiangqi-black': '#2C3E50',
        'xiangqi-board': '#F4D9A6',
      },
    },
  },
  plugins: [],
};
