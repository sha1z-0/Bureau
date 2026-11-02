/** What one part of a profile sync did, for the sync report the UI shows. */
export interface PartReport {
  status: 'ok' | 'partial' | 'skipped' | 'error';
  added: number;
  reactivated: number;
  deactivated: number;
  kept: number;
  message: string;
}

export const emptyReport = (status: PartReport['status'], message: string): PartReport => ({ status, added: 0, reactivated: 0, deactivated: 0, kept: 0, message });
