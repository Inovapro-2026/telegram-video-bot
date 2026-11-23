import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { configureLoggerSecrets } from '../utils/logger';

export const projectRoot = path.resolve(__dirname, '..', '..');

export interface AppConfig {
  token: string;
  maxFileSizeBytes: number;
  maxFileSizeMB: number;
  maxConcurrentDownloads: number;
  downloadTimeoutMs: number;
  metadataTimeoutMs: number;
  tempDir: string;
  tempMaxAgeMs: number;
  allowedUserIds: Set<number> | null;
  enableMp3: boolean;
  dropPendingUpdates: boolean;
  maxRequestsPerMinute: number;
  sessionTtlMs: number;
  ytDlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return dotenv.parse(fs.readFileSync(filePath));
  } catch {
    return {};
  }
}

/** Carrega o .env do projeto e, como fallback somente do token, o .env da pasta pai. */
function applyLocalEnv(): void {
  const local = readEnvFile(path.join(projectRoot, '.env'));
  const parent = readEnvFile(path.resolve(projectRoot, '..', '.env'));

  if (!local.TELEGRAM_BOT_TOKEN && parent.TELEGRAM_BOT_TOKEN) {
    local.TELEGRAM_BOT_TOKEN = parent.TELEGRAM_BOT_TOKEN;
  }

  const merged: Record<string, string> = { ...parent, ...local };
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function readString(name: string, fallback: string): string {
  return (process.env[name] ?? fallback).trim();
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Variável ${name} inválida: esperado inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Variável ${name} inválida: use true ou false.`);
}

function readAllowedUsers(): Set<number> | null {
  const raw = readString('ALLOWED_USER_IDS', '');
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('ALLOWED_USER_IDS inválida: use IDs numéricos separados por vírgula.');
  }
  return new Set(ids);
}

applyLocalEnv();

const token = readString('TELEGRAM_BOT_TOKEN', '');
if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
  throw new Error('TELEGRAM_BOT_TOKEN ausente ou inválido. Configure a variável de ambiente.');
}
configureLoggerSecrets([token]);

const maxFileSizeMB = readInt('MAX_FILE_SIZE_MB', 47, 1, 2000);
const tempDirRaw = readString('TEMP_DIR', 'temp');
const timeoutSeconds = readInt('DOWNLOAD_TIMEOUT_SECONDS', 900, 30, 7200);

export const config: AppConfig = {
  token,
  maxFileSizeMB,
  maxFileSizeBytes: maxFileSizeMB * 1024 * 1024,
  maxConcurrentDownloads: readInt('MAX_CONCURRENT_DOWNLOADS', 1, 1, 8),
  downloadTimeoutMs: timeoutSeconds * 1000,
  metadataTimeoutMs: Math.min(timeoutSeconds * 1000, 120_000),
  tempDir: path.isAbsolute(tempDirRaw) ? tempDirRaw : path.resolve(projectRoot, tempDirRaw),
  tempMaxAgeMs: readInt('TEMP_MAX_AGE_HOURS', 6, 1, 168) * 60 * 60 * 1000,
  allowedUserIds: readAllowedUsers(),
  enableMp3: readBool('ENABLE_MP3', true),
  dropPendingUpdates: readBool('DROP_PENDING_UPDATES', true),
  maxRequestsPerMinute: readInt('MAX_REQUESTS_PER_MINUTE', 5, 1, 120),
  sessionTtlMs: readInt('SESSION_TTL_MINUTES', 15, 1, 1440) * 60 * 1000,
  ytDlpPath: readString('YT_DLP_PATH', 'yt-dlp'),
  ffmpegPath: readString('FFMPEG_PATH', 'ffmpeg'),
  ffprobePath: readString('FFPROBE_PATH', 'ffprobe'),
};
