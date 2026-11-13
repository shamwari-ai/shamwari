import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown, safeHref } from "../../src/chat/markdown";

// The renderer only needs createElement, className, setAttribute and append, so a tiny stand-in for the DOM lets it run in
// node. The stand-in has no innerHTML at all (setting it throws), and what it builds is serialised with every text escaped,
// so a test sees exactly what a browser would be handed.
class FText {
  constructor(public data: string) {}
}
class FEl {
  attrs: Record<string, string> = {};
  kids: (FEl | FText)[] = [];
  className = "";
  constructor(public tag: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = String(v);
  }
  append(...xs: (FEl | FText | string)[]) {
    for (const x of xs)
      this.kids.push(typeof x === "string" ? new FText(x) : x);
  }
  set innerHTML(_: string) {
    throw new Error("innerHTML must never be used");
  }
}
type N = FEl | FText;
const VOID = new Set(["br", "hr"]);
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
function html(n: N): string {
  if (n instanceof FText) return esc(n.data);
  const attrs = (
    n.className ? { class: n.className, ...n.attrs } : n.attrs
  ) as Record<string, string>;
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  return VOID.has(n.tag)
    ? `<${n.tag}${a}>`
    : `<${n.tag}${a}>${n.kids.map(html).join("")}</${n.tag}>`;
}
function walk(n: N, f: (e: FEl) => void) {
  if (n instanceof FEl) {
    f(n);
    n.kids.forEach((k) => walk(k, f));
  }
}
const all = (n: N) => {
  const out: FEl[] = [];
  walk(n, (e) => out.push(e));
  return out;
};
const textOf = (n: N): string =>
  n instanceof FText ? n.data : n.kids.map(textOf).join("");

const ALLOWED_TAGS = new Set([
  "div",
  "p",
  "br",
  "hr",
  "a",
  "em",
  "strong",
  "del",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);
const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel"],
  ol: ["start"],
  p: ["role", "aria-level"],
  pre: ["tabindex", "role", "aria-label"],
  div: ["tabindex", "role", "aria-label"],
  th: ["scope"],
};

/** The properties that must hold for ANY answer: only known tags, only known attributes, and links that are http(s)/mailto. */
function assertInert(root: N, what: string) {
  for (const e of all(root)) {
    expect(
      ALLOWED_TAGS.has(e.tag),
      `${what}: <${e.tag}> is not an allowed element`,
    ).toBe(true);
    for (const k of Object.keys(e.attrs)) {
      expect(k.startsWith("on"), `${what}: event handler ${k}`).toBe(false);
      expect(
        ALLOWED_ATTRS[e.tag]?.includes(k),
        `${what}: <${e.tag} ${k}> is not an allowed attribute`,
      ).toBe(true);
    }
    if (e.tag === "a") {
      expect(e.attrs.href, what).toMatch(/^(https?:|mailto:)/);
      expect(e.attrs.target).toBe("_blank");
      expect(e.attrs.rel).toBe("noopener noreferrer");
    }
  }
}

const g = globalThis as unknown as { document?: unknown };
let before: unknown;
beforeAll(() => {
  before = g.document;
  g.document = { createElement: (t: string) => new FEl(t) };
});
afterAll(() => {
  g.document = before;
});
const render = (md: string) => renderMarkdown(md) as unknown as FEl;
const out = (md: string) => html(render(md));

