import { expect, test, type Page } from "@playwright/test";

const TODAY_HEADING = "Сегодня — пн, 3 августа";
const TOMORROW_HEADING = "Завтра — вт, 4 августа";
const TOMORROW_BUCKET = "date:2026-08-04";

async function waitForPlanPersistence(page: Page): Promise<void> {
  await expect(
    page.getByText("сохранено на устройстве", { exact: true }),
  ).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("personal-plan");
      request.addEventListener("success", () => {
        resolve(request.result);
      });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("Could not open the plan database"));
      });
    });

    const acknowledged = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction("plan-snapshots", "readonly");
      transaction.addEventListener("complete", () => {
        resolve(request.result);
      });
      transaction.addEventListener("abort", () => {
        reject(transaction.error ?? new Error("Plan persistence transaction aborted"));
      });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new Error("Plan persistence transaction failed"));
      });
      const request = transaction
        .objectStore("plan-snapshots")
        .get("acknowledged");
    });
    database.close();
    return ArrayBuffer.isView(acknowledged) && acknowledged.byteLength > 0;
  })).toBe(true);
}

async function keyboardDragToBucket(page: Page, targetBucket: string): Promise<void> {
  let currentBucket: string | null = null;
  for (let move = 0; move < 8; move += 1) {
    const previousBucket = currentBucket;
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(async () =>
        page
          .locator(".timeline-section--over")
          .getAttribute("data-bucket-key"),
      )
      .not.toBe(previousBucket);
    currentBucket = await page
      .locator(".timeline-section--over")
      .getAttribute("data-bucket-key");
    if (currentBucket === targetBucket) {
      return;
    }
  }
  throw new Error(`Keyboard drag did not reach bucket ${targetBucket}`);
}

test("keeps the local plan equivalent and editable across online and offline reloads", async ({
  context,
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-08-03T09:00:00+03:00"));
  await page.goto("/?e2e=1");

  const manifestLanguage = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest");
    const manifest: unknown = await response.json();
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("lang" in manifest) ||
      typeof manifest.lang !== "string"
    ) {
      return null;
    }
    return manifest.lang;
  });
  expect(manifestLanguage).toBe("ru");
  await expect(page.getByText("сохранено на устройстве", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Новое дело" }).click();
  await page
    .getByRole("textbox", { name: "Название нового дела" })
    .fill("Собраться: выключить свет");
  await page.getByRole("textbox", { name: "Название нового дела" }).press("Enter");

  await page.getByRole("tab", { name: "Текст" }).click();
  const textPlan = page.getByRole("textbox", { name: "Текст плана" });
  await expect(textPlan).toHaveValue(
    `${TODAY_HEADING}\nСобраться\\: выключить свет`,
  );
  await textPlan.fill(
    `${TODAY_HEADING}\nСобраться\\: выключить свет\n  Трусы\n  Носки`,
  );

  await page.getByRole("tab", { name: "Список" }).click();
  await expect(page.getByText("Трусы", { exact: true })).toBeVisible();
  await expect(page.getByText("Носки", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Завершить: Трусы" }).click();
  const completedChild = page.getByRole("checkbox", { name: "Вернуть: Трусы" });
  await expect(completedChild).toHaveAttribute("aria-checked", "true");
  await expect(completedChild).toHaveCSS("background-color", "rgb(133, 133, 133)");
  await expect(
    page.getByRole("checkbox", { name: "Завершить: Носки" }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("+ Трусы", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Текст" }).click();
  await expect(textPlan).toHaveValue(/\n {2}\+ Трусы\n {2}Носки/u);
  await expect(
    page.getByRole("checkbox", { name: "Вернуть: Трусы" }),
  ).toHaveCount(0);
  const completedText = await textPlan.inputValue();
  await textPlan.fill(
    `${completedText}\n\n${TOMORROW_HEADING}\nОтложить покупки\n  Сверить список`,
  );

  await page.getByRole("tab", { name: "Список" }).click();
  const tomorrowSection = page.locator(`[data-bucket-key="${TOMORROW_BUCKET}"]`);
  await expect(
    tomorrowSection.getByText("Отложить покупки", { exact: true }),
  ).toBeVisible();
  await expect(
    tomorrowSection.getByText("Сверить список", { exact: true }),
  ).toBeVisible();
  const dragHandle = page.getByRole("button", {
    name: "Переместить: Отложить покупки",
  });
  await dragHandle.focus();
  await page.keyboard.press("Space");
  await keyboardDragToBucket(page, "later");
  await expect(page.locator('[data-bucket-key="later"]')).toHaveClass(
    /timeline-section--over/u,
  );
  await page.keyboard.press("Space");
  const laterSection = page.locator('[data-bucket-key="later"]');
  await expect(
    laterSection.getByText("Отложить покупки", { exact: true }),
  ).toBeVisible();
  await expect(
    laterSection.getByText("Сверить список", { exact: true }),
  ).toBeVisible();
  await expect(tomorrowSection).toHaveCount(0);
  await expect(
    tomorrowSection.getByText("Отложить покупки", { exact: true }),
  ).toHaveCount(0);
  await expect(
    tomorrowSection.getByText("Сверить список", { exact: true }),
  ).toHaveCount(0);

  await waitForPlanPersistence(page);
  await page.reload();
  await expect(
    page.getByText("Собраться: выключить свет", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Вернуть: Трусы" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    laterSection,
  ).toContainText("Отложить покупки");

  await page.waitForFunction(() => window.__PLAN_PWA_READY__ === true);
  await expect
    .poll(async () =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
  const devTools = await context.newCDPSession(page);
  const { installabilityErrors } = await devTools.send(
    "Page.getInstallabilityErrors",
  );
  expect(installabilityErrors).toEqual([]);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("tab", { name: "Текст" }).click();
  await expect(textPlan).toHaveValue(/Собраться\\: выключить свет/u);
  await textPlan.fill((await textPlan.inputValue()).replace("Собраться", "Собраться офлайн"));
  await page.getByRole("tab", { name: "Список" }).click();
  await expect(
    page.getByText("Собраться офлайн: выключить свет", { exact: true }),
  ).toBeVisible();
  await waitForPlanPersistence(page);

  await page.reload();
  await expect(
    page.getByText("Собраться офлайн: выключить свет", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Вернуть: Трусы" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    laterSection,
  ).toContainText("Сверить список");

  await page.getByRole("tab", { name: "Текст" }).click();
  const expectedOfflineCanonical = [
    TODAY_HEADING,
    "Собраться офлайн\\: выключить свет",
    "  + Трусы",
    "  Носки",
    "",
    "--------",
    "Позже",
    "Отложить покупки",
    "  Сверить список",
  ].join("\n");
  await expect(textPlan).toHaveValue(expectedOfflineCanonical);
  const offlineCanonical = await textPlan.inputValue();

  await context.setOffline(false);
  await page.reload();
  await expect(
    page.getByText("Собраться офлайн: выключить свет", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("выключить свет", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Вернуть: Трусы" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("checkbox", { name: "Завершить: Носки" }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(
    laterSection.getByText("Отложить покупки", { exact: true }),
  ).toBeVisible();
  await expect(
    laterSection.getByText("Сверить список", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Текст" }).click();
  await expect(textPlan).toHaveValue(offlineCanonical);
});
