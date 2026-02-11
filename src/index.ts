import { parseArgs } from '@std/cli/parse-args';
import {
  runConfigInitCommand,
  runConfigPathCommand,
  runConfigShowCommand,
} from './commands/config.ts';
import { runExportCommand } from './commands/export.ts';
import { runStatsCommand } from './commands/stats.ts';
import { runSyncCommand } from './commands/sync.ts';
import { loadDotEnvFromFile } from './utils/dotenv.ts';
import { formatError, logError } from './utils/logger.ts';

function usage(): string {
  return [
    'Usage:',
    '  xstash sync [--max-new <n|all>] [--media] [--confirm-cost] [--yes]',
    '  xstash export --format <md|csv|json> [--since <date>] [--until <date>] [--include-referenced] [-o <path>]',
    '  xstash config init [--callback-port <port>] [--no-browser] [--client-id <id>] [--client-secret <secret>]',
    '  xstash config show [--client-id <id>] [--client-secret <secret>] [--access-token <token>] [--refresh-token <token>] [--expires-at <iso>]',
    '  xstash config path',
    '  xstash stats',
  ].join('\n');
}

function parseAuthOverride(flags: ReturnType<typeof parseArgs>) {
  return {
    clientId: typeof flags['client-id'] === 'string' ? flags['client-id'] : undefined,
    clientSecret: typeof flags['client-secret'] === 'string' ? flags['client-secret'] : undefined,
    accessToken: typeof flags['access-token'] === 'string' ? flags['access-token'] : undefined,
    refreshToken: typeof flags['refresh-token'] === 'string' ? flags['refresh-token'] : undefined,
    expiresAt: typeof flags['expires-at'] === 'string' ? flags['expires-at'] : undefined,
  };
}

async function run(): Promise<void> {
  await loadDotEnvFromFile();

  const [command, ...rest] = Deno.args;
  if (!command || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }

  switch (command) {
    case 'sync': {
      const flags = parseArgs(rest, {
        string: [
          'max-new',
          'client-id',
          'client-secret',
          'access-token',
          'refresh-token',
          'expires-at',
        ],
        boolean: ['media', 'confirm-cost', 'yes'],
        default: {
          media: false,
          'confirm-cost': false,
          yes: false,
        },
      });

      await runSyncCommand({
        maxNewRaw: typeof flags['max-new'] === 'string' ? flags['max-new'] : undefined,
        media: Boolean(flags.media),
        confirmCost: Boolean(flags['confirm-cost']),
        yes: Boolean(flags.yes),
        authOverride: parseAuthOverride(flags),
      });
      break;
    }

    case 'export': {
      const flags = parseArgs(rest, {
        string: ['format', 'since', 'until', 'o', 'output'],
        boolean: ['include-referenced'],
        default: {
          'include-referenced': false,
        },
      });

      const format = flags.format;
      if (format !== 'md' && format !== 'csv' && format !== 'json') {
        throw new Error('--format must be one of md|csv|json');
      }

      await runExportCommand({
        format,
        since: typeof flags.since === 'string' ? flags.since : undefined,
        until: typeof flags.until === 'string' ? flags.until : undefined,
        includeReferenced: Boolean(flags['include-referenced']),
        output: typeof flags.output === 'string'
          ? flags.output
          : (typeof flags.o === 'string' ? flags.o : undefined),
      });
      break;
    }

    case 'config': {
      const [subcommand, ...subRest] = rest;
      if (!subcommand) {
        throw new Error('config subcommand is required: init|show|path');
      }

      if (subcommand === 'init') {
        const flags = parseArgs(subRest, {
          string: [
            'callback-port',
            'client-id',
            'client-secret',
            'access-token',
            'refresh-token',
            'expires-at',
          ],
          boolean: ['no-browser'],
          default: {
            'callback-port': '38080',
            'no-browser': false,
          },
        });

        const callbackPort = Number(flags['callback-port']);
        if (!Number.isInteger(callbackPort) || callbackPort <= 0 || callbackPort > 65535) {
          throw new Error('--callback-port must be an integer between 1 and 65535');
        }

        await runConfigInitCommand({
          callbackPort,
          noBrowser: Boolean(flags['no-browser']),
          authOverride: parseAuthOverride(flags),
        });
        return;
      }

      if (subcommand === 'show') {
        const flags = parseArgs(subRest, {
          string: ['client-id', 'client-secret', 'access-token', 'refresh-token', 'expires-at'],
        });
        await runConfigShowCommand(parseAuthOverride(flags));
        return;
      }

      if (subcommand === 'path') {
        runConfigPathCommand();
        return;
      }

      throw new Error(`Unknown config subcommand: ${subcommand}`);
    }

    case 'stats': {
      await runStatsCommand();
      break;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

if (import.meta.main) {
  run().catch((error) => {
    logError(formatError(error));
    Deno.exit(1);
  });
}
