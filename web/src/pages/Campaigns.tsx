import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pause, Pencil, Play, Plus, RotateCcw, Trash2, Zap } from 'lucide-react';
import { api, del, post, put, CATEGORY_LABEL, type AutopilotStatus, type Campaign, type CampaignConfig, type Category, type StepRow, type StretchLevel } from '../api';
import { go, KillSwitch, setParam, useRoute, useShell } from '../App';
import { Btn, Empty, Field, ListInput, Switch, ago, useToast } from '../ui';
import { CAMPAIGN_LABEL, Facts, Meter, ScreenHint, PageHead, STATE_LABEL, Stat, clock, day, plain, stamp, until, usd } from '../kit';

export interface CampaignList {
  campaigns: Campaign[];
  status: AutopilotStatus;
}

export function useCampaigns() {
  return useQuery({ queryKey: ['campaigns'], queryFn: () => api<CampaignList>('/api/campaigns'), refetchInterval: 20_000 });
}

const STRETCH: { id: StretchLevel; label: string; line: string }[] = [
  { id: 'conservative', label: 'Conservative', line: 'Apply when you meet nearly everything. One unmet important requirement is allowed.' },
  { id: 'balanced', label: 'Balanced', line: 'Up to three unmet important requirements. Nice-to-haves barely count.' },
  { id: 'aggressive', label: 'Aggressive', line: 'Cast wide on inflated entry-level lists. Up to five unmet important requirements.' },
];

const STATUS_TONE: Record<string, string> = { active: 'olive', paused: 'brass', draft: '', ended: '' };

export function CampaignTag({ c }: { c: Pick<Campaign, 'status'> & { stats?: Campaign['stats'] } }) {
  const rehearsing = c.status === 'active' && c.stats?.dryRun.active;
  return <span className={`tag ${STATUS_TONE[c.status] ?? ''}`}>{rehearsing ? 'Rehearsing' : (CAMPAIGN_LABEL[c.status] ?? c.status)}</span>;
}

function useCampaignAction() {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'pause' | 'resume' | 'end' }) => post<Campaign>(`/api/campaigns/${id}/${action}`),
    onSuccess: (c, v) => {
      qc.invalidateQueries();
      const msg = { start: `${c.name} has started.`, pause: `${c.name} is paused.`, resume: `${c.name} is running again.`, end: `${c.name} has ended. The final digest is in Digests.` }[v.action];
      toast.success(msg);
    },
    onError: toast.error,
  });
}

/** The hunt status line in words. */
function statusLine(focus: Campaign | null, status: AutopilotStatus, current: { title: string | null; company: string | null } | null): string {
  if (status.kill) return 'Everything is stopped.';
  if (!focus) return 'No campaign is running.';
  if (focus.status === 'draft') return `${focus.name} is ready to start.`;
  if (focus.status === 'paused') return `${focus.name} is paused.`;
  if (focus.status === 'ended') return 'No campaign is running.';
  if (current) return `Applying to ${current.title ?? 'a role'}${current.company ? ` at ${current.company}` : ''}.`;
  const st = focus.stats;
  const verb = st.dryRun.active ? 'Rehearsing' : 'Live';
  if (st.today.room <= 0 && st.today.cap > 0) return `${verb}. Today's ${st.today.cap} are done.`;
  if (!st.activeHours.open) return `${verb}. Resting until ${clock(st.activeHours.nextOpenAt)}.`;
  if (st.nextApplyAt) return `${verb}. Next application ${until(st.nextApplyAt)}.`;
  return `${verb}. Looking for the next role.`;
}

function lede(c: Campaign): string {
  const cfg = c.config;
  const roles = cfg.roles.length ? cfg.roles.slice(0, 3).join(', ') + (cfg.roles.length > 3 ? ` and ${cfg.roles.length - 3} more` : '') : 'every role in your categories';
  const where = cfg.remoteOnly ? 'remote only' : cfg.locations.length ? cfg.locations.slice(0, 3).join(', ') : 'anywhere';
  return `${roles}, ${where}. Applies when the chance of passing the screen is ${cfg.minScore} or more (${cfg.stretchLevel}), up to ${cfg.dailyCap} a day between ${cfg.activeHours.start} and ${cfg.activeHours.end} ${cfg.activeHours.tz}.`;
}

