/**
 * A small, safe markdown renderer for ASSISTANT answers (nothing a person types goes through it).
 *
 * An answer is untrusted text. Everything here builds DOM with createElement and append(string) (a text node), never
 * innerHTML, and there is no HTML pass-through: a "<script>" in an answer is shown as the characters it is. Links are
 * allowed only for http:, https: and mailto: (checked by parsing the address, so "java\nscript:" and friends fail),
 * open in a new tab with rel="noopener noreferrer", and an image is drawn as its alt text.
 *
 * It is linear in the size of the answer: no lookbehind, no backtracking-prone pattern (every pattern is anchored, and none can
 * match the same characters two ways, so a pattern's cost is linear in the line), every search that can fail is remembered so it is not repeated, block nesting stops at
 * MAX_BLOCK and inline nesting at MAX_INLINE (deeper marks are shown as the characters they are), and an answer over
 * MAX_CHARS is shown as one plain paragraph rather than parsed.
 *
 * Supported: **bold**, *italic*, ~~struck~~, `code`, fenced code (an unterminated fence runs to the end), # headings,
 * - and 1. lists (nested), > quotes, --- rules, [links](https://...), bare https:// addresses and | tables |.
 */
const MAX_CHARS = 60_000;
const MAX_BLOCK = 4;
const MAX_INLINE = 5;

type Kid = Node | string;
function mk<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

/** An address a person may be sent to: http(s) and mailto only. Anything else (javascript:, data:, a relative path) is null. */
export function safeHref(u: string): string | null {
  try {
    const x = new URL(u);
    return x.protocol === "http:" ||
      x.protocol === "https:" ||
      x.protocol === "mailto:"
      ? x.href
      : null;
  } catch {
    return null;
  }
}

const isAlnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => !c || c.trim() === "";

function link(href: string, text: Kid[]): HTMLAnchorElement {
  const a = mk("a", "", ...text);
  a.setAttribute("href", href);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer");
  return a;
}

