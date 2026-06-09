import { ArrowLeft, Home, SearchX } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { PbkButton, PbkPanel } from '../../components/pbk/index';

export function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <main className="grid min-h-full place-items-center px-4 py-10 sm:px-6">
      <PbkPanel className="w-full max-w-xl border-sky-400/20 bg-slate-950/70 p-6 text-center shadow-2xl sm:p-8">
        <span className="mx-auto grid size-12 place-items-center rounded-full border border-sky-400/25 bg-sky-400/10 text-sky-300">
          <SearchX size={22} aria-hidden="true" />
        </span>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-sky-300">
          Route not found
        </p>
        <h1 className="mt-2 font-display text-3xl text-white sm:text-4xl">
          This command surface moved.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
          PBK could not find <code className="text-slate-200">{location.pathname}</code>. Return to
          Command Center or go back to the previous workspace.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <PbkButton type="button" variant="ghost" onClick={() => window.history.back()}>
            <ArrowLeft size={15} aria-hidden="true" />
            Go back
          </PbkButton>
          <PbkButton type="button" variant="primary" onClick={() => navigate('/')}>
            <Home size={15} aria-hidden="true" />
            Command Center
          </PbkButton>
        </div>
      </PbkPanel>
    </main>
  );
}
