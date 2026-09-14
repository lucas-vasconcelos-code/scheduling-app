import { test, expect } from "@playwright/test";
test("demo scheduling, calendar update, undo, and preferences", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await expect(
    page.getByText(/Good (morning|afternoon|evening), Alex/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Scheduling request" })
    .fill("Schedule an hour to work out tomorrow");
  await page.getByRole("button", { name: "Send ↑", exact: true }).click();
  await expect(page.getByText("Added Workout.", { exact: false })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("undone", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(
    page.getByText("Never schedule studying after 9 PM."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();
});
test("multi-turn study planning requires approval", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Scheduling request" });
  await input.fill("I have an exam Friday");
  await page.getByRole("button", { name: "Send ↑", exact: true }).click();
  await expect(
    page.getByText(
      "How much total study or work time would you like before the deadline?",
      { exact: true },
    ),
  ).toBeVisible();
  await input.fill("Four hours");
  await page.getByRole("button", { name: "Send ↑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply Changes", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Apply Changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
});

test("import review and denied permissions keep scheduling available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "denied";
        static async requestPermission() {
          return "denied";
        }
      },
    });
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Categories", exact: true }).click();
  await expect(
    page.getByText("Review imported events", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    page.getByText("Review imported events", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable meeting reminders", exact: true })
    .click();
  await expect(
    page.getByText(
      "Notifications were not enabled. Calendar scheduling still works.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Start voice input" }).click();
  await expect(
    page.getByText(
      "Speech recognition is unavailable in this browser. You can keep typing.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Scheduling request" }),
  ).toBeEditable();
});

test("reorganization is reviewed before calendar changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Scheduling request" })
    .fill("Clear two hours tomorrow afternoon to study");
  await page.getByRole("button", { name: "Send ↑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply Changes", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Apply Changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
});

test("saved deadline launches the approval flow from Today", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await page.getByRole("button", { name: "Plan study time →" }).click();
  await expect(
    page.getByRole("button", { name: "Apply Changes", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("Your study plan", { exact: true }),
  ).toBeVisible();
});

test("reconnect refreshes saved state and recovers live updates", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await expect(
    page.getByText(/Good (morning|afternoon|evening), Alex/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByText("Live updates connected", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/Offline or out of date/)).toBeVisible();
  const refreshed = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/state") && r.ok(),
  );
  await context.setOffline(false);
  await refreshed;
  await expect(
    page.getByText("Live updates connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign out this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Explore the demo" }),
  ).toBeVisible();
});
