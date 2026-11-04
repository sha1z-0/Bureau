import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, ExternalLink, X } from 'lucide-react';
import {
  api,
  maybe,
  optional,
  put,
  type AgentMetrics,
  type FormRun,
  type FormRunDetail,
  type FormsSettings,
  type FormsSummary,
  type RecipeDetail,
  type RecipeRow,
  type RecipeStatus,
  type SiteAccount,
  type TraceDetail,
  type TraceSummary,
} from '../api';
import { setParam, useRoute } from '../App';
import { Btn, Field, ago, useToast } from '../ui';
import { Drawer, Facts, NotSetUp, PageHead, Stat, Tabs, atsLabel, pct, plain, stamp, usd } from '../kit';
import { FillTag, FormRunBody, VIA_LABEL, reasonText } from './FormRunView';

type Tab = 'recipes' | 'coverage' | 'fills' | 'runs' | 'traces' | 'accounts';

const RECIPE_TONE: Record<string, string> = { active: 'olive', shadow: 'brass', candidate: '', demoted: 'crimson' };
const RECIPE_LABEL: Record<RecipeStatus, string> = { active: 'Active', shadow: 'Being checked', candidate: 'Candidate', demoted: 'Demoted' };
const SCOPE_LABEL: Record<string, string> = { ats: 'Every company on it', company: 'One company', url: 'One page' };

