import path from 'node:path';
import type { AppConfig } from '../config/environment';
import { createWorkDir, fileSize, findMediaFile, removeDir } from '../utils/fileManager';
import { logger } from '../utils/logger';
import { runProcess } from '../utils/process';
import { sanitizeFileName } from '../utils/validators';
import {
  DownloadCancelledError,
  FileTooLargeError,
  VerificationError,
  YouTubeAccessError,
} from './errors';
import type { DownloadResult, ProgressUpdate, QualityOption, VideoInfo } from './types';
import { isAccessBlockedText, lastLines } from './videoService';

export interface DownloadRunner {
  (
    args: string[],
    workDir: string,
    signal: AbortSignal,
    onProgress: (update: ProgressUpdate) => void,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
}

export interface ProbeResult {
  durationSeconds: number;
  formatName: string;
}

export type ProbeRunner = (filePath: string) => Promise<ProbeResult>;

interface QueueEntry {
  signal: AbortSignal;
  grant: () => void;
}

/** Converte linhas do yt-dlp em atualizações de progresso. */
export function parseProgressLine(line: string, onProgress: (update: ProgressUpdate) => void): void {
  if (/\[ffmpeg\]/i.test(line)) {
    onProgress({ percent: null, phase: 'processing' });
    return;
  }
  const match = line.match(/\[download\]\s+(\d{1,3}(?:\.\d+)?)%/);
  if (match) {
    const percent = Math.min(100, Math.max(0, Number(match[1])));
    onProgress({ percent, phase: 'download' });
  }
}

/** Seleção de formatos usa apenas IDs informados pelo yt-dlp nos metadados. */
export function buildDownloadArgs(
  quality: QualityOption,
  canonicalUrl: string,
  outputTemplate: string,
  config: AppConfig,
): string[] {
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-part',
    '--socket-timeout',
    '20',
    '--retries',
    '1',
    '--concurrent-fragments',
    '1',
    '--max-filesize',
    String(config.maxFileSizeBytes),
    '-o',
    outputTemplate,
  ];

  if (config.ffmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', config.ffmpegPath);
  }

  if (quality.isAudio) {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K');
  } else if (quality.key === 'best') {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  } else if (quality.formatId && quality.audioFormatId) {
    args.push('-f', `${quality.formatId}+${quality.audioFormatId}`, '--merge-output-format', 'mp4');
  } else if (quality.formatId) {
    args.push('-f', quality.formatId);
  } else {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  }

  args.push(canonicalUrl);
  return args;
}

export function mimeTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.mov':
      return 'video/quicktime';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.opus':
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

function createDefaultRunner(config: AppConfig): DownloadRunner {
  return async (args, workDir, signal, onProgress) => {
    let buffer = '';
    const consume = (chunk: string): void => {
      const lines = (buffer + chunk).split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) parseProgressLine(line, onProgress);
    };
    const outcome = await runProcess(config.ytDlpPath, args, {
      timeoutMs: config.downloadTimeoutMs,
      signal,
      cwd: workDir,
      maxOutputBytes: 3_000_000,
      onStdout: (chunk) => consume(chunk.toString('utf8')),
      onStderr: (chunk) => consume(chunk.toString('utf8')),
    });
    if (buffer.trim()) parseProgressLine(buffer, onProgress);
    return { code: outcome.code, signal: outcome.signal, stderr: outcome.stderr };
  };
}