/** The one bold element: the sash runs across while a campaign is live. */
export function CampaignBand({ compact }: { compact?: boolean }) {
  const { data } = useCampaigns();
  const shell = useShell();
  const action = useCampaignAction();
  const toast = useToast();
  const qc = useQueryClient();
  const runNow = useMutation({
    mutationFn: () => post('/api/campaigns/run-now'),
    onSuccess: () => {
      toast.info('Scouting now, and the next application skips the wait.');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: toast.error,
  });
  const clearKill = useMutation({
    mutationFn: () => del('/api/kill'),
    onSuccess: () => {
      toast.success('Kill switch cleared. Resume a campaign to carry on.');
      qc.invalidateQueries();
    },
    onError: toast.error,
  });
  if (!data) return <div className="skeleton" style={{ height: 220, marginBottom: 'var(--s-4)' }} />;
  const { campaigns, status } = data;
  const focus = campaigns.find((c) => c.status === 'active') ?? campaigns.find((c) => c.status === 'paused') ?? campaigns.find((c) => c.status === 'draft') ?? null;
  const live = !!focus && focus.status === 'active' && !status.kill;
  const current = shell.data?.current ?? null;
  const title = statusLine(focus, status, current && live ? current : null);

  if (!focus && !status.kill) {
    return (
      <section className="hunt" aria-live="polite">
        <div className="hunt-main">
          <div style={{ minWidth: 0 }}>
            <h2 className="hunt-title">No campaign yet.</h2>
            <p className="hunt-lede">A campaign tells Bureau what to look for, how picky to be, how many to send a day and when to stop. It rehearses first, then goes live on its own.</p>
          </div>
          <a className="btn primary" href="#/campaigns?new=1">
            <Plus /> New campaign
          </a>
        </div>
      </section>
    );
  }

  const st = focus?.stats;
  return (
    <section className={`hunt ${live ? 'on' : ''}`} aria-live="polite" data-testid="campaign-band">
      <div className="hunt-main">
        <div style={{ minWidth: 0 }}>
          <h2 className="hunt-title" data-testid="status-line">
            {title}
          </h2>
          <p className="hunt-lede">
            {status.kill
              ? `${status.kill.reason}. Stopped ${ago(status.kill.at)}. ${status.stopFile ? 'Delete data/STOP to clear it.' : 'Campaigns stay paused until you resume one.'}`
              : focus
                ? lede(focus)
                : null}
          </p>
        </div>
        <div className="band-actions">
          {status.kill ? (
            status.stopFile ? null : (
              <Btn busy={clearKill.isPending} onClick={() => clearKill.mutate()}>
                <RotateCcw /> Clear the kill switch
              </Btn>
            )
          ) : focus?.status === 'active' ? (
            <>
              <Btn onClick={() => action.mutate({ id: focus.id, action: 'pause' })} busy={action.isPending}>
                <Pause /> Pause
              </Btn>
              <KillSwitch />
            </>
          ) : focus?.status === 'paused' ? (
            <Btn variant="primary" onClick={() => action.mutate({ id: focus.id, action: 'resume' })} busy={action.isPending}>
              <Play /> Resume
            </Btn>
          ) : focus?.status === 'draft' ? (
            <Btn variant="primary" onClick={() => action.mutate({ id: focus.id, action: 'start' })} busy={action.isPending} data-testid="band-start">
              <Play /> Start
            </Btn>
          ) : null}
        </div>
      </div>
      {focus && st && !compact ? (
        <div className="band-stats">
          <Stat label="Today" value={`${st.today.done} of ${st.today.cap}`} sub={st.dryRun.active ? `${st.today.rehearsed} rehearsed` : `${st.today.submitted} sent, ${st.today.rehearsed} rehearsed`} href={`#/campaigns?id=${focus.id}`} />
          <Stat
            label="Next"
            value={live ? (current ? 'Applying now' : st.nextApplyAt ? until(st.nextApplyAt) : st.activeHours.open ? 'Looking' : clock(st.activeHours.nextOpenAt)) : '–'}
            sub={st.nextScoutAt ? `Scout ${st.nextScoutAt === 'soon' ? 'soon' : until(st.nextScoutAt)}` : undefined}
          />
          <Stat
            label="Mode"
            value={st.dryRun.active ? `Rehearsal, day ${Math.min(st.dryRun.day, Math.max(1, st.dryRun.days))}` : 'Live'}
            sub={st.dryRun.active ? (st.dryRun.rehearseOnly ? 'Rehearses only' : `Live ${st.dryRun.liveAt ? day(st.dryRun.liveAt) : 'soon'}`) : st.dryRun.liveSince ? `Since ${day(st.dryRun.liveSince)}` : undefined}
          />
          <Meter label="Budget" value={st.spend.campaignUsd} max={st.spend.budgetUsd} format={usd} />
        </div>
      ) : null}
      {live && !compact ? (
        <div className="hunt-ready" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', alignItems: 'center' }}>
          <span>{campaigns.filter((c) => c.status === 'active').length > 1 ? `${campaigns.filter((c) => c.status === 'active').length} campaigns are live.` : `${focus!.name} runs until ${day(focus!.endsAt)}.`}</span>
          <span className="spacer" />
          <Btn size="sm" busy={runNow.isPending} onClick={() => runNow.mutate()}>
            <Zap /> Run now
          </Btn>
          <a className="btn sm ghost" href={`#/campaigns?id=${focus!.id}`}>
            Open the campaign
          </a>
        </div>
      ) : null}
      {current && live ? <div className="hunt-progress" aria-hidden="true" /> : null}
    </section>
  );
}

// ── Editor ───────────────────────────────────────────────────────────

const CATS = Object.keys(CATEGORY_LABEL) as Category[];

const toDateInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fromDateInput = (v: string, end: boolean) => new Date(`${v}T${end ? '23:59:00' : '00:00:00'}`).toISOString();

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

interface SourcesLite {
  connectors: { id: string; label: string; enabled: boolean }[];
}

function SourceOverrides({ value, onChange }: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['sources'], queryFn: () => api<SourcesLite>('/api/sources'), enabled: open });
  const n = Object.keys(value).length;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <span style={{ fontSize: 'var(--t-sm)' }}>{n ? `${n} source${n === 1 ? '' : 's'} set differently from Sources.` : 'Uses the sources switched on in Sources.'}</span>
        <span className="spacer" />
        <Btn size="sm" variant="ghost" type="button" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Choose sources'}
        </Btn>
      </div>
      {open ? (
        data ? (
          <div className="list" style={{ background: 'var(--bg)', maxHeight: 340, overflow: 'auto' }}>
            {data.connectors.map((c) => {
              const v = value[c.id];
              return (
                <div key={c.id} className="list-row static" style={{ padding: '8px var(--s-4)' }}>
                  <span style={{ fontSize: 'var(--t-sm)' }}>{c.label}</span>
                  <select
                    className="select"
                    style={{ minHeight: 30, padding: '2px 8px', fontSize: 'var(--t-xs)', width: 'auto' }}
                    value={v === undefined ? 'default' : v ? 'on' : 'off'}
                    aria-label={`${c.label} for this campaign`}
                    onChange={(e) => {
                      const next = { ...value };
                      if (e.target.value === 'default') delete next[c.id];
                      else next[c.id] = e.target.value === 'on';
                      onChange(next);
                    }}
                  >
                    <option value="default">As in Sources ({c.enabled ? 'on' : 'off'})</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="skeleton" style={{ height: 120 }} />
        )
      ) : null}
    </div>
  );
}

export function CampaignEditor({ campaign, onDone, onCancel, startLabel = 'Save and start' }: { campaign?: Campaign; onDone: (c: Campaign) => void; onCancel?: () => void; startLabel?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const defaults = useQuery({ queryKey: ['campaigns', 'defaults'], queryFn: () => api<{ name: string; config: CampaignConfig }>('/api/campaigns/defaults'), enabled: !campaign });
  const [name, setName] = useState(campaign?.name ?? '');
  const [cfg, setCfg] = useState<CampaignConfig | null>(campaign?.config ?? null);
  useEffect(() => {
    if (!cfg && defaults.data) {
      setCfg({ ...defaults.data.config, followUpDays: defaults.data.config.followUpDays ?? 7, onUnknownQuestion: defaults.data.config.onUnknownQuestion ?? 'skip', maxAgeDays: defaults.data.config.maxAgeDays ?? 14, scoutEveryHours: defaults.data.config.scoutEveryHours ?? 3 });
      if (!name) setName(defaults.data.name);
    }
  }, [defaults.data, cfg, name]);
  const tzList = useMemo(zones, []);

  const save = useMutation({
    mutationFn: async (start: boolean) => {
      if (campaign) {
        const c = await put<Campaign>(`/api/campaigns/${campaign.id}`, { name, config: cfg });
        return start && (c.status === 'draft' || c.status === 'paused') ? post<Campaign>(`/api/campaigns/${c.id}/${c.status === 'draft' ? 'start' : 'resume'}`) : c;
      }
      return post<Campaign>('/api/campaigns', { name, config: cfg, start });
    },
    onSuccess: (c, start) => {
      qc.invalidateQueries();
      toast.success(start ? `${c.name} has started${c.stats.dryRun.active ? ' in rehearsal' : ''}.` : `${c.name} is saved.`);
      onDone(c);
    },
    onError: toast.error,
  });

  if (!cfg) return <div className="skeleton" style={{ height: 480 }} />;
  const set = <K extends keyof CampaignConfig>(k: K, v: CampaignConfig[K]) => setCfg({ ...cfg, [k]: v });
  const problems = [
    !name.trim() && 'Give the campaign a name.',
    Date.parse(cfg.endsAt) <= Date.parse(cfg.startsAt) && 'The end date must come after the start date.',
    cfg.pacingMinutes.min > cfg.pacingMinutes.max && 'The shortest gap between applications is longer than the longest.',
    !cfg.channels.email && !cfg.channels.forms && 'Switch on at least one way to apply.',
  ].filter(Boolean) as string[];
  const ended = campaign?.status === 'ended';

  return (
    <form
      className="stack"
      style={{ gap: 'var(--s-4)' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!problems.length) save.mutate(false);
      }}
    >
      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
          The campaign
        </h2>
        <div className="form-grid">
          <Field label="Name" full>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Backend roles, November" data-testid="campaign-name" />
          </Field>
          <Field label="Starts">
            <input className="input" type="date" value={toDateInput(cfg.startsAt)} onChange={(e) => e.target.value && set('startsAt', fromDateInput(e.target.value, false))} />
          </Field>
          <Field label="Ends" help="It stops by itself on this day and sends a final digest.">
            <input className="input" type="date" value={toDateInput(cfg.endsAt)} onChange={(e) => e.target.value && set('endsAt', fromDateInput(e.target.value, true))} />
          </Field>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
          What to look for
        </h2>
        <div className="stack" style={{ gap: 'var(--s-4)' }}>
          <Field label="Roles" help="Job titles to search for. Leave empty to take every role in the categories below.">
            <ListInput value={cfg.roles} onChange={(v) => set('roles', v)} placeholder="e.g. Backend Engineer, Junior Developer" />
          </Field>
          <Field label="Categories">
            <div className="chips">
              {CATS.map((c) => {
                const on = cfg.categories.includes(c);
                return (
                  <button key={c} type="button" className="chip" aria-pressed={on} onClick={() => set('categories', on ? cfg.categories.filter((x) => x !== c) : [...cfg.categories, c])}>
                    {CATEGORY_LABEL[c]}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Locations">
            <ListInput value={cfg.locations} onChange={(v) => set('locations', v)} placeholder="Remote, Karachi, Berlin…" />
          </Field>
          <div className="toggle-row" style={{ paddingTop: 0 }}>
            <div>
              <strong>Remote only</strong>
              <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>
                Skip anything that needs you in an office.
              </div>
            </div>
            <Switch label="Remote only" checked={cfg.remoteOnly} onChange={(v) => set('remoteOnly', v)} />
          </div>
          <Field label="Ignore postings older than (days)" help="Fresh postings (the first 48 hours) go to the front of the queue anyway.">
            <input className="input" type="number" min={1} max={60} value={cfg.maxAgeDays} onChange={(e) => set('maxAgeDays', Number(e.target.value))} style={{ maxWidth: 160 }} />
          </Field>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-2)' }}>
          How far to stretch
        </h2>
        <p className="muted" style={{ fontSize: 'var(--t-sm)', marginBottom: 'var(--s-4)' }}>
          Entry-level postings list far more than the job needs. Bureau applies anyway when your real experience makes a strong case, and never claims what you don't have. Hard blockers (a licence, clearance, citizenship, a degree required by law) always rule a role out.
        </p>
        <div className="choice-grid" role="radiogroup" aria-label="Stretch level">
          {STRETCH.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={cfg.stretchLevel === s.id} className="choice" onClick={() => set('stretchLevel', s.id)}>
              <strong>{s.label}</strong>
              <span>{s.line}</span>
            </button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 'var(--s-4)' }}>
          <Field
            label="Lowest score to apply"
            help={
              <span>
                The chance of passing the screen, 0 to 100. 60 is a sensible start.{' '}
                <ScreenHint />
              </span>
            }
          >
            <input className="input" type="number" min={0} max={100} value={cfg.minScore} onChange={(e) => set('minScore', Number(e.target.value))} />
          </Field>
          <Field label="If a form asks something you haven't answered">
            <select className="select" value={cfg.onUnknownQuestion} onChange={(e) => set('onUnknownQuestion', e.target.value as CampaignConfig['onUnknownQuestion'])}>
              <option value="skip">Skip the job and ask me (it comes back once I answer)</option>
              <option value="needs_you">Keep the job open for me to finish</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
          Pace
        </h2>
        <div className="form-grid">
          <Field label="Applications a day, at most">
            <input className="input" type="number" min={0} max={200} value={cfg.dailyCap} onChange={(e) => set('dailyCap', Number(e.target.value))} data-testid="campaign-cap" />
          </Field>
          <Field label="Wait before applying to the same company again (days)">
            <input className="input" type="number" min={0} max={365} value={cfg.companyCooldownDays} onChange={(e) => set('companyCooldownDays', Number(e.target.value))} />
          </Field>
          <Field label="Active from">
            <input className="input" type="time" value={cfg.activeHours.start} onChange={(e) => set('activeHours', { ...cfg.activeHours, start: e.target.value })} />
          </Field>
          <Field label="Until">
            <input className="input" type="time" value={cfg.activeHours.end} onChange={(e) => set('activeHours', { ...cfg.activeHours, end: e.target.value })} />
          </Field>
          <Field label="Time zone" full>
            <input className="input" list="tz-list" value={cfg.activeHours.tz} onChange={(e) => set('activeHours', { ...cfg.activeHours, tz: e.target.value })} />
            <datalist id="tz-list">
              {tzList.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <Field label="Gap between applications, shortest (minutes)" help="A random wait in this range keeps the pace human.">
            <input className="input" type="number" min={0} value={cfg.pacingMinutes.min} onChange={(e) => set('pacingMinutes', { ...cfg.pacingMinutes, min: Number(e.target.value) })} />
          </Field>
          <Field label="Longest (minutes)">
            <input className="input" type="number" min={0} value={cfg.pacingMinutes.max} onChange={(e) => set('pacingMinutes', { ...cfg.pacingMinutes, max: Number(e.target.value) })} />
          </Field>
          <Field label="Look for new postings every (hours)">
            <input className="input" type="number" min={1} max={24} value={cfg.scoutEveryHours} onChange={(e) => set('scoutEveryHours', Number(e.target.value))} />
          </Field>
          <Field label="Follow up after (days)" help="One polite note when a hiring contact is known. 0 turns it off.">
            <input className="input" type="number" min={0} max={60} value={cfg.followUpDays} onChange={(e) => set('followUpDays', Number(e.target.value))} />
          </Field>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
          Safety
        </h2>
        <div className="form-grid">
          <Field label="Rehearse for (days)" help="It fills and checks every form without sending, then goes live by itself.">
            <input className="input" type="number" min={0} max={60} value={cfg.dryRunDays} onChange={(e) => set('dryRunDays', Number(e.target.value))} data-testid="campaign-dryrun" />
          </Field>
          <Field label="AI budget for this campaign (USD)" help="It pauses when this is spent. 0 means no campaign limit; the monthly budget in Settings still applies.">
            <input className="input" type="number" min={0} step={1} value={cfg.budgetUsd} onChange={(e) => set('budgetUsd', Number(e.target.value))} />
          </Field>
        </div>
        <div style={{ marginTop: 'var(--s-3)' }}>
          <div className="toggle-row">
            <div>
              <strong>Apply on the employer's own form</strong>
              <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>
                Greenhouse, Lever, Workday and the rest. Checked field by field before it's sent.
              </div>
            </div>
            <Switch label="Forms" checked={cfg.channels.forms} onChange={(v) => set('channels', { ...cfg.channels, forms: v })} />
          </div>
          <div className="toggle-row">
            <div>
              <strong>Apply by email when the posting asks for it</strong>
            </div>
            <Switch label="Email" checked={cfg.channels.email} onChange={(v) => set('channels', { ...cfg.channels, email: v })} />
          </div>
          <div className="toggle-row">
            <div>
              <strong>Let the browser agent learn new forms</strong>
              <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>
                For forms with no recipe yet. It never presses submit itself.
              </div>
            </div>
            <Switch label="Browser agent" checked={cfg.channels.agent} onChange={(v) => set('channels', { ...cfg.channels, agent: v })} />
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="section-title" style={{ marginBottom: 'var(--s-3)' }}>
          Sources
        </h2>
        <SourceOverrides value={cfg.sources} onChange={(v) => set('sources', v)} />
      </section>

      {problems.length ? (
        <div className="callout crimson" role="alert">
          <div>
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="row wrap">
        {onCancel ? (
          <Btn variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </Btn>
        ) : null}
        <span className="spacer" />
        <Btn type="submit" busy={save.isPending && save.variables === false} disabled={!!problems.length || ended} data-testid="campaign-save">
          {campaign ? 'Save changes' : 'Save as draft'}
        </Btn>
        {campaign?.status === 'active' || ended ? null : (
          <Btn variant="primary" type="button" busy={save.isPending && save.variables === true} disabled={!!problems.length} onClick={() => save.mutate(true)} data-testid="campaign-start">
            <Play /> {startLabel}
          </Btn>
        )}
      </div>
    </form>
  );
}

// ── Detail ───────────────────────────────────────────────────────────

const FUNNEL: { states: (keyof typeof STATE_LABEL)[]; label: string }[] = [
  { states: ['found', 'filtered'], label: 'Found' },
  { states: ['scored'], label: 'Scored' },
  { states: ['selected'], label: 'Queued' },
  { states: ['writing', 'written'], label: 'Written' },
  { states: ['filling', 'verified'], label: 'Applying' },
  { states: ['rehearsed'], label: 'Rehearsed' },
  { states: ['submitted'], label: 'Sent' },
  { states: ['needs_you'], label: 'Needs you' },
  { states: ['failed'], label: 'Failed' },
  { states: ['skipped'], label: 'Skipped' },
];

const STEP_LABEL: Record<string, string> = {
  claim: 'Claimed the job',
  write: 'Writer',
  route: 'Chose how to apply',
  fill: 'Filled the form',
  submit_intent: 'About to send',
  submit_done: 'Sent',
  outcome: 'Form result',
  submitted: 'Sent',
  rehearsed: 'Rehearsed',
  skip: 'Skipped',
  requeue: 'Back in the queue',
  release: 'Released the job',
  recover: 'Recovered after a restart',
};

function CampaignDetail({ id }: { id: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const action = useCampaignAction();
  const { data: c, error } = useQuery({ queryKey: ['campaigns', id], queryFn: () => api<Campaign>(`/api/campaigns/${id}`), refetchInterval: 20_000 });
  const steps = useQuery({ queryKey: ['campaigns', id, 'steps'], queryFn: () => api<{ steps: StepRow[] }>(`/api/campaigns/${id}/steps?limit=40`) });
  const [edit, setEdit] = useState(false);
  const remove = useMutation({
    mutationFn: () => del(`/api/campaigns/${id}`),
    onSuccess: () => {
      toast.success('Campaign deleted.');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      go('campaigns');
    },
    onError: toast.error,
  });
  if (error) return <Empty title="Campaign not found" action={<a className="btn" href="#/campaigns">All campaigns</a>} />;
  if (!c) return <div className="skeleton" style={{ height: 400 }} />;
  if (edit) return <CampaignEditor campaign={c} onDone={() => setEdit(false)} onCancel={() => setEdit(false)} startLabel={c.status === 'paused' ? 'Save and resume' : 'Save and start'} />;
  const st = c.stats;
  const max = Math.max(1, ...FUNNEL.map((f) => f.states.reduce((a, s) => a + (st.counts[s] ?? 0), 0)));
  const cfg = c.config;
  return (
    <>
      <header className="page-head">
        <div style={{ minWidth: 0 }}>
          <a href="#/campaigns" className="btn ghost sm" style={{ marginBottom: 'var(--s-2)', paddingLeft: 4 }}>
            <ArrowLeft /> All campaigns
          </a>
          <h1>{c.name}</h1>
          <div className="meta" style={{ marginTop: 6 }}>
            <CampaignTag c={c} />
            <span>
              {day(c.startsAt)} to {day(c.endsAt)}
            </span>
            {c.meta.statusReason ? <span>{c.meta.statusReason}</span> : null}
          </div>
        </div>
        <div className="page-actions">
          {c.status === 'draft' ? (
            <Btn variant="primary" busy={action.isPending} onClick={() => action.mutate({ id: c.id, action: 'start' })}>
              <Play /> Start
            </Btn>
          ) : c.status === 'active' ? (
            <Btn busy={action.isPending} onClick={() => action.mutate({ id: c.id, action: 'pause' })}>
              <Pause /> Pause
            </Btn>
          ) : c.status === 'paused' ? (
            <Btn variant="primary" busy={action.isPending} onClick={() => action.mutate({ id: c.id, action: 'resume' })}>
              <Play /> Resume
            </Btn>
          ) : null}
          {c.status !== 'ended' ? (
            <Btn onClick={() => setEdit(true)}>
              <Pencil /> Edit
            </Btn>
          ) : null}
          {c.status === 'active' || c.status === 'paused' ? (
            <Btn variant="ghost" onClick={() => confirm(`End ${c.name}? It stops for good and sends the final digest.`) && action.mutate({ id: c.id, action: 'end' })}>
              End
            </Btn>
          ) : null}
          {c.status !== 'active' ? (
            <Btn variant="ghost" className="danger" onClick={() => confirm(`Delete ${c.name}? Its history stays in the pipeline.`) && remove.mutate()} aria-label="Delete campaign">
              <Trash2 />
            </Btn>
          ) : null}
        </div>
      </header>

      <section className="card card-pad" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="stats">
          <Stat label="Today" value={`${st.today.done} of ${st.today.cap}`} sub={`${st.today.submitted} sent, ${st.today.rehearsed} rehearsed, ${st.today.room} left`} />
          <Stat label="Next application" value={c.status === 'active' ? (st.nextApplyAt ? until(st.nextApplyAt) : st.activeHours.open ? 'Looking' : `At ${clock(st.activeHours.nextOpenAt)}`) : '–'} sub={st.activeHours.open ? 'Inside active hours' : 'Outside active hours'} />
          <Stat label="Next scout" value={c.status === 'active' && st.nextScoutAt ? (st.nextScoutAt === 'soon' ? 'Soon' : until(st.nextScoutAt)) : '–'} sub={st.tasks.scout?.lastRunAt ? `Last ${ago(st.tasks.scout.lastRunAt)}` : 'Not run yet'} />
          <Stat label="Mode" value={st.dryRun.active ? 'Rehearsal' : c.status === 'draft' ? 'Not started' : 'Live'} sub={st.dryRun.active ? (st.dryRun.rehearseOnly ? 'Rehearses only' : `Day ${st.dryRun.day} of ${st.dryRun.days}, live ${day(st.dryRun.liveAt)}`) : st.dryRun.liveSince ? `Since ${day(st.dryRun.liveSince)}` : undefined} />
          <Meter label="Budget" value={st.spend.campaignUsd} max={st.spend.budgetUsd} format={usd} />
        </div>
      </section>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>Recent work</h2>
            <a className="btn ghost sm" href={`#/pipeline?campaign=${c.id}`}>
              Open in Pipeline
            </a>
          </div>
          {steps.data?.steps.length ? (
            <ul className="ledger">
              {steps.data.steps.map((s) => (
                <li key={s.id}>
                  <time dateTime={s.ts}>{stamp(s.ts)}</time>
                  <span>
                    {STEP_LABEL[s.step] ?? plain(s.step)}
                    {s.status && s.status !== 'ok' ? <span className="muted">: {plain(s.status).toLowerCase()}</span> : null}
                    {s.jobId ? (
                      <>
                        {' '}
                        <a href={`#/pipeline?job=${s.jobId}`} style={{ fontSize: 'var(--t-xs)' }}>
                          Open the job
                        </a>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ padding: '0 var(--s-5) var(--s-5)' }}>
              Each step of each application is logged here as it happens.
            </p>
          )}
        </section>
        <div className="grid">
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
              Where its jobs are
            </h2>
            <div className="funnel">
              {FUNNEL.map((f) => {
                const n = f.states.reduce((a, s) => a + (st.counts[s] ?? 0), 0);
                return (
                  <a className="funnel-row" key={f.label} href={`#/pipeline?campaign=${c.id}&state=${f.states.join(',')}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span className="muted">{f.label}</span>
                    <div className="track">
                      <i style={{ width: `${(n / max) * 100}%`, background: f.label === 'Sent' ? 'var(--good)' : f.label === 'Needs you' ? 'var(--warn)' : f.label === 'Failed' ? 'var(--bad)' : 'var(--leather-soft)' }} />
                    </div>
                    <span className="num" style={{ textAlign: 'right' }}>
                      {n.toLocaleString()}
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
          <section className="card card-pad">
            <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
              Settings
            </h2>
            <Facts
              rows={[
                ['Roles', cfg.roles.join(', ') || 'Every role in its categories'],
                ['Categories', cfg.categories.map((x) => CATEGORY_LABEL[x] ?? x).join(', ') || 'All of yours'],
                ['Locations', cfg.remoteOnly ? 'Remote only' : cfg.locations.join(', ') || 'Anywhere'],
                ['Stretch', plain(cfg.stretchLevel)],
                ['Lowest score', String(cfg.minScore)],
                ['Daily cap', String(cfg.dailyCap)],
                ['Company cooldown', `${cfg.companyCooldownDays} days`],
                ['Active hours', `${cfg.activeHours.start} to ${cfg.activeHours.end} ${cfg.activeHours.tz}`],
                ['Gap between applications', `${cfg.pacingMinutes.min} to ${cfg.pacingMinutes.max} min`],
                ['Rehearsal', `${cfg.dryRunDays} days`],
                ['Budget', cfg.budgetUsd ? usd(cfg.budgetUsd) : 'No campaign limit'],
                ['Applies by', [cfg.channels.forms && 'form', cfg.channels.email && 'email', cfg.channels.agent && 'browser agent'].filter(Boolean).join(', ')],
                ['Unknown questions', cfg.onUnknownQuestion === 'skip' ? 'Skip and ask' : 'Keep for me'],
                ['Follow-up', cfg.followUpDays ? `After ${cfg.followUpDays} days` : 'Off'],
              ]}
            />
          </section>
          {Object.keys(st.tasks).length ? (
            <section className="card card-pad">
              <h2 className="section-title" style={{ marginBottom: 'var(--s-4)' }}>
                Background tasks
              </h2>
              <Facts rows={Object.entries(st.tasks).map(([k, t]) => [plain(k), t.lastError ? `Failed ${ago(t.lastRunAt)}: ${t.lastError}` : t.lastOkAt ? `OK ${ago(t.lastOkAt)}` : 'Not run yet'])} />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ── List ─────────────────────────────────────────────────────────────

export default function Campaigns() {
  const [, params] = useRoute();
  const id = params.get('id');
  const isNew = params.get('new') === '1';
  const { data } = useCampaigns();

  if (isNew)
    return (
      <>
        <PageHead title="New campaign" lede="Sensible defaults are filled in from your profile. Every field can change later." />
        <CampaignEditor onDone={(c) => go(`campaigns?id=${c.id}`)} onCancel={() => setParam('new', null)} />
      </>
    );
  if (id) return <CampaignDetail id={id} />;

  const list = data?.campaigns ?? [];
  return (
    <>
      <PageHead
        title="Campaigns"
        lede="Each campaign runs on its own between its dates: it scouts, picks, writes and applies, rehearsing first."
        actions={
          <a className="btn" href="#/campaigns?new=1" data-testid="new-campaign">
            <Plus /> New campaign
          </a>
        }
      />
      <CampaignBand />
      {data && !list.length ? null : (
        <section className="list" aria-label="Campaigns">
          {list.map((c) => (
            <a key={c.id} className="list-row" href={`#/campaigns?id=${c.id}`}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="title">{c.name}</span>
                  <CampaignTag c={c} />
                </div>
                <div className="meta" style={{ marginTop: 3 }}>
                  <span>
                    {day(c.startsAt)} to {day(c.endsAt)}
                  </span>
                  <span>{c.config.roles.slice(0, 3).join(', ') || 'Every role in its categories'}</span>
                  {c.status === 'active' ? <span>{c.stats.dryRun.active ? `Rehearsal day ${c.stats.dryRun.day}` : 'Live'}</span> : null}
                </div>
              </div>
              <div className="hide-phone" style={{ display: 'grid', gridTemplateColumns: '120px 180px', gap: 'var(--s-5)', alignItems: 'center' }}>
                <div className="num" style={{ fontSize: 'var(--t-sm)' }}>
                  <strong>{c.stats.today.done}</strong>
                  <span className="faint"> of {c.stats.today.cap} today</span>
                </div>
                <Meter label="Budget" value={c.stats.spend.campaignUsd} max={c.stats.spend.budgetUsd} format={usd} />
              </div>
            </a>
          ))}
        </section>
      )}
    </>
  );
}
