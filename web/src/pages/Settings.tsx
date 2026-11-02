import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Cpu, Download, Inbox as InboxIcon, KeyRound, Lock, Mail, Power, Radar, ShieldCheck, Timer, Trash2 } from 'lucide-react';
import { api, del, optional, post, put, type AutopilotSettings, type ImapSettings, type NotifyState, type ScoutHealth } from '../api';
import { Btn, Field, Modal, Switch, ago, useToast } from '../ui';
import { PageHead } from '../kit';

export interface SettingsData {
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
  score: ['Assessing jobs (v1)', 'The older scoring path, used by manual scoring.'],
  tailor: ['Writing applications (v1)', 'Manual drafts from the Jobs page.'],
  audit: ['Fact-lock auditor', 'Independent check of every draft.'],
  scan: ['Deep web scan', 'Searches the web on your behalf.'],
  capture: ['Capturing posts', 'Simple extraction.'],
  apply: ['Filling forms (v1)', 'The older form filler.'],
  profile_sync: ['Profile sync', 'Reads new CVs, GitHub and your portfolio each morning.'],
  research: ['Company research', 'A short brief on each employer, with sources.'],
  match: ['Matching jobs', 'Runs the most, so it defaults to Haiku 5.5.'],
  evidence: ['Evidence map', 'Pairs each requirement with your best true evidence.'],
  write_cv: ['Tailored CV', 'Your CV in their vocabulary, nothing added.'],
  write_letter: ['Letters', 'Three variants built from your voice bank.'],
  critic: ['Recruiter critic', 'Picks the strongest letter, or holds it back.'],
  humanize: ['Humanizer', 'Removes the tells of machine writing.'],
  form_map: ['Mapping form fields', 'Matches each field to a stored answer.'],
  agent_step: ['Browser agent', 'One step at a time on forms with no recipe.'],
  recipe_compile: ['Learning recipes', 'Turns a finished form into a reusable recipe.'],
  inbox_classify: ['Sorting replies', 'Rejection, interview, assessment and the rest.'],
  learning_plan: ['Crash learning plans', 'Built when an interview arrives.'],
  gap_report: ['Weekly gap report', 'The skills most often missing.'],
  answer_q: ['Short answers', 'Written answers to form questions.'],
};

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/api/settings') });
}

export default function SettingsPage() {
  const { data } = useSettings();
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<{ month: number; byTask: { task: string; model: string; calls: number; cost: number; searches: number }[] }>('/api/usage') });
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  return (
    <>
      <PageHead title="Settings" lede="Keys, models, the autopilot, notifications and the mailbox. Every secret here is encrypted on this computer and never sent back to the browser." />
      <div className="split">
        <div className="grid">
          <ApiKeyCard />
          <ModelsCard data={data} usage={usage.data} />
          <AutopilotCard />
          <NotificationsCard />
        </div>
        <div className="grid">
          <AutostartCard data={data} />
          <SmtpCard />
          <ImapCard />
          <SidecarCard />
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
  return {
    done: (msg: string) => {
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
    toast,
  };
}

/** A settings card, or just its contents when it sits inside the setup wizard. */
function Panel({ bare, icon, title, badge, children }: { bare?: boolean; icon: ReactNode; title: string; badge?: ReactNode; children: ReactNode }) {
  if (bare)
    return (
      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        {badge ? <div className="row">{badge}</div> : null}
        {children}
      </div>
    );
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
        {icon}
        <h2 className="section-title">{title}</h2>
        <span className="spacer" />
        {badge}
      </div>
      {children}
    </section>
  );
}

export function ApiKeyCard({ bare }: { bare?: boolean }) {
  const { data } = useSettings();
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
  if (!data) return <div className="skeleton" style={{ height: 160 }} />;
  return (
    <Panel
      bare={bare}
      icon={<KeyRound size={18} color="var(--accent)" />}
      title="Claude API key"
      badge={data.apiKey.set ? <span className="tag olive">Connected, ends {data.apiKey.hint?.replace('…', '')}</span> : data.apiKey.fromEnv ? <span className="tag brass">From environment</span> : <span className="tag crimson">Not set</span>}
    >
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
        <Btn type="submit" busy={save.isPending} disabled={!key}>
          Check and save
        </Btn>
        {data.apiKey.set ? (
          <Btn variant="ghost" type="button" onClick={() => confirm('Remove the stored API key?') && save.mutate('')}>
            Remove
          </Btn>
        ) : null}
      </form>
    </Panel>
  );
}

