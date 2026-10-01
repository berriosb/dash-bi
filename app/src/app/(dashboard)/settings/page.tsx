'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Settings, ShieldCheck, Sparkles, Palette, Check, Save, Trash2, Loader2 } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { MembersManager } from '@/components/settings/MembersManager';

export default function SettingsPage() {
  const { activeTheme, setActiveTheme } = useUIStore();

  const [llmProvider, setLlmProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai');
  const [llmModel, setLlmModel] = useState('gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load the stored config on mount so the form reflects reality instead of
  // showing defaults while claiming a key is saved.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/organizations/llm-key')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setLlmProvider(data.provider ?? 'openai');
        setLlmModel(data.model ?? 'gpt-4o');
        setHasApiKey(Boolean(data.hasApiKey));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveLLM = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSavedMsg(false);

    if (!apiKey.trim()) {
      setSaveError('Ingresá tu API key para guardar.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/organizations/llm-key', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: llmProvider, model: llmModel, apiKey: apiKey.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body?.message ?? 'No se pudo guardar la configuración.');
        return;
      }

      // The key only exists server-side from here on.
      setApiKey('');
      setHasApiKey(true);
      setSavedMsg(true);
    } catch {
      setSaveError('No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  // Revoking is a real need: without it, a key leaked outside the org cannot
  // be invalidated from the product at all.
  const handleClearLLM = useCallback(async () => {
    setSaveError(null);
    setSavedMsg(false);
    setSaving(true);
    try {
      const res = await fetch('/api/organizations/llm-key', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body?.message ?? 'No se pudo eliminar la API key.');
        return;
      }
      setApiKey('');
      setHasApiKey(false);
    } catch {
      setSaveError('No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-400" />
          <span>Configuración de la Organización</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Ajustá tus proveedores de IA (BYOK), temas visuales y gestión de equipo.
        </p>
      </div>

      {/* Section 1: LLM Config (BYOK) */}
      <Card className="bg-slate-900/70 border-slate-800 text-white">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <CardTitle className="text-base font-bold">Configuración Multi-LLM (BYOK)</CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-400">
            Traé tu propia API Key (Bring Your Own Key). Tus credenciales se guardan cifradas con AES-256-GCM.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSaveLLM} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => {
                  setLlmProvider('openai');
                  setLlmModel('gpt-4o');
                }}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold transition ${
                  llmProvider === 'openai'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <span className="text-base">🤖</span>
                <span>OpenAI</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLlmProvider('anthropic');
                  setLlmModel('claude-3-5-sonnet-20241022');
                }}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold transition ${
                  llmProvider === 'anthropic'
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300 shadow'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <span className="text-base">🧠</span>
                <span>Anthropic</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLlmProvider('gemini');
                  setLlmModel('gemini-1.5-pro');
                }}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold transition ${
                  llmProvider === 'gemini'
                    ? 'bg-pink-600/20 border-pink-500 text-pink-300 shadow'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <span className="text-base">✨</span>
                <span>Google Gemini</span>
              </button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Modelo Seleccionado</Label>
              <Input
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="bg-slate-950 border-slate-800 text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-slate-300">API Key ({llmProvider.toUpperCase()})</Label>
                <div className="flex items-center gap-2">
                  {hasApiKey && (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/20 text-emerald-400 gap-1">
                      <Check className="w-3 h-3" />
                      Key configurada
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400 gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    AES-256 Cifrado
                  </Badge>
                </div>
              </div>
              <Input
                type="password"
                placeholder={
                  hasApiKey
                    ? 'Ingresá una key nueva para reemplazarla'
                    : 'sk-proj-••••••••••••••••'
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="bg-slate-950 border-slate-800 text-xs font-mono"
              />
            </div>

            {saveError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs"
              >
                {saveError}
              </div>
            )}

            {savedMsg && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>Configuración de IA guardada y encriptada exitosamente.</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs gap-1.5"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{saving ? 'Guardando…' : 'Guardar Credenciales IA'}</span>
              </Button>

              {hasApiKey && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={handleClearLLM}
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 text-xs gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar key</span>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Section 2: Visual Theme */}
      <Card className="bg-slate-900/70 border-slate-800 text-white">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-purple-400" />
            <CardTitle className="text-base font-bold">Tema Predeterminado del Workspace</CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-400">
            Elegí la apariencia visual por defecto para todos los dashboards de la organización.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setActiveTheme('moderno-saas')}
              className={`p-4 rounded-xl border cursor-pointer transition text-left ${
                activeTheme === 'moderno-saas'
                  ? 'bg-indigo-600/15 border-indigo-500 ring-2 ring-indigo-500/30'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs">Moderno SaaS</span>
                {activeTheme === 'moderno-saas' && <Check className="w-4 h-4 text-indigo-400" />}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Estilo oscuro vibrante con degradados en morado e índigo.</p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTheme('corporate')}
              className={`p-4 rounded-xl border cursor-pointer transition text-left ${
                activeTheme === 'corporate'
                  ? 'bg-indigo-600/15 border-indigo-500 ring-2 ring-indigo-500/30'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs">Corporate</span>
                {activeTheme === 'corporate' && <Check className="w-4 h-4 text-indigo-400" />}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Líneas limpias, tipografía sobria y paleta azul marino ejecutiva.</p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Team Members (RBAC) */}
      <MembersManager />
    </div>
  );
}
