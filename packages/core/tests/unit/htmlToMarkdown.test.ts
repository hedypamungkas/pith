import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../../src/content/htmlToMarkdown.js";
import { SAMPLE_HTML } from "../helpers/testServer.js";

describe("htmlToMarkdown", () => {
  it("strips nav/footer/cookie-banner boilerplate and keeps the article body", () => {
    const { title, markdown } = htmlToMarkdown(
      SAMPLE_HTML,
      "https://example.test/article",
    );

    expect(title).toBe("Sample Article");
    expect(markdown).toContain("real content that should survive extraction");
    expect(markdown).not.toContain("We use cookies");
    expect(markdown).not.toContain("Copyright 2026");
  });

  it("falls back to <main>/<article>/<body> text when Readability finds no article", () => {
    // Only boilerplate, which is stripped first -> Readability sees an empty
    // document -> parse() returns null -> the no-article fallback path runs,
    // preferring a semantic <main>/<article> over the whole <body>.
    const html =
      `<!doctype html><html><head><title>Stub</title></head>` +
      `<body><nav>nav links</nav><footer>foot</footer></body></html>`;
    const { title, markdown } = htmlToMarkdown(html, "https://example.test/stub");
    expect(title).toBe("Stub");
    expect(markdown.trim()).toBe("");
  });
});
