import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/tv/',
    reuseExistingServer: true,
  },
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [320, 360, 390, 412, 430].map((width) => ({
    name: `mobile-${width}`,
    use: { ...devices['Desktop Chrome'], viewport: { width, height: 800 } },
  })),
})
