import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  type Widget,
  type ArchetypeId,
  type ArchetypeVariant,
  DEFAULT_VARIANT,
} from '@/lib/widgets/types';

export interface DashboardDraftState {
  id: string | null;
  title: string;
  description: string;
  theme: 'moderno-saas' | 'corporate';
  widgets: Widget[];
  archetype: ArchetypeId;
  archetypeVariant: ArchetypeVariant;

  setDashboard: (data: {
    id?: string;
    title: string;
    description?: string;
    theme?: 'moderno-saas' | 'corporate';
    widgets: Widget[];
    archetype?: ArchetypeId;
    archetypeVariant?: ArchetypeVariant;
  }) => void;
  updateTitle: (title: string) => void;
  updateTheme: (theme: 'moderno-saas' | 'corporate') => void;
  updateArchetype: (archetype: ArchetypeId) => void;
  updateArchetypeVariant: (patch: Partial<ArchetypeVariant>) => void;
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
      archetype: 'custom',
      archetypeVariant: { ...DEFAULT_VARIANT },

      setDashboard: (data) =>
        set((state) => {
          // Sprint 1.5: skip the update when nothing changed to break
          // the dashboard detail page infinite-render loop (the
          // remote dataSource useEffect used to re-fire on every
          // render because the store returned a new object each time).
          if (
            state.id === (data.id ?? null) &&
            state.title === data.title &&
            state.description === (data.description ?? '') &&
            state.theme === (data.theme ?? 'moderno-saas') &&
            state.archetype === (data.archetype ?? 'custom') &&
            JSON.stringify(state.archetypeVariant) ===
              JSON.stringify(data.archetypeVariant ?? { ...DEFAULT_VARIANT }) &&
            JSON.stringify(state.widgets) === JSON.stringify(data.widgets)
          ) {
            return state;
          }
          return {
            id: data.id ?? null,
            title: data.title,
            description: data.description ?? '',
            theme: data.theme ?? 'moderno-saas',
            widgets: data.widgets,
            archetype: data.archetype ?? 'custom',
            archetypeVariant: data.archetypeVariant ?? { ...DEFAULT_VARIANT },
          };
        }),

      updateTitle: (title) => set({ title }),
      updateTheme: (theme) => set({ theme }),
      updateArchetype: (archetype) => set({ archetype }),
      updateArchetypeVariant: (patch) =>
        set((state) => ({
          archetypeVariant: { ...state.archetypeVariant, ...patch },
        })),

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
          archetype: 'custom',
          archetypeVariant: { ...DEFAULT_VARIANT },
        }),
    }),
    {
      limit: 30,
    },
  ),
);
