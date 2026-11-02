/**
 * v1 import path kept for old callers (scripts/checks/00-core.ts, the selfcheck
 * harness). The browser now lives in server/forms/browser.ts (A05).
 */
export { browserAvailable, guardedContext, launchBrowser, allowFixtureOrigins, urlAllowed, leaseBrowser, closeSharedBrowser } from '../forms/browser.ts';
