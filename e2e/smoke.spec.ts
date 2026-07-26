import { test, expect } from "@playwright/test"

test("home page loads", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle(/BoschMate/i)
})

test("settings page loads", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByText(/设置|Settings/i)).toBeVisible()
})

test("assistant route loads", async ({ page }) => {
  await page.goto("/assistant")
  await expect(page.locator("body")).toBeVisible()
})