function createDefaultProbe(config: AppConfig): ProbeRunner {
  return async (filePath) => {
    const outcome = await runProcess(
      config.ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration,format_name', '-of', 'json', filePath],
      { timeoutMs: 45_000, maxOutputBytes: 100_000 },
    );
    if (outcome.code !== 0) {
      throw new VerificationError('ffprobe não conseguiu validar o arquivo gerado.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.stdout);
    } catch {
      throw new VerificationError('A saída do ffprobe não pôde ser interpretada.');
    }
    const container = (parsed as { format?: { duration?: unknown; format_name?: unknown } })?.format;
    const durationSeconds = Number(container?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new VerificationError('O arquivo gerado não contém mídia válida.');
    }
    return {
      durationSeconds,
      formatName: String(container?.format_name ?? ''),
    };
  };
}

export class DownloadService {
  private readonly active = new Map<number, AbortController>();
  private readonly queue: QueueEntry[] = [];
  private running = 0;
  private readonly runDownload: DownloadRunner;
  private readonly probeFile: ProbeRunner;

  constructor(
    private readonly config: AppConfig,
    options: { runDownload?: DownloadRunner; probeFile?: ProbeRunner } = {},
  ) {
    this.runDownload = options.runDownload ?? createDefaultRunner(config);
    this.probeFile = options.probeFile ?? createDefaultProbe(config);
  }

  get activeCount(): number {
    return this.active.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  isActive(userId: number): boolean {
    return this.active.has(userId);
  }

  cancel(userId: number): boolean {
    const controller = this.active.get(userId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  private acquireSlot(signal: AbortSignal): Promise<void> {
    if (this.running < this.config.maxConcurrentDownloads) {
      this.running += 1;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.queue.findIndex((entry) => entry.signal === signal);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new DownloadCancelledError());
      };
      this.queue.push({
        signal,
        grant: () => {
          signal.removeEventListener('abort', onAbort);
          this.running += 1;
          resolve();
        },
      });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private releaseSlot(): void {
    const next = this.queue.shift();
    if (next) next.grant();
    else this.running -= 1;
  }

  async download(
    userId: number,
    videoInfo: VideoInfo,
    quality: QualityOption,
    onProgress: (update: ProgressUpdate) => void = () => undefined,
  ): Promise<DownloadResult> {
    if (this.active.has(userId)) {
      throw new Error('Você já possui um processamento em andamento.');
    }

    const controller = new AbortController();
    this.active.set(userId, controller);
    let workDir: string | undefined;
    let acquired = false;

    try {
      await this.acquireSlot(controller.signal);
      acquired = true;

      workDir = await createWorkDir(this.config.tempDir, `u${userId}-`);
      const baseName = sanitizeFileName(
        quality.isAudio ? `audio-${videoInfo.id}` : `${videoInfo.title} [${videoInfo.id}]`,
        'video',
        80,
      );
      const outputTemplate = path.join(workDir, `${baseName}.%(ext)s`);

      const outcome = await this.runDownload(
        buildDownloadArgs(quality, videoInfo.requestedUrl, outputTemplate, this.config),
        workDir,
        controller.signal,
        onProgress,
      );

      if (controller.signal.aborted) throw new DownloadCancelledError();
      if (outcome.signal) throw new Error('O download foi interrompido ou atingiu o timeout.');

      if (outcome.code !== 0) {
        const detail = lastLines(outcome.stderr);
        logger.warn('yt-dlp falhou no download', { detail });
        if (isAccessBlockedText(detail)) {
          throw new YouTubeAccessError(
            'O YouTube não permitiu o download deste vídeo. Este bot não contorna bloqueios ou restrições.',
          );
        }
        if (/larger than max-filesize|max-filesize/i.test(detail)) {
          throw new FileTooLargeError(quality.estimatedBytes ?? 0, this.config.maxFileSizeBytes);
        }
        throw new Error('Não foi possível processar o vídeo. Verifique se o conteúdo está disponível.');
      }

      const filePath = await findMediaFile(workDir);
      if (!filePath) throw new VerificationError('Nenhum arquivo de mídia foi gerado.');

      const bytes = await fileSize(filePath);
      if (bytes <= 0) throw new VerificationError('O arquivo gerado está vazio.');
      if (bytes > this.config.maxFileSizeBytes) {
        throw new FileTooLargeError(bytes, this.config.maxFileSizeBytes);
      }

      await this.probeFile(filePath);

      return {
        filePath,
        fileName: `${baseName}${path.extname(filePath)}`,
        bytes,
        workDir,
        quality,
        mimeType: mimeTypeFor(filePath),
      };
    } catch (error) {
      if (workDir) await removeDir(workDir).catch(() => undefined);
      throw error;
    } finally {
      this.active.delete(userId);
      if (acquired) this.releaseSlot();
    }
  }
}
