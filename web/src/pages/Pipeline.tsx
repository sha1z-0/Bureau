import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, PIPELINE_STATES, type PipelineItem, type PipelineState } from '../api';
import { setParam, useRoute } from '../App';
import { Seal, ago } from '../ui';
import { PageHead, STATE_LABEL, StateTag, Tabs, stamp } from '../kit';
import { useCampaigns } from './Campaigns';
import JobTimeline from './JobTimeline';
import { StagesBoard } from './StagesBoard';

type View = 'board' | 'list' | 'stages';

/** The board shows the states where something is happening or waiting on you. */
const LANES: { title: string; hint: string; states: PipelineState[] }[] = [
  { title: 'Queued', hint: 'Picked, waiting their turn', states: ['selected'] },
  { title: 'Writing', hint: 'CV and letter', states: ['writing', 'written'] },
  { title: 'Applying', hint: 'Filling and checking the form', states: ['filling', 'verified'] },
  { title: 'Needs you', hint: 'Bureau stopped short', states: ['needs_you'] },
  { title: 'Rehearsed', hint: 'Filled and checked, not sent', states: ['rehearsed'] },
  { title: 'Sent', hint: 'With proof', states: ['submitted'] },
  { title: 'Failed', hint: 'Retried with a pause', states: ['failed'] },
];

const BOARD_STATES = LANES.flatMap((l) => l.states);
const LANE_LIMIT = 40;

