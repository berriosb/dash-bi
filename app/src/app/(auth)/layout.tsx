import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex flex-col justify-center items-center p-4 bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white overflow-hidden">
      {/* Dynamic Background Glows */}
      <div className="absolute top-1/4 -left-48 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-48 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />

      {/* Header / Brand Logo */}
      <div className="mb-8 z-10 text-center">
        <Link href="/" className="inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white hover:opacity-90 transition">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
            📊
          </div>
          <span>dash-bi</span>
        </Link>
        <p className="text-xs text-slate-400 mt-1 font-medium">Business Intelligence de nueva generación impulsado por IA</p>
      </div>

      {/* Card Container */}
      <div className="w-full max-w-md z-10">
        {children}
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-slate-500 z-10">
        &copy; {new Date().getFullYear()} dash-bi · Self-hosted & Open Source
      </div>
    </div>
  );
}
