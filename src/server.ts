import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ZodError } from 'zod';
import { Library } from './store.ts';
import { seed } from './seeds.ts';
import { MotionError } from './model.ts';
import { Service, operations, type Operation } from './api.ts';
import { Chat } from './chat.ts';
import { Codex } from './codex.ts';
import { allowedRequest, loadAccess, tailnetOrigins } from './access.ts';

export function createApp(library: Library, accessOrigins:string[] = []) {
  const remoteOrigins=tailnetOrigins(accessOrigins);
  const service = new Service(library), clients = new Set<ServerResponse>();
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const chat = new Chat(service, new Codex(resolve(root, 'data/chat-workspace')));
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(); service.player.advance((now - previous) / 1000); previous = now;
    const data = `data: ${JSON.stringify(service.state())}\n\n`;
    for (const client of clients) { if (client.writableLength > 256000) { client.destroy(); clients.delete(client); } else client.write(data); }
  }, 1000 / 30);
  const server = createServer(async (req, res) => {
    const json = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const address = server.address(), port = typeof address === 'object' && address ? address.port : 4319;
      const accessError=allowedRequest(req.headers.host,req.headers.origin,req.headers['sec-fetch-site'] as string|undefined,port,remoteOrigins);
      if(accessError)return json(403,{error:{code:accessError,message:'Use a configured local or Tailscale origin'}});
      const url = new URL(req.url!, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(service.state())}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (url.pathname.startsWith('/api/')) {
        const operation = url.pathname.slice(5) as Operation;
        const isChat = operation.startsWith('chat/');
        if (!isChat && !Object.hasOwn(operations, operation)) return json(404, { error: { code: 'NOT_FOUND', message: 'Unknown operation' } });
        let input: unknown = {};
        if (req.method === 'POST') {
          if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(415, { error: { code: 'CONTENT_TYPE', message: 'Use application/json' } });
          let length = 0; const chunks: Buffer[] = [];
          for await (const chunk of req) { length += chunk.length; if (length > 2_000_000) { json(413, { error: { code: 'BUDGET', message: 'Request exceeds 2 MB' } }); return; } chunks.push(chunk); }
          input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } else if (req.method !== 'GET' || !['state', 'capabilities'].includes(operation)) return json(405, { error: { code: 'METHOD', message: 'Use POST for this operation' } });
        return json(200, isChat ? await chat.dispatch(operation.slice(5), input) : service.dispatch(operation, input));
      }
      if (req.method !== 'GET') return json(405, { error: { code: 'METHOD', message: 'Use GET' } });
      const paths: Record<string, string> = {
        '/': 'web/index.html', '/style.css': 'web/style.css', '/vendor/three.js': 'node_modules/three/build/three.module.js',
        '/vendor/three.core.js': 'node_modules/three/build/three.core.js', '/vendor/vrm.js': 'node_modules/@pixiv/three-vrm/lib/three-vrm.module.js',
        '/model.vrm': 'models/avatar.vrm',
      };
      let relative = paths[url.pathname];
      if (url.pathname.startsWith('/app/')) relative = `dist/${decodeURIComponent(url.pathname.slice(5))}`;
      if (url.pathname.startsWith('/addons/')) relative = `node_modules/three/examples/jsm/${decodeURIComponent(url.pathname.slice(8))}`;
      if (!relative) return json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      const path = resolve(root, relative);
      const allowedRoot = url.pathname.startsWith('/app/') ? resolve(root, 'dist') : url.pathname.startsWith('/addons/') ? resolve(root, 'node_modules/three/examples/jsm') : root;
      if (!path.startsWith(allowedRoot + sep)) return json(403, { error: { code: 'PATH', message: 'Invalid asset path' } });
      // Only browser modules are public; do not expose service implementation.
      if (url.pathname.startsWith('/app/') && !['browser.js', 'viewer.js', 'rig.js', 'model.js', 'curve.js', 'motion.js', 'chat-browser.js', 'curve-editor.js', 'expression.js', 'knowledge-browser.js', 'semantic-browser.js', 'playback-buffer.js'].includes(url.pathname.slice(5))) return json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      const body = await readFile(path);
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.vrm': 'model/gltf-binary' };
      res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }); res.end(body);
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      const code = e instanceof MotionError ? e.code : e instanceof ZodError || e instanceof SyntaxError ? 'INVALID_INPUT' : (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'INTERNAL';
      json(code === 'INTERNAL' ? 500 : code === 'VERSION_CONFLICT' || code === 'STALE_RUN' ? 409 : code === 'NOT_FOUND' ? 404 : 400, { error: { code, message: e instanceof Error ? e.message : String(e) } });
    }
  });
  server.requestTimeout = 10000;
  server.on('close', () => { clearInterval(timer); chat.close(); });
  return { server, service, close: () => { chat.close(); for (const client of clients) client.end(); server.close(); clearInterval(timer); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const library = new Library(process.env.PROMETHEUS_V3_DB ?? resolve(root, 'data/library.sqlite'));
  seed(library);
  const app = createApp(library,loadAccess(new URL('../config/access.json',import.meta.url))), port = Number(process.env.PORT ?? 4319);
  app.server.listen(port, '127.0.0.1', () => console.log(`Prometheus V3: http://127.0.0.1:${port}`));
  app.server.on('error', error => { console.error(error.message); app.close(); library.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { app.close(); app.server.closeIdleConnections(); library.close(); });
}
