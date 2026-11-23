const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  DownloadService,
  buildDownloadArgs,
  parseProgressLine,
} = require('../dist/services/downloadService.js');
const { DownloadCancelledError, FileTooLargeError } = require('../dist/services/errors.js');
const { removeDir } = require('../dist/utils/fileManager.js');

function fakeConfig(root, overrides = {}) {
  return {
    tempDir: root,
    maxFileSizeBytes: 1024 * 1024,
    downloadTimeoutMs: 60_000,
    ytDlpPath: 'yt-dlp',
    ffmpegPath: 'ffmpeg',
    maxConcurrentDownloads: 1,
    ...overrides,
  };
}

const videoInfo = {
  id: 'aqz-KE-bpKQ',
  title: 'Vídeo de teste',
  requestedUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  qualities: [],
  durationSeconds: 10,
  thumbnailUrl: null,
};

const quality = {
  key: '360',
  label: '360p',
  height: 360,
  formatId: '18',
  ext: 'mp4',
  estimatedBytes: 1024,
  needsMerge: false,
  isAudio: false,
};

const probeFile = async () => ({ durationSeconds: 10, formatName: 'mov,mp4' });

test('monta argumentos sem shell e sem cookies ou proxies', () => {
  const args = buildDownloadArgs(
    quality,
    videoInfo.requestedUrl,
    '/tmp/job/video.%(ext)s',
    fakeConfig('/tmp/job'),
  );
  assert.ok(args.includes('--ignore-config'));
  assert.ok(args.includes('--no-playlist'));
  assert.ok(args.includes('--max-filesize'));
  assert.ok(args.includes('18'));
  assert.equal(args.some((arg) => /cookie|proxy|geo-bypass/i.test(arg)), false);
  assert.equal(args[args.length - 1], videoInfo.requestedUrl);
});

test('interpreta progresso do yt-dlp', () => {
  const updates = [];
  parseProgressLine('[download]  45.2% of ~ 10.00MiB at 1.00MiB/s', (u) => updates.push(u));
  parseProgressLine('[ffmpeg] Merging formats into "video.mp4"', (u) => updates.push(u));
  assert.equal(updates[0].percent, 45.2);
  assert.equal(updates[0].phase, 'download');
  assert.equal(updates[1].phase, 'processing');
});

test('respeita concorrência e limpa após a entrega', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-dl-'));
  t.after(async () => removeDir(root));

  let activeRunners = 0;
  let maxRunners = 0;
  const runDownload = async (args, workDir, signal, onProgress) => {
    activeRunners += 1;
    maxRunners = Math.max(maxRunners, activeRunners);
    await fs.writeFile(path.join(workDir, 'out.mp4'), Buffer.alloc(1024, 7));
    onProgress({ percent: 50, phase: 'download' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    activeRunners -= 1;
    return { code: 0, signal: null, stderr: '' };
  };

  const service = new DownloadService(fakeConfig(root), { runDownload, probeFile });
  const first = service.download(1, videoInfo, quality);
  const second = service.download(2, videoInfo, quality);
  assert.equal(service.activeCount, 2);
  assert.equal(service.queuedCount, 1);

  const [resultOne, resultTwo] = await Promise.all([first, second]);
  assert.equal(maxRunners, 1);
  assert.equal(service.activeCount, 0);
  assert.ok((await fs.stat(resultOne.filePath)).size === 1024);
  assert.ok((await fs.stat(resultTwo.filePath)).size === 1024);
  await removeDir(resultOne.workDir);
  await removeDir(resultTwo.workDir);
});

test('cancelamento interrompe a tarefa e remove o diretório', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-cancel-'));
  t.after(async () => removeDir(root));

  let capturedDir = null;
  const runDownload = async (args, workDir, signal) => {
    capturedDir = workDir;
    if (signal.aborted) return { code: null, signal: 'SIGTERM', stderr: '' };
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ code: null, signal: 'SIGTERM', stderr: '' }), {
        once: true,
      });
    });
  };

  const service = new DownloadService(fakeConfig(root), { runDownload, probeFile });
  const pending = service.download(7, videoInfo, quality);
  assert.equal(service.cancel(7), true);
  await assert.rejects(pending, DownloadCancelledError);
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (capturedDir) await assert.rejects(fs.stat(capturedDir));
  assert.equal(service.activeCount, 0);
});

test('trata falha do ffmpeg/yt-dlp e remove os temporários', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-ffmpeg-'));
  t.after(async () => removeDir(root));

  let capturedDir = null;
  const runDownload = async (args, workDir) => {
    capturedDir = workDir;
    return { code: 1, signal: null, stderr: '[ffmpeg] ffmpeg: comando não encontrado' };
  };
  const service = new DownloadService(fakeConfig(root), { runDownload, probeFile });
  await assert.rejects(service.download(11, videoInfo, quality), /Não foi possível processar/);
  await assert.rejects(fs.stat(capturedDir));
});

test('rejeita arquivo acima do limite e remove os temporários', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-size-'));
  t.after(async () => removeDir(root));

  let capturedDir = null;
  const runDownload = async (args, workDir) => {
    capturedDir = workDir;
    await fs.writeFile(path.join(workDir, 'grande.mp4'), Buffer.alloc(2048, 1));
    return { code: 0, signal: null, stderr: '' };
  };

  const service = new DownloadService(fakeConfig(root, { maxFileSizeBytes: 1024 }), {
    runDownload,
    probeFile,
  });
  await assert.rejects(service.download(9, videoInfo, quality), FileTooLargeError);
  await assert.rejects(fs.stat(capturedDir));
});