describe("renderMarkdown: formatting", () => {
  it("draws bold, italic, bold italic, strikethrough and inline code", () => {
    expect(
      out("**bold** and *it* and _it2_ and ***both*** and ~~old~~ and `x < y`"),
    ).toBe(
      '<div class="text md"><p><strong>bold</strong> and <em>it</em> and <em>it2</em> and <strong><em>both</em></strong> and <del>old</del> and <code>x &lt; y</code></p></div>',
    );
  });
  it("leaves snake_case, 2 * 3 and a lone underscore or asterisk alone", () => {
    expect(
      textOf(
        render("snake_case_word and 2 * 3 = 6 and a_b and ref__2024__A x"),
      ),
    ).toBe("snake_case_word and 2 * 3 = 6 and a_b and ref__2024__A x");
    expect(out("2 * 3 = 6")).not.toContain("<em>");
    expect(out("snake_case_word")).not.toContain("<em>");
  });
  it("draws headings as styled paragraphs with a heading role that never skips a level (the page keeps its own h1 and h2)", () => {
    const h = out("# One\n\n### Three\n\n###### Six\n\n## Two");
    expect(h).toContain(
      '<p class="md-h md-h1" role="heading" aria-level="2">One</p>',
    );
    expect(h).toContain(
      '<p class="md-h md-h3" role="heading" aria-level="3">Three</p>',
    ); // a skip from 2 to 4 is held at 3
    expect(h).toContain('role="heading" aria-level="4">Six</p>');
    expect(h).toContain(
      '<p class="md-h md-h2" role="heading" aria-level="3">Two</p>',
    );
    expect(h).not.toMatch(/<h[1-6]/);
  });
  it("draws bulleted and numbered lists, nested, with a start number kept", () => {
    expect(out("Intro:\n- one\n- two\n  - inner\n- three")).toBe(
      '<div class="text md"><p>Intro:</p><ul><li>one</li><li>two<ul><li>inner</li></ul></li><li>three</li></ul></div>',
    );
    expect(out("3. c\n4. d")).toBe(
      '<div class="text md"><ol start="3"><li>c</li><li>d</li></ol></div>',
    );
    expect(out("1. a\n\n2. b")).toBe(
      '<div class="text md"><ol><li>a</li><li>b</li></ol></div>',
    );
  });
  it("draws quotes, rules and fenced code (what is inside a fence is never parsed)", () => {
    expect(
      out('> Keep **calm**.\n\n---\n\n```js\nlet a = "<b>"; // **no**\n```'),
    ).toBe(
      '<div class="text md"><blockquote><p>Keep <strong>calm</strong>.</p></blockquote><hr><pre tabindex="0" role="group" aria-label="Code"><code>let a = &quot;&lt;b&gt;&quot;; // **no**</code></pre></div>',
    );
  });
  it("draws a table with a header, aligned columns and escaped pipes", () => {
    const t = out(
      "| Right | Section |\n|:--|--:|\n| Liberty | 49 |\n| a \\| b | **x** |",
    );
    expect(t).toContain(
      '<div class="md-table" tabindex="0" role="group" aria-label="Table"><table><thead><tr><th scope="col">Right</th><th class="md-r" scope="col">Section</th></tr>',
    );
    expect(t).toContain("<td>a | b</td>");
    expect(t).toContain("<strong>x</strong>");
  });
  it("draws links as new-tab, noopener links, for http, https and mailto only; bare addresses are linked too", () => {
    const l = render(
      "[the Constitution](https://www.parlzim.gov.zw/) [mail](mailto:a@b.org) see https://example.org/x?y=1, and (http://a.org).",
    );
    const links = all(l).filter((e) => e.tag === "a");
    expect(links.map((a) => a.attrs.href)).toEqual([
      "https://www.parlzim.gov.zw/",
      "mailto:a@b.org",
      "https://example.org/x?y=1",
      "http://a.org/",
    ]);
    assertInert(l, "links");
    expect(textOf(links[2]!)).toBe("https://example.org/x?y=1"); // the comma is not part of the address
  });
  it("keeps single line breaks and escapes", () => {
    expect(out("one\ntwo \\*star\\*")).toBe(
      '<div class="text md"><p>one<br>two *star*</p></div>',
    );
  });
});

