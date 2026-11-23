import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.mov',
  '.mp3',
  '.m4a',
  '.aac',
  '.opus',
  '.ogg',
]);

const TEMP_SUFFIXES = ['.part', '.ytdl', '.temp', '.tmp'];

export async function ensureDir(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

export async function createWorkDir(tempDir: string, prefix = 'job-'): Promise<string> {
  await ensureDir(tempDir);
  return fs.mkdtemp(path.join(tempDir, prefix));
}

export async function fileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/** Localiza o maior arquivo de mídia já finalizado dentro do diretório de trabalho. */
export async function findMediaFile(directory: string): Promise<string | null> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const candidates: Array<{ path: string; size: number }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (TEMP_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
    const extension = path.extname(name);
    if (!MEDIA_EXTENSIONS.has(extension)) continue;
    const fullPath = path.join(directory, entry.name);
    const size = await fileSize(fullPath);
    if (size > 0) candidates.push({ path: fullPath, size });
  }

  candidates.sort((left, right) => right.size - left.size);
  return candidates[0]?.path ?? null;
}

export async function removeDir(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true });
}

/** Remove diretórios temporários órfãos (por exemplo, após uma queda do processo). */
export async function cleanupOldDirs(tempDir: string, maxAgeMs: number): Promise<number> {
  await ensureDir(tempDir);
  const now = Date.now();
  let removed = 0;
  const entries = await fs.readdir(tempDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(tempDir, entry.name);
    try {
      const stats = await fs.stat(fullPath);
      if (now - stats.mtimeMs > maxAgeMs) {
        await removeDir(fullPath);
        removed += 1;
      }
    } catch {
      // Diretório pode ter sido removido por outra tarefa; seguir em frente.
    }
  }
  return removed;
}
