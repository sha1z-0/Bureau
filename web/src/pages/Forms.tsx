import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, X } from 'lucide-react';
import { optional, post, type AgentMetrics, type AtsCoverage, type RecipeDetail, type RecipeRow, type TraceDetail, type TraceSummary } from '../api';
import { setParam, useRoute } from '../App';
import { Btn, ago, useToast } from '../ui';
import { Drawer, Facts, NotSetUp, PageHead, Tabs, atsLabel, pct, plain, stamp, usd } from '../kit';

type Tab = 'recipes' | 'coverage' | 'runs' | 'traces';

const RECIPE_TONE: Record<string, string> = { active: 'olive', shadow: 'brass', candidate: '', demoted: 'crimson' };
const RECIPE_LABEL: Record<string, string> = { active: 'Active', shadow: 'Being checked', candidate: 'Candidate', demoted: 'Demoted' };
const SCOPE_LABEL: Record<string, string> = { ats: 'Every company on it', company: 'One company', url: 'One page' };

function RecipeDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['forms', 'recipe', id], queryFn: () => optional<RecipeDetail>(`/api/forms/recipes/${id}`) });
  const act = useMutation({
    mutationFn: (a: 'promote' | 'demote') => post(`/api/forms/recipes/${id}/${a}`),
    onSuccess: (_r, a) => {
      toast.success(a === 'promote' ? 'Recipe promoted. It runs first from now on.' : 'Recipe demoted. Forms like this go to the adapter or the agent.');
      qc.invalidateQueries({ queryKey: ['forms'] });
    },
    onError: toast.error,
  });
  const r = data?.recipe;
  return (
    <Drawer
      title={r ? `${atsLabel(r.ats)} recipe, version ${r.version}` : 'Recipe'}
      onClose={onClose}
      actions={
        r ? (
          <>
            {r.status !== 'active' ? (
              <Btn size="sm" busy={act.isPending && act.variables === 'promote'} onClick={() => act.mutate('promote')}>
                <ArrowUp /> Promote
              </Btn>
            ) : null}
            {r.status !== 'demoted' ? (
              <Btn size="sm" variant="ghost" busy={act.isPending && act.variables === 'demote'} onClick={() => act.mutate('demote')}>
                <ArrowDown /> Demote
              </Btn>
            ) : null}
          </>
        ) : null
      }
    >
      {!data ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : r ? (
        <div className="tl">
          <section>
            <Facts
              rows={[
                ['Status', <span className={`tag ${RECIPE_TONE[r.status] ?? ''}`}>{RECIPE_LABEL[r.status] ?? r.status}</span>],
                ['Covers', `${SCOPE_LABEL[r.scope] ?? r.scope}${r.scope === 'ats' ? '' : `: ${r.scopeKey}`}`],
                ['Worked', `${r.successes} times`],
                ['Failed', `${r.failures} times`],
                ['URL pattern', r.match?.urlPattern ?? ''],
                ['Updated', ago(r.updatedAt)],
              ]}
            />
          </section>
          <section>
            <div className="section-head">
              <h3>Steps</h3>
            </div>
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
                        <code style={{ fontSize: '0.75rem' }}>{s.selectors[0] ?? ''}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {data.versions.length ? (
            <section>
              <div className="section-head">
                <h3>Version history</h3>
              </div>
              <table className="table">
                <tbody>
                  {data.versions.map((v) => (
                    <tr key={v.version}>
                      <td className="num">v{v.version}</td>
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

export default function Forms() {
  const [, params] = useRoute();
  const tab = (params.get('tab') as Tab) || 'recipes';
  const recipeId = params.get('recipe');
  const traceId = params.get('trace');
  const [ats, setAts] = useState('');
  const [status, setStatus] = useState('');
  const recipes = useQuery({ queryKey: ['forms', 'recipes'], queryFn: () => optional<{ recipes: RecipeRow[] }>('/api/forms/recipes') });
  const coverage = useQuery({ queryKey: ['forms', 'coverage'], queryFn: () => optional<{ ats: AtsCoverage[] }>('/api/forms/coverage'), enabled: tab === 'coverage' });
  const metrics = useQuery({ queryKey: ['forms', 'metrics'], queryFn: () => optional<AgentMetrics>('/api/agent/metrics?days=30'), enabled: tab === 'runs' || tab === 'coverage' });
  const traces = useQuery({ queryKey: ['forms', 'traces'], queryFn: () => optional<{ traces: TraceSummary[] }>('/api/agent/traces?limit=100'), enabled: tab === 'traces' });

  const head = <PageHead title="Forms" lede="Every employer form Bureau has learned. Known forms run from recipes; new ones go to the browser agent, and what it does becomes a recipe after three matching checks." />;
  const tabs = (
    <div style={{ marginBottom: 'var(--s-4)', overflowX: 'auto' }}>
      <Tabs<Tab>
        label="Forms sections"
        value={tab}
        onChange={(t) => setParam('tab', t === 'recipes' ? null : t)}
        items={[
          { id: 'recipes', label: 'Recipes', count: recipes.data?.recipes.length ?? null },
          { id: 'coverage', label: 'Coverage by ATS' },
          { id: 'runs', label: 'Recipes and agent over time' },
          { id: 'traces', label: 'Traces' },
        ]}
      />
    </div>
  );

  const missing = (what: string) => <NotSetUp title={`${what} aren't in this build yet`}>The form engine and the browser agent add them. Until then, applications that need a form wait in the pipeline at Written.</NotSetUp>;

  let body: React.ReactNode = null;
  if (tab === 'recipes') {
    if (recipes.isLoading) body = <div className="skeleton" style={{ height: 300 }} />;
    else if (recipes.data === null) body = missing('Recipes');
    else {
      const list = (recipes.data?.recipes ?? []).filter((r) => (!ats || r.ats === ats) && (!status || r.status === status));
      const atsList = [...new Set((recipes.data?.recipes ?? []).map((r) => r.ats))].sort();
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
              <table className="table">
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
                      <td>{r.scope === 'ats' ? SCOPE_LABEL.ats : r.scopeKey}</td>
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
                <h3>No recipes yet</h3>
                <p>The first one appears after Bureau fills a form it hasn't seen and checks it three times.</p>
              </div>
            </div>
          )}
        </>
      );
    }
  } else if (tab === 'coverage') {
    if (coverage.isLoading) body = <div className="skeleton" style={{ height: 300 }} />;
    else if (coverage.data === null) body = missing('Coverage figures');
    else
      body = (
        <section className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ATS</th>
                <th className="num">Recipes</th>
                <th className="num">Active</th>
                <th className="num">Forms filled</th>
                <th className="num hide-phone">Verified</th>
                <th className="num hide-phone">Sent</th>
                <th className="num">Success</th>
              </tr>
            </thead>
            <tbody>
              {(coverage.data?.ats ?? []).map((c) => (
                <tr key={c.ats}>
                  <td style={{ fontWeight: 600 }}>{atsLabel(c.ats)}</td>
                  <td className="num">{c.recipes}</td>
                  <td className="num">{c.active}</td>
                  <td className="num">{c.runs}</td>
                  <td className="num hide-phone">{c.verified}</td>
                  <td className="num hide-phone">{c.submitted}</td>
                  <td className="num">{pct(c.successRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!coverage.data?.ats.length ? <p className="muted" style={{ padding: 'var(--s-5)' }}>No forms filled yet.</p> : null}
        </section>
      );
  } else if (tab === 'runs') {
    if (metrics.isLoading) body = <div className="skeleton" style={{ height: 220 }} />;
    else if (metrics.data === null) body = missing('Learning figures');
    else
      body = (
        <section className="card card-pad">
          <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
            Forms filled per day, last 30 days
          </h2>
          <RunsChart m={metrics.data!} />
        </section>
      );
  } else {
    if (traces.isLoading) body = <div className="skeleton" style={{ height: 300 }} />;
    else if (traces.data === null) body = missing('Traces');
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
  }

  return (
    <>
      {head}
      {tabs}
      {body}
      {recipeId ? <RecipeDrawer id={recipeId} onClose={() => setParam('recipe', null)} /> : null}
      {traceId ? <TraceDrawer id={traceId} onClose={() => setParam('trace', null)} /> : null}
    </>
  );
}
