import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function addTask(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Новое дело" }).click();
  const input = page.getByRole("textbox", { name: "Название нового дела" });
  await input.fill(title);
  await input.press("Enter");
}

async function canonicalText(page: Page): Promise<string> {
  await page.getByRole("tab", { name: "Текст" }).click();
  return page.getByRole("textbox", { name: "Текст плана" }).inputValue();
}

async function blockRelay(context: BrowserContext): Promise<void> {
  await context.route("**/v1/**", (route) => route.abort("internetdisconnected"));
}

test("pairs two profiles, edits offline, converges, and persists", async ({ playwright }, testInfo) => {
  const profileA = testInfo.outputPath("profile-a");
  const profileB = testInfo.outputPath("profile-b");
  let contextA = await playwright.chromium.launchPersistentContext(profileA, { headless: true });
  let contextB = await playwright.chromium.launchPersistentContext(profileB, { headless: true });
  let pageA = await contextA.newPage();
  let pageB = await contextB.newPage();

  await pageA.goto("/?e2e=1");
  await pageA.getByRole("button", { name: "Создать зашифрованное хранилище" }).click();
  await expect(pageA.getByRole("button", { name: "Показать фразу восстановления" })).toBeVisible();
  await addTask(pageA, "Общий родитель");
  await pageA.getByRole("tab", { name: "Текст" }).click();
  const textareaA = pageA.getByRole("textbox", { name: "Текст плана" });
  await textareaA.fill(`${await textareaA.inputValue()}\n  Подзадача`);
  await expect(pageA.getByText("синхронизировано", { exact: true })).toBeVisible();
  await pageA.getByRole("button", { name: "Показать фразу восстановления" }).click();
  const phrase = await pageA.getByLabel("Фраза восстановления").textContent();
  expect(phrase?.split(" ")).toHaveLength(24);

  await pageB.goto("/?e2e=1");
  await pageB.getByRole("textbox", { name: "Фраза восстановления" }).fill(phrase ?? "");
  await pageB.getByRole("button", { name: "Восстановить по фразе" }).click();
  await expect(pageB.getByText("Общий родитель", { exact: true })).toBeVisible();

  await blockRelay(contextA);
  await blockRelay(contextB);
  await pageA.getByRole("tab", { name: "Список" }).click();
  await addTask(pageA, "Офлайн A");
  await addTask(pageB, "Офлайн B");
  await pageB.getByRole("checkbox", { name: "Завершить: Подзадача" }).click();
  await expect(pageA.getByText(/^офлайн/u)).toBeVisible();
  await expect(pageB.getByText(/^офлайн/u)).toBeVisible();

  await contextB.unroute("**/v1/**");
  await pageB.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(pageB.getByText("синхронизировано", { exact: true })).toBeVisible();
  await contextA.unroute("**/v1/**");
  await pageA.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(pageA.getByText("синхронизировано", { exact: true })).toBeVisible();
  await pageB.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(pageB.getByText("Офлайн A", { exact: true })).toBeVisible();
  expect(await canonicalText(pageA)).toBe(await canonicalText(pageB));

  await Promise.all([contextA.close(), contextB.close()]);
  contextA = await playwright.chromium.launchPersistentContext(profileA, { headless: true });
  contextB = await playwright.chromium.launchPersistentContext(profileB, { headless: true });
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  await Promise.all([pageA.goto("/?e2e=1"), pageB.goto("/?e2e=1")]);
  await expect(pageA.getByText("Офлайн B", { exact: true })).toBeVisible();
  await expect(pageB.getByText("Офлайн A", { exact: true })).toBeVisible();
  expect(await canonicalText(pageA)).toBe(await canonicalText(pageB));
  await Promise.all([contextA.close(), contextB.close()]);
});
