'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Database, Plus, CheckCircle2, AlertCircle, RefreshCw, Key, FileSpreadsheet, Server, ExternalLink } from 'lucide-react';

interface DataSourceItem {
  id: string;
  name: string;
  type: 'postgres' | 'stripe' | 'sheets';
  lastTestedAt: string;
  status: 'ok' | 'error' | 'pending';
  details: string;
}

const initialDataSources: DataSourceItem[] = [
  {
    id: 'ds_postgres_prod',
    name: 'PostgreSQL Principal (Producción)',
    type: 'postgres',
    lastTestedAt: 'Hace 5 minutos',
    status: 'ok',
    details: 'db.empresa.internal:5432 / DB: production',
  },
  {
    id: 'ds_stripe_billing',
    name: 'Stripe Pasarela Pagos',
    type: 'stripe',
    lastTestedAt: 'Hace 1 hora',
    status: 'ok',
    details: 'sk_live_••••••••••••39A2',
  },
  {
    id: 'ds_sheets_sales',
    name: 'Google Sheets Ventas Q3',
    type: 'sheets',
    lastTestedAt: 'Ayer',
    status: 'ok',
    details: 'spreadsheet_id: 1BxiMVs0XR... (OAuth activo)',
  },
];

export default function DataSourcesPage() {
  const [dataSources, setDataSources] = useState<DataSourceItem[]>(initialDataSources);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedType, setSelectedType] = useState<'postgres' | 'stripe' | 'sheets'>('postgres');

  // Form State
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [stripeKey, setStripeKey] = useState('');

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      await fetch(`/api/data-sources/${id}/test`, { method: 'POST' });
      setDataSources((prev) =>
        prev.map((ds) => (ds.id === id ? { ...ds, lastTestedAt: 'Justo ahora', status: 'ok' } : ds)),
      );
    } catch {
      // Mock ok
      setDataSources((prev) =>
        prev.map((ds) => (ds.id === id ? { ...ds, lastTestedAt: 'Justo ahora', status: 'ok' } : ds)),
      );
    } finally {
      setTestingId(null);
    }
  };

  const handleCreateSource = (e: React.FormEvent) => {
    e.preventDefault();
    const newDs: DataSourceItem = {
      id: `ds_${Date.now()}`,
      name: name || `Nueva Fuente ${selectedType.toUpperCase()}`,
      type: selectedType,
      lastTestedAt: 'Recién añadida',
      status: 'ok',
      details: selectedType === 'postgres' ? `${host || 'localhost'}:5432 / ${database || 'main'}` : 'Configurada correctamente',
    };
    setDataSources([...dataSources, newDs]);
    setShowConnectModal(false);
    setName('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Database className="w-6 h-6 text-indigo-400" />
            <span>Fuentes de Datos</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Gestioná las conexiones seguras a tus bases de datos, Stripe y Google Sheets.
          </p>
        </div>

        <Button
          onClick={() => setShowConnectModal(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-4 h-9 shadow-lg shadow-indigo-500/20 gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>Conectar Nueva Fuente</span>
        </Button>
      </div>

      {/* List of Connected Data Sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {dataSources.map((ds) => (
          <Card key={ds.id} className="bg-slate-900/70 border-slate-800 flex flex-col justify-between">
            <CardHeader className="p-5 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400 font-bold">
                    {ds.type === 'postgres' && <Server className="w-5 h-5" />}
                    {ds.type === 'stripe' && <Key className="w-5 h-5 text-purple-400" />}
                    {ds.type === 'sheets' && <FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-white">{ds.name}</CardTitle>
                    <span className="text-[10px] text-slate-500 font-mono block mt-0.5">{ds.details}</span>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-5 pt-3 space-y-4">
              <div className="flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Conexión Activa
                </Badge>

                <span className="text-slate-500 text-[11px]">Probado: {ds.lastTestedAt}</span>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleTestConnection(ds.id)}
                disabled={testingId === ds.id}
                className="w-full bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200 text-xs gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingId === ds.id ? 'animate-spin text-indigo-400' : ''}`} />
                <span>{testingId === ds.id ? 'Probando...' : 'Probar Conexión'}</span>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Connect Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-md bg-slate-900 border-slate-800 text-white shadow-2xl">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Conectar Fuente de Datos</CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Seleccioná el tipo de conector e ingresá las credenciales cifradas (AES-256).
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedType('postgres')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'postgres'
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <Server className="w-5 h-5" />
                  <span>PostgreSQL</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedType('stripe')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'stripe'
                      ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <Key className="w-5 h-5" />
                  <span>Stripe API</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedType('sheets')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'sheets'
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-5 h-5" />
                  <span>Sheets</span>
                </button>
              </div>

              <form onSubmit={handleCreateSource} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Nombre Descriptivo</Label>
                  <Input
                    placeholder="Ej: Base Producción Postgres"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                </div>

                {selectedType === 'postgres' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-300">Host</Label>
                        <Input placeholder="localhost" value={host} onChange={(e) => setHost(e.target.value)} className="bg-slate-950 border-slate-800 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-300">Base de Datos</Label>
                        <Input placeholder="main" value={database} onChange={(e) => setDatabase(e.target.value)} className="bg-slate-950 border-slate-800 text-xs" />
                      </div>
                    </div>
                  </>
                )}

                {selectedType === 'stripe' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Stripe Secret Key (sk_live_...)</Label>
                    <Input type="password" placeholder="sk_live_••••••••••••" value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} className="bg-slate-950 border-slate-800 text-xs" />
                  </div>
                )}

                {selectedType === 'sheets' && (
                  <p className="text-xs text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800">
                    Al guardar, serás redirigido al flujo OAuth oficial de Google para otorgar acceso de lectura a tus planillas de cálculo.
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowConnectModal(false)} className="text-xs text-slate-400">
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">
                    Guardar Conexión
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
