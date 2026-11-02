/**
 * A07 — Bureau's MCP server over stdio (`npm run --silent mcp`).
 *
 *   BUREAU_API_KEY   the agent's key (bur_<prefix>_<secret>), required
 *   BUREAU_DATA_DIR  the same data folder the Bureau server uses (default ./data)
 *   BUREAU_PUBLIC_URL / BUREAU_PORT  where signed file links should point
 *
 * stdout carries the protocol, so every log line goes to stderr.
 */
const toStderr = (...args: unknown[]) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.warn = toStderr;

const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { AppError } = await import('../../errors.ts');
const { verifyApiKey, activeKey, touchKey } = await import('../keys.ts');
const { takeRequest } = await import('../ratelimit.ts');
const { writeAudit } = await import('../audit.ts');
const { publicBase } = await import('../files.ts');
const { loadApiModules } = await import('../deps.ts');
const { buildMcpServer } = await import('./tools.ts');

const keyText = (process.env.BUREAU_API_KEY ?? '').trim();
if (!keyText) {
  console.error('Bureau MCP: set BUREAU_API_KEY to an API key created in Bureau → Agents & API.');
  process.exit(1);
}
const res = await verifyApiKey(keyText);
if (!res.ok) {
  writeAudit({ keyId: res.ok === false ? (res.keyId ?? null) : null, route: 'MCP stdio connect', status: 401, detail: { error: res.code } });
  console.error(`Bureau MCP: the API key was refused (${res.code === 'REVOKED' ? 'revoked' : 'invalid'}).`);
  process.exit(1);
}
const keyId = res.key.id;
writeAudit({ keyId, route: 'MCP stdio connect', status: 200, detail: {} });
await loadApiModules();

const server = buildMcpServer({
  ctx: () => {
    const key = activeKey(keyId);
    if (!key) throw new AppError(401, 'KEY_REVOKED', 'This API key was revoked.');
    return { key, baseUrl: publicBase(), via: 'mcp-stdio' };
  },
  beforeCall: (ctx) => {
    const rl = takeRequest(ctx.key.id);
    if (!rl.ok) throw new AppError(429, 'RATE_LIMITED', `Rate limit reached for this key. Retry in ${rl.retryAfterSec} s.`);
    touchKey(ctx.key.id);
  },
  auditPrefix: 'MCP stdio',
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Bureau MCP server ready (key ${res.key.prefix}, ${res.key.scopes.length} scopes).`);

const shutdown = async () => {
  await server.close().catch(() => {});
  process.exit(0);
};
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export {};
