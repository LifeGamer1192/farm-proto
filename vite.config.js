import { defineConfig } from 'vite';

// Relative base so the production build works on GitHub Pages
// regardless of the repository name (user.github.io/<repo>/).
export default defineConfig({
  base: './',
});
