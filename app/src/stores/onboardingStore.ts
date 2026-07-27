import { create } from 'zustand';

export type OnboardingStep =
  | 'welcome'
  | 'choose_source'
  | 'prompt'
  | 'generating'
  | 'success';

export type SourceType = 'postgres' | 'stripe' | 'sheets';

export type OnboardingState = {
  step: OnboardingStep;
  selectedSourceType: SourceType | null;
  dataSourceId: string | null;
  prompt: string;
  dashboardId: string | null;
  isGenerating: boolean;

  goToStep: (step: OnboardingStep) => void;
  setSelectedSourceType: (type: SourceType) => void;
  setDataSourceId: (id: string) => void;
  setPrompt: (text: string) => void;
  setDashboardId: (id: string) => void;
  setGenerating: (flag: boolean) => void;
  reset: () => void;
};

const INITIAL_STATE = {
  step: 'welcome' as OnboardingStep,
  selectedSourceType: null,
  dataSourceId: null,
  prompt: '',
  dashboardId: null,
  isGenerating: false,
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...INITIAL_STATE,

  goToStep: (step) => set({ step }),
  setSelectedSourceType: (selectedSourceType) => set({ selectedSourceType }),
  setDataSourceId: (dataSourceId) => set({ dataSourceId }),
  setPrompt: (prompt) => set({ prompt }),
  setDashboardId: (dashboardId) => set({ dashboardId }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  reset: () => set({ ...INITIAL_STATE }),
}));