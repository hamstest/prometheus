import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { Library } from '../src/store.ts';
import { seed } from '../src/seeds.ts';
import { createApp } from '../src/server.ts';

test('actual HTTP and stdio: discover, execute, reject stale/foreign commands, and keep protocol output valid', async () => {
  const library = new Library(':memory:'); seed(library); const app = createApp(library);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (operation: string, body: unknown, extra: Record<string, string> = {}) => fetch(`${origin}/api/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  try {
    const badOrigin = await post('execute', { ref: { id: 'greeting', version: 1 } }, { Origin: 'https://unrelated.example' }); assert.equal(badOrigin.status, 403); assert.equal(app.service.player.run, null);
    const wrongHost = await new Promise<number | undefined>((done, reject) => {
      const req = request(`${origin}/api/state`, { headers: { Host: 'rebound.example' } }, res => { res.resume(); done(res.statusCode); }); req.on('error', reject); req.end();
    }); assert.equal(wrongHost, 403);
    const response = await post('execute', { ref: { id: 'greeting', version: 1 } }); assert.equal(response.status, 200); const run = await response.json();
    const badInput = await post('play', { motion: { kind: 'clip', profile: 'other' } }); assert.equal(badInput.status, 400); assert.equal(app.service.player.run?.id, run.id);
    const replacement = await (await post('execute', { ref: { id: 'acknowledge', version: 1 } })).json();
    assert.equal((await post('stop', { runId: run.id })).status, 409); assert.equal(app.service.player.run?.id, replacement.id);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp.ts', import.meta.url))], { env: { ...process.env, PROMETHEUS_V3_URL: origin }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'motion_search', arguments: { query: '相手に挨拶する' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'motion_execute', arguments: { ref: { id: 'greeting', version: 1 } } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'motion_execute', arguments: { ref: { id: 'missing', version: 1 } } } },
    ];
    const closed = once(child, 'close'); const timeout = setTimeout(() => child.kill(), 12000);
    try {
      child.stdin.end(messages.map(x => JSON.stringify(x)).join('\n') + '\nnot-json\n');
      const [code] = await closed; assert.equal(code, 0, stderr);
      const replies = stdout.trim().split('\n').map(line => JSON.parse(line));
      assert.equal(replies[0].result.protocolVersion, '2025-11-25');
      assert.ok(replies[1].result.tools.some((t: { name: string }) => t.name === 'motion_edit'));
      const found = JSON.parse(replies[2].result.content[0].text); assert.equal(found.items[0].ref.id, 'greeting');
      assert.equal(replies[3].result.isError, undefined); assert.equal(replies[4].result.isError, true); assert.equal(replies[5].error.code, -32700);
    } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); }
    const before = app.service.player.run?.id;
    assert.equal((await post('execute', { ref: { id: 'greeting', version: 999 } })).status, 404); assert.equal(app.service.player.run?.id, before);
  } finally { app.close(); app.server.closeAllConnections(); await once(app.server, 'close'); library.close(); }
});
