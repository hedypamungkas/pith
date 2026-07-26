// Single source of truth for the engine's bot identity. The robots.txt
// token matches the directives against the same UA actually sent, so a
// site's robots rule and the request that hits it always agree on who's
// asking.
//
// TODO(rebrand): carry a Pith-branded UA once the OSS identity is finalized;
// today this mirrors the source project verbatim to keep behavior identical.
export const USER_AGENT = "web-for-llms-bot/0.1 (+https://example.invalid/bot)";
export const ROBOTS_USER_AGENT_TOKEN = "web-for-llms-bot";
