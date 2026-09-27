#!/usr/bin/env node
import { Command, Option } from 'commander';
import { DEFAULT_DIR } from './log.js';
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
  return program;
}

/** `egress-tap [opts] -- <cmd>`: everything after `--` is the child, even if it is named `ls`. */
function runOnlyProgram(): Command {
  const cmd = new Command('egress-tap');
  addRunOptions(cmd).addOption(new Option('--version').hideHelp());
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
