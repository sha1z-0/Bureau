import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Briefcase,
  CircleHelp,
  Compass,
  Feather,
  FileText,
  GraduationCap,
  Inbox as InboxIcon,
  KanbanSquare,
  Menu,
  Moon,
  Newspaper,
  Radar,
  Send,
  Settings as Cog,
  Square,
  Sun,
  Target,
  UserRound,
  Workflow,
} from 'lucide-react';
import { api, del, loadSession, post, setCsrf, useLive, useLiveInvalidation, type LiveEvent, type Session, type Shell } from './api';
import { Btn, Field, Insignia, Modal, useToast } from './ui';
import { Drawer, until } from './kit';
import Overview from './pages/Overview';
import Jobs from './pages/Jobs';
import Studio from './pages/Studio';
import Dispatch from './pages/Dispatch';
import Pipeline from './pages/Pipeline';
import ProfilePage from './pages/Profile';
import Sources from './pages/Sources';
import SettingsPage from './pages/Settings';
import Campaigns from './pages/Campaigns';
import Questions from './pages/Questions';
import Inbox from './pages/Inbox';
import Digests from './pages/Digests';
import Learning from './pages/Learning';
import Forms from './pages/Forms';
import Agents from './pages/Agents';
import Welcome from './pages/Welcome';

type CountKey = 'questions' | 'inbox' | 'drafts' | 'needsYou';

interface RouteDef {
  path: string;
  label: string;
  icon: typeof Compass;
  el: () => React.JSX.Element | null;
  count?: CountKey;
  /** This page carries the sash itself, so the live strip stays off. */
  band?: boolean;
}

const GROUPS: RouteDef[][] = [
  [
    { path: 'overview', label: 'Overview', icon: Compass, el: Overview, band: true },
    { path: 'campaigns', label: 'Campaigns', icon: Target, el: Campaigns, band: true },
    { path: 'pipeline', label: 'Pipeline', icon: KanbanSquare, el: Pipeline, count: 'needsYou' },
    { path: 'questions', label: 'Questions', icon: CircleHelp, el: Questions, count: 'questions' },
    { path: 'inbox', label: 'Inbox', icon: InboxIcon, el: Inbox, count: 'inbox' },
    { path: 'digests', label: 'Digests', icon: Newspaper, el: Digests },
  ],
  [
    { path: 'jobs', label: 'Jobs', icon: Briefcase, el: Jobs },
    { path: 'studio', label: 'Studio', icon: Feather, el: Studio, count: 'drafts' },
    { path: 'dispatch', label: 'Dispatch', icon: Send, el: Dispatch },
    { path: 'forms', label: 'Forms', icon: Workflow, el: Forms },
    { path: 'learning', label: 'Learning', icon: GraduationCap, el: Learning },
  ],
  [
    { path: 'sources', label: 'Sources', icon: Radar, el: Sources },
    { path: 'profile', label: 'Profile', icon: UserRound, el: ProfilePage },
    { path: 'agents', label: 'Agents and API', icon: Bot, el: Agents },
    { path: 'settings', label: 'Settings', icon: Cog, el: SettingsPage },
  ],
];

const ROUTES: RouteDef[] = [...GROUPS.flat(), { path: 'welcome', label: 'Set up', icon: FileText, el: Welcome, band: true }];

/** The five places the owner checks from a phone. */
const PHONE_TABS = ['campaigns', 'pipeline', 'questions', 'inbox', 'digests'];

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

/** Change one query parameter on the current route (null removes it). */
export function setParam(key: string, value: string | null) {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const p = new URLSearchParams(query ?? '');
  if (value === null) p.delete(key);
  else p.set(key, value);
  const q = p.toString();
  window.location.hash = `/${path || 'overview'}${q ? `?${q}` : ''}`;
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
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f0a08' : '#2b1d15');
  }, [theme]);
  const dark = theme === 'dark';
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') };
}

