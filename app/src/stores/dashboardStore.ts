import { create } from 'zustand';
import { temporal } from 'zundo';
import { Widget } from '@/lib/widgets/types';

export interface DashboardDraftState {
  id: string | null;
  title: string;
  description: string;
  theme: 'moderno-saas' | 'corporate';
  widgets: Widget[];

  setDashboard: (data: { id?: string; title: string; description?: string; theme?: 'moderno-saas' | 'corporate'; widgets: Widget[] }) => void;
  updateTitle: (title: string) => void;
  updateTheme: (theme: 'moderno-saas' | 'corporate') => void;
  addWidget: (widget: Widget) => void;
  updateWidget: (id: string, patch: Partial<Widget>) => void;
  removeWidget: (id: string) => void;
  reorderWidgets: (widgets: Widget[]) => void;
  resetDraft: () => void;
}

export const useDashboardStore = create<DashboardDraftState>()(
  temporal(
    (set) => ({
      id: null,
      title: 'Nuevo Dashboard',
      description: '',
      theme: 'moderno-saas',
      widgets: [],

      setDashboard: (data) =>
        set({
          id: data.id ?? null,
          title: data.title,
          description: data.description ?? '',
          theme: data.theme ?? 'moderno-saas',
          widgets: data.widgets,
        }),

      updateTitle: (title) => set({ title }),
      updateTheme: (theme) => set({ theme }),

      addWidget: (widget) =>
        set((state) => ({
          widgets: [...state.widgets, widget],
        })),

      updateWidget: (id, patch) =>
        set((state) => ({
          widgets: state.widgets.map((w) => (w.id === id ? ({ ...w, ...patch } as Widget) : w)),
        })),

      removeWidget: (id) =>
        set((state) => ({
          widgets: state.widgets.filter((w) => w.id !== id),
        })),

      reorderWidgets: (widgets) => set({ widgets }),

      resetDraft: () =>
        set({
          id: null,
          title: 'Nuevo Dashboard',
          description: '',
          theme: 'moderno-saas',
          widgets: [],
        }),
    }),
    {
      limit: 30,
    },
  ),
);
