type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const secrets = new Set<string>();

/** Registra valores que nunca devem aparecer nos logs (ex.: token do bot). */
export function configureLoggerSecrets(values: Array<string | undefined>): void {
  for (const value of values) {
    if (value && value.length >= 6) secrets.add(value);
  }
}

/** Remove tokens e quebras de linha antes de escrever qualquer mensagem. */
export function redact(text: string): string {
  let output = text.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '<token-redacted>');
  for (const secret of secrets) {
    output = output.split(secret).join('<redacted>');
  }
  return output.replace(/[\r\n]+/g, ' | ');
}

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message).slice(0, 600);
}

function serializeMeta(meta: unknown): string {
  if (meta === undefined) return '';
  try {
    return ` ${redact(JSON.stringify(meta))}`;
  } catch {
    return ' [metadados ilegíveis]';
  }
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${level} ${redact(message)}${serializeMeta(meta)}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, meta?: unknown): void => write('INFO', message, meta),
  warn: (message: string, meta?: unknown): void => write('WARN', message, meta),
  error: (message: string, meta?: unknown): void => write('ERROR', message, meta),
  debug: (message: string, meta?: unknown): void => {
    if (process.env.LOG_LEVEL === 'DEBUG') write('DEBUG', message, meta);
  },
};
