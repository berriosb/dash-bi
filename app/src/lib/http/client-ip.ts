/**
 * Resolve the client IP of a request.
 *
 * ## Why this is not `x-forwarded-for.split(',')[0]`
 *
 * The documented deployment puts nginx in front of the app
 * (`deploy/nginx/dash-bi.conf`):
 *
 * ```nginx
 * proxy_set_header X-Real-IP       $remote_addr;
 * proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 * ```
 *
 * `$proxy_add_x_forwarded_for` APPENDS the real peer to whatever list the
 * caller sent, so the FIRST hop of `x-forwarded-for` is the client-controlled
 * one and the LAST hop is the one the trusted proxy vouched for. Reading the
 * first hop let a caller mint a fresh rate-limit bucket per request, and
 * recorded the forged address in `audit_log.ip`.
 *
 * ## Trust boundary — read before trusting the result
 *
 * This helper is only trustworthy BEHIND the documented reverse proxy:
 *
 * - `X-Real-IP` is set to `$remote_addr`, which OVERWRITES any client-supplied
 *   value, so it cannot be forged when the proxy is in front.
 * - `X-Forwarded-For` is only as trustworthy as its LAST hop, and only
 *   because the proxy appends that hop itself.
 *
 * In a topology WITHOUT a proxy (the current `docker-compose` publishes the
 * app directly) there is NO reliable client IP: every header value is
 * caller-controlled, and this helper can only return the caller's word. That
 * is precisely why the ORG bucket — not the IP bucket — is the security
 * guarantee the threat model asks for ("rate limit per org"). Every limited
 * route therefore checks an org bucket AND an IP bucket independently: the org
 * bucket holds when the IP cannot be trusted, and the IP bucket still blunts
 * a single noisy client in the topologies where it can be trusted.
 *
 * @param req The incoming request.
 * @returns The resolved client IP, or `'unknown'` when no header carries one.
 */
export function getClientIp(req: Request): string {
  // nginx overwrites this header with $remote_addr, so it is the strongest
  // signal available and it wins over the forwarded list.
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  // The last hop is the one a trusted proxy appended; the earlier ones are
  // whatever the caller wrote.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const hops = forwardedFor
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    const lastHop = hops[hops.length - 1];
    if (lastHop) return lastHop;
  }

  return 'unknown';
}
