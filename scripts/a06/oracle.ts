import fs from 'node:fs';
import path from 'node:path';
import type { AgentAction } from '../../server/contracts/agent.ts';
import { recordingPath, replayHash, type SystemBlocks, type UserContent } from '../../server/ai/claude.ts';
import type { DecideRequest, TurnState } from '../../server/agent/loop.ts';
import type { Classification } from '../../server/agent/compile.ts';

/**
 * How A06's replay recordings are authored. `A06_RECORD=1 npm run selfcheck -- a06`
 * runs the scenarios with this oracle in place of Claude: a careful, rule-based
 * form filler that sees exactly what Claude would (the structured turn state
 * behind the prompt), and writes each answer as a recording
 * (`fixtures/claude/<task>/<hash>.json`, hash = replayHash of the real prompt).
 * Normal runs then replay those recordings through `structured()`.
 *
 * The oracle never follows page text: it picks value keys from Bureau's own
 * suggestions and the field labels, opens sections, and stops at `done`.
 */

const FINAL = /^(submit|send|apply|finish|complete|confirm)\b|share|partner/i;
const NEXT = /^(next|continue|onwards?|proceed|→|›|»)/i;

function actionFor(kind: string): AgentAction['action'] {
  if (kind === 'file') return 'upload';
  if (kind === 'checkbox' || kind === 'consent') return 'check';
  if (kind === 'select' || kind === 'radio' || kind === 'combobox' || kind === 'location') return 'select';
  return 'fill';
}

const empty = (kind: string, current: string) => (kind === 'checkbox' || kind === 'consent' ? current !== 'true' : !current.trim());

/** Label → key when Bureau's mapper had no suggestion (what a careful reader would pick). */
function keyFromLabel(label: string, kind: string): string | null {
  const l = label.toLowerCase();
  if (kind === 'file') return /cover|letter/.test(l) ? 'file:letter' : /cv|resume|curriculum/.test(l) ? 'file:cv' : null;
  if (/where .*based|where do you live|location|city/.test(l)) return 'profile:location';
  if (/github/.test(l)) return 'profile:github';
  if (/linkedin/.test(l)) return 'profile:linkedin';
  if (/full name|your name/.test(l)) return 'profile:full_name';
  if (/e-?mail/.test(l)) return 'profile:email';
  if (/phone|mobile/.test(l)) return 'profile:phone';
  if (/privacy|data processing/.test(l)) return 'generated:consent:privacy';
  return null;
}

/** The oracle's next action. Stateless: everything comes from the turn state (as for Claude). */
export function oracle(state: TurnState): AgentAction {
  const tried = new Set(state.history.filter((h) => /^(refused|failed|no truthful)/.test(h.result)).map((h) => h.target));
  const clicked = new Set(state.history.filter((h) => h.action === 'click' || h.action === 'next').map((h) => h.target));
  const base = { target: '', valueKey: '', file: '' as const, question: '', reason: '' };
  const buttons = state.controls.filter((c) => c.role !== 'link' && !FINAL.test(c.name) && !clicked.has(c.ref));
  // Only a hidden upload input visible to the extractor: the form itself is not open yet.
  if (!state.fields.some((v) => v.field.kind !== 'file')) {
    const collapsed0 = buttons.find((c) => c.expanded === 'false');
    const reveal = collapsed0 ?? buttons[0];
    if (reveal) return { ...base, action: 'click', target: reveal.ref, reason: `No form is visible yet; "${reveal.name}" should open it.` } as AgentAction;
    return { ...base, action: 'give_up', reason: 'No application form can be found on this page.' } as AgentAction;
  }
  for (const v of state.fields) {
    const f = v.field;
    if (!empty(f.kind, v.current) || tried.has(f.id)) continue;
    let key = v.suggest ? (v.suggest.includes(':') ? v.suggest : 'suggested') : keyFromLabel(f.label, f.kind);
    if (!key) continue;
    if (key !== 'suggested' && state.catalogue.some((e) => e.key === key && !e.has)) continue;
    const act = actionFor(f.kind);
    if (act === 'upload') {
      if (key === 'suggested') key = /cover|letter/i.test(f.label) ? 'file:letter' : 'file:cv';
      return { ...base, action: 'upload', target: f.id, valueKey: key, file: key === 'file:letter' ? 'letter' : 'cv', reason: `Upload the ${key === 'file:letter' ? 'cover letter' : 'CV'} to "${f.label}".` } as AgentAction;
    }
    return { ...base, action: act, target: f.id, valueKey: key, reason: `"${f.label}" takes ${key === 'suggested' ? "Bureau's suggested value" : key}.` } as AgentAction;
  }
  const collapsed = buttons.find((c) => c.expanded === 'false');
  if (collapsed) return { ...base, action: 'click', target: collapsed.ref, reason: `Open the "${collapsed.name}" section to reach its fields.` } as AgentAction;
  const next = buttons.find((c) => NEXT.test(c.name));
  const hasSubmit = state.controls.some((c) => /^(submit|send)/i.test(c.name));
  if (next && !hasSubmit) return { ...base, action: 'click', target: next.ref, reason: `This page is complete; "${next.name}" moves the form on.` } as AgentAction;
  return { ...base, action: 'done', reason: 'Every field Bureau can fill truthfully is filled; only the final submit remains.' } as AgentAction;
}

function write(task: string, system: SystemBlocks, content: UserContent, output: unknown, usage: { input_tokens: number; output_tokens: number }) {
  const hash = replayHash(task, system, content);
  const file = recordingPath(task, hash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ task, hash, model: 'claude-sonnet-5-5', usage: { ...usage, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, output }, null, 2) + '\n');
}

/** A decide() that answers with the oracle and records the answer for replay. */
export function recordingDecide() {
  return async (req: DecideRequest): Promise<AgentAction> => {
    const a = oracle(req.state);
    const text = typeof req.content === 'string' ? req.content : JSON.stringify(req.content);
    write('agent_step', req.system, req.content, a, { input_tokens: Math.round((req.system[0].text.length + text.length) / 3.6), output_tokens: 70 });
    return a;
  };
}

/** A classify() for the compiler that answers by rule and records the answer. */
export function recordingClassify() {
  return async (system: string, content: string): Promise<Classification> => {
    const steps = [...content.matchAll(/^(\d+)\. "([^"]*)"/gm)].map((m) => {
      const company = /\b(our|office|clinic|product|team|why)\b/i.test(m[2]);
      return { index: Number(m[1]), scope: company ? ('company' as const) : ('generic' as const), why: company ? 'asks about this company specifically' : 'standard question on this ATS' };
    });
    write('recipe_compile', [{ type: 'text', text: system }], content, { steps }, { input_tokens: Math.round((system.length + content.length) / 3.6), output_tokens: 40 + steps.length * 25 });
    return { steps };
  };
}
