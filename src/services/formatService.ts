import { formatDuration } from '../utils/validators';
import type { QualityKey, QualityOption, VideoInfo } from './types';

interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  height?: number | null;
  width?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
  protocol?: string | null;
  format_note?: string | null;
  fps?: number | null;
  language?: string | null;
}

interface YtDlpThumbnail {
  url?: string;
  width?: number;
  height?: number;
}

export interface YtDlpInfo {
  id?: string;
  title?: string;
  language?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  thumbnails?: YtDlpThumbnail[];
  formats?: YtDlpFormat[];
}

const TARGET_HEIGHTS: Array<{ height: number; key: QualityKey; label: string }> = [
  { height: 360, key: '360', label: '360p' },
  { height: 480, key: '480', label: '480p' },
  { height: 720, key: '720', label: '720p HD' },
  { height: 1080, key: '1080', label: '1080p Full HD' },
];

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'opus', 'vorbis', 'flac', 'webm']);

function isUsable(format: YtDlpFormat): boolean {
  if (!format.format_id || !format.ext) return false;
  if (/storyboard|image/i.test(format.format_note ?? '')) return false;
  const protocol = (format.protocol ?? '').toLowerCase();
  if (!protocol.includes('http') || protocol.includes('drm')) return false;
  const ext = format.ext.toLowerCase();
  return VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext);
}

function isVideo(format: YtDlpFormat): boolean {
  return (
    format.vcodec != null &&
    format.vcodec !== 'none' &&
    typeof format.height === 'number' &&
    format.height > 0
  );
}

function hasAudio(format: YtDlpFormat): boolean {
  return format.acodec != null && format.acodec !== 'none';
}

function estimateBytes(format: YtDlpFormat, durationSeconds: number): number | null {
  const explicit = format.filesize ?? format.filesize_approx;
  if (typeof explicit === 'number' && explicit > 0) return Math.round(explicit);
  if (typeof format.tbr === 'number' && format.tbr > 0 && durationSeconds > 0) {
    return Math.round((format.tbr * 1000 * durationSeconds) / 8);
  }
  return null;
}

