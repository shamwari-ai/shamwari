/**
 * JSON-LD builders shape the brand entity for answer engines. These
 * tests pin the @type and required Schema.org fields so refactors
 * can't silently drop them.
 */

import { describe, expect, it } from "vitest";
import {
  article,
  breadcrumb,
  faqPage,
  shamwariOrganization,
  shamwariSoftwareApplication,
  shamwariWebSite,
  techArticle,
} from "./jsonld";

describe("site-wide builders", () => {
  it("Organization has brand fields and parentOrganization", () => {
    const org = shamwariOrganization();
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe("Shamwari AI");
    expect(org.parentOrganization).toBeTruthy();
  });

  it("WebSite has SearchAction", () => {
    const site = shamwariWebSite();
    expect(site["@type"]).toBe("WebSite");
    expect(site.potentialAction).toBeTruthy();
  });

  it("SoftwareApplication has Offers", () => {
    const app = shamwariSoftwareApplication();
    expect(app["@type"]).toBe("SoftwareApplication");
    expect(Array.isArray(app.offers)).toBe(true);
  });
});

describe("page-level builders", () => {
  it("breadcrumb produces ListItem positions", () => {
    const crumbs = breadcrumb([
      { name: "Home", url: "/" },
      { name: "Docs", url: "/docs" },
    ]);
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect((crumbs.itemListElement as { position: number }[])[1].position).toBe(2);
  });

  it("faqPage produces Question + Answer entities", () => {
    const faq = faqPage([{ question: "What?", answer: "A thing." }]);
    expect(faq["@type"]).toBe("FAQPage");
    expect((faq.mainEntity as { name: string }[])[0].name).toBe("What?");
  });

  it("article includes datePublished and Person author", () => {
    const a = article({
      headline: "x",
      description: "y",
      url: "https://shamwari.ai/x",
      datePublished: "2026-05-06",
      authorName: "Bryan",
    });
    expect(a["@type"]).toBe("Article");
    expect(a.datePublished).toBe("2026-05-06");
  });

  it("techArticle defaults proficiencyLevel", () => {
    const a = techArticle({
      headline: "x",
      description: "y",
      url: "https://shamwari.ai/d",
      datePublished: "2026-05-06",
    });
    expect(a.proficiencyLevel).toBe("Beginner");
  });
});
