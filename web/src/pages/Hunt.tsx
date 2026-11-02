import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Crosshair, Play, Square, X } from 'lucide-react';
import { api, post, put, useLive, type LiveEvent } from '../api';
import { Btn, Field, Switch, useToast } from '../ui';

export interface HuntSettings {
  enabled: boolean;
  mode: 'live' | 'rehearse';
  intervalHours: number;
  applyThreshold: number;
  dailyCap: number;
  assessPerCycle: number;
  channels: { email: boolean; forms: boolean };
}

export interface HuntStatus {
  settings: HuntSettings;
  running: { startedAt: string; step: string } | null;
  last: { at: string; summary: string } | null;
  nextRunAt: string | null;
  today: { applied: number; rehearsed: number; needsYou: number; failed: number };
  needsYouTotal: number;
  readiness: { apiKey: boolean; profile: boolean; answers: boolean; email: boolean; browser: boolean };
  costs: { perJobScored: number; perApplication: number; perDeepScan: number; measured: boolean; budget: number; models: { score: string; tailor: string; apply: string } };
}

const usd = (n: number) => (n >= 10 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(2)}` : `<$0.01`);

/** Upper-bound spend if Bureau is left running all day at these settings. */
export function estimate(s: HuntSettings, c: HuntStatus['costs']) {
  const roundsPerDay = 24 / Math.max(1, s.intervalHours);
  const scoringPerRound = s.assessPerCycle * c.perJobScored;
  const perDay = roundsPerDay * scoringPerRound + s.dailyCap * c.perApplication;
  const perMonth = perDay * 30;
  return { roundsPerDay, scoringPerRound, perDay, perMonth, budgetDays: c.budget > 0 ? c.budget / perDay : Infinity };
}

export function CostEstimate({ s, c }: { s: HuntSettings; c: HuntStatus['costs'] }) {
  const e = estimate(s, c);
  const over = c.budget > 0 && e.perMonth > c.budget;
  const short = (id: string) => id.replace('claude-', '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/^\w/, (x) => x.toUpperCase());
  return (
    <div className={`callout ${over ? 'crimson' : 'olive'}`} style={{ display: 'grid', gap: 6 }}>
      <div className="row wrap" style={{ gap: '4px 18px' }}>
        <span>
          Scoring: <strong className="mono">{usd(c.perJobScored)}</strong>/role on {short(c.models.score)}
        </span>
        <span>
          Each application: <strong className="mono">{usd(c.perApplication)}</strong> on {short(c.models.tailor)}
        </span>
        <span>
          One round: <strong className="mono">{usd(e.scoringPerRound)}</strong> + applications
        </span>
      </div>
      <div>
        Left running all day: up to <strong className="mono">{usd(e.perDay)}</strong>/day, <strong className="mono">{usd(e.perMonth)}</strong>/month.{' '}
        {c.budget > 0
          ? over
            ? `Your $${c.budget} monthly budget would run out in about ${Math.max(1, Math.floor(e.budgetDays))} day${Math.floor(e.budgetDays) === 1 ? '' : 's'}, and the hunt pauses when it does. Lower the cap or the pace, or raise the budget.`
            : `Fits inside your $${c.budget} monthly budget.`
          : 'No budget cap set.'}
      </div>
      <div className="faint" style={{ fontSize: '0.75rem' }}>
        {c.measured ? 'Based on your actual spend over the last 30 days.' : 'Estimated from typical token counts; it switches to your real averages after a few runs.'} Most rounds apply to fewer than the cap, so real spend is usually lower.
      </div>
    </div>
  );
}

export function useHunt() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['hunt'], queryFn: () => api<HuntStatus>('/api/hunt'), refetchInterval: 30_000 });
  useLive(
    useCallback(
      (e: LiveEvent) => {
        if (e.type === 'hunt' || e.type === 'application') qc.invalidateQueries({ queryKey: ['hunt'] });
      },
      [qc],
    ),
  );
  return query;
}

function until(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 60_000) return 'any moment';
  const m = Math.round(ms / 60_000);
  return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The control room: one switch to start the autonomous hunt, and what it has done today. */
export function HuntPanel() {
  const { data } = useHunt();
  const toast = useToast();
  const qc = useQueryClient();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['hunt'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => put<HuntStatus>('/api/hunt', { ...data!.settings, enabled }),
    onSuccess: (s) => {
      refresh();
      toast.success(s.settings.enabled ? 'The hunt is on. The first round has started.' : 'The hunt is paused.');
    },
    onError: toast.error,
  });
  const runNow = useMutation({ mutationFn: () => post('/api/hunt/run'), onSuccess: refresh, onError: toast.error });
  const stop = useMutation({ mutationFn: () => post('/api/hunt/stop'), onSuccess: () => toast.info('Stopping after the current application.'), onError: toast.error });

  if (!data) return <div className="skeleton" style={{ height: 248, marginBottom: 'var(--s-4)' }} />;
  const s = data.settings;
  const r = data.readiness;
  const blockers = [
    !r.apiKey && { text: 'Add your Claude API key in Settings', href: '#/settings' },
    !r.profile && { text: 'Upload your CV in Profile', href: '#/profile' },
    !r.answers && { text: 'Fill in your application answers in Profile (work authorisation and the rest)', href: '#/profile' },
    !r.browser && { text: 'Install Google Chrome or Microsoft Edge so Bureau can fill application forms', href: 'https://www.google.com/chrome/' },
  ].filter(Boolean) as { text: string; href: string }[];
  const ready = r.apiKey && r.profile;
  const perDay = estimate(s, data.costs).perDay;

  const title = data.running
    ? `Hunting now: ${data.running.step.toLowerCase()}.`
    : s.enabled
      ? `The hunt is on. Next round ${until(data.nextRunAt)}.`
      : 'The hunt is off.';
  const lede = s.enabled
    ? `Every ${s.intervalHours} hours Bureau scans every source, has Claude score what's new, and ${s.mode === 'live' ? 'applies' : 'rehearses applying'} to roles scoring ${s.applyThreshold} or more with a tailored CV and letter, up to ${s.dailyCap} a day. About ${usd(perDay)} a day at most in Claude costs.`
    : 'Switch it on and Bureau works on its own: it finds roles, scores them against your CV, tailors your CV and letter, and applies by email or through the company’s own form.';

  return (
    <section className={`hunt ${s.enabled ? 'on' : ''}`} aria-live="polite">
      <div className="hunt-main">
        <div style={{ minWidth: 0 }}>
          <h2 className="hunt-title">{title}</h2>
          <p className="hunt-lede">
            {lede}
            {data.last ? ` Last round: ${data.last.summary}.` : ''}
          </p>
        </div>
        <label className="hunt-switch" style={{ cursor: ready ? 'pointer' : 'not-allowed' }}>
          {s.mode === 'rehearse' ? <span className="tag brass">Rehearsal</span> : null}
          <span>{s.enabled ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            role="switch"
            className="switch big"
            checked={s.enabled}
            disabled={!ready || toggle.isPending}
            aria-label="Hunt on or off"
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
        </label>
      </div>

      <div className="hunt-stats">
        <a href="#/dispatch" className="hunt-stat">
          <span className="label">Applied today</span>
          <strong>
            {data.today.applied}
            <small> of {s.dailyCap}</small>
          </strong>
        </a>
        <a href="#/dispatch" className="hunt-stat">
          <span className="label">Needs you</span>
          <strong>{data.needsYouTotal}</strong>
        </a>
        <a href="#/dispatch" className="hunt-stat">
          <span className="label">Rehearsed today</span>
          <strong>{data.today.rehearsed}</strong>
        </a>
        <a href="#/settings" className="hunt-stat">
          <span className="label">Applies at</span>
          <strong>
            {s.applyThreshold}
            <small> or more</small>
          </strong>
        </a>
        <div className="hunt-actions">
          {data.running ? (
            <Btn onClick={() => stop.mutate()} busy={stop.isPending}>
              <Square /> Stop the round
            </Btn>
          ) : (
            <Btn onClick={() => runNow.mutate()} busy={runNow.isPending} disabled={!ready}>
              <Play /> Run a round now
            </Btn>
          )}
          <a className="btn ghost" href="#/settings">
            Settings
          </a>
        </div>
      </div>

      {blockers.length || !r.email ? (
        <div className="hunt-ready">
          {blockers.map((b) => (
            <a key={b.text} href={b.href} className="note" style={{ color: 'inherit', textDecoration: 'none' }} target={b.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
              <CircleAlert /> {b.text}
            </a>
          ))}
          {!r.email ? (
            <a href="#/settings" className="note" style={{ color: 'inherit', textDecoration: 'none', opacity: 0.8 }}>
              <CircleAlert /> Optional: connect your email in Settings so roles that ask for an emailed application go out too
            </a>
          ) : null}
        </div>
      ) : null}

      {data.running ? <div className="hunt-progress" aria-hidden="true" /> : null}
    </section>
  );
}

/** Every dial the hunt has, in Settings. */
export function HuntSettingsCard() {
  const { data } = useHunt();
  const [s, setS] = useState<HuntSettings | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (data && !s) setS(data.settings);
  }, [data, s]);
  const save = useMutation({
    mutationFn: () => put('/api/hunt', s),
    onSuccess: () => {
      toast.success('Hunt settings saved.');
      qc.invalidateQueries({ queryKey: ['hunt'] });
    },
    onError: toast.error,
  });
  if (!s) return <div className="card skeleton" style={{ height: 240 }} />;
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 'var(--s-3)' }}>
        <Crosshair size={18} color="var(--accent)" />
        <h2 className="section-title">The hunt</h2>
        <span className="spacer" />
        <Btn size="sm" variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
          Save
        </Btn>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.875rem' }}>
        The autonomous loop. Rehearsal mode does everything except press submit and keeps a screenshot of each filled form, a safe way to watch it work before going live.
      </p>
      <div className="toggle-row">
        <div>
          <strong>Hunt automatically</strong>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>
            Runs while Bureau is open.
          </div>
        </div>
        <Switch label="Hunt automatically" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
      </div>
      <div className="toggle-row">
        <div>
          <strong>Mode</strong>
          <div className="muted" style={{ fontSize: '0.8125rem' }}>
            Live submits applications. Rehearsal fills them in and stops.
          </div>
        </div>
        <div className="tabs">
          <button aria-selected={s.mode === 'live'} onClick={() => setS({ ...s, mode: 'live' })}>
            Live
          </button>
          <button aria-selected={s.mode === 'rehearse'} onClick={() => setS({ ...s, mode: 'rehearse' })}>
            Rehearsal
          </button>
        </div>
      </div>
      <div className="form-grid" style={{ padding: 'var(--s-3) 0' }}>
        <Field label="Apply when the fit score is at least" help="78+ is grade A. 70–75 casts a wider net.">
          <input className="input" type="number" min={50} max={100} value={s.applyThreshold} onChange={(e) => setS({ ...s, applyThreshold: Number(e.target.value) })} />
        </Field>
        <Field label="Most applications per day">
          <input className="input" type="number" min={1} max={40} value={s.dailyCap} onChange={(e) => setS({ ...s, dailyCap: Number(e.target.value) })} />
        </Field>
        <Field label="Hunt every (hours)">
          <input className="input" type="number" min={1} max={48} value={s.intervalHours} onChange={(e) => setS({ ...s, intervalHours: Number(e.target.value) })} />
        </Field>
        <Field label="Roles Claude assesses per round" help="Controls Claude spend per round.">
          <input className="input" type="number" min={5} max={200} value={s.assessPerCycle} onChange={(e) => setS({ ...s, assessPerCycle: Number(e.target.value) })} />
        </Field>
      </div>
      {data?.costs ? <CostEstimate s={s} c={data.costs} /> : null}
      <div className="toggle-row">
        <span>Apply through company forms (Greenhouse, Lever, Ashby…)</span>
        <Switch label="Forms" checked={s.channels.forms} onChange={(v) => setS({ ...s, channels: { ...s.channels, forms: v } })} />
      </div>
      <div className="toggle-row">
        <span>Apply by email when a posting asks for it</span>
        <Switch label="Email" checked={s.channels.email} onChange={(v) => setS({ ...s, channels: { ...s.channels, email: v } })} />
      </div>
      <div className="callout" style={{ marginTop: 'var(--s-3)' }}>
        <Check />
        <div>
          Bureau won't solve CAPTCHAs or guess answers it can't back up. Those roles land in <a href="#/dispatch">Needs you</a> with the form already filled, so one click in a browser window finishes them.
        </div>
      </div>
    </section>
  );
}

export function ReadinessIcon({ ok }: { ok: boolean }) {
  return ok ? <Check size={14} color="var(--good)" /> : <X size={14} color="var(--accent)" />;
}
