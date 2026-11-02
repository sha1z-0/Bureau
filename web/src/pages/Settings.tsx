import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, Lock, Mail, Power, ShieldCheck, Trash2 } from 'lucide-react';
import { api, post, put } from '../api';
import { Btn, Field, Modal, Switch, useToast } from '../ui';
import { HuntSettingsCard } from './Hunt';

interface SettingsData {
  apiKey: { set: boolean; hint: string | null; updatedAt: string | null; fromEnv: boolean };
  ai: { models: Record<string, string>; monthlyBudgetUsd: number };
  models: { id: string; label: string; input: number; output: number }[];
  defaultModels: Record<string, string>;
  tasks: string[];
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; bccSelf: boolean } | null;
  smtpPassword: { set: boolean };
  security: { passphrase: boolean };
  autostart: { supported: boolean; enabled: boolean };
  spend: number;
}

const TASK_LABEL: Record<string, [string, string]> = {
  profile: ['Reading your CV', 'Runs rarely; accuracy matters.'],
  score: ['Assessing jobs', 'Runs the most, so it defaults to Haiku 5.5.'],
  tailor: ['Writing applications', 'Your words in front of a hiring manager.'],
  audit: ['Fact-lock auditor', 'Independent check of every draft.'],
  scan: ['Deep web scan', 'Searches the web on your behalf.'],
  capture: ['Capturing posts', 'Simple extraction.'],
  apply: ['Filling application forms', 'Answers each form from your profile.'],
};

export default function SettingsPage() {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/api/settings') });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<{ month: number; byTask: { task: string; model: string; calls: number; cost: number; searches: number }[] }>('/api/usage') });
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Keys, models, the hunt and its safeguards. Every secret here is encrypted on this computer and never sent back to the browser.</p>
        </div>
      </header>
      <div className="split">
        <div className="grid">
          <ApiKeyCard data={data} />
          <ModelsCard data={data} usage={usage.data} />
          <HuntSettingsCard />
        </div>
        <div className="grid">
          <AutostartCard data={data} />
          <SmtpCard data={data} />
          <SecurityCard data={data} />
          <DataCard />
        </div>
      </div>
    </>
  );
}

function useSaved() {
  const qc = useQueryClient();
  const toast = useToast();
  return { done: (msg: string) => (toast.success(msg), qc.invalidateQueries({ queryKey: ['settings'] }), qc.invalidateQueries({ queryKey: ['overview'] })), toast };
}

function ApiKeyCard({ data }: { data: SettingsData }) {
  const [key, setKey] = useState('');
  const { done, toast } = useSaved();
  const save = useMutation({
    mutationFn: (k: string) => put<{ message: string }>('/api/settings/api-key', { key: k }),
    onSuccess: (r) => {
      setKey('');
      done(r.message);
    },
    onError: toast.error,
  });
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
        <KeyRound size={18} color="var(--accent)" />
        <h2 className="section-title">Claude API key</h2>
        <span className="spacer" />
        {data.apiKey.set ? <span className="tag olive">Connected, ends {data.apiKey.hint?.replace('…', '')}</span> : data.apiKey.fromEnv ? <span className="tag brass">From environment</span> : <span className="tag crimson">Not set</span>}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        Get one at console.anthropic.com. Bureau checks it with Anthropic, encrypts it with AES-256-GCM (the master key is sealed with Windows DPAPI), and uses it only from the local server. The browser never sees it again.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(key);
        }}
      >
        <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder={data.apiKey.set ? 'Replace key…' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Anthropic API key" />
        <Btn variant="primary" type="submit" busy={save.isPending} disabled={!key}>
          Verify & save
        </Btn>
        {data.apiKey.set ? (
          <Btn variant="ghost" type="button" onClick={() => confirm('Remove the stored API key?') && save.mutate('')}>
            Remove
          </Btn>
        ) : null}
      </form>
    </section>
  );
}

