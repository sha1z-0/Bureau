import { NotImplemented } from '../contracts/stub.ts';

/** A08 — campaign autopilot. */

export async function startCampaign(id: string): Promise<void> {
  void id;
  throw new NotImplemented('A08', 'startCampaign');
}

export async function pauseCampaign(id: string): Promise<void> {
  void id;
  throw new NotImplemented('A08', 'pauseCampaign');
}

export async function resumeCampaign(id: string): Promise<void> {
  void id;
  throw new NotImplemented('A08', 'resumeCampaign');
}

/** Stop every worker within 5 seconds and close browsers. */
export async function killAll(reason: string): Promise<void> {
  void reason;
  throw new NotImplemented('A08', 'killAll');
}

/** One scheduler pass: scout / match / apply / inbox / digest as each is due. */
export async function tick(): Promise<void> {
  throw new NotImplemented('A08', 'tick');
}

/** Called once at server start: resume active campaigns. A no-op until A08 lands. */
export function startAutopilot(): void {}
