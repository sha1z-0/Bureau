import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, del, post, put, type AnswerEntry, type GithubSummary, type LearningItem, type Links, type StyleFingerprint, type VoicePassage } from './api';
import { Btn, Field, ago, useToast } from './ui';
import { Tabs, words } from './kit';

/* Editors for the master profile, shared by the setup wizard and Profile. */

// ── Links ────────────────────────────────────────────────────────────

export function LinksEditor({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['master', 'links'], queryFn: () => api<{ links: Links; stored: Partial<Links> }>('/api/master/links') });
  const [form, setForm] = useState<Links | null>(null);
  useEffect(() => {
    if (data && !form) setForm({ github: data.links.github ?? '', portfolio: data.links.portfolio ?? '', linkedin: data.links.linkedin ?? '', socials: data.links.socials ?? [] });
  }, [data, form]);
  const save = useMutation({
    mutationFn: () => put('/api/master/links', { ...form, socials: form!.socials.filter((s) => s.url.trim()) }),
    onSuccess: () => {
      toast.success('Links saved.');
      qc.invalidateQueries({ queryKey: ['master'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
      onSaved?.();
    },
    onError: toast.error,
  });
  if (!form) return <div className="skeleton" style={{ height: 200 }} />;
  const setSocial = (i: number, patch: Partial<Links['socials'][number]>) => setForm({ ...form, socials: form.socials.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <form
      className="stack"
      style={{ gap: 'var(--s-4)' }}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="form-grid">
        <Field label="GitHub" help="Your profile page. Bureau reads public repos and READMEs.">
          <input className="input" inputMode="url" value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} placeholder="https://github.com/you" />
        </Field>
        <Field label="Portfolio or personal site">
          <input className="input" inputMode="url" value={form.portfolio} onChange={(e) => setForm({ ...form, portfolio: e.target.value })} placeholder="https://you.dev" />
        </Field>
        <Field label="LinkedIn" full help="Only the address. Bureau never signs in to LinkedIn or reads it; forms just ask for the link.">
          <input className="input" inputMode="url" value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://www.linkedin.com/in/you" />
        </Field>
      </div>
      <Field label="Other profiles" help="Anything a form might ask for: a blog, Kaggle, Dribbble, a Stack Overflow profile.">
        <div className="stack" style={{ gap: 8 }}>
          {form.socials.map((s, i) => (
            <div className="row" key={i}>
              <input className="input" style={{ maxWidth: 160 }} value={s.label} onChange={(e) => setSocial(i, { label: e.target.value })} placeholder="Label" aria-label="Label" />
              <input className="input" inputMode="url" value={s.url} onChange={(e) => setSocial(i, { url: e.target.value })} placeholder="https://" aria-label="Address" />
              <Btn variant="ghost" icon type="button" onClick={() => setForm({ ...form, socials: form.socials.filter((_, j) => j !== i) })} aria-label="Remove">
                <Trash2 />
              </Btn>
            </div>
          ))}
          <div>
            <Btn size="sm" type="button" onClick={() => setForm({ ...form, socials: [...form.socials, { label: '', url: '' }] })}>
              <Plus /> Add a profile
            </Btn>
          </div>
        </div>
      </Field>
      <div className="row">
        <Btn type="submit" busy={save.isPending} data-testid="links-save">
          {compact ? 'Save' : 'Save links'}
        </Btn>
      </div>
    </form>
  );
}

// ── GitHub ───────────────────────────────────────────────────────────

export function GithubPreview() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['master', 'github'],
    queryFn: () => api<{ github: GithubSummary | null; token: { set: boolean; hint: string | null } }>('/api/master/github'),
  });
  const links = useQuery({ queryKey: ['master', 'links'], queryFn: () => api<{ links: Links }>('/api/master/links') });
  const [token, setToken] = useState('');
  const sync = useMutation({
    mutationFn: () => post<{ report: { added?: number } }>('/api/master/sync', { parts: ['github'] }),
    onSuccess: (r) => {
      toast.success(`GitHub read. ${r.report.added ?? 0} new facts recorded with their source.`);
      qc.invalidateQueries({ queryKey: ['master'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: toast.error,
  });
  const saveToken = useMutation({
    mutationFn: () => put('/api/master/github-token', { token: token.trim() }),
    onSuccess: () => {
      setToken('');
      toast.success('Token saved in the vault.');
      qc.invalidateQueries({ queryKey: ['master', 'github'] });
    },
    onError: toast.error,
  });
  if (isLoading) return <div className="skeleton" style={{ height: 180 }} />;
  const gh = data?.github;
  const hasLink = !!links.data?.links.github;
  const repos = (gh?.repos ?? []).filter((r) => !r.fork).slice(0, 8);
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="row wrap">
        <Btn onClick={() => sync.mutate()} busy={sync.isPending} disabled={!hasLink}>
          <RefreshCw /> {gh ? 'Read GitHub again' : 'Read my GitHub'}
        </Btn>
        <span className="muted" style={{ fontSize: 'var(--t-sm)' }}>
          {gh ? `Last read ${ago(gh.syncedAt)} as ${gh.login}.` : hasLink ? 'Nothing read yet.' : 'Add your GitHub link first.'}
        </span>
      </div>
      {repos.length ? (
        <div className="list" style={{ background: 'var(--bg)' }}>
          {repos.map((r) => (
            <div key={r.name} className="list-row static">
              <div style={{ minWidth: 0 }}>
                <a className="title" href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                  {r.name}
                </a>
                {r.description ? (
                  <div className="muted" style={{ fontSize: 'var(--t-sm)' }}>
                    {r.description}
                  </div>
                ) : null}
                <div className="meta" style={{ marginTop: 2 }}>
                  {r.languages.slice(0, 4).map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                  {r.pushedAt ? <span>pushed {ago(r.pushedAt)}</span> : null}
                </div>
              </div>
              <div className="num muted" style={{ fontSize: 'var(--t-sm)', textAlign: 'right' }}>
                {r.recentCommits ? `${r.recentCommits} commits in 90 days` : r.stars ? `${r.stars} stars` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : gh ? (
        <p className="muted">No public repositories of your own were found.</p>
      ) : null}
      <Field label={data?.token.set ? `Access token (saved, ends ${data.token.hint?.replace('…', '') ?? ''})` : 'Access token (optional)'} help="Only raises GitHub's hourly limit. Read-only public access is enough; it's stored encrypted.">
        <div className="row">
          <input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          <Btn onClick={() => saveToken.mutate()} busy={saveToken.isPending} disabled={token.trim().length < 20}>
            Save
          </Btn>
        </div>
      </Field>
    </div>
  );
}

// ── Voice bank ───────────────────────────────────────────────────────

interface VoiceData {
  prompts: { key: string; prompt: string }[];
  guidance: string;
  passages: VoicePassage[];
  style: StyleFingerprint | null;
}

function counterClass(n: number) {
  return n === 0 ? '' : n < 80 || n > 200 ? 'short' : 'good';
}

function VoicePrompt({ prompt, passage, index }: { prompt: string; passage: VoicePassage | undefined; index: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState(passage?.text ?? '');
  const [saved, setSaved] = useState(passage?.text ?? '');
  useEffect(() => {
    setText(passage?.text ?? '');
    setSaved(passage?.text ?? '');
  }, [passage?.id, passage?.text]);
  const save = useMutation({
    mutationFn: () => (passage ? put(`/api/master/voice/${passage.id}`, { prompt, text: text.trim() }) : post('/api/master/voice', { prompt, text: text.trim() })),
    onSuccess: () => {
      setSaved(text);
      qc.invalidateQueries({ queryKey: ['master', 'voice'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/master/voice/${passage!.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'voice'] }),
    onError: toast.error,
  });
  const n = words(text);
  const dirty = text.trim() !== saved.trim();
  return (
    <div className="prompt-block">
      <label className="prompt" htmlFor={`voice-${index}`}>
        {prompt}
      </label>
      <textarea
        id={`voice-${index}`}
        className="textarea"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => dirty && text.trim().length > 0 && save.mutate()}
        placeholder="Write it the way you'd tell a friend in the field."
        data-testid={`voice-${index}`}
      />
      <div className="row">
        <span className={`counter ${counterClass(n)}`}>
          {n} {n === 1 ? 'word' : 'words'}
          {n > 0 && n < 80 ? ', aim for 80 to 200' : n > 200 ? ', a little long' : ''}
        </span>
        <span className="spacer" />
        {save.isPending ? <span className="spinner" aria-label="Saving" /> : !dirty && saved ? <Check size={15} color="var(--good)" aria-label="Saved" /> : null}
        {passage ? (
          <Btn size="sm" variant="ghost" onClick={() => confirm('Delete this passage?') && remove.mutate()}>
            Delete
          </Btn>
        ) : null}
        <Btn size="sm" disabled={!dirty || !text.trim()} busy={save.isPending} onClick={() => save.mutate()}>
          Save
        </Btn>
      </div>
    </div>
  );
}

export function VoiceBankEditor() {
  const { data } = useQuery({ queryKey: ['master', 'voice'], queryFn: () => api<VoiceData>('/api/master/voice') });
  if (!data) return <div className="skeleton" style={{ height: 400 }} />;
  const byPrompt = new Map(data.passages.map((p) => [p.prompt, p]));
  const extra = data.passages.filter((p) => !data.prompts.some((q) => q.prompt === p.prompt));
  const filled = data.passages.filter((p) => p.text.trim()).length;
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
        {data.guidance} Letters built by editing your own writing read as human; letters written from nothing don't.
      </p>
      <div className="row muted" style={{ fontSize: 'var(--t-sm)' }}>
        <strong className="num" style={{ color: 'var(--text)' }}>
          {filled} of 8
        </strong>
        <span>written. Six or more gives the writer enough to work with.</span>
        {data.style ? (
          <span className="hide-phone">
            Your sentences average {data.style.sentenceLenMean.toFixed(0)} words across {data.style.words.toLocaleString()} words in total.
          </span>
        ) : null}
      </div>
      {data.prompts.map((p, i) => (
        <VoicePrompt key={p.key} index={i} prompt={p.prompt} passage={byPrompt.get(p.prompt)} />
      ))}
      {extra.map((p, i) => (
        <VoicePrompt key={p.id} index={data.prompts.length + i} prompt={p.prompt} passage={p} />
      ))}
    </div>
  );
}

// ── Answer bank ──────────────────────────────────────────────────────

const ANSWER_GROUPS: [string, string[]][] = [
  ['Right to work', ['work_authorization', 'sponsorship', 'age_18', 'background_check', 'security_clearance', 'drivers_licence']],
  ['Pay and start date', ['expected_salary', 'current_salary', 'start_date']],
  ['Where and how you work', ['relocation', 'onsite_hybrid', 'remote', 'tz_overlap', 'timezone', 'travel', 'current_location', 'full_time', 'contract_work', 'shifts']],
  ['Experience and education', ['years_experience', 'has_experience', 'degree_completion', 'highest_education', 'languages', 'previously_employed', 'noncompete']],
  ['Contact and links', ['full_name', 'email', 'phone', 'linkedin', 'github', 'portfolio']],
  ['How you heard', ['referral_source', 'referred_by_employee']],
];

function groupOf(intent: string | null): string {
  for (const [g, keys] of ANSWER_GROUPS) if (intent && keys.includes(intent)) return g;
  return 'Other questions';
}

function AnswerRow({ entry }: { entry: AnswerEntry }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState(entry.answer);
  const [saved, setSaved] = useState(entry.answer);
  useEffect(() => {
    setValue(entry.answer);
    setSaved(entry.answer);
  }, [entry.id, entry.answer]);
  const save = useMutation({
    mutationFn: () => put(`/api/master/answers/${entry.id}`, { answer: value.trim() }),
    onSuccess: () => {
      setSaved(value);
      qc.invalidateQueries({ queryKey: ['master', 'answers'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/master/answers/${entry.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'answers'] }),
    onError: toast.error,
  });
  const dirty = value.trim() !== saved.trim();
  const long = value.length > 80 || /why|describe|tell us/i.test(entry.questionRaw);
  return (
    <div className="field" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <label htmlFor={`ans-${entry.id}`} style={{ fontSize: 'var(--t-sm)', fontWeight: 600 }}>
          {entry.questionRaw}
        </label>
        <span className="spacer" />
        {entry.source === 'derived' ? <span className="tag">From your profile</span> : null}
        {save.isPending ? <span className="spinner" /> : !dirty && saved ? <Check size={15} color="var(--good)" aria-label="Saved" /> : null}
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {long ? (
          <textarea id={`ans-${entry.id}`} className="textarea" rows={2} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => dirty && save.mutate()} />
        ) : (
          <input id={`ans-${entry.id}`} className="input" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => dirty && save.mutate()} placeholder="Leave empty if it doesn't apply" />
        )}
        <Btn variant="ghost" icon onClick={() => confirm('Remove this question from the bank?') && remove.mutate()} aria-label={`Remove ${entry.questionRaw}`}>
          <Trash2 />
        </Btn>
      </div>
    </div>
  );
}

export function AnswerBankEditor({ withTest }: { withTest?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['master', 'answers'], queryFn: () => api<{ answers: AnswerEntry[] }>('/api/master/answers') });
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [testQ, setTestQ] = useState('');
  const add = useMutation({
    mutationFn: () => post('/api/master/answers', { question: q.trim(), answer: a.trim() }),
    onSuccess: () => {
      setQ('');
      setA('');
      qc.invalidateQueries({ queryKey: ['master', 'answers'] });
    },
    onError: toast.error,
  });
  const test = useMutation({
    mutationFn: () => post<{ answer: { value: string; source: string; confidence: number; key: string } | null; intent: { key: string } | null }>('/api/master/answers/test', { question: testQ.trim() }),
    onError: toast.error,
  });
  const groups = useMemo(() => {
    const m = new Map<string, AnswerEntry[]>();
    for (const e of data?.answers ?? []) {
      const g = groupOf(e.intent);
      m.set(g, [...(m.get(g) ?? []), e]);
    }
    const order = [...ANSWER_GROUPS.map(([g]) => g), 'Other questions'];
    return order.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
  }, [data]);
  const [open, setOpen] = useState<string>('Right to work');
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  const filled = data.answers.filter((x) => x.answer.trim()).length;
  const current = groups.find(([g]) => g === open) ?? groups[0];
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
        Forms ask the same questions again and again. Bureau answers them from here word for word, and asks you when a form needs something new. It never guesses a legal answer.{' '}
        <strong className="num" style={{ color: 'var(--text)' }}>
          {filled} of {data.answers.length}
        </strong>{' '}
        answered.
      </p>
      {groups.length ? (
        <Tabs
          label="Question groups"
          value={current?.[0] ?? ''}
          onChange={setOpen}
          items={groups.map(([g, list]) => ({ id: g, label: g, count: list.filter((x) => !x.answer.trim()).length || null }))}
        />
      ) : null}
      {current ? (
        <div>
          {current[1].map((e) => (
            <AnswerRow key={e.id} entry={e} />
          ))}
        </div>
      ) : null}
      <div className="prompt-block">
        <span className="prompt">Add a question of your own</span>
        <div className="form-grid">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Are you comfortable with on-call rotations?" aria-label="Question" />
          <input className="input" value={a} onChange={(e) => setA(e.target.value)} placeholder="Your answer" aria-label="Answer" />
        </div>
        <div>
          <Btn size="sm" disabled={q.trim().length < 2} busy={add.isPending} onClick={() => add.mutate()}>
            <Plus /> Add to the bank
          </Btn>
        </div>
      </div>
      {withTest ? (
        <div className="prompt-block">
          <span className="prompt">Try a question the way a form would ask it</span>
          <div className="row">
            <input className="input" value={testQ} onChange={(e) => setTestQ(e.target.value)} placeholder="Will you now or in the future require sponsorship?" aria-label="Test question" />
            <Btn size="sm" disabled={!testQ.trim()} busy={test.isPending} onClick={() => test.mutate()}>
              Try it
            </Btn>
          </div>
          {test.data ? (
            test.data.answer ? (
              <div className="note good">
                <Check />
                <span>
                  <strong>{test.data.answer.value || '(empty)'}</strong> from {test.data.answer.source.replace('_', ' ')}, {Math.round(test.data.answer.confidence * 100)}% sure.
                </span>
              </div>
            ) : (
              <div className="note warn">
                <span>No stored answer fits. On a real form this becomes a question for you.</span>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Learning list ────────────────────────────────────────────────────

const LEARNING_STATUS: { id: LearningItem['status']; label: string }[] = [
  { id: 'learning', label: 'Learning' },
  { id: 'queued', label: 'Queued' },
  { id: 'done', label: 'Done' },
];

export function LearningListEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['master', 'learning'], queryFn: () => api<{ items: LearningItem[] }>('/api/master/learning') });
  const [skill, setSkill] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['master', 'learning'] });
    qc.invalidateQueries({ queryKey: ['onboarding'] });
  };
  const add = useMutation({
    mutationFn: () => post('/api/master/learning', { skill: skill.trim(), status: 'learning' }),
    onSuccess: () => {
      setSkill('');
      refresh();
    },
    onError: toast.error,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LearningItem['status'] }) => put(`/api/master/learning/${id}`, { status }),
    onSuccess: refresh,
    onError: toast.error,
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/master/learning/${id}`), onSuccess: refresh, onError: toast.error });
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
        Skills you're learning right now. Only the ones marked Learning can appear on your CV, under Currently learning, and letters may say you're learning them, never that you know them.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (skill.trim()) add.mutate();
        }}
      >
        <input className="input" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="e.g. Kubernetes" aria-label="Skill" data-testid="learning-skill" />
        <Btn type="submit" disabled={!skill.trim()} busy={add.isPending}>
          <Plus /> Add
        </Btn>
      </form>
      {data?.items.length ? (
        <div className="list" style={{ background: 'var(--bg)' }}>
          {data.items.map((it) => (
            <div key={it.id} className="list-row static">
              <div style={{ minWidth: 0 }}>
                <div className="title">{it.skill}</div>
                {it.startedAt ? <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>since {ago(it.startedAt)}</div> : null}
              </div>
              <div className="row">
                <div className="tabs" role="radiogroup" aria-label={`Status of ${it.skill}`}>
                  {LEARNING_STATUS.map((s) => (
                    <button key={s.id} type="button" role="radio" aria-checked={it.status === s.id} aria-selected={it.status === s.id} onClick={() => it.status !== s.id && setStatus.mutate({ id: it.id, status: s.id })}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <Btn variant="ghost" icon onClick={() => remove.mutate(it.id)} aria-label={`Remove ${it.skill}`}>
                  <Trash2 />
                </Btn>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
          Nothing yet. Add what you're studying; the weekly gap report will suggest more.
        </p>
      )}
    </div>
  );
}