const sameScope = (a: RecipeRow, b: RecipeRow) => a.ats === b.ats && a.scope === b.scope && a.scopeKey === b.scopeKey;
const shortUrl = (u: string | null) => (u ? u.replace(/^https?:\/\//, '').replace(/\/$/, '') : '');

function RecipeDrawer({ id, all, onClose }: { id: string; all: RecipeRow[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['forms', 'recipe', id], queryFn: () => maybe<RecipeDetail>(`/api/forms/recipes/${id}`) });
  const act = useMutation({
    mutationFn: (status: RecipeStatus) => put<{ recipe: RecipeRow }>(`/api/forms/recipes/${id}/status`, { status }),
    onSuccess: (_r, status) => {
      toast.success(status === 'active' ? 'Recipe promoted. It runs first on forms like this from now on.' : 'Recipe demoted. Forms like this go to the adapter or the agent.');
      qc.invalidateQueries({ queryKey: ['forms'] });
    },
    onError: toast.error,
  });
  const r = data?.recipe;
  const versions = r ? all.filter((x) => sameScope(x, r)).sort((a, b) => b.version - a.version) : [];
  return (
    <Drawer
      title={r ? `${atsLabel(r.ats)} recipe, version ${r.version}` : 'Recipe'}
      onClose={onClose}
      actions={
        r ? (
          <>
            {r.status !== 'active' ? (
              <Btn size="sm" busy={act.isPending && act.variables === 'active'} onClick={() => act.mutate('active')}>
                <ArrowUp /> Promote
              </Btn>
            ) : null}
            {r.status !== 'demoted' ? (
              <Btn size="sm" variant="ghost" busy={act.isPending && act.variables === 'demoted'} onClick={() => act.mutate('demoted')}>
                <ArrowDown /> Demote
              </Btn>
            ) : null}
          </>
        ) : null
      }
    >
      {isLoading ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : r ? (
        <div className="tl">
          <section>
            <Facts
              rows={[
                ['Status', <span className={`tag ${RECIPE_TONE[r.status] ?? ''}`}>{RECIPE_LABEL[r.status] ?? r.status}</span>],
                ['Covers', `${SCOPE_LABEL[r.scope] ?? r.scope}${r.scope === 'ats' ? '' : `: ${r.scopeKey}`}`],
                ['Worked', `${r.successes} ${r.successes === 1 ? 'time' : 'times'}`],
                ['Failed', `${r.failures} ${r.failures === 1 ? 'time' : 'times'}`],
                ['URL pattern', r.match?.urlPattern ?? ''],
                ['Updated', ago(r.updatedAt)],
              ]}
            />
            {r.status === 'active' ? null : (
              <p className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 'var(--s-3)' }}>
                Promoting makes this version the one that runs first; any other active version of the same scope is demoted. Every field is still read back and checked before anything is sent.
              </p>
            )}
          </section>
          <section>
            <div className="section-head">
              <h3>Steps</h3>
            </div>
            {r.steps.length ? (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {r.steps.map((s, i) => (
                      <tr key={i}>
                        <td className="num faint">{i + 1}</td>
                        <td>
                          <div>
                            {plain(s.action)} {s.labelNorm ? <strong>{s.labelNorm}</strong> : null}
                          </div>
                          <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                            {s.widget}
                            {s.valueSource ? `, from ${plain(s.valueSource).toLowerCase()}${s.valueKey ? ` (${s.valueKey})` : ''}` : ''}
                          </div>
                        </td>
                        <td className="hide-phone">
                          <code style={{ fontSize: '0.75rem', overflowWrap: 'anywhere' }}>{s.selectors[0] ?? ''}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No steps recorded.</p>
            )}
            {r.hooks.length ? (
              <p className="faint" style={{ fontSize: 'var(--t-xs)', marginTop: 'var(--s-2)' }}>
                {r.hooks.length} long {r.hooks.length === 1 ? 'question is' : 'questions are'} answered fresh each time from the answer bank, never baked in.
              </p>
            ) : null}
          </section>
          {data.runs.length ? (
            <section>
              <div className="section-head">
                <h3>Last runs</h3>
              </div>
              <table className="table">
                <tbody>
                  {data.runs.slice(0, 12).map((x, i) => (
                    <tr key={i}>
                      <td style={{ width: 28 }}>
                        <span className={`ok-mark ${x.ok ? 'yes' : 'no'}`}>{x.ok ? <Check size={13} /> : <X size={13} />}</span>
                      </td>
                      <td className="muted" style={{ overflowWrap: 'anywhere' }}>
                        {x.detail ?? (x.ok ? 'Worked' : 'Failed')}
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {ago(x.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          {versions.length > 1 ? (
            <section>
              <div className="section-head">
                <h3>Version history</h3>
              </div>
              <table className="table">
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} onClick={() => setParam('recipe', v.id)} style={{ cursor: v.id === r.id ? 'default' : 'pointer' }} aria-current={v.id === r.id ? 'true' : undefined}>
                      <td className="num">{v.id === r.id ? <strong>v{v.version}</strong> : `v${v.version}`}</td>
                      <td>
                        <span className={`tag ${RECIPE_TONE[v.status] ?? ''}`}>{RECIPE_LABEL[v.status] ?? v.status}</span>
                      </td>
                      <td className="num">
                        {v.successes} worked, {v.failures} failed
                      </td>
                      <td className="muted">{ago(v.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      ) : (
        <p className="muted">This recipe is no longer available.</p>
      )}
    </Drawer>
  );
}

function RunDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['forms', 'run', id], queryFn: () => maybe<FormRunDetail>(`/api/forms/runs/${id}`) });
  const run = data?.run;
  return (
    <Drawer title={run?.ats ? `${atsLabel(run.ats)} form` : 'Form run'} onClose={onClose} wide>
      {isLoading ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : data && run ? (
        <div className="tl">
          <section>
            <Facts
              rows={[
                ['Started', stamp(run.startedAt)],
                ['Finished', run.finishedAt ? stamp(run.finishedAt) : 'Still running'],
                ['Kind', run.live ? 'Allowed to send' : 'Rehearsal (never sends)'],
                ['Filled by', run.via ? (VIA_LABEL[run.via] ?? run.via) : ''],
                ['Page', run.url ? <a href={run.url} target="_blank" rel="noopener noreferrer">{shortUrl(run.url).slice(0, 60)}</a> : ''],
                ['Job', run.jobId ? <a href={`#/pipeline?job=${encodeURIComponent(run.jobId)}`}>Open the job</a> : ''],
              ]}
            />
          </section>
          <section>
            <FormRunBody data={data} />
          </section>
        </div>
      ) : (
        <p className="muted">This run is no longer available.</p>
      )}
    </Drawer>
  );
}

/** Coverage by ATS: adapters, recipes and the last 30 days of runs, rehearsals and live submissions apart. */
function Coverage({ summary, recipes }: { summary: FormsSummary; recipes: RecipeRow[] }) {
  const atsSet = new Set<string>([...summary.adapters.map((a) => a.ats), ...recipes.map((r) => r.ats), ...summary.last30Days.map((r) => r.ats)]);
  const rows = [...atsSet]
    .map((ats) => {
      const adapter = summary.adapters.find((a) => a.ats === ats);
      const mine = recipes.filter((r) => r.ats === ats);
      const runs = summary.last30Days.find((r) => r.ats === ats);
      return { ats, adapter, recipes: mine.length, active: mine.filter((r) => r.status === 'active').length, runs };
    })
    .sort((a, b) => (b.runs?.runs ?? 0) - (a.runs?.runs ?? 0) || b.recipes - a.recipes || atsLabel(a.ats).localeCompare(atsLabel(b.ats)));
  const total = Object.values(summary.recipes).reduce((n, v) => n + (v ?? 0), 0);
  const liveRuns = summary.last30Days.reduce((n, r) => n + (r.live?.runs ?? 0), 0);
  const liveSent = summary.last30Days.reduce((n, r) => n + (r.live?.submitted ?? 0), 0);
  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="stats stats-sheet">
        <Stat label="Adapters" value={summary.adapters.length} sub="ATS families with hand-written support" />
        <Stat label="Recipes" value={total} sub={`${summary.recipes.active ?? 0} active, ${summary.recipes.demoted ?? 0} demoted`} />
        <Stat label="Label variants known" value={summary.synonyms.toLocaleString()} sub="Ways a form asks for the same thing" />
        <Stat label="Live success, 30 days" value={liveRuns ? pct(liveSent / liveRuns) : '–'} sub={liveRuns ? `${liveSent} of ${liveRuns} live runs sent` : 'No live runs yet'} />
      </div>
      <section className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ATS</th>
              <th>Adapter</th>
              <th className="num">Recipes</th>
              <th className="num">Active</th>
              <th className="num">Filled, 30 days</th>
              <th className="num hide-phone">Rehearsals verified</th>
              <th className="num hide-phone">Live sent</th>
              <th className="num">Live success</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.ats}>
                <td style={{ fontWeight: 600 }}>{c.ats === 'unknown' ? 'Not recognised' : atsLabel(c.ats)}</td>
                <td>{c.adapter ? <span className="tag olive">{c.adapter.accounts ? 'Yes, with accounts' : 'Yes'}</span> : <span className="faint">None</span>}</td>
                <td className={`num ${c.recipes ? '' : 'nil'}`}>{c.recipes}</td>
                <td className={`num ${c.active ? '' : 'nil'}`}>{c.active}</td>
                <td className={`num ${c.runs?.runs ? '' : 'nil'}`}>{c.runs?.runs ?? 0}</td>
                <td className={`num hide-phone ${c.runs?.rehearsal?.runs ? '' : 'nil'}`}>{c.runs?.rehearsal?.runs ? `${c.runs.rehearsal.verified} of ${c.runs.rehearsal.runs}` : '–'}</td>
                <td className={`num hide-phone ${c.runs?.live?.runs ? '' : 'nil'}`}>{c.runs?.live?.runs ? `${c.runs.live.submitted} of ${c.runs.live.runs}` : '–'}</td>
                <td className={`num ${c.runs?.live?.runs ? '' : 'nil'}`}>{pct(c.runs?.live?.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="muted" style={{ padding: 'var(--s-5)' }}>
            No forms filled yet.
          </p>
        ) : null}
      </section>
      <p className="faint" style={{ fontSize: 'var(--t-xs)' }}>
        Rehearsals fill and verify a form without sending it. Live success counts only real submissions: runs allowed to send that the employer confirmed.
      </p>
    </div>
  );
}

/** The dedicated job-search email for ATS accounts, and the accounts Bureau has made with it. */
function Accounts() {
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['forms', 'settings'], queryFn: () => api<FormsSettings>('/api/forms/settings') });
  const accounts = useQuery({ queryKey: ['forms', 'accounts'], queryFn: () => api<{ accounts: SiteAccount[] }>('/api/forms/accounts') });
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && email === null) setEmail(settings.data.accountEmail ?? '');
  }, [settings.data, email]);
  const save = useMutation({
    mutationFn: () => put<FormsSettings>('/api/forms/settings', { accountEmail: (email ?? '').trim() }),
    onSuccess: (r) => {
      toast.success(r.accountEmail ? `New accounts use ${r.accountEmail}.` : 'Cleared. New accounts use the mailbox address, else the one on your profile.');
      qc.invalidateQueries({ queryKey: ['forms', 'settings'] });
    },
    onError: toast.error,
  });
  const list = accounts.data?.accounts ?? [];
  return (
    <div className="grid" style={{ gap: 'var(--s-4)' }}>
      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
          Email for ATS accounts
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 'var(--t-sm)' }}>
          Some employers (Workday, iCIMS, Taleo, SuccessFactors) ask for an account before the form. Bureau makes one with this address and a strong password of its own, kept in the encrypted vault. It never
          signs in with Google, LinkedIn or any other social login. Leave it empty to use the job-search mailbox, else the address on your profile.
        </p>
        {settings.isLoading || email === null ? (
          <div className="skeleton" style={{ height: 70 }} />
        ) : (
          <form
            className="row wrap"
            style={{ alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div style={{ flex: '1 1 260px' }}>
              <Field label="Job-search email">
                <input className="input" type="email" autoComplete="off" placeholder="name.jobs@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="account-email" />
              </Field>
            </div>
            <Btn type="submit" busy={save.isPending} disabled={(email ?? '').trim() === (settings.data?.accountEmail ?? '')}>
              Save
            </Btn>
          </form>
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Site accounts</h2>
          <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>
            Passwords stay in the vault and are never shown
          </span>
        </div>
        {accounts.isLoading ? (
          <div className="skeleton" style={{ height: 120, margin: 'var(--s-5)' }} />
        ) : list.length ? (
          <div className="table-wrap">
            <table className="table" data-testid="site-accounts">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Username</th>
                  <th className="hide-phone">Made</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={`${a.domain}-${a.username}`}>
                    <td style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{a.domain}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{a.username}</td>
                    <td className="muted hide-phone" title={stamp(a.createdAt)}>
                      {ago(a.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
            None yet. An account is made only when an employer's form sits behind a sign-in.
          </p>
        )}
      </section>
    </div>
  );
}

function TraceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['agent', 'trace', id], queryFn: () => optional<TraceDetail>(`/api/agent/traces/${id}`) });
  const t = data?.trace;
  return (
    <Drawer title="Trace" onClose={onClose} wide>
      {!data ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : t ? (
        <div className="tl">
          <section>
            <Facts
              rows={[
                ['Outcome', plain(t.outcome)],
                ['Form', t.ats ? atsLabel(t.ats) : 'Unknown'],
                ['From', t.origin === 'internal' ? 'Bureau' : 'An outside agent'],
                ['Steps', String(t.steps.length)],
                ['Started', stamp(t.startedAt)],
                ['Page', <a href={t.url} target="_blank" rel="noopener noreferrer">{t.url.replace(/^https?:\/\//, '').slice(0, 60)}</a>],
              ]}
            />
          </section>
          {t.steps.map((s) => (
            <section key={s.i}>
              <div className="row" style={{ marginBottom: 'var(--s-2)' }}>
                <span className={`ok-mark ${s.ok ? 'yes' : 'no'}`}>{s.ok ? <Check size={13} /> : <X size={13} />}</span>
                <strong>
                  {s.i + 1}. {plain(s.action)} {s.labelNorm ?? ''}
                </strong>
                <span className="spacer" />
                <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                  Page {s.step + 1}
                </span>
              </div>
              {s.note ? (
                <p className="muted" style={{ fontSize: 'var(--t-sm)', marginBottom: 'var(--s-2)' }}>
                  {s.note}
                </p>
              ) : null}
              {s.beforeShot || s.afterShot ? (
                <div className="shot-row">
                  {s.beforeShot ? (
                    <figure>
                      <a href={s.beforeShot} target="_blank" rel="noopener noreferrer">
                        <img src={s.beforeShot} alt={`Before step ${s.i + 1}`} loading="lazy" />
                      </a>
                      <figcaption>Before</figcaption>
                    </figure>
                  ) : null}
                  {s.afterShot ? (
                    <figure>
                      <a href={s.afterShot} target="_blank" rel="noopener noreferrer">
                        <img src={s.afterShot} alt={`After step ${s.i + 1}`} loading="lazy" />
                      </a>
                      <figcaption>After</figcaption>
                    </figure>
                  ) : null}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <p className="muted">This trace is no longer available.</p>
      )}
    </Drawer>
  );
}

function RunsChart({ m }: { m: AgentMetrics }) {
  const max = Math.max(1, ...m.daily.map((d) => d.agentRuns + d.recipeRuns + d.adapterRuns));
  const totals = m.daily.reduce((a, d) => ({ agent: a.agent + d.agentRuns, recipe: a.recipe + d.recipeRuns, adapter: a.adapter + d.adapterRuns }), { agent: 0, recipe: 0, adapter: 0 });
  return (
    <div className="stack">
      <div className="legend">
        <span>
          <i className="swatch" style={{ background: 'var(--good)' }} /> Recipes {totals.recipe}
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--leather-soft)' }} /> Adapters {totals.adapter}
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--accent)' }} /> Browser agent {totals.agent}
        </span>
        {m.costPerRun !== null ? <span>Agent cost per form {usd(m.costPerRun)}</span> : null}
      </div>
      {m.daily.length ? (
        <>
          <div className="daybars" role="img" aria-label="Form runs per day by kind">
            {m.daily.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.recipeRuns} recipe, ${d.adapterRuns} adapter, ${d.agentRuns} agent`} style={{ height: `${((d.agentRuns + d.recipeRuns + d.adapterRuns) / max) * 100}%` }}>
                <i style={{ flex: d.recipeRuns, background: 'var(--good)' }} />
                <i style={{ flex: d.adapterRuns, background: 'var(--leather-soft)' }} />
                <i style={{ flex: d.agentRuns, background: 'var(--accent)' }} />
              </div>
            ))}
          </div>
          <div className="row faint" style={{ fontSize: 'var(--t-xs)' }}>
            <span>{m.daily[0].day}</span>
            <span className="spacer" />
            <span>{m.daily[m.daily.length - 1].day}</span>
          </div>
          <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
            As Bureau learns, the green share grows: recipes are fast, cheap and checked, and the agent is only needed for forms it hasn't seen.
          </p>
        </>
      ) : (
        <p className="muted">No forms filled yet.</p>
      )}
    </div>
  );
}

function FillsList({ runs, jobFilter }: { runs: FormRun[]; jobFilter: string | null }) {
  if (!runs.length)
    return (
      <div className="card">
        <div className="empty">
          <h3>{jobFilter ? 'No form runs for this job' : 'No forms filled yet'}</h3>
          <p>Each time Bureau opens an employer's form, the run is kept here: a screenshot of every page and what each field read back.</p>
        </div>
      </div>
    );
  return (
    <section className="list" aria-label="Form runs">
      {runs.map((r) => (
        <button key={r.id} className="list-row" onClick={() => setParam('run', r.id)} data-testid="form-run">
          <div style={{ minWidth: 0 }}>
            <div className="title">{shortUrl(r.url).slice(0, 70) || 'Unknown page'}</div>
            <div className="meta">
              <span>{r.ats ? atsLabel(r.ats) : 'Unknown form'}</span>
              {r.via ? <span>By {VIA_LABEL[r.via] ?? r.via}</span> : null}
              <span>
                {r.fields.ok} of {r.fields.total} fields checked
              </span>
              {r.live ? null : <span>Rehearsal</span>}
              <span>{ago(r.startedAt)}</span>
            </div>
            {r.reason && r.status !== 'submitted' && r.status !== 'rehearsed' ? (
              <div className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 2 }}>
                {reasonText(r.reason)}
              </div>
            ) : null}
          </div>
          <FillTag run={r} />
        </button>
      ))}
    </section>
  );
}

export default function Forms() {
  const [, params] = useRoute();
  const tab = (params.get('tab') as Tab) || 'recipes';
  const recipeId = params.get('recipe');
  const runId = params.get('run');
  const traceId = params.get('trace');
  const jobFilter = params.get('job');
  const [ats, setAts] = useState('');
  const [status, setStatus] = useState('');
  const recipes = useQuery({ queryKey: ['forms', 'recipes'], queryFn: () => optional<{ recipes: RecipeRow[] }>('/api/forms/recipes') });
  const summary = useQuery({ queryKey: ['forms', 'summary'], queryFn: () => optional<FormsSummary>('/api/forms/summary'), enabled: tab === 'coverage' });
  const fills = useQuery({
    queryKey: ['forms', 'runs', jobFilter ?? 'all'],
    queryFn: () => optional<{ runs: FormRun[] }>(`/api/forms/runs?limit=100${jobFilter ? `&jobId=${encodeURIComponent(jobFilter)}` : ''}`),
    enabled: tab === 'fills',
  });
  const metrics = useQuery({ queryKey: ['forms', 'metrics'], queryFn: () => optional<AgentMetrics>('/api/agent/metrics?days=30'), enabled: tab === 'runs' });
  const traces = useQuery({ queryKey: ['forms', 'traces'], queryFn: () => optional<{ traces: TraceSummary[] }>('/api/agent/traces?limit=100'), enabled: tab === 'traces' });

  const head = <PageHead title="Forms" lede="Every employer form Bureau has learned. Known forms run from recipes; new ones go to an adapter or the browser agent, and a run that checks out becomes a recipe." />;
  const tabs = (
    <div style={{ marginBottom: 'var(--s-4)', overflowX: 'auto' }}>
      <Tabs<Tab>
        label="Forms sections"
        value={tab}
        onChange={(t) => {
          if (jobFilter && t !== 'fills') setParam('job', null);
          setParam('tab', t === 'recipes' ? null : t);
        }}
        items={[
          { id: 'recipes', label: 'Recipes', count: recipes.data?.recipes.length ?? null },
          { id: 'coverage', label: 'Coverage by ATS' },
          { id: 'fills', label: 'Form runs' },
          { id: 'runs', label: 'Recipes and agent over time' },
          { id: 'traces', label: 'Traces' },
          { id: 'accounts', label: 'Accounts' },
        ]}
      />
    </div>
  );

  const missing = (what: string, by = 'The form engine and the browser agent add them.') => (
    <NotSetUp title={`${what} aren't in this build yet`}>{by} Until then, applications that need a form wait in the pipeline at Written.</NotSetUp>
  );
  const skeleton = <div className="skeleton" style={{ height: 300 }} />;

  let body: React.ReactNode = null;
  if (tab === 'recipes') {
    if (recipes.isLoading) body = skeleton;
    else if (recipes.data === null) body = missing('Recipes');
    else {
      const all = recipes.data?.recipes ?? [];
      const list = all.filter((r) => (!ats || r.ats === ats) && (!status || r.status === status));
      const atsList = [...new Set(all.map((r) => r.ats))].sort();
      body = (
        <>
          <div className="toolbar">
            <select className="select" style={{ width: 'auto' }} value={ats} onChange={(e) => setAts(e.target.value)} aria-label="ATS">
              <option value="">Every ATS</option>
              {atsList.map((a) => (
                <option key={a} value={a}>
                  {atsLabel(a)}
                </option>
              ))}
            </select>
            <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              {Object.entries(RECIPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {list.length ? (
            <section className="card table-wrap">
              <table className="table" data-testid="recipes">
                <thead>
                  <tr>
                    <th>ATS</th>
                    <th>Covers</th>
                    <th>Status</th>
                    <th className="num">Worked</th>
                    <th className="num hide-phone">Failed</th>
                    <th className="num hide-phone">Version</th>
                    <th className="hide-phone">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} onClick={() => setParam('recipe', r.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600 }}>{atsLabel(r.ats)}</td>
                      <td style={{ overflowWrap: 'anywhere' }}>{r.scope === 'ats' ? SCOPE_LABEL.ats : r.scopeKey}</td>
                      <td>
                        <span className={`tag ${RECIPE_TONE[r.status] ?? ''}`}>{RECIPE_LABEL[r.status] ?? r.status}</span>
                      </td>
                      <td className="num">{r.successes}</td>
                      <td className="num hide-phone">{r.failures}</td>
                      <td className="num hide-phone">{r.version}</td>
                      <td className="muted hide-phone">{ago(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <div className="card">
              <div className="empty">
                <h3>{all.length ? 'No recipes match' : 'No recipes yet'}</h3>
                <p>{all.length ? 'Try another ATS or status.' : "The first one appears after Bureau fills a form it hasn't seen and every field checks out."}</p>
              </div>
            </div>
          )}
        </>
      );
    }
  } else if (tab === 'coverage') {
    if (summary.isLoading || recipes.isLoading) body = skeleton;
    else if (summary.data === null || !summary.data) body = missing('Coverage figures', 'The form engine adds them.');
    else body = <Coverage summary={summary.data} recipes={recipes.data?.recipes ?? []} />;
  } else if (tab === 'fills') {
    if (fills.isLoading) body = skeleton;
    else if (fills.data === null) body = missing('Form runs', 'The form engine adds them.');
    else
      body = (
        <>
          {jobFilter ? (
            <div className="row" style={{ marginBottom: 'var(--s-3)', fontSize: 'var(--t-sm)' }}>
              <span className="muted">Runs for one job.</span>
              <a href={`#/pipeline?job=${encodeURIComponent(jobFilter)}`}>
                Open the job <ExternalLink size={11} />
              </a>
              <span className="spacer" />
              <Btn size="sm" variant="ghost" onClick={() => setParam('job', null)}>
                Show every run
              </Btn>
            </div>
          ) : null}
          <FillsList runs={fills.data?.runs ?? []} jobFilter={jobFilter} />
        </>
      );
  } else if (tab === 'runs') {
    if (metrics.isLoading) body = <div className="skeleton" style={{ height: 220 }} />;
    else if (metrics.data === null) body = missing('Learning figures', 'The browser agent adds them.');
    else
      body = (
        <section className="card card-pad">
          <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
            Forms filled per day, last 30 days
          </h2>
          <RunsChart m={metrics.data!} />
        </section>
      );
  } else if (tab === 'traces') {
    if (traces.isLoading) body = skeleton;
    else if (traces.data === null) body = missing('Traces', 'The browser agent adds them.');
    else
      body = traces.data?.traces.length ? (
        <section className="list">
          {traces.data.traces.map((t) => (
            <button key={t.id} className="list-row" onClick={() => setParam('trace', t.id)}>
              <div style={{ minWidth: 0 }}>
                <div className="title">{t.url.replace(/^https?:\/\//, '').slice(0, 70)}</div>
                <div className="meta">
                  <span>{t.ats ? atsLabel(t.ats) : 'Unknown form'}</span>
                  <span>{t.steps} steps</span>
                  <span>{t.origin === 'internal' ? 'Bureau' : 'Outside agent'}</span>
                  <span>{ago(t.createdAt)}</span>
                </div>
              </div>
              <span className={`tag ${t.outcome === 'verified' || t.outcome === 'submitted' ? 'olive' : 'crimson'}`}>{plain(t.outcome)}</span>
            </button>
          ))}
        </section>
      ) : (
        <div className="card">
          <div className="empty">
            <h3>No traces yet</h3>
            <p>Each time the browser agent fills a form, every step is recorded here with a screenshot before and after.</p>
          </div>
        </div>
      );
  } else {
    body = <Accounts />;
  }

  return (
    <>
      {head}
      {tabs}
      {body}
      {recipeId ? <RecipeDrawer id={recipeId} all={recipes.data?.recipes ?? []} onClose={() => setParam('recipe', null)} /> : null}
      {runId ? <RunDrawer id={runId} onClose={() => setParam('run', null)} /> : null}
      {traceId ? <TraceDrawer id={traceId} onClose={() => setParam('trace', null)} /> : null}
    </>
  );
}
