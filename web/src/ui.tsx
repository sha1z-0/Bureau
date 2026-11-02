import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ApiError } from './api';

/* ── Insignia ──────────────────────────────────────────────────────── */

/** Bureau's own mark: a hooded arch split by a blade, over a leather strap. */
export function Insignia({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6 L52 47 L41.5 47 L32 27.5 L22.5 47 L12 47 Z" fill="var(--accent)" />
      <path d="M32 6 L52 47 L48 47 L32 14 Z" fill="color-mix(in oklab, var(--accent) 70%, black)" />
      <path d="M32 34 L36.5 47 L27.5 47 Z" fill="var(--gold)" />
      <rect x="12" y="51" width="40" height="5" rx="2.5" fill="var(--text)" />
      <rect x="29" y="51" width="6" height="5" fill="var(--gold)" />
    </svg>
  );
}

/* ── Seal & dial ───────────────────────────────────────────────────── */

export function Seal({ grade, size }: { grade: string | null; size?: 'sm' | 'lg' }) {
  return (
    <span className={`seal ${grade ?? 'none'} ${size ?? ''}`} title={grade ? `Grade ${grade}` : 'Not yet assessed'} aria-label={grade ? `Grade ${grade}` : 'Unscored'}>
      {grade ?? ''}
    </span>
  );
}

const DECISION: Record<string, string> = { apply: 'Apply', consider: 'Worth a look', research: 'Research first', skip: 'Skip' };

/** Fit score as a seal and a plain number. */
export function ScoreDial({ score, grade, decision }: { score: number | null; grade?: string | null; decision?: string | null; label?: string }) {
  return (
    <div className="score-mark" aria-label={score === null ? 'Not assessed yet' : `Chance of passing the screen: ${score} of 100`}>
      <Seal grade={grade ?? null} size="lg" />
      <div>
        <strong>
          {score ?? '–'}
          <small> / 100</small>
        </strong>
        <div className="muted" style={{ fontSize: 'var(--t-sm)', marginTop: 2 }}>
          {score === null ? 'Not assessed yet' : (DECISION[decision ?? ''] ?? 'Chance of passing the screen')}
        </div>
      </div>
    </div>
  );
}

/* ── Buttons ───────────────────────────────────────────────────────── */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'leather' | 'danger';
  size?: 'sm';
  icon?: boolean;
  busy?: boolean;
};

export function Btn({ variant, size, icon, busy, className = '', children, disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn ${variant ?? ''} ${size ?? ''} ${icon ? 'icon' : ''} ${className}`} disabled={disabled || busy} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/* ── Modal ─────────────────────────────────────────────────────────── */

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <Btn variant="ghost" icon onClick={onClose} aria-label="Close">
            <X />
          </Btn>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ── Toasts ────────────────────────────────────────────────────────── */

interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    info: (t: string) => push('info', t),
    success: (t: string) => push('success', t),
    error: (e: unknown) => push('error', e instanceof ApiError || e instanceof Error ? e.message : String(e)),
  };
}

/* ── Form bits ─────────────────────────────────────────────────────── */

export function Field({ label, help, children, full }: { label: string; help?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label>{label}</label>
      {children}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" role="switch" className="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

/** Comma/enter separated list editor rendered as removable chips. */
export function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.length ? (
        <div className="chips">
          {value.map((v) => (
            <span key={v} className="tag" style={{ paddingRight: 4 }}>
              {v}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                style={{ border: 0, background: 'none', cursor: 'pointer', padding: '0 2px', color: 'inherit', display: 'grid' }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        className="input"
        value={draft}
        placeholder={placeholder ?? 'Type and press Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/* ── Formatting ────────────────────────────────────────────────────── */

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function money(s: { min: number | null; max: number | null; currency: string | null } | null): string | null {
  if (!s) return null;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const cur = s.currency ? `${s.currency} ` : '';
  if (s.min && s.max && s.min !== s.max) return `${cur}${fmt(s.min)}–${fmt(s.max)}`;
  const one = s.max ?? s.min;
  return one ? `${cur}${fmt(one)}` : null;
}

const SOURCE_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  weworkremotely: 'We Work Remotely',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  arbeitnow: 'Arbeitnow',
  themuse: 'The Muse',
  hackernews: 'HN Hiring',
  reddit: 'Reddit',
  gamedev: 'Game dev boards',
  workingnomads: 'Working Nomads',
  jobspresso: 'Jobspresso',
  larajobs: 'Larajobs',
  simplify: 'New-grad list',
  deepscan: 'Deep scan',
  capture: 'Captured',
};

export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

export function toRoman(n: number): string {
  const map: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [v, r] of map) while (n >= v) (out += r), (n -= v);
  return out;
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
