import Link from 'next/link';
import { BrandMark } from '@/components/brand/BrandMark';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-platform-shell">

      {/* Header / Brand Logo */}
      <div className="auth-platform-brand">
        <Link href="/" className="platform-brand">
          <BrandMark />
          <span>dash-bi</span>
        </Link>
        <p>Datos claros para decisiones concretas.</p>
      </div>

      {/* Card Container */}
      <div className="auth-platform-content">
        {children}
      </div>

      {/* Footer */}
      <div className="auth-platform-footer">
        &copy; {new Date().getFullYear()} dash-bi · Self-hosted & Open Source
      </div>
    </div>
  );
}
