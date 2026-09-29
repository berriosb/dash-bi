// T3 del threat model: validar host del Postgres al configurar data source
// Bloquea: localhost, 127.0.0.1, AWS/GCP metadata endpoints, RFC1918 private IPs

const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',              // AWS / Azure metadata
  'metadata.google.internal',      // GCP metadata
  'metadata.azure.com',            // Azure metadata
]);

const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,             // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/,                // 192.168.0.0/16
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,            // 127.0.0.0/8 (loopback)
  /^169\.254\.\d{1,3}\.\d{1,3}$/,                // 169.254.0.0/16 (link-local)
];

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFError';
  }
}

export function validatePostgresHost(host: string): void {
  if (!host) {
    throw new SSRFError('Host is required');
  }

  const normalized = host.trim().toLowerCase();

  // Check forbidden exact matches
  if (FORBIDDEN_HOSTS.has(normalized)) {
    throw new SSRFError(`Host '${host}' is not allowed`);
  }

  // Check private IP ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new SSRFError(`Host '${host}' is in a private IP range (not allowed)`);
    }
  }

  // Allow public hostnames (DNS will resolve at connect time)
}

// ─────────────────────────────────────────────────────────────────
// Outbound HTTP validation (T3/T6)
//
// `validatePostgresHost` guards DB connections. User-supplied HTTP
// targets (alert webhooks, embed/share callbacks) need the same
// guarantees, plus normalization the DB path never needed: URLs carry a
// port, an optional IPv6 bracket form, and may use the alternate
// inet_aton encodings that glibc's resolver happily accepts.
//
// Scope note: this is a *string-level* control. It does not defeat DNS
// rebinding, where a hostname resolves to a public IP during validation
// and to a private one at connect time. Closing that requires pinning the
// resolved address at connect time (custom lookup in the HTTP agent),
// tracked separately.
// ─────────────────────────────────────────────────────────────────

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Hostnames that mean "this machine" or "this cloud account" regardless
 * of how they are written.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  '0.0.0.0',
  '::',
  '::1',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.com',
]);

export class OutboundUrlError extends SSRFError {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundUrlError';
  }
}

/**
 * Parse a host into a canonical dotted-quad IPv4 string, or null when it
 * is not an IPv4 literal.
 *
 * Handles the inet_aton forms that `dns.lookup` and most HTTP clients
 * accept, all of which are SSRF bypasses when compared as raw strings:
 *   "2130706433"   → 127.0.0.1   (whole address as one decimal)
 *   "127.1"        → 127.0.0.1   (short form)
 *   "0177.0.0.1"   → 127.0.0.1   (octal)
 *   "0x7f.0.0.1"   → 127.0.0.1   (hex)
 */
function parseIpv4Literal(host: string): string | null {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const numbers: number[] = [];
  for (const part of parts) {
    if (part === '') return null;
    let value: number;
    if (/^0x[0-9a-f]+$/.test(part)) {
      value = parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part)) {
      value = parseInt(part.slice(1), 8);
    } else if (/^\d+$/.test(part)) {
      value = Number(part);
    } else {
      return null; // not numeric → a real hostname, not an IP literal
    }
    numbers.push(value);
  }

  // inet_aton permits the final group to carry the remaining low-order
  // bits, so only the leading groups are bounded by 255.
  const lastIndex = numbers.length - 1;
  for (let i = 0; i < lastIndex; i++) {
    const group = numbers[i];
    if (group === undefined || group > 255) return null;
  }
  const last = numbers[lastIndex];
  if (last === undefined || last >= 256 ** (4 - lastIndex)) return null;

  // Left-align into a full 32-bit address.
  let address = 0;
  for (const [index, value] of numbers.entries()) {
    const shift = 8 * (3 - index);
    address += value * 2 ** shift;
  }

  return [24, 16, 8, 0].map((shift) => (address >>> shift) & 0xff).join('.');
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 0) return true;                                   // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                  // RFC1918
  if (a === 127) return true;                                 // loopback
  if (a === 169 && b === 254) return true;                    // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;           // RFC1918
  if (a === 192 && b === 168) return true;                    // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT 100.64/10
  if (a === 192 && b === 0) return true;                      // IETF protocol assignments
  if (a >= 224) return true;                                  // multicast + reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  // `new URL().hostname` keeps IPv6 in brackets; strip them for parsing.
  const address = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (address === '::1' || address === '::') return true;
  if (address.startsWith('fe80')) return true;                // link-local
  if (/^f[cd]/.test(address)) return true;                    // unique-local fc00::/7
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms.
  const embedded = address.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded?.[1]) {
    const literal = parseIpv4Literal(embedded[1]);
    if (literal && isPrivateIpv4(literal)) return true;
  }
  return false;
}

export interface ValidateOutboundUrlOptions {
  /**
   * When provided, the URL must start with one of these prefixes.
   * Used by channels that only ever talk to one vendor (e.g. Slack).
   */
  allowedPrefixes?: string[];
}

/**
 * Validate a user-supplied URL before the server performs a request to it.
 *
 * Throws `OutboundUrlError` for non-HTTP schemes, malformed URLs, an
 * optional allowlist miss, and any host that resolves to loopback,
 * link-local, or RFC1918 space in any of its accepted notations.
 */
export function validateOutboundUrl(
  url: string,
  options: ValidateOutboundUrlOptions = {},
): URL {
  if (!url || typeof url !== 'string') {
    throw new OutboundUrlError('URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new OutboundUrlError(`URL '${url}' is not a valid URL`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new OutboundUrlError(
      `Protocol '${parsed.protocol}' is not allowed (only http/https)`,
    );
  }

  const { allowedPrefixes } = options;
  if (allowedPrefixes && allowedPrefixes.length > 0) {
    const full = parsed.toString();
    const permitted = allowedPrefixes.some((prefix) => full.startsWith(prefix));
    if (!permitted) {
      throw new OutboundUrlError(`URL '${url}' is not in the allowed host list`);
    }
  }

  // Resolve alternate IPv4 notations before comparing, so "2130706433"
  // and "127.0.0.1" are recognized as the same loopback address.
  const literal = parseIpv4Literal(parsed.hostname);
  const effectiveHost = literal ?? parsed.hostname;

  if (BLOCKED_HOSTNAMES.has(effectiveHost) || BLOCKED_HOSTNAMES.has(parsed.hostname)) {
    throw new OutboundUrlError(`Host '${url}' is not allowed`);
  }
  if (literal !== null && isPrivateIpv4(literal)) {
    throw new OutboundUrlError(`Host '${url}' resolves to a private address (not allowed)`);
  }
  if (isPrivateIpv6(parsed.hostname)) {
    throw new OutboundUrlError(`Host '${url}' resolves to a private address (not allowed)`);
  }

  return parsed;
}