import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, FileText, Inbox as InboxIcon, Minus, PenLine, Radar, Scale, ScrollText, Workflow, X } from 'lucide-react';
import { maybe, optional, type FormRun, type JobFile, type LetterVariant, type MatchView, type TimelineEntry, type WriterDetail } from '../api';
import { Seal, ago, sourceLabel } from '../ui';
import { Drawer, Facts, Hint, STATE_LABEL, StateTag, Tabs, plain, stamp } from '../kit';
import { CLASS_LABEL } from './Inbox';

function Head({ icon: Icon, title, right }: { icon: typeof Radar; title: string; right?: React.ReactNode }) {
  return (
    <div className="section-head">
      <Icon />
      <h3>{title}</h3>
      <span className="spacer" />
      {right}
    </div>
  );
}

function OkMark({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={`ok-mark ${ok ? 'yes' : warn ? 'warn' : 'no'}`}>{ok ? <Check size={13} /> : warn ? <Minus size={13} /> : <X size={13} />}</span>;
}

const IMPORTANCE: Record<string, string> = { critical: 'Critical', important: 'Important', nice: 'Nice to have' };
const FRAMING: Record<string, string> = { direct: 'Direct', transferable: 'Transferable', learning: 'Learning', none: 'Not covered', omit: 'Left out' };

function MatchSection({ m }: { m: MatchView }) {
  const b = m.breakdown;
  const x = m.match;
  if (!x) return <p className="muted">Not assessed yet. The matcher scores it on the next cycle.</p>;
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="row" style={{ alignItems: 'center', gap: 'var(--s-3)' }}>
        <Seal grade={x.grade === 'F' ? 'D' : x.grade} size="lg" />
        <div>
          <div className="num" style={{ fontSize: '1.75rem', fontWeight: 600, lineHeight: 1 }}>
            {x.screenPassScore}
            <small className="faint" style={{ fontSize: 'var(--t-sm)' }}>
              {' '}
              / 100
            </small>
          </div>
          <div className="muted" style={{ fontSize: 'var(--t-sm)' }}>
            {m.label} <Hint text={m.tooltip} label="What the score means" />
          </div>
        </div>
      </div>
      {x.verdict ? <p className="verdict-quote" style={{ fontSize: '1.1875rem' }}>{x.verdict}</p> : null}
      {m.requirements.length ? (
        <div className="table-wrap">
          <table className="req-table">
            <tbody>
              {m.requirements.map((r, i) => (
                <tr key={i}>
                  <td style={{ width: 28 }}>
                    <span className={`req-mark ${r.match}`} title={plain(r.match)}>
                      {r.match === 'met' ? <Check size={13} /> : r.match === 'partial' ? <Minus size={13} /> : <X size={13} />}
                    </span>
                  </td>
                  <td>
                    <div>
                      {r.text}
                      {r.blocker ? (
                        <span className="tag crimson" style={{ marginLeft: 6 }}>
                          Blocker
                        </span>
                      ) : null}
                    </div>
                    {r.proof ? (
                      <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                        {r.proof}
                      </div>
                    ) : null}
                  </td>
                  <td className="hide-phone" style={{ whiteSpace: 'nowrap' }}>
                    <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
                      {IMPORTANCE[r.importance]}
                      {r.evidence === 'inferred' ? ', inferred' : ''}
                    </span>
                    {r.proofKind ? (
                      <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                        {FRAMING[r.proofKind]}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {b ? (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <span className="label">How the score was made</span>
          <div className="bars">
            {(
              [
                ['Requirements', b.requirements, 55],
                ['Fit dimensions', b.dimensions, 30],
                ['Pre-rank', b.preRank, 15],
              ] as const
            ).map(([label, v, w]) => (
              <div className="bar-row" key={label}>
                <span className="muted">
                  {label} <span className="faint">{w}%</span>
                </span>
                <div className="bar-track">
                  <i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
                </div>
                <span className="num" style={{ textAlign: 'right' }}>
                  {Math.round(v)}
                </span>
              </div>
            ))}
          </div>
          <Facts
            rows={[
              ['Stretch level', plain(b.stretch.level)],
              ['Unmet important', `${b.stretch.unmetImportant} (allowed ${b.stretch.allowance})`],
              ['Stretch penalty', b.stretch.penalty ? `minus ${b.stretch.penalty}` : 'None'],
              ['Adjustments', b.adjustments.map((a) => `${a.reason} ${a.points > 0 ? '+' : ''}${a.points}`).join(', ') || 'None'],
              ['Caps', b.caps.map((c) => `${c.reason} (at most ${c.cap})`).join(', ') || 'None'],
              ['Blockers', b.blockers.join(', ') || 'None'],
            ]}
          />
          {x.inflatedPosting ? <div className="note warn">This posting asks entry-level candidates for senior experience; the stretch allowance accounts for it.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function VariantCard({ v }: { v: LetterVariant }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: 'var(--s-3) 0', borderTop: '1px solid var(--line)' }}>
      <div className="row">
        <strong>{plain(v.strategy)}</strong>
        {v.chosen ? <span className="tag olive">Chosen</span> : null}
        <span className="spacer" />
        <span className="num muted" style={{ fontSize: 'var(--t-sm)' }}>
          {v.critic ? `Critic ${v.critic.score.toFixed(1)}` : 'Not scored'}
          {v.lint ? `, lint ${v.lint.pass ? 'passed' : 'failed'}` : ''}
        </span>
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Read'}
        </button>
      </div>
      {open ? (
        <div className="stack" style={{ marginTop: 'var(--s-2)' }}>
          <div className="letter">{v.text}</div>
          {v.critic?.demands.length ? (
            <ul className="list-dash">
              {v.critic.demands.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WriterQuality({ w, appId }: { w: WriterDetail; appId: string }) {
  const [tab, setTab] = useState<'letter' | 'variants' | 'checks' | 'evidence'>('letter');
  const q = w.writer.quality;
  if (w.writer.status === 'skipped') return <div className="callout">Held back: {w.writer.skipped}</div>;
  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      <div className="stats">
        <div className="stat">
          <span className="label">Critic</span>
          <strong className="num">{q ? q.critic.score.toFixed(1) : '–'}</strong>
          <small>out of 10, needs 8</small>
        </div>
        <div className="stat">
          <span className="label">Lint</span>
          <strong>{q ? (q.lint.pass ? 'Passed' : 'Failed') : '–'}</strong>
          <small>{q ? `${q.lint.checks.filter((c) => c.pass).length} of ${q.lint.checks.length} checks` : ''}</small>
        </div>
        <div className="stat">
          <span className="label">Truth lock</span>
          <strong>{q ? (q.truth.pass ? 'Clean' : 'Blocked') : '–'}</strong>
          <small>{q ? `${q.truth.issues.length} issues` : ''}</small>
        </div>
        <div className="stat">
          <span className="label">Strategy</span>
          <strong>{w.writer.strategy ? plain(w.writer.strategy) : '–'}</strong>
          <small>{w.writer.explored ? 'Trying something new' : w.writer.lengthArm ? `${plain(w.writer.lengthArm)} length` : ''}</small>
        </div>
      </div>
      <div className="row wrap">
        <a className="btn sm" href={`/api/writer/applications/${appId}/cv.pdf`} target="_blank" rel="noopener noreferrer">
          <FileText /> CV PDF
        </a>
        <a className="btn sm" href={`/api/writer/applications/${appId}/letter.pdf`} target="_blank" rel="noopener noreferrer">
          <FileText /> Letter PDF
        </a>
        <a className="btn sm ghost" href={`#/studio?tab=written&app=${appId}`}>
          Open in Studio
        </a>
      </div>
      <Tabs
        label="Writer detail"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'letter', label: 'Letter' },
          { id: 'variants', label: 'Variants', count: w.variants.length },
          { id: 'checks', label: 'Checks' },
          { id: 'evidence', label: 'Evidence' },
        ]}
      />
      {tab === 'letter' ? <div className="letter">{w.coverLetter}</div> : null}
      {tab === 'variants' ? (
        <div>
          {w.variants.map((v) => (
            <VariantCard key={v.id} v={v} />
          ))}
        </div>
      ) : null}
      {tab === 'checks' && q ? (
        <div className="stack">
          <div className="checks">
            {q.lint.checks.map((c) => (
              <div key={c.id}>
                <OkMark ok={c.pass} />
                <span>{plain(c.id)}</span>
                <span className="num faint" style={{ fontSize: 'var(--t-xs)' }}>
                  {typeof c.value === 'number' ? Number(c.value.toFixed(3)) : c.value} {c.target ? `(${c.target})` : ''}
                </span>
              </div>
            ))}
          </div>
          {q.truth.issues.length ? (
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              <span className="label">Truth lock</span>
              {q.truth.issues.map((i, n) => (
                <div key={n} className={`issue ${i.severity === 'high' ? 'high' : ''}`}>
                  <strong style={{ fontSize: 'var(--t-xs)' }}>{plain(i.severity)}</strong>
                  <div style={{ fontSize: 'var(--t-sm)' }}>
                    "{i.claim}" {i.reason}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="note good">
              <Check /> Every claim traces back to a fact with a source.
            </div>
          )}
          {q.critic.demands.length ? (
            <>
              <span className="label">What the critic asked for</span>
              <ul className="list-dash">
                {q.critic.demands.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {tab === 'evidence' ? (
        w.writer.evidence ? (
          <div className="table-wrap">
            <table className="req-table">
              <tbody>
                {w.writer.evidence.items.map((e, i) => (
                  <tr key={i}>
                    <td style={{ width: 110 }}>
                      <span className={`tag ${e.framing === 'direct' ? 'olive' : e.framing === 'omit' ? '' : 'brass'}`}>{FRAMING[e.framing]}</span>
                    </td>
                    <td>
                      <div>{e.requirement}</div>
                      <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                        {e.evidence || 'No true evidence; not claimed.'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {w.writer.evidence.biggestGap ? (
              <p className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 'var(--s-2)' }}>
                Biggest honest gap, named in the letter: {w.writer.evidence.biggestGap}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="muted">No evidence map was kept for this run.</p>
        )
      ) : null}
    </div>
  );
}

function FormSection({ file, runs, timeline }: { file: JobFile; runs: FormRun[] | null; timeline: TimelineEntry[] }) {
  const app = file.applications[0];
  const run = runs?.[0];
  if (run) {
    return (
      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        <div className="row wrap">
          <span className={`tag ${run.verified ? 'olive' : 'crimson'}`}>{run.verified ? 'Every field verified' : 'Not verified'}</span>
          <span className="muted" style={{ fontSize: 'var(--t-sm)' }}>
            {plain(run.status)}
            {run.via ? `, by ${run.via}` : ''}
            {run.ats ? ` on ${run.ats}` : ''}, {ago(run.at)}
          </span>
        </div>
        {run.reason ? <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>{run.reason}</p> : null}
        {run.shots.length ? (
          <div className="shot-row">
            {run.shots.map((s, i) => (
              <figure key={s}>
                <a href={s} target="_blank" rel="noopener noreferrer">
                  <img src={s} alt={`Form page ${i + 1}`} loading="lazy" />
                </a>
                <figcaption>Page {i + 1}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        {run.fieldLog.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Field</th>
                  <th>Value</th>
                  <th className="hide-phone">From</th>
                </tr>
              </thead>
              <tbody>
                {run.fieldLog.map((f) => (
                  <tr key={f.signature}>
                    <td style={{ width: 28 }}>
                      <OkMark ok={f.ok} />
                    </td>
                    <td>
                      {f.label}
                      {f.required ? <span className="faint"> (required)</span> : null}
                      {f.note ? <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>{f.note}</div> : null}
                    </td>
                    <td style={{ overflowWrap: 'anywhere' }}>
                      {f.readBack ?? f.intended ?? ''}
                      {f.intended && f.readBack && f.intended !== f.readBack ? <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>meant: {f.intended}</div> : null}
                    </td>
                    <td className="hide-phone muted">{f.source ? `${plain(f.source)}${f.key ? `: ${f.key}` : ''}` : 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  }
  // Until the form engine reports runs of its own, show what the autopilot journal and the application row keep.
  const outcome = [...timeline].reverse().find((t) => t.kind === 'step' && t.step === 'outcome');
  const detail = (outcome?.detail ?? {}) as { verified?: boolean; reason?: string; via?: string };
  if (!outcome && !app?.answers.length && !app?.hasShot) return <p className="muted">No form filled yet.</p>;
  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      {outcome ? (
        <div className="row wrap">
          <span className={`tag ${detail.verified ? 'olive' : 'crimson'}`}>{detail.verified ? 'Verified' : 'Not verified'}</span>
          <span className="muted" style={{ fontSize: 'var(--t-sm)' }}>
            {plain(outcome.status ?? '')}
            {detail.via ? `, by ${detail.via}` : ''}, {stamp(outcome.ts)}
          </span>
        </div>
      ) : null}
      {detail.reason ? <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>{detail.reason}</p> : null}
      {app?.hasShot ? (
        <a href={`/api/applications/${app.id}/shot.png`} target="_blank" rel="noopener noreferrer">
          <img className="shot-thumb" src={`/api/applications/${app.id}/shot.png`} alt="The filled form" loading="lazy" />
        </a>
      ) : null}
      {app?.answers.length ? (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {app.answers.map((a, i) => (
                <tr key={i}>
                  <td>{a.label}</td>
                  <td style={{ overflowWrap: 'anywhere' }}>{a.value}</td>
                  <td className="hide-phone muted">{a.source ? plain(a.source) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const STEP_WORDS: Record<string, string> = {
  claim: 'Claimed',
  write: 'Writer',
  route: 'Route chosen',
  fill: 'Form opened',
  submit_intent: 'About to send',
  submit_done: 'Delivered',
  outcome: 'Form result',
  submitted: 'Sent',
  rehearsed: 'Rehearsed',
  skip: 'Skipped',
  requeue: 'Back in the queue',
  release: 'Released',
  recover: 'Recovered after a restart',
};

function entryText(t: TimelineEntry): string {
  if (t.kind === 'transition') return `${t.from ? `${STATE_LABEL[t.from] ?? t.from} to ` : ''}${STATE_LABEL[t.to!] ?? t.to}${t.reason ? `: ${t.reason}` : ''}`;
  const d = (t.detail ?? {}) as Record<string, unknown>;
  const extra = typeof d.reason === 'string' ? d.reason : typeof d.message === 'string' ? d.message : '';
  return `${STEP_WORDS[t.step ?? ''] ?? plain(t.step ?? '')}${t.status && t.status !== 'ok' ? `, ${plain(t.status).toLowerCase()}` : ''}${extra ? `: ${extra}` : ''}`;
}

export default function JobTimeline({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const file = useQuery({ queryKey: ['pipeline', 'job', jobId], queryFn: () => maybe<JobFile>(`/api/pipeline/jobs/${jobId}`) });
  const match = useQuery({ queryKey: ['match', 'job', jobId], queryFn: () => maybe<MatchView>(`/api/match/jobs/${jobId}`) });
  const tl = useQuery({ queryKey: ['pipeline', 'timeline', jobId], queryFn: () => maybe<{ state: unknown; timeline: TimelineEntry[] }>(`/api/campaigns/jobs/${jobId}/timeline`) });
  const appId = file.data?.applications[0]?.id;
  const writer = useQuery({ queryKey: ['writer', 'app', appId], queryFn: () => maybe<WriterDetail>(`/api/writer/applications/${appId}`), enabled: !!appId });
  const runs = useQuery({ queryKey: ['forms', 'runs', jobId], queryFn: () => optional<{ runs: FormRun[] }>(`/api/forms/runs?jobId=${jobId}`) });

  const f = file.data;
  const j = f?.job;
  return (
    <Drawer
      onClose={onClose}
      wide
      title={
        j ? (
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', lineHeight: 1.1, fontVariantNumeric: 'lining-nums' }}>{j.title}</h2>
            <div className="meta" style={{ marginTop: 4 }}>
              <span style={{ color: 'var(--text)' }}>{j.company}</span>
              <span>{j.remote ? 'Remote' : j.location || 'Location not given'}</span>
              {f?.pipeline ? <StateTag state={f.pipeline.state} /> : null}
            </div>
          </div>
        ) : (
          'Job'
        )
      }
    >
      {file.isLoading ? (
        <div className="skeleton" style={{ height: 400, marginTop: 'var(--s-4)' }} />
      ) : !f || !j ? (
        <p className="muted" style={{ paddingTop: 'var(--s-4)' }}>
          This job is no longer in Bureau.
        </p>
      ) : (
        <div className="tl" data-testid="timeline">
          <section>
            <Head
              icon={Radar}
              title="Found"
              right={
                <a className="btn ghost sm" href={j.applyUrl ?? j.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> The posting
                </a>
              }
            />
            <Facts
              rows={[
                ['Found', stamp(j.foundAt)],
                ['Posted', j.postedAt ? stamp(j.postedAt) : 'Not given'],
                ['Where from', [sourceLabel(j.source), ...(j.sources as { source?: string }[]).map((s) => (typeof s === 'string' ? s : s?.source ?? '')).filter(Boolean).map(sourceLabel)].filter((v, i, a) => a.indexOf(v) === i).join(', ')],
                ['Form', j.ats ?? (j.applyEmail ? 'Email' : 'Unknown')],
                ['Looks', j.legitimacy ? `${plain(j.legitimacy)}${j.legitimacyReasons.length ? `: ${j.legitimacyReasons.join(', ')}` : ''}` : 'Not checked'],
                ['Priority', j.priority ? `Raised by ${j.priority}` : 'Normal'],
              ]}
            />
            {f.pipeline?.lastError ? <div className="note bad" style={{ marginTop: 'var(--s-3)' }}>{f.pipeline.lastError}</div> : null}
            {f.pipeline?.nextActionAt ? (
              <p className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 'var(--s-2)' }}>
                Next try {stamp(f.pipeline.nextActionAt)}, attempt {f.pipeline.attempts + 1}.
              </p>
            ) : null}
          </section>

          <section>
            <Head icon={Scale} title="Match" />
            {match.data ? <MatchSection m={match.data} /> : <p className="muted">Not assessed yet.</p>}
          </section>

          <section>
            <Head icon={PenLine} title="Writer" />
            {writer.data && appId ? <WriterQuality w={writer.data} appId={appId} /> : <p className="muted">{appId ? 'This application was written before the v2 writer; open it in Studio.' : 'Nothing written yet.'}</p>}
          </section>

          <section>
            <Head icon={Workflow} title="Form" />
            <FormSection file={f} runs={runs.data?.runs ?? null} timeline={tl.data?.timeline ?? []} />
            {f.questions.length ? (
              <div className="stack" style={{ gap: 6, marginTop: 'var(--s-3)' }}>
                <span className="label">Questions it asked</span>
                {f.questions.map((q) => (
                  <div key={q.id} className="row" style={{ fontSize: 'var(--t-sm)' }}>
                    <span className={`tag ${q.status === 'open' ? 'brass' : q.status === 'answered' ? 'olive' : ''}`}>{plain(q.status)}</span>
                    <span>{q.question}</span>
                  </div>
                ))}
                {f.questions.some((q) => q.status === 'open') ? (
                  <div>
                    <a className="btn sm" href="#/questions">
                      Answer in Questions
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <Head icon={InboxIcon} title="Outcome" />
            {f.applications.length ? (
              <div className="stack" style={{ gap: 'var(--s-3)' }}>
                <Facts
                  rows={[
                    ['Application', plain(f.applications[0].status)],
                    ['Stage', plain(f.applications[0].stage)],
                    ['Sent', f.applications[0].sentAt ? stamp(f.applications[0].sentAt) : 'Not sent'],
                    ['By', f.applications[0].origin.startsWith('external') ? 'An outside agent' : plain(f.applications[0].channel)],
                    ['Reply', f.outcomes[0] ? (f.outcomes[0].replied ? `${plain(f.outcomes[0].replyClass ?? 'reply')} after ${f.outcomes[0].daysToReply ?? '?'} days` : 'No reply') : 'Waiting'],
                  ]}
                />
                {f.messages.length ? (
                  <div className="list" style={{ background: 'var(--bg)' }}>
                    {f.messages.map((m) => (
                      <div key={m.id} className="list-row static">
                        <div style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 8 }}>
                            <span className="tag">{CLASS_LABEL[m.class as keyof typeof CLASS_LABEL] ?? plain(m.class)}</span>
                            <span className="title">{m.subject}</span>
                          </div>
                          <div className="muted" style={{ fontSize: 'var(--t-sm)' }}>
                            {m.summary || m.from}
                          </div>
                        </div>
                        <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                          {ago(m.receivedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">Not applied yet.</p>
            )}
          </section>

          <section>
            <Head icon={ScrollText} title="Every step" />
            {tl.data?.timeline.length ? (
              <ul className="ledger" style={{ margin: '0 calc(var(--s-5) * -1)' }}>
                {tl.data.timeline.map((t, i) => (
                  <li key={i}>
                    <time dateTime={t.ts}>{stamp(t.ts)}</time>
                    <span>{entryText(t)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing logged yet.</p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

