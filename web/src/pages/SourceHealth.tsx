import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Radar, Search } from 'lucide-react';
import { api, patch, post, type Company, type ScoutHealth } from '../api';
import { Btn, Field, ago, useToast } from '../ui';
import { Stat } from '../kit';

export const HEALTH_LABEL: Record<string, string> = { ok: 'Healthy', slow: 'Slow', failing: 'Failing', unavailable: 'Not set up', disabled: 'Off', idle: 'Not run yet' };
export const HEALTH_TONE: Record<string, string> = { ok: 'olive', slow: 'brass', failing: 'crimson', unavailable: 'brass' };

export function HealthPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['scout', 'health'], queryFn: () => api<ScoutHealth>('/api/scout/health'), refetchInterval: (q) => (q.state.data?.running ? 5000 : 60_000) });
  const run = useMutation({
    mutationFn: () => post<{ started: boolean; joined: boolean }>('/api/scout/run', {}),
    onSuccess: (r) => {
      toast.info(r.joined ? 'A scout run is already going; it was joined.' : 'Scouting every source now. It can take ten minutes.');
      qc.invalidateQueries({ queryKey: ['scout'] });
    },
    onError: toast.error,
  });
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  const enabled = data.sources.filter((s) => s.status !== 'disabled');
  const bad = enabled.filter((s) => s.status === 'failing' || s.status === 'unavailable').length;
  const order: Record<string, number> = { failing: 0, unavailable: 1, slow: 2, ok: 3, idle: 4, disabled: 5 };
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <section className="card card-pad">
        <div className="row wrap" style={{ marginBottom: 'var(--s-4)' }}>
          <h2 className="section-title">Last scout run</h2>
          <span className="spacer" />
          <Btn busy={run.isPending || data.running} onClick={() => run.mutate()}>
            <Radar /> {data.running ? 'Scouting…' : 'Scout now'}
          </Btn>
        </div>
        <div className="stats">
          <Stat label="Finished" value={data.lastRun?.finishedAt ? ago(data.lastRun.finishedAt) : data.running ? 'Running' : 'Never'} sub={data.lastRun ? `Took ${Math.round(data.lastRun.ms / 60000)} min` : undefined} />
          <Stat label="Postings seen" value={(data.lastRun?.found ?? 0).toLocaleString()} />
          <Stat label="New jobs" value={(data.lastRun?.added ?? 0).toLocaleString()} />
          <Stat label="Unique in 24 hours" value={(data.lastRun?.uniqueLast24h ?? 0).toLocaleString()} />
          <Stat label="Sources in trouble" value={bad} sub={`of ${enabled.length} switched on`} />
        </div>
      </section>
      <section className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Health</th>
              <th className="num">Seen</th>
              <th className="num">New</th>
              <th className="num hide-phone">Duplicates</th>
              <th className="num hide-phone">Time</th>
              <th className="hide-phone">Last run</th>
            </tr>
          </thead>
          <tbody>
            {[...data.sources]
              .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.added - a.added)
              .map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.label}</div>
                    {s.lastError && s.status !== 'disabled' ? (
                      <div style={{ fontSize: 'var(--t-xs)', color: s.status === 'failing' ? 'var(--bad)' : 'var(--text-2)' }}>{s.lastError}</div>
                    ) : null}
                    {s.boardsOk !== undefined ? (
                      <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                        {s.boardsOk} company boards read{s.boardsFailed ? `, ${s.boardsFailed} failed` : ''}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`tag ${HEALTH_TONE[s.status] ?? ''}`}>{HEALTH_LABEL[s.status] ?? s.status}</span>
                  </td>
                  <td className="num">{s.found.toLocaleString()}</td>
                  <td className="num">{s.added.toLocaleString()}</td>
                  <td className="num hide-phone">{s.dupes.toLocaleString()}</td>
                  <td className="num hide-phone">{s.ms ? `${(s.ms / 1000).toFixed(0)} s` : ''}</td>
                  <td className="muted hide-phone">{s.lastRunAt ? ago(s.lastRunAt) : 'Never'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
      <section className="card card-pad">
        <div className="row" style={{ marginBottom: 'var(--s-2)' }}>
          <h2 className="section-title">JobSpy sidecar</h2>
          <span className="spacer" />
          <span className={`tag ${data.jobspy.available ? 'olive' : 'brass'}`}>{data.jobspy.available ? 'Ready' : 'Not set up'}</span>
        </div>
        <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
          Guest searches on LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Bayt and Naukri through a small Python helper. Bureau never signs in to them.
        </p>
        {data.jobspy.available ? (
          <p style={{ fontSize: 'var(--t-sm)', marginTop: 'var(--s-2)' }}>
            JobSpy {data.jobspy.version} on Python {data.jobspy.python}.
          </p>
        ) : (
          <div className="stack" style={{ gap: 6, fontSize: 'var(--t-sm)', marginTop: 'var(--s-2)' }}>
            {data.jobspy.reason ? <span className="muted">{data.jobspy.reason}</span> : null}
            <span>Install Python 3.10 or newer, then run this once in the Bureau folder:</span>
            <code style={{ display: 'block', padding: '8px 10px' }}>powershell -ExecutionPolicy Bypass -File scripts/setup-sidecar.ps1</code>
            <span className="faint">On Linux or macOS: bash scripts/setup-sidecar.sh. Restart Bureau afterwards.</span>
          </div>
        )}
      </section>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { active: 'Polled', employer: 'Employer only', unsupported: 'ATS not supported', dead: 'Board gone', paused: 'Paused' };
const STATUS_TONE: Record<string, string> = { active: 'olive', paused: 'brass', dead: 'crimson' };

export function CompaniesPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [ats, setAts] = useState('');
  const [status, setStatus] = useState('');
  const [signals, setSignals] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const stats = useQuery({ queryKey: ['scout', 'stats'], queryFn: () => api<{ registry: { total: number; byStatus: Record<string, number>; byAts: Record<string, number>; withSignals: number } }>('/api/scout/stats') });
  const params = new URLSearchParams({ limit: '100' });
  if (search) params.set('q', search);
  if (ats) params.set('ats', ats);
  if (status) params.set('status', status);
  if (signals) params.set('signals', '1');
  const list = useQuery({ queryKey: ['scout', 'companies', params.toString()], queryFn: () => api<{ companies: Company[]; total: number }>(`/api/scout/companies?${params}`) });
  const add = useMutation({
    mutationFn: () => post<{ company: Company; created: boolean; detectedVia: string | null }>('/api/scout/companies', { url: url.trim(), name: name.trim() || undefined }),
    onSuccess: (r) => {
      setUrl('');
      setName('');
      toast.success(r.company.ats ? `${r.company.name}: ${r.company.ats} detected${r.created ? '' : ' (already known)'}. Its roles come in with the next scout run.` : `${r.company.name} added, but no supported ATS was found on that page.`);
      qc.invalidateQueries({ queryKey: ['scout'] });
    },
    onError: toast.error,
  });
  const setState = useMutation({
    mutationFn: ({ id, s }: { id: string; s: 'active' | 'paused' }) => patch(`/api/scout/companies/${id}`, { status: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scout', 'companies'] }),
    onError: toast.error,
  });
  const reg = stats.data?.registry;
  const atsList = Object.keys(reg?.byAts ?? {}).sort();
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="split">
        <section className="card card-pad">
          <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
            Add a company
          </h2>
          <p className="muted" style={{ fontSize: 'var(--t-sm)', marginBottom: 'var(--s-3)' }}>
            Paste its careers page. Bureau works out which applicant system it uses and polls it from then on.
          </p>
          <div className="form-grid">
            <Field label="Careers page" full>
              <input className="input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/acme or acme.com/careers" />
            </Field>
            <Field label="Name (optional)">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="field" style={{ alignContent: 'end' }}>
              <Btn busy={add.isPending} disabled={url.trim().length < 3} onClick={() => add.mutate()}>
                <Plus /> Add and detect
              </Btn>
            </div>
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
            The registry
          </h2>
          <div className="stats">
            <Stat label="Companies" value={(reg?.total ?? 0).toLocaleString()} />
            <Stat label="Polled" value={(reg?.byStatus.active ?? 0).toLocaleString()} />
            <Stat label="Hiring signals" value={(reg?.withSignals ?? 0).toLocaleString()} sub="Sudden jumps in open roles, or funding news" />
          </div>
          <p className="muted" style={{ fontSize: 'var(--t-xs)', marginTop: 'var(--s-3)' }}>
            It grows by itself: every apply link Bureau sees is checked for a known applicant system.
          </p>
        </section>
      </div>
      <div className="toolbar">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <Search />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q.trim())} placeholder="Search name or domain" aria-label="Search companies" />
        </form>
        <select className="select" style={{ width: 'auto' }} value={ats} onChange={(e) => setAts(e.target.value)} aria-label="ATS">
          <option value="">Every ATS</option>
          {atsList.map((a) => (
            <option key={a} value={a}>
              {a} ({reg?.byAts[a]})
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="chip" aria-pressed={signals} onClick={() => setSignals(!signals)}>
          With hiring signals
        </button>
      </div>
      <section className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>ATS</th>
              <th className="num">Open roles</th>
              <th className="hide-phone">Signals</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data?.companies ?? []).map((c) => {
              const delta = c.openRoles !== null && c.prevOpenRoles !== null ? c.openRoles - c.prevOpenRoles : 0;
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.careersUrl ? <a href={c.careersUrl} target="_blank" rel="noopener noreferrer">{c.name}</a> : c.name}</div>
                    <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                      {c.domain ?? c.atsToken ?? ''}
                      {c.lastCheckedAt ? `, checked ${ago(c.lastCheckedAt)}` : ''}
                    </div>
                  </td>
                  <td>{c.ats ?? <span className="faint">Unknown</span>}</td>
                  <td className="num">
                    {c.openRoles ?? '–'}
                    {delta ? <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>{delta > 0 ? `up ${delta}` : `down ${-delta}`}</div> : null}
                  </td>
                  <td className="hide-phone">
                    {c.signals.slice(-2).map((s, i) => (
                      <div key={i} style={{ fontSize: 'var(--t-xs)' }}>
                        {String(s.detail ?? s.type ?? '')} <span className="faint">{s.at ? ago(String(s.at)) : ''}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    <span className={`tag ${STATUS_TONE[c.status] ?? ''}`}>{STATUS_LABEL[c.status] ?? c.status}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {c.status === 'active' ? (
                      <Btn size="sm" variant="ghost" onClick={() => setState.mutate({ id: c.id, s: 'paused' })}>
                        Pause
                      </Btn>
                    ) : c.status === 'paused' && c.ats ? (
                      <Btn size="sm" variant="ghost" onClick={() => setState.mutate({ id: c.id, s: 'active' })}>
                        Poll again
                      </Btn>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.data && !list.data.companies.length ? <p className="muted" style={{ padding: 'var(--s-5)' }}>No companies match.</p> : null}
        {list.data && list.data.total > list.data.companies.length ? (
          <p className="faint" style={{ padding: 'var(--s-3) var(--s-5)', fontSize: 'var(--t-xs)' }}>
            Showing {list.data.companies.length} of {list.data.total.toLocaleString()}. Search to narrow it down.
          </p>
        ) : null}
      </section>
    </div>
  );
}
