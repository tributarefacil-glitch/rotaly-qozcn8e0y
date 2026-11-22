import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
  test: {
    environmentMatchGlobs: [['src/lib/safeStorage.test.ts', 'jsdom']],
    include: ['src/**/*.test.ts'],
  },
} as never)
