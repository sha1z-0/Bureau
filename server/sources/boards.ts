import type { Boards } from './types.ts';

/**
 * Curated company boards, every token confirmed live on 2026-10-27 (see
 * docs/SOURCES.md §15 for the full list with job counts). Weighted toward the
 * four lanes Bureau hunts in: security, game studios, AI/dev tools, and fintech.
 * Edit freely in Sources → Company boards.
 */
export const DEFAULT_BOARDS: Boards = {
  greenhouse: [
    // Security
    'okta', 'zscaler', 'wizinc', 'chainguard', 'abnormalsecurity', 'tailscale', 'coalition', 'recordedfuture',
    'island', 'tines', 'huntress', 'torq', 'axonius', 'bugcrowd', 'expel', 'orcasecurity',
    // Game studios
    'sonyinteractiveentertainmentglobal', 'roblox', 'riotgames', 'scopely', 'epicgames', 'krafton', 'insomniac', 'naughtydog', 'bungie',
    // AI & dev tools
    'anthropic', 'scaleai', 'togetherai', 'stripe', 'cloudflare', 'datadog', 'gitlab', 'mongodb', 'elastic', 'grafanalabs',
    'vercel', 'twilio', 'figma', 'discord',
    // Fintech & other
    'coinbase', 'robinhood', 'brex', 'affirm', 'mercury', 'duolingo', 'reddit', 'pinterest',
  ],
  lever: ['spotify', 'sysdig', 'kabam', 'zoox', 'wealthfront', 'anchorage'],
  ashby: [
    // Security
    '1password', 'vanta', 'snyk', 'drata', 'socket', 'goteleport', 'semgrep', 'hackerone', 'persona',
    // Game studios
    'supercell', 'thatgamecompany', 'voodoo', 'moonactive',
    // AI & dev tools
    'openai', 'cohere', 'perplexity', 'elevenlabs', 'langchain', 'cognition', 'notion', 'linear', 'docker',
    'sentry', 'replit', 'supabase', 'posthog', 'resend',
    // Fintech
    'ramp', 'plaid', 'wealthsimple', 'ledger',
  ],
};
