export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  /** ISO timestamp if the backend reports one. */
  publishedAt?: string;
}

export interface SearchResponse {
  query: string;
  source: string;
  results: SearchResultItem[];
}

/** Friendly vocabulary decoupled from any one backend's own freshness terms
 * (e.g. Brave's pd/pw/pm/py) — a future backend swap shouldn't need callers to
 * change what they send. The single source of truth for these values: both the
 * Brave adapter's mapping table and route request validation derive from this
 * array, so adding a value here can't silently drift out of sync. */
export const FRESHNESS_VALUES = ["day", "week", "month", "year"] as const;
export type Freshness = (typeof FRESHNESS_VALUES)[number];

export interface SearchOptions {
  limit?: number;
  freshness?: Freshness;
}

/**
 * Port for a search backend. The OSS canonical adapter is Brave; this interface
 * exists so that choice can be revisited without touching callers.
 */
export interface SearchBackend {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}
