import { decryptApiKey } from '@/lib/security/encryption';
import { validateQuery } from '@/lib/security/validate-query';
import { validatePostgresHost, SSRFError } from '@/lib/security/validate-connection';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

export type SnowflakeConfig = {
  account: string;
  username: string;
  password: string;
  database: string;
  schema: string;
  warehouse: string;
};

/**
 * Snowflake connector (Tier 2).
 *
 * Uses the Snowflake SQL API (REST endpoint at
 * `https://<account>.snowflakecomputing.com/api/v2/statements`). The
 * REST endpoint is preferable to the native SDK for a self-hosted
 * Node.js deploy because (a) it ships as a plain `fetch` call, (b) no
 * native binding to install, and (c) it has the same SQL semantics
 * users already know from the Postgres/MySQL connectors.
 *
 * The `account` value is user-supplied so we SSRF-validate it
 * (`validatePostgresHost` blocks private IPs and metadata endpoints,
 * T6). Auth is HTTP Basic with `username:password`. The Authorization
 * header is constructed per-request; plaintext credentials never
 * reach logs (T5) and the password is encrypted at rest via BYOK (T4).
 *
 * The Snowflake SQL API requires `database`, `schema`, and `warehouse`
 * to scope every statement — we send them in the request body from the
 * decrypted connector config.
 */
export class SnowflakeConnector implements Connector {
  type = 'snowflake' as const;

  private readonly config: SnowflakeConfig;

  constructor(connectorConfig: ConnectorConfig) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decryptApiKey(connectorConfig.configEncrypted));
    } catch {
      throw new Error('Invalid Snowflake connector configuration');
    }

    const candidate = parsed as Partial<SnowflakeConfig>;
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid Snowflake connector configuration');
    }

    // SSRF validation of the account subdomain BEFORE doing anything
    // else, so a bad host short-circuits before we touch credentials.
    if (typeof candidate.account !== 'string' || candidate.account.length === 0) {
      throw new Error('Snowflake account is required');
    }
    try {
      validatePostgresHost(candidate.account);
    } catch (err) {
      if (err instanceof SSRFError) throw err;
      throw new SSRFError(`Invalid Snowflake account: ${(err as Error).message}`);
    }

    for (const field of ['username', 'password', 'database', 'schema', 'warehouse'] as const) {
      if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
        throw new Error(`Snowflake ${field} is required`);
      }
    }

    this.config = {
      account: candidate.account!,
      username: candidate.username!,
      password: candidate.password!,
      database: candidate.database!,
      schema: candidate.schema!,
      warehouse: candidate.warehouse!,
    };
  }

  private get endpoint(): string {
    return `https://${this.config.account}.snowflakecomputing.com/api/v2/statements`;
  }

  private get authHeader(): string {
    const credentials = `${this.config.username}:${this.config.password}`;
    // Buffer is available in both Node and Edge runtimes (the latter
    // via undici).
    const encoded =
      typeof Buffer !== 'undefined'
        ? Buffer.from(credentials, 'utf8').toString('base64')
        : btoa(credentials);
    return `Basic ${encoded}`;
  }

  private get scoping(): { database: string; schema: string; warehouse: string } {
    return {
      database: this.config.database,
      schema: this.config.schema,
      warehouse: this.config.warehouse,
    };
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          statement: 'SELECT 1 AS ok',
          ...this.scoping,
          timeout: 10,
        }),
      });

      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Snowflake API status ${res.status}: ${res.statusText}`,
        };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, error: msg };
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    // MVP slice: real introspection (SHOW TABLES / information_schema)
    // requires a second round-trip with a parameterised statement and
    // is a follow-up. Returning an empty schema keeps the contract
    // (Connector.getSchema is async) and lets the AI prompt degrade
    // gracefully to "describe your data" mode.
    return { tables: [] };
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    validateQuery(query, 'snowflake');

    if (query.kind !== 'sql') {
      // validateQuery() above would already have rejected this; the
      // exhaustive check keeps the union narrow at runtime.
      throw new Error('Snowflake expects a SQL query');
    }

    const start = Date.now();
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        statement: query.sql,
        ...this.scoping,
        timeout: 60,
      }),
    });

    if (!res.ok) {
      throw new Error(`Snowflake query failed with HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      resultSetMetaData?: { rowType?: Array<{ name: string; type?: string }> };
      data?: string[][];
    };

    const columns = body.resultSetMetaData?.rowType ?? [];
    const rowsArr = body.data ?? [];

    const rows = rowsArr.map((arr) => {
      const flat: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        flat[col.name] = arr[i] ?? null;
      });
      return flat as T;
    });

    return {
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - start,
    };
  }
}