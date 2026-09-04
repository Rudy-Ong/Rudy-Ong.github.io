import { defineConfig } from 'vite';

// Deployed at the domain root (rudy-ong.github.io), so base stays '/'.
export default defineConfig({
  base: '/',
  build: { target: 'es2022', cssMinify: true },
});
