import type { Freshness, SearchBackend, SearchOptions, SearchResponse } from "./searchPort.js";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/** Map from the friendly Freshness vocabulary to Brave's own freshness terms.
 * Exported so a test can assert its keys stay in sync with FRESHNESS_VALUES. */
export const FRESHNESS_TO_BRAVE: Record<Freshness, string> = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py",
};

export class BraveSearchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "BraveSearchError";
  }
}

interface BraveApiResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

interface BraveApiResponse {
  web?: {
    results?: BraveApiResult[];
  };
}

export class BraveSearchAdapter implements SearchBackend {
  constructor(private readonly apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(options.limit ?? 10));
    if (options.freshness) {
      url.searchParams.set("freshness", FRESHNESS_TO_BRAVE[options.freshness]);
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new BraveSearchError(
        `Brave Search API returned ${response.status}`,
        response.status,
      );
    }

    const body = (await response.json()) as BraveApiResponse;
    const results = body.web?.results ?? [];

    return {
      query,
      source: "brave",
      results: results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
        publishedAt: r.age,
      })),
    };
  }
}
