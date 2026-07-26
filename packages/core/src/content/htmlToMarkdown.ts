import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Readability's density-scoring can misjudge small/ambiguous pages and pull
// boilerplate into the "article" it returns (observed directly: a cookie
// banner sibling to <main> ended up inside Readability's output). Stripping
// known-boilerplate elements first is defense-in-depth, not a workaround for
// this one page — sites reliably mark this content with these patterns.
const BOILERPLATE_SELECTOR =
  "nav, footer, header, aside, [role='banner'], [role='navigation'], " +
  "[class*='cookie'], [id*='cookie'], [class*='consent'], [id*='consent'], " +
  "[class*='modal'], [class*='popup'], [class*='newsletter'], " +
  "[class*='subscribe'], [class*='advertisement'], [class*='promo']";

export interface ExtractedContent {
  title: string | null;
  markdown: string;
  text: string;
}

/**
 * Strips boilerplate (nav, footers, cookie banners) via Readability, then
 * converts the remaining main content to Markdown. This is the JS equivalent
 * of Trafilatura, chosen so the whole engine stays on one language/runtime.
 */
export function htmlToMarkdown(html: string, url: string): ExtractedContent {
  const dom = new JSDOM(html, { url });
  dom.window.document
    .querySelectorAll(BOILERPLATE_SELECTOR)
    .forEach((el) => el.remove());

  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content) {
    // Readability couldn't confidently isolate an article (common on short
    // pages). Prefer a semantic <main>/<article> element over the whole
    // <body> so nav/footer/cookie-banner boilerplate isn't dragged in.
    const fallbackEl =
      dom.window.document.querySelector("main, article") ??
      dom.window.document.body;
    const bodyText = fallbackEl?.textContent?.trim() ?? "";
    return {
      title: dom.window.document.title || null,
      markdown: bodyText,
      text: bodyText,
    };
  }

  const markdown = turndown.turndown(article.content).trim();
  return {
    title: article.title ?? null,
    markdown,
    text: (article.textContent ?? "").trim(),
  };
}
