import { EventEmitter } from 'node:events';
import type { V2Event } from '../contracts/events.ts';

/** In-process event bus that feeds the UI's live stream (Server-Sent Events). */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export type BusEvent =
  | { type: 'scan'; scanId: string; status: string; message?: string; found?: number; added?: number; scored?: number }
  | { type: 'jobs-changed' }
  | { type: 'application'; id: string; status: string }
  | { type: 'hunt'; status: 'running' | 'idle'; step?: string }
  | V2Event;

export function emit(event: BusEvent) {
  bus.emit('event', event);
}