function ModelsCard({ data, usage }: { data: SettingsData; usage?: { month: number; byTask: { task: string; model: string; calls: number; cost: number; searches: number }[] } }) {
  const [models, setModels] = useState<Record<string, string>>(data.ai.models);
  const [budget, setBudget] = useState(data.ai.monthlyBudgetUsd);
  const { done, toast } = useSaved();
  const save = useMutation({ mutationFn: () => put('/api/settings/ai', { models: Object.fromEntries(data.tasks.map((t) => [t, models[t] ?? data.defaultModels[t]])), monthlyBudgetUsd: budget }), onSuccess: () => done('Engines saved.'), onError: toast.error });
  return (
    <section className="card">
      <div className="card-head">
        <h2>Models</h2>
        <Btn size="sm" busy={save.isPending} onClick={() => save.mutate()}>
          Save
        </Btn>
      </div>
      <table className="table">
        <tbody>
          {data.tasks.map((t) => (
            <tr key={t}>
              <td>
                <div style={{ fontWeight: 500 }}>{TASK_LABEL[t]?.[0] ?? t}</div>
                <div className="faint" style={{ fontSize: '0.75rem' }}>
                  {TASK_LABEL[t]?.[1]}
                </div>
              </td>
              <td style={{ width: 250 }}>
                <select className="select" value={models[t] ?? data.defaultModels[t]} onChange={(e) => setModels({ ...models, [t]: e.target.value })} aria-label={`Model for ${t}`}>
                  {data.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} (${m.input} in, ${m.output} out per M)
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card-pad" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="form-grid">
          <Field label="Monthly budget (USD)" help="Bureau stops calling Claude when it's reached. 0 means no cap.">
            <input className="input" type="number" min={0} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
          </Field>
          <div className="field">
            <label>This month</label>
            <div style={{ fontSize: 'var(--t-xl)', fontWeight: 600 }}>
              ${(usage?.month ?? data.spend).toFixed(2)}
            </div>
            <div className="help">Prices per million tokens shown beside each model. Estimates include prompt caching.</div>
          </div>
        </div>
        {usage?.byTask.length ? (
          <table className="table" style={{ marginTop: 'var(--s-4)' }}>
            <thead>
              <tr>
                <th>Task</th>
                <th>Calls</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.byTask.map((u) => (
                <tr key={u.task + u.model}>
                  <td>
                    {TASK_LABEL[u.task]?.[0] ?? u.task} <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>{u.model}</span>
                  </td>
                  <td>{u.calls}</td>
                  <td style={{ textAlign: 'right' }}>
                    ${u.cost.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

function AutostartCard({ data }: { data: SettingsData }) {
  const { done, toast } = useSaved();
  const m = useMutation({
    mutationFn: (enabled: boolean) => put<{ enabled: boolean }>('/api/settings/autostart', { enabled }),
    onSuccess: (r) => done(r.enabled ? 'Bureau will start silently when you sign in to Windows.' : 'Bureau will no longer start with Windows.'),
    onError: toast.error,
  });
  if (!data.autostart.supported) return null;
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-2)' }}>
        <Power size={18} color="var(--accent)" />
        <h2 className="section-title">Start with Windows</h2>
        <span className="spacer" />
        <Switch label="Start with Windows" checked={data.autostart.enabled} onChange={(v) => m.mutate(v)} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
        The hunt only runs while Bureau is running. With this on, Bureau starts quietly in the background when you sign in, with no window, and keeps hunting. Open it any time at <code>http://127.0.0.1:4317</code>. Its log is in <code>data/bureau.log</code>.
      </p>
    </section>
  );
}

function SmtpCard({ data }: { data: SettingsData }) {
  const [s, setS] = useState(data.smtp ?? { host: 'smtp.gmail.com', port: 465, secure: true, user: '', from: '', bccSelf: true });
  const [pass, setPass] = useState('');
  const { done, toast } = useSaved();
  const save = useMutation({ mutationFn: () => put('/api/settings/smtp', { ...s, password: pass || undefined }), onSuccess: () => (setPass(''), done('Email settings saved.')), onError: toast.error });
  const test = useMutation({ mutationFn: () => post<{ message: string }>('/api/settings/smtp/test'), onSuccess: (r) => toast.success(r.message), onError: toast.error });
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
        <Mail size={18} color="var(--accent)" />
        <h2 className="section-title">Email</h2>
        <span className="spacer" />
        {data.smtpPassword.set ? <span className="tag olive">connected</span> : <span className="tag">optional</span>}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        Send applications from your own mailbox over SMTP. For Gmail, turn on 2-step verification and use an <em>app password</em>, never your real password.
      </p>
      <div className="form-grid">
        <Field label="SMTP host">
          <input className="input" value={s.host} onChange={(e) => setS({ ...s, host: e.target.value })} />
        </Field>
        <Field label="Port">
          <input className="input" type="number" value={s.port} onChange={(e) => setS({ ...s, port: Number(e.target.value), secure: Number(e.target.value) === 465 })} />
        </Field>
        <Field label="Username">
          <input className="input" value={s.user} autoComplete="off" onChange={(e) => setS({ ...s, user: e.target.value })} />
        </Field>
        <Field label={data.smtpPassword.set ? 'App password (stored)' : 'App password'}>
          <input className="input" type="password" autoComplete="new-password" value={pass} placeholder={data.smtpPassword.set ? '••••••••' : ''} onChange={(e) => setPass(e.target.value)} />
        </Field>
        <Field label="From" full help='e.g. "Your Name <you@gmail.com>"'>
          <input className="input" value={s.from} onChange={(e) => setS({ ...s, from: e.target.value })} />
        </Field>
      </div>
      <div className="toggle-row">
        <span>BCC myself on every application</span>
        <Switch label="BCC myself" checked={s.bccSelf} onChange={(v) => setS({ ...s, bccSelf: v })} />
      </div>
      <div className="row" style={{ marginTop: 'var(--s-3)' }}>
        <Btn variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
          Save
        </Btn>
        <Btn busy={test.isPending} disabled={!data.smtpPassword.set} onClick={() => test.mutate()}>
          Test connection
        </Btn>
      </div>
    </section>
  );
}

function SecurityCard({ data }: { data: SettingsData }) {
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [current, setCurrent] = useState('');
  const { done, toast } = useSaved();
  const save = useMutation({
    mutationFn: (p: string) => put('/api/settings/passphrase', { passphrase: p, current }),
    onSuccess: (_r, p) => {
      setPass('');
      setConfirmPass('');
      setCurrent('');
      done(p ? 'Bureau is now sealed with a passphrase.' : 'Passphrase removed.');
      if (p) setTimeout(() => window.location.reload(), 800);
    },
    onError: toast.error,
  });
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
        <Lock size={18} color="var(--accent)" />
        <h2 className="section-title">Security</h2>
        <span className="spacer" />
        {data.security.passphrase ? <span className="tag olive">sealed</span> : <span className="tag">local only</span>}
      </div>
      <ul className="list-dash good" style={{ marginBottom: 'var(--s-4)' }}>
        <li>Listens on 127.0.0.1 only, with Host and Origin allow-lists against DNS rebinding.</li>
        <li>HttpOnly SameSite=Strict session plus a CSRF token on every change.</li>
        <li>Strict Content-Security-Policy; job HTML is sanitised twice.</li>
        <li>Outbound fetches can't reach private networks (SSRF guard).</li>
        <li>Secrets encrypted at rest and redacted from logs.</li>
      </ul>
      <p className="muted" style={{ fontSize: '0.875rem', marginTop: 0 }}>
        A passphrase seals Bureau behind a login. It's required before Bureau will run anywhere other than this computer.
      </p>
      <div className="form-grid">
        {data.security.passphrase ? (
          <Field label="Current passphrase" full>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
        ) : null}
        <Field label="New passphrase" help="At least 10 characters.">
          <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </Field>
        <Field label="Confirm">
          <input className="input" type="password" autoComplete="new-password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 'var(--s-3)' }}>
        <Btn variant="primary" busy={save.isPending} disabled={pass.length < 10 || pass !== confirmPass} onClick={() => save.mutate(pass)}>
          <ShieldCheck /> {data.security.passphrase ? 'Change passphrase' : 'Seal Bureau'}
        </Btn>
        {data.security.passphrase ? (
          <Btn variant="ghost" onClick={() => confirm('Remove the passphrase?') && save.mutate('')}>
            Remove
          </Btn>
        ) : null}
      </div>
    </section>
  );
}

function DataCard() {
  const [wipe, setWipe] = useState<null | 'jobs' | 'everything'>(null);
  const [typed, setTyped] = useState('');
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => post('/api/wipe', { confirm: typed, scope: wipe }),
    onSuccess: () => {
      toast.success('Erased.');
      setTimeout(() => window.location.reload(), 600);
    },
    onError: toast.error,
  });
  useEffect(() => setTyped(''), [wipe]);
  return (
    <section className="card card-pad">
      <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
        Your data
      </h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        Everything lives in <code>data/bureau.db</code> on this computer. Export it any time; secrets are never included.
      </p>
      <div className="row wrap">
        <a className="btn" href="/api/export">
          <Download /> Export JSON
        </a>
        <Btn variant="ghost" className="danger" onClick={() => setWipe('jobs')}>
          <Trash2 /> Clear jobs
        </Btn>
        <Btn variant="ghost" className="danger" onClick={() => setWipe('everything')}>
          <Trash2 /> Erase everything
        </Btn>
      </div>
      {wipe ? (
        <Modal
          title={wipe === 'jobs' ? 'Clear all jobs?' : 'Erase everything?'}
          onClose={() => setWipe(null)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setWipe(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" disabled={typed !== 'ERASE'} busy={m.isPending} onClick={() => m.mutate()}>
                Erase
              </Btn>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {wipe === 'jobs' ? 'Removes every job, draft, application and scan. Your profile, keys and settings stay.' : 'Removes everything, including your profile, uploaded CVs, keys and settings. This cannot be undone.'}
          </p>
          <Field label="Type ERASE to confirm">
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </section>
  );
}
