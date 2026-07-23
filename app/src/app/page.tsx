import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <div>
          <h1 className="text-5xl font-bold tracking-tight">dash-bi</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Open source BI platform with AI-genera-dashboards.
            <br />
            Self-hosted. Multi-LLM. Beautiful. OSS.
          </p>
        </div>

        <div className="flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 pt-8 text-left md:grid-cols-3">
          <div className="rounded-lg border p-6">
            <h3 className="font-semibold">AI-genera-dashboards</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Describe what you want to see. Get a dashboard with real data in 5 seconds.
            </p>
          </div>
          <div className="rounded-lg border p-6">
            <h3 className="font-semibold">Multi-LLM</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Bring your own API key. OpenAI, Anthropic, or Gemini. Switch without redeploy.
            </p>
          </div>
          <div className="rounded-lg border p-6">
            <h3 className="font-semibold">Self-hosted</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Docker Compose deploys in 5 minutes. Postgres included. Your data stays home.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}