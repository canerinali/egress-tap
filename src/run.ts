import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { buildChildEnv } from './env.js';
import { createSession, DEFAULT_DIR, JsonlWriter } from './log.js';
import { startProxy, type ConnEvent } from './proxy.js';

export interface RunOptions {
  command: string;
  args: string[];
  dir?: string;
  name?: string;
  quiet?: boolean;
  /** Where our own messages go; defaults to process.stderr so the child's stdout stays clean. */
  stderr?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  exitCode: number;
  sessionId: string;
  sessionPath: string;
  events: ConnEvent[];
}

const FORWARDED: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

export function exitCodeFor(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal) return 128 + (constants.signals[signal] ?? 0);
  return 1;
}

/** Starts the proxy, runs the command behind it, records the session and returns the child's exit code. */
export async function runCommand(opts: RunOptions): Promise<RunResult> {
  const dir = opts.dir ?? DEFAULT_DIR;
  const err = opts.stderr ?? process.stderr;
  const session = createSession(dir, opts.name);
  const writer = new JsonlWriter(session.path);
  const events: ConnEvent[] = [];
  const proxy = await startProxy({
    onEvent: (e) => {
      events.push(e);
      writer.append(e);
    },
  });
  if (!opts.quiet) err.write(`egress-tap: proxy 127.0.0.1:${proxy.port} · session ${session.id}\n`);

  const env = buildChildEnv(opts.env ?? process.env, proxy.port, session.id);
  const exitCode = await new Promise<number>((resolve) => {
    let child;
    try {
      child = spawn(opts.command, opts.args, { stdio: 'inherit', env });
    } catch (e) {
      err.write(`egress-tap: failed to start ${opts.command}: ${(e as Error).message}\n`);
      resolve(127);
      return;
    }
    const handlers = new Map<NodeJS.Signals, () => void>();
    for (const sig of FORWARDED) {
      const h = (): void => {
        // An interactive Ctrl-C already reaches the child through the terminal's process
        // group; forwarding it again would count as a second press (many agents exit on that).
        if (sig === 'SIGINT' && process.stdin.isTTY) return;
        if (child.exitCode === null && child.signalCode === null) child.kill(sig);
      };
      handlers.set(sig, h);
      process.on(sig, h);
    }
    const cleanup = (): void => {
      for (const [sig, h] of handlers) process.off(sig, h);
    };
    child.once('error', (e: NodeJS.ErrnoException) => {
      cleanup();
      err.write(`egress-tap: failed to start ${opts.command}: ${e.code ?? e.message}\n`);
      resolve(e.code === 'ENOENT' ? 127 : 126);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolve(exitCodeFor(code, signal));
    });
  });

  await proxy.close();
  return { exitCode, sessionId: session.id, sessionPath: session.path, events };
}
