import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ask, openChat, underTheFloor } from "./helpers";

// An answer is drawn formatted (markdown.ts), from untrusted text: bold, lists, code, links and tables show as such; anything
// hostile stays inert; Copy and Share still give plain words; and the page never scrolls sideways.

const ANSWER = "article.msg.bot:not(.pending)";
// In forced-colors mode the browser replaces every colour with the user's own system colours, which axe's contrast rule cannot
// see (it reads the author colours), so that one rule is left out there and only there; every other rule still runs.
const scan = async (page: Page, forced = false) =>
  (
    await new AxeBuilder({ page })
      .withTags([
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa",
        "best-practice",
      ])
      .disableRules(forced ? ["color-contrast"] : [])
      .analyze()
  ).violations.map(
    (x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );

test("bold, italics, a heading, lists, code, a quote, a link and a table are drawn as such", async ({
  page,
}) => {
  await openChat(page);
  await ask(page, "Show markdown please");
  const a = page.locator(ANSWER);
  await expect(a.locator(".cite").first()).toBeVisible();
  await expect(a.locator(".text strong").first()).toHaveText("Section 49");
  await expect(a.locator(".text em")).toHaveText("personal liberty");
  // A heading is a styled paragraph with a heading role, so the page's own h1 / h2 outline is not disturbed.
  const heading = a.locator('.text [role="heading"]');
  await expect(heading).toHaveText("Your rights");
  await expect(heading).toHaveAttribute("aria-level", "2");
  await expect(a.locator(".text h1, .text h2, .text h3")).toHaveCount(0);
  await expect(a.locator(".text ul > li")).toHaveText([
    "You may ask why you are held",
    "You may ask for a lawyer",
  ]);
  await expect(a.locator(".text ol > li")).toHaveText([
    "Stay calm",
    "Say your name",
  ]);
  // The markers are drawn (a reset must not hide them).
  expect(
    await a
      .locator(".text ul")
      .evaluate((el) => getComputedStyle(el).listStyleType),
  ).toBe("disc");
  expect(
    await a
      .locator(".text ol")
      .evaluate((el) => getComputedStyle(el).listStyleType),
  ).toBe("decimal");
  await expect(a.locator(".text p code")).toHaveText("section 50");
  await expect(a.locator(".text pre code")).toHaveText('ask: "Why am I held?"');
  await expect(a.locator(".text blockquote")).toHaveText("Keep calm.");
  // The scrolling boxes are named, so a screen reader says what has been reached.
  await expect(a.locator(".text pre")).toHaveAccessibleName("Code");
  await expect(a.locator(".text .md-table")).toHaveAccessibleName("Table");
  const link = a.locator(".text a");
  await expect(link).toHaveText("the Constitution");
  await expect(link).toHaveAttribute("href", "https://www.parlzim.gov.zw/");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(a.locator(".text table th")).toHaveText(["Right", "Section"]);
  await expect(a.locator(".text table td")).toHaveText([
    "Liberty",
    "49",
    "Dignity",
    "51",
  ]);
  // Drawn, not typed: no mark is left in the visible words, and bold really is bold.
  const shown = (await a.locator(".text").innerText()) ?? "";
  for (const mark of ["##", "**", "](", "_personal", "`", "|---", "```"])
    expect(shown, `no "${mark}"`).not.toContain(mark);
  expect(
    await a
      .locator(".text strong")
      .first()
      .evaluate((el) => Number(getComputedStyle(el).fontWeight)),
  ).toBeGreaterThanOrEqual(700);
  expect(
    await heading.evaluate((el) => Number(getComputedStyle(el).fontWeight)),
  ).toBeGreaterThanOrEqual(700);
});

test("a malicious answer renders inert: no script, no image, no event handler, no javascript: or data: link", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const violations: string[] = [];
  page.on(
    "console",
    (m) =>
      m.text().includes("Content Security Policy") && violations.push(m.text()),
  );
  await openChat(page);
  await ask(page, "Show malicious please");
  const a = page.locator(ANSWER);
  await expect(a.locator(".cite").first()).toBeVisible();
  const text = a.locator(".text");
  // The raw HTML is shown as the characters it is.
  await expect(text).toContainText("<script>window.__pwned = 1</script>");
  await expect(text).toContainText('<img src=x onerror="window.__pwned = 2">');
  // Nothing in it became an element that runs or loads.
  await expect(
    text.locator(
      "script, img, iframe, object, embed, svg, style, link, form, input",
    ),
  ).toHaveCount(0);
  expect(
    await text.evaluate((el) =>
      [...el.querySelectorAll("*")].flatMap((e) =>
        e.getAttributeNames().filter((n) => n.startsWith("on")),
      ),
    ),
  ).toEqual([]);
  // Links: the unsafe two kept their words only; the one safe link is the only link.
  await expect(text).toContainText("click me");
  await expect(text).toContainText("data");
  await expect(text).toContainText("pic"); // the image is its alt text
  const links = text.locator("a");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "https://example.org/ok");
  await expect(links).toHaveAttribute("rel", "noopener noreferrer");
  expect(
    await page.evaluate(
      () => (window as unknown as { __pwned?: number }).__pwned,
    ),
  ).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(violations).toEqual([]);
});

