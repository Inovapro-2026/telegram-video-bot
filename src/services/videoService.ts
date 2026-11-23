import type { AppConfig } from '../config/environment';
import { logger } from '../utils/logger';
import { runProcess } from '../utils/process';
import type { ParsedYouTubeUrl } from '../utils/validators';
import { YouTubeAccessError } from './errors';
import { parseVideoInfo } from './formatService';
import type { VideoInfo } from './types';

const BLOCK_PATTERNS = [
  /sign in to confirm/i,
  /private video/i,
  /video unavailable/i,
  /this video is unavailable/i,
  /this video is not available/i,
  /http error 4\d\d/i,
  /http error 5\d\d/i,
  /too many requests/i,
  /age[- ]restricted/i,
  /geo ?block/i,
  /login required/i,
  /members[- ]only/i,
  /copyright/i,
];

export function lastLines(text: string, count = 5): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join(' | ')
    .slice(0, 500);
}

export function isAccessBlockedText(text: string): boolean {
  return BLOCK_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Consulta metadados e formatos reais do vídeo. Não usa cookies, proxies,
 * falsificação de identidade nem qualquer técnica de evasão de bloqueios.
 */
export async function fetchVideoInfo(
  parsedUrl: ParsedYouTubeUrl,
  config: AppConfig,
  signal?: AbortSignal,
): Promise<VideoInfo> {
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-playlist',
    '--skip-download',
    '--dump-single-json',
    '--socket-timeout',
    '20',
    '--retries',
    '0',
    parsedUrl.canonicalUrl,
  ];

  const outcome = await runProcess(config.ytDlpPath, args, {
    timeoutMs: config.metadataTimeoutMs,
    signal,
    maxOutputBytes: 4_000_000,
  });

  if (signal?.aborted) throw new Error('Consulta de metadados cancelada.');

  if (outcome.code !== 0) {
    const detail = lastLines(outcome.stderr || outcome.stdout);
    logger.warn('yt-dlp não conseguiu consultar o vídeo', { detail });
    if (isAccessBlockedText(detail)) {
      throw new YouTubeAccessError(
        'O YouTube não permitiu o acesso a este vídeo. Este bot não contorna bloqueios, DRM, login ou restrições de idade/região. Use apenas conteúdo próprio ou autorizado.',
      );
    }
    throw new Error('Não foi possível consultar as informações do vídeo.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(outcome.stdout);
  } catch {
    throw new Error('A resposta do yt-dlp não pôde ser interpretada.');
  }

  return parseVideoInfo(raw, parsedUrl.canonicalUrl, config.maxFileSizeBytes, config.enableMp3);
}
