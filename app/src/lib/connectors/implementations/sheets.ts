import { google } from 'googleapis';
import { decryptApiKey } from '@/lib/security/encryption';
import type { Connector, ConnectorConfig, ConnectorSchema, Query, QueryResult } from '../types';

export type SheetsConfig = {
  refreshTokenEncrypted: string;
  spreadsheetId: string;
  sheetNames: string[];
};

export class SheetsConnector implements Connector {
  type = 'sheets' as const;
  private sheets: ReturnType<typeof google.sheets>;
  private config: SheetsConfig;

  constructor(connectorConfig: ConnectorConfig) {
    const raw = decryptApiKey(connectorConfig.configEncrypted);
    this.config = JSON.parse(raw) as SheetsConfig;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    oauth2Client.setCredentials({
      refresh_token: decryptApiKey(this.config.refreshTokenEncrypted),
    });

    this.sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId,
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, error: msg };
    }
  }

  async getSchema(): Promise<ConnectorSchema> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
    });

    const sheets =
      response.data.sheets?.filter((s) =>
        this.config.sheetNames.includes(s.properties?.title || ''),
      ) || [];

    const tables = [];

    for (const sheet of sheets) {
      const title = sheet.properties?.title || 'Untitled';

      const data = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${title}!A1:Z2`,
      });

      const rows = data.data.values || [];
      const headers: string[] = rows[0] || [];
      const sampleRow: unknown[] = rows[1] || [];

      tables.push({
        name: title,
        columns: headers.map((h, i) => ({
          name: h,
          type: inferType(String(sampleRow[i] ?? '')),
        })),
      });
    }

    return { tables };
  }

  async executeQuery<T = Record<string, unknown>>(query: Query): Promise<QueryResult<T>> {
    if (query.kind !== 'sheets') {
      throw new Error('Sheets connector only supports sheet queries');
    }

    const start = Date.now();

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${query.spreadsheetId}!${query.range}`,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) return { rows: [], rowCount: 0, executionTimeMs: Date.now() - start };

    const headers: string[] = rows[0] as string[];
    const dataRows = rows.slice(1).map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] ?? null;
      });
      return obj;
    });

    return {
      rows: dataRows as T[],
      rowCount: dataRows.length,
      executionTimeMs: Date.now() - start,
      truncated: dataRows.length >= 10000,
    };
  }
}

function inferType(value: string): string {
  if (!value) return 'string';
  if (/^\d+$/.test(value)) return 'number';
  if (/^\d+\.\d+$/.test(value)) return 'number';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'string';
}