test("Copy and Share give plain words, not the marks (and the visible answer is still formatted)", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.share = async (d?: ShareData) =>
      void (window as unknown as { shared: unknown[] }).shared.push(d);
  });
  await openChat(page);
  await ask(page, "Show markdown please");
  const a = page.locator(ANSWER);
  await expect(a.locator(".text table")).toBeVisible();
  await a.getByRole("button", { name: "Copy answer" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Your rights");
  expect(copied).toContain(
    "Section 49 says you have the right to personal liberty. See section 50 and the Constitution (https://www.parlzim.gov.zw/).",
  );
  expect(copied).toContain("- You may ask why you are held");
  expect(copied).toContain("Right · Section");
  for (const mark of ["##", "**", "`", "](", "_personal", "|---"])
    expect(copied, `no "${mark}"`).not.toContain(mark);
  await a.getByRole("button", { name: "Share answer" }).click();
  const shared = (
    await page.evaluate(
      () => (window as unknown as { shared: { text: string }[] }).shared,
    )
  )[0]!;
  for (const mark of ["##", "**", "`", "](", "|---"])
    expect(shared.text, `no "${mark}" when shared`).not.toContain(mark);
  await expect(a.locator(".text strong").first()).toBeVisible(); // still drawn formatted after copying
});

test("the answer is not read out twice: it is added to the log once and is not changed after", async ({
  page,
}) => {
  await openChat(page);
  await page.evaluate(() => {
    const w = window as unknown as { added: number; mutations: number };
    w.added = 0;
    w.mutations = 0;
    new MutationObserver((rs) => {
      for (const r of rs) {
        w.mutations++;
        for (const n of r.addedNodes)
          if (
            n instanceof HTMLElement &&
            n.matches("article.msg.bot:not(.pending)")
          )
            w.added++;
      }
    }).observe(document.querySelector("#log")!, {
      childList: true,
      subtree: true,
    });
  });
  await ask(page, "Show markdown please");
  await expect(page.locator(`${ANSWER} .cite`).first()).toBeVisible();
  const after = await page.evaluate(
    () => (window as unknown as { added: number }).added,
  );
  expect(after).toBe(1);
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => (window as unknown as { added: number }).added),
  ).toBe(1);
  await expect(page.locator("#log")).toHaveAttribute("aria-live", "polite");
});

for (const width of [320, 360, 768]) {
  test(`a table and a code block wider than the screen scroll inside their own boxes (${width}px); the page does not`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openChat(page);
    await ask(page, "Show wide table please");
    const a = page.locator(ANSWER);
    await expect(a.locator(".text table")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "the page does not scroll sideways",
    ).toBeLessThanOrEqual(width);
    const boxes = await a.locator(".text").evaluate((el) => {
      const box = (sel: string) => {
        const b = el.querySelector<HTMLElement>(sel)!;
        const r = b.getBoundingClientRect();
        return {
          overflowX: getComputedStyle(b).overflowX,
          client: b.clientWidth,
          scroll: b.scrollWidth,
          right: r.right,
          left: r.left,
        };
      };
      return { table: box(".md-table"), code: box("pre") };
    });
    for (const [name, b] of Object.entries(boxes)) {
      expect(b.overflowX, `${name} scrolls inside its box`).toBe("auto");
      expect(b.right, `${name} stays inside the screen`).toBeLessThanOrEqual(
        width - 13,
      );
      expect(b.left, `${name} keeps the 14px inset`).toBeGreaterThanOrEqual(13);
    }
    expect(
      boxes.code.scroll,
      "the long code line is wider than its box",
    ).toBeGreaterThan(boxes.code.client);
    if (width <= 360)
      expect(
        boxes.table.scroll,
        "the wide table is wider than its box",
      ).toBeGreaterThan(boxes.table.client);
    // Both scrolling boxes can be reached and scrolled with a keyboard.
    await a.locator(".text pre").focus();
    await expect(a.locator(".text pre")).toBeFocused();
    expect(
      await underTheFloor(page, { minHit: 49 }),
      "nothing under the Bundu floor",
    ).toEqual([]);
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const mode of ["normal", "more-contrast", "forced-colors"] as const) {
    for (const [question, shows] of [
      ["Show markdown please", "table"],
      ["Show wide table please", "pre"],
    ] as const) {
      test(`a formatted answer passes axe and the floor: ${scheme}, ${mode}, "${question}"`, async ({
        page,
      }) => {
        await page.emulateMedia({
          colorScheme: scheme,
          ...(mode === "more-contrast" ? { contrast: "more" } : {}),
          ...(mode === "forced-colors" ? { forcedColors: "active" } : {}),
        });
        await openChat(page);
        await ask(page, question);
        await expect(page.locator(`${ANSWER} .text ${shows}`)).toBeVisible();
        await expect(page.locator(`${ANSWER} .cite`).first()).toBeVisible();
        expect(await scan(page, mode === "forced-colors")).toEqual([]);
        expect(await underTheFloor(page)).toEqual([]);
      });
    }
  }
}

test("headings in an answer do not break the page outline: no skipped level, one h1", async ({
  page,
}) => {
  await openChat(page);
  await ask(page, "Show markdown please");
  await expect(page.locator(`${ANSWER} .cite`).first()).toBeVisible();
  const levels = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'h1, h2, h3, h4, h5, h6, [role="heading"]',
      ),
    ]
      .filter(
        (e) =>
          e.offsetParent !== null || getComputedStyle(e).position === "fixed",
      )
      .map((e) => Number(e.getAttribute("aria-level") ?? e.tagName.slice(1))),
  );
  expect(levels.filter((l) => l === 1)).toHaveLength(1);
  for (let i = 1; i < levels.length; i++)
    expect(
      levels[i]! - levels[i - 1]!,
      `heading levels ${levels.join(",")}`,
    ).toBeLessThanOrEqual(1);
});
