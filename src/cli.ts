#!/usr/bin/env node
import { Command } from 'commander';
import { VERSION } from './version.js';

export function buildProgram(): Command {
  const program = new Command('egress-tap')
    .version(VERSION)
    .description(
      'Record every host your AI coding agent contacts, then emit a least-privilege Claude Code / Codex network allowlist.',
    );
  return program;
}

buildProgram().parse(process.argv);
