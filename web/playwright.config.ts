import { defineConfig, devices } from "@playwright/test";

/**
 * Screen tests (spec section 9): every flow at phone, tablet and desktop widths, in light and dark.
 * Needs the app on E2E_BASE_URL (default http://localhost:3000) and the dev ERPNext seeded with
 * parapilot.setup.dev_seed.
 */
const widths = { phone: 375, tablet: 768, desktop: 1280 };
const schemes = ["light", "dark"] as const;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // One dev ERPNext serves every test: more parallel browsers only make its workers queue.
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: Object.entries(widths).flatMap(([name, width]) =>
    schemes.map((colorScheme) => ({
      name: `${name}-${colorScheme}`,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width, height: name === "phone" ? 812 : 900 },
        hasTouch: name !== "desktop",
        colorScheme,
      },
    })),
  ),
});
