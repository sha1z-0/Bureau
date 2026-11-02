import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, FileText, Lock, MessageSquare, RefreshCw, ScrollText, ShieldCheck, Stamp, Trash2 } from 'lucide-react';
import { api, del, post, put, ApiError, type Application, type TailoredCv } from '../api';
import { go, setParam, useRoute } from '../App';
import { PageHead, Tabs } from '../kit';
import { BanditPanel, WrittenPanel } from './Writer';
import { VoiceBankEditor } from '../editors';
import { Btn, Empty, Field, Modal, Seal, ago, useToast } from '../ui';

type Tab = 'letter' | 'message' | 'cv' | 'lock';

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', approved: 'Approved', needs_you: 'Needs you' };

function Drafts() {
  const [, params] = useRoute();
  const { data } = useQuery({ queryKey: ['applications', 'drafts'], queryFn: () => api<{ applications: Application[] }>('/api/applications') });
  const items = (data?.applications ?? []).filter((a) => a.status === 'draft' || a.status === 'approved' || a.status === 'needs_you');
  const [selected, setSelected] = useState<string | null>(params.get('id'));

  useEffect(() => {
    const id = params.get('id');
    if (id) setSelected(id);
  }, [params]);
  useEffect(() => {
    if (!selected && items.length) setSelected(items[0].id);
  }, [items, selected]);

  return (
    <>
      {items.length === 0 ? (
        <div className="card">
          <Empty title="No drafts yet" action={<a className="btn" href="#/jobs">Pick a role in Jobs</a>}>
            Open a role in Jobs and choose Write application. Campaigns write and send on their own; their applications are under Written by the campaigns.
          </Empty>
        </div>
      ) : (
        <div className="studio">
          <div className="job-list">
            {items.map((a) => (
              <button key={a.id} className="draft-item" aria-selected={selected === a.id} onClick={() => setSelected(a.id)}>
                <div className="row">
                  <Seal grade={a.job?.grade ?? null} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{a.job?.title}</div>
                    <div className="muted" style={{ fontSize: '0.8125rem' }}>
                      {a.job?.company}
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`tag ${a.status === 'approved' ? 'olive' : a.status === 'needs_you' ? 'crimson' : ''}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
                  {a.issues.some((i) => i.severity === 'high') ? <span className="tag crimson">fact lock</span> : null}
                  <span className="faint" style={{ fontSize: '0.75rem' }}>
                    {ago(a.updatedAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {selected ? <Editor key={selected} id={selected} /> : null}
        </div>
      )}
    </>
  );
}

function Editor({ id }: { id: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: app } = useQuery({ queryKey: ['applications', id], queryFn: () => api<Application>(`/api/applications/${id}`) });
  const [tab, setTab] = useState<Tab>('letter');
  const [form, setForm] = useState<Pick<Application, 'subject' | 'coverLetter' | 'message' | 'toEmail' | 'channel'> & { cv: TailoredCv } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pdfKey, setPdfKey] = useState(0);
  const [regen, setRegen] = useState(false);
  const [confirmIssues, setConfirmIssues] = useState(false);

  useEffect(() => {
    if (app && !dirty) setForm({ subject: app.subject, coverLetter: app.coverLetter, message: app.message, toEmail: app.toEmail, channel: app.channel, cv: app.cv });
  }, [app, dirty]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['applications'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  };

  const save = useMutation({
    mutationFn: () => put<Application>(`/api/applications/${id}`, { ...form, toEmail: form?.toEmail ?? '' }),
    onSuccess: () => {
      setDirty(false);
      setPdfKey((k) => k + 1);
      refresh();
      toast.success('Saved.');
    },
    onError: toast.error,
  });

  const approve = useMutation({
    mutationFn: async (acknowledgeIssues: boolean) => {
      if (dirty) await put(`/api/applications/${id}`, { ...form, toEmail: form?.toEmail ?? '' });
      return post(`/api/applications/${id}/approve`, { acknowledgeIssues });
    },
    onSuccess: () => {
      setDirty(false);
      refresh();
      toast.success('Approved and moved to Dispatch.');
      go('dispatch');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'FACT_LOCK') setConfirmIssues(true);
      else toast.error(e);
    },
  });

  const remove = useMutation({
    mutationFn: () => del(`/api/applications/${id}`),
    onSuccess: () => {
      refresh();
      go('studio');
    },
    onError: toast.error,
  });

  if (!app || !form) return <div className="card skeleton" style={{ height: 520 }} />;
  const set = <K extends keyof NonNullable<typeof form>>(k: K, v: NonNullable<typeof form>[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };
  const high = app.issues.filter((i) => i.severity === 'high');

  return (
    <section className="card">
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2>{app.job?.title}</h2>
          <div className="meta">
            <span>{app.job?.company}</span>
            <a href={app.job?.url} target="_blank" rel="noopener noreferrer">
              Open posting
            </a>
            <a href={`#/jobs?id=${app.jobId}`}>See the score</a>
          </div>
        </div>
        <div className="row">
          <Btn variant="ghost" size="sm" onClick={() => setRegen(true)}>
            <RefreshCw size={14} /> Rewrite with notes
          </Btn>
          <Btn variant="ghost" size="sm" className="danger" onClick={() => confirm('Discard this draft?') && remove.mutate()}>
            <Trash2 size={14} />
          </Btn>
          {dirty ? (
            <Btn size="sm" busy={save.isPending} onClick={() => save.mutate()}>
              Save
            </Btn>
          ) : null}
          <Btn variant="primary" size="sm" busy={approve.isPending} onClick={() => approve.mutate(false)} disabled={app.status === 'approved' && !dirty}>
            <Stamp size={14} /> {app.status === 'approved' && !dirty ? 'Approved' : 'Approve'}
          </Btn>
        </div>
      </div>

      {regen ? <RegenPanel jobId={app.jobId} onClose={() => setRegen(false)} onDone={() => { setDirty(false); refresh(); setPdfKey((k) => k + 1); }} /> : null}
      {regen ? <RegenPanel jobId={app.jobId} onClose={() => setRegen(false)} onDone={() => { setDirty(false); refresh(); setPdfKey((k) => k + 1); }} /> : null}
      <div className="card-pad" style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist">
            {(
              [
                ['letter', 'Cover letter', ScrollText],
                ['message', 'Outreach', MessageSquare],
                ['cv', 'Tailored CV', FileText],
                ['lock', `Fact check${app.issues.length ? ` (${app.issues.length})` : ''}`, Lock],
              ] as const
            ).map(([key, label, Icon]) => (
              <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          {high.length ? (
            <span className="tag crimson">
              <span className="dot" /> {high.length} unsupported claim{high.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="tag olive">
              <ShieldCheck size={12} /> facts verified
            </span>
          )}
        </div>

        {tab === 'letter' ? (
          <>
            <Field label="Email subject">
              <input className="input" value={form.subject} onChange={(e) => set('subject', e.target.value)} />
            </Field>
            <textarea className="textarea letter" value={form.coverLetter} onChange={(e) => set('coverLetter', e.target.value)} aria-label="Cover letter" />
            <div className="row muted" style={{ fontSize: '0.75rem' }}>
              <span>{form.coverLetter.split(/\s+/).filter(Boolean).length} words</span>
              <span className="spacer" />
              <CopyBtn text={form.coverLetter} />
            </div>
          </>
        ) : null}

        {tab === 'message' ? (
          <>
            <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              For a LinkedIn DM, a reply on X, Reddit or HN, or a short note to the hiring manager.
            </p>
            <textarea className="textarea letter" style={{ minHeight: 220 }} value={form.message} onChange={(e) => set('message', e.target.value)} aria-label="Outreach message" />
            <div className="row muted" style={{ fontSize: '0.75rem' }}>
              <span className={form.message.length > 700 ? '' : ''}>{form.message.length} characters</span>
              <span className="spacer" />
              <CopyBtn text={form.message} />
            </div>
          </>
        ) : null}

        {tab === 'cv' ? <CvTab cv={form.cv} onChange={(cv) => set('cv', cv)} pdfUrl={`/api/applications/${id}/cv.pdf?v=${pdfKey}`} dirty={dirty} /> : null}

        {tab === 'lock' ? (
          <div className="stack">
            <div className="callout olive">
              <ShieldCheck />
              <div>
                Two checks run on every draft. First, a deterministic scan confirms every number and employer appears in your source CV. Second, an independent Claude auditor with fresh context lists any claim the source doesn't support.
              </div>
            </div>
            {app.issues.length === 0 ? <p className="muted">No issues found. Every claim traces back to your CV.</p> : null}
            {app.issues.map((i, n) => (
              <div key={n} className={`issue ${i.severity}`}>
                <span className={`tag ${i.severity === 'high' ? 'crimson' : i.severity === 'medium' ? 'brass' : ''}`}>{i.severity}</span>
                <div>
                  <strong>{i.claim}</strong>
                  <div className="muted" style={{ fontSize: '0.8125rem' }}>
                    {i.reason} <span className="faint">Found by {i.origin === 'code' ? 'the code check' : 'the auditor'}.</span>
                  </div>
                </div>
              </div>
            ))}
            {app.emphasis.length ? (
              <>
                <div className="label" style={{ marginTop: 'var(--s-3)' }}>
                  What Claude chose to emphasise
                </div>
                <ul className="list-dash good">
                  {app.emphasis.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="form-grid">
          <Field label="How will this be sent?">
            <select className="select" value={form.channel} onChange={(e) => set('channel', e.target.value as Application['channel'])}>
              <option value="email">Email from Bureau</option>
              <option value="ats">Company application form</option>
              <option value="dm">Direct message</option>
              <option value="manual">Other / manual</option>
            </select>
          </Field>
          <Field label="Recipient email" help={form.channel === 'email' ? 'Required to send by email.' : 'Optional.'}>
            <input className="input" type="email" value={form.toEmail ?? ''} onChange={(e) => set('toEmail', e.target.value)} placeholder="hiring@company.com" />
          </Field>
        </div>
      </div>


      {confirmIssues ? (
        <Modal
          title="Unsupported claims"
          onClose={() => setConfirmIssues(false)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => { setConfirmIssues(false); setTab('lock'); }}>
                Review them
              </Btn>
              <Btn variant="primary" onClick={() => { setConfirmIssues(false); approve.mutate(true); }}>
                I've checked, approve
              </Btn>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            The fact lock found {high.length} claim{high.length === 1 ? '' : 's'} your CV doesn't support. Sending invented details can cost you an offer later. Approve only if you've confirmed they're true.
          </p>
        </Modal>
      ) : null}
    </section>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Btn
      variant="ghost"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'Copied' : 'Copy'}
    </Btn>
  );
}

function CvTab({ cv, onChange, pdfUrl, dirty }: { cv: TailoredCv; onChange: (cv: TailoredCv) => void; pdfUrl: string; dirty: boolean }) {
  const [view, setView] = useState<'preview' | 'edit'>('preview');
  return (
    <div className="stack">
      <div className="row">
        <div className="tabs">
          <button aria-selected={view === 'preview'} onClick={() => setView('preview')}>
            PDF preview
          </button>
          <button aria-selected={view === 'edit'} onClick={() => setView('edit')}>
            Edit content
          </button>
        </div>
        <span className="spacer" />
        <a className="btn sm" href={`${pdfUrl}&download=1`}>
          <Download size={14} /> Download PDF
        </a>
      </div>
      {view === 'preview' ? (
        <>
          {dirty ? <div className="callout">Save your edits to refresh the preview.</div> : null}
          <iframe className="pdf-frame" src={pdfUrl} title="Tailored CV preview" />
        </>
      ) : (
        <div className="stack">
          <Field label="Headline">
            <input className="input" value={cv.headline} onChange={(e) => onChange({ ...cv, headline: e.target.value })} />
          </Field>
          <Field label="Summary">
            <textarea className="textarea" rows={4} value={cv.summary} onChange={(e) => onChange({ ...cv, summary: e.target.value })} />
          </Field>
          <Field label="Skills" help="One group per line: Group: item, item, item">
            <textarea
              className="textarea mono"
              rows={5}
              value={cv.skills.map((s) => `${s.group}: ${s.items.join(', ')}`).join('\n')}
              onChange={(e) =>
                onChange({
                  ...cv,
                  skills: e.target.value
                    .split('\n')
                    .filter((l) => l.trim())
                    .map((l) => {
                      const [g, ...rest] = l.split(':');
                      return { group: g.trim(), items: rest.join(':').split(',').map((s) => s.trim()).filter(Boolean) };
                    }),
                })
              }
            />
          </Field>
          {cv.experience.map((e, i) => (
            <Field key={i} label={`${e.role} at ${e.company}`} help="One bullet per line">
              <textarea
                className="textarea"
                rows={Math.max(3, e.bullets.length + 1)}
                value={e.bullets.join('\n')}
                onChange={(ev) => {
                  const experience = [...cv.experience];
                  experience[i] = { ...e, bullets: ev.target.value.split('\n').filter((b) => b.trim()) };
                  onChange({ ...cv, experience });
                }}
              />
            </Field>
          ))}
        </div>
      )}
    </div>
  );
}

function RegenPanel({ jobId, onClose, onDone }: { jobId: string; onClose: () => void; onDone: () => void }) {
  const [instructions, setInstructions] = useState('');
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => post(`/api/jobs/${jobId}/draft`, { instructions }),
    onSuccess: () => {
      toast.success('Rewritten.');
      onDone();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <form
      className="card-pad"
      style={{ display: 'grid', gap: 'var(--s-3)', background: 'var(--bg)', margin: '0 var(--s-5)', borderRadius: 'var(--r-control)' }}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Field label="What should change?" help="This replaces the current draft, including your edits.">
        <textarea className="textarea" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Shorter. Lead with the Kubernetes migration. Warmer close." autoFocus />
      </Field>
      <div className="row">
        <Btn variant="primary" type="submit" busy={m.isPending}>
          {m.isPending ? 'Rewriting…' : 'Rewrite the draft'}
        </Btn>
        <Btn variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Btn>
      </div>
    </form>
  );
}

type StudioTab = 'drafts' | 'written' | 'strategy' | 'voice';

export default function Studio() {
  const [, params] = useRoute();
  const tab = (params.get('tab') as StudioTab) || (params.get('app') ? 'written' : 'drafts');
  return (
    <>
      <PageHead title="Studio" lede="Every application is written for one role from your own words and facts, checked by a recruiter critic, a style lint and the truth lock. Read anything, edit any draft before it goes out." />
      <div style={{ marginBottom: 'var(--s-4)', overflowX: 'auto' }}>
        <Tabs<StudioTab>
          label="Studio sections"
          value={tab}
          onChange={(t) => {
            setParam('app', null);
            setParam('tab', t === 'drafts' ? null : t);
          }}
          items={[
            { id: 'drafts', label: 'Drafts to review' },
            { id: 'written', label: 'Written by the campaigns' },
            { id: 'strategy', label: 'What works' },
            { id: 'voice', label: 'Voice bank' },
          ]}
        />
      </div>
      {tab === 'drafts' ? <Drafts /> : null}
      {tab === 'written' ? <WrittenPanel /> : null}
      {tab === 'strategy' ? <BanditPanel /> : null}
      {tab === 'voice' ? (
        <section className="card card-pad" style={{ maxWidth: 860 }}>
          <VoiceBankEditor />
        </section>
      ) : null}
    </>
  );
}
