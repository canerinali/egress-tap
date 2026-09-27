import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ConnEvent } from './proxy.js';

export const DEFAULT_DIR = '.egress-tap';
const EXT = '.jsonl';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `2026-09-27T14:03:11.123Z` -> `2026-09-27T14-03-11Z` (filesystem-safe, sortable). */
export function makeSessionId(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

export function isValidSessionName(name: string): boolean {
  return NAME_RE.test(name) && !name.endsWith(EXT);
}

export interface SessionFile {
  id: string;
  path: string;
}

/**
 * Creates `<dir>/<id>.jsonl` (empty) and returns it. When `name` is omitted the id is a
 * timestamp; a numeric suffix is added if a session with that id already exists.
 */
export function createSession(dir: string, name?: string, now: Date = new Date()): SessionFile {
  if (name !== undefined && !isValidSessionName(name)) {
    throw new Error(`invalid session name "${name}": use letters, digits, ".", "_" or "-"`);
  }
  mkdirSync(dir, { recursive: true });
  const base = name ?? makeSessionId(now);
  for (let i = 1; i < 1000; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    const file = path.join(dir, id + EXT);
    try {
      writeFileSync(file, '', { flag: 'wx' });
      return { id, path: file };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (name !== undefined) throw new Error(`session "${name}" already exists in ${dir}`);
    }
  }
  throw new Error(`could not allocate a session file in ${dir}`);
}

/** Appends one JSON line per event, synchronously, so nothing is lost if we are killed. */
export class JsonlWriter {
  constructor(readonly file: string) {}
  append(event: ConnEvent): void {
    appendFileSync(this.file, JSON.stringify(event) + '\n');
  }
}

const KINDS = new Set(['connect', 'http']);
const STATUSES = new Set(['ok', 'upstream_error', 'bad_request']);

function isEvent(v: unknown): v is ConnEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e['host'] === 'string' &&
    e['host'] !== '' &&
    typeof e['port'] === 'number' &&
    typeof e['ts'] === 'string' &&
    KINDS.has(e['kind'] as string) &&
    STATUSES.has(e['status'] as string)
  );
}

/** Parses JSONL, silently skipping blank, truncated or foreign lines. */
export function parseJsonl(text: string): ConnEvent[] {
  const out: ConnEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isEvent(parsed)) {
        out.push({
          ...parsed,
          method: typeof parsed.method === 'string' ? parsed.method : '',
          bytesUp: Number(parsed.bytesUp) || 0,
          bytesDown: Number(parsed.bytesDown) || 0,
          durationMs: Number(parsed.durationMs) || 0,
        });
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export interface SessionInfo {
  id: string;
  path: string;
  mtimeMs: number;
}

/** Sessions in `dir`, newest first. Missing dir -> empty list. */
export function listSessions(dir: string): SessionInfo[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const n of names) {
    if (!n.endsWith(EXT)) continue;
    const p = path.join(dir, n);
    try {
      const st = statSync(p);
      if (st.isFile()) out.push({ id: n.slice(0, -EXT.length), path: p, mtimeMs: st.mtimeMs });
    } catch {
      // raced with deletion
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export interface Session {
  id: string;
  path: string;
  events: ConnEvent[];
}

/** Reads a session by id, or the most recently modified one for `latest`. */
export function readSession(dir: string, ref = 'latest'): Session {
  let id = ref;
  if (ref === 'latest') {
    const newest = listSessions(dir)[0];
    if (!newest) throw new Error(`no sessions found in ${dir} (run \`egress-tap -- <cmd>\` first)`);
    id = newest.id;
  } else if (id.endsWith(EXT)) {
    id = path.basename(id, EXT);
  }
  if (!isValidSessionName(id)) throw new Error(`invalid session id "${ref}"`);
  const file = path.join(dir, id + EXT);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`session "${id}" not found in ${dir} (see \`egress-tap ls\`)`);
  }
  return { id, path: file, events: parseJsonl(text) };
}

/** Hosts seen in sessions older (by mtime) than `id` in the same directory. */
export function previousHosts(dir: string, id: string): { hosts: Set<string>; sessions: number } {
  const all = listSessions(dir);
  const idx = all.findIndex((s) => s.id === id);
  const older = idx >= 0 ? all.slice(idx + 1) : all.filter((s) => s.id !== id);
  const hosts = new Set<string>();
  for (const s of older) {
    try {
      for (const e of parseJsonl(readFileSync(s.path, 'utf8'))) hosts.add(e.host.toLowerCase());
    } catch {
      // unreadable file: skip
    }
  }
  return { hosts, sessions: older.length };
}
