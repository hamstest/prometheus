import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { operations, type Operation } from './api.ts';
import { call, localOrigin } from './client.ts';

const envelope = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number().int()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });
export class McpBridge {
  private initialized = false;
  private ready = false;
  readonly origin: string;
  constructor(origin?: string) { this.origin = localOrigin(origin); }
  async message(input: unknown) {
    const parsed = envelope.safeParse(input);
    if (!parsed.success) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    const request = parsed.data;
    if (request.id === undefined) {
      if (request.method === 'notifications/initialized' && this.initialized) this.ready = true;
      return null;
    }
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: request.id, result });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: request.id, error: { code, message } });
    if (request.method === 'ping') return reply({});
    if (request.method === 'initialize') {
      if (this.initialized) return error(-32600, 'Already initialized');
      const params = z.object({ protocolVersion: z.string(), capabilities: z.object({}).passthrough(), clientInfo: z.object({ name: z.string(), version: z.string() }).passthrough() }).safeParse(request.params);
      if (!params.success) return error(-32602, 'Invalid initialization parameters');
      this.initialized = true;
      return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'prometheus-v3', version: '0.1.0' }, instructions: 'Read capabilities, search meanings, inspect exact versions, compose clip intervals as a score, edit occurrence keys, preview, and save a new candidate. Ask the human to judge actual playback. Never invent accepted reviews. The local player owns frame generation. Only documented fixed-standing upper-body coordinates are supported.' });
    }
    if (!this.ready) return error(-32002, 'Initialize and send notifications/initialized first');
    if (request.method === 'tools/list') return reply({ tools: Object.entries(operations).map(([name, entry]) => ({ name: `motion_${name}`, description: entry.description, inputSchema: z.toJSONSchema(entry.schema, { io: 'input' }), annotations: { readOnlyHint: entry.readOnly, destructiveHint: false, openWorldHint: false } })) });
    if (request.method !== 'tools/call') return error(-32601, 'Method not found');
    const params = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }).safeParse(request.params);
    if (!params.success) return error(-32602, 'Invalid tool call');
    const operation = params.data.name.replace(/^motion_/, '') as Operation;
    if (!params.data.name.startsWith('motion_') || !Object.hasOwn(operations, operation)) return error(-32602, 'Unknown tool');
    try {
      const input = operations[operation].schema.parse(params.data.arguments), value = await call(operation, input, this.origin);
      return reply({ content: [{ type: 'text', text: JSON.stringify(value) }] });
    } catch (e) { return reply({ isError: true, content: [{ type: 'text', text: (e as Error).message }] }); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bridge = new McpBridge(); let buffer = '';
  process.stdin.setEncoding('utf8');
  const output = (value: unknown) => { if (value !== null) process.stdout.write(`${JSON.stringify(value)}\n`); };
  // Sequential dispatch preserves command order even when the host batches
  // initialization and tool calls into one operating-system pipe write.
  for await (const chunk of process.stdin) {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 2_000_000 && !buffer.includes('\n')) { console.error('MCP input exceeds 2 MB'); process.exitCode = 1; break; }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > 2_000_000) { output({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Input exceeds 2 MB' } }); continue; }
      try { output(await bridge.message(JSON.parse(line))); }
      catch { output({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
    }
  }
}
