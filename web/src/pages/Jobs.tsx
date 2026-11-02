import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { Archive, Bookmark, Check, ClipboardPaste, ExternalLink, Feather, Gauge, MapPin, Minus, Search, ShieldAlert, Sparkles, X } from 'lucide-react';
import { api, patch, post, CATEGORY_LABEL, type Category, type JobDetail, type JobSummary } from '../api';
import { go, useRoute } from '../App';
import { Btn, Empty, Field, ScoreDial, Seal, ago, money, sourceLabel, useToast } from '../ui';

const CATS = Object.keys(CATEGORY_LABEL) as Category[];

const STAGE_LABEL: Record<string, string> = {
  drafted: 'Drafted',
  applied: 'Applied',
  interview: 'Interviewing',
  offer: 'Offer',
  rejected: 'Closed',
  ghosted: 'No reply',
};

export default function Jobs() {
  const [, params] = useRoute();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<Category | ''>((params.get('category') as Category) ?? '');
  const [minScore, setMinScore] = useState(Number(params.get('min') ?? 0));
  const [remote, setRemote] = useState(false);
  const [scoredOnly, setScoredOnly] = useState(false);
  const [sort, setSort] = useState('score');
  const [selected, setSelected] = useState<string | null>(params.get('id'));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [capture, setCapture] = useState(params.has('capture'));
  const [limit, setLimit] = useState(60);
  const toast = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const id = params.get('id');
    if (id) setSelected(id);
  }, [params]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ sort, limit: String(limit) });
    if (debounced) p.set('q', debounced);
    if (category) p.set('category', category);
    if (minScore) p.set('minScore', String(minScore));
    if (remote) p.set('remote', '1');
    if (scoredOnly) p.set('scored', '1');
    return p.toString();
  }, [debounced, category, minScore, remote, scoredOnly, sort, limit]);

  const list = useQuery({ queryKey: ['jobs', query], queryFn: () => api<{ total: number; jobs: JobSummary[] }>(`/api/jobs?${query}`), placeholderData: (prev) => prev });

  const assess = useMutation({
    mutationFn: (ids: string[]) => post<{ scored: number }>('/api/jobs/score', { ids }),
    onSuccess: (r) => {
      toast.success(`Claude assessed ${r.scored} role${r.scored === 1 ? '' : 's'}.`);
      setChecked(new Set());
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: toast.error,
  });

  const jobs = list.data?.jobs ?? [];
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Jobs</h1>
          <p>Every tech role Bureau has found, best fit first. The seal is Claude’s grade; unscored roles show the free pre-filter as a thin bar.</p>
        </div>
        <div className="page-actions">
          {checked.size ? (
            <Btn variant="primary" busy={assess.isPending} onClick={() => assess.mutate([...checked])}>
              <Gauge /> Assess {checked.size} with Claude
            </Btn>
          ) : null}
          <Btn onClick={() => setCapture(!capture)} aria-expanded={capture}>
            <ClipboardPaste /> Add a job from a post
          </Btn>
        </div>
      </header>

      {capture ? <CapturePanel onClose={() => setCapture(false)} onCaptured={(id) => setSelected(id)} /> : null}

      <div className="toolbar">
        <div className="search">
          <Search />
          <input className="input" placeholder="Search title, company, stack…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
        </div>
        <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="score">Best fit</option>
          <option value="recent">Newest found</option>
          <option value="posted">Newest posted</option>
          <option value="salary">Highest salary</option>
        </select>
        <label className="row" style={{ fontSize: '0.8125rem', gap: 8 }}>
          <span className="muted">Min score</span>
          <input type="range" min={0} max={95} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Minimum score" />
          <span style={{ width: 22 }}>{minScore}</span>
        </label>
      </div>
      <div className="toolbar">
        <div className="chips">
          <button className="chip" aria-pressed={category === ''} onClick={() => setCategory('')}>
            All
          </button>
          {CATS.map((c) => (
            <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
          <span style={{ width: 12 }} />
          <button className="chip" aria-pressed={remote} onClick={() => setRemote(!remote)}>
            Remote only
          </button>
          <button className="chip" aria-pressed={scoredOnly} onClick={() => setScoredOnly(!scoredOnly)}>
            Scored only
          </button>
        </div>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
          {(list.data?.total ?? 0).toLocaleString()} roles
        </span>
      </div>

      <div className="board">
        <div>
          <div className="job-list" role="listbox" aria-label="Jobs">
            {jobs.length === 0 && !list.isLoading ? (
              <Empty title="No roles match">Clear a filter or two, or scan sources from the Overview to bring in new roles.</Empty>
            ) : null}
            {jobs.map((j) => (
              <div
                key={j.id}
                className="job-row"
                role="option"
                aria-selected={selected === j.id}
                tabIndex={0}
                onClick={() => setSelected(j.id)}
                onKeyDown={(e) => e.key === 'Enter' && setSelected(j.id)}
              >
                <input type="checkbox" checked={checked.has(j.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(j.id)} aria-label={`Select ${j.title}`} />
                <Seal grade={j.grade} />
                <div style={{ minWidth: 0 }}>
                  <div className="title">{j.title}</div>
                  <div className="meta">
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{j.company}</span>
                    <span>{j.remote ? 'Remote' : j.location || 'Location not given'}</span>
                    {money(j.salary) ? <span>{money(j.salary)}</span> : null}
                    <span>{ago(j.postedAt ?? j.foundAt)}</span>
                  </div>
                  {j.verdict ? <div className="verdict">{j.verdict}</div> : null}
                  {j.stage !== 'found' ? (
                    <div style={{ marginTop: 8 }}>
                      <span className="tag crimson">{STAGE_LABEL[j.stage] ?? j.stage}</span>
                    </div>
                  ) : null}
                  {j.score === null ? (
                    <div className="prebar" title={`Pre-filter ${j.prefilterScore} of 100`}>
                      <i style={{ width: `${j.prefilterScore}%` }} />
                    </div>
                  ) : null}
                </div>
                <span className="score" aria-label="Fit score">{j.score ?? ''}</span>
              </div>
            ))}
          </div>
          {list.data && list.data.total > jobs.length ? (
            <div style={{ display: 'grid', placeItems: 'center', marginTop: 'var(--s-4)' }}>
              <Btn onClick={() => setLimit(limit + 60)}>Show more</Btn>
            </div>
          ) : null}
        </div>

        <div className="detail card">{selected ? <JobPanel id={selected} onGone={() => setSelected(null)} /> : <Empty title="Pick a role">Select one on the left to see Claude’s assessment, each requirement checked against your CV, and the full posting.</Empty>}</div>
      </div>

    </>
  );
}

function JobPanel({ id, onGone }: { id: string; onGone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: job, isLoading } = useQuery({ queryKey: ['jobs', 'detail', id], queryFn: () => api<JobDetail>(`/api/jobs/${id}`) });
  const [instructions, setInstructions] = useState('');
  const [showInstr, setShowInstr] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['jobs'] });
  const assess = useMutation({ mutationFn: () => post('/api/jobs/score', { ids: [id] }), onSuccess: refresh, onError: toast.error });
  const draft = useMutation({
    mutationFn: () => post<{ applicationId: string }>(`/api/jobs/${id}/draft`, { instructions }),
    onSuccess: (r) => {
      toast.success('Draft ready in the Studio.');
      refresh();
      go(`studio?id=${r.applicationId}`);
    },
    onError: toast.error,
  });
  const update = useMutation({
    mutationFn: (body: Record<string, string>) => patch(`/api/jobs/${id}`, body),
    onSuccess: (_r, body) => {
      refresh();
      if (body.status === 'dismissed') {
        toast.info('Dismissed. It will stay out of your way.');
        onGone();
      }
    },
    onError: toast.error,
  });

  const html = useMemo(() => (job?.descriptionHtml ? DOMPurify.sanitize(job.descriptionHtml, { ADD_ATTR: ['target'] }) : ''), [job?.descriptionHtml]);

  if (isLoading || !job) return <div className="skeleton" style={{ height: 420, margin: 24 }} />;
  const a = job.analysis;

  return (
    <>
      <div className="detail-head">
        <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s-5)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{job.title}</h2>
            <div className="meta" style={{ marginTop: 8 }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{job.company}</span>
              <span className="row" style={{ gap: 4 }}>
                <MapPin size={14} /> {job.remote ? (job.location ? `Remote, ${job.location}` : 'Remote') : job.location || 'Location not given'}
              </span>
              {money(job.salary) ? <span>{money(job.salary)}</span> : null}
              <span>Posted {ago(job.postedAt)}</span>
              <span>
                {CATEGORY_LABEL[job.category]}, via {sourceLabel(job.source)}
              </span>
            </div>
          </div>
          <ScoreDial score={job.score} grade={job.grade} decision={a?.decision} />
        </div>
        <div className="row wrap" style={{ marginTop: 'var(--s-5)', gap: 8 }}>
          {job.application ? (
            <a className="btn primary" href={`#/studio?id=${job.application.id}`}>
              <Feather /> Open the draft
            </a>
          ) : (
            <Btn variant="primary" busy={draft.isPending} onClick={() => draft.mutate()}>
              <Feather /> {draft.isPending ? 'Writing the draft…' : 'Write application'}
            </Btn>
          )}
          <Btn busy={assess.isPending} onClick={() => assess.mutate()}>
            <Sparkles /> {a ? 'Score again' : 'Score with Claude'}
          </Btn>
          {job.url ? (
            <a className="btn" href={job.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open posting
            </a>
          ) : null}
          <span className="spacer" />
          <Btn variant="ghost" size="sm" onClick={() => update.mutate({ status: job.status === 'shortlisted' ? 'new' : 'shortlisted' })}>
            <Bookmark size={14} fill={job.status === 'shortlisted' ? 'currentColor' : 'none'} /> {job.status === 'shortlisted' ? 'Shortlisted' : 'Shortlist'}
          </Btn>
          <Btn variant="ghost" size="sm" onClick={() => update.mutate({ status: 'dismissed' })}>
            <Archive size={14} /> Dismiss
          </Btn>
        </div>
        {!job.application ? (
          <div style={{ marginTop: 10 }}>
            <button className="btn ghost sm" onClick={() => setShowInstr(!showInstr)} aria-expanded={showInstr} style={{ paddingLeft: 0 }}>
              {showInstr ? 'Hide notes for the draft' : 'Add notes for the draft'}
            </button>
            {showInstr ? (
              <textarea className="textarea" rows={2} placeholder="Mention my CTF wins. Keep it under 200 words. I know someone on their red team." value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="detail-body">
        {a ? (
          <>
            <p className="verdict-quote">{a.verdict}</p>

            {a.redFlags.length ? (
              <div className="callout crimson" style={{ marginTop: 'var(--s-4)' }}>
                <ShieldAlert />
                <div>
                  <strong>Watch out</strong>
                  <ul className="list-dash bad" style={{ marginTop: 6 }}>
                    {a.redFlags.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <div className="detail-section split" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <span className="label">Why it fits</span>
                <ul className="list-dash good" style={{ marginTop: 8 }}>
                  {a.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="label">Gaps</span>
                <ul className="list-dash bad" style={{ marginTop: 8 }}>
                  {a.gaps.length ? a.gaps.map((s) => <li key={s}>{s}</li>) : <li>None worth worrying about</li>}
                </ul>
              </div>
            </div>

            <div className="detail-section">
              <span className="label">Requirements, checked against your CV</span>
              <table className="req-table">
                <tbody>
                  {a.requirements.map((r, i) => (
                    <tr key={i}>
                      <td style={{ width: 32 }}>
                        <span className={`req-mark ${r.match}`} aria-label={r.match === 'met' ? 'Met' : r.match === 'partial' ? 'Partly met' : 'Missing'}>
                          {r.match === 'met' ? <Check size={13} strokeWidth={2.5} /> : r.match === 'partial' ? <Minus size={13} strokeWidth={2.5} /> : <X size={13} strokeWidth={2.5} />}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.text}</div>
                        {r.proof ? <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>{r.proof}</div> : null}
                      </td>
                      <td style={{ width: 92, textAlign: 'right' }}>
                        <span className={`tag ${r.importance === 'critical' ? 'crimson' : ''}`}>{r.importance === 'critical' ? 'Must have' : r.importance === 'important' ? 'Expected' : 'Bonus'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="detail-section">
              <span className="label">How the score was made</span>
              <div className="bars" style={{ marginTop: 4 }}>
                {Object.entries(a.dimensions).map(([k, v]) => (
                  <div className="bar-row" key={k}>
                    <span className="muted" style={{ textTransform: 'capitalize' }}>
                      {k}
                    </span>
                    <div className="bar-track">
                      <i style={{ width: `${(Math.max(0, Math.min(5, v)) / 5) * 100}%` }} />
                    </div>
                    <span>{v} of 5</span>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 'var(--t-xs)', marginTop: 'var(--s-3)', maxWidth: '72ch' }}>
                Requirements {a.breakdown.requirements} (45%), dimensions {a.breakdown.dimensions} (35%), pre-filter {a.breakdown.prefilter} (20%). Legitimacy {a.legitimacy}, confidence {a.confidence}, level {a.seniorityFit === 'match' ? 'matches yours' : a.seniorityFit}.
              </p>
            </div>

            {a.atsKeywords.length ? (
              <div className="detail-section">
                <span className="label">Phrases your CV should mirror</span>
                <div className="chips">
                  {a.atsKeywords.map((k) => (
                    <span key={k} className="tag">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="note warn">
            <Sparkles /> Not scored yet. Claude will read the posting, list its real requirements, and check each one against your CV.
          </p>
        )}

        <div className="detail-section">
          <span className="label">The posting</span>
          {html ? <div className="prose" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="prose" style={{ whiteSpace: 'pre-wrap' }}>{job.descriptionText}</div>}
        </div>

        <div className="detail-section form-grid">
          <Field label="Your notes" full>
            <textarea className="textarea" rows={3} defaultValue={job.notes} placeholder="Referral contacts, salary intel, what to ask…" onBlur={(e) => e.target.value !== job.notes && update.mutate({ notes: e.target.value })} />
          </Field>
          <Field label="Application email" help="Found in the posting, or one you know. Used when the application goes by email." full>
            <input className="input" type="email" defaultValue={job.applyEmail ?? ''} placeholder="jobs@company.com" onBlur={(e) => e.target.value !== (job.applyEmail ?? '') && update.mutate({ applyEmail: e.target.value })} />
          </Field>
        </div>
      </div>
    </>
  );
}

/** Inline, not a modal: adding a job doesn't need to interrupt anything. */
function CapturePanel({ onClose, onCaptured }: { onClose: () => void; onCaptured: (id: string) => void }) {
  const [, params] = useRoute();
  const [url, setUrl] = useState('');
  const [text, setText] = useState(params.get('capture') ?? '');
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => post<{ id: string; duplicate: boolean }>('/api/jobs/capture', url ? { url } : { text }),
    onSuccess: (r) => {
      toast.success(r.duplicate ? 'That job is already in your list.' : 'Job added and scored.');
      qc.invalidateQueries({ queryKey: ['jobs'] });
      onCaptured(r.id);
      onClose();
    },
    onError: toast.error,
  });
  return (
    <form
      className="capture-panel"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Field label="Link to the post" help="A company page, a tweet, a forum post.">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus />
      </Field>
      <Field label="Or paste the text" help="For posts behind a login, like LinkedIn. Bureau never signs in to your accounts.">
        <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={!!url} />
      </Field>
      <div className="row" style={{ paddingBottom: 22 }}>
        <Btn variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Btn>
        <Btn variant="primary" type="submit" busy={m.isPending} disabled={!url && text.trim().length < 40}>
          Add job
        </Btn>
      </div>
    </form>
  );
}