/** The marks inside one run of text: code, links, emphasis, line breaks. */
function inline(s: string, out: Element, d: number, noLink = false): void {
  const n = s.length;
  let buf = "";
  let i = 0;
  const fail: Record<string, number> = {}; // a search from here on found nothing, so a later one cannot either
  let noAuto = 0; // a bare address that failed ran to here: another start inside the same run is not tried again
  let match: number[] | undefined; // [ -> its ]
  const flush = () => {
    if (buf) out.append(buf);
    buf = "";
  };
  const run = (at: number, c: string) => {
    let e = at;
    while (s[e] === c) e++;
    return e - at;
  };
  while (i < n) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < n) {
      const x = s[i + 1]!;
      if (x === "\n") {
        flush();
        out.append(mk("br"));
      } else buf += /[!-/:-@[-`{-~]/.test(x) ? x : c + x;
      i += 2;
    } else if (c === "\n") {
      flush();
      out.append(mk("br"));
      i++;
    } else if (c === "`") {
      const k = run(i, c);
      let j = i + k;
      const key = "`" + k;
      let found = -1;
      if (!(key in fail)) {
        while (j < n) {
          if (s[j] === c) {
            const r = run(j, c);
            if (r === k) {
              found = j;
              break;
            }
            j += r;
          } else j++;
        }
        if (found < 0) fail[key] = i;
      }
      if (found < 0) {
        buf += s.slice(i, i + k);
        i += k;
      } else {
        let code = s.slice(i + k, found).replace(/\n/g, " ");
        if (
          code.length > 2 &&
          code[0] === " " &&
          code.endsWith(" ") &&
          code.trim()
        )
          code = code.slice(1, -1);
        flush();
        out.append(mk("code", "", code));
        i = found + k;
      }
    } else if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      const img = c === "!";
      const open = img ? i + 1 : i;
      if (!match) {
        match = [];
        const st: number[] = [];
        for (let k = 0; k < n; k++) {
          const ch = s[k];
          if (ch === "\\") k++;
          else if (ch === "[") st.push(k);
          else if (ch === "]" && st.length) match[st.pop()!] = k;
        }
      }
      const close = match[open];
      let end = -1;
      let dest = "";
      if (close !== undefined && s[close + 1] === "(") {
        let q = close + 2;
        let depth = 0;
        const lim = Math.min(n, q + 2048);
        for (; q < lim; q++) {
          const ch = s[q]!;
          if (ch <= " ") break;
          if (ch === "(") depth++;
          else if (ch === ")") {
            if (!depth) break;
            depth--;
          }
        }
        dest = s.slice(close + 2, q);
        if (s[q] === ")") end = q + 1;
        else if (q < n && s[q]! <= " ") {
          // [text](url "title"): only a real title, then the closing ")", makes a link. Anything else is not a link and its
          // words stay as they are (a title is dropped; nothing else is ever dropped).
          let k = q;
          while (k < n && k < q + 8 && s[k]! <= " ") k++;
          const o = s[k];
          const cl = o === '"' ? '"' : o === "'" ? "'" : o === "(" ? ")" : "";
          if (cl) {
            const lim = Math.min(n, k + 200);
            let m = k + 1;
            while (m < lim && s[m] !== cl) m++;
            if (s[m] === cl) {
              let e = m + 1;
              while (e < n && e < m + 9 && s[e]! <= " ") e++;
              if (s[e] === ")") end = e + 1;
            }
          }
        }
      }
      if (end < 0 || d >= MAX_INLINE) {
        buf += s.slice(i, open + 1);
        i = open + 1;
      } else {
        const text = s.slice(open + 1, close);
        flush();
        if (img)
          out.append(text); // no images: the alt text stands for it
        else {
          const href = noLink ? null : safeHref(dest.replace(/^<|>$/g, ""));
          if (href) {
            const a = link(href, []);
            inline(text, a, d + 1, true);
            out.append(a);
          } else inline(text, out, d + 1, true); // a link that is not allowed is just its words
        }
        i = end;
      }
    } else if (c === "*" || c === "_" || c === "~") {
      const k = run(i, c);
      const next = s[i + k];
      const key = c + k;
      let found = -1;
      const ok =
        k <= 3 &&
        (c !== "~" || k === 2) &&
        d < MAX_INLINE &&
        !isSpace(next) &&
        !(c === "_" && isAlnum(s[i - 1])) &&
        !(key in fail);
      if (ok) {
        for (let j = i + k; j < n;) {
          if (s[j] === "\\") j += 2;
          else if (s[j] === c) {
            const r = run(j, c);
            if (
              r === k &&
              !isSpace(s[j - 1]) &&
              !(c === "_" && isAlnum(s[j + r]))
            ) {
              found = j;
              break;
            }
            j += r;
          } else j++;
        }
        if (found < 0) fail[key] = i;
      }
      if (found < 0) {
        buf += s.slice(i, i + k);
        i += k;
      } else {
        flush();
        const inner = s.slice(i + k, found);
        const e = mk(c === "~" ? "del" : k === 1 ? "em" : "strong");
        if (k === 3) {
          const em = mk("em");
          inline(inner, em, d + 1, noLink);
          e.append(em);
        } else inline(inner, e, d + 1, noLink);
        out.append(e);
        i = found + k;
      }
    } else if (
      c === "h" &&
      !noLink &&
      (s.startsWith("http://", i) || s.startsWith("https://", i)) &&
      i >= noAuto &&
      !isAlnum(s[i - 1])
    ) {
      let j = i;
      while (j < n && s[j]! > " " && s[j] !== "<" && s[j] !== ">") j++;
      while (j > i && ".,;:!?)]'\"*_".includes(s[j - 1]!)) j--;
      const href = safeHref(s.slice(i, j));
      if (href) {
        flush();
        out.append(link(href, [s.slice(i, j)]));
        i = j;
      } else {
        noAuto = j;
        buf += s[i++];
      }
    } else {
      buf += c;
      i++;
    }
  }
  flush();
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^( *)(?:([-*+])|(\d{1,9})[.)])[ \t]+(\S.*)?$/;
const SEP = /^:?-+:?$/;

/** A line that ends a paragraph, because a new block starts on it. */
const interrupts = (l: string): boolean => {
  const m = ITEM.exec(l);
  return (
    FENCE.test(l) ||
    ATX.test(l) ||
    HR.test(l) ||
    QUOTE.test(l) ||
    (!!m && (!m[3] || m[3] === "1"))
  );
};

function cells(line: string): string[] {
  const t = line.trim();
  const out: string[] = [];
  let cur = "";
  for (let i = t[0] === "|" ? 1 : 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim() || t[t.length - 1] !== "|") out.push(cur.trim());
  return out;
}

interface State {
  lv: number;
  code: string; // the accessible names of the scrolling boxes, in the answer's language
  table: string;
}

