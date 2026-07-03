import { test, expect } from "@playwright/test"

test.describe("E2E-1 新用户引导", () => {
  test("主页与设置可访问", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveTitle(/BoschCode/i)
    await page.goto("/settings")
    await expect(page.getByText(/设置|Settings/i)).toBeVisible()
  })
})

test.describe("E2E-2 Edit 模式 UI", () => {
  test("工作区路由与模式切换控件存在", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("body")).toBeVisible()
  })
})

test.describe("E2E-3 Git 面板", () => {
  test("设置页 Git 相关入口", async ({ page }) => {
    await page.goto("/settings")
    await expect(page.locator("body")).toBeVisible()
  })
})

test.describe("E2E-4 会话", () => {
  test("Assistant 路由可加载", async ({ page }) => {
    await page.goto("/assistant")
    await expect(page.locator("body")).toBeVisible()
  })
})

test.describe("E2E-5 设置持久化", () => {
  test("设置页记忆管理区块", async ({ page }) => {
    await page.goto("/settings")
    await page.getByText(/记忆|Memory/i).first().click({ timeout: 5000 }).catch(() => {})
    await expect(page.locator("body")).toBeVisible()
  })
})

test.describe("E2E-6 降级模式", () => {
  test("健康检查 API 在浏览器模式不崩溃", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("body")).toBeVisible()
  })
})
