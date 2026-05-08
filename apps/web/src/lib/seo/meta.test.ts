/**
 * buildMeta builds canonical, OG, and brand-aware titles. These tests
 * pin the contract the layout relies on: title gets " | Shamwari AI"
 * suffix unless it already contains the brand, canonical resolves
 * against the configured site, defaults are filled.
 */

import { describe, expect, it } from "vitest";
import { SITE, buildMeta } from "./meta";

describe("buildMeta", () => {
  it("appends brand to titles that don't contain it", () => {
    const meta = buildMeta({ pathname: "/", title: "Pricing" });
    expect(meta.title).toBe("Pricing | Shamwari AI");
  });

  it("leaves titles that already contain the brand alone", () => {
    const meta = buildMeta({
      pathname: "/",
      title: "About Shamwari AI",
    });
    expect(meta.title).toBe("About Shamwari AI");
  });

  it("falls back to brand when no title is given", () => {
    const meta = buildMeta({ pathname: "/" });
    expect(meta.title).toBe(SITE.brand);
  });

  it("resolves canonical against the site origin", () => {
    const meta = buildMeta({ pathname: "/about" });
    expect(meta.canonical).toBe(`${SITE.url}/about`);
  });

  it("defaults description to the site default", () => {
    const meta = buildMeta({ pathname: "/about" });
    expect(meta.description).toBe(SITE.defaultDescription);
  });

  it("propagates noindex and ogType", () => {
    const meta = buildMeta({
      pathname: "/staging",
      noindex: true,
      ogType: "article",
    });
    expect(meta.noindex).toBe(true);
    expect(meta.ogType).toBe("article");
  });
});
