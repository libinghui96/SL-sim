import { defineConfig } from 'vitest/config';

export default defineConfig({
  // relative asset paths: the same build works at a domain root and under /SL-sim/ on GitHub Pages
  base: './',
  // the simulation tests are CPU-bound and run several times slower on CI runners
  test: { testTimeout: 120000 },
});
