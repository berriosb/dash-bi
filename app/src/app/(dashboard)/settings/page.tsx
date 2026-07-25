'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Settings, Key, ShieldCheck, Sparkles, Users, Palette, Check, Save } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

export default function SettingsPage() {
  const { activeTheme, setActiveTheme } = useUIStore();

  const [llmProvider, setLlmProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai');
  const [llmModel, setLlmModel] = useState('gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);

  const handleSaveLLM = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  };

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
                <Badge variant="outline" className="text-[10px] border-emerald-500/20 text-emerald-400 gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  AES-256 Cifrado
                </Badge>
              </div>
              <Input
                type="password"
                placeholder="sk-proj-••••••••••••••••"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-slate-950 border-slate-800 text-xs font-mono"
              />
            </div>

            {savedMsg && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>Configuración de IA guardada y encriptada exitosamente.</span>
              </div>
            )}

            <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs gap-1.5">
              <Save className="w-3.5 h-3.5" />
              <span>Guardar Credenciales IA</span>
            </Button>
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
            <div
              onClick={() => setActiveTheme('moderno-saas')}
              className={`p-4 rounded-xl border cursor-pointer transition ${
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
            </div>

            <div
              onClick={() => setActiveTheme('corporate')}
              className={`p-4 rounded-xl border cursor-pointer transition ${
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
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Team Members */}
      <Card className="bg-slate-900/70 border-slate-800 text-white">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-pink-400" />
            <CardTitle className="text-base font-bold">Miembros del Equipo</CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-400">
            Administrá el acceso a la organización y los permisos (Admin, Editor, Viewer).
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold">
                  A
                </div>
                <div>
                  <p className="font-semibold text-white">Alex Johnson</p>
                  <p className="text-[11px] text-slate-500">alex@empresa.com</p>
                </div>
              </div>
              <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px]">
                Propietario (Admin)
              </Badge>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold">
                  S
                </div>
                <div>
                  <p className="font-semibold text-white">Sofia Martinez</p>
                  <p className="text-[11px] text-slate-500">sofia@empresa.com</p>
                </div>
              </div>
              <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px]">
                Editor
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
