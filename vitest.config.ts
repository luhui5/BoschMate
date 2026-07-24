// vitest.config.ts with coverage configuration (R5-6)
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/frontend',
      include: ['lib/**/*.ts', 'lib/**/*.tsx', 'components/**/*.tsx'],
      exclude: [
        'node_modules/**',
        'out/**',
        '.next/**',
        'e2e/**',
        '*.config.*',
      ],
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 55,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
})
