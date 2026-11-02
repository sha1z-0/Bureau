import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { API_SCOPES, del, optional, post, put, type ApiKeyInfo, type ApiScope, type AuditEntry, type ConnectInfo, type RateLimits } from '../api';
import { Btn, Field, Modal, ago, useToast } from '../ui';
import { CopyButton, NotSetUp, PageHead, Tabs, stamp } from '../kit';

const SCOPE_LINE: Record<ApiScope, string> = {
  'jobs:read': 'See the jobs ready to apply to',
  'packets:read': 'Download the CV, letter and prepared answers for a job',
  'answers:read': 'Ask for the answer to any form question',
  'recipes:read': 'Fetch a learned form recipe',
  'traces:write': 'Report what it did on a form, so Bureau can learn it',
  'applications:write': 'Claim a job and mark it sent (with proof) or failed',
};

interface KeysData {
  keys: ApiKeyInfo[];
  scopes: ApiScope[];
  limits: RateLimits;
}

function CreateKey({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['jobs:read', 'packets:read', 'answers:read', 'recipes:read']);
  const [created, setCreated] = useState<{ key: string; info: ApiKeyInfo } | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ key: string; info: ApiKeyInfo }>('/api/agent-keys', { name: name.trim(), scopes }),
    onSuccess: (r) => {
      setCreated(r);
      qc.invalidateQueries({ queryKey: ['agent-keys'] });
    },
    onError: toast.error,
  });
  if (created) {
    return (
      <Modal title="Your new key" onClose={onClose} footer={<Btn variant="primary" onClick={onClose}>I've stored it</Btn>}>
        <p style={{ margin: 0 }}>Copy it now. Bureau keeps only a hash, so this is the only time it can be shown.</p>
        <code style={{ display: 'block', padding: '10px 12px', overflowWrap: 'anywhere', fontSize: 'var(--t-sm)' }} data-testid="new-key">
          {created.key}
        </code>
        <div>
          <CopyButton text={created.key} label="Copy the key" />
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title="Create an API key"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" busy={create.isPending} disabled={!name.trim() || !scopes.length} onClick={() => create.mutate()}>
            Create key
          </Btn>
        </>
      }
    >
      <Field label="Name" help="Which agent will use it, e.g. Muse or Claude in Chrome.">
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="What it may do">
        <div className="stack" style={{ gap: 6 }}>
          {API_SCOPES.map((s) => (
            <label key={s} className="row" style={{ gap: 10, fontSize: 'var(--t-sm)', cursor: 'pointer' }}>
              <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
              <span>
                <code>{s}</code> {SCOPE_LINE[s]}
              </span>
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function Snippets({ info }: { info: ConnectInfo }) {
  const [tab, setTab] = useState<'desktop' | 'code' | 'generic'>('desktop');
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const blocks: Record<typeof tab, { title: string; text: string }[]> = {
    desktop: [{ title: 'Add to claude_desktop_config.json', text: json(info.snippets.claudeDesktop) }],
    code: [
      { title: 'Over HTTP (Bureau must be running)', text: info.snippets.claudeCodeHttp },
      { title: 'Over stdio', text: info.snippets.claudeCodeStdio },
    ],
    generic: [
      { title: 'Streamable HTTP', text: json(info.snippets.genericHttp) },
      { title: 'stdio', text: json(info.snippets.genericStdio) },
    ],
  };
  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      <Tabs
        label="MCP client"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'desktop', label: 'Claude Desktop' },
          { id: 'code', label: 'Claude Code' },
          { id: 'generic', label: 'Other clients' },
        ]}
      />
      {blocks[tab].map((b) => (
        <div key={b.title} className="stack" style={{ gap: 6 }}>
          <div className="row">
            <span className="label">{b.title}</span>
            <span className="spacer" />
            <CopyButton size="sm" text={b.text} />
          </div>
          <pre className="console" style={{ maxHeight: 260, margin: 0 }}>
            {b.text}
          </pre>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 'var(--t-xs)' }}>
        Replace &lt;YOUR_KEY&gt; with a key from the list above. REST lives at <code>{info.restBase}</code>, MCP at <code>{info.mcpUrl}</code>.
      </p>
    </div>
  );
}

function auditDetail(d: AuditEntry['detail']): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(', ').slice(0, 160);
}

export default function Agents() {
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const keys = useQuery({ queryKey: ['agent-keys'], queryFn: () => optional<KeysData>('/api/agent-keys') });
  const audit = useQuery({
    queryKey: ['agent-keys', 'audit', filter],
    queryFn: () => optional<{ entries: AuditEntry[]; total: number }>(`/api/agent-keys/audit?limit=100${filter ? `&keyId=${encodeURIComponent(filter)}` : ''}`),
    enabled: keys.data !== null,
  });
  const connect = useQuery({ queryKey: ['agent-keys', 'connect'], queryFn: () => optional<ConnectInfo>('/api/agent-keys/connect'), enabled: keys.data !== null });
  const [limits, setLimits] = useState<RateLimits | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/api/agent-keys/${id}`),
    onSuccess: () => {
      toast.success('Key revoked. Calls with it now fail.');
      qc.invalidateQueries({ queryKey: ['agent-keys'] });
    },
    onError: toast.error,
  });
  const saveLimits = useMutation({
    mutationFn: () => put('/api/agent-keys/limits', { perMinute: limits!.perMinute, aiPerHour: limits!.aiPerHour }),
    onSuccess: () => {
      toast.success('Limits saved.');
      setLimits(null);
      qc.invalidateQueries({ queryKey: ['agent-keys'] });
    },
    onError: toast.error,
  });

  const head = (
    <PageHead
      title="Agents and API"
      lede="Other agents, such as Muse or Claude in Chrome, can use Bureau: find jobs, pull an application packet, ask for form answers, report what they learned and mark jobs sent with proof."
      actions={
        keys.data ? (
          <Btn onClick={() => setCreating(true)}>
            <Plus /> Create a key
          </Btn>
        ) : null
      }
    />
  );
  if (keys.isLoading)
    return (
      <>
        {head}
        <div className="skeleton" style={{ height: 300 }} />
      </>
    );
  if (keys.data === null)
    return (
      <>
        {head}
        <NotSetUp title="The agent API isn't in this build yet">Once it is, keys, the audit log and MCP connection snippets appear here.</NotSetUp>
      </>
    );
  const d = keys.data!;
  const l = limits ?? d.limits;
  return (
    <>
      {head}
      <div className="split">
        <div className="grid">
          <section className="card">
            <div className="card-head">
              <h2>Keys</h2>
              <span className="muted num">{d.keys.filter((k) => !k.revokedAt).length} active</span>
            </div>
            {d.keys.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Can</th>
                      <th>Last used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.keys.map((k) => (
                      <tr key={k.id} style={k.revokedAt ? { color: 'var(--text-3)' } : undefined}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{k.name}</div>
                          <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                            <code>bur_{k.prefix}_</code> created {ago(k.createdAt)}
                          </div>
                        </td>
                        <td>
                          <div className="chips">
                            {k.scopes.map((s) => (
                              <span key={s} className="tag" title={SCOPE_LINE[s]}>
                                {s}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="muted">{k.revokedAt ? `Revoked ${ago(k.revokedAt)}` : k.lastUsedAt ? ago(k.lastUsedAt) : 'Never'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {k.revokedAt ? null : (
                            <Btn size="sm" variant="ghost" className="danger" onClick={() => confirm(`Revoke ${k.name}? Agents using it stop working at once.`) && revoke.mutate(k.id)}>
                              Revoke
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h3>No keys yet</h3>
                <p>Create one for each agent, with only the abilities it needs. The full key is shown once.</p>
                <Btn onClick={() => setCreating(true)}>
                  <KeyRound /> Create a key
                </Btn>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Audit log</h2>
              <select className="select" style={{ width: 'auto', minHeight: 30, padding: '2px 8px', fontSize: 'var(--t-xs)' }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by key">
                <option value="">Every key</option>
                {d.keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
            {audit.data?.entries.length ? (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {audit.data.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                          {stamp(e.ts)}
                        </td>
                        <td>
                          <div>
                            <code>{e.route}</code>
                          </div>
                          <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                            {e.keyName ?? 'Unknown key'}
                            {auditDetail(e.detail) ? `: ${auditDetail(e.detail)}` : ''}
                          </div>
                        </td>
                        <td className="num">
                          <span className={`tag ${e.status >= 400 ? 'crimson' : 'olive'}`}>{e.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
                Every call an agent makes is recorded here, failures included. Keys, answers and images are never stored in it.
              </p>
            )}
          </section>
        </div>

        <div className="grid">
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
              Connect an MCP client
            </h2>
            {connect.data ? <Snippets info={connect.data} /> : <div className="skeleton" style={{ height: 200 }} />}
          </section>
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
              How an agent applies
            </h2>
            <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
              Claim the job, pull the packet, open the employer's form, ask Bureau for each answer, upload the files, check every field, submit, then report the trace and mark the job sent with a screenshot. The step-by-step guide with curl examples is in <code>{connect.data?.docs ?? 'docs/AGENT_API.md'}</code> in the Bureau folder.
            </p>
          </section>
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
              Limits
            </h2>
            <div className="form-grid">
              <Field label="Calls a minute, per key">
                <input className="input" type="number" min={1} value={l.perMinute} onChange={(e) => setLimits({ ...l, perMinute: Number(e.target.value) })} />
              </Field>
              <Field label="Writing calls an hour, per key" help="Calls that make Bureau write with Claude.">
                <input className="input" type="number" min={0} value={l.aiPerHour} onChange={(e) => setLimits({ ...l, aiPerHour: Number(e.target.value) })} />
              </Field>
            </div>
            {limits ? (
              <div className="row" style={{ marginTop: 'var(--s-3)' }}>
                <Btn busy={saveLimits.isPending} onClick={() => saveLimits.mutate()}>
                  Save limits
                </Btn>
                <Btn variant="ghost" onClick={() => setLimits(null)}>
                  Cancel
                </Btn>
              </div>
            ) : null}
          </section>
        </div>
      </div>
      {creating ? <CreateKey onClose={() => setCreating(false)} /> : null}
    </>
  );
}
