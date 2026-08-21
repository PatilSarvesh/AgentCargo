/** Reject explicit cross-origin browser mutations while allowing server tests/calls without Origin. */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin" || fetchSite === "none";
}
