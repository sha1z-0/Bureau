import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Radar, Save, Sparkles } from 'lucide-react';
import { api, post, put, useLive, type LiveEvent } from '../api';
import { Btn, Field, ListInput, Switch, ago, useToast } from '../ui';

interface SourcesData {
  connectors: { id: string; label: string; kind: string; homepage: string; description: string; enabled: boolean; jobs: number }[];
  boards: { greenhouse: string[]; lever: string[]; ashby: string[] };
  defaultBoards: { greenhouse: string[]; lever: string[]; ashby: string[] };
  extraKeywords: string[];
  maxAgeDays: number;
  scan: { intervalHours: number; scoreLimit: number; scoreThreshold: number };
}

interface ScanRow {
  id: string;
  kind: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  found: number;
  added: number;
  scored: number;
  error: string | null;
}

/** Live tail of a running scan. */
export function ScanConsole({ scanId }: { scanId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api<{ log: string[] }>(`/api/scans/${scanId}`).then((s) => setLines(s.log)).catch(() => {});
  }, [scanId]);
  useLive(
    useCallback(
      (e: LiveEvent) => {
        if (e.type === 'scan' && e.scanId === scanId && e.message) setLines((l) => [...l, e.message!].slice(-300));
      },
      [scanId],
    ),
  );
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines]);
  return (
    <div className="stack">
      <div className="row">
        <span className="spinner" style={{ color: 'var(--accent)' }} />
        <span className="label">Scanning</span>
      </div>
      <div className="console" ref={box} aria-live="polite">
        {lines.length ? lines.join('\n') : 'Waiting for the first report…'}
      </div>
    </div>
  );
}

