// Single source of truth for the engine's bot identity. The robots.txt
// token matches the directives against the same UA actually sent, so a
// site's robots rule and the request that hits it always agree on who's
// asking.
export const USER_AGENT = "pith-bot/0.1 (+https://example.invalid/bot)";
export const ROBOTS_USER_AGENT_TOKEN = "pith-bot";
