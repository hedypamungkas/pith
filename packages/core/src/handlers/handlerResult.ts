export interface HandlerResult {
  requestId: string;
  body?: Record<string, unknown>;
  error?: string;
  errorKind?: "client" | "upstream" | "capExceeded" | "notConfigured";
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
