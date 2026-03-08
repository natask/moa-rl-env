import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: [],
    // Run test files sequentially to avoid setPlatform() global conflicts
    fileParallelism: false,
  },
  resolve: {
    alias: {
      'path': 'path-browserify',
      '@core': path.resolve(__dirname, 'src/core'),
      '@platform': path.resolve(__dirname, 'src/platform'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
})
