import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths: the same build works at a domain root and under /SL-sim/ on GitHub Pages
  base: './',
});
