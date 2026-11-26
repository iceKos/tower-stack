import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function createNakaPlatform(env = process.env) {
  if (env.PLATFORM !== 'naka') return null;
  if (!env.NAKA_API_URL || !env.NAKA_SERVER_KEY) {
    throw new Error('PLATFORM=naka requires NAKA_API_URL and NAKA_SERVER_KEY.');
  }
  const base = new URL(env.NAKA_API_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(loopback && base.protocol === 'http:'))
    || base.username || base.password || base.search || base.hash) {
    throw new Error('Set NAKA_API_URL to the HTTPS platform API including /api.');
  }
  const api = base.href.replace(/\/+$/, '');
  const pendingPath = resolve(env.NAKA_PENDING_FILE || '.naka-pending.json');
  const jobs = new Map();
  const sending = new Set();
  try {
    for (const job of JSON.parse(readFileSync(pendingPath, 'utf8'))) jobs.set(job.id, job);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  function save(next) {
    const temporary = pendingPath + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify([...next.values()]), { mode: 0o600 });
      renameSync(temporary, pendingPath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  async function post(path, body) {
    const response = await fetch(api + '/internal/game-sessions/' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.NAKA_SERVER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    return { status: response.status, data: (await response.json().catch(() => null))?.data };
  }

  async function deliver(job, attempt = 0) {
    if (!jobs.has(job.id) || sending.has(job.id)) return;
    sending.add(job.id);
    let retry = false;
    try {
      const { status } = await post(encodeURIComponent(job.id) + '/result', job.body);
      retry = status >= 500 || status === 408 || status === 429;
      if (retry || status === 401) {
        console.warn(`[naka] Result delivery HTTP ${status} for ${job.id}. Kept for retry.`);
        return;
      }
      if (status !== 200) console.error(`[naka] Result rejected with HTTP ${status} for ${job.id}.`);
      const remaining = new Map(jobs);
      remaining.delete(job.id);
      save(remaining);
      jobs.delete(job.id);
    } catch {
      retry = true;
      console.warn(`[naka] Could not deliver or update the result queue for ${job.id}.`);
    } finally {
      sending.delete(job.id);
      const delay = [1000, 3000, 10_000][attempt];
      if (retry && delay) setTimeout(() => void deliver(job, attempt + 1), delay).unref();
    }
  }

  function flush() {
    for (const job of jobs.values()) void deliver(job, 3);
  }
  setInterval(flush, 60_000).unref();
  flush();

  return {
    identify: token => post('identify', { token }),
    report(id, body) {
      const job = { id, body };
      jobs.set(id, job);
      try { save(jobs); }
      catch (error) {
        console.error('[naka] Could not persist pending results:', error.code ?? 'unknown error');
      }
      void deliver(job);
    },
  };
}
