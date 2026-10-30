import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const SHOTS = process.env["SCREENSHOTS"] ? "docs/evidence/screens" : null;

async function addShift(
  page: Page,
  v: { employer: string; start: string; end: string; brk?: string; rate: string; note?: string },
): Promise<void> {
  await page.getByLabel("Employer or place").fill(v.employer);
  await page.getByLabel("Start").fill(v.start);
  await page.getByLabel("End").fill(v.end);
  await page.getByLabel("Unpaid break (minutes)").fill(v.brk ?? "0");
  await page.getByLabel("Hourly rate").fill(v.rate);
  await page.getByLabel("Note (optional)").fill(v.note ?? "");
  await page.getByRole("button", { name: "Add shift" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Shift saved." })).toBeVisible();
}

const csvWeek = [
  "employer,start,end,break_minutes,rate,note",
  "Corner Cafe,2026-10-26T08:00,2026-10-26T18:00,0,20.00,",
  "Corner Cafe,2026-10-27T08:00,2026-10-27T18:00,0,20.00,",
  "Corner Cafe,2026-10-28T08:00,2026-10-28T18:00,0,20.00,",
  "Corner Cafe,2026-10-29T08:00,2026-10-29T18:00,0,20.00,",
  "Depot,2026-10-30T08:00,2026-10-30T16:00,0,20.00,Friday cover",
].join("\r\n");

async function importCsv(page: Page, text: string): Promise<void> {
  await page.locator('[data-tab="backup"]').click();
  await page.locator("#csv-file").setInputFiles({ name: "week.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
  await expect(page.getByRole("status").filter({ hasText: /Imported \d+ shift/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ShiftLedger" })).toBeVisible();
});

test("makes no network requests beyond its own files", async ({ page, baseURL }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(baseURL ?? "") && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) foreign.push(r.url());
  });
  await page.reload();
  await addShift(page, { employer: "Cafe", start: "2026-10-26T09:00", end: "2026-10-26T10:00", rate: "10" });
  expect(foreign).toEqual([]);
});

test("a saved shift survives a reload (IndexedDB)", async ({ page }) => {
  await addShift(page, { employer: "Corner Cafe", start: "2026-10-26T09:00", end: "2026-10-26T17:30", brk: "30", rate: "18.50", note: "opening" });
  await expect(page.locator("tr[data-shift]")).toHaveCount(1);
  await expect(page.locator("tr[data-shift]")).toContainText("Corner Cafe");
  await expect(page.locator("tr[data-shift]")).toContainText("8h 00m");
  await expect(page.locator("tr[data-shift]")).toContainText("$148.00");
  await page.reload();
  await expect(page.locator("tr[data-shift]")).toHaveCount(1);
  await expect(page.locator("tr[data-shift]")).toContainText("opening");
});

test("bad input is explained next to the field and nothing is saved", async ({ page }) => {
  await page.getByLabel("Start").fill("2026-10-26T17:00");
  await page.getByLabel("End").fill("2026-10-26T09:00");
  await page.getByLabel("Hourly rate").fill("abc");
  await page.getByRole("button", { name: "Add shift" }).click();
  await expect(page.getByText("Enter an employer or place.")).toBeVisible();
  await expect(page.getByText("The end must be after the start.")).toBeVisible();
  await expect(page.getByText("Enter an hourly rate from 0 to 10,000.")).toBeVisible();
  await expect(page.locator("tr[data-shift]")).toHaveCount(0);
});

test("edit and delete work, and delete asks first", async ({ page }) => {
  await addShift(page, { employer: "Cafe", start: "2026-10-26T09:00", end: "2026-10-26T10:00", rate: "10" });
  await page.getByRole("button", { name: /^Edit Cafe/ }).click();
  await page.getByLabel("Hourly rate").fill("12");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("tr[data-shift]")).toContainText("$12.00");
  await page.getByRole("button", { name: /^Delete Cafe/ }).click();
  await page.getByRole("button", { name: "Keep" }).click();
  await expect(page.locator("tr[data-shift]")).toHaveCount(1);
  await page.getByRole("button", { name: /^Delete Cafe/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("tr[data-shift]")).toHaveCount(0);
});

test("weekly overtime is worked out and shown", async ({ page }) => {
  await importCsv(page, csvWeek);
  await page.locator('[data-tab="summary"]').click();
  // 40h at $20 plus 8h of overtime at $30
  await expect(page.locator("#grand-total")).toHaveText("$1,040.00");
  await expect(page.locator("[data-week]")).toContainText("OT 8h 00m");
  await expect(page.getByRole("cell", { name: "Corner Cafe" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Depot" })).toBeVisible();
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/summary.png`, fullPage: true });
    await page.locator('[data-tab="shifts"]').click();
    await page.screenshot({ path: `${SHOTS}/shifts.png`, fullPage: true });
  }
});

test("hostile text is displayed as text and never runs", async ({ page }) => {
  const evil = "<img src=x onerror=window.__pwned=1><script>window.__pwned=1</script>";
  await addShift(page, { employer: evil, start: "2026-10-26T09:00", end: "2026-10-26T10:00", rate: "10", note: "<b>bold</b>" });
  await expect(page.locator("tr[data-shift]")).toContainText(evil);
  await expect(page.locator("tr[data-shift] b")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)["__pwned"])).toBeUndefined();
});

test("CSV export is correct and neutralises formulas", async ({ page }) => {
  await addShift(page, { employer: "=HYPERLINK(\"http://x.test\")", start: "2026-10-26T09:00", end: "2026-10-26T17:30", brk: "30", rate: "18.50" });
  await page.locator('[data-tab="backup"]').click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-csv").click()]);
  const text = readFileSync(await download.path(), "utf8");
  const [head, row] = text.split("\r\n");
  expect(head).toBe("employer,start,end,break_minutes,paid_hours,rate,regular_pay,overtime_pay,total_pay,note");
  expect(row?.startsWith(`"'=HYPERLINK(""http://x.test"")"`)).toBe(true);
  expect(row).toContain("8.00,18.50,148.00,0.00,148.00");
});

test("a backup restores everything after the data is wiped", async ({ page }) => {
  await importCsv(page, csvWeek);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-json").click()]);
  const backup = readFileSync(await download.path());
  await page.locator("#wipe").click();
  await page.locator("#wipe-yes").click();
  await expect(page.getByRole("status").filter({ hasText: "Everything was deleted." })).toBeVisible();
  await page.locator('[data-tab="shifts"]').click();
  await expect(page.locator("tr[data-shift]")).toHaveCount(0);
  await page.locator('[data-tab="backup"]').click();
  await page.locator("#restore-file").setInputFiles({ name: "b.json", mimeType: "application/json", buffer: backup });
  await expect(page.locator("#restore-confirm")).toContainText("5 shift(s)");
  await page.locator("#restore-yes").click();
  await page.locator('[data-tab="shifts"]').click();
  await expect(page.locator("tr[data-shift]")).toHaveCount(5);
  await page.reload();
  await expect(page.locator("tr[data-shift]")).toHaveCount(5);
});

test("a damaged backup is refused and changes nothing", async ({ page }) => {
  await addShift(page, { employer: "Cafe", start: "2026-10-26T09:00", end: "2026-10-26T10:00", rate: "10" });
  await page.locator('[data-tab="backup"]').click();
  await page.locator("#restore-file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"app":"shiftledger","version":1}') });
  await expect(page.getByRole("status")).toContainText("settings");
  await page.locator('[data-tab="shifts"]').click();
  await expect(page.locator("tr[data-shift]")).toHaveCount(1);
});

test("settings change the maths", async ({ page }) => {
  await importCsv(page, csvWeek);
  await page.locator('[data-tab="settings"]').click();
  await page.getByLabel(/Overtime after/).fill("0");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.locator('[data-tab="summary"]').click();
  await expect(page.locator("#grand-total")).toHaveText("$960.00"); // 48h at $20, no overtime
});

test("opens and keeps working offline once installed", async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await addShift(page, { employer: "Cafe", start: "2026-10-26T09:00", end: "2026-10-26T10:00", rate: "10" });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "ShiftLedger" })).toBeVisible();
  await expect(page.locator("tr[data-shift]")).toHaveCount(1);
  await addShift(page, { employer: "Cafe", start: "2026-10-27T09:00", end: "2026-10-27T10:00", rate: "10" });
  await expect(page.locator("tr[data-shift]")).toHaveCount(2);
});
