'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp, signIn } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export default function SignupPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await signUp.email({
        email,
        password,
        name,
        // orgId/org creation metadata handled via post-signup hook (lib/auth/config.ts)
        callbackURL: '/onboarding',
      });

      if (res.error) {
        const msg = res.error.message || 'Error al registrar la cuenta.';
        setError(msg);
        toast({ variant: 'destructive', title: 'No pudimos crear tu cuenta', description: msg });
        return;
      }

      toast({
        title: 'Cuenta creada',
        description: 'Revisá tu email para verificar la cuenta antes de continuar.',
      });
      router.push('/onboarding');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al procesar el registro';
      setError(message);
      toast({ variant: 'destructive', title: 'Error inesperado', description: message });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    try {
      setLoading(true);
      await signIn.social({
        provider: 'google',
        callbackURL: '/onboarding',
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al conectar con Google.');
      setLoading(false);
    }
  };

  return (
    <Card className="bg-slate-900/80 border-slate-800 text-slate-100 backdrop-blur-xl shadow-2xl">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight text-white">Crear Organización</CardTitle>
        <CardDescription className="text-slate-400">
          Comenzá gratis con dash-bi y creá dashboards con IA en segundos
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Social Register */}
        <Button
          type="button"
          variant="outline"
          className="w-full bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-200"
          onClick={handleGoogleSignup}
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
          Registrarse con Google
        </Button>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-slate-900 px-2 text-slate-500">O ingresá tus datos</span>
          </div>
        </div>

        {error && (
          <div className="p-3 text-xs rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName" className="text-slate-300">Nombre de la Organización / Empresa</Label>
            <Input
              id="orgName"
              type="text"
              placeholder="Acme Corp"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              className="bg-slate-800/80 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" className="text-slate-300">Tu Nombre Completo</Label>
            <Input
              id="name"
              type="text"
              placeholder="Alex Johnson"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="bg-slate-800/80 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-300">Correo Electrónico Trabajo</Label>
            <Input
              id="email"
              type="email"
              placeholder="alex@acmecorp.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-slate-800/80 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-300">Contraseña (Mín. 8 caracteres)</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="bg-slate-800/80 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <Button type="submit" className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold" disabled={loading}>
            {loading ? 'Creando cuenta...' : 'Crear Organización Gratis →'}
          </Button>
        </form>

        <div className="text-center text-xs text-slate-400 pt-2">
          ¿Ya tenés una cuenta?{' '}
          <Link href="/login" className="text-indigo-400 hover:underline font-semibold">
            Iniciá sesión
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
