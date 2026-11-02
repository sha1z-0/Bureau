import type { FastifyInstance } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { AppError } from '../../errors.ts';
import { keyOf } from '../auth.ts';
import { publicBase } from '../files.ts';
import { activeKey } from '../keys.ts';
import { buildMcpServer } from './tools.ts';

/**
 * MCP over streamable HTTP at /mcp, stateless: every POST is authenticated by
 * the guard (Bearer key), gets a fresh server bound to that key and answers in
 * plain JSON. There are no sessions, so GET (server-sent stream) and DELETE
 * are 405. Tool calls write their own audit rows; other JSON-RPC methods are
 * audited on the HTTP row.
 */

const PASS_HEADERS = ['accept', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];

const notAllowed = { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this MCP endpoint is stateless; POST JSON-RPC messages.' }, id: null };

export async function mcpHttpRoutes(app: FastifyInstance) {
  app.post('/mcp', { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const key = keyOf(req);
    const baseUrl = publicBase(req);
    const messages = (Array.isArray(req.body) ? req.body : [req.body]) as unknown[];
    const methods = messages.map((m) => (m && typeof m === 'object' && typeof (m as { method?: unknown }).method === 'string' ? String((m as { method: string }).method) : 'response'));

    const server = buildMcpServer({
      ctx: () => {
        const k = activeKey(key.id);
        if (!k) throw new AppError(401, 'KEY_REVOKED', 'This API key was revoked.');
        return { key: k, baseUrl, via: 'mcp-http' };
      },
      auditPrefix: 'MCP',
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const headers = new Headers();
    for (const h of PASS_HEADERS) {
      const v = req.headers[h];
      if (typeof v === 'string') headers.set(h, v);
    }
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(new Request('http://bureau.local/mcp', { method: 'POST', headers }), { parsedBody: req.body });
      const audit = req.apiAudit;
      if (audit) {
        const other = methods.filter((m) => m !== 'tools/call');
        if (methods.length && !other.length && res.status < 400) audit.done = true;
        else audit.detail.rpc = methods.slice(0, 5);
      }
      reply.status(res.status);
      res.headers.forEach((v, k) => {
        if (!['content-length', 'transfer-encoding', 'connection'].includes(k)) reply.header(k, v);
      });
      const text = await res.text();
      return reply.send(text.length ? text : undefined);
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });

  for (const method of ['GET', 'DELETE'] as const) {
    app.route({
      method,
      url: '/mcp',
      handler: async (_req, reply) => reply.status(405).header('allow', 'POST').send(notAllowed),
    });
  }
}
