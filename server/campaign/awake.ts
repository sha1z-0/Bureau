import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Keeps Windows from sleeping while a campaign is inside its active hours.
 *
 * A tiny hidden PowerShell process calls SetThreadExecutionState with
 * ES_CONTINUOUS | ES_SYSTEM_REQUIRED and then blocks reading stdin. The
 * request lives exactly as long as that process: we release it by killing the
 * process, and if Bureau dies the pipe closes and PowerShell exits on its own,
 * so the PC can never be left awake by accident. The display may still turn
 * off. Other platforms: no-op. Start-with-Windows (services/autostart.ts) is
 * untouched.
 */

const SCRIPT = [
  "$sig = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
  "$k = Add-Type -MemberDefinition $sig -Name 'Awake' -Namespace 'Bureau' -PassThru",
  // 0x80000001 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  '[void]$k::SetThreadExecutionState([uint32]2147483649)',
  'while ($null -ne [Console]::In.ReadLine()) { }',
  '[void]$k::SetThreadExecutionState([uint32]2147483648)',
].join('; ');

export const AWAKE_SCRIPT = SCRIPT;

export function encodedCommand(script = SCRIPT): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export type Spawner = (cmd: string, args: string[]) => Pick<ChildProcess, 'kill' | 'once' | 'pid'> & { stdin?: { end(): void } | null };

export interface KeepAwake {
  hold(): void;
  release(): void;
  readonly held: boolean;
}

export function createKeepAwake(opts: { platform?: NodeJS.Platform; spawner?: Spawner } = {}): KeepAwake {
  // Offline / selfcheck runs never spawn a real helper unless a test injects one.
  const platform = opts.platform ?? (process.env.BUREAU_REPLAY === '1' ? 'linux' : process.platform);
  const spawner: Spawner =
    opts.spawner ??
    ((cmd, args) => spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, detached: false }));
  let child: ReturnType<Spawner> | null = null;

  const release = () => {
    if (!child) return;
    const c = child;
    child = null;
    try {
      c.stdin?.end();
    } catch {
      /* already closed */
    }
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  };

  return {
    get held() {
      return !!child;
    },
    hold() {
      if (platform !== 'win32' || child) return;
      try {
        const c = spawner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand()]);
        child = c;
        c.once('exit', () => {
          if (child === c) child = null;
        });
        c.once('error', () => {
          if (child === c) child = null;
        });
      } catch {
        child = null;
      }
    },
    release,
  };
}
