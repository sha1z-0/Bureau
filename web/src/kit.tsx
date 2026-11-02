import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, Copy, Info, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, type MatchMeaning, type PipelineState } from './api';
import { Btn, Empty } from './ui';

/* Shared v2 building blocks. Plain words, status by tone, numbers in Plex Sans. */

export function PageHead({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

/** A screen whose module isn't in this build yet. */
export function NotSetUp({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card">
      <Empty title={title} action={action}>
        {children}
      </Empty>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number | null }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} role="tab" type="button" aria-selected={value === it.id} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count ? <span className="tab-count">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export const STATE_LABEL: Record<PipelineState, string> = {
  found: 'Found',
  filtered: 'Passed filters',
  scored: 'Scored',
  selected: 'Queued',
  writing: 'Writing',
  written: 'Written',
  filling: 'Filling the form',
  verified: 'Verified',
  submitted: 'Sent',
  rehearsed: 'Rehearsed',
  skipped: 'Skipped',
  needs_you: 'Needs you',
  failed: 'Failed',
};

const STATE_TONE: Partial<Record<PipelineState, string>> = { submitted: 'olive', rehearsed: 'olive', needs_you: 'brass', failed: 'crimson' };

export function StateTag({ state }: { state: PipelineState }) {
  return <span className={`tag ${STATE_TONE[state] ?? ''}`}>{STATE_LABEL[state] ?? state}</span>;
}

export const CAMPAIGN_LABEL: Record<string, string> = { draft: 'Draft', active: 'Live', paused: 'Paused', ended: 'Ended' };

/** A measured quantity against a limit. Turns crimson only when over. */
export function Meter({ value, max, label, format = (n) => String(n) }: { value: number; max: number; label: string; format?: (n: number) => string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value >= max;
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="meter-head">
        <span className="label">{label}</span>
        <span className="num">
          {format(value)}
          <span className="faint"> of {max > 0 ? format(max) : 'no limit'}</span>
        </span>
      </div>
      <div className={`meter-track ${over ? 'over' : ''}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const inner = (
    <>
      <span className="label">{label}</span>
      <strong className="num">{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </>
  );
  return href ? (
    <a className="stat" href={href}>
      {inner}
    </a>
  ) : (
    <div className="stat">{inner}</div>
  );
}

/** Side panel on a desk, full sheet on a phone. */
export function Drawer({ title, onClose, children, actions, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="scrim drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}>
        <div className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>{typeof title === 'string' ? <h2>{title}</h2> : title}</div>
          {actions}
          <Btn variant="ghost" icon onClick={onClose} aria-label="Close">
            <X />
          </Btn>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/** A small (i) that explains a number on hover or focus. */
export function Hint({ text, label = 'What this means' }: { text: string; label?: string }) {
  const id = useId();
  return (
    <span className="hint">
      <button type="button" className="hint-btn" aria-label={label} aria-describedby={id}>
        <Info size={14} />
      </button>
      <span role="tooltip" id={id} className="hint-pop">
        {text}
      </span>
    </span>
  );
}

const SCREEN_FALLBACK =
  'How likely you are to pass the first screen for this role, from 0 to 100. Not how many boxes you tick: unmet nice-to-haves barely count, a few unmet important requirements are allowed by the stretch level, and only hard blockers cap it.';

/** The (i) next to every score, worded by the matcher itself. */
export function ScreenHint() {
  const { data } = useQuery({ queryKey: ['match', 'meaning'], queryFn: () => api<MatchMeaning>('/api/match/meaning'), staleTime: Infinity, retry: false });
  return <Hint text={data?.tooltip ?? SCREEN_FALLBACK} label="What the score means" />;
}

export function CopyButton({ text, label = 'Copy', size }: { text: string; label?: string; size?: 'sm' }) {
  const [done, setDone] = useState(false);
  return (
    <Btn
      size={size}
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked: the text stays selectable */
        }
      }}
    >
      {done ? <Check /> : <Copy />} {done ? 'Copied' : label}
    </Btn>
  );
}

/** Label and value pairs in a two-column grid. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/* ── Formatting ─────────────────────────────────────────────────────── */

export const usd = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);

export function until(iso: string | null | undefined): string {
  if (!iso) return '–';
  if (iso === 'soon') return 'soon';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '–';
  if (ms <= 60_000) return 'any moment';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} h ${m % 60} min`;
  return `on ${new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function stamp(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '–' : `${(n * 100).toFixed(digits)}%`);

/** "needs_you" → "Needs you"; snake and kebab case to a plain sentence. */
export const plain = (s: string) => {
  const t = s.replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};
