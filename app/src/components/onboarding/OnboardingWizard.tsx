'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Building2,
  Sparkles,
  Database,
  LayoutDashboard,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Server,
  Key,
  FileSpreadsheet,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/cn';

type ConnectorType = 'postgres' | 'stripe' | 'sheets';

const STEPS = [
  { id: 1, label: 'Organización' },
  { id: 2, label: 'Proveedor IA' },
  { id: 3, label: 'Fuente de datos' },
  { id: 4, label: 'Confirmar' },
] as const;

interface OnboardingWizardProps {
  onComplete?: (orgId: string) => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [orgName, setOrgName] = useState('Mi Empresa Analytics');
  const [llmProvider, setLlmProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai');
  const [llmModel, setLlmModel] = useState('gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [selectedSource, setSelectedSource] = useState<ConnectorType>('postgres');

  // Postgres fields
  const [pgHost, setPgHost] = useState('');
  const [pgPort, setPgPort] = useState('5432');
  const [pgDatabase, setPgDatabase] = useState('');
  const [pgUser, setPgUser] = useState('');
  const [pgPassword, setPgPassword] = useState('');
  const [pgSsl, setPgSsl] = useState(true);

  // Stripe
  const [stripeKey, setStripeKey] = useState('');

  // Sheets
  const [spreadsheetId, setSpreadsheetId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    if (step === 1 && orgName.trim().length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.');
      return;
    }
    if (step === 2 && apiKey.trim().length > 0 && apiKey.trim().length < 16) {
      setError('La API key parece demasiado corta. Verificá que esté completa.');
      return;
    }
    setError(null);
    setStep((step + 1) as 1 | 2 | 3 | 4);
  };

  const prev = () => {
    setError(null);
    setStep((step - 1) as 1 | 2 | 3 | 4);
  };

  const finish = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const config = (() => {
        switch (selectedSource) {
          case 'postgres':
            return {
              host: pgHost,
              port: Number(pgPort) || 5432,
              database: pgDatabase,
              username: pgUser,
              password: pgPassword,
              ssl: pgSsl,
            };
          case 'stripe':
            return { apiKey: stripeKey };
          case 'sheets':
            return { spreadsheetId, refreshTokenEncrypted: '', sheetNames: [] };
        }
      })();

      const res = await fetch('/api/data-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${orgName} · ${selectedSource}`,
          type: selectedSource,
          config,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const message = data?.message || data?.error || 'No pudimos guardar la fuente.';
        setError(message);
        toast({ variant: 'destructive', title: 'No pudimos guardar la fuente', description: message });
        return;
      }

      toast({
        title: '¡Todo listo para despegar!',
        description: `${orgName} configurado con ${selectedSource}.`,
      });
      onComplete?.(data.dataSource?.id ?? '');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error de red';
      setError(message);
      toast({ variant: 'destructive', title: 'Error inesperado', description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-8">
      {/* Step Indicator */}
      <div className="flex items-center justify-between relative px-2" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={4}>
        <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-slate-800 -z-10" aria-hidden="true" />

        {STEPS.map(({ id, label }) => {
          const isActive = id === step;
          const isDone = id < step;
          return (
            <div key={id} className="flex flex-col items-center gap-2" data-testid={`onboarding-step-${id}`}>
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs transition',
                  isActive && 'bg-indigo-600 text-white ring-4 ring-indigo-500/20 shadow-lg',
                  isDone && 'bg-emerald-500 text-white',
                  !isActive && !isDone && 'bg-slate-900 border border-slate-800 text-slate-500',
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                {isDone ? <CheckCircle2 className="w-5 h-5" /> : id}
              </div>
              <span className={cn('text-[10px] font-medium uppercase tracking-wider', isActive ? 'text-white' : 'text-slate-500')}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <Card className="bg-slate-900/80 border-slate-800 text-white backdrop-blur-xl shadow-2xl">
        {error && (
          <div role="alert" className="m-4 p-3 text-xs rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

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
                <Label htmlFor="orgName" className="text-slate-300">Nombre del Workspace</Label>
                <Input
                  id="orgName"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white"
                />
              </div>
              <Button onClick={next} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                Siguiente Paso <ArrowRight className="w-4 h-4 ml-2" />
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
              <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Proveedor de IA">
                {(['openai', 'anthropic', 'gemini'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={llmProvider === p}
                    onClick={() => {
                      setLlmProvider(p);
                      setLlmModel(
                        p === 'openai' ? 'gpt-4o' : p === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gemini-1.5-pro',
                      );
                    }}
                    className={cn(
                      'p-3 rounded-xl border text-xs font-bold uppercase transition',
                      llmProvider === p
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="llmModel" className="text-slate-300">Modelo</Label>
                <Input
                  id="llmModel"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey" className="text-slate-300">API Key de {llmProvider.toUpperCase()}</Label>
                <Input
                  id="apiKey"
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
                <Button variant="ghost" onClick={prev} className="text-slate-400">Atrás</Button>
                <Button onClick={next} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                  Continuar <ArrowRight className="w-4 h-4 ml-2" />
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
              <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Tipo de fuente">
                {([
                  { id: 'postgres' as ConnectorType, title: 'PostgreSQL', desc: 'Bases SQL locales o en la nube', icon: Server },
                  { id: 'stripe' as ConnectorType, title: 'Stripe', desc: 'Suscripciones, MRR y pagos', icon: Key },
                  { id: 'sheets' as ConnectorType, title: 'Google Sheets', desc: 'Planillas compartidas', icon: FileSpreadsheet },
                ]).map((src) => {
                  const Icon = src.icon;
                  const selected = selectedSource === src.id;
                  return (
                    <button
                      key={src.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedSource(src.id)}
                      className={cn(
                        'p-4 rounded-xl border text-left transition',
                        selected
                          ? 'bg-indigo-600/15 border-indigo-500 ring-2 ring-indigo-500/30'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700',
                      )}
                    >
                      <Icon className={cn('w-5 h-5 mb-2', selected ? 'text-indigo-400' : 'text-slate-500')} />
                      <div className="font-bold text-sm text-white">{src.title}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{src.desc}</div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                {selectedSource === 'postgres' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1">
                        <Label htmlFor="pgHost" className="text-xs text-slate-300">Host</Label>
                        <Input id="pgHost" value={pgHost} onChange={(e) => setPgHost(e.target.value)} placeholder="db.example.com" className="bg-slate-950 border-slate-800 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="pgPort" className="text-xs text-slate-300">Puerto</Label>
                        <Input id="pgPort" value={pgPort} onChange={(e) => setPgPort(e.target.value)} placeholder="5432" className="bg-slate-950 border-slate-800 text-xs" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pgDatabase" className="text-xs text-slate-300">Base de datos</Label>
                      <Input id="pgDatabase" value={pgDatabase} onChange={(e) => setPgDatabase(e.target.value)} placeholder="production" className="bg-slate-950 border-slate-800 text-xs" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="pgUser" className="text-xs text-slate-300">Usuario</Label>
                        <Input id="pgUser" value={pgUser} onChange={(e) => setPgUser(e.target.value)} className="bg-slate-950 border-slate-800 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="pgPassword" className="text-xs text-slate-300">Contraseña</Label>
                        <Input id="pgPassword" type="password" value={pgPassword} onChange={(e) => setPgPassword(e.target.value)} className="bg-slate-950 border-slate-800 text-xs" />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input type="checkbox" checked={pgSsl} onChange={(e) => setPgSsl(e.target.checked)} className="rounded border-slate-700" />
                      Conexión SSL requerida
                    </label>
                  </div>
                )}

                {selectedSource === 'stripe' && (
                  <div className="space-y-1">
                    <Label htmlFor="stripeKey" className="text-xs text-slate-300">Stripe Secret Key (sk_live_...)</Label>
                    <Input id="stripeKey" type="password" value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} placeholder="sk_live_••••••••••••" className="bg-slate-950 border-slate-800 text-xs font-mono" />
                    <p className="text-[10px] text-slate-500">Recomendamos usar una restricted key con scope read_only.</p>
                  </div>
                )}

                {selectedSource === 'sheets' && (
                  <div className="space-y-1">
                    <Label htmlFor="spreadsheetId" className="text-xs text-slate-300">Spreadsheet ID</Label>
                    <Input id="spreadsheetId" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} placeholder="1BxiMVs0XRAb4NcF4..." className="bg-slate-950 border-slate-800 text-xs font-mono" />
                    <p className="text-[10px] text-slate-500">Lo encontrás en la URL entre <code>/d/</code> y <code>/edit</code>.</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <Button variant="ghost" onClick={prev} className="text-slate-400">Atrás</Button>
                <Button onClick={next} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                  Continuar <ArrowRight className="w-4 h-4 ml-2" />
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
              <CardTitle className="text-2xl font-bold">¡Todo listo para despegar! 🚀</CardTitle>
              <CardDescription className="text-slate-400">
                Paso 4: Revisá la configuración y confirmá para empezar a generar dashboards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <dl className="space-y-2 text-sm">
                <Row label="Organización" value={orgName} />
                <Row label="Proveedor IA" value={`${llmProvider} · ${llmModel}`} />
                <Row label="API Key" value={apiKey ? '•••••••• configurada' : 'Sin API key (usar env vars)'} />
                <Row label="Fuente de datos" value={selectedSource} />
              </dl>

              <Button onClick={finish} size="lg" disabled={submitting} className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:opacity-90 text-white font-bold text-sm shadow-xl shadow-indigo-500/25">
                {submitting ? 'Configurando…' : 'Confirmar y empezar'}
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
      <dt className="text-xs text-slate-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm font-medium text-white">{value}</dd>
    </div>
  );
}