import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, RefreshCw, Save, Upload } from 'lucide-react';
import { api, patch, post, put, upload, CATEGORY_LABEL, type Category, type Profile, type ProfileFact } from '../api';
import { go, setParam, useRoute } from '../App';
import { Btn, Field, ListInput, Switch, ago, useToast } from '../ui';
import { PageHead, Tabs, plain } from '../kit';
import { AnswerBankEditor, GithubPreview, LearningListEditor, LinksEditor, VoiceBankEditor } from '../editors';

const CATS = Object.keys(CATEGORY_LABEL) as Category[];

function ProfileBasics() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => api<{ profile: Profile | null; documents: { id: string; filename: string; created_at: string }[] }>('/api/profile') });
  const [draft, setDraft] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.profile && !dirty) setDraft(data.profile);
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: () => put('/api/profile', draft),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Profile saved. Pre-filter scores were recalculated.');
    },
    onError: toast.error,
  });

  if (isLoading) return <div className="skeleton" style={{ height: 300 }} />;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [k]: v });
    setDirty(true);
  };
  const pref = <K extends keyof Profile['preferences']>(k: K, v: Profile['preferences'][K]) => {
    if (!draft) return;
    setDraft({ ...draft, preferences: { ...draft.preferences, [k]: v } });
    setDirty(true);
  };

  return (
    <>
      {dirty ? (
        <div className="livebar" role="status">
          <span className="text">You have unsaved changes to your profile.</span>
          <Btn size="sm" variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            <Save /> Save changes
          </Btn>
        </div>
      ) : null}

      <div className="split">
        <div className="grid">
          <CvUpload hasProfile={!!data?.profile} lastFile={data?.documents[0]?.filename} />
          {draft ? (
            <>
              <section className="card card-pad">
                <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
                  Identity
                </h2>
                <div className="form-grid">
                  <Field label="Name">
                    <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
                  </Field>
                  <Field label="Headline">
                    <input className="input" value={draft.headline} onChange={(e) => set('headline', e.target.value)} />
                  </Field>
                  <Field label="Email">
                    <input className="input" value={draft.email} onChange={(e) => set('email', e.target.value)} />
                  </Field>
                  <Field label="Location">
                    <input className="input" value={draft.location} onChange={(e) => set('location', e.target.value)} />
                  </Field>
                  <Field label="Phone" help="Used on application forms. Include the country code.">
                    <input className="input" value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+44 7700 900123" />
                  </Field>
                  <Field label="Seniority">
                    <select className="select" value={draft.seniority} onChange={(e) => set('seniority', e.target.value as Profile['seniority'])}>
                      {['entry', 'junior', 'mid', 'senior', 'lead'].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Years of experience">
                    <input className="input" type="number" min={0} max={60} value={draft.yearsExperience} onChange={(e) => set('yearsExperience', Number(e.target.value))} />
                  </Field>
                  <Field label="Summary" full>
                    <textarea className="textarea" rows={4} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
                  </Field>
                  <Field label="Core stack" full help="Your strongest technologies, most important first. Drives the free pre-filter.">
                    <ListInput value={draft.coreStack} onChange={(v) => set('coreStack', v)} />
                  </Field>
                  <Field label="Other skills" full>
                    <ListInput value={draft.skills} onChange={(v) => set('skills', v)} />
                  </Field>
                </div>
              </section>

              <section className="card card-pad">
                <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
                  Source of truth
                </h2>
                <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
                  A faithful transcription of your CV. Every tailored application is fact-checked against this text, so correct anything Claude misread.
                </p>
                <textarea className="textarea" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', minHeight: 360 }} value={draft.cvMarkdown} onChange={(e) => set('cvMarkdown', e.target.value)} aria-label="CV source text" />
              </section>
            </>
          ) : null}
        </div>

        <div className="grid">
          {draft ? (
            <>
              <section className="card card-pad">
                <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
                  What you're looking for
                </h2>
                <div className="stack" style={{ gap: 'var(--s-4)' }}>
                  <Field label="Disciplines">
                    <div className="chips">
                      {CATS.map((c) => {
                        const on = draft.preferences.categories.includes(c);
                        return (
                          <button key={c} className="chip" aria-pressed={on} onClick={() => pref('categories', on ? draft.preferences.categories.filter((x) => x !== c) : [...draft.preferences.categories, c])}>
                            {CATEGORY_LABEL[c]}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <Field label="Target roles">
                    <ListInput value={draft.preferences.targetRoles} onChange={(v) => pref('targetRoles', v)} placeholder="e.g. Penetration Tester, Senior Frontend Engineer" />
                  </Field>
                  <Field label="Locations">
                    <ListInput value={draft.preferences.locations} onChange={(v) => pref('locations', v)} placeholder="Remote, Berlin, London…" />
                  </Field>
                  <div>
                    <div className="toggle-row">
                      <span>Remote only</span>
                      <Switch label="Remote only" checked={draft.preferences.remoteOnly} onChange={(v) => pref('remoteOnly', v)} />
                    </div>
                    <div className="toggle-row">
                      <span>Open to relocation</span>
                      <Switch label="Open to relocation" checked={draft.preferences.openToRelocation} onChange={(v) => pref('openToRelocation', v)} />
                    </div>
                    <div className="toggle-row">
                      <span>I need visa sponsorship</span>
                      <Switch label="Needs sponsorship" checked={draft.preferences.needsSponsorship} onChange={(v) => pref('needsSponsorship', v)} />
                    </div>
                  </div>
                  <div className="form-grid">
                    <Field label="Salary floor">
                      <input className="input" type="number" min={0} value={draft.preferences.minSalary} onChange={(e) => pref('minSalary', Number(e.target.value))} />
                    </Field>
                    <Field label="Currency">
                      <input className="input" value={draft.preferences.currency} maxLength={8} onChange={(e) => pref('currency', e.target.value.toUpperCase())} />
                    </Field>
                  </div>
                  <Field label="Never show me" help="Companies to skip entirely.">
                    <ListInput value={draft.preferences.excludeCompanies} onChange={(v) => pref('excludeCompanies', v)} />
                  </Field>
                  <Field label="Deal-breaker words" help="Postings mentioning these sink in the ranking (e.g. “clearance required”, “unpaid”).">
                    <ListInput value={draft.preferences.excludeKeywords} onChange={(v) => pref('excludeKeywords', v)} />
                  </Field>
                </div>
              </section>

              <section className="card card-pad" style={{ borderColor: draft.preferences.workAuthorization ? undefined : 'color-mix(in oklab, var(--accent) 40%, transparent)' }}>
                <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
                  Application answers
                </h2>
                <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
                  The questions every application form asks. The hunt answers them from here, word for word, and never guesses.
                </p>
                <div className="stack" style={{ gap: 'var(--s-4)' }}>
                  <Field label="Work authorisation" help="e.g. “EU citizen, authorised to work anywhere in the EU; would need sponsorship for the US”.">
                    <textarea className="textarea" rows={2} value={draft.preferences.workAuthorization ?? ''} onChange={(e) => pref('workAuthorization', e.target.value)} />
                  </Field>
                  <div className="form-grid">
                    <Field label="Notice period / earliest start">
                      <input className="input" value={draft.preferences.noticePeriod ?? ''} onChange={(e) => pref('noticePeriod', e.target.value)} placeholder="2 weeks" />
                    </Field>
                    <Field label="Salary expectation">
                      <input className="input" value={draft.preferences.salaryExpectation ?? ''} onChange={(e) => pref('salaryExpectation', e.target.value)} placeholder="USD 120–140k" />
                    </Field>
                  </div>
                  <Field label="Other standing answers" help="Anything forms often ask: clearance, willingness to travel, pronouns, “how did you hear about us”.">
                    <textarea className="textarea" rows={3} value={draft.preferences.extraAnswers ?? ''} onChange={(e) => pref('extraAnswers', e.target.value)} />
                  </Field>
                </div>
              </section>

              <section className="card card-pad">
                <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
                  Your voice
                </h2>
                <div className="stack" style={{ gap: 'var(--s-4)' }}>
                  <Field label="How Claude reads your writing">
                    <textarea className="textarea" rows={3} value={draft.voice} onChange={(e) => set('voice', e.target.value)} />
                  </Field>
                  <Field label="Tone for applications">
                    <textarea className="textarea" rows={2} value={draft.preferences.tone} onChange={(e) => pref('tone', e.target.value)} />
                  </Field>
                  <Field label="Signature">
                    <textarea className="textarea" rows={4} value={draft.preferences.signature} onChange={(e) => pref('signature', e.target.value)} />
                  </Field>
                </div>
              </section>

              <PortfolioCard profile={draft} />
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function CvUpload({ hasProfile, lastFile, bare }: { hasProfile?: boolean; lastFile?: string; bare?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('notes', notes);
      form.append('file', file);
      return upload('/api/profile/upload', form);
    },
    onSuccess: () => {
      toast.success('Claude has read your CV. Your profile is built from it.');
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
      qc.invalidateQueries({ queryKey: ['master'] });
    },
    onError: toast.error,
  });
  const pick = (f?: File | null) => f && m.mutate(f);
  const current = useQuery({ queryKey: ['profile'], queryFn: () => api<{ profile: Profile | null; documents: { filename: string }[] }>('/api/profile'), enabled: !!bare });
  const file = lastFile ?? current.data?.documents[0]?.filename;
  const Wrap = bare ? 'div' : 'section';

  return (
    <Wrap className={bare ? '' : 'card card-pad'}>
      {bare ? null : (
        <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
          {hasProfile ? 'Replace your CV' : 'Start with your CV'}
        </h2>
      )}
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        {m.isPending ? <span className="spinner" style={{ width: 22, height: 22, color: 'var(--accent)' }} /> : <Upload size={22} color="var(--accent)" />}
        <strong style={{ fontSize: 'var(--t-lg)', fontWeight: 600 }}>{m.isPending ? 'Claude is reading your CV…' : 'Drop your CV here, or click to choose it'}</strong>
        <span className="muted" style={{ fontSize: '0.8125rem' }}>
          {file ? `Current file: ${file}` : 'PDF, DOCX, TXT or Markdown. It stays on this computer; Claude reads it once to build your profile.'}
        </span>
        <input ref={input} type="file" accept=".pdf,.docx,.md,.txt" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <div style={{ marginTop: 'var(--s-4)' }}>
        <Field label="Anything your CV doesn't say?" help="Optional. Target roles, a career change, what you want next.">
          <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Wrap>
  );
}

function PortfolioCard({ profile }: { profile: Profile }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [urls, setUrls] = useState<string[]>(profile.links.filter((l) => /github|portfolio|\.dev|\.io|site|blog/i.test(l.url + l.label)).map((l) => l.url).slice(0, 4));
  const m = useMutation({
    mutationFn: () => post('/api/profile/portfolio', { urls }),
    onSuccess: () => {
      toast.success('Portfolio evidence folded into your profile.');
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: toast.error,
  });
  return (
    <section className="card card-pad">
      <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
        Portfolio
      </h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        Claude reads your GitHub, site or portfolio pages and records the concrete evidence, so applications can cite real projects.
      </p>
      <ListInput value={urls} onChange={setUrls} placeholder="https://github.com/you" />
      <div className="row" style={{ marginTop: 'var(--s-3)' }}>
        <Btn busy={m.isPending} disabled={!urls.length} onClick={() => m.mutate()}>
          <Globe /> Read portfolio
        </Btn>
      </div>
      {profile.portfolioNotes ? (
        <>
          <div className="prose" style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
            {profile.portfolioNotes}
          </div>
        </>
      ) : null}
    </section>
  );
}

// ── v2: tabs over the master profile ────────────────────────────────

type ProfileTab = 'basics' | 'facts' | 'voice' | 'answers' | 'links' | 'learning';

const SOURCE_LABEL: Record<ProfileFact['source'], string> = { cv: 'Your CV', github: 'GitHub', portfolio: 'Portfolio', manual: 'Added by you', linkedin: 'LinkedIn export' };

interface SyncLast {
  startedAt: string;
  finishedAt: string;
  added: number;
  reactivated: number;
  deactivated: number;
  parts: Record<string, { ok?: boolean; added?: number; error?: string | null }>;
}

function FactsPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const facts = useQuery({ queryKey: ['master', 'facts'], queryFn: () => api<{ facts: ProfileFact[]; kinds: string[] }>('/api/master/facts') });
  const sync = useQuery({ queryKey: ['master', 'sync'], queryFn: () => api<{ last: SyncLast | null; running: boolean }>('/api/master/sync') });
  const [kind, setKind] = useState('skill');
  const [text, setText] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['master'] });
  const run = useMutation({
    mutationFn: () => post<{ report: SyncLast }>('/api/master/sync', {}),
    onSuccess: (r) => {
      toast.success(`Profile refreshed: ${r.report.added} new facts.`);
      refresh();
    },
    onError: toast.error,
  });
  const toggle = useMutation({ mutationFn: (f: ProfileFact) => patch(`/api/master/facts/${f.id}`, { active: !f.active }), onSuccess: refresh, onError: toast.error });
  const add = useMutation({
    mutationFn: () => post('/api/master/facts', { kind, text: text.trim() }),
    onSuccess: () => {
      setText('');
      refresh();
    },
    onError: toast.error,
  });
  const groups = new Map<string, ProfileFact[]>();
  for (const f of facts.data?.facts ?? []) groups.set(f.source, [...(groups.get(f.source) ?? []), f]);
  const last = sync.data?.last;
  return (
    <div className="split">
      <div className="grid">
        {facts.data && !facts.data.facts.length ? (
          <section className="card">
            <div className="empty">
              <h3>No facts yet</h3>
              <p>Upload your CV and read your GitHub. Every fact Bureau records keeps its source, and nothing reaches a letter without one.</p>
            </div>
          </section>
        ) : null}
        {[...groups].map(([src, list]) => (
          <section className="card" key={src}>
            <div className="card-head">
              <h2>{SOURCE_LABEL[src as ProfileFact['source']] ?? src}</h2>
              <span className="muted num">{list.filter((f) => f.active).length} in use</span>
            </div>
            {list.map((f) => (
              <div key={f.id} className="list-row static" style={f.active ? undefined : { color: 'var(--text-3)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--t-sm)' }}>{f.text}</div>
                  <div className="meta" style={{ fontSize: 'var(--t-xs)' }}>
                    <span>{plain(f.kind)}</span>
                    {f.sourceRef ? (
                      /^https?:/.test(f.sourceRef) ? (
                        <a href={f.sourceRef} target="_blank" rel="noopener noreferrer">
                          {f.sourceRef.replace(/^https?:\/\//, '').slice(0, 60)}
                        </a>
                      ) : (
                        <span>{f.sourceRef}</span>
                      )
                    ) : null}
                    <span>{ago(f.addedAt)}</span>
                  </div>
                </div>
                <Btn size="sm" variant="ghost" onClick={() => toggle.mutate(f)}>
                  {f.active ? 'Hide' : 'Use again'}
                </Btn>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="grid">
        <section className="card card-pad">
          <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
            Daily refresh
          </h2>
          <p className="muted" style={{ fontSize: 'var(--t-sm)', marginBottom: 'var(--s-3)' }}>
            Every morning Bureau re-reads a new CV upload, your GitHub and your portfolio. Facts that disappear from a source stop being used.
          </p>
          {last ? (
            <p style={{ fontSize: 'var(--t-sm)', marginBottom: 'var(--s-3)' }}>
              Last run {ago(last.finishedAt)}: {last.added} added, {last.deactivated} retired.{' '}
              {Object.entries(last.parts ?? {})
                .filter(([, p]) => p?.error)
                .map(([k, p]) => `${plain(k)} failed: ${p.error}`)
                .join(' ')}
            </p>
          ) : null}
          <Btn busy={run.isPending || sync.data?.running} onClick={() => run.mutate()}>
            <RefreshCw /> Refresh now
          </Btn>
        </section>
        <section className="card card-pad">
          <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
            Add a fact
          </h2>
          <p className="muted" style={{ fontSize: 'var(--t-sm)', marginBottom: 'var(--s-3)' }}>
            Something true that no source shows yet. Keep it plain; the writer may rephrase it, never inflate it.
          </p>
          <div className="stack">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
              {(facts.data?.kinds ?? ['skill']).map((k) => (
                <option key={k} value={k}>
                  {plain(k)}
                </option>
              ))}
            </select>
            <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Ran the payments on-call rota for a team of six for four months" aria-label="Fact" />
            <div>
              <Btn disabled={text.trim().length < 3} busy={add.isPending} onClick={() => add.mutate()}>
                Add the fact
              </Btn>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [, params] = useRoute();
  const tab = (params.get('tab') as ProfileTab) || 'basics';
  const qc = useQueryClient();
  const reopen = useMutation({
    mutationFn: () => put('/api/onboarding', { current: 'cv', done: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding'] });
      go('welcome');
    },
  });
  return (
    <>
      <PageHead
        title="Profile"
        lede="What Bureau knows about you, and where each fact came from. Your CV is the source of truth: letters may rephrase and reorder it, never add to it."
        actions={
          <Btn variant="ghost" busy={reopen.isPending} onClick={() => reopen.mutate()}>
            Open the setup guide
          </Btn>
        }
      />
      <div style={{ marginBottom: 'var(--s-4)', overflowX: 'auto' }}>
        <Tabs<ProfileTab>
          label="Profile sections"
          value={tab}
          onChange={(t) => setParam('tab', t === 'basics' ? null : t)}
          items={[
            { id: 'basics', label: 'Basics' },
            { id: 'facts', label: 'Facts and sources' },
            { id: 'voice', label: 'Voice bank' },
            { id: 'answers', label: 'Answer bank' },
            { id: 'links', label: 'Links and GitHub' },
            { id: 'learning', label: 'Learning list' },
          ]}
        />
      </div>
      {tab === 'basics' ? <ProfileBasics /> : null}
      {tab === 'facts' ? <FactsPanel /> : null}
      {tab === 'voice' ? (
        <section className="card card-pad" style={{ maxWidth: 860 }}>
          <VoiceBankEditor />
        </section>
      ) : null}
      {tab === 'answers' ? (
        <section className="card card-pad" style={{ maxWidth: 960 }}>
          <AnswerBankEditor withTest />
        </section>
      ) : null}
      {tab === 'links' ? (
        <div className="split">
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
              Links
            </h2>
            <LinksEditor />
          </section>
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
              GitHub
            </h2>
            <GithubPreview />
          </section>
        </div>
      ) : null}
      {tab === 'learning' ? (
        <section className="card card-pad" style={{ maxWidth: 860 }}>
          <LearningListEditor />
        </section>
      ) : null}
    </>
  );
}
