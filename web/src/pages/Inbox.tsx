import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { api, maybe, optional, post, put, type Application, type FollowUps, type InboxClass, type InboxMessage, type InboxStatus } from '../api';
import { setParam, useRoute } from '../App';
import { Btn, Field, ago, useToast } from '../ui';
import { Drawer, Facts, NotSetUp, PageHead, Tabs, day, pct, plain, stamp } from '../kit';

export const CLASS_LABEL: Record<InboxClass, string> = {
  interview_invite: 'Interview',
  assessment: 'Assessment',
  offer: 'Offer',
  recruiter_question: 'Recruiter question',
  rejection: 'Rejection',
  confirmation_received: 'Received',
  verification_code: 'Verification code',
  other: 'Other',
};

const CLASS_TONE: Partial<Record<InboxClass, string>> = { interview_invite: 'crimson', assessment: 'brass', offer: 'olive', recruiter_question: 'brass' };

/** Order of the filter chips: what the owner acts on first. */
const ORDER: InboxClass[] = ['interview_invite', 'assessment', 'offer', 'recruiter_question', 'rejection', 'confirmation_received', 'verification_code', 'other'];

const VIA_LABEL: Record<InboxMessage['via'], string> = { rules: 'by rule', ai: 'by Claude', fallback: 'by rule (Claude unavailable)', owner: 'by you' };

type Tab = 'messages' | 'followups';
type View = 'review' | 'unlinked';

function MessageDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['inbox', 'message', id], queryFn: () => maybe<{ message: InboxMessage }>(`/api/inbox/messages/${encodeURIComponent(id)}`) });
  const m = data?.message;
  const [fixing, setFixing] = useState(false);
  const [fix, setFix] = useState<{ class: InboxClass; applicationId: string }>({ class: 'other', applicationId: '' });
  const apps = useQuery({ queryKey: ['applications', 'all'], queryFn: () => api<{ applications: Application[] }>('/api/applications'), enabled: fixing });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inbox'] });
    qc.invalidateQueries({ queryKey: ['shell'] });
  };
  const done = useMutation({
    mutationFn: (v: boolean) => post(`/api/inbox/messages/${encodeURIComponent(id)}/done`, { done: v }),
    onSuccess: refresh,
    onError: toast.error,
  });
  const correct = useMutation({
    mutationFn: () => put(`/api/inbox/messages/${encodeURIComponent(id)}`, { class: fix.class, applicationId: fix.applicationId || null }),
    onSuccess: () => {
      toast.success('Corrected. The application stage follows your correction.');
      setFixing(false);
      refresh();
      qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: toast.error,
  });
  const draft = useMutation({
    mutationFn: (a: 'done' | 'dismiss') => post(`/api/inbox/drafts/${encodeURIComponent(id)}/${a}`),
    onSuccess: (_r, a) => {
      toast.success(a === 'done' ? 'Marked as sent by you.' : 'Draft thrown away.');
      refresh();
    },
    onError: toast.error,
  });
  const startFix = () => {
    if (!m) return;
    setFix({ class: m.class, applicationId: m.applicationId ?? '' });
    setFixing(true);
  };

  return (
    <Drawer
      title={m ? m.subject || '(no subject)' : 'Message'}
      onClose={onClose}
      wide
      actions={
        m ? (
          <Btn size="sm" variant={m.done ? 'ghost' : undefined} busy={done.isPending} onClick={() => done.mutate(!m.done)}>
            {m.done ? 'Mark as new' : 'Done'}
          </Btn>
        ) : null
      }
    >
      {isLoading ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : m ? (
        <div className="tl">
          {m.suspicious ? (
            <div className="callout crimson" role="alert">
              <AlertTriangle />
              <span>
                Held for review: this message looks like an imitation of an employer or an ATS, or tries to give instructions. Bureau took no action on it. Don't follow its links unless you are sure who sent
                it.
              </span>
            </div>
          ) : m.needsReview ? (
            <div className="callout">
              <AlertTriangle />
              <span>Bureau wasn't sure about this one. Check the kind and the application below, and correct them if they're wrong.</span>
            </div>
          ) : null}
          <section>
            <Facts
              rows={[
                ['From', m.from],
                ['Received', stamp(m.receivedAt)],
                ['Kind', `${CLASS_LABEL[m.class] ?? m.class}, ${VIA_LABEL[m.via] ?? m.via}${m.via === 'owner' ? '' : ` (${pct(m.confidence)} sure)`}`],
                ['Company', [m.company, m.role].filter(Boolean).join(', ')],
                ['Application', m.jobId ? <a href={`#/pipeline?job=${encodeURIComponent(m.jobId)}`}>Open the job</a> : m.applicationId ? 'Linked' : 'Not linked'],
                ['Stage', m.stage ? `${plain(m.stage.from)} to ${plain(m.stage.to)}` : ''],
                ['Reply by', m.deadline ? stamp(m.deadline) : ''],
                ['Interview', m.interviewDate ? stamp(m.interviewDate) : ''],
                ['Crash plan', m.planId ? <a href={`#/learning?plan=${encodeURIComponent(m.planId)}`}>Open the plan</a> : ''],
              ]}
            />
          </section>
          {m.summary ? (
            <section>
              <p>{m.summary}</p>
            </section>
          ) : null}
          {!m.suspicious && (m.schedulingLinks.length || (m.links.length && m.class !== 'verification_code')) ? (
            <section>
              <div className="section-head">
                <h3>Links in the message</h3>
              </div>
              <div className="stack" style={{ gap: 4, fontSize: 'var(--t-sm)' }}>
                {[...new Set([...m.schedulingLinks, ...m.links])].slice(0, 8).map((l) => (
                  <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: 'anywhere' }}>
                    {m.schedulingLinks.includes(l) ? 'Scheduling: ' : ''}
                    {l.replace(/^https?:\/\//, '').slice(0, 90)} <ExternalLink size={11} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          {m.questions.length ? (
            <section>
              <div className="section-head">
                <h3>What they asked</h3>
              </div>
              <ul className="list-dash">
                {m.questions.map((q, i) => (
                  <li key={i}>
                    {q}
                    {m.unanswered.includes(q) ? <span className="faint"> (not in your answer bank yet)</span> : null}
                  </li>
                ))}
              </ul>
              {m.unanswered.length ? (
                <p className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 'var(--s-2)' }}>
                  Unanswered questions wait in <a href="#/questions">Questions</a>.
                </p>
              ) : null}
            </section>
          ) : null}
          {m.draft ? (
            <section>
              <div className="section-head">
                <h3>Drafted reply</h3>
                <span className="spacer" />
                <span className={`tag ${m.draft.status === 'queued' ? 'brass' : ''}`}>{m.draft.status === 'queued' ? 'Waiting for you' : m.draft.status === 'done' ? 'You sent it' : 'Dismissed'}</span>
              </div>
              <p className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 0 }}>
                Written from your answer bank. Bureau never sends it: copy it into your mail if it's right.
              </p>
              <div className="faint" style={{ fontSize: 'var(--t-xs)', marginBottom: 6 }}>
                To {m.draft.to}, “{m.draft.subject}”
              </div>
              <div className="letter" style={{ fontSize: '1rem', padding: 'var(--s-4)' }}>
                {m.draft.body}
              </div>
              {m.draft.status === 'queued' ? (
                <div className="row" style={{ marginTop: 'var(--s-3)' }}>
                  <Btn size="sm" busy={draft.isPending && draft.variables === 'done'} onClick={() => draft.mutate('done')}>
                    I sent it
                  </Btn>
                  <Btn size="sm" variant="ghost" busy={draft.isPending && draft.variables === 'dismiss'} onClick={() => draft.mutate('dismiss')}>
                    Dismiss
                  </Btn>
                </div>
              ) : null}
            </section>
          ) : null}
          {m.preview ? (
            <section>
              <div className="section-head">
                <h3>The message</h3>
              </div>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--t-sm)', overflowWrap: 'anywhere' }}>
                {m.preview}
              </div>
            </section>
          ) : m.class === 'verification_code' ? (
            <p className="faint" style={{ fontSize: 'var(--t-sm)' }}>
              Verification mail keeps no text, links or code here: the code goes to the form that asked for it and expires after 15 minutes.
            </p>
          ) : null}
          <section>
            <div className="section-head">
              <h3>Why it was filed this way</h3>
            </div>
            <p className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 0 }}>
              {m.reason || 'No reason recorded.'}
              {m.link.reasons.length ? ` Linked because: ${m.link.reasons.join('; ')}.` : ''}
              {m.link.ambiguous ? ' More than one application fits, so it was left for you.' : ''}
            </p>
            {fixing ? (
              <form
                className="stack"
                style={{ gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  correct.mutate();
                }}
              >
                <div className="form-grid">
                  <Field label="Kind">
                    <select className="select" value={fix.class} onChange={(e) => setFix({ ...fix, class: e.target.value as InboxClass })}>
                      {ORDER.filter((c) => c !== 'verification_code' || m.class === 'verification_code').map((c) => (
                        <option key={c} value={c}>
                          {CLASS_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Application">
                    <select className="select" value={fix.applicationId} onChange={(e) => setFix({ ...fix, applicationId: e.target.value })} disabled={apps.isLoading}>
                      <option value="">Not linked</option>
                      {(apps.data?.applications ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.job ? `${a.job.company}, ${a.job.title}` : a.id}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="row">
                  <Btn type="submit" size="sm" busy={correct.isPending}>
                    Save the correction
                  </Btn>
                  <Btn type="button" size="sm" variant="ghost" onClick={() => setFixing(false)}>
                    Cancel
                  </Btn>
                </div>
              </form>
            ) : (
              <Btn size="sm" variant="ghost" onClick={startFix}>
                Correct the kind or application
              </Btn>
            )}
          </section>
        </div>
      ) : (
        <p className="muted">This message is no longer in Bureau.</p>
      )}
    </Drawer>
  );
}

function FollowUpsPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['inbox', 'followups'], queryFn: () => optional<FollowUps>('/api/inbox/followups') });
  const [confirm, setConfirm] = useState(false);
  const run = useMutation({
    mutationFn: () => post<{ sent: number; rehearsed: number; capReached: boolean; writerUnavailable: boolean }>('/api/inbox/followups/run'),
    onSuccess: (r) => {
      setConfirm(false);
      toast.info(r.writerUnavailable ? 'The writer is not available, so nothing was sent.' : `${r.sent} sent${r.rehearsed ? `, ${r.rehearsed} rehearsed` : ''}${r.capReached ? '. Today’s limit is reached.' : '.'}`);
      qc.invalidateQueries({ queryKey: ['inbox', 'followups'] });
    },
    onError: toast.error,
  });
  if (isLoading) return <div className="skeleton" style={{ height: 240 }} />;
  if (!data) return <NotSetUp title="Follow-ups aren't in this build yet" />;
  const group = (title: string, items: FollowUps['due'], note: (c: FollowUps['due'][number]) => string) =>
    items.length ? (
      <section className="card">
        <div className="card-head">
          <h2>{title}</h2>
          <span className="faint num">{items.length}</span>
        </div>
        {items.slice(0, 50).map((c) => (
          <a key={c.applicationId} className="list-row" href={`#/pipeline?job=${encodeURIComponent(c.jobId)}`}>
            <div style={{ minWidth: 0 }}>
              <div className="title">{c.company}</div>
              <div className="meta">
                <span>{c.title}</span>
                <span>Sent {day(c.sentAt)}</span>
                {c.dryRun ? <span>Dry run</span> : null}
              </div>
            </div>
            <span className="faint" style={{ fontSize: 'var(--t-xs)', textAlign: 'right' }}>
              {note(c)}
            </span>
          </a>
        ))}
      </section>
    ) : null;
  return (
    <div className="grid" style={{ gap: 'var(--s-4)' }}>
      <section className="card card-pad">
        <div className="row wrap">
          <div style={{ minWidth: 0, flex: '1 1 300px' }}>
            <h2 className="section-title">One polite follow-up, once</h2>
            <p className="muted" style={{ fontSize: 'var(--t-sm)', margin: '4px 0 0' }}>
              Only to an address published in the posting, only when nobody has replied, never after a rejection. {data.today} of {data.perDay} sent today.
            </p>
          </div>
          {data.due.length ? (
            confirm ? (
              <div className="row">
                <Btn busy={run.isPending} onClick={() => run.mutate()}>
                  Send {data.due.length} now
                </Btn>
                <Btn variant="ghost" onClick={() => setConfirm(false)}>
                  Cancel
                </Btn>
              </div>
            ) : (
              <Btn variant="ghost" onClick={() => setConfirm(true)}>
                Send the due ones now
              </Btn>
            )
          ) : null}
        </div>
      </section>
      {group('Due now', data.due, (c) => (c.to ? `To ${c.to}` : ''))}
      {group('Waiting', data.waiting, (c) => `Due ${day(c.dueAt)}`)}
      {group('Won’t be sent', data.blocked, (c) => c.blocked ?? '')}
      <section className="card">
        <div className="card-head">
          <h2>Sent and rehearsed</h2>
        </div>
        {data.log.length ? (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.log.map((f, i) => (
                  <tr key={`${f.applicationId}-${i}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.company ?? 'Unknown company'}</div>
                      <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                        {f.subject}
                      </div>
                    </td>
                    <td className="hide-phone muted" style={{ overflowWrap: 'anywhere' }}>
                      {f.to ?? ''}
                    </td>
                    <td>
                      <span className={`tag ${f.status === 'sent' ? 'olive' : f.status === 'failed' ? 'crimson' : ''}`}>{plain(f.status)}</span>
                    </td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {ago(f.sentAt ?? f.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
            None yet.
          </p>
        )}
      </section>
    </div>
  );
}

/** Change several query parameters at once (one history entry). */
function setParams(next: Record<string, string | null>) {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const p = new URLSearchParams(query ?? '');
  for (const [k, v] of Object.entries(next)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  const q = p.toString();
  window.location.hash = `/${path || 'inbox'}${q ? `?${q}` : ''}`;
}

export default function Inbox() {
  const [, params] = useRoute();
  const tab = (params.get('tab') as Tab) || 'messages';
  const cls = params.get('class') as InboxClass | null;
  const view = params.get('view') as View | null;
  const openId = params.get('message');
  const toast = useToast();
  const qc = useQueryClient();
  const query = new URLSearchParams({ limit: '200' });
  if (cls) query.set('class', cls);
  if (view === 'review') query.set('review', '1');
  if (view === 'unlinked') query.set('unlinked', '1');
  const { data, isLoading } = useQuery({
    queryKey: ['inbox', 'messages', cls, view],
    queryFn: () => optional<{ items: InboxMessage[]; total: number }>(`/api/inbox/messages?${query}`),
    refetchInterval: 60_000,
  });
  const status = useQuery({ queryKey: ['inbox', 'status'], queryFn: () => optional<InboxStatus>('/api/inbox/status'), refetchInterval: 60_000 });
  const poll = useMutation({
    mutationFn: () => post<{ handled: number }>('/api/inbox/poll'),
    onSuccess: (r) => {
      toast.info(r.handled ? `${r.handled} new ${r.handled === 1 ? 'message' : 'messages'}.` : 'No new mail.');
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['shell'] });
    },
    onError: toast.error,
  });
  const done = useMutation({
    mutationFn: (m: InboxMessage) => post(`/api/inbox/messages/${encodeURIComponent(m.id)}/done`, { done: !m.done }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['shell'] });
    },
    onError: toast.error,
  });

  const st = status.data;
  const head = (
    <PageHead
      title="Inbox"
      lede="Every reply to the job-search mailbox, sorted and linked to its application. Interviews, assessments and offers also reach Telegram at once. Bureau never answers them for you."
      actions={
        data && st?.enabled ? (
          <Btn busy={poll.isPending} onClick={() => poll.mutate()}>
            <RefreshCw /> Check now
          </Btn>
        ) : null
      }
    />
  );
  if (isLoading)
    return (
      <>
        {head}
        <div className="skeleton" style={{ height: 300 }} />
      </>
    );
  if (data === null)
    return (
      <>
        {head}
        <NotSetUp title="The inbox reader isn't in this build yet" action={<a className="btn" href="#/settings">Open Settings</a>}>
          Once it is, connect the job-search mailbox in Settings and replies appear here, sorted into interviews, assessments, rejections and the rest.
        </NotSetUp>
      </>
    );

  const counts = st?.counts.all ?? {};
  const list = data?.items ?? [];
  const statusLine = st ? (
    st.lastError ? (
      <p className="note bad" style={{ marginBottom: 'var(--s-3)' }}>
        <AlertTriangle /> Last check failed {ago(st.lastError.at)}: {st.lastError.message}
      </p>
    ) : !st.enabled ? (
      <p className="muted" style={{ fontSize: 'var(--t-sm)', marginBottom: 'var(--s-3)' }}>
        The mailbox isn't being checked. <a href="#/settings">Connect it in Settings</a>.
      </p>
    ) : (
      <p className="faint" style={{ fontSize: 'var(--t-xs)', marginBottom: 'var(--s-3)' }}>
        {st.lastPoll ? `Last checked ${ago(st.lastPoll.at)}.` : 'Not checked yet.'}
        {st.codes.waiting ? ' A form is waiting for a verification code.' : ''}
      </p>
    )
  ) : null;

  return (
    <>
      {head}
      {statusLine}
      <div style={{ marginBottom: 'var(--s-4)' }}>
        <Tabs<Tab>
          label="Inbox sections"
          value={tab}
          onChange={(t) => setParams({ class: null, view: null, tab: t === 'messages' ? null : t })}
          items={[
            { id: 'messages', label: 'Messages', count: st ? Object.values(counts).reduce((n, v) => n + (v ?? 0), 0) : null },
            { id: 'followups', label: 'Follow-ups' },
          ]}
        />
      </div>
      {tab === 'followups' ? (
        <FollowUpsPanel />
      ) : (
        <>
          <div className="chips" style={{ marginBottom: 'var(--s-4)' }} role="group" aria-label="Filter">
            <button className="chip" aria-pressed={!cls && !view} onClick={() => setParams({ class: null, view: null })}>
              Everything
            </button>
            {st?.review || view === 'review' ? (
              <button className="chip" aria-pressed={view === 'review'} onClick={() => setParams({ class: null, view: view === 'review' ? null : 'review' })}>
                Needs a look <span className="faint">{st?.review ?? 0}</span>
              </button>
            ) : null}
            {st?.unlinked || view === 'unlinked' ? (
              <button className="chip" aria-pressed={view === 'unlinked'} onClick={() => setParams({ class: null, view: view === 'unlinked' ? null : 'unlinked' })}>
                Not linked <span className="faint">{st?.unlinked ?? 0}</span>
              </button>
            ) : null}
            {ORDER.filter((c) => counts[c] || c === cls).map((c) => (
              <button key={c} className="chip" aria-pressed={cls === c} onClick={() => setParams({ view: null, class: c })}>
                {CLASS_LABEL[c]} <span className="faint">{counts[c] ?? 0}</span>
              </button>
            ))}
          </div>
          {list.length ? (
            <section className="list" aria-label="Messages">
              {list.map((m) => (
                <div key={m.id} className="list-row static" data-testid="inbox-message" style={m.done ? { color: 'var(--text-2)' } : undefined}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className={`tag ${m.done ? '' : (CLASS_TONE[m.class] ?? '')}`}>{CLASS_LABEL[m.class] ?? m.class}</span>
                      {m.suspicious ? <span className="tag crimson">Held for review</span> : m.needsReview ? <span className="tag brass">Check this</span> : null}
                      {m.draft?.status === 'queued' ? <span className="tag brass">Reply drafted</span> : null}
                      <a
                        className="title"
                        href={`#/inbox?message=${encodeURIComponent(m.id)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          setParam('message', m.id);
                        }}
                        style={m.done ? { fontWeight: 400 } : undefined}
                      >
                        {m.subject || '(no subject)'}
                      </a>
                    </div>
                    <div className="meta" style={{ marginTop: 3 }}>
                      <span>{m.company ?? m.from}</span>
                      <time dateTime={m.receivedAt} title={stamp(m.receivedAt)}>
                        {ago(m.receivedAt)}
                      </time>
                      {m.deadline ? <span style={{ color: 'var(--warn)' }}>Reply by {stamp(m.deadline)}</span> : null}
                      {m.jobId ? (
                        <a href={`#/pipeline?job=${encodeURIComponent(m.jobId)}`}>{m.role ?? 'The application'}</a>
                      ) : m.class === 'verification_code' || m.class === 'other' ? null : (
                        <span>Not linked to an application</span>
                      )}
                      {m.planId ? <a href={`#/learning?plan=${encodeURIComponent(m.planId)}`}>Crash plan</a> : null}
                    </div>
                    {m.summary ? (
                      <div className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 4 }}>
                        {m.summary}
                      </div>
                    ) : null}
                    {m.schedulingLinks.length && !m.suspicious ? (
                      <div className="meta" style={{ marginTop: 4 }}>
                        {m.schedulingLinks.slice(0, 2).map((l) => (
                          <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow">
                            Scheduling link <ExternalLink size={11} />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Btn size="sm" variant="ghost" busy={done.isPending && done.variables?.id === m.id} onClick={() => done.mutate(m)}>
                    {m.done ? 'Mark as new' : 'Done'}
                  </Btn>
                </div>
              ))}
            </section>
          ) : (
            <div className="card">
              <div className="empty">
                <h3>{cls ? `No ${CLASS_LABEL[cls].toLowerCase()} messages` : view === 'review' ? 'Nothing to check' : view === 'unlinked' ? 'Every reply is linked' : 'No replies yet'}</h3>
                <p>Bureau checks the mailbox every few minutes while it runs. Replies are matched to the application they answer and move it along.</p>
              </div>
            </div>
          )}
        </>
      )}
      {openId ? <MessageDrawer id={openId} onClose={() => setParam('message', null)} /> : null}
    </>
  );
}
