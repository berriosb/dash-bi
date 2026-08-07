import { Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="platform-app-shell">
      <Suspense fallback={null}>
        <Sidebar />
      </Suspense>
      <div className="platform-app-main">
        <Header />
        <main className="platform-app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
