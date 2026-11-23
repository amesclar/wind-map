// Tailwind v4 lives in its own PostCSS plugin and prefixes CSS itself, so autoprefixer is gone (SCRUM-151).
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
