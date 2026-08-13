import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const profileDir = process.argv[2];
const appUrl = process.argv[3];
const cdpUrl = process.argv[4];
const phraseFile = process.argv[5];

if (!profileDir || !appUrl) {
  throw new Error("Usage: prepare-desktop-profile.mjs <profile-directory> <app-url> [cdp-url] [phrase-file]");
}

const parsedAppUrl = new URL(appUrl);
const localHttp = parsedAppUrl.protocol === "http:"
  && (parsedAppUrl.hostname === "127.0.0.1" || parsedAppUrl.hostname === "localhost");
if (parsedAppUrl.protocol !== "https:" && !localHttp) {
  throw new Error("App URL must use HTTPS unless it points to localhost");
}
if (cdpUrl) {
  const parsedCdpUrl = new URL(cdpUrl);
  if (parsedCdpUrl.hostname !== "127.0.0.1" && parsedCdpUrl.hostname !== "localhost") {
    throw new Error("CDP URL must point to localhost");
  }
}

let pipedPhrase = "";
try {
  pipedPhrase = readFileSync(0, "utf8").trim();
} catch {
  // Fall back to the clipboard for interactive use.
}

const phrase = (
  process.env.PERSONAL_PLAN_RECOVERY_PHRASE
  ?? (
    phraseFile
      ? readFileSync(phraseFile, "utf8")
      : pipedPhrase || execFileSync("/usr/bin/pbpaste", { encoding: "utf8" })
  )
).trim();
if (phrase.split(/\s+/u).length !== 24) {
  throw new Error("Clipboard does not contain a 24-word recovery phrase");
}

const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : null;
const context = browser?.contexts()[0] ?? await chromium.launchPersistentContext(profileDir, {
  headless: true,
  args: ["--disable-default-apps", "--no-first-run"],
});

try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(parsedAppUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });

  const listTab = page.getByRole("tab", { name: "Список", exact: true });
  if (await listTab.count() === 0) {
    const phraseField = page.getByLabel("Фраза восстановления", { exact: true });
    await phraseField.waitFor({ state: "visible", timeout: 15_000 });
    await phraseField.fill(phrase);
    await page.getByRole("button", { name: "Подключить по фразе", exact: true }).click();
  }

  await listTab.waitFor({ state: "visible", timeout: 30_000 });

  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки", exact: true }).click();
  await page.getByText("синхронизировано", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });

  console.log("desktop-profile-ready");
} finally {
  if (browser === null) {
    await context.close();
  }
}