function summedEstimate(formats: YtDlpFormat[], durationSeconds: number): number | null {
  const estimates = formats.map((format) => estimateBytes(format, durationSeconds));
  if (estimates.some((value) => value === null)) return null;
  return estimates.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function rank(format: YtDlpFormat, preferredLanguage?: string | null): number {
  let score =
    (format.tbr ?? 0) +
    (format.ext?.toLowerCase() === 'mp4' ? 50 : 0) +
    (format.fps && format.fps <= 30 ? 10 : 0);

  const note = (format.format_note ?? '').toLowerCase();
  const language = (format.language ?? '').toLowerCase();
  const preferred = (preferredLanguage ?? '').toLowerCase();

  if (preferred) {
    const primary = preferred.split('-')[0];
    if (language === preferred || language === primary || language.startsWith(`${primary}-`)) {
      score += 1000;
    }
  }
  if (/\boriginal\b|\bdefault\b/.test(note)) score += 500;
  if (/dubbed|auto-dub/i.test(note)) score -= 300;

  return score;
}

function bestByRank(
  formats: YtDlpFormat[],
  preferredLanguage?: string | null,
): YtDlpFormat | undefined {
  return [...formats].sort(
    (left, right) => rank(right, preferredLanguage) - rank(left, preferredLanguage),
  )[0];
}

/** Constrói apenas opções apoiadas em formatos reais informados pelo yt-dlp. */
export function selectQualityOptions(
  info: YtDlpInfo,
  maxFileSizeBytes: number,
  enableMp3: boolean,
): QualityOption[] {
  const formats = Array.isArray(info.formats) ? info.formats.filter(isUsable) : [];
  const durationSeconds = Math.max(0, Math.floor(Number(info.duration) || 0));
  const videoFormats = formats.filter(isVideo);
  const audioFormats = formats.filter((format) => !isVideo(format) && hasAudio(format));
  const bestAudio = bestByRank(audioFormats, info.language);
  const options: QualityOption[] = [];

  for (const target of TARGET_HEIGHTS) {
    const progressive = bestByRank(
      videoFormats.filter((format) => hasAudio(format) && format.height === target.height),
    );
    const videoOnly = bestByRank(
      videoFormats.filter((format) => !hasAudio(format) && format.height === target.height),
    );

    const progressiveEstimate = progressive ? estimateBytes(progressive, durationSeconds) : null;
    const separateEstimate =
      videoOnly && bestAudio ? summedEstimate([videoOnly, bestAudio], durationSeconds) : null;
    const progressiveTooLarge =
      progressiveEstimate !== null && progressiveEstimate > maxFileSizeBytes;

    let chosen: YtDlpFormat | undefined;
    let audio: YtDlpFormat | undefined;

    if (progressive && (!progressiveTooLarge || !videoOnly)) {
      chosen = progressive;
    } else if (videoOnly && bestAudio) {
      chosen = videoOnly;
      audio = bestAudio;
    } else if (progressive) {
      chosen = progressive;
    }

    if (!chosen) continue;

    let estimatedBytes = audio
      ? summedEstimate([chosen, audio], durationSeconds)
      : estimateBytes(chosen, durationSeconds);

    if (progressive && chosen === progressive && !audio && progressiveTooLarge && separateEstimate) {
      estimatedBytes = separateEstimate;
    }

    options.push({
      key: target.key,
      label: target.label,
      height: target.height,
      formatId: chosen.format_id,
      audioFormatId: audio?.format_id,
      ext: chosen.ext?.toLowerCase() ?? 'mp4',
      estimatedBytes,
      needsMerge: Boolean(audio),
      isAudio: false,
    });
  }

  if (videoFormats.length > 0) {
    const highest = [...options]
      .filter((option) => option.height !== null)
      .sort((left, right) => (right.height ?? 0) - (left.height ?? 0))[0];
    options.push({
      key: 'best',
      label: 'Melhor qualidade disponível',
      height: null,
      ext: highest?.ext ?? 'mp4',
      estimatedBytes: highest?.estimatedBytes ?? null,
      needsMerge: true,
      isAudio: false,
    });
  }

  if (enableMp3 && bestAudio) {
    const audioEstimate = estimateBytes(bestAudio, durationSeconds);
    options.push({
      key: 'mp3',
      label: 'Extrair áudio MP3',
      height: null,
      formatId: bestAudio.format_id,
      ext: 'mp3',
      estimatedBytes: audioEstimate === null ? null : Math.round(audioEstimate * 0.8),
      needsMerge: false,
      isAudio: true,
    });
  }

  return options;
}

export function pickThumbnail(info: YtDlpInfo): string | null {
  const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  const usable = thumbnails.filter(
    (thumb) => typeof thumb.url === 'string' && thumb.url.startsWith('https://'),
  );
  const preferred =
    usable.find((thumb) => (thumb.width ?? 0) >= 480) ??
    usable.find((thumb) => (thumb.width ?? 0) >= 320) ??
    usable[0];
  if (preferred?.url) return preferred.url;
  return typeof info.thumbnail === 'string' && info.thumbnail.startsWith('https://')
    ? info.thumbnail
    : null;
}

export function parseVideoInfo(
  raw: unknown,
  canonicalUrl: string,
  maxFileSizeBytes: number,
  enableMp3: boolean,
): VideoInfo {
  if (!raw || typeof raw !== 'object') throw new Error('Metadados inválidos recebidos do yt-dlp.');
  const info = raw as YtDlpInfo;
  if (!info.id || !info.title) throw new Error('Metadados incompletos recebidos do yt-dlp.');

  const durationSeconds = Math.max(0, Math.floor(Number(info.duration) || 0));
  return {
    id: info.id,
    title: info.title.slice(0, 180),
    durationSeconds,
    thumbnailUrl: pickThumbnail(info),
    qualities: selectQualityOptions(info, maxFileSizeBytes, enableMp3),
    requestedUrl: canonicalUrl,
  };
}

export { formatDuration };