/** Live state and badge counts for the shell; refreshed by the event stream. */
export function useShell(enabled = true) {
  return useQuery({ queryKey: ['shell'], queryFn: () => api<Shell>('/api/shell'), enabled, refetchInterval: 20_000 });
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

/** The kill switch. Always reachable while anything runs. */
export function KillSwitch({ size, label = 'Stop everything' }: { size?: 'sm'; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const kill = useMutation({
    mutationFn: () => post<{ ms: number; settled: boolean }>('/api/kill', { reason: reason.trim() || undefined }),
    onSuccess: (r) => {
      setOpen(false);
      setReason('');
      toast.success(`Everything is stopped (${(r.ms / 1000).toFixed(1)} s). Campaigns stay paused until you resume one.`);
      qc.invalidateQueries();
    },
    onError: toast.error,
  });
  return (
    <>
      <Btn size={size} className="danger kill" onClick={() => setOpen(true)} data-testid="kill-switch">
        <Square /> {label}
      </Btn>
      {open ? (
        <Modal
          title="Stop everything now?"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setOpen(false)}>
                Keep running
              </Btn>
              <Btn variant="primary" busy={kill.isPending} onClick={() => kill.mutate()} data-testid="kill-confirm">
                <Square /> Stop everything
              </Btn>
            </>
          }
        >
          <p style={{ margin: 0 }}>The form in progress is closed without submitting, every campaign pauses, and nothing more is sent until you resume a campaign.</p>
          <Field label="Reason (optional)" help="Shown in the activity log and the digest.">
            <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Checking the letters before going on" />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}

/** One line on every other page while a campaign runs, with the kill switch. */
function LiveBar({ shell }: { shell: Shell }) {
  const toast = useToast();
  const qc = useQueryClient();
  const clear = useMutation({
    mutationFn: () => del('/api/kill'),
    onSuccess: () => {
      toast.success('Kill switch cleared. Resume a campaign to carry on.');
      qc.invalidateQueries();
    },
    onError: toast.error,
  });
  if (shell.kill) {
    return (
      <div className="livebar killed" role="status">
        <span className="live-dot" aria-hidden="true" />
        <span className="text">
          Everything is stopped: {shell.kill.reason}. {shell.stopFile ? 'Delete data/STOP to clear it.' : 'Campaigns stay paused until you resume one.'}
        </span>
        {shell.stopFile ? null : (
          <Btn size="sm" busy={clear.isPending} onClick={() => clear.mutate()}>
            Clear
          </Btn>
        )}
      </div>
    );
  }
  const active = shell.campaigns.filter((c) => c.status === 'active');
  if (!active.length && !shell.current) return null;
  const name = active.length === 1 ? active[0].name : `${active.length} campaigns`;
  const mode = active.length && active.every((c) => c.dryRun) ? 'rehearsing' : 'live';
  const what = shell.current
    ? `Applying to ${shell.current.title ?? 'a role'}${shell.current.company ? ` at ${shell.current.company}` : ''}: ${shell.current.step.toLowerCase()}.`
    : shell.nextApplyAt
      ? `Next application ${until(shell.nextApplyAt)}.`
      : 'Waiting for the next job.';
  return (
    <div className="livebar" role="status">
      <span className="live-dot" aria-hidden="true" />
      <span className="text">
        <a href="#/campaigns" style={{ fontWeight: 600, textDecoration: 'none' }}>
          {name} is {mode}.
        </a>{' '}
        {what}
      </span>
      <span className="hide-phone">
        <KillSwitch size="sm" label="Stop" />
      </span>
    </div>
  );
}

function NavLinks({ routes, current, counts, onPick }: { routes: RouteDef[]; current: string; counts: Partial<Record<CountKey, number>>; onPick?: () => void }) {
  return (
    <>
      {routes.map((r) => (
        <a key={r.path} href={`#/${r.path}`} aria-current={r.path === current ? 'page' : undefined} onClick={onPick}>
          <r.icon size={17} strokeWidth={1.8} />
          <span>{r.label}</span>
          {r.count && counts[r.count] ? <span className="count">{counts[r.count]}</span> : null}
        </a>
      ))}
    </>
  );
}

interface OverviewLite {
  scanning: string | null;
  lastScan: { started_at: string; status: string } | null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [path] = useRoute();
  const theme = useTheme();
  const [menu, setMenu] = useState(false);
  useLiveInvalidation();

  useEffect(() => {
    loadSession().then(setSession);
    const onLocked = () => setSession((s) => (s ? { ...s, locked: true } : s));
    window.addEventListener('bureau:locked', onLocked);
    return () => window.removeEventListener('bureau:locked', onLocked);
  }, []);

  const unlocked = !!session && !session.locked;
  const shell = useShell(unlocked);
  const overview = useQuery({ queryKey: ['overview', 'lite'], queryFn: () => api<OverviewLite>('/api/overview'), enabled: unlocked, refetchInterval: 60_000 });

  const [scanLine, setScanLine] = useState<string | null>(null);
  useLive(
    useCallback((e: LiveEvent) => {
      if (e.type === 'scan') setScanLine(e.status === 'running' ? (e.message?.replace(/^\S+\s+/, '') ?? null) : null);
    }, []),
  );

  // A fresh install opens the setup wizard once; leaving it is always allowed.
  // A deep link (an alert's message or plan) is never hijacked: only a plain start does.
  const sentToWelcome = useRef(!/^#?\/?(overview)?$/.test(window.location.hash));
  useEffect(() => {
    if (shell.data?.onboarding.firstRun && !sentToWelcome.current && path !== 'welcome') {
      sentToWelcome.current = true;
      go('welcome');
    }
  }, [shell.data?.onboarding.firstRun, path]);

  useEffect(() => {
    const r = ROUTES.find((x) => x.path === path);
    document.title = r && r.path !== 'overview' ? `${r.label} | Bureau` : 'Bureau';
  }, [path]);

  if (!session) return null;
  if (session.locked) return <LockScreen onUnlock={setSession} />;

  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const Page = route.el;
  const counts: Partial<Record<CountKey, number>> = shell.data?.counts ?? {};
  const scanning = overview.data?.scanning;
  const s = shell.data;
  const running = !!s && (s.live || !!s.current);

  const lock = session.passphrase ? (
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
  ) : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/overview" aria-label="Bureau home">
          <Insignia size={28} />
          <div className="brand-name">Bureau</div>
        </a>
        <nav className="nav" aria-label="Main">
          {GROUPS.map((g, i) => (
            <div className="nav-group" key={i}>
              <NavLinks routes={g} current={route.path} counts={counts} />
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {running && !s?.kill ? <KillSwitch size="sm" /> : null}
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
                  : 'Not yet'}
            </div>
          </div>
          <div className="row">
            <Btn variant="ghost" size="sm" onClick={theme.toggle} aria-label="Toggle theme">
              {theme.dark ? <Sun /> : <Moon />}
              {theme.dark ? 'Day' : 'Night'}
            </Btn>
            <span className="spacer" />
            {lock}
          </div>
        </div>
      </aside>

      <header className="topbar">
        <a className="brand" href="#/overview" aria-label="Bureau home" style={{ padding: 0 }}>
          <Insignia size={24} />
          <div className="brand-name">Bureau</div>
        </a>
        <span className="spacer" />
        {running && !s?.kill ? <KillSwitch size="sm" label="Stop" /> : null}
        <Btn variant="ghost" icon onClick={() => setMenu(true)} aria-label="Open the menu">
          <Menu />
        </Btn>
      </header>

      <main className="main" id="main">
        {s && !route.band && (running || s.kill) ? <LiveBar shell={s} /> : null}
        <Page />
      </main>

      <nav className="tabbar" aria-label="Phone">
        {PHONE_TABS.map((p) => {
          const r = ROUTES.find((x) => x.path === p)!;
          return (
            <a key={p} href={`#/${p}`} aria-current={route.path === p ? 'page' : undefined}>
              <r.icon strokeWidth={1.8} />
              <span>{r.label}</span>
              {r.count && counts[r.count] ? <span className="count">{counts[r.count]}</span> : null}
            </a>
          );
        })}
      </nav>

      {menu ? (
        <Drawer title="Bureau" onClose={() => setMenu(false)}>
          <nav className="menu-nav" aria-label="All pages">
            {GROUPS.flat().map((r) => (
              <a key={r.path} href={`#/${r.path}`} aria-current={route.path === r.path ? 'page' : undefined} onClick={() => setMenu(false)}>
                <r.icon strokeWidth={1.8} />
                <span>{r.label}</span>
                {r.count && counts[r.count] ? <span className="count">{counts[r.count]}</span> : null}
              </a>
            ))}
          </nav>
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            <Btn variant="ghost" size="sm" onClick={theme.toggle}>
              {theme.dark ? <Sun /> : <Moon />}
              {theme.dark ? 'Day' : 'Night'}
            </Btn>
            <span className="spacer" />
            {lock}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