function blocks(
  L: string[],
  out: HTMLElement,
  d: number,
  st: State,
  tight = false,
): void {
  const n = L.length;
  let i = 0;
  let first = true;
  while (i < n) {
    const line = L[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const deep = d >= MAX_BLOCK;
    let m: RegExpExecArray | null;
    let node: HTMLElement | null = null;
    if (
      !deep &&
      (m = FENCE.exec(line)) &&
      !(m[1]![0] === "`" && line.slice(m[0].length).includes("`"))
    ) {
      const f = m[1]!;
      const body: string[] = [];
      for (i++; i < n; i++) {
        const c = FENCE.exec(L[i]!);
        if (
          c &&
          c[1]![0] === f[0] &&
          c[1]!.length >= f.length &&
          !L[i]!.slice(c[0].length).trim()
        )
          break;
        body.push(L[i]!);
      }
      i++; // the closing fence; or past the end, when it never came
      node = mk("pre", "", mk("code", "", body.join("\n")));
      node.setAttribute("tabindex", "0"); // a scrolling box can be reached and scrolled with a keyboard
      node.setAttribute("role", "group");
      node.setAttribute("aria-label", st.code);
    } else if (!deep && (m = ATX.exec(line))) {
      let t = (m[2] ?? "").trim();
      let e = t.length;
      while (e > 0 && t[e - 1] === "#") e--;
      if (e < t.length && (e === 0 || t[e - 1] === " "))
        t = t.slice(0, e).trim();
      i++;
      if (t) {
        // The page's own outline is h1 (the chat) and h2 (Sources): an answer's headings are styled paragraphs that
        // start at level 2 and never skip a level, so they cannot break it.
        const lv = Math.min(m[1]!.length + 1, st.lv + 1, 6);
        st.lv = lv;
        node = mk("p", "md-h md-h" + Math.min(m[1]!.length, 3));
        node.setAttribute("role", "heading");
        node.setAttribute("aria-level", String(lv));
        inline(t, node, 0);
      }
    } else if (!deep && HR.test(line)) {
      i++;
      node = mk("hr");
    } else if (!deep && QUOTE.test(line)) {
      const q: string[] = [];
      for (; i < n && QUOTE.test(L[i]!); i++) q.push(L[i]!.replace(QUOTE, ""));
      node = mk("blockquote");
      blocks(q, node, d + 1, st);
    } else if (!deep && (m = ITEM.exec(line))) {
      const ordered = !!m[3];
      const base = m[1]!.length;
      const list = mk(ordered ? "ol" : "ul");
      if (ordered && m[3] !== "1") list.setAttribute("start", m[3]!);
      while (i < n) {
        const it = ITEM.exec(L[i]!);
        if (!it || !!it[3] !== ordered || it[1]!.length >= base + 2) break;
        const body: string[] = [it[4] ?? ""];
        let j = i + 1;
        while (j < n) {
          const l = L[j]!;
          if (!l.trim()) {
            let k = j;
            while (k < n && !L[k]!.trim()) k++;
            if (k < n && L[k]!.length - L[k]!.trimStart().length >= base + 2) {
              for (; j < k; j++) body.push("");
              continue;
            }
            break;
          }
          const ind = l.length - l.trimStart().length;
          if (ind >= base + 2) body.push(l.slice(base + 2));
          else if (ITEM.test(l) || interrupts(l) || !L[j - 1]!.trim()) break;
          else body.push(l); // a line that carries on the item's sentence
          j++;
        }
        const li = mk("li");
        blocks(body, li, d + 1, st, true);
        list.append(li);
        i = j;
        let k = i;
        while (k < n && !L[k]!.trim()) k++;
        const nx = k < n ? ITEM.exec(L[k]!) : null;
        if (nx && !!nx[3] === ordered && nx[1]!.length < base + 2) i = k; // a blank line between items does not end the list
      }
      node = list;
    } else if (
      !deep &&
      line.includes("|") &&
      i + 1 < n &&
      L[i + 1]!.includes("-") &&
      cells(L[i + 1]!).every((c) => SEP.test(c)) &&
      cells(L[i + 1]!).length === cells(line).length
    ) {
      const head = cells(line);
      const align = cells(L[i + 1]!).map((c) =>
        c.endsWith(":") ? (c.startsWith(":") ? "md-c" : "md-r") : "",
      );
      const row = (cs: string[], tag: "th" | "td") => {
        // Appended one by one: a row of tens of thousands of cells must not be spread into one call's arguments (a phone's
        // JavaScript engine allows about 65 000).
        const tr = mk("tr");
        cs.forEach((c, k) => {
          const cell = mk(tag, align[k] ?? "");
          if (tag === "th") cell.setAttribute("scope", "col");
          inline(c, cell, 0);
          tr.append(cell);
        });
        return tr;
      };
      const body = mk("tbody");
      for (i += 2; i < n && L[i]!.trim() && L[i]!.includes("|"); i++)
        body.append(row(cells(L[i]!), "td"));
      const wrap = mk(
        "div",
        "md-table",
        mk("table", "", mk("thead", "", row(head, "th")), body),
      );
      wrap.setAttribute("tabindex", "0");
      wrap.setAttribute("role", "group"); // a named group, not a landmark: several tables can share a name
      wrap.setAttribute("aria-label", st.table);
      // a table wider than the screen scrolls inside its own box
      node = wrap;
    } else {
      const para = [line.trimStart()];
      for (i++; i < n && L[i]!.trim() && (deep || !interrupts(L[i]!)); i++)
        para.push(L[i]!.trimStart());
      const host = tight && first ? out : mk("p");
      inline(para.join("\n"), host, 0);
      if (host !== out) node = host;
    }
    if (node) out.append(node);
    first = false;
  }
}

/** The answer's formatted body: one block-level container, ready to sit where the plain-text paragraph was. */
export function renderMarkdown(
  raw: string,
  names = { code: "Code", table: "Table" },
): HTMLElement {
  const root = mk("div", "text md");
  const src = raw.replace(/\r\n?/g, "\n").trim();
  if (src.length > MAX_CHARS) root.append(mk("p", "md-raw", src));
  else blocks(src.split("\n"), root, 0, { lv: 1, ...names });
  return root;
}
