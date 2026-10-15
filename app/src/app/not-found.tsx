import Link from 'next/link';
import { FileQuestion, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 404 screen.
 *
 * Without it every dead link — an old bookmark, a share URL that was
 * revoked, a typo — renders Next's unstyled default page, which looks
 * like the app failed to load.
 */
export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <FileQuestion className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">Error 404</p>
        <h1 className="text-2xl font-semibold text-foreground">No encontramos esta página</h1>
        <p className="text-sm text-muted-foreground">
          El enlace puede estar mal escrito, o el recurso fue eliminado o revocado.
        </p>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button asChild>
            <Link href="/dashboards">
              <LayoutDashboard className="h-4 w-4 mr-2" />
              Ir a mis dashboards
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Inicio</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}