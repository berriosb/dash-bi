import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppTheme = 'moderno-saas' | 'corporate';

interface UIState {
  activeOrgId: string | null;
  sidebarOpen: boolean;
  isEditing: boolean;
  activeTheme: AppTheme;
  selectedWidgetId: string | null;

  setActiveOrgId: (orgId: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setEditMode: (editing: boolean) => void;
  setActiveTheme: (theme: AppTheme) => void;
  setSelectedWidgetId: (id: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeOrgId: null,
      sidebarOpen: true,
      isEditing: false,
      activeTheme: 'moderno-saas',
      selectedWidgetId: null,

      setActiveOrgId: (orgId) => set({ activeOrgId: orgId }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setEditMode: (editing) => set({ isEditing: editing }),
      setActiveTheme: (theme) => set({ activeTheme: theme }),
      setSelectedWidgetId: (id) => set({ selectedWidgetId: id }),
    }),
    {
      name: 'dashbi-ui-store',
      partialize: (state) => ({
        activeOrgId: state.activeOrgId,
        sidebarOpen: state.sidebarOpen,
        activeTheme: state.activeTheme,
      }),
    },
  ),
);
