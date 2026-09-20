import { readFile } from 'node:fs/promises';
import { call } from './client.ts';

try {
  const [operation = 'state', ...args] = process.argv.slice(2);
  let input: unknown = {};
  if (operation === 'search') input = { query: args.join(' ') };
  else if (operation === 'execute' || operation === 'inspect') input = { ref: { id: args[0], version: Number(args[1]) } };
  else if (operation === 'stop') input = { runId: args[0] };
  else if (args[0]) input = JSON.parse(await readFile(args[0], 'utf8'));
  console.log(JSON.stringify(await call(operation, input), null, 2));
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