export default function Sources() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sources'], queryFn: () => api<SourcesData>('/api/sources') });
  const scans = useQuery({ queryKey: ['scans'], queryFn: () => api<{ scans: ScanRow[]; running: string | null }>('/api/scans'), refetchInterval: (q) => (q.state.data?.running ? 4000 : false) });
  const [form, setForm] = useState<SourcesData | null>(null);
  const [focus, setFocus] = useState('');
  const [openLog, setOpenLog] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: () =>
      put('/api/sources', {
        enabled: Object.fromEntries(form!.connectors.map((c) => [c.id, c.enabled])),
        boards: form!.boards,
        extraKeywords: form!.extraKeywords,
        maxAgeDays: form!.maxAgeDays,
        scan: form!.scan,
      }),
    onSuccess: () => {
      toast.success('Sources saved.');
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: toast.error,
  });
  const scan = useMutation({
    mutationFn: (body: { kind: 'sources' | 'deep'; focus?: string }) => post('/api/scans', body),
    onSuccess: () => {
      toast.info('Scan started.');
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: toast.error,
  });

  if (!form) return <div className="skeleton" style={{ height: 300 }} />;
  const running = scans.data?.running;
  const setBoards = (k: keyof SourcesData['boards'], v: string[]) => setForm({ ...form, boards: { ...form.boards, [k]: v.map((s) => s.trim().toLowerCase()) } });
  const origin = window.location.origin;
  const bookmarklet = `javascript:(()=>{const t=(getSelection().toString()||document.body.innerText).slice(0,8000)+'\\n\\nSource: '+location.href;window.open('${origin}/#/jobs?capture='+encodeURIComponent(t),'_blank','noopener')})()`;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sources</h1>
          <p>Where Bureau looks: company career boards, remote-job sites and hiring threads. Public feeds only; Bureau never signs in to LinkedIn or Indeed, so your accounts stay safe.</p>
        </div>
        <div className="page-actions">
          <Btn busy={save.isPending} onClick={() => save.mutate()}>
            <Save /> Save
          </Btn>
          <Btn variant="primary" busy={!!running} onClick={() => scan.mutate({ kind: 'sources' })}>
            <Radar /> {running ? 'Scanning…' : 'Scan sources now'}
          </Btn>
        </div>
      </header>

      {running ? (
        <div className="card card-pad" style={{ marginBottom: 'var(--s-5)' }}>
          <ScanConsole scanId={running} />
        </div>
      ) : null}

      <div className="split">
        <div className="grid">
          <section className="card">
            <div className="card-head">
              <h2>Sources</h2>
              <span className="muted mono">{form.connectors.filter((c) => c.enabled).length} active</span>
            </div>
            {form.connectors.map((c, i) => (
              <div key={c.id} className="toggle-row" style={{ padding: '14px var(--s-5)' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{c.label}</strong>
                    <span className="tag">{c.kind}</span>
                    <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                      {c.jobs} roles
                    </span>
                    <a href={c.homepage} target="_blank" rel="noopener noreferrer" className="faint" aria-label={`${c.label} website`}>
                      <ExternalLink size={13} />
                    </a>
                  </div>
                  <div className="muted" style={{ fontSize: '0.8125rem' }}>
                    {c.description}
                  </div>
                </div>
                <Switch
                  label={c.label}
                  checked={c.enabled}
                  onChange={(v) => {
                    const connectors = [...form.connectors];
                    connectors[i] = { ...c, enabled: v };
                    setForm({ ...form, connectors });
                  }}
                />
              </div>
            ))}
          </section>

          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
              Company boards
            </h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
              Add the companies you’d love to work for. The name to add is the last part of their careers address: <code>boards.greenhouse.io/<b>discord</b></code>, <code>jobs.lever.co/<b>spotify</b></code>, <code>jobs.ashbyhq.com/<b>linear</b></code>.
            </p>
            <div className="stack" style={{ gap: 'var(--s-4)' }}>
              <Field label={`Greenhouse (${form.boards.greenhouse.length} companies)`}>
                <ListInput value={form.boards.greenhouse} onChange={(v) => setBoards('greenhouse', v)} />
              </Field>
              <Field label={`Lever (${form.boards.lever.length} companies)`}>
                <ListInput value={form.boards.lever} onChange={(v) => setBoards('lever', v)} />
              </Field>
              <Field label={`Ashby (${form.boards.ashby.length} companies)`}>
                <ListInput value={form.boards.ashby} onChange={(v) => setBoards('ashby', v)} />
              </Field>
              <div>
                <Btn variant="ghost" size="sm" onClick={() => setForm({ ...form, boards: form.defaultBoards })}>
                  Restore the curated list
                </Btn>
              </div>
            </div>
          </section>
        </div>

        <div className="grid">
          <section className="card card-pad" style={{ background: 'linear-gradient(160deg, var(--accent-soft), var(--surface) 60%)' }}>
            <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
              Search the web with Claude
            </h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
              Claude searches the open web for you: company career pages, niche security and game-dev boards, and hiring posts on LinkedIn, X, Reddit and HN that never reach an aggregator. Each URL is checked against real search results. A scan uses about 12 web searches.
            </p>
            <Field label="Focus (optional)">
              <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. remote AppSec roles at fintechs in Europe" />
            </Field>
            <div className="row" style={{ marginTop: 'var(--s-3)' }}>
              <Btn variant="primary" disabled={!!running} busy={scan.isPending && scan.variables?.kind === 'deep'} onClick={() => scan.mutate({ kind: 'deep', focus })}>
                <Sparkles /> Search the web
              </Btn>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
              Cadence
            </h2>
            <div className="form-grid">
              <Field label="Auto-scan every (hours)" help="0 turns it off. Runs while Bureau is open.">
                <input className="input" type="number" min={0} max={168} value={form.scan.intervalHours} onChange={(e) => setForm({ ...form, scan: { ...form.scan, intervalHours: Number(e.target.value) } })} />
              </Field>
              <Field label="Ignore postings older than (days)">
                <input className="input" type="number" min={1} max={120} value={form.maxAgeDays} onChange={(e) => setForm({ ...form, maxAgeDays: Number(e.target.value) })} />
              </Field>
              <Field label="Claude assesses per scan" help="The top N by pre-filter score.">
                <input className="input" type="number" min={0} max={200} value={form.scan.scoreLimit} onChange={(e) => setForm({ ...form, scan: { ...form.scan, scoreLimit: Number(e.target.value) } })} />
              </Field>
              <Field label="Minimum pre-filter score" help="Below this, no tokens are spent.">
                <input className="input" type="number" min={0} max={100} value={form.scan.scoreThreshold} onChange={(e) => setForm({ ...form, scan: { ...form.scan, scoreThreshold: Number(e.target.value) } })} />
              </Field>
              <Field label="Extra search keywords" full>
                <ListInput value={form.extraKeywords} onChange={(v) => setForm({ ...form, extraKeywords: v })} placeholder="e.g. Rust, Unreal, SOC 2" />
              </Field>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
              Add jobs from any page
            </h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
              Add this bookmarklet to your browser's bookmarks bar. On any job post (LinkedIn, X, a company page), select the text and click it to send the post to Bureau. It opens Bureau in a new tab and you confirm the capture there, so nothing is sent without your click.
            </p>
            <div className="row">
              <code style={{ flex: 1, minWidth: 0, fontSize: '0.6875rem', padding: '8px 10px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'block' }}>
                {bookmarklet}
              </code>
              <Btn
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(bookmarklet);
                  toast.success('Bookmarklet copied. Create a bookmark and paste it as the URL.');
                }}
              >
                <Copy size={14} /> Copy
              </Btn>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Recent scans</h2>
            </div>
            <table className="table">
              <tbody>
                {(scans.data?.scans ?? []).slice(0, 10).map((s) => (
                  <tr key={s.id} onClick={() => setOpenLog(openLog === s.id ? null : s.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className={`tag ${s.status === 'done' ? 'olive' : s.status === 'failed' ? 'crimson' : 'brass'}`}>{s.kind === 'deep' ? 'deep' : 'sources'}</span>
                    </td>
                    <td className="muted">{ago(s.startedAt)}</td>
                    <td style={{ fontSize: 'var(--t-xs)' }}>
                      {s.added} new, {s.scored} scored
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {openLog ? <ScanLog id={openLog} /> : null}
          </section>
        </div>
      </div>
    </>
  );
}

function ScanLog({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['scans', id], queryFn: () => api<{ log: string[]; error: string | null }>(`/api/scans/${id}`) });
  return (
    <div style={{ padding: 'var(--s-4)' }}>
      <div className="console">{data ? data.log.join('\n') || data.error || 'No log.' : 'Loading…'}</div>
    </div>
  );
}
