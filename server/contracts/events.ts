import type { PipelineState, CampaignStatus } from './campaign.ts';
import type { InboxClass } from './inbox.ts';

/**
 * Typed bus events added in v2. They travel the same in-process bus (and SSE
 * stream) as the v1 events in services/bus.ts.
 */
export type V2Event =
  | { type: 'pipeline.state'; jobId: string; from: PipelineState | null; to: PipelineState; campaignId: string | null; reason?: string }
  | { type: 'campaign.status'; campaignId: string; status: CampaignStatus; message?: string }
  | { type: 'application.outcome'; applicationId: string; jobId: string; outcome: string; detail?: string }
  | { type: 'inbox.message'; id: string; class: InboxClass; applicationId: string | null }
  | {
      type: 'alert.interview';
      applicationId: string;
      company: string;
      role: string;
      kind: 'interview_invite' | 'assessment' | 'offer';
      deadline: string | null;
      planId: string | null;
    }
  | { type: 'recipe.promoted'; recipeId: string; ats: string; scope: string }
  | { type: 'digest.sent'; digestId: string; campaignId: string | null; via: string[] }
  | { type: 'question.answered'; questionId: string; jobId: string | null }
  | { type: 'activity'; message: string; level?: 'info' | 'warn' | 'error'; jobId?: string };

export const V2_EVENT_TYPES = [
  'pipeline.state',
  'campaign.status',
  'application.outcome',
  'inbox.message',
  'alert.interview',
  'recipe.promoted',
  'digest.sent',
  'question.answered',
  'activity',
] as const;
