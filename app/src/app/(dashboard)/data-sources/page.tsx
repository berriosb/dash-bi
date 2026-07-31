'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Database,
  Plus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Key,
  FileSpreadsheet,
  Server,
  Inbox,
  ShoppingBag,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DataSourceItem {
  id: string;
  name: string;
  type: 'postgres' | 'stripe' | 'sheets' | 'mysql' | 'shopify';
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  details: string;
}

async function fetchDataSources(): Promise<DataSourceItem[]> {
  const res = await fetch('/api/data-sources');
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  }
  const data = await res.json();
  return (data.dataSources ?? []).map((row: {
    id: string;
    name: string;
    type: string;
    lastTestedAt: string | null;
    lastTestOk: boolean | null;
  }) => ({
    id: row.id,
    name: row.name,
    type: row.type as DataSourceItem['type'],
    lastTestedAt: row.lastTestedAt,
    lastTestOk: row.lastTestOk,
    details:
      row.type === 'stripe'
        ? 'sk_live_••••••••(cifrada)'
        : row.type === 'sheets'
          ? 'OAuth Google Sheets'
          : row.type === 'shopify'
            ? 'Shopify Admin API (shpat_...)'
            : row.type === 'mysql'
              ? 'MySQL (host cifrado)'
              : 'PostgreSQL (host cifrado)',
  }));
}