function ModelsCard({ data, usage }: { data: SettingsData; usage?: { month: number; byTask: { task: string; model: string; calls: number; cost: number; searches: number }[] } }) {
  const [models, setModels] = useState<Record<string, string>>(data.ai.models);
  const [budget, setBudget] = useState(data.ai.monthlyBudgetUsd);
  const [showAll, setShowAll] = useState(false);
  const { done, toast } = useSaved();
  const save = useMutation({
    mutationFn: () => put('/api/settings/ai', { models: Object.fromEntries(data.tasks.map((t) => [t, models[t] ?? data.defaultModels[t]])), monthlyBudgetUsd: budget }),
    onSuccess: () => done('Models saved.'),
    onError: toast.error,
  });
  const v1 = new Set(['score', 'tailor', 'apply', 'capture']);
  const tasks = showAll ? data.tasks : data.tasks.filter((t) => !v1.has(t));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Models</h2>
        <Btn size="sm" busy={save.isPending} onClick={() => save.mutate()}>
          Save
        </Btn>
      </div>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {tasks.map((t) => (
              <tr key={t}>
                <td>
                  <div style={{ fontWeight: 500 }}>{TASK_LABEL[t]?.[0] ?? t}</div>
                  <div className="faint" style={{ fontSize: '0.75rem' }}>
                    {TASK_LABEL[t]?.[1]}
                  </div>
                </td>
                <td style={{ width: 230 }}>
                  <select className="select" value={models[t] ?? data.defaultModels[t]} onChange={(e) => setModels({ ...models, [t]: e.target.value })} aria-label={`Model for ${TASK_LABEL[t]?.[0] ?? t}`}>
                    {data.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label.replace(/^Claude /, '')}: ${m.input} / ${m.output}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '0 var(--s-5) var(--s-3)' }}>
        <Btn size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Hide the older tasks' : 'Show the older tasks too'}
        </Btn>
      </div>
      <div className="card-pad" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="form-grid">
          <Field label="Monthly budget (USD)" help="Bureau stops calling Claude when it's reached. 0 means no cap.">
            <input className="input" type="number" min={0} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
          </Field>
          <div className="field">
            <label>This month</label>
            <div className="num" style={{ fontSize: 'var(--t-xl)', fontWeight: 600 }}>
              ${(usage?.month ?? data.spend).toFixed(2)}
            </div>
            <div className="help">Prices beside each model are dollars per million tokens in and out. Estimates include prompt caching.</div>
          </div>
        </div>
        {usage?.byTask.length ? (
          <table className="table" style={{ marginTop: 'var(--s-4)' }}>
            <thead>
              <tr>
                <th>Task</th>
                <th className="num">Calls</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.byTask.map((u) => (
                <tr key={u.task + u.model}>
                  <td>
                    {TASK_LABEL[u.task]?.[0] ?? u.task} <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>{u.model}</span>
                  </td>
                  <td className="num">{u.calls}</td>
                  <td className="num">${u.cost.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function AutopilotCard() {
  const { data } = useQuery({ queryKey: ['campaigns', 'settings'], queryFn: () => api<AutopilotSettings>('/api/campaigns/settings') });
  const [s, setS] = useState<AutopilotSettings | null>(null);
  const { done, toast } = useSaved();
  useEffect(() => {
    if (data && !s) setS(data);
  }, [data, s]);
  const save = useMutation({ mutationFn: () => put('/api/campaigns/settings', s), onSuccess: () => done('Autopilot settings saved.'), onError: toast.error });
  if (!s) return <div className="card skeleton" style={{ height: 240 }} />;
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
        <Timer size={18} color="var(--accent)" />
        <h2 className="section-title">Autopilot</h2>
        <span className="spacer" />
        <Btn size="sm" busy={save.isPending} onClick={() => save.mutate()}>
          Save
        </Btn>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        Rules that hold across every campaign. Each campaign has its own caps and hours on top of these.
      </p>
      <div className="toggle-row">
        <div>
          <strong>Keep this computer awake during active hours</strong>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>
            Windows only. The screen may still turn off; it's released outside the hours and when Bureau stops.
          </div>
        </div>
        <Switch label="Keep awake" checked={s.keepAwake} onChange={(v) => setS({ ...s, keepAwake: v })} />
      </div>
      <div className="toggle-row">
        <div>
          <strong>Prefer employers in their working hours</strong>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>
            When the employer's time zone is known, roles where it's evening go to the back of the queue.
          </div>
        </div>
        <Switch label="Prefer employer hours" checked={s.preferEmployerHours} onChange={(v) => setS({ ...s, preferEmployerHours: v })} />
      </div>
      <div className="form-grid" style={{ paddingTop: 'var(--s-3)' }}>
        <Field label="Applications a day across all campaigns">
          <input className="input" type="number" min={0} max={400} value={s.globalDailyCap} onChange={(e) => setS({ ...s, globalDailyCap: Number(e.target.value) })} />
        </Field>
        <Field label="Give up on a job after (failed tries)">
          <input className="input" type="number" min={1} max={10} value={s.maxAttempts} onChange={(e) => setS({ ...s, maxAttempts: Number(e.target.value) })} />
        </Field>
        <Field label="Refresh the profile daily at">
          <input className="input" type="time" value={s.profileSyncAt} onChange={(e) => setS({ ...s, profileSyncAt: e.target.value })} />
        </Field>
        <Field label="Check the mailbox every (minutes)">
          <input className="input" type="number" min={1} max={120} value={s.inboxEveryMinutes} onChange={(e) => setS({ ...s, inboxEveryMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Weekly gap report on">
          <select className="select" value={s.weeklyDay} onChange={(e) => setS({ ...s, weeklyDay: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="At">
          <input className="input" type="time" value={s.weeklyAt} onChange={(e) => setS({ ...s, weeklyAt: e.target.value })} />
        </Field>
        <Field label="Send the daily digest this long after active hours end (minutes)" full>
          <input className="input" type="number" min={0} max={240} value={s.digestDelayMinutes} onChange={(e) => setS({ ...s, digestDelayMinutes: Number(e.target.value) })} style={{ maxWidth: 160 }} />
        </Field>
      </div>
    </section>
  );
}

function useNotify() {
  return useQuery({ queryKey: ['notify'], queryFn: () => api<NotifyState>('/api/notify') });
}

export function TelegramCard({ bare }: { bare?: boolean }) {
  const { data } = useNotify();
  const qc = useQueryClient();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [chats, setChats] = useState<{ id: string; title: string; type: string }[] | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notify'] });
    qc.invalidateQueries({ queryKey: ['onboarding'] });
  };
  const saveCreds = useMutation({
    mutationFn: (b: { token?: string; chatId?: string }) => put<NotifyState>('/api/notify/telegram', b),
    onSuccess: (_r, b) => {
      setToken('');
      if (b.chatId) setChats(null);
      toast.success(b.chatId ? 'Chat locked in. Only this chat can command Bureau.' : 'Bot token saved.');
      refresh();
    },
    onError: toast.error,
  });
  const find = useMutation({ mutationFn: () => api<{ chats: { id: string; title: string; type: string }[] }>('/api/notify/telegram/chats'), onSuccess: (r) => setChats(r.chats), onError: toast.error });
  const test = useMutation({ mutationFn: () => post('/api/notify/test', { channel: 'telegram' }), onSuccess: () => toast.success('Test message sent. Check Telegram.'), onError: toast.error });
  const forget = useMutation({ mutationFn: () => del('/api/notify/telegram'), onSuccess: refresh, onError: toast.error });
  if (!data) return <div className="skeleton" style={{ height: 160 }} />;
  const t = data.telegram;
  return (
    <Panel bare={bare} icon={<Bell size={18} color="var(--accent)" />} title="Telegram" badge={t.configured ? <span className="tag olive">Connected, chat {t.chatIdHint}</span> : t.token.set ? <span className="tag brass">Needs your chat</span> : <span className="tag">Optional</span>}>
      <ol className="list-dash" style={{ marginBottom: 'var(--s-2)' }}>
        <li>In Telegram, message @BotFather, send /newbot and paste the token it gives you here.</li>
        <li>Send your new bot any message, then press Find my chat and pick yourself.</li>
        <li>Send a test. From then on /status, /today, /pause, /resume, /answer and /stop work from your phone.</li>
      </ol>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) saveCreds.mutate({ token: token.trim() });
        }}
      >
        <input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.token.set ? `Saved, ends ${t.token.hint?.replace('…', '') ?? ''}` : '123456789:AA…'} aria-label="Bot token" />
        <Btn type="submit" disabled={!token.trim()} busy={saveCreds.isPending && !!token}>
          Save token
        </Btn>
      </form>
      <div className="row wrap">
        <Btn disabled={!t.token.set} busy={find.isPending} onClick={() => find.mutate()}>
          Find my chat
        </Btn>
        <Btn disabled={!t.configured} busy={test.isPending} onClick={() => test.mutate()}>
          Send a test
        </Btn>
        {t.token.set ? (
          <Btn variant="ghost" onClick={() => confirm('Forget the bot token and chat?') && forget.mutate()}>
            Forget the bot
          </Btn>
        ) : null}
      </div>
      {chats ? (
        chats.length ? (
          <div className="list" style={{ background: 'var(--bg)' }}>
            {chats.map((c) => (
              <div key={c.id} className="list-row static">
                <span>
                  {c.title} <span className="faint">({c.type})</span>
                </span>
                <Btn size="sm" onClick={() => saveCreds.mutate({ chatId: c.id })}>
                  This is me
                </Btn>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
            No messages yet. Send your bot a message in Telegram, then try again.
          </p>
        )
      ) : null}
    </Panel>
  );
}

function NotificationsCard() {
  const { data } = useNotify();
  const qc = useQueryClient();
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const save = useMutation({
    mutationFn: (s: NotifyState['settings']) => put<NotifyState>('/api/notify/settings', s),
    onSuccess: (r) => qc.setQueryData(['notify'], r),
    onError: toast.error,
  });
  const saveTopic = useMutation({
    mutationFn: (t: string | null) => put<NotifyState>('/api/notify/ntfy', { topic: t }),
    onSuccess: (r) => {
      setTopic('');
      qc.setQueryData(['notify'], r);
      toast.success('ntfy topic saved.');
    },
    onError: toast.error,
  });
  const test = useMutation({ mutationFn: (channel: 'ntfy' | 'email') => post('/api/notify/test', { channel }), onSuccess: () => toast.success('Test sent.'), onError: toast.error });
  if (!data) return <div className="card skeleton" style={{ height: 240 }} />;
  const s = data.settings;
  const tg = (k: keyof typeof s.telegram, v: boolean) => save.mutate({ ...s, telegram: { ...s.telegram, [k]: v } });
  return (
    <>
      <TelegramCard />
      <section className="card card-pad">
        <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
          <Bell size={18} color="var(--accent)" />
          <h2 className="section-title">What reaches you</h2>
        </div>
        {(
          [
            ['enabled', 'Telegram on'],
            ['alerts', 'Interviews, assessments and offers, at once'],
            ['digest', 'The daily digest'],
            ['questions', 'New questions from forms, to answer by reply'],
            ['info', 'Campaign news (started, paused, gone live)'],
          ] as const
        ).map(([k, label]) => (
          <div className="toggle-row" key={k}>
            <span>{label}</span>
            <Switch label={label} checked={s.telegram[k]} onChange={(v) => tg(k, v)} />
          </div>
        ))}
        <div className="toggle-row">
          <div>
            <span>Email me the daily digest</span>
            <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>
              Over the email account below, to {s.email.to || 'that same address'}.
            </div>
          </div>
          <Switch label="Email digest" checked={s.email.digest} onChange={(v) => save.mutate({ ...s, email: { ...s.email, digest: v } })} />
        </div>
        <div className="toggle-row">
          <div>
            <span>ntfy push notifications</span>
            <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>
              Alerts through {s.ntfy.server}. {data.ntfy.topicSet ? 'Topic saved.' : 'Pick a long, hard-to-guess topic.'}
            </div>
          </div>
          <Switch label="ntfy" checked={s.ntfy.enabled} onChange={(v) => save.mutate({ ...s, ntfy: { ...s.ntfy, enabled: v } })} />
        </div>
        {s.ntfy.enabled ? (
          <div className="row" style={{ paddingBottom: 'var(--s-2)' }}>
            <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={data.ntfy.topicSet ? 'Replace the topic…' : 'bureau-alerts-7f3k9q'} aria-label="ntfy topic" />
            <Btn disabled={!topic.trim()} busy={saveTopic.isPending} onClick={() => saveTopic.mutate(topic.trim())}>
              Save
            </Btn>
            <Btn disabled={!data.ntfy.topicSet} busy={test.isPending && test.variables === 'ntfy'} onClick={() => test.mutate('ntfy')}>
              Test
            </Btn>
          </div>
        ) : null}
      </section>
    </>
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
        Campaigns only run while Bureau is running. With this on, Bureau starts quietly in the background when you sign in, with no window. Open it any time at <code>http://127.0.0.1:4317</code>. Its log is in <code>data/bureau.log</code>.
      </p>
    </section>
  );
}

export function SmtpCard({ bare }: { bare?: boolean }) {
  const { data } = useSettings();
  if (!data) return <div className="skeleton" style={{ height: 200 }} />;
  return <SmtpForm data={data} bare={bare} />;
}

function SmtpForm({ data, bare }: { data: SettingsData; bare?: boolean }) {
  const [s, setS] = useState(data.smtp ?? { host: 'smtp.gmail.com', port: 465, secure: true, user: '', from: '', bccSelf: true });
  const [pass, setPass] = useState('');
  const { done, toast } = useSaved();
  const save = useMutation({
    mutationFn: () => put('/api/settings/smtp', { ...s, password: pass || undefined }),
    onSuccess: () => {
      setPass('');
      done('Sending settings saved.');
    },
    onError: toast.error,
  });
  const test = useMutation({ mutationFn: () => post<{ message: string }>('/api/settings/smtp/test'), onSuccess: (r) => toast.success(r.message), onError: toast.error });
  return (
    <Panel bare={bare} icon={<Mail size={18} color="var(--accent)" />} title="Sending email (SMTP)" badge={data.smtpPassword.set ? <span className="tag olive">Connected</span> : <span className="tag">Optional</span>}>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        {bare ? <strong style={{ color: 'var(--text)' }}>Sending. </strong> : null}
        Applications that ask for email go out from this account. For Gmail, turn on 2-step verification and use an app password, never your real password.
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
      <div className="row">
        <Btn busy={save.isPending} onClick={() => save.mutate()}>
          Save
        </Btn>
        <Btn variant="ghost" busy={test.isPending} disabled={!data.smtpPassword.set} onClick={() => test.mutate()}>
          Test the connection
        </Btn>
      </div>
    </Panel>
  );
}

export function ImapCard({ bare }: { bare?: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ['inbox', 'settings'], queryFn: () => optional<ImapSettings>('/api/inbox/settings') });
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<{ host: string; port: number; secure: boolean; user: string; password: string } | null>(null);
  useEffect(() => {
    if (data !== undefined && !form) setForm({ host: data?.imap?.host ?? 'imap.gmail.com', port: data?.imap?.port ?? 993, secure: data?.imap?.secure ?? true, user: data?.imap?.user ?? '', password: '' });
  }, [data, form]);
  const save = useMutation({
    mutationFn: () => put('/api/inbox/settings', { ...form, password: form?.password || undefined }),
    onSuccess: () => {
      toast.success('Mailbox saved.');
      setForm((f) => (f ? { ...f, password: '' } : f));
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: toast.error,
  });
  const test = useMutation({ mutationFn: () => post<{ message?: string }>('/api/inbox/test'), onSuccess: (r) => toast.success(r.message ?? 'Connected.'), onError: toast.error });
  const badge = data?.imap?.passwordSet ? <span className="tag olive">Connected</span> : data === null ? <span className="tag">Not in this build</span> : <span className="tag">Optional</span>;
  if (isLoading || !form) return <div className="skeleton" style={{ height: 160 }} />;
  return (
    <Panel bare={bare} icon={<InboxIcon size={18} color="var(--accent)" />} title="Reading replies (IMAP)" badge={badge}>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        {bare ? <strong style={{ color: 'var(--text)' }}>Reading. </strong> : null}
        Bureau reads the job-search mailbox to sort replies, spot interviews, catch verification codes and follow up once. It never answers interview invitations for you.
      </p>
      {data === null ? (
        <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>The inbox reader isn't part of this build yet. These settings appear here once it is.</p>
      ) : (
        <>
          <div className="form-grid">
            <Field label="IMAP host">
              <input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </Field>
            <Field label="Port">
              <input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value), secure: Number(e.target.value) === 993 })} />
            </Field>
            <Field label="Username">
              <input className="input" value={form.user} autoComplete="off" onChange={(e) => setForm({ ...form, user: e.target.value })} />
            </Field>
            <Field label={data?.imap?.passwordSet ? 'App password (stored)' : 'App password'}>
              <input className="input" type="password" autoComplete="new-password" value={form.password} placeholder={data?.imap?.passwordSet ? '••••••••' : ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
          </div>
          {data?.lastPollAt || data?.lastError ? (
            <p className="muted" style={{ fontSize: 'var(--t-xs)' }}>
              {data.lastError ? `Last check failed: ${data.lastError}` : `Last checked ${ago(data.lastPollAt)}.`}
            </p>
          ) : null}
          <div className="row">
            <Btn busy={save.isPending} onClick={() => save.mutate()}>
              Save
            </Btn>
            <Btn variant="ghost" busy={test.isPending} disabled={!data?.imap?.passwordSet} onClick={() => test.mutate()}>
              Test the connection
            </Btn>
          </div>
        </>
      )}
    </Panel>
  );
}

function SidecarCard() {
  const { data } = useQuery({ queryKey: ['scout', 'health'], queryFn: () => optional<ScoutHealth>('/api/scout/health') });
  const j = data?.jobspy;
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
        <Radar size={18} color="var(--accent)" />
        <h2 className="section-title">JobSpy sidecar</h2>
        <span className="spacer" />
        {j ? j.available ? <span className="tag olive">Ready</span> : <span className="tag brass">Not set up</span> : null}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        A small Python helper that searches LinkedIn, Indeed, Glassdoor, Google and ZipRecruiter as a guest. Bureau never signs in to them.
      </p>
      {j?.available ? (
        <p style={{ fontSize: 'var(--t-sm)' }}>
          JobSpy {j.version} on Python {j.python}.
        </p>
      ) : (
        <div className="stack" style={{ gap: 6, fontSize: 'var(--t-sm)' }}>
          {j?.reason ? <span className="muted">{j.reason}</span> : null}
          <span>To set it up, run this once in the Bureau folder (Python 3.10 or newer):</span>
          <code style={{ display: 'block', padding: '8px 10px' }}>powershell -ExecutionPolicy Bypass -File scripts/setup-sidecar.ps1</code>
          <span className="faint">On Linux or macOS: bash scripts/setup-sidecar.sh</span>
        </div>
      )}
      <div className="row" style={{ marginTop: 'var(--s-3)' }}>
        <a className="btn ghost sm" href="#/sources?tab=health">
          <Cpu /> Source health
        </a>
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
