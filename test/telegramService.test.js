const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { sendDownloadedFile } = require('../dist/services/telegramService.js');
const { TelegramFileTooLargeError } = require('../dist/services/errors.js');
const { removeDir } = require('../dist/utils/fileManager.js');

const originalFetch = global.fetch;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const TEST_TOKEN = '000000:TEST_TOKEN_SEM_REDE';

function fakeResponse({ ok = true, status = 200, body = { ok: true, result: { message_id: 1 } } } = {}) {
  return { ok, status, json: async () => body };
}

function methodFromUrl(url) {
  return new URL(String(url)).pathname.split('/').pop();
}

function restoreFetch(t) {
  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  });
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
}

async function makeResult(root, overrides = {}) {
  const filePath = path.join(root, 'video.mp4');
  await fs.writeFile(filePath, Buffer.alloc(64, 1));
  return {
    filePath,
    fileName: 'video.mp4',
    bytes: 64,
    workDir: root,
    quality: { isAudio: false, label: '360p' },
    mimeType: 'video/mp4',
    ...overrides,
  };
}

test('envia vídeo uma única vez quando o Telegram aceita', async (t) => {
  restoreFetch(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-tg-ok-'));
  t.after(async () => removeDir(root));
  const result = await makeResult(root);
  const calls = [];
  global.fetch = async (url) => {
    calls.push(methodFromUrl(url));
    return fakeResponse();
  };

  await sendDownloadedFile({}, 1, result, 'legenda');

  assert.deepEqual(calls, ['sendVideo']);
});

test('não tenta reenviar quando o Telegram recusa por tamanho', async (t) => {
  restoreFetch(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-tg-size-'));
  t.after(async () => removeDir(root));
  const result = await makeResult(root);
  const calls = [];
  global.fetch = async (url) => {
    const method = methodFromUrl(url);
    calls.push(method);
    if (method === 'sendVideo') {
      return fakeResponse({
        ok: false,
        status: 413,
        body: { ok: false, error_code: 413, description: 'Request Entity Too Large' },
      });
    }
    return fakeResponse();
  };

  await assert.rejects(
    sendDownloadedFile({}, 1, result, 'legenda'),
    TelegramFileTooLargeError,
  );
  assert.deepEqual(calls, ['sendVideo']);
});

test('usa documento uma única vez se o formato de vídeo não for reproduzível', async (t) => {
  restoreFetch(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-tg-fallback-'));
  t.after(async () => removeDir(root));
  const result = await makeResult(root);
  const calls = [];
  global.fetch = async (url) => {
    const method = methodFromUrl(url);
    calls.push(method);
    if (method === 'sendVideo') {
      return fakeResponse({
        ok: false,
        status: 400,
        body: { ok: false, error_code: 400, description: 'unsupported video type' },
      });
    }
    return fakeResponse();
  };

  await sendDownloadedFile({}, 1, result, 'legenda');

  assert.deepEqual(calls, ['sendVideo', 'sendDocument']);
});

test('usa documento uma única vez se o envio de áudio falhar', async (t) => {
  restoreFetch(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-tg-audio-'));
  t.after(async () => removeDir(root));
  const result = await makeResult(root, {
    fileName: 'audio.mp3',
    quality: { isAudio: true, label: 'MP3' },
    mimeType: 'audio/mpeg',
  });
  const calls = [];
  global.fetch = async (url) => {
    const method = methodFromUrl(url);
    calls.push(method);
    if (method === 'sendAudio') {
      return fakeResponse({
        ok: false,
        status: 400,
        body: { ok: false, error_code: 400, description: 'unsupported audio type' },
      });
    }
    return fakeResponse();
  };

  await sendDownloadedFile({}, 1, result, 'legenda');

  assert.deepEqual(calls, ['sendAudio', 'sendDocument']);
});