describe("renderMarkdown: an answer is untrusted text and stays inert", () => {
  const EVIL = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="javascript:alert(1)"></iframe>',
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](  javascript:alert(1))",
    "[x](java\nscript:alert(1))",
    "[x](java\tscript:alert(1))",
    "[x](&#106;avascript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](vbscript:msgbox(1))",
    "[x](file:///etc/passwd)",
    "[x](//evil.example/x)",
    "[x](/relative)",
    "![a](javascript:alert(1))",
    "![<img src=x onerror=alert(1)>](https://e.org/x.png)",
    "[![x](https://e.org/i.png)](javascript:alert(1))",
    "[[x](javascript:alert(1))](https://e.org)",
    "javascript:alert(1)",
    "| <script> | b |\n|---|---|\n| <img onerror=x> | [x](javascript:1) |",
    "# <script>alert(1)</script>",
    "```\n</code></pre><script>alert(1)</script>\n```",
    "`<script>`",
    "> <svg onload=alert(1)>",
    "- <details open ontoggle=alert(1)>",
  ];
  for (const md of EVIL) {
    it(`renders inert: ${JSON.stringify(md).slice(0, 60)}`, () => {
      const root = render(md);
      assertInert(root, md);
      expect(
        all(root).filter((e) =>
          ["script", "img", "iframe", "svg", "style", "details"].includes(
            e.tag,
          ),
        ),
      ).toEqual([]);
    });
  }
  it("shows raw HTML as the characters it is", () => {
    expect(out("<script>alert(1)</script>")).toBe(
      '<div class="text md"><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></div>',
    );
    expect(out("<img src=x onerror=alert(1)>")).toBe(
      '<div class="text md"><p>&lt;img src=x onerror=alert(1)&gt;</p></div>',
    );
  });
  it("keeps the words of a link it will not follow, and the alt text of an image", () => {
    expect(out("[click me](javascript:alert(1))")).toBe(
      '<div class="text md"><p>click me</p></div>',
    );
    expect(out("![a cat](https://e.org/c.png)")).toBe(
      '<div class="text md"><p>a cat</p></div>',
    );
    expect(
      all(render("[click](data:text/html;base64,AAAA)")).some(
        (e) => e.tag === "a",
      ),
    ).toBe(false);
  });
  it("safeHref accepts only http, https and mailto addresses", () => {
    expect(safeHref("https://a.org/x")).toBe("https://a.org/x");
    expect(safeHref("mailto:a@b.org")).toBe("mailto:a@b.org");
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:1",
      " javascript:1",
      "java\nscript:1",
      "data:text/html,x",
      "vbscript:x",
      "file:///x",
      "/x",
      "//x",
      "x",
      "",
      "blob:https://a.org/x",
    ]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
  it("no chat source writes HTML, and the renderer has no lookbehind (older phones cannot parse one)", () => {
    const dir = new URL("../../src/chat/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files).toContain("markdown.ts");
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|setHTML|setHTMLUnsafe|srcdoc|document\.write|DOMParser|createContextualFragment|\beval\(|new Function/,
      );
    }
    const md = readFileSync(new URL("markdown.ts", dir), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(md).not.toContain("(?<");
  });
  it("never deletes answer text: a link title is left out, and a malformed link stays as characters", () => {
    expect(
      textOf(render('See [the Act](https://a.org "the title") here.')),
    ).toBe("See the Act here.");
    expect(
      textOf(render("See [the Act](https://a.org 'the title' ) here.")),
    ).toBe("See the Act here.");
    expect(
      textOf(render("See [the Act](https://a.org (the title)) here.")),
    ).toBe("See the Act here.");
    const bad = "See [the Act](https://a.org do not sign) here.";
    expect(textOf(render(bad))).toBe(bad);
    // the bare address inside it is linked as any address is, but "the Act" is not a link and no word is lost
    expect(
      all(render(bad))
        .filter((e) => e.tag === "a")
        .map(textOf),
    ).toEqual(["https://a.org"]);
    const after =
      "Read [the Act](https://a.org do not sign) and (section 49) too.";
    expect(textOf(render(after))).toBe(after);
    const good = render('[x](https://a.org "t") (section 49)');
    expect(textOf(good)).toBe("x (section 49)");
    expect(all(good).filter((e) => e.tag === "a")).toHaveLength(1);
  });
  it("names its scrolling boxes, so a screen reader says what has been reached", () => {
    const r = render("```\ncode\n```\n\n| a | b |\n|---|---|\n| c | d |");
    const pre = all(r).find((e) => e.tag === "pre")!;
    const box = all(r).find((e) => e.className === "md-table")!;
    expect([
      pre.attrs.role,
      pre.attrs["aria-label"],
      pre.attrs.tabindex,
    ]).toEqual(["group", "Code", "0"]);
    expect([
      box.attrs.role,
      box.attrs["aria-label"],
      box.attrs.tabindex,
    ]).toEqual(["group", "Table", "0"]);
    const sn = renderMarkdown("```\nx\n```", {
      code: "Kodhi",
      table: "Tafura",
    }) as unknown as FEl;
    expect(all(sn).find((e) => e.tag === "pre")!.attrs["aria-label"]).toBe(
      "Kodhi",
    );
  });
  it("builds a very wide table row cell by cell (never spread into one call)", () => {
    const cols = 9_500; // three lines of it stay under the size limit
    const r = render(
      "|" +
        "a|".repeat(cols) +
        "\n|" +
        "-|".repeat(cols) +
        "\n|" +
        "b|".repeat(cols),
    );
    expect(all(r).filter((e) => e.tag === "td").length).toBe(cols);
  });
});

