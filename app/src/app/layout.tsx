import type { Metadata, Viewport } from 'next';
import './globals.css';

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
        {children}
      </body>
    </html>
  );
}