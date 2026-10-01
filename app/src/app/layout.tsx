import type { Metadata, Viewport } from 'next';
// IBM Plex Sans is the typeface DESIGN.md commits to as the thing that keeps
// dash-bi from reading as a generic SaaS template. It has to be actually
// loaded — declaring the family name in a CSS stack is not enough.
import '@fontsource-variable/ibm-plex-sans/wght.css';
import './globals.css';
import { Providers } from '@/components/providers/Providers';

export const metadata: Metadata = {
  title: {
    default: 'dash-bi',
    template: '%s · dash-bi',
  },
  description: 'Open source BI platform with AI-genera-dashboards',
  applicationName: 'dash-bi',
  authors: [{ name: 'dash-bi contributors' }],
  keywords: ['bi', 'business intelligence', 'dashboards', 'ai', 'open source'],
  robots: {
    index: false, // Private app, no SEO
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#6366f1',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}