import { spawn } from 'node:child_process';

export interface ProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}

export class ProcessStartError extends Error {
  public readonly name = 'ProcessStartError';
}

function appendCapped(current: string, chunk: Buffer, maxBytes: number): string {
  const combined = Buffer.from(current + chunk.toString('utf8'));
  if (combined.length <= maxBytes) return combined.toString('utf8');
  return combined.subarray(combined.length - maxBytes).toString('utf8');
}

/** Executa um binário sem shell, com timeout, cancelamento e saída limitada. */
export function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessOutcome> {
  const maxOutputBytes = options.maxOutputBytes ?? 2_000_000;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: options.cwd,
        env: options.env,
      });
    } catch (error) {
      reject(new ProcessStartError(error instanceof Error ? error.message : String(error)));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let forceKill: NodeJS.Timeout | undefined;

    const terminate = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Processo já encerrado.
      }
      if (!forceKill) {
        forceKill = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Processo já encerrado.
          }
        }, 3000);
        forceKill.unref?.();
      }
    };

    const onAbort = (): void => terminate();

    const cleanup = (): void => {
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk, maxOutputBytes);
      options.onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk, maxOutputBytes);
      options.onStderr?.(chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProcessStartError(error.message));
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, signal, stdout, stderr });
    });

    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort);

    timeout = setTimeout(terminate, options.timeoutMs);
  });
}
