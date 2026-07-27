/** Object-key scheme for crawl-page markdown bodies: `crawl-pages/<crawlId>/<pageId>.md`.
 *  The writer stores raw markdown (no JSON envelope). The key shape is the single
 *  source of truth — DSAR scans and content enumeration rely on it. */
export function objectKeyForCrawlPage(crawlId: string, pageId: number): string {
  return `crawl-pages/${crawlId}/${pageId}.md`;
}

/** Inverse of objectKeyForCrawlPage; returns null for a non-matching key. */
export function parseCrawlPageObjectKey(
  key: string,
): { crawlId: string; pageId: number } | null {
  const match = key.match(/^crawl-pages\/([0-9a-f-]+)\/(\d+)\.md$/);
  if (!match) return null;
  return { crawlId: match[1]!, pageId: Number(match[2]) };
}
