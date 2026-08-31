'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

function LoginForm() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboards';
  const { toast } = useToast();

  const [mode, setMode] = useState<'password' | 'magic-link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (mode === 'password') {
        const res = await signIn.email({
          email,
          password,
          callbackURL: redirect,
        });

        if (res.error) {
          const msg = res.error.message || 'Error al iniciar sesión. Verifica tus credenciales.';
          setError(msg);
          toast({ variant: 'destructive', title: 'No pudimos iniciar sesión', description: msg });
          return;
        }

        toast({ title: 'Sesión iniciada', description: 'Redirigiendo al dashboard…' });

        // Drop-off recovery: if onboarding incomplete, route there first.
        try {
          const resumeRes = await fetch('/api/onboarding/resume');
          if (resumeRes.ok) {
            const body = (await resumeRes.json()) as { resumePath: string | null };
            if (body.resumePath) {
              window.location.href = body.resumePath;
              return;
            }
          }
        } catch {
          // ignore — fall through to default redirect
        }
        window.location.href = redirect;
      } else {
        const res = await signIn.magicLink({
          email,
          callbackURL: redirect,
        });

        if (res.error) {
          const msg = res.error.message || 'No se pudo enviar el enlace mágico.';
          setError(msg);
          toast({ variant: 'destructive', title: 'Error al enviar magic link', description: msg });
          return;
        }
        setSuccessMsg('Enlace de acceso enviado a tu correo. Revisa tu bandeja de entrada.');
        toast({
          title: 'Magic link enviado',
          description: 'Revisá tu correo para iniciar sesión sin contraseña.',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ocurrió un error inesperado';
      setError(message);
      toast({ variant: 'destructive', title: 'Error inesperado', description: message });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      await signIn.social({
        provider: 'google',
        callbackURL: redirect,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al conectar con Google.';
      setError(message);
      toast({ variant: 'destructive', title: 'Error con Google', description: message });
      setLoading(false);
    }
  };

  return (
    <Card className="auth-platform-card">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="auth-platform-title">Iniciar Sesión</CardTitle>
        <CardDescription className="auth-platform-description">
          Ingresá a tu cuenta de dash-bi para gestionar tus dashboards
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Social Login */}
        <Button
          type="button"
          variant="outline"
          className="auth-platform-secondary w-full"
          onClick={handleGoogleLogin}
          disabled={loading}
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continuar con Google
        </Button>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="auth-platform-divider-label">O continuá con email</span>
          </div>
        </div>

        {/* Tab switch mode */}
        <div className="auth-platform-mode-tabs">
          <button
            type="button"
            className={`flex-1 rounded-md py-1.5 font-medium transition ${
              mode === 'password' ? 'auth-platform-mode-tab auth-platform-mode-tab--active' : 'auth-platform-mode-tab'
            }`}
            onClick={() => setMode('password')}
          >
            Contraseña
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md py-1.5 font-medium transition ${
              mode === 'magic-link' ? 'auth-platform-mode-tab auth-platform-mode-tab--active' : 'auth-platform-mode-tab'
            }`}
            onClick={() => setMode('magic-link')}
          >
            Magic Link
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-3 text-xs rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3 text-xs rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} action="#" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Correo Electrónico</Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="auth-platform-input"
            />
          </div>

          {mode === 'password' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                    <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="auth-platform-input"
              />
            </div>
          )}

          <Button type="submit" className="auth-platform-primary" disabled={loading}>
            {loading ? 'Procesando...' : mode === 'password' ? 'Iniciar Sesión' : 'Enviar Magic Link'}
          </Button>
        </form>

        <div className="auth-platform-description text-center pt-2">
          ¿No tenés una cuenta aún?{' '}
          <Link href="/signup" className="text-primary hover:underline font-semibold">
            Creá tu organización
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Cargando…</div>}>
      <LoginForm />
    </Suspense>
  );
}
