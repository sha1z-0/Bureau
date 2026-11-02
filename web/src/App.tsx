import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Compass, Feather, KanbanSquare, Moon, Radar, Send, Settings as Cog, Sun, UserRound } from 'lucide-react';
import { api, loadSession, post, setCsrf, useLive, useLiveInvalidation, type LiveEvent, type Session } from './api';
import { Btn, Insignia, useToast } from './ui';
import Overview from './pages/Overview';
import Jobs from './pages/Jobs';
import Studio from './pages/Studio';
import Dispatch from './pages/Dispatch';
import Pipeline from './pages/Pipeline';
import ProfilePage from './pages/Profile';
import Sources from './pages/Sources';
import SettingsPage from './pages/Settings';

const ROUTES = [
  { path: 'overview', label: 'Overview', icon: Compass, el: Overview },
  { path: 'jobs', label: 'Jobs', icon: Briefcase, el: Jobs },
  { path: 'studio', label: 'Studio', icon: Feather, el: Studio },
  { path: 'dispatch', label: 'Dispatch', icon: Send, el: Dispatch },
  { path: 'pipeline', label: 'Pipeline', icon: KanbanSquare, el: Pipeline },
  { path: 'profile', label: 'Profile', icon: UserRound, el: ProfilePage },
  { path: 'sources', label: 'Sources', icon: Radar, el: Sources },
  { path: 'settings', label: 'Settings', icon: Cog, el: SettingsPage },
] as const;

export function useRoute(): [string, URLSearchParams] {
  const read = () => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    return [path || 'overview', new URLSearchParams(query ?? '')] as [string, URLSearchParams];
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string) {
  window.location.hash = `/${path}`;
}

function useTheme() {
  const [theme, setTheme] = useState<string | null>(() => {
    try {
      return localStorage.getItem('bureau.theme');
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem('bureau.theme', theme);
      else localStorage.removeItem('bureau.theme');
    } catch {
      /* private mode */
    }
  }, [theme]);
  const dark = theme === 'dark';
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') };
}

function LockScreen({ onUnlock }: { onUnlock: (s: Session) => void }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className="lock-screen">
      <form
        className="lock-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const s = await post<Session>('/api/auth/login', { passphrase: pass });
            setCsrf(s.csrf);
            onUnlock(s);
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Insignia size={64} />
        <h1 className="display" style={{ fontSize: '2.5rem' }}>
          Bureau is locked
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          Enter your passphrase to open the atelier.
        </p>
        <input className="input" type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Passphrase" />
        <Btn variant="primary" busy={busy} type="submit" style={{ width: '100%' }}>
          Unlock
        </Btn>
      </form>
    </div>
  );
}

interface OverviewLite {
  totals: { drafts: number; approved: number; strong: number; needsYou: number };
  scanning: string | null;
  lastScan: { started_at: string; status: string } | null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [path] = useRoute();
  const theme = useTheme();
  useLiveInvalidation();

  useEffect(() => {
    loadSession().then(setSession);
    const onLocked = () => setSession((s) => (s ? { ...s, locked: true } : s));
    window.addEventListener('bureau:locked', onLocked);
    return () => window.removeEventListener('bureau:locked', onLocked);
  }, []);

  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<OverviewLite>('/api/overview'),
    enabled: !!session && !session.locked,
    refetchInterval: 60_000,
  });

  const [scanLine, setScanLine] = useState<string | null>(null);
  useLive(
    useCallback((e: LiveEvent) => {
      if (e.type === 'scan') setScanLine(e.status === 'running' ? (e.message?.replace(/^\S+\s+/, '') ?? null) : null);
    }, []),
  );

  if (!session) return null;
  if (session.locked) return <LockScreen onUnlock={setSession} />;

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const Page = route.el;
  const counts: Record<string, number | undefined> = {
    studio: overview.data?.totals.drafts || undefined,
    dispatch: (overview.data?.totals.approved ?? 0) + (overview.data?.totals.needsYou ?? 0) || undefined,
  };
  const scanning = overview.data?.scanning;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/overview" aria-label="Bureau home">
          <Insignia size={28} />
          <div className="brand-name">Bureau</div>
        </a>
        <nav className="nav" aria-label="Main">
          {ROUTES.map((r) => (
            <a key={r.path} href={`#/${r.path}`} aria-current={r.path === route.path ? 'page' : undefined}>
              <r.icon size={17} strokeWidth={1.8} />
              <span>{r.label}</span>
              {counts[r.path] ? <span className="count">{counts[r.path]}</span> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="scan-chip">
            <div className="row">
              <span>{scanning ? 'Scanning' : 'Last scan'}</span>
              <span className="spacer" />
              {scanning ? <span className="spinner" style={{ color: 'var(--accent)' }} /> : null}
            </div>
            <div style={{ fontSize: '0.8125rem' }} className={scanning ? '' : 'muted'}>
              {scanning
                ? (scanLine ?? 'Starting…')
                : overview.data?.lastScan
                  ? `${new Date(overview.data.lastScan.started_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
                  : 'Never — run your first scan'}
            </div>
          </div>
          <div className="row">
            <Btn variant="ghost" size="sm" onClick={theme.toggle} aria-label="Toggle theme">
              {theme.dark ? <Sun /> : <Moon />}
              {theme.dark ? 'Day' : 'Night'}
            </Btn>
            <span className="spacer" />
            {session.passphrase ? (
              <Btn
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await post('/api/auth/logout');
                  setSession(await loadSession(true));
                }}
              >
                Lock
              </Btn>
            ) : null}
          </div>
        </div>
      </aside>
      <main className="main" id="main">
        <Page />
      </main>
    </div>
  );
}
