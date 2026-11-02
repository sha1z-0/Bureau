import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { HOST, IS_LOOPBACK, PORT, WEB_DIST } from './config.ts';
import { AppError, redact } from './errors.ts';
import { passphraseSet, registerGuard } from './security/guard.ts';
import { initVault } from './security/vault.ts';
import { applicationRoutes } from './routes/applications.ts';
import { jobRoutes } from './routes/jobs.ts';
import { profileRoutes } from './routes/profile.ts';
import { systemRoutes } from './routes/system.ts';
import { huntSettings, startHuntTimer } from './services/hunt.ts';
import { startScheduler } from './services/scanner.ts';
import { apiV1Routes } from './api/index.ts';
import { startAutopilot } from './campaign/index.ts';
import { scoutRoutes } from './scout/routes.ts';
import { matchRoutes } from './match/routes.ts';
import { masterProfileRoutes } from './profile/routes.ts';
import { researchRoutes } from './research/routes.ts';
import { writerRoutes } from './writer/routes.ts';
import { formsRoutes } from './forms/routes.ts';
import { agentRoutes } from './agent/routes.ts';
import { campaignRoutes } from './campaign/routes.ts';
import { inboxRoutes } from './inbox/routes.ts';
import { learningRoutes } from './learning/routes.ts';

initVault();

if (!IS_LOOPBACK && !passphraseSet() && process.env.BUREAU_ALLOW_UNLOCKED !== '1') {
  console.error(
    `\n  Refusing to listen on ${HOST}: Bureau is not locked.\n  Set a passphrase in Settings → Security while running on 127.0.0.1 first,\n  and serve it behind HTTPS (BUREAU_COOKIE_SECURE=1, BUREAU_ALLOWED_ORIGINS=https://your.domain).\n`,
  );
  process.exit(1);
}

const app = Fastify({
  logger: {
    level: process.env.BUREAU_LOG ?? 'warn',
    redact: ['req.headers.cookie', 'req.headers["x-bureau-csrf"]', 'req.headers.authorization'],
  },
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: false,
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: false,
});
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: [] });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

app.setErrorHandler((err: Error, req, reply) => {
  if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status < 500) return reply.status(status).send({ error: 'REQUEST', message: err.message });
  req.log.error({ err: redact(String(err.stack ?? err.message)) }, 'unhandled');
  console.error(redact(String(err.stack ?? err.message)));
  return reply.status(500).send({ error: 'INTERNAL', message: 'Something went wrong inside Bureau. Details are in the server log.' });
});

registerGuard(app);
await app.register(systemRoutes);
await app.register(jobRoutes);
await app.register(applicationRoutes);
await app.register(profileRoutes);
// v2 modules each own their UI-facing routes; /api/v1 and /mcp are the external agent surface.
await app.register(scoutRoutes);
await app.register(matchRoutes);
await app.register(masterProfileRoutes);
await app.register(researchRoutes);
await app.register(writerRoutes);
await app.register(formsRoutes);
await app.register(agentRoutes);
await app.register(campaignRoutes);
await app.register(inboxRoutes);
await app.register(learningRoutes);
await app.register(apiV1Routes);

if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    index: 'index.html',
    cacheControl: false,
    // Hashed assets can live forever; the HTML shell must always be fresh.
    setHeaders: (res, file) =>
      res.header('cache-control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such endpoint' });
    return reply.sendFile('index.html');
  });
}

try {
  await app.listen({ host: HOST, port: PORT });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`\n  Bureau is already running on port ${PORT} (perhaps in the background). Open http://127.0.0.1:${PORT}\n`);
    process.exit(0);
  }
  throw err;
}
startScheduler(() => huntSettings().enabled);
startHuntTimer();
startAutopilot();

const url = `http://${HOST === '::1' ? '[::1]' : HOST}:${PORT}`;
console.log(`\n  ⟡ Bureau is listening on ${url}\n`);

// The desktop launcher asks for the browser only once the server is actually listening.
if (process.env.BUREAU_OPEN === '1' && IS_LOOPBACK) {
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}
