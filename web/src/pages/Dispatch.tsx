import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, CircleAlert, Copy, Download, ExternalLink, Image, Mail, MessageSquare, MousePointerClick, Send, Undo2, X } from 'lucide-react';
import { api, del, post, put, type Application } from '../api';
import { Btn, Empty, Modal, Seal, ago, useToast } from '../ui';

export default function Dispatch() {
  const { data } = useQuery({ queryKey: ['applications', 'all'], queryFn: () => api<{ applications: Application[] }>('/api/applications'), refetchInterval: 20_000 });
  const apps = data?.applications ?? [];
  const needsYou = apps.filter((a) => a.status === 'needs_you' || a.status === 'failed');
  const approved = apps.filter((a) => a.status === 'approved');
  const rehearsed = apps.filter((a) => a.status === 'rehearsed');
  const sent = apps.filter((a) => a.status === 'sent');
  const [sending, setSending] = useState<Application | null>(null);
  const [shot, setShot] = useState<Application | null>(null);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dispatch</h1>
          <p>Every application that went out, and the few handed back to you. Those wait in “Needs you” with the form already filled; finish them in one click.</p>
        </div>
      </header>

      <section className="card" style={{ marginBottom: 'var(--s-5)', borderColor: needsYou.length ? 'color-mix(in oklab, var(--accent) 35%, transparent)' : undefined }}>
        <div className="card-head">
          <h2>Needs you</h2>
          <span className="muted">{needsYou.length}</span>
        </div>
        {needsYou.length === 0 ? (
          <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
            Nothing is waiting on you.
          </p>
        ) : (
          needsYou.map((a) => <NeedsYouRow key={a.id} app={a} onShot={() => setShot(a)} />)
        )}
      </section>

      {approved.length ? (
        <section className="card" style={{ marginBottom: 'var(--s-5)' }}>
          <div className="card-head">
            <h2>Approved by you</h2>
            <span className="muted">{approved.length}</span>
          </div>
          {approved.map((a) => (
            <ManualRow key={a.id} app={a} onSend={() => setSending(a)} />
          ))}
        </section>
      ) : null}

      {rehearsed.length ? (
        <section className="card" style={{ marginBottom: 'var(--s-5)' }}>
          <div className="card-head">
            <h2>Rehearsals</h2>
            <span className="muted" style={{ fontSize: '0.8125rem' }}>
              Filled in and checked but not sent. A campaign goes live by itself when its rehearsal days are over.
            </span>
          </div>
          <table className="table">
            <tbody>
              {rehearsed.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.job?.title}</strong>
                    <div className="muted" style={{ fontSize: '0.8125rem' }}>
                      {a.job?.company}. {a.reason}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.hasShot ? (
                      <Btn size="sm" onClick={() => setShot(a)}>
                        <Image size={14} /> See the form
                      </Btn>
                    ) : null}{' '}
                    <a className="btn sm" href={`#/studio?id=${a.id}`}>
                      Materials
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2>Applied</h2>
          <span className="muted">{sent.length}</span>
        </div>
        {sent.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>How</th>
                <th>By</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sent.map((a) => (
                <tr key={a.id}>
                  <td>
                    <a href={`#/jobs?id=${a.jobId}`} style={{ color: 'inherit', fontWeight: 500 }}>
                      {a.job?.title}
                    </a>
                    <div className="muted" style={{ fontSize: '0.8125rem' }}>
                      {a.job?.company}
                    </div>
                  </td>
                  <td>
                    <span className="muted">{a.channel === 'ats' ? 'Company form' : a.channel === 'email' ? `Email to ${a.toEmail}` : 'Direct message'}</span>
                  </td>
                  <td>{a.auto ? <span className="row muted" style={{ gap: 6 }}><Bot size={14} /> A campaign</span> : <span className="muted">You</span>}</td>
                  <td className="muted">{ago(a.sentAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {a.hasShot ? (
                      <Btn size="sm" variant="ghost" onClick={() => setShot(a)} aria-label="See confirmation">
                        <Image size={14} />
                      </Btn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="Nothing sent yet">Start a campaign and applications appear here as they go out.</Empty>
        )}
      </section>

      {sending ? <SendModal app={sending} onClose={() => setSending(null)} /> : null}
      {shot ? (
        <Modal title={`What Bureau filled in for ${shot.job?.company}`} onClose={() => setShot(null)}>
          <img className="shot-thumb" style={{ maxHeight: 'none' }} src={`/api/applications/${shot.id}/shot.png?v=${encodeURIComponent(shot.updatedAt)}`} alt="Screenshot of the filled application form" />
          {shot.answers.length ? (
            <table className="table">
              <tbody>
                {shot.answers.map((x, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ width: '45%' }}>
                      {x.label}
                    </td>
                    <td>{x.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['applications'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    qc.invalidateQueries({ queryKey: ['jobs'] });
    qc.invalidateQueries({ queryKey: ['hunt'] });
  };
}

function NeedsYouRow({ app, onShot }: { app: Application; onShot: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const finish = useMutation({
    mutationFn: () => post<{ reason: string }>(`/api/applications/${app.id}/finish`),
    onSuccess: () => toast.success('A browser window is open with the form filled in. Submit it there, then press “I’ve applied”.'),
    onError: toast.error,
  });
  const mark = useMutation({ mutationFn: () => post(`/api/applications/${app.id}/mark-applied`), onSuccess: () => (toast.success('Marked as applied.'), refresh()), onError: toast.error });
  const drop = useMutation({ mutationFn: () => del(`/api/applications/${app.id}`), onSuccess: refresh, onError: toast.error });
  const isForm = app.channel === 'ats';
  return (
    <div className="dispatch-row" style={{ display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--line)', alignItems: 'start' }}>
      <Seal grade={app.job?.grade ?? null} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{app.job?.title}</div>
        <div className="meta">
          <span>{app.job?.company}</span>
          <span>{ago(app.updatedAt)}</span>
        </div>
        <p className="note bad" style={{ marginTop: 8 }}>
          <CircleAlert /> {app.reason ?? app.error ?? 'Needs a person to finish it.'}
        </p>
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          <CopyChip label="Cover letter" text={app.coverLetter} />
          <CopyChip label="Message" text={app.message} />
          <a className="btn sm" href={`/api/applications/${app.id}/cv.pdf?download=1`}>
            <Download size={14} /> CV PDF
          </a>
          <a className="btn sm ghost" href={`#/studio?id=${app.id}`}>
            Edit materials
          </a>
          {app.hasShot ? (
            <Btn size="sm" variant="ghost" onClick={onShot}>
              <Image size={14} /> What it filled
            </Btn>
          ) : null}
        </div>
      </div>
      <div className="stack" style={{ gap: 8, alignItems: 'stretch' }}>
        {isForm ? (
          <Btn variant="primary" busy={finish.isPending} onClick={() => finish.mutate()}>
            <MousePointerClick /> Finish in browser
          </Btn>
        ) : (
          <a className="btn primary" href={app.job?.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> Open posting
          </a>
        )}
        <Btn busy={mark.isPending} onClick={() => mark.mutate()}>
          <Check /> I've applied
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => confirm('Skip this role?') && drop.mutate()}>
          <X size={14} /> Skip
        </Btn>
      </div>
    </div>
  );
}

function ManualRow({ app, onSend }: { app: Application; onSend: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const mark = useMutation({ mutationFn: () => post(`/api/applications/${app.id}/mark-applied`), onSuccess: () => (toast.success('Marked as applied.'), refresh()), onError: toast.error });
  const unapprove = useMutation({ mutationFn: () => put(`/api/applications/${app.id}`, {}), onSuccess: refresh, onError: toast.error });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) auto', gap: 'var(--s-4)', padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
      <Seal grade={app.job?.grade ?? null} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{app.job?.title}</div>
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
          <span className="tag brass">
            {app.channel === 'email' ? <Mail size={12} /> : app.channel === 'dm' ? <MessageSquare size={12} /> : <ExternalLink size={12} />}
            {app.channel === 'email' ? `Email to ${app.toEmail ?? 'no address yet'}` : app.channel === 'dm' ? 'Direct message' : 'Application form'}
          </span>
          {app.error ? <span className="tag crimson">Last attempt failed: {app.error}</span> : null}
        </div>
      </div>
      <div className="row">
        <Btn variant="ghost" size="sm" onClick={() => unapprove.mutate()} title="Back to drafts">
          <Undo2 size={14} />
        </Btn>
        {app.channel === 'email' ? (
          <Btn variant="primary" onClick={onSend} disabled={!app.toEmail}>
            <Send /> Send
          </Btn>
        ) : (
          <>
            <a className="btn" href={app.job?.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open form
            </a>
            <Btn variant="primary" busy={mark.isPending} onClick={() => mark.mutate()}>
              <Check /> I've applied
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

function CopyChip({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Btn
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {label}
    </Btn>
  );
}

function SendModal({ app, onClose }: { app: Application; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const send = useMutation({
    mutationFn: () => post(`/api/applications/${app.id}/send`),
    onSuccess: () => {
      toast.success(`Sent to ${app.toEmail}.`);
      refresh();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      title="Send this application?"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Not yet
          </Btn>
          <Btn variant="primary" busy={send.isPending} onClick={() => send.mutate()}>
            <Send /> Send now
          </Btn>
        </>
      }
    >
      <table className="table">
        <tbody>
          <tr>
            <td className="muted" style={{ width: 90 }}>
              To
            </td>
            <td>
              <strong>{app.toEmail}</strong>
            </td>
          </tr>
          <tr>
            <td className="muted">Subject</td>
            <td>{app.subject}</td>
          </tr>
          <tr>
            <td className="muted">Attached</td>
            <td>Tailored CV (PDF)</td>
          </tr>
        </tbody>
      </table>
      <div className="prose" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-display)', fontSize: '1.0625rem', background: 'var(--raised)', padding: 'var(--s-4)', borderRadius: 'var(--radius-m)', border: '1px solid var(--line)', maxHeight: 280, overflow: 'auto' }}>
        {app.coverLetter}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.8125rem' }}>
        This goes out from your connected mailbox and can't be recalled.
      </p>
    </Modal>
  );
}
