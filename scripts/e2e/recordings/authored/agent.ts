/**
 * The browser agent's turns (A06, task agent_step) in the e2e: replicas the
 * generic path cannot verify get the agent, one action per turn.
 *
 * They are answered by A06's own recording oracle (scripts/a06/oracle.ts), the
 * rule-based careful filler A06 authors its selfcheck recordings with. The
 * oracle reads the structured turn state; the miss dump only has the prompt,
 * so the state is read back from the prompt's own blocks (<value_keys>,
 * <fields>, <controls>, <history>), which carry everything the oracle uses.
 * Like Claude, it never follows page text and never types a value: it picks
 * value keys and stops at `done` (the engine then re-verifies the page).
 */
import { oracle } from '../../../a06/oracle.ts';
import type { TurnState } from '../../../../server/agent/loop.ts';
import { contentText, type Answer, type DumpedRequest } from './index.ts';

function block(text: string, tag: string): string[] {
  const m = text.match(new RegExp(`<${tag}(?: [^>]*)?>\\n([\\s\\S]*?)\\n</${tag}>`));
  return m ? m[1].split('\n') : [];
}

const unq = (s: string) => s.replace(/…$/, '');

export function turnState(text: string): TurnState | string {
  const catalogue = block(text, 'value_keys')
    .map((l) => l.match(/^- (\S+) \((.*)\) has=(yes|no)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ key: m[1], what: m[2], has: m[3] === 'yes' }));
  if (!catalogue.length) return 'agent_step: no <value_keys> in the prompt';
  const fields = block(text, 'fields')
    .filter((l) => l.startsWith('- id='))
    .map((l) => {
      const id = l.match(/^- id=(\S+)/)![1];
      const kind = l.match(/ kind=(\S+)/)?.[1] ?? 'text';
      const label = l.match(/ label="(.*?)"(?= required| section=| options=| hint=| current=)/)?.[1] ?? '';
      const current = l.match(/ current="(.*?)"(?: suggest=\S+)?$/)?.[1] ?? '';
      const suggest = l.match(/ suggest=(\S+)$/)?.[1] ?? null;
      return { field: { id, kind, label: unq(label), required: / required( |$)/.test(l) }, current: unq(current), suggest };
    });
  const controls = block(text, 'controls')
    .map((l) => l.match(/^- ref=(\S+) (\S+) "(.*)"((?: expanded=\S+)?(?: type=\S+)?(?: href=".*")?)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ ref: m[1], role: m[2], name: unq(m[3]), expanded: m[4].match(/expanded=(\S+)/)?.[1] ?? '', type: m[4].match(/type=(\S+)/)?.[1] ?? '' }));
  const history = block(text, 'history')
    .map((l) => l.match(/^\d+\. (\S+)(?: ([^\s→]+))?(?: ([^\s→]+))? → (.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ action: m[1], target: m[2] ?? '', valueKey: m[3] ?? '', result: m[4] }));
  const url = text.match(/<page url="([^"]*)">/)?.[1] ?? '';
  return { url, fields, controls, history, injections: [], notes: [], catalogue } as unknown as TurnState;
}

type Action = ReturnType<typeof oracle>;

/**
 * The oracle is stateless and treats any filled field as done. After a `done` that did not verify, a careful
 * filler re-fills the fields the check named, once; when the same fields fail again it gives up (the engine
 * then parks the job for the owner) instead of claiming `done` a third time.
 */
function afterFailedDone(state: TurnState): Action | null {
  const h = state.history as unknown as { action: string; target: string; valueKey: string; result: string }[];
  const failed = h.map((x, i) => ({ x, i })).filter(({ x }) => x.action === 'done' && /^not yet/i.test(x.result));
  if (!failed.length) return null;
  const problems = failed.at(-1)!.x.result.toLowerCase();
  const views = state.fields as unknown as { field: { id: string; kind: string; label: string }; current: string; suggest: string | null }[];
  const named = views.filter((v) => v.field.label && problems.includes(v.field.label.toLowerCase()));
  const base = { target: '', valueKey: '', file: '' as const, question: '', reason: '' };
  const retried = named.filter((v) => h.slice(failed[0].i + 1).some((x) => x.target === v.field.id && x.action !== 'done'));
  if (named.length && retried.length === named.length) {
    return { ...base, action: 'give_up', reason: `"${named.map((v) => v.field.label).join('", "')}" still does not hold the candidate's value after filling it again; the page changes it, so the owner should look.` } as Action;
  }
  const v = named.find((x) => !retried.includes(x) && x.suggest);
  if (!v?.suggest) return null;
  const key = v.suggest.includes(':') ? v.suggest : 'suggested';
  return { ...base, action: v.field.kind === 'select' || v.field.kind === 'radio' ? 'select' : 'fill', target: v.field.id, valueKey: key, reason: `"${v.field.label}" did not verify; fill it again with ${key}.` } as Action;
}

export function agentAnswer(req: DumpedRequest): Answer {
  const text = contentText(req);
  const state = turnState(text);
  if (typeof state === 'string') return { skip: state };
  const where = text.match(/<task>Fill the application for "(.*)" at (.*?)\. Turn (\d+)/);
  const action = afterFailedDone(state) ?? oracle(state);
  return { label: `agent turn ${where?.[3] ?? '?'}: ${where?.[2] ?? 'unknown'} → ${action.action}${action.target ? ` ${action.target}` : ''}`, body: { output: action } };
}
