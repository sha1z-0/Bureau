import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { api, optional, post, put, type GapReport, type LearningItem, type StoredPlan } from '../api';
import { setParam, useRoute } from '../App';
import { Btn, Switch, ago, useToast } from '../ui';
import { Drawer, PageHead, day } from '../kit';
import { LearningListEditor } from '../editors';

function PlanView({ p }: { p: StoredPlan }) {
  const plan = p.plan;
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <div className="meta">
        <span>{plan.role}</span>
        {plan.interviewDate ? <span>Interview {day(plan.interviewDate)}</span> : null}
        <span>Made {ago(p.createdAt)}</span>
      </div>
      {plan.gaps.length ? (
        <div>
          <span className="label">Gaps to close</span>
          <div className="chips" style={{ marginTop: 6 }}>
            {plan.gaps.map((g) => (
              <span key={g} className="tag brass">
                {g}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {plan.days.map((d) => (
        <section key={d.day} style={{ display: 'grid', gap: 6, paddingTop: 'var(--s-3)', borderTop: '1px solid var(--line)' }}>
          <h3 style={{ fontSize: 'var(--t-md)', fontWeight: 600 }}>
            Day {d.day}: {d.focus}
          </h3>
          <ul className="list-dash">
            {d.tasks.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          {d.miniProject ? (
            <p style={{ fontSize: 'var(--t-sm)' }}>
              <strong>Mini project:</strong> {d.miniProject}
            </p>
          ) : null}
          {d.resources.length ? (
            <div className="meta">
              {d.resources.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.title}
                  {r.free ? '' : ' (paid)'} <ExternalLink size={11} />
                </a>
              ))}
            </div>
          ) : null}
        </section>
      ))}
      {plan.likelyQuestions.length ? (
        <section style={{ display: 'grid', gap: 6 }}>
          <h3 style={{ fontSize: 'var(--t-md)', fontWeight: 600 }}>Questions they're likely to ask</h3>
          <ul className="list-dash">
            {plan.likelyQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan.talkingPoints.length ? (
        <section style={{ display: 'grid', gap: 6 }}>
          <h3 style={{ fontSize: 'var(--t-md)', fontWeight: 600 }}>Your real experience, mapped to the role</h3>
          <ul className="list-dash good">
            {plan.talkingPoints.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function Learning() {
  const [, params] = useRoute();
  const planId = params.get('plan');
  const toast = useToast();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['learning', 'plans'], queryFn: () => optional<{ plans: StoredPlan[] }>('/api/learning/plans') });
  const gaps = useQuery({ queryKey: ['learning', 'gaps'], queryFn: () => optional<{ report: GapReport | null }>('/api/learning/gaps') });
  const settings = useQuery({ queryKey: ['learning', 'settings'], queryFn: () => optional<{ autoAcceptTopGaps: boolean }>('/api/learning/settings') });
  const list = useQuery({ queryKey: ['master', 'learning'], queryFn: () => api<{ items: LearningItem[] }>('/api/master/learning') });
  const [adding, setAdding] = useState<string | null>(null);
  const runGaps = useMutation({
    mutationFn: () => post('/api/learning/gaps/run'),
    onSuccess: () => {
      toast.success('Gap report rebuilt.');
      qc.invalidateQueries({ queryKey: ['learning'] });
    },
    onError: toast.error,
  });
  const auto = useMutation({
    mutationFn: (v: boolean) => put('/api/learning/settings', { autoAcceptTopGaps: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['learning', 'settings'] }),
    onError: toast.error,
  });
  const addSkill = useMutation({
    mutationFn: (skill: string) => {
      setAdding(skill);
      return post('/api/master/learning', { skill, status: 'queued' });
    },
    onSuccess: (_r, skill) => {
      toast.success(`${skill} is queued on your learning list. Mark it Learning when you start.`);
      qc.invalidateQueries({ queryKey: ['master', 'learning'] });
    },
    onError: toast.error,
    onSettled: () => setAdding(null),
  });
  const known = new Set((list.data?.items ?? []).map((i) => i.skill.toLowerCase()));
  const open = plans.data?.plans.find((p) => p.id === planId);
  const report = gaps.data?.report;

  return (
    <>
      <PageHead title="Learning" lede="When a company shows interest, a crash plan to close that role's gaps before the interview. Each week, the skills most often missing across the jobs Bureau scored." />
      <div className="split">
        <div className="grid">
          <section className="card">
            <div className="card-head">
              <h2>Crash plans</h2>
            </div>
            {plans.data === null ? (
              <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                Learning plans aren't in this build yet. Once they are, every interview or assessment gets a day-by-day plan here.
              </p>
            ) : plans.data?.plans.length ? (
              plans.data.plans.map((p) => (
                <button key={p.id} className="list-row" onClick={() => setParam('plan', p.id)}>
                  <div style={{ minWidth: 0 }}>
                    <div className="title">{p.company}</div>
                    <div className="meta">
                      <span>{p.plan.role}</span>
                      <span>{p.plan.days.length} days</span>
                      {p.plan.interviewDate ? <span>Interview {day(p.plan.interviewDate)}</span> : null}
                    </div>
                  </div>
                  <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                    {ago(p.createdAt)}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                No interviews yet. When one arrives, its plan appears here and in the Telegram alert.
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>This week's gaps</h2>
              {gaps.data !== null ? (
                <Btn size="sm" variant="ghost" busy={runGaps.isPending} onClick={() => runGaps.mutate()}>
                  <RefreshCw /> Rebuild
                </Btn>
              ) : null}
            </div>
            {gaps.data === null ? (
              <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                The weekly gap report isn't in this build yet.
              </p>
            ) : report?.skills.length ? (
              <>
                <p className="muted" style={{ padding: '0 var(--s-5)', fontSize: 'var(--t-sm)' }}>
                  {report.period}, across {report.jobsConsidered.toLocaleString()} scored jobs, weighted by how good the jobs were.
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Skill</th>
                        <th className="num">Jobs</th>
                        <th className="hide-phone">A weekend project</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {report.skills.map((s) => (
                        <tr key={s.skill}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{s.skill}</div>
                            <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                              {s.typicalDepth}
                            </div>
                          </td>
                          <td className="num">{s.count}</td>
                          <td className="hide-phone muted">{s.suggestedProject}</td>
                          <td style={{ textAlign: 'right' }}>
                            {known.has(s.skill.toLowerCase()) ? (
                              <span className="tag olive">On your list</span>
                            ) : (
                              <Btn size="sm" busy={adding === s.skill} onClick={() => addSkill.mutate(s.skill)}>
                                <Plus /> Add
                              </Btn>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                The first report is built on the weekly day set in Settings, once there are scored jobs to learn from.
              </p>
            )}
            {settings.data ? (
              <div className="toggle-row" style={{ padding: 'var(--s-3) var(--s-5)', borderTop: '1px solid var(--line)' }}>
                <div>
                  <strong>Queue the top three gaps automatically</strong>
                  <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>
                    They go on your list as Queued. Nothing reaches a CV until you mark it Learning.
                  </div>
                </div>
                <Switch label="Queue the top gaps" checked={settings.data.autoAcceptTopGaps} onChange={(v) => auto.mutate(v)} />
              </div>
            ) : null}
          </section>
        </div>
        <section className="card card-pad">
          <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
            Your learning list
          </h2>
          <LearningListEditor />
        </section>
      </div>
      {open ? (
        <Drawer title={`Crash plan: ${open.company}`} onClose={() => setParam('plan', null)}>
          <PlanView p={open} />
        </Drawer>
      ) : null}
    </>
  );
}
