const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Fixture mode is intentionally opt-in through two local variables. It must never
 * be used as a substitute for production authentication or market-data access.
 */
export function isLocalFixtureMode() {
  return process.env.ALPHALENS_LOCAL_DEVELOPMENT === "true" && process.env.ALPHALENS_FIXTURE_MODE === "true";
}

export function isLoopbackRequest(request: Request) {
  try { return LOOPBACK_HOSTS.has(new URL(request.url).hostname); } catch { return false; }
}

export function isLocalFixtureRequest(request: Request) {
  return isLocalFixtureMode() && isLoopbackRequest(request);
}

export function localFixtureUser(request: Request) {
  if (!isLocalFixtureRequest(request)) return null;
  const email = process.env.ALPHALENS_LOCAL_AUTH_EMAIL?.trim().toLowerCase();
  if (!email || !email.endsWith(".invalid")) return null;
  return {
    email,
    displayName: process.env.ALPHALENS_LOCAL_AUTH_NAME?.trim() || "Local Developer",
    fullName: process.env.ALPHALENS_LOCAL_AUTH_NAME?.trim() || null,
  };
}
