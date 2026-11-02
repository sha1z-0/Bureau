import { research, structured } from '../ai/claude.ts';

/**
 * The Claude calls this module makes, behind an injectable seam. Production and
 * selfcheck (replay mode) use the real helpers; the fixture recorder swaps in a
 * fake that writes recordings instead of calling the API.
 */
export interface AiClient {
  structured: typeof structured;
  research: typeof research;
}

export const defaultAi: AiClient = { structured, research };
