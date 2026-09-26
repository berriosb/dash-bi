// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MembersManager } from '@/components/settings/MembersManager';

const mockFetch = vi.fn();

describe('MembersManager', () => {
  const sampleMembers = [
    {
      id: 'mem-1',
      userId: 'user-admin',
      role: 'admin',
      joinedAt: '2026-01-01T00:00:00.000Z',
      invitedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      email: 'admin@dashbi.test',
      name: 'Admin Boss',
      avatarUrl: null,
    },
    {
      id: 'mem-2',
      userId: 'user-viewer',
      role: 'viewer',
      joinedAt: '2026-01-02T00:00:00.000Z',
      invitedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
      email: 'viewer@dashbi.test',
      name: 'Viewer Colleague',
      avatarUrl: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  it('renders loading state initially and then displays members', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        members: sampleMembers,
        currentUserId: 'user-admin',
        currentUserRole: 'admin',
      }),
    });

    render(<MembersManager />);

    expect(screen.getByText(/cargando miembros/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('Admin Boss')).toBeDefined();
      expect(screen.getByText('viewer@dashbi.test')).toBeDefined();
    });

    expect(screen.getByText('Tú')).toBeDefined();
  });

  it('shows Invitar Miembro button when currentUserRole is admin', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        members: sampleMembers,
        currentUserId: 'user-admin',
        currentUserRole: 'admin',
      }),
    });

    render(<MembersManager />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /invitar miembro/i })).toBeDefined();
    });
  });

  it('hides Invitar Miembro button when currentUserRole is viewer', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        members: sampleMembers,
        currentUserId: 'user-viewer',
        currentUserRole: 'viewer',
      }),
    });

    render(<MembersManager />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /invitar miembro/i })).toBeNull();
    });
  });

  it('opens invite modal and submits new invitation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        members: sampleMembers,
        currentUserId: 'user-admin',
        currentUserRole: 'admin',
      }),
    });

    render(<MembersManager />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /invitar miembro/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /invitar miembro/i }));

    expect(screen.getByText('Invitar nuevo miembro')).toBeDefined();

    const input = screen.getByLabelText(/correo electrónico/i);
    fireEvent.change(input, { target: { value: 'colleague@example.com' } });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        member: {
          id: 'mem-3',
          userId: 'user-3',
          role: 'editor',
          email: 'colleague@example.com',
        },
      }),
    });

    // Mock for re-fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        members: [
          ...sampleMembers,
          {
            id: 'mem-3',
            userId: 'user-3',
            role: 'editor',
            joinedAt: null,
            invitedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            email: 'colleague@example.com',
            name: null,
            avatarUrl: null,
          },
        ],
        currentUserId: 'user-admin',
        currentUserRole: 'admin',
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: /enviar invitación/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/organizations/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'colleague@example.com', role: 'editor' }),
        }),
      );
    });
  });
});
