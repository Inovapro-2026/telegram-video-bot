export type QualityKey = '360' | '480' | '720' | '1080' | 'best' | 'mp3';

export interface QualityOption {
  key: QualityKey;
  label: string;
  height: number | null;
  formatId?: string;
  audioFormatId?: string;
  ext: string;
  estimatedBytes: number | null;
  needsMerge: boolean;
  isAudio: boolean;
}

export interface VideoInfo {
  id: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  qualities: QualityOption[];
  requestedUrl: string;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  bytes: number;
  workDir: string;
  quality: QualityOption;
  mimeType: string;
}

export interface ProgressUpdate {
  percent: number | null;
  phase: 'download' | 'processing';
}
