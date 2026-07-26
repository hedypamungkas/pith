import { JSDOM } from "jsdom";
import { minimatch } from "minimatch";

export interface LinkExtractionOptions {
  sameDomainOnly: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
}

/**
 * Extracts absolute, deduped, in-bounds outbound links from a fetched page's
 * HTML. Fragment-only differences are collapsed (the same page shouldn't be
 * queued twice just because two links point at different anchors on it).
 */
export function extractLinks(
  html: string,
  baseUrl: string,
  options: LinkExtractionOptions,
): string[] {
  const dom = new JSDOM(html, { url: baseUrl });
  const base = new URL(baseUrl);
  const links = new Set<string>();

  dom.window.document.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href) return;

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }

    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (options.sameDomainOnly && resolved.hostname !== base.hostname) return;

    const path = resolved.pathname;
    if (
      options.includePatterns?.length &&
      !options.includePatterns.some((pattern) => minimatch(path, pattern))
    ) {
      return;
    }
    if (options.excludePatterns?.some((pattern) => minimatch(path, pattern))) {
      return;
    }

    resolved.hash = "";
    links.add(resolved.toString());
  });

  return [...links];
}
