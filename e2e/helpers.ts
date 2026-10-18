import { expect, type Page } from "@playwright/test";

/** Contas da agência de demonstração (npm run db:seed). */
export const DEMO = {
  org: "estudio-aurora",
  password: process.env.SEED_PASSWORD || "aurora-demo-2026",
  owner: "helena@demo.aragonez.app",
  guest: "paula@demo.aragonez.app",
  guestClient: "cafe-serra-azul",
  otherClient: "clinica-vitta",
};

export async function login(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await page.fill("#email", email);
  await page.fill("#password", DEMO.password);
  await page.click("button[type=submit]");
}

/** A página não pode rolar na horizontal (layout quebrado em telas pequenas). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
