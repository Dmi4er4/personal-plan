import { expect, test } from "@playwright/test";

test("keeps the night in the previous day and carries plans forward at 04:00", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T23:59:00+03:00") });
  await page.clock.pauseAt(new Date("2026-08-03T23:59:10+03:00"));
  await page.goto("/?e2e=1");
  await page.getByRole("button", { name: "Создать новое хранилище" }).click();
  await page.getByRole("button", { name: "Я сохранил фразу" }).click();

  const addTask = async (title: string): Promise<void> => {
    await page.getByRole("button", { name: "Новое дело" }).click();
    const input = page.getByRole("textbox", { name: "Название нового дела" });
    await input.fill(title);
    await input.press("Enter");
  };
  const previousDay = page.getByRole("region", { name: "Сегодня — пн, 3 августа" });
  await addTask("Перенести в четыре");
  await expect(previousDay.getByText("Перенести в четыре", { exact: true })).toBeVisible();

  await page.clock.fastForward(50_000);
  await expect(previousDay).toBeVisible();
  await addTask("Завершить ночью");
  await previousDay.getByRole("checkbox", { name: "Завершить: Завершить ночью" }).click();
  await previousDay.getByText("Выполненные (1)", { exact: true }).click();
  await expect(previousDay.getByRole("checkbox", { name: "Вернуть: Завершить ночью" })).toBeVisible();

  await page.clock.fastForward(14_399_999);
  await expect(previousDay).toBeVisible();
  await page.clock.fastForward(1);
  const nextDay = page.getByRole("region", { name: "Сегодня — вт, 4 августа" });
  await expect(nextDay.getByText("Перенести в четыре", { exact: true })).toBeVisible();
  await expect(page.getByText("Завершить ночью", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Текст" }).click();
  await expect(page.getByRole("textbox", { name: "Текст плана" })).toHaveValue(
    "Сегодня — вт, 4 августа\nПеренести в четыре",
  );
  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
  await expect(page.getByRole("region", { name: "История" }).getByText("Завершить ночью", { exact: true })).toBeVisible();
});
