import { describe, it, expect } from "vitest";
import { extractLinks } from "../../src/crawl/linkExtractor.js";

const BASE = "https://example.com/";

describe("extractLinks", () => {
  it("resolves relative URLs against the base and dedupes", () => {
    const html = `<a href="/a">a</a><a href="/a">a2</a><a href="b">b</a><a href="../c">c</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: true })).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });

  it("rejects non-http(s) schemes (mailto/javascript/ftp)", () => {
    const html =
      `<a href="mailto:x@y.com">m</a>` +
      `<a href="javascript:alert(1)">j</a>` +
      `<a href="ftp://h/f">f</a>` +
      `<a href="/keep">k</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: true })).toEqual([
      "https://example.com/keep",
    ]);
  });

  it("sameDomainOnly drops other hosts (subdomain-strict)", () => {
    const html =
      `<a href="https://other.com/x">o</a>` +
      `<a href="https://www.example.com/y">w</a>` +
      `<a href="/z">z</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: true })).toEqual([
      "https://example.com/z",
    ]);
  });

  it("sameDomainOnly=false keeps other hosts", () => {
    const html = `<a href="https://other.com/x">o</a><a href="/z">z</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: false })).toEqual([
      "https://other.com/x",
      "https://example.com/z",
    ]);
  });

  it("includePatterns (minimatch on pathname) filter; empty array = no constraint", () => {
    const html = `<a href="/docs/a">a</a><a href="/blog/b">b</a><a href="/docs/c">c</a>`;
    expect(
      extractLinks(html, BASE, { sameDomainOnly: true, includePatterns: ["/docs/*"] }),
    ).toEqual(["https://example.com/docs/a", "https://example.com/docs/c"]);
    expect(
      extractLinks(html, BASE, { sameDomainOnly: true, includePatterns: [] }),
    ).toHaveLength(3);
  });

  it("excludePatterns drop matches", () => {
    const html = `<a href="/docs/a">a</a><a href="/blog/b">b</a>`;
    expect(
      extractLinks(html, BASE, { sameDomainOnly: true, excludePatterns: ["/blog/*"] }),
    ).toEqual(["https://example.com/docs/a"]);
  });

  it("strips fragments and dedupes fragment-only differences", () => {
    const html = `<a href="/page#sec1">a</a><a href="/page#sec2">b</a><a href="#top">c</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: true })).toEqual([
      "https://example.com/page",
      "https://example.com/",
    ]);
  });

  it("preserves query strings", () => {
    const html = `<a href="/p?id=1">a</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: true })).toEqual([
      "https://example.com/p?id=1",
    ]);
  });

  it("skips anchors with no href or empty href", () => {
    const html = `<a>nope</a><a href="">empty</a><a href="/ok">ok</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: true })).toEqual([
      "https://example.com/ok",
    ]);
  });

  it("drops malformed hrefs that fail URL resolution", () => {
    const html = `<a href="http://[broken">x</a><a href="/ok">ok</a>`;
    expect(extractLinks(html, BASE, { sameDomainOnly: true })).toEqual([
      "https://example.com/ok",
    ]);
  });
});
