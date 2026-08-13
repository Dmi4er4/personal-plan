import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("button", { name: "Меню" }));
  await user.click(screen.getByRole("menuitem", { name: "Настройки" }));
}
