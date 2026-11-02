import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { optional, post, type InboxClass, type InboxMessage } from '../api';
import { setParam, useRoute } from '../App';
import { Btn, ago, useToast } from '../ui';
import { NotSetUp, PageHead, stamp } from '../kit';

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

export default function Inbox() {
  const [, params] = useRoute();
  const cls = params.get('class') as InboxClass | null;
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['inbox', 'messages', cls],
    queryFn: () => optional<{ messages: InboxMessage[] }>(`/api/inbox/messages?limit=200${cls ? `&class=${cls}` : ''}`),
    refetchInterval: 60_000,
  });
  const all = useQuery({ queryKey: ['inbox', 'messages', null], queryFn: () => optional<{ messages: InboxMessage[] }>('/api/inbox/messages?limit=200'), enabled: !!cls });
  const poll = useMutation({
    mutationFn: () => post<{ fetched?: number }>('/api/inbox/poll'),
    onSuccess: (r) => {
      toast.info(r.fetched ? `${r.fetched} new messages.` : 'No new mail.');
      qc.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: toast.error,
  });
  const handled = useMutation({
    mutationFn: (m: InboxMessage) => post(`/api/inbox/messages/${m.id}/handled`, { handled: !m.handled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['shell'] });
    },
    onError: toast.error,
  });

  const head = (
    <PageHead
      title="Inbox"
      lede="Every reply to the job-search mailbox, sorted and linked to its application. Interviews, assessments and offers also reach Telegram at once. Bureau never answers them for you."
      actions={
        data ? (
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
  const counts = new Map<InboxClass, number>();
  for (const m of (cls ? all.data?.messages : data?.messages) ?? []) counts.set(m.class, (counts.get(m.class) ?? 0) + 1);
  const list = data?.messages ?? [];
  return (
    <>
      {head}
      <div className="chips" style={{ marginBottom: 'var(--s-4)' }} role="group" aria-label="Filter by kind">
        <button className="chip" aria-pressed={!cls} onClick={() => setParam('class', null)}>
          Everything
        </button>
        {ORDER.filter((c) => counts.get(c) || c === cls).map((c) => (
          <button key={c} className="chip" aria-pressed={cls === c} onClick={() => setParam('class', c)}>
            {CLASS_LABEL[c]} <span className="faint">{counts.get(c) ?? 0}</span>
          </button>
        ))}
      </div>
      {list.length ? (
        <section className="list" aria-label="Messages">
          {list.map((m) => (
            <div key={m.id} className="list-row static" style={m.handled ? { color: 'var(--text-2)' } : undefined}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className={`tag ${CLASS_TONE[m.class] ?? ''}`}>{CLASS_LABEL[m.class] ?? m.class}</span>
                  <span className="title" style={{ minWidth: 0 }}>
                    {m.subject || '(no subject)'}
                  </span>
                </div>
                <div className="meta" style={{ marginTop: 3 }}>
                  <span>{m.company ?? m.from}</span>
                  <time dateTime={m.receivedAt} title={stamp(m.receivedAt)}>
                    {ago(m.receivedAt)}
                  </time>
                  {m.deadline ? <span style={{ color: 'var(--warn)' }}>Reply by {stamp(m.deadline)}</span> : null}
                  {m.application ? <a href={`#/pipeline?job=${m.application.jobId}`}>{m.application.title}</a> : <span>Not linked to an application</span>}
                </div>
                {m.summary ? (
                  <div className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 4 }}>
                    {m.summary}
                  </div>
                ) : null}
                {m.schedulingLinks?.length ? (
                  <div className="meta" style={{ marginTop: 4 }}>
                    {m.schedulingLinks.slice(0, 2).map((l) => (
                      <a key={l} href={l} target="_blank" rel="noopener noreferrer">
                        Scheduling link
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              <Btn size="sm" variant="ghost" onClick={() => handled.mutate(m)}>
                {m.handled ? 'Mark as new' : 'Done'}
              </Btn>
            </div>
          ))}
        </section>
      ) : (
        <div className="card">
          <div className="empty">
            <h3>{cls ? `No ${CLASS_LABEL[cls].toLowerCase()} messages` : 'No replies yet'}</h3>
            <p>Bureau checks the mailbox every few minutes while it runs. Replies are matched to the application they answer and move it along.</p>
          </div>
        </div>
      )}
    </>
  );
}
