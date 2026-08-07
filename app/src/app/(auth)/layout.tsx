import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-platform-shell">

      {/* Header / Brand Logo */}
      <div className="auth-platform-brand">
        <Link href="/" className="platform-brand">
          <span className="platform-brand__mark" aria-hidden="true">db</span>
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
