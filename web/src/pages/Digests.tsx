import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { api, post, type DigestApp, type DigestContent, type StoredDigest } from '../api';
import { setParam, useRoute } from '../App';
import { Btn, useToast } from '../ui';
import { PageHead, Stat, usd } from '../kit';
import { useCampaigns } from './Campaigns';

function AppRows({ apps, verb }: { apps: DigestApp[]; verb: string }) {
  return (
    <div className="list" style={{ background: 'var(--bg)' }}>
      {apps.map((a) => (
        <a key={a.jobId} className="list-row" href={`#/pipeline?job=${a.jobId}`}>
          <div style={{ minWidth: 0 }}>
            <div className="title">{a.role}</div>
            <div className="meta">
              <span>{a.company}</span>
              <span>
                {verb} by {a.channel === 'email' ? 'email' : 'form'}
              </span>
              {a.shotUrl ? <span>Screenshot kept</span> : null}
            </div>
          </div>
          <span className="num muted">{a.score ?? ''}</span>
        </a>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--s-2)' }}>
      <h3 style={{ fontSize: 'var(--t-md)', fontWeight: 600 }}>{title}</h3>
      {children}
    </section>
  );
}

export function DigestView({ d }: { d: DigestContent }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      {d.modeNote ? <div className="callout">{d.modeNote}</div> : null}
      <div className="stats">
        <Stat label="Sent" value={d.totals.sent} sub={`${d.totals.sentAllTime} in total`} />
        <Stat label="Rehearsed" value={d.totals.rehearsed} sub={`${d.totals.rehearsedAllTime} in total`} />
        <Stat label="Skipped" value={d.totals.skipped} />
        <Stat label="Needs you" value={d.totals.needsYou} href="#/pipeline?state=needs_you" />
        <Stat label="In the queue" value={d.totals.queued} />
        <Stat label="Spent today" value={usd(d.spend.todayUsd)} sub={`${usd(d.spend.monthUsd)} this month`} />
      </div>
      {d.inbox.interviews.length ? (
        <Section title="Interviews and assessments">
          <ul className="list-dash">
            {d.inbox.interviews.map((i, n) => (
              <li key={n}>
                <strong>{i.company}</strong>: {i.summary}
                {i.deadline ? ` Reply by ${new Date(i.deadline).toLocaleString()}.` : ''}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {d.sent.length ? (
        <Section title="Sent">
          <AppRows apps={d.sent} verb="Sent" />
        </Section>
      ) : null}
      {d.rehearsed.length ? (
        <Section title="Rehearsed (filled and checked, not sent)">
          <AppRows apps={d.rehearsed} verb="Rehearsed" />
        </Section>
      ) : null}
      {d.needsYou.length ? (
        <Section title="Needs you">
          <div className="list" style={{ background: 'var(--bg)' }}>
            {d.needsYou.map((n) => (
              <a key={n.jobId} className="list-row" href={`#/pipeline?job=${n.jobId}`}>
                <div style={{ minWidth: 0 }}>
                  <div className="title">
                    {n.role} at {n.company}
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--t-sm)' }}>
                    {n.reason}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </Section>
      ) : null}
      {d.questions.length ? (
        <Section title="New questions for your answer bank">
          <ul className="list-dash">
            {d.questions.map((q) => (
              <li key={q.id}>
                {q.question}
                {q.company ? <span className="muted"> ({q.company})</span> : null}
              </li>
            ))}
          </ul>
          <div>
            <a className="btn sm" href="#/questions">
              Answer them
            </a>
          </div>
        </Section>
      ) : null}
      {d.skipped.length ? (
        <Section title="Skipped, and why">
          <table className="table">
            <tbody>
              {d.skipped.map((s) => (
                <tr key={s.reason}>
                  <td>
                    {s.reason}
                    {s.examples.length ? <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>{s.examples.slice(0, 3).join(', ')}</div> : null}
                  </td>
                  <td className="num">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}
      {d.failed.length ? (
        <Section title="Failed">
          <ul className="list-dash bad">
            {d.failed.map((f) => (
              <li key={f.jobId}>
                <a href={`#/pipeline?job=${f.jobId}`}>
                  {f.role} at {f.company}
                </a>
                : {f.reason}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {d.gaps.length ? (
        <Section title="Skills most often missing">
          <div className="chips">
            {d.gaps.map((g) => (
              <span key={g.skill} className="tag">
                {g.skill} <span className="faint">{g.count}</span>
              </span>
            ))}
          </div>
        </Section>
      ) : null}
      {d.recipesPromoted.length ? (
        <Section title="Forms Bureau learned">
          <ul className="list-dash good">
            {d.recipesPromoted.map((r, i) => (
              <li key={i}>
                {r.ats} ({r.scope === 'ats' ? 'every company on it' : r.scopeKey})
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {d.sourceWarnings.length ? (
        <Section title="Sources with trouble">
          <ul className="list-dash">
            {d.sourceWarnings.map((w) => (
              <li key={w.source}>
                {w.source}: {w.status}
                {w.error ? `, ${w.error}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {!d.sent.length && !d.rehearsed.length && !d.needsYou.length && !d.questions.length && !d.skipped.length ? <p className="muted">A quiet day: nothing was sent, skipped or asked.</p> : null}
    </div>
  );
}

const dateLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export default function Digests() {
  const [, params] = useRoute();
  const selected = params.get('id');
  const toast = useToast();
  const qc = useQueryClient();
  const campaigns = useCampaigns();
  const [campaignId, setCampaignId] = useState<string>('');
  const list = useQuery({ queryKey: ['digests'], queryFn: () => api<{ digests: StoredDigest[] }>('/api/digests?limit=60') });
  const preview = useQuery({
    queryKey: ['digests', 'preview', campaignId],
    queryFn: () => post<{ content: DigestContent; text: string }>('/api/digests/preview', { campaignId: campaignId || null }),
    enabled: !selected,
  });
  const one = list.data?.digests.find((d) => d.id === selected);
  const send = useMutation({
    mutationFn: () => post<{ id: string; via: string[] }>('/api/digests/send', { campaignId: campaignId || null }),
    onSuccess: (r) => {
      toast.success(r.via.length ? `Sent by ${r.via.join(' and ')}.` : 'Saved. No channel is switched on, so it went nowhere; see Settings.');
      qc.invalidateQueries({ queryKey: ['digests'] });
    },
    onError: toast.error,
  });
  const name = (id: string | null) => (id ? (campaigns.data?.campaigns.find((c) => c.id === id)?.name ?? 'A campaign') : 'All campaigns');

  return (
    <>
      <PageHead title="Digests" lede="The daily report: what was sent with screenshots, what was skipped and why, what needs you, new questions, spend and interviews. It goes out by Telegram and email after active hours." />
      <div className="split">
        <section className="card card-pad">
          {selected && one ? (
            <>
              <div className="row" style={{ marginBottom: 'var(--s-4)' }}>
                <div>
                  <h2 className="section-title">{one.content.final ? 'Final digest' : dateLabel(one.date)}</h2>
                  <div className="meta">
                    <span>{name(one.campaignId)}</span>
                    <span>{one.sentVia.length ? `Sent by ${one.sentVia.join(' and ')}` : 'Not sent'}</span>
                  </div>
                </div>
                <span className="spacer" />
                <Btn size="sm" variant="ghost" onClick={() => setParam('id', null)}>
                  Today so far
                </Btn>
              </div>
              <DigestView d={one.content} />
            </>
          ) : (
            <>
              <div className="row wrap" style={{ marginBottom: 'var(--s-4)' }}>
                <div>
                  <h2 className="section-title">Today so far</h2>
                  <div className="meta">
                    <span>A preview; nothing is saved or sent until you press Send now.</span>
                  </div>
                </div>
                <span className="spacer" />
                <select className="select" style={{ width: 'auto' }} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
                  <option value="">All campaigns</option>
                  {campaigns.data?.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Btn busy={send.isPending} onClick={() => send.mutate()}>
                  <Send /> Send now
                </Btn>
              </div>
              {preview.data ? <DigestView d={preview.data.content} /> : <div className="skeleton" style={{ height: 300 }} />}
            </>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>History</h2>
          </div>
          {list.data?.digests.length ? (
            <div>
              {list.data.digests.map((d) => (
                <button key={d.id} className="list-row" aria-selected={d.id === selected} onClick={() => setParam('id', d.id)}>
                  <div style={{ minWidth: 0 }}>
                    <div className="title">{d.content.final ? `Final digest, ${dateLabel(d.date)}` : dateLabel(d.date)}</div>
                    <div className="meta">
                      <span>{name(d.campaignId)}</span>
                      <span>
                        {d.content.totals?.sent ?? 0} sent, {d.content.totals?.rehearsed ?? 0} rehearsed
                      </span>
                    </div>
                  </div>
                  <span className={`tag ${d.sentVia.length ? 'olive' : ''}`}>{d.sentVia.length ? 'Sent' : 'Saved'}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
              Each day's digest is kept here once it goes out.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
