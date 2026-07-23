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