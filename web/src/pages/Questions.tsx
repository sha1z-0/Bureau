import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, post, type UnknownQuestion } from '../api';
import { setParam, useRoute } from '../App';
import { Btn, ago, useToast } from '../ui';
import { PageHead, Tabs, plain } from '../kit';

type Status = 'open' | 'answered' | 'ignored';

function QuestionCard({ q }: { q: UnknownQuestion }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [answer, setAnswer] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['questions'] });
    qc.invalidateQueries({ queryKey: ['shell'] });
    qc.invalidateQueries({ queryKey: ['master', 'answers'] });
    qc.invalidateQueries({ queryKey: ['pipeline'] });
  };
  const save = useMutation({
    mutationFn: () => post<{ requeued: string[]; answered: string[] }>(`/api/master/questions/${q.id}/answer`, { answer: answer.trim() }),
    onSuccess: (r) => {
      const n = r.requeued?.length ?? 0;
      toast.success(`Saved to your answer bank.${n ? ` ${n} job${n === 1 ? '' : 's'} went back in the queue.` : ''}`);
      refresh();
    },
    onError: toast.error,
  });
  const ignore = useMutation({ mutationFn: () => post(`/api/master/questions/${q.id}/ignore`), onSuccess: refresh, onError: toast.error });
  const choice = q.options.length > 0 && q.options.length <= 12;
  return (
    <article className="card card-pad stack" style={{ gap: 'var(--s-3)' }} data-testid="question">
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--t-lg)', lineHeight: 1.35 }}>{q.questionRaw}</div>
        <div className="meta" style={{ marginTop: 4 }}>
          {q.job ? (
            <a href={`#/pipeline?job=${q.jobId}`}>
              {q.job.title} at {q.job.company}
            </a>
          ) : (
            <span>No job attached</span>
          )}
          <span>{plain(q.fieldKind)} field</span>
          <span>asked {ago(q.createdAt)}</span>
          {q.duplicates ? <span>{q.duplicates} more forms asked the same</span> : null}
        </div>
      </div>
      {q.status === 'open' ? (
        <>
          {choice ? (
            <div className="chips" role="radiogroup" aria-label="Options">
              {q.options.map((o) => (
                <button key={o} type="button" className="chip" role="radio" aria-checked={answer === o} aria-pressed={answer === o} onClick={() => setAnswer(o)}>
                  {o}
                </button>
              ))}
            </div>
          ) : null}
          {q.options.length === 0 ? (
            <textarea className="textarea" rows={q.fieldKind === 'textarea' ? 4 : 2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer, exactly as it should go on the form" aria-label="Answer" data-testid="question-answer" />
          ) : null}
          {q.options.length > 12 ? (
            <select className="select" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Choose an option">
              <option value="">Choose one</option>
              {q.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : null}
          <div className="row wrap">
            <Btn busy={save.isPending} disabled={!answer.trim()} onClick={() => save.mutate()} data-testid="question-save">
              <Check /> Save and re-queue
            </Btn>
            <Btn variant="ghost" busy={ignore.isPending} onClick={() => ignore.mutate()}>
              Ignore
            </Btn>
            <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>
              Saved answers are reused on every form that asks the same thing.
            </span>
          </div>
        </>
      ) : (
        <span className={`tag ${q.status === 'answered' ? 'olive' : ''}`} style={{ width: 'fit-content' }}>
          {q.status === 'answered' ? 'Answered' : 'Ignored'}
        </span>
      )}
    </article>
  );
}

export default function Questions() {
  const [, params] = useRoute();
  const status = (params.get('status') as Status) || 'open';
  const { data } = useQuery({ queryKey: ['questions', status], queryFn: () => api<{ questions: UnknownQuestion[] }>(`/api/master/questions?status=${status}`) });
  const open = useQuery({ queryKey: ['questions', 'open'], queryFn: () => api<{ questions: UnknownQuestion[] }>('/api/master/questions?status=open'), enabled: status !== 'open' });
  const openCount = status === 'open' ? data?.questions.length : open.data?.questions.length;
  const list = data?.questions ?? [];
  return (
    <>
      <PageHead title="Questions" lede="Things a form asked that Bureau couldn't answer truthfully on its own. Answer once: it goes into your answer bank and the job goes back in the queue." />
      <div style={{ marginBottom: 'var(--s-4)' }}>
        <Tabs<Status>
          label="Question status"
          value={status}
          onChange={(s) => setParam('status', s === 'open' ? null : s)}
          items={[
            { id: 'open', label: 'Open', count: openCount ?? null },
            { id: 'answered', label: 'Answered' },
            { id: 'ignored', label: 'Ignored' },
          ]}
        />
      </div>
      {!data ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : list.length ? (
        <div className="stack" style={{ gap: 'var(--s-3)', maxWidth: 860 }}>
          {list.map((q) => (
            <QuestionCard key={q.id} q={q} />
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            <h3>{status === 'open' ? 'Nothing to answer' : status === 'answered' ? 'No answered questions yet' : 'Nothing ignored'}</h3>
            <p>{status === 'open' ? 'When a form asks something your answer bank doesn’t cover, it lands here and in Telegram. Until then there is nothing for you to do.' : 'Questions you deal with are kept here for reference.'}</p>
          </div>
        </div>
      )}
    </>
  );
}