function useIsPhone() {
  const q = '(max-width: 820px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

function Card({ r }: { r: PipelineItem }) {
  return (
    <button className="kcard" style={{ cursor: 'pointer', border: 0, textAlign: 'left', font: 'inherit', color: 'inherit', width: '100%' }} onClick={() => setParam('job', r.jobId)}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Seal grade={r.job.grade === 'F' ? 'D' : r.job.grade} size="sm" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{r.job.title}</div>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>
            {r.job.company}
          </div>
        </div>
      </div>
      {r.lastError && (r.state === 'needs_you' || r.state === 'failed') ? (
        <div className="muted" style={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
          {r.lastError.slice(0, 140)}
        </div>
      ) : null}
      <div className="row faint" style={{ fontSize: '0.75rem' }}>
        <span>{r.state === 'written' || r.state === 'verified' ? STATE_LABEL[r.state] : r.job.ats ?? (r.job.remote ? 'Remote' : r.job.location)}</span>
        <span className="spacer" />
        <span>{ago(r.updatedAt)}</span>
      </div>
    </button>
  );
}

function ListView({ rows }: { rows: PipelineItem[] }) {
  if (!rows.length)
    return (
      <div className="card">
        <div className="empty">
          <h3>Nothing here</h3>
          <p>No jobs match these filters.</p>
        </div>
      </div>
    );
  return (
    <section className="list" aria-label="Jobs">
      {rows.map((r) => (
        <button key={r.jobId} className="list-row" onClick={() => setParam('job', r.jobId)}>
          <div style={{ minWidth: 0, display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 'var(--s-3)', alignItems: 'start' }}>
            <Seal grade={r.job.grade === 'F' ? 'D' : r.job.grade} size="sm" />
            <div style={{ minWidth: 0 }}>
              <div className="title">{r.job.title}</div>
              <div className="meta">
                <span style={{ color: 'var(--text)' }}>{r.job.company}</span>
                <span>{r.job.remote ? 'Remote' : r.job.location || 'Location not given'}</span>
                {r.campaignName ? <span className="hide-phone">{r.campaignName}</span> : null}
                <span>{stamp(r.updatedAt)}</span>
              </div>
              {r.lastError && (r.state === 'needs_you' || r.state === 'failed' || r.state === 'skipped') ? (
                <div className="muted" style={{ fontSize: 'var(--t-xs)', marginTop: 2 }}>
                  {r.lastError.slice(0, 160)}
                </div>
              ) : null}
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--s-3)' }}>
            <span className="num hide-phone" style={{ fontWeight: 600 }}>
              {r.job.score ?? ''}
            </span>
            <StateTag state={r.state} />
          </div>
        </button>
      ))}
    </section>
  );
}

export default function Pipeline() {
  const [, params] = useRoute();
  const phone = useIsPhone();
  const view = (params.get('view') as View) || (params.get('state') || phone ? 'list' : 'board');
  const campaign = params.get('campaign') ?? '';
  const stateFilter = params.get('state');
  const job = params.get('job');
  const [q, setQ] = useState(params.get('q') ?? '');
  const campaigns = useCampaigns();

  const states = view === 'board' ? BOARD_STATES : stateFilter ? (stateFilter.split(',') as PipelineState[]) : [...PIPELINE_STATES];
  const query = new URLSearchParams({ state: states.join(','), limit: view === 'board' ? '600' : '300' });
  if (campaign) query.set('campaignId', campaign);
  if (params.get('q')) query.set('q', params.get('q')!);
  const { data, isLoading } = useQuery({ queryKey: ['pipeline', view, campaign, stateFilter, params.get('q')], queryFn: () => api<{ counts: Partial<Record<PipelineState, number>>; rows: PipelineItem[] }>(`/api/pipeline?${query}`), refetchInterval: 30_000 });
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHead title="Pipeline" lede="Every job the campaigns touched, from found to sent. Open one to see why it was picked, what was written, how the form went and what came back." />
      <div className="toolbar">
        <Tabs<View>
          label="View"
          value={view}
          onChange={(v) => {
            setParam('state', null);
            setParam('view', v);
          }}
          items={[
            { id: 'board', label: 'Board' },
            { id: 'list', label: 'List' },
            { id: 'stages', label: 'After sending' },
          ]}
        />
        {view !== 'stages' ? (
          <>
            <select className="select" style={{ width: 'auto', minWidth: 160 }} value={campaign} onChange={(e) => setParam('campaign', e.target.value || null)} aria-label="Campaign">
              <option value="">Every campaign</option>
              {campaigns.data?.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">Outside campaigns</option>
            </select>
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                setParam('q', q.trim() || null);
              }}
            >
              <Search />
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setParam('q', q.trim() || null)} placeholder="Search title or company" aria-label="Search" />
            </form>
          </>
        ) : null}
      </div>

      {view !== 'stages' ? (
        <div className="chips" style={{ marginBottom: 'var(--s-4)' }} role="group" aria-label="Filter by state">
          <button className="chip" aria-pressed={view === 'list' && !stateFilter} onClick={() => {
              window.location.hash = `/pipeline?view=list${campaign ? `&campaign=${campaign}` : ''}`;
            }}>
            All <span className="faint">{total.toLocaleString()}</span>
          </button>
          {PIPELINE_STATES.filter((s) => counts[s]).map((s) => (
            <button
              key={s}
              className="chip"
              aria-pressed={stateFilter === s}
              onClick={() => {
                window.location.hash = `/pipeline?view=list&state=${s}${campaign ? `&campaign=${campaign}` : ''}`;
              }}
            >
              {STATE_LABEL[s]} <span className="faint">{(counts[s] ?? 0).toLocaleString()}</span>
            </button>
          ))}
        </div>
      ) : null}

      {view === 'stages' ? (
        <StagesBoard />
      ) : isLoading ? (
        <div className="skeleton" style={{ height: 360 }} />
      ) : view === 'list' ? (
        <ListView rows={data?.rows ?? []} />
      ) : total === 0 ? (
        <div className="card">
          <div className="empty">
            <h3>The pipeline is empty</h3>
            <p>Start a campaign and the jobs it finds, picks and applies to show up here, each with its full story.</p>
            <a className="btn" href="#/campaigns">
              Go to Campaigns
            </a>
          </div>
        </div>
      ) : (
        <div className="kanban">
          {LANES.map((lane) => {
            const cards = (data?.rows ?? []).filter((r) => lane.states.includes(r.state));
            const n = lane.states.reduce((a, s) => a + (counts[s] ?? 0), 0);
            return (
              <section key={lane.title} className="lane" aria-label={lane.title}>
                <div className="lane-head">
                  <div>
                    <h3>{lane.title}</h3>
                    <div className="faint" style={{ fontSize: '0.75rem' }}>
                      {lane.hint}
                    </div>
                  </div>
                  <span className="muted num">{n.toLocaleString()}</span>
                </div>
                <div className="lane-body">
                  {cards.slice(0, LANE_LIMIT).map((r) => (
                    <Card key={r.jobId} r={r} />
                  ))}
                  {n > LANE_LIMIT ? (
                    <a className="btn ghost sm" href={`#/pipeline?view=list&state=${lane.states.join(',')}${campaign ? `&campaign=${campaign}` : ''}`}>
                      Show all {n.toLocaleString()}
                    </a>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {job ? <JobTimeline jobId={job} onClose={() => setParam('job', null)} /> : null}
    </>
  );
}