export default function DataSourcesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedType, setSelectedType] = useState<'postgres' | 'stripe' | 'sheets' | 'mysql' | 'shopify'>('postgres');
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [stripeKey, setStripeKey] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [shopifyUrl, setShopifyUrl] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');

  const { data: dataSources = [], isLoading } = useQuery({
    queryKey: ['data-sources'],
    queryFn: fetchDataSources,
  });

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/data-sources/${id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        toast({ title: 'Conexión exitosa', description: `${id} responde correctamente.` });
      } else {
        toast({
          variant: 'destructive',
          title: 'No pudimos conectar',
          description: data?.error ?? 'Verificá las credenciales y volvé a intentar.',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error de red';
      toast({ variant: 'destructive', title: 'Error al probar conexión', description: message });
    } finally {
      setTestingId(null);
    }
  };

  const resetForm = () => {
    setName('');
    setHost('');
    setPort('');
    setDatabase('');
    setUser('');
    setPassword('');
    setStripeKey('');
    setSpreadsheetId('');
    setShopifyUrl('');
    setShopifyToken('');
  };

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/data-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as { code?: string }).code ?? 'unknown';
        const message =
          (data as { message?: string }).message ?? `No pudimos guardar la fuente (${code})`;
        throw new Error(message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-sources'] });
      setShowConnectModal(false);
      resetForm();
      toast({
        title: 'Fuente conectada',
        description: 'Probá la conexión para confirmar que todo funciona.',
      });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'No pudimos guardar la fuente', description: err.message });
    },
  });

  const handleCreateSource = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const config: Record<string, unknown> = {};
    if (selectedType === 'postgres' || selectedType === 'mysql') {
      config.host = host;
      config.port = port ? Number(port) : selectedType === 'mysql' ? 3306 : 5432;
      config.database = database;
      config.username = user;
      config.password = password;
    } else if (selectedType === 'stripe') {
      config.apiKey = stripeKey;
    } else if (selectedType === 'sheets') {
      config.spreadsheetId = spreadsheetId;
      config.refreshTokenEncrypted = '';
      config.sheetNames = [];
    } else if (selectedType === 'shopify') {
      config.shopUrl = shopifyUrl;
      config.accessToken = shopifyToken;
    }
    create.mutate(
      {
        name: name || `Nueva Fuente ${selectedType.toUpperCase()}`,
        type: selectedType,
        config,
      },
      { onSettled: () => setSubmitting(false) },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Database className="w-6 h-6 text-indigo-400" />
            <span>Fuentes de Datos</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Gestioná las conexiones seguras a tus bases de datos PostgreSQL, MySQL, Shopify, Stripe y Google Sheets.
          </p>
        </div>

        <Button
          onClick={() => setShowConnectModal(true)}
          data-testid="connect-datasource"
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-4 h-9 shadow-lg shadow-indigo-500/20 gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>Conectar Nueva Fuente</span>
        </Button>
      </div>

      {isLoading && <p className="text-slate-400 text-sm">Cargando fuentes…</p>}

      {!isLoading && dataSources.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
          <Inbox className="w-8 h-8 text-slate-500 mx-auto mb-3" />
          <h2 className="text-sm font-semibold text-white">Todavía no conectaste ninguna fuente</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Conectá una base de datos PostgreSQL, MySQL, Shopify, Stripe o Google Sheets para empezar a generar dashboards.
          </p>
        </div>
      )}

      {dataSources.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {dataSources.map((ds) => (
            <Card
              key={ds.id}
              data-testid={`datasource-card-${ds.id}`}
              className="bg-slate-900/70 border-slate-800 flex flex-col justify-between"
            >
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400 font-bold">
                      {ds.type === 'postgres' && <Server className="w-5 h-5" />}
                      {ds.type === 'mysql' && <Database className="w-5 h-5 text-amber-400" />}
                      {ds.type === 'shopify' && <ShoppingBag className="w-5 h-5 text-emerald-400" />}
                      {ds.type === 'stripe' && <Key className="w-5 h-5 text-purple-400" />}
                      {ds.type === 'sheets' && <FileSpreadsheet className="w-5 h-5 text-teal-400" />}
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-white leading-tight">
                        {ds.name}
                      </CardTitle>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">{ds.details}</p>
                    </div>
                  </div>

                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase font-semibold ${
                      ds.type === 'postgres'
                        ? 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10'
                        : ds.type === 'mysql'
                          ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                          : ds.type === 'shopify'
                            ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                            : ds.type === 'stripe'
                              ? 'border-purple-500/30 text-purple-400 bg-purple-500/10'
                              : 'border-teal-500/30 text-teal-400 bg-teal-500/10'
                    }`}
                  >
                    {ds.type}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0">
                <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {ds.lastTestOk === true ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[11px] text-slate-300">Conexión verificada</span>
                      </>
                    ) : ds.lastTestOk === false ? (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        <span className="text-[11px] text-red-400">Error de conexión</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-500">Sin probar</span>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={testingId === ds.id}
                    onClick={() => handleTestConnection(ds.id)}
                    className="h-7 text-xs text-slate-300 hover:text-white hover:bg-slate-800 px-2.5 gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${testingId === ds.id ? 'animate-spin' : ''}`} />
                    <span>{testingId === ds.id ? 'Probando…' : 'Probar'}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showConnectModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="bg-slate-900 border-slate-800 w-full max-w-xl shadow-2xl">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-lg font-bold">Conectar Fuente de Datos</CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Seleccioná el conector e ingresá las credenciales cifradas (AES-256).
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedType('postgres')}
                  className={`p-2.5 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'postgres'
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <Server className="w-5 h-5" />
                  <span>Postgres</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedType('mysql')}
                  className={`p-2.5 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'mysql'
                      ? 'bg-amber-600/20 border-amber-500 text-amber-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <Database className="w-5 h-5 text-amber-400" />
                  <span>MySQL</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedType('shopify')}
                  className={`p-2.5 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'shopify'
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <ShoppingBag className="w-5 h-5 text-emerald-400" />
                  <span>Shopify</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedType('stripe')}
                  className={`p-2.5 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'stripe'
                      ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <Key className="w-5 h-5 text-purple-400" />
                  <span>Stripe</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedType('sheets')}
                  className={`p-2.5 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition ${
                    selectedType === 'sheets'
                      ? 'bg-teal-600/20 border-teal-500 text-teal-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-5 h-5 text-teal-400" />
                  <span>Sheets</span>
                </button>
              </div>

              <form onSubmit={handleCreateSource} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">Nombre Descriptivo</Label>
                  <Input
                    placeholder={`Ej: Tienda ${selectedType.toUpperCase()}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="bg-slate-950 border-slate-800 text-xs"
                  />
                </div>

                {(selectedType === 'postgres' || selectedType === 'mysql') && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-300">Host</Label>
                        <Input
                          placeholder="db.ejemplo.com"
                          value={host}
                          onChange={(e) => setHost(e.target.value)}
                          required
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-300">Puerto</Label>
                        <Input
                          placeholder={selectedType === 'mysql' ? '3306' : '5432'}
                          value={port}
                          onChange={(e) => setPort(e.target.value)}
                          className="bg-slate-950 border-slate-800 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-300">Base de Datos</Label>
                        <Input
                          placeholder="main"
                          value={database}
                          onChange={(e) => setDatabase(e.target.value)}
                          required
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-300">Usuario</Label>
                        <Input
                          placeholder="readonly_user"
                          value={user}
                          onChange={(e) => setUser(e.target.value)}
                          required
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-300">Contraseña</Label>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="bg-slate-950 border-slate-800 text-xs"
                        />
                      </div>
                    </div>
                  </>
                )}

                {selectedType === 'shopify' && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-300">Shop URL (ej: mi-tienda.myshopify.com)</Label>
                      <Input
                        placeholder="mi-tienda.myshopify.com"
                        value={shopifyUrl}
                        onChange={(e) => setShopifyUrl(e.target.value)}
                        required
                        className="bg-slate-950 border-slate-800 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-300">Admin API Access Token (shpat_...)</Label>
                      <Input
                        type="password"
                        placeholder="shpat_••••••••••••••••"
                        value={shopifyToken}
                        onChange={(e) => setShopifyToken(e.target.value)}
                        required
                        className="bg-slate-950 border-slate-800 text-xs font-mono"
                      />
                    </div>
                  </>
                )}

                {selectedType === 'stripe' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Stripe Secret Key (sk_live_...)</Label>
                    <Input
                      type="password"
                      placeholder="sk_live_••••••••••••"
                      value={stripeKey}
                      onChange={(e) => setStripeKey(e.target.value)}
                      required
                      className="bg-slate-950 border-slate-800 text-xs"
                    />
                  </div>
                )}

                {selectedType === 'sheets' && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-300">Spreadsheet ID</Label>
                      <Input
                        placeholder="1BxiMVs0XRAb4NcF4..."
                        value={spreadsheetId}
                        onChange={(e) => setSpreadsheetId(e.target.value)}
                        required
                        className="bg-slate-950 border-slate-800 text-xs font-mono"
                      />
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowConnectModal(false)} className="text-xs text-slate-400">
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">
                    {submitting ? 'Guardando…' : 'Guardar Conexión'}
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