describe("renderMarkdown: malformed, nested and hostile input", () => {
  it("survives unbalanced and crossed marks, and still shows every character", () => {
    for (const md of [
      "**_a**_",
      "*a **b* c**",
      "[[[[",
      "]]]](((",
      "[a](",
      "[a](b",
      "[a]( b )",
      "**",
      "****",
      "~~",
      "`",
      "```",
      "*",
      "_",
      "![",
      "![]()",
      "[]()",
      "[](https://a.org)",
      "| a |",
      "|---|",
      ">",
      "- ",
      "1.",
      "#",
      "# ",
      "\\",
      "a\\",
    ]) {
      const r = render(md);
      assertInert(r, md);
    }
    expect(textOf(render("**unclosed bold"))).toBe("**unclosed bold");
    expect(textOf(render("a `unclosed code"))).toBe("a `unclosed code");
    expect(textOf(render("[not a link]"))).toBe("[not a link]");
  });
  it("runs an unterminated fence to the end of the answer, as code", () => {
    const r = render("before\n\n```\nlet a = 1;\n**not bold**\n\nstill code");
    expect(html(r)).toBe(
      '<div class="text md"><p>before</p><pre tabindex="0" role="group" aria-label="Code"><code>let a = 1;\n**not bold**\n\nstill code</code></pre></div>',
    );
  });
  it("closes a fence only with a fence at least as long", () => {
    expect(out("````\n```\ninside\n````\nafter")).toContain(
      "<code>```\ninside</code>",
    );
  });
  it("stops block nesting at a fixed depth: deeper marks are shown as the characters they are", () => {
    const quotes = render("> ".repeat(40) + "deep");
    expect(
      all(quotes).filter((e) => e.tag === "blockquote").length,
    ).toBeLessThanOrEqual(4);
    expect(textOf(quotes)).toContain("deep");
    const lists = render(
      Array.from(
        { length: 40 },
        (_, i) => " ".repeat(i * 2) + "- item " + i,
      ).join("\n"),
    );
    expect(all(lists).filter((e) => e.tag === "ul").length).toBeLessThanOrEqual(
      5,
    );
    expect(textOf(lists)).toContain("item 39");
    const marks = render("*".repeat(1) + "a ".repeat(1) + "_x_ ".repeat(1));
    assertInert(marks, "marks");
  });
  it("stops inline nesting at a fixed depth", () => {
    const md = "*a ".repeat(30) + "x" + " a*".repeat(30);
    const depth = (e: FEl): number =>
      1 +
      Math.max(
        0,
        ...e.kids.filter((k): k is FEl => k instanceof FEl).map(depth),
      );
    expect(depth(render(md))).toBeLessThanOrEqual(10);
    expect(
      depth(render("[a".repeat(200) + "](https://a.org)" + "]".repeat(200))),
    ).toBeLessThanOrEqual(12);
  });
  it("shows an answer over the size limit as one plain paragraph, without parsing it", () => {
    const big = "**x** ".repeat(20_000);
    const r = render(big);
    expect(all(r).filter((e) => e.tag === "p")).toHaveLength(1);
    expect(all(r).some((e) => e.tag === "strong")).toBe(false);
  });

  // Repeated invalid bare addresses once rescanned to the end of the line from every start (quadratic: about 1.1 s at 59 000
  // characters). Linear is a few milliseconds, so this bound is tight on purpose and still safe on a slow machine.
  for (const [name, md] of Object.entries({
    "http://[": "http://[".repeat(7400),
    "https://[": "https://[".repeat(6500),
    "http://a:99999999/": "http://a:99999999/".repeat(3300),
  })) {
    it(`does not rescan a failed bare address: ${name}`, () => {
      const t0 = performance.now();
      assertInert(render(md), name);
      const ms = performance.now() - t0;
      expect(ms, `${name} took ${Math.round(ms)} ms`).toBeLessThan(250);
    });
  }

  // No catastrophic backtracking: each of these is the classic shape that makes a naive regex-based renderer take minutes.
  // They must finish in well under a second each (the bound is generous, so a slow CI machine cannot fail them; a quadratic
  // renderer would take tens of seconds on 50 000 characters).
  const N = 50_000;
  const HOSTILE: Record<string, string> = {
    "unmatched single asterisks": "*a ".repeat(N / 3),
    "unmatched underscores": "_a ".repeat(N / 3),
    "unmatched strikethrough": "~~a ".repeat(N / 4),
    "unmatched triple marks": "***a ".repeat(N / 5),
    "unmatched backticks of every length": Array.from(
      { length: 300 },
      (_, i) => "`".repeat((i % 40) + 1) + "a ",
    )
      .join("")
      .repeat(8),
    "open brackets": "[".repeat(N),
    "open links": "[a](x ".repeat(N / 6),
    "link starts without a close": "[a](".repeat(N / 4),
    "close brackets": "]".repeat(N),
    "nested brackets then parens": "[[[[a](b)](c)](d)]".repeat(N / 18),
    "long address": "[a](" + "x(".repeat(N / 2),
    "repeated invalid http:// starts": "http://[".repeat(7400),
    "repeated invalid https:// starts": "https://[".repeat(6500),
    "repeated invalid port": "http://a:99999999/".repeat(3300),
    "bare addresses": "http://a ".repeat(N / 9),
    "a very long unbroken address": "https://" + "a".repeat(N),
    quotes: "> ".repeat(N / 2),
    "quote lines": ">\n".repeat(N / 2),
    "list markers": "- ".repeat(N / 2),
    "list lines": "- a\n".repeat(N / 4),
    "blank lines inside a list": ("- a\n" + "\n".repeat(50) + "  b\n").repeat(
      N / 60,
    ),
    "indented list ladder": Array.from(
      { length: 400 },
      (_, i) => " ".repeat(i) + "- a",
    ).join("\n"),
    "many blank lines": "\n".repeat(N),
    "many fences": "```\n".repeat(N / 4),
    "a table with no end":
      "| a | b |\n|---|---|\n" + "| c | d |\n".repeat(N / 10),
    "table headers with no separator": "| a | b |\n".repeat(N / 10),
    "separator lookalikes": "|-|-|\n".repeat(N / 6),
    "many pipes": "|".repeat(N),
    headings: "# a\n".repeat(N / 4),
    "hash runs": "#".repeat(N),
    rules: "- - - - ".repeat(N / 8),
    spaces: " ".repeat(N) + "a",
    "trailing hashes": "# a " + "# ".repeat(N / 2),
    escapes: "\\".repeat(N),
  };
  for (const [name, md] of Object.entries(HOSTILE)) {
    it(`is fast on: ${name}`, () => {
      const t0 = performance.now();
      const r = render(md);
      const ms = performance.now() - t0;
      expect(ms, `${name} took ${Math.round(ms)} ms`).toBeLessThan(1500);
      assertInert(r, name);
    });
  }
});
