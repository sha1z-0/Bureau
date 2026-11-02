import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, type JobSummary } from '../api';
import { Empty, Seal, ago, useToast } from '../ui';

const LANES = [
  { stage: 'found', title: 'Shortlisted', hint: 'Marked to pursue' },
  { stage: 'drafted', title: 'Drafted', hint: 'In the studio' },
  { stage: 'applied', title: 'Applied', hint: 'Out in the world' },
  { stage: 'interview', title: 'Interview', hint: 'Conversations' },
  { stage: 'offer', title: 'Offer', hint: 'Terms on the table' },
  { stage: 'rejected', title: 'Closed', hint: 'Rejected or withdrawn' },
  { stage: 'ghosted', title: 'Silent', hint: 'No reply after 3 weeks' },
] as const;

export default function Pipeline() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['jobs', 'pipeline'], queryFn: () => api<{ jobs: JobSummary[] }>('/api/jobs?pipeline=1&limit=500&sort=recent') });
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => patch(`/api/jobs/${id}`, { stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ['jobs', 'pipeline'] });
      const prev = qc.getQueryData<{ jobs: JobSummary[] }>(['jobs', 'pipeline']);
      qc.setQueryData(['jobs', 'pipeline'], { jobs: (prev?.jobs ?? []).map((j) => (j.id === id ? { ...j, stage } : j)) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['jobs', 'pipeline'], ctx.prev);
      toast.error(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['overview'] }),
  });

  const jobs = data?.jobs ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p>Drag a card to move it along. Each move is recorded, so the Overview always knows where you stand.</p>
        </div>
      </header>
      {jobs.length === 0 ? (
        <div className="card">
          <Empty title="An empty ledger">Shortlist or draft for a role in Jobs and it will appear here.</Empty>
        </div>
      ) : (
        <div className="kanban">
          {LANES.map((lane) => {
            const cards = jobs.filter((j) => j.stage === lane.stage);
            return (
              <section
                key={lane.stage}
                className={`lane ${over === lane.stage ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(lane.stage);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData('text/plain');
                  const job = jobs.find((j) => j.id === id);
                  if (job && job.stage !== lane.stage) move.mutate({ id, stage: lane.stage });
                }}
                aria-label={lane.title}
              >
                <div className="lane-head">
                  <div>
                    <h3>{lane.title}</h3>
                    <div className="faint" style={{ fontSize: '0.75rem' }}>
                      {lane.hint}
                    </div>
                  </div>
                  <span className="muted">{cards.length}</span>
                </div>
                <div className="lane-body">
                  {cards.map((j) => (
                    <article
                      key={j.id}
                      className={`kcard ${dragging === j.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', j.id);
                        setDragging(j.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <Seal grade={j.grade} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <a href={`#/jobs?id=${j.id}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600, lineHeight: 1.25, display: 'block' }}>
                            {j.title}
                          </a>
                          <div className="muted" style={{ fontSize: '0.8125rem' }}>
                            {j.company}
                          </div>
                        </div>
                      </div>
                      <div className="row faint" style={{ fontSize: '0.75rem' }}>
                        <span>{j.remote ? 'Remote' : j.location}</span>
                        <span className="spacer" />
                        <span>{ago(j.foundAt)}</span>
                      </div>
                      <select
                        className="select"
                        style={{ minHeight: 28, padding: '2px 8px', fontSize: '0.75rem' }}
                        value={j.stage}
                        onChange={(e) => move.mutate({ id: j.id, stage: e.target.value })}
                        aria-label={`Move ${j.title}`}
                      >
                        {LANES.map((l) => (
                          <option key={l.stage} value={l.stage}>
                            {l.title}
                          </option>
                        ))}
                      </select>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
