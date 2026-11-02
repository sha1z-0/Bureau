import { Check, X } from 'lucide-react';
import type { FieldLogEntry, FormRun, FormRunDetail } from '../api';
import { ago } from '../ui';
import { atsLabel, plain } from '../kit';

/* One form-engine run (A05): the outcome line, step screenshots and the field log.
   Shared by the Forms screen's run drawer and the job timeline's Form section. */

export const FILL_LABEL: Record<string, string> = {
  submitted: 'Sent',
  rehearsed: 'Rehearsed',
  needs_you: 'Needs you',
  skipped: 'Skipped',
  failed: 'Failed',
  submitting: 'Sending',
};

export const VIA_LABEL: Record<string, string> = { recipe: 'a recipe', adapter: 'the adapter', agent: 'the browser agent', generic: 'the general filler' };

export function fillTone(status: string | null): string {
  if (status === 'submitted' || status === 'rehearsed') return 'olive';
  if (status === 'needs_you' || status === 'skipped') return 'brass';
  if (status === 'failed') return 'crimson';
  return '';
}

/** The engine's reason, in plain words ("unknown_question: …" becomes a sentence). */
export function reasonText(reason: string | null): string {
  if (!reason) return '';
  const m = /^unknown_question:\s*(.+)$/i.exec(reason);
  return m ? `A required question nobody could answer truthfully: ${m[1]}` : reason;
}

export function FillTag({ run }: { run: Pick<FormRun, 'status'> }) {
  return <span className={`tag ${fillTone(run.status)}`}>{run.status ? (FILL_LABEL[run.status] ?? plain(run.status)) : 'Running'}</span>;
}

function OkMark({ ok }: { ok: boolean }) {
  return <span className={`ok-mark ${ok ? 'yes' : 'no'}`}>{ok ? <Check size={13} /> : <X size={13} />}</span>;
}

export function FieldLogTable({ log }: { log: FieldLogEntry[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th />
            <th>Field</th>
            <th>Value</th>
            <th className="hide-phone">From</th>
          </tr>
        </thead>
        <tbody>
          {log.map((f, i) => (
            <tr key={`${f.signature}-${i}`}>
              <td style={{ width: 28 }}>
                <OkMark ok={f.ok} />
              </td>
              <td>
                {f.label}
                {f.required ? <span className="faint"> (required)</span> : null}
                {f.note ? (
                  <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                    {f.note}
                  </div>
                ) : null}
              </td>
              <td style={{ overflowWrap: 'anywhere' }}>
                {f.readBack ?? f.intended ?? ''}
                {f.intended && f.readBack && f.intended !== f.readBack ? (
                  <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                    meant: {f.intended}
                  </div>
                ) : null}
              </td>
              <td className="hide-phone muted">{f.source ? `${plain(f.source)}${f.key ? `: ${f.key}` : ''}` : 'None'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunShots({ shots }: { shots: string[] }) {
  if (!shots.length) return null;
  return (
    <div className="shot-row">
      {shots.map((s, i) => (
        <figure key={s}>
          <a href={s} target="_blank" rel="noopener noreferrer">
            <img src={s} alt={`Form page ${i + 1}`} loading="lazy" />
          </a>
          <figcaption>Page {i + 1}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** The outcome line: verified or not, status, how, where and when. */
export function RunLine({ run }: { run: FormRun }) {
  return (
    <div className="row wrap">
      <span className={`tag ${run.verified ? 'olive' : 'crimson'}`}>{run.verified ? 'Every field verified' : 'Not verified'}</span>
      <FillTag run={run} />
      <span className="muted" style={{ fontSize: 'var(--t-sm)' }}>
        {run.live ? '' : 'Rehearsal, '}
        {run.via ? `by ${VIA_LABEL[run.via] ?? run.via}` : 'route not chosen'}
        {run.ats ? ` on ${atsLabel(run.ats)}` : ''}, {ago(run.startedAt)}
      </span>
    </div>
  );
}

/** Everything a run left behind. `data` is GET /api/forms/runs/:id. */
export function FormRunBody({ data }: { data: FormRunDetail }) {
  const { run, detail, shots } = data;
  const log = detail?.fieldLog ?? [];
  const problems = detail?.problems ?? [];
  const unknown = detail?.unknownQuestions ?? [];
  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      <RunLine run={run} />
      {run.reason ? (
        <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
          {reasonText(run.reason)}
        </p>
      ) : null}
      <p className="faint" style={{ fontSize: 'var(--t-xs)' }}>
        {run.fields.ok} of {run.fields.total} fields read back as intended, over {run.steps} {run.steps === 1 ? 'page' : 'pages'}.
      </p>
      {unknown.length ? (
        <div>
          <span className="label">Questions nobody could answer truthfully</span>
          <ul className="list-dash" style={{ marginTop: 4 }}>
            {unknown.map((q, i) => (
              <li key={i}>{q.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {problems.length ? (
        <div>
          <span className="label">Problems the check found</span>
          <ul className="list-dash" style={{ marginTop: 4 }}>
            {problems.slice(0, 12).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <RunShots shots={shots} />
      {log.length ? <FieldLogTable log={log} /> : <p className="muted">No field log was kept for this run.</p>}
      {detail?.notes?.length ? (
        <div className="faint" style={{ fontSize: 'var(--t-xs)' }}>
          {detail.notes.join('; ')}
        </div>
      ) : null}
    </div>
  );
}
