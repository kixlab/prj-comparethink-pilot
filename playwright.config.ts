import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.browser.spec.ts",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:5185",
    browserName: "chromium",
    channel:
      process.env.PILOT_TEST_BROWSER === "chromium" ? undefined : "chrome",
    headless: true,
    permissions: ["microphone"],
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--use-file-for-fake-audio-capture=/tmp/comparethink-test-mic.wav",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/fixtureServer.mjs",
    url: "http://127.0.0.1:5185/api/config",
    reuseExistingServer: false,
    timeout: 20000,
  },
  reporter: "list",
  outputDir: "test-results",
});
