export function localOrigin(value = process.env.PROMETHEUS_V3_URL ?? 'http://127.0.0.1:4319') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a loopback HTTP origin for Prometheus V3');
  return url.origin;
}
export async function call(operation: string, input: unknown = {}, origin = localOrigin()) {
  const response = await fetch(`${origin}/api/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), redirect: 'error', signal: AbortSignal.timeout(15000) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${value.error?.code ?? response.status}: ${value.error?.message ?? response.statusText}`);
  return value;
}
