import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, maybe, type ArmStat, type BanditStats, type WriterDetail, type WriterRun, type WriterTotals } from '../api';
import { setParam, useRoute } from '../App';
import { Empty, ago } from '../ui';
import { Stat, Tabs, pct, plain } from '../kit';
import { WriterQuality } from './JobTimeline';

type Sort = 'quality' | 'recent';

function WrittenDetail({ id }: { id: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['writer', 'app', id], queryFn: () => maybe<WriterDetail>(`/api/writer/applications/${id}`) });
  const [pdf, setPdf] = useState<'none' | 'cv' | 'letter'>('none');
  if (isLoading) return <div className="card skeleton" style={{ height: 480 }} />;
  if (!data) return <Empty title="Not found">This application has no writer record.</Empty>;
  return (
    <section className="card">
      <div className="detail-head">
        <h2>{data.summary.title}</h2>
        <div className="meta" style={{ marginTop: 4 }}>
          <span style={{ color: 'var(--text)' }}>{data.summary.company}</span>
          <span>{ago(data.summary.updatedAt)}</span>
          <a href={`#/pipeline?job=${data.summary.jobId}`}>Open the job</a>
        </div>
        {data.writer.subjects.length ? (
          <p className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 'var(--s-2)' }}>
            Subject: {data.writer.subjects[data.writer.subjectIndex] ?? data.writer.subjects[0]}
          </p>
        ) : null}
      </div>
      <div className="detail-body">
        <WriterQuality w={data} appId={id} />
        {data.writer.status === 'written' ? (
          <div className="stack" style={{ marginTop: 'var(--s-5)' }}>
            <Tabs
              label="PDF preview"
              value={pdf}
              onChange={setPdf}
              items={[
                { id: 'none', label: 'No preview' },
                { id: 'cv', label: 'CV as sent' },
                { id: 'letter', label: 'Letter as sent' },
              ]}
            />
            {pdf !== 'none' ? <iframe className="pdf-frame" title={pdf === 'cv' ? 'CV preview' : 'Letter preview'} src={`/api/writer/applications/${id}/${pdf}.pdf`} /> : null}
            {data.writer.cvChanges.length ? (
              <div>
                <span className="label">What changed on the CV for this role</span>
                <ul className="list-dash" style={{ marginTop: 6 }}>
                  {data.writer.cvChanges.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {Object.keys(data.writer.shortAnswers).length ? (
              <div>
                <span className="label">Short answers ready for the form</span>
                <div className="stack" style={{ gap: 'var(--s-2)', marginTop: 6 }}>
                  {Object.entries(data.writer.shortAnswers).map(([q, a]) => (
                    <div key={q} className="prompt-block">
                      <span className="prompt">{plain(q)}</span>
                      <span style={{ fontSize: 'var(--t-sm)' }}>{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function WrittenPanel() {
  const [, params] = useRoute();
  const selected = params.get('app');
  const [status, setStatus] = useState<'written' | 'skipped'>('written');
  const [sort, setSort] = useState<Sort>('quality');
  const { data } = useQuery({ queryKey: ['writer', 'runs', status], queryFn: () => api<{ runs: WriterRun[]; totals: WriterTotals }>(`/api/writer/applications?limit=200&status=${status}`) });
  const all = useQuery({ queryKey: ['writer', 'runs', 'all'], queryFn: () => api<{ runs: WriterRun[]; totals: WriterTotals }>('/api/writer/applications?limit=200') });
  const runs = [...(data?.runs ?? [])].sort((a, b) => (sort === 'quality' ? (b.critic ?? -1) - (a.critic ?? -1) : b.updatedAt.localeCompare(a.updatedAt)));
  const t = all.data?.totals;
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      {t ? (
        <section className="card card-pad">
          <div className="stats">
            <Stat label="Written" value={t.written} />
            <Stat label="Held back" value={t.skipped} sub={t.skipReasons[0] ? `Mostly ${plain(t.skipReasons[0].reason).toLowerCase()}` : undefined} />
            <Stat label="Average critic score" value={t.avgCritic ?? '–'} sub="Out of 10; 8 is the bar" />
          </div>
        </section>
      ) : null}
      <div className="toolbar">
        <Tabs
          label="Which"
          value={status}
          onChange={setStatus}
          items={[
            { id: 'written', label: 'Written' },
            { id: 'skipped', label: 'Held back' },
          ]}
        />
        <Tabs
          label="Sort"
          value={sort}
          onChange={setSort}
          items={[
            { id: 'quality', label: 'Best first' },
            { id: 'recent', label: 'Newest first' },
          ]}
        />
      </div>
      {runs.length ? (
        <div className="studio">
          <div className="job-list">
            {runs.map((r) => (
              <button key={r.applicationId} className="draft-item" aria-selected={selected === r.applicationId} onClick={() => setParam('app', r.applicationId)}>
                <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{r.title}</div>
                <div className="muted" style={{ fontSize: '0.8125rem' }}>
                  {r.company}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {r.status === 'skipped' ? (
                    <span className="tag">{(r.skipped ?? 'Held back').split(':')[0]}</span>
                  ) : (
                    <>
                      <span className="tag num">Critic {r.critic?.toFixed(1) ?? '–'}</span>
                      <span className={`tag ${r.lintPass ? 'olive' : 'crimson'}`}>{r.lintPass ? 'Lint passed' : 'Lint failed'}</span>
                      {r.truthPass === false ? <span className="tag crimson">Truth lock</span> : null}
                    </>
                  )}
                  <span className="faint" style={{ fontSize: '0.75rem' }}>
                    {ago(r.updatedAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {selected ? (
            <WrittenDetail key={selected} id={selected} />
          ) : (
            <section className="card">
              <Empty title="Pick an application">Read its letter, the variants it beat, every lint check and the truth lock, and preview the PDFs exactly as they were sent.</Empty>
            </section>
          )}
        </div>
      ) : (
        <div className="card">
          <Empty title={status === 'written' ? 'Nothing written yet' : 'Nothing held back'}>
            {status === 'written' ? 'Applications a campaign writes appear here, best first.' : 'When an application fails the critic, the lint or the truth lock, it is held back here with the reason.'}
          </Empty>
        </div>
      )}
    </div>
  );
}

const ARM_LABEL: Record<string, string> = { hook: 'Opens with a hook', proof: 'Leads with proof', story: 'Tells a story' };

function Arms({ arms, title }: { arms: ArmStat[]; title: string }) {
  const best = Math.max(...arms.map((a) => a.mean));
  return (
    <section className="card card-pad">
      <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
        {title}
      </h2>
      {arms.map((a) => (
        <div className="arm-row" key={a.arm}>
          <span>{ARM_LABEL[a.arm] ?? plain(a.arm)}</span>
          <div className="bar-track">
            <i style={{ width: `${a.mean * 100}%`, background: a.mean === best && a.n > 0 ? 'var(--good)' : 'var(--leather)' }} />
          </div>
          <span className="num" style={{ textAlign: 'right' }}>
            {pct(a.mean)}
          </span>
          <span className="num faint" style={{ textAlign: 'right', fontSize: 'var(--t-xs)' }}>
            {a.successes} of {a.n}
          </span>
        </div>
      ))}
    </section>
  );
}

export function BanditPanel() {
  const { data } = useQuery({ queryKey: ['writer', 'bandit'], queryFn: () => api<BanditStats>('/api/writer/bandit') });
  const meta = useQuery({ queryKey: ['writer', 'meta'], queryFn: () => api<{ criticBar: number; rules: { id: string; category: string; description: string }[]; attribution: string }>('/api/writer/meta') });
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  const cats = new Map<string, number>();
  for (const r of meta.data?.rules ?? []) cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
  return (
    <div className="split">
      <div className="grid">
        <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
          Bureau tries different letter styles and learns from the replies. The bars show the estimated reply rate for each; {pct(data.exploreRate)} of letters try something other than the current best, so it keeps learning. {data.outcomes} applications have an outcome so far.
        </p>
        <Arms arms={data.strategy} title="Letter strategy" />
        <Arms arms={data.length} title="Letter length" />
      </div>
      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
          The checks every letter passes
        </h2>
        <ul className="list-dash">
          <li>A recruiter critic scores it; below {meta.data?.criticBar ?? 8} out of 10 it is rewritten or held back.</li>
          <li>The humanizer removes {meta.data?.rules.length ?? 'the'} known signs of machine writing, in {cats.size || 'several'} groups.</li>
          <li>A style lint compares it with your own voice bank: sentence rhythm, vocabulary range, contractions, clichés.</li>
          <li>The truth lock checks every claim against a fact with a source, in code and by an independent auditor.</li>
        </ul>
        {meta.data ? (
          <p className="faint" style={{ fontSize: 'var(--t-xs)', marginTop: 'var(--s-3)' }}>
            {meta.data.attribution}
          </p>
        ) : null}
      </section>
    </div>
  );
}
