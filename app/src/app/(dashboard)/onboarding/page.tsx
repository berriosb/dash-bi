'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, CheckCircle2, ArrowRight, Building2, Database, LayoutDashboard, ShieldCheck } from 'lucide-react';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step state
  const [orgName, setOrgName] = useState('Mi Empresa Analytics');
  const [llmProvider, setLlmProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [selectedSource, setSelectedSource] = useState('postgres');

  const handleNext = () => {
    if (step < 4) {
      setStep((step + 1) as any);
    } else {
      router.push('/dashboards?create=ai');
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-8">
      {/* Step Indicator Bar */}
      <div className="flex items-center justify-between relative px-2">
        <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-slate-800 -z-10" />

        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs transition ${
              s === step
                ? 'bg-indigo-600 text-white ring-4 ring-indigo-500/20 shadow-lg'
                : s < step
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-900 border border-slate-800 text-slate-500'
            }`}
          >
            {s < step ? <CheckCircle2 className="w-5 h-5" /> : s}
          </div>
        ))}
      </div>

      <Card className="bg-slate-900/80 border-slate-800 text-white backdrop-blur-xl shadow-2xl">
        {step === 1 && (
          <>
            <CardHeader className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 mx-auto flex items-center justify-center">
                <Building2 className="w-6 h-6" />
              </div>
              <CardTitle className="text-2xl font-bold">¡Bienvenido a dash-bi!</CardTitle>
              <CardDescription className="text-slate-400">
                Paso 1: Confirmá el nombre de tu organización o espacio de trabajo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Nombre del Workspace</Label>
                <Input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white"
                />
              </div>

              <Button onClick={handleNext} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                Siguiente Paso →
              </Button>
            </CardContent>
          </>
        )}

        {step === 2 && (
          <>
            <CardHeader className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30 mx-auto flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>
              <CardTitle className="text-2xl font-bold">Seleccioná tu Proveedor de IA</CardTitle>
              <CardDescription className="text-slate-400">
                Paso 2: Traé tu propia API Key (BYOK) para generar consultas y dashboards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              <div className="grid grid-cols-3 gap-3">
                {['openai', 'anthropic', 'gemini'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setLlmProvider(p)}
                    className={`p-3 rounded-xl border text-xs font-bold uppercase transition ${
                      llmProvider === p
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">API Key de {llmProvider.toUpperCase()}</Label>
                <Input
                  type="password"
                  placeholder="sk-••••••••••••••••"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white font-mono"
                />
                <p className="text-[11px] text-slate-500 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Almacenada con cifrado fuerte AES-256-GCM.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setStep(1)} className="text-slate-400">
                  Atrás
                </Button>
                <Button onClick={handleNext} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                  Continuar →
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {step === 3 && (
          <>
            <CardHeader className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 mx-auto flex items-center justify-center">
                <Database className="w-6 h-6" />
              </div>
              <CardTitle className="text-2xl font-bold">Conectá tu Primera Fuente</CardTitle>
              <CardDescription className="text-slate-400">
                Paso 3: ¿Desde dónde querés leer tus datos para generar reportes?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              <div className="space-y-3">
                {[
                  { id: 'postgres', title: 'PostgreSQL Database', desc: 'Bases SQL locales o en la nube' },
                  { id: 'stripe', title: 'Stripe Pasarela', desc: 'Suscripciones, MRR y pagos' },
                  { id: 'sheets', title: 'Google Sheets', desc: 'Planillas de cálculo compartidas' },
                ].map((src) => (
                  <div
                    key={src.id}
                    onClick={() => setSelectedSource(src.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition ${
                      selectedSource === src.id
                        ? 'bg-indigo-600/15 border-indigo-500 ring-2 ring-indigo-500/30'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-sm text-white">{src.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{src.desc}</div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setStep(2)} className="text-slate-400">
                  Atrás
                </Button>
                <Button onClick={handleNext} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                  Continuar →
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {step === 4 && (
          <>
            <CardHeader className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white mx-auto flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <LayoutDashboard className="w-6 h-6" />
              </div>
              <CardTitle className="text-2xl font-bold">¡Todo Listo para despegar! 🚀</CardTitle>
              <CardDescription className="text-slate-400">
                Paso 4: Tu espacio de trabajo está configurado. Generá tu primer dashboard interactivo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4 text-center">
              <p className="text-xs text-slate-300">
                Vas a ser redirigido al creador con IA. Solo necesitás describir qué querés analizar.
              </p>

              <Button onClick={handleNext} size="lg" className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:opacity-90 text-white font-bold text-sm shadow-xl shadow-indigo-500/25">
                Generar Mi Primer Dashboard ✨
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
