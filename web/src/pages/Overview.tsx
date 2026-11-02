import { useMutation, useQuery } from '@tanstack/react-query';
import { Radar, Sparkles } from 'lucide-react';
import { api, post, CATEGORY_LABEL, type Category, type Profile } from '../api';
import { Btn, Empty, Seal, ago, sourceLabel, useToast } from '../ui';
import { ScanConsole } from './Sources';
import { CampaignBand } from './Campaigns';
import { useShell } from '../App';

interface OverviewData {
  totals: { jobs: number; newThisWeek: number; scored: number; strong: number; drafts: number; approved: number; applied: number; interviews: number; needsYou: number };
  byCategory: { category: Category; n: number }[];
  byStage: { stage: string; n: number }[];
  top: { id: string; title: string; company: string; location: string; remote: boolean; score: number; grade: string; verdict: string | null; source: string }[];
  activity: { id: number; ts: string; kind: string; message: string; jobId: string | null }[];
  scanning: string | null;
  spend: { month: number; budget: number };
  setup: { apiKey: boolean; profile: boolean; smtp: boolean };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

const STAGES = [
  ['found', 'Found', 'var(--steel)'],
  ['drafted', 'Drafted', 'var(--leather-soft)'],
  ['applied', 'Applied', 'var(--leather)'],
  ['interview', 'Interview', 'var(--accent)'],
  ['offer', 'Offer', 'var(--good)'],
] as const;

export default function Overview() {
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['overview'], queryFn: () => api<OverviewData>('/api/overview') });
  const shell = useShell();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<{ profile: Profile | null }>('/api/profile') });
  const scan = useMutation({
    mutationFn: (kind: 'sources' | 'deep') => post<{ id: string }>('/api/scans', { kind }),
    onSuccess: (_r, kind) => toast.info(kind === 'deep' ? 'Claude is searching the web for roles. New ones appear as they’re found.' : 'Scanning every source. New roles appear as they come in.'),
    onError: toast.error,
  });

  if (isLoading || !data) return <div className="skeleton" style={{ height: 320 }} />;
  const first = profile.data?.profile?.name?.split(' ')[0];
  const stage = Object.fromEntries(data.byStage.map((s) => [s.stage, s.n]));
  const maxStage = Math.max(1, ...STAGES.map(([k]) => stage[k] ?? 0));

  return (
    <>
      <header className="page-head">
        <h1>
          {greeting()}
          {first ? `, ${first}` : ''}.
        </h1>
        <div className="page-actions">
          <Btn
            onClick={() => scan.mutate('deep')}
            busy={scan.isPending && scan.variables === 'deep'}
            disabled={!!data.scanning || !data.setup.apiKey || !data.setup.profile}
            title="Claude searches career pages, niche boards and social posts for you"
          >
            <Sparkles /> Search the web
          </Btn>
          <Btn onClick={() => scan.mutate('sources')} busy={(scan.isPending && scan.variables === 'sources') || !!data.scanning}>
            <Radar /> {data.scanning ? 'Scanning…' : 'Scan sources'}
          </Btn>
        </div>
      </header>

      <CampaignBand />

      {shell.data && !shell.data.onboarding.done && shell.data.onboarding.ready < shell.data.onboarding.total ? (
        <div className="livebar">
          <span className="text">
            Setup is {shell.data.onboarding.ready} of {shell.data.onboarding.total} done. The voice bank, answer bank and a mailbox make every application better.
          </span>
          <a className="btn sm" href="#/welcome">
            Continue setting up
          </a>
        </div>
      ) : null}

      {data.scanning ? (
        <div className="card card-pad" style={{ marginBottom: 'var(--s-4)' }}>
          <ScanConsole scanId={data.scanning} />
        </div>
      ) : null}

      <div className="summary">
        <a href="#/jobs">
          <strong>{data.totals.jobs.toLocaleString()}</strong>
          <span>roles tracked, {data.totals.newThisWeek.toLocaleString()} new this week</span>
        </a>
        <a href="#/jobs?min=78">
          <strong>{data.totals.strong}</strong>
          <span>strong matches of {data.totals.scored} scored</span>
        </a>
        {shell.data && (shell.data.counts.questions || shell.data.counts.needsYou) ? (
          <a href={shell.data.counts.questions ? '#/questions' : '#/pipeline?view=list&state=needs_you'}>
            <strong>{shell.data.counts.questions + shell.data.counts.needsYou}</strong>
            <span>
              waiting on you: {shell.data.counts.questions} questions, {shell.data.counts.needsYou} jobs
            </span>
          </a>
        ) : null}
        <a href="#/pipeline?view=stages">
          <strong>{data.totals.applied}</strong>
          <span>applied, {data.totals.interviews} at interview or offer</span>
        </a>
        <a href="#/settings">
          <strong>${data.spend.month.toFixed(2)}</strong>
          <span>Claude spend this month{data.spend.budget ? ` of $${data.spend.budget}` : ''}</span>
        </a>
      </div>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>Best matches waiting</h2>
            <a className="btn ghost sm" href="#/jobs">
              See all jobs
            </a>
          </div>
          {data.top.length ? (
            data.top.map((j) => (
              <a key={j.id} className="contract" href={`#/jobs?id=${j.id}`}>
                <Seal grade={j.grade} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{j.title}</div>
                  <div className="meta">
                    <span style={{ color: 'var(--text)' }}>{j.company}</span>
                    <span>{j.remote ? 'Remote' : j.location || 'Location not given'}</span>
                    <span>{sourceLabel(j.source)}</span>
                  </div>
                  {j.verdict ? (
                    <div className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 4 }}>
                      {j.verdict}
                    </div>
                  ) : null}
                </div>
                <div className="score">{j.score}</div>
              </a>
            ))
          ) : (
            <Empty title="No scored roles yet">Start a campaign, or scan sources and score a few roles in Jobs. The best ones show up here with Claude’s one-line verdict.</Empty>
          )}
        </section>

        <div className="grid">
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
              Where things stand
            </h2>
            <div className="funnel">
              {STAGES.map(([key, label, color]) => (
                <div className="funnel-row" key={key}>
                  <span className="muted">{label}</span>
                  <div className="track">
                    <i style={{ width: `${((stage[key] ?? 0) / maxStage) * 100}%`, background: color }} />
                  </div>
                  <span style={{ textAlign: 'right' }}>{(stage[key] ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="chips" style={{ marginTop: 'var(--s-5)' }}>
              {data.byCategory
                .sort((a, b) => b.n - a.n)
                .map((c) => (
                  <a key={c.category} className="chip" href={`#/jobs?category=${c.category}`} style={{ textDecoration: 'none' }}>
                    {CATEGORY_LABEL[c.category] ?? c.category}
                    <span className="faint">{c.n}</span>
                  </a>
                ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Recent activity</h2>
            </div>
            {data.activity.length ? (
              <ul className="ledger">
                {data.activity.slice(0, 10).map((a) => (
                  <li key={a.id}>
                    <time dateTime={a.ts}>{ago(a.ts)}</time>
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                Scans, applications and replies are logged here as they happen.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
