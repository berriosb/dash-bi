import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT, DELETE } from '@/app/api/organizations/llm-key/route';
import { db } from '@/db/client';
import { encryptApiKey, decryptApiKey } from '@/lib/security/encryption';
import { audit } from '@/lib/audit/log';

const { ORG_ID, USER_ID, AUTH_CTX } = vi.hoisted(() => {
  const ORG_ID = '00000000-0000-4000-a000-000000000001';
  const USER_ID = 'user-123';
  return {
    ORG_ID,
    USER_ID,
    AUTH_CTX: {
      session: { user: { id: USER_ID, email: 'admin@dash-bi.local' } },
      orgId: ORG_ID,
      userId: USER_ID,
      role: 'admin',
    },
  };
});

vi.mock('@/lib/auth/request', () => ({
  requireAuth: vi.fn().mockResolvedValue(AUTH_CTX),
  getAuthContext: vi.fn().mockResolvedValue(AUTH_CTX),
}));

function lastArgIsCallback(args: unknown[]) {
  return (args[args.length - 1] as (tx: unknown) => unknown)(db);
}

vi.mock('@/db/client', () => ({
  db: { select: vi.fn(), update: vi.fn() },
  withOrgContext: vi.fn((...args: unknown[]) => lastArgIsCallback(args)),
  withOrgContextReadOnly: vi.fn((...args: unknown[]) => lastArgIsCallback(args)),
}));

vi.mock('@/lib/audit/log', () => ({ audit: vi.fn() }));

function chain(result: unknown) {
  const promise = Promise.resolve(result);
  const thenable: Record<string, unknown> = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const method of ['returning', 'where', 'limit']) {
    thenable[method] = vi.fn().mockReturnValue(thenable);
  }
  return thenable;
}

function mockOrgRow(row: unknown) {
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([row]),
      }),
    }),
  });
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
    set: vi.fn().mockReturnValue(chain([row])),
  });
}

/** The values handed to the UPDATE on `orgs`. */
function updatedValues() {
  const update = db.update as ReturnType<typeof vi.fn>;
  const setCall = update.mock.results[0]?.value?.set;
  return setCall?.mock?.calls?.[0]?.[0];
}

const REQ = (method: string, body?: unknown) =>
  new Request('http://localhost:3000/api/organizations/llm-key', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const PLAINTEXT = 'sk-proj-abcdef0123456789abcdef0123456789';

describe('T4 — BYOK: the org LLM key is actually stored, encrypted, and never echoed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PUT stores the key ENCRYPTED, never in plaintext', async () => {
    mockOrgRow({ id: ORG_ID, llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKeyEncrypted: null });

    const res = await PUT(REQ('PUT', { provider: 'openai', model: 'gpt-4o', apiKey: PLAINTEXT }));

    expect(res.status).toBe(200);
    const values = updatedValues();
    expect(values.llmApiKeyEncrypted).not.toBe(PLAINTEXT);
    // AES-GCM uses a fresh random IV per call, so two encryptions of the
    // same plaintext differ. Round-trip instead of comparing strings.
    expect(decryptApiKey(values.llmApiKeyEncrypted)).toBe(PLAINTEXT);
    expect(values.llmProvider).toBe('openai');
    expect(values.llmModel).toBe('gpt-4o');
  });

  it('PUT never returns the key in the response body', async () => {
    mockOrgRow({ id: ORG_ID, llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKeyEncrypted: null });

    const res = await PUT(REQ('PUT', { provider: 'openai', model: 'gpt-4o', apiKey: PLAINTEXT }));
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain(PLAINTEXT);
    expect(raw).not.toContain(encryptApiKey(PLAINTEXT));
  });

  it('PUT records org.settings_updated in the audit trail', async () => {
    mockOrgRow({ id: ORG_ID, llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKeyEncrypted: null });

    await PUT(REQ('PUT', { provider: 'openai', model: 'gpt-4o', apiKey: PLAINTEXT }));

    expect(audit).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      'org.settings_updated',
      `org:${ORG_ID}`,
      expect.objectContaining({ metadata: expect.objectContaining({ apiKeySet: true }) }),
    );
  });

  it('PUT rejects an empty apiKey instead of silently storing nothing', async () => {
    mockOrgRow({ id: ORG_ID });

    const res = await PUT(REQ('PUT', { provider: 'openai', model: 'gpt-4o', apiKey: '' }));

    expect(res.status).toBe(400);
  });

  it('PUT rejects an unsupported provider', async () => {
    mockOrgRow({ id: ORG_ID });

    const res = await PUT(REQ('PUT', { provider: 'evil-corp', model: 'x', apiKey: PLAINTEXT }));

    expect(res.status).toBe(400);
  });

  it('GET reports whether a key exists but never returns it', async () => {
    mockOrgRow({
      id: ORG_ID,
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4',
      llmApiKeyEncrypted: encryptApiKey(PLAINTEXT),
    });

    const res = await GET(REQ('GET'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      hasApiKey: true,
    });
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT);
  });

  it('GET reports hasApiKey:false when none is configured', async () => {
    mockOrgRow({ id: ORG_ID, llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKeyEncrypted: null });

    const body = await (await GET(REQ('GET'))).json();

    expect(body.hasApiKey).toBe(false);
  });

  it('DELETE clears the stored key and audits it', async () => {
    mockOrgRow({ id: ORG_ID, llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKeyEncrypted: 'x' });

    const res = await DELETE(REQ('DELETE'));

    expect(res.status).toBe(200);
    expect(updatedValues()).toMatchObject({ llmApiKeyEncrypted: null });
    expect(audit).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      'org.settings_updated',
      `org:${ORG_ID}`,
      expect.objectContaining({ metadata: expect.objectContaining({ apiKeyCleared: true }) }),
    );
  });

  it('never writes the plaintext key into the audit metadata', async () => {
    mockOrgRow({ id: ORG_ID, llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKeyEncrypted: null });

    await PUT(REQ('PUT', { provider: 'openai', model: 'gpt-4o', apiKey: PLAINTEXT }));

    // `options` has a default in the signature, so the mocked call tuple is
    // optional in its tail — index it defensively instead of destructuring.
    const options = vi.mocked(audit).mock.calls[0]?.[4];
    expect(JSON.stringify(options)).not.toContain(PLAINTEXT);
  });
});
