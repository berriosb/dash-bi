import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MysqlConnector } from '@/lib/connectors/implementations/mysql';
import { encryptApiKey } from '@/lib/security/encryption';
import { SSRFError } from '@/lib/security/validate-connection';

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT 1 as ok')) {
          return [[{ ok: 1 }]];
        }
        if (sql.includes('information_schema.tables')) {
          return [
            [
              { table_name: 'users', table_comment: 'User accounts' },
              { table_name: 'orders', table_comment: 'Order records' },
            ],
          ];
        }
        if (sql.includes('information_schema.columns')) {
          return [
            [
              { table_name: 'users', column_name: 'id', data_type: 'varchar', is_nullable: 'NO' },
              { table_name: 'users', column_name: 'email', data_type: 'varchar', is_nullable: 'NO' },
              { table_name: 'orders', column_name: 'id', data_type: 'int', is_nullable: 'NO' },
              { table_name: 'orders', column_name: 'total', data_type: 'decimal', is_nullable: 'YES' },
            ],
          ];
        }
        if (sql.toLowerCase().includes('select * from users')) {
          return [
            [
              { id: 'usr_1', email: 'alice@example.com' },
              { id: 'usr_2', email: 'bob@example.com' },
            ],
          ];
        }
        return [[]];
      }),
      end: vi.fn(async () => {}),
    })),
  },
}));

describe('MysqlConnector', () => {
  const validConfig = {
    host: 'db.external-mysql.com',
    port: 3306,
    database: 'production_db',
    username: 'readonly_user',
    password: 'secret_password_123',
    ssl: true,
  };

  const connectorConfig = {
    id: 'conn_mysql_1',
    orgId: 'org_test_1',
    type: 'mysql' as const,
    name: 'MySQL Producción',
    configEncrypted: encryptApiKey(JSON.stringify(validConfig)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects connection to forbidden SSRF hosts (e.g. localhost or 169.254.169.254)', () => {
    const dangerousConfig = { ...validConfig, host: '127.0.0.1' };
    const dangerousConnectorConfig = {
      ...connectorConfig,
      configEncrypted: encryptApiKey(JSON.stringify(dangerousConfig)),
    };

    expect(() => new MysqlConnector(dangerousConnectorConfig)).toThrow(SSRFError);
  });

  it('successfully tests connection', async () => {
    const connector = new MysqlConnector(connectorConfig);
    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('fetches schema from information_schema', async () => {
    const connector = new MysqlConnector(connectorConfig);
    const schema = await connector.getSchema();

    expect(schema.tables.length).toBe(2);
    expect(schema.tables[0]?.name).toBe('users');
    expect(schema.tables[0]?.columns.length).toBe(2);
    expect(schema.tables[1]?.name).toBe('orders');
  });

  it('executes valid SELECT query', async () => {
    const connector = new MysqlConnector(connectorConfig);
    const result = await connector.executeQuery({
      kind: 'sql',
      sql: 'SELECT * FROM users',
    });

    expect(result.rows.length).toBe(2);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toEqual({ id: 'usr_1', email: 'alice@example.com' });
  });

  it('rejects non-SELECT or dangerous SQL queries (e.g. DROP TABLE or SLEEP)', async () => {
    const connector = new MysqlConnector(connectorConfig);

    await expect(
      connector.executeQuery({
        kind: 'sql',
        sql: 'DROP TABLE users',
      }),
    ).rejects.toThrow();

    await expect(
      connector.executeQuery({
        kind: 'sql',
        sql: 'SELECT SLEEP(10) FROM users',
      }),
    ).rejects.toThrow();
  });
});
