#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command, InvalidArgumentError, Option } from 'commander';
import { analyze } from './analyze.js';
import { claudePatterns, emitClaude, missingDomains, readAllowedDomains } from './emit/claude.js';
import { codexPattern, emitCodex } from './emit/codex.js';
import { explainRules } from './emit/explain.js';
import { emitJson } from './emit/json.js';
import { DEFAULT_DIR, readSession } from './log.js';
import { DEFAULT_WILDCARD_MIN } from './wildcard.js';
import { runCommand } from './run.js';
import { VERSION } from './version.js';

const SUBCOMMANDS = new Set(['emit', 'report', 'ls', 'help']);

interface RunCliOptions {
  name?: string;
  dir: string;
  quiet?: boolean;
}

function addRunOptions(cmd: Command): Command {
  return cmd
    .option('--name <id>', 'session id (default: UTC timestamp)')
    .option('--dir <dir>', 'directory for session logs', DEFAULT_DIR)
    .option('-q, --quiet', 'do not print the banner and summary');
}

async function doRun(argv: string[], opts: RunCliOptions): Promise<void> {
  const [command, ...args] = argv;
  if (!command) throw new Error('missing command: egress-tap [options] -- <cmd> [args...]');
  const result = await runCommand({ command, args, dir: opts.dir, name: opts.name, quiet: opts.quiet });
  if (!opts.quiet) {
    const hosts = new Set(result.events.map((e) => e.host)).size;
    process.stderr.write(
      `egress-tap: ${hosts} host${hosts === 1 ? '' : 's'}, ${result.events.length} connection${
        result.events.length === 1 ? '' : 's'
      } -> ${result.sessionPath}\n`,
    );
  }
  process.exit(result.exitCode);
}

export function buildProgram(): Command {
  const program = new Command('egress-tap')
    .version(VERSION)
    .description(
      'Record every host your AI coding agent contacts, then emit a least-privilege Claude Code / Codex network allowlist.',
    )
    .usage('[options] -- <cmd> [args...]')
    .argument('[cmd...]', 'command to run behind the observing proxy')
    .enablePositionalOptions()
    .passThroughOptions();
  addRunOptions(program).action(async (cmd: string[], opts: RunCliOptions) => {
    if (cmd.length === 0) program.help({ error: true });
    await doRun(cmd, opts);
  });

  program
    .command('emit')
    .description('print a network allowlist derived from a recorded session')
    .argument('[session]', 'session id, or "latest"', 'latest')
    .addOption(new Option('--format <format>', 'output format').choices(['claude', 'codex', 'json']).default('claude'))
    .option('--wildcard-min <n>', 'distinct hosts under one base domain before it is wildcarded', parseMin, DEFAULT_WILDCARD_MIN)
    .option('--include-agent-hosts', "keep the agent's own API/telemetry hosts in the allowlist")
    .option('--against <settings.json>', 'print only domains missing from this Claude Code settings file')
    .option('--dir <dir>', 'directory for session logs', DEFAULT_DIR)
    .action((ref: string, opts: EmitCliOptions) => {
      const session = readSession(opts.dir, ref);
      const analysis = analyze(session.events, {
        wildcardMin: opts.wildcardMin,
        includeAgentHosts: Boolean(opts.includeAgentHosts),
      });
      if (opts.against !== undefined) {
        if (opts.format !== 'claude') throw new Error('--against only works with --format claude');
        const existing = readAllowedDomains(readFileSync(opts.against, 'utf8'));
        const missing = missingDomains(analysis.rules, existing);
        for (const d of missing) process.stdout.write(`+ ${d}\n`);
        process.stderr.write(
          missing.length === 0
            ? `egress-tap: nothing to add, ${opts.against} already covers session ${session.id}\n`
            : `egress-tap: ${missing.length} domain${missing.length === 1 ? '' : 's'} not covered by ${opts.against}\n`,
        );
        process.stderr.write(explainRules(analysis, (r) => claudePatterns(r).join(', ')));
        return;
      }
      if (opts.format === 'json') {
        process.stdout.write(emitJson(session.id, analysis));
        return;
      }
      if (opts.format === 'codex') {
        process.stdout.write(
          emitCodex(analysis.rules, {
            sessionId: session.id,
            connections: analysis.connections,
            hosts: analysis.hosts.length,
            excludedAgentHosts: analysis.excludedAgentHosts,
          }),
        );
        process.stderr.write(explainRules(analysis, codexPattern));
        return;
      }
      process.stdout.write(emitClaude(analysis.rules));
      process.stderr.write(explainRules(analysis, (r) => claudePatterns(r).join(', ')));
    });

  return program;
}

interface EmitCliOptions {
  format: 'claude' | 'codex' | 'json';
  wildcardMin: number;
  includeAgentHosts?: boolean;
  against?: string;
  dir: string;
}

function parseMin(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2) throw new InvalidArgumentError('must be an integer >= 2');
  return n;
}

/** `egress-tap [opts] -- <cmd>`: everything after `--` is the child, even if it is named `ls`. */
function runOnlyProgram(): Command {
  const cmd = new Command('egress-tap');
  addRunOptions(cmd);
  return cmd;
}

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const dd = args.indexOf('--');
  if (dd >= 0 && !(args[0] !== undefined && SUBCOMMANDS.has(args[0]))) {
    const prefix = args.slice(0, dd);
    if (prefix.some((a) => a === '--help' || a === '-h' || a === '--version' || a === '-V')) {
      await buildProgram().parseAsync(['node', 'egress-tap', ...prefix]);
      return;
    }
    const runCmd = runOnlyProgram();
    runCmd.parse(['node', 'egress-tap', ...prefix]);
    await doRun(args.slice(dd + 1), runCmd.opts<RunCliOptions>());
    return;
  }
  await buildProgram().parseAsync(argv);
}

main(process.argv).catch((err: unknown) => {
  process.stderr.write(`egress-tap: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
