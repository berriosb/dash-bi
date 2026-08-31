import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAuth, mockWithOrgContext, mockAudit } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock("@/lib/auth/request", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@/db/client", () => ({ withOrgContext: mockWithOrgContext }));
vi.mock("@/lib/audit/log", () => ({ audit: mockAudit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from "@/app/api/organizations/route";

function request(method: "GET" | "POST", body?: unknown): Request {
  return new Request("http://localhost/api/organizations", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      orgId: "org-1",
      role: "admin",
    });
    mockAudit.mockResolvedValue(undefined);
  });

  it("lists every organization where the authenticated user is a member", async () => {
    mockWithOrgContext.mockImplementationOnce(
      async (_orgId, _userId, _role, fn) =>
        fn({
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  orderBy: () =>
                    Promise.resolve([
                      {
                        id: "org-1",
                        name: "Acme",
                        slug: "acme",
                        plan: "pro",
                        role: "admin",
                      },
                      {
                        id: "org-2",
                        name: "Globex",
                        slug: "globex",
                        plan: "free",
                        role: "viewer",
                      },
                    ]),
                }),
              }),
            }),
          }),
        }),
    );

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      organizations: [
        { id: "org-1", name: "Acme", slug: "acme", plan: "pro", role: "admin" },
        {
          id: "org-2",
          name: "Globex",
          slug: "globex",
          plan: "free",
          role: "viewer",
        },
      ],
      activeOrgId: "org-1",
    });
  });

  it("switches only to an organization the user belongs to", async () => {
    mockWithOrgContext.mockImplementationOnce(
      async (_orgId, _userId, _role, fn) =>
        fn({
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({
                  limit: () => Promise.resolve([{ id: "org-2" }]),
                }),
              }),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        }),
    );

    const response = await POST(request("POST", { orgId: "org-2" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "dashbi.activeOrgId=org-2",
    );
    expect(await response.json()).toEqual({ activeOrgId: "org-2" });
    expect(mockAudit).toHaveBeenCalledWith(
      "org-2",
      "user-1",
      "org.switched",
      "org:org-2",
      { metadata: { previousOrgId: "org-1" } },
    );
  });

  it("rejects a switch to an organization outside the user membership set", async () => {
    mockWithOrgContext.mockImplementationOnce(
      async (_orgId, _userId, _role, fn) =>
        fn({
          select: () => ({
            from: () => ({
              innerJoin: () => ({
                where: () => ({ limit: () => Promise.resolve([]) }),
              }),
            }),
          }),
        }),
    );

    const response = await POST(request("POST", { orgId: "org-outsider" }));

    expect(response.status).toBe(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
