const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const videoService = require('../dist/services/videoService.js');
const { registerCommands } = require('../dist/bot/commands.js');
const { registerCallbacks } = require('../dist/bot/callbacks.js');
const { StateManager } = require('../dist/bot/state.js');
const { removeDir } = require('../dist/utils/fileManager.js');

const originalFetch = global.fetch;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;

const fakeInfo = {
  id: 'aqz-KE-bpKQ',
  title: 'Vídeo autorizado de teste',
  durationSeconds: 60,
  thumbnailUrl: null,
  requestedUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  qualities: [
    {
      key: '360',
      label: '360p',
      height: 360,
      formatId: '18',
      ext: 'mp4',
      estimatedBytes: 1024,
      needsMerge: false,
      isAudio: false,
    },
    {
      key: 'best',
      label: 'Melhor qualidade disponível',
      height: null,
      ext: 'mp4',
      estimatedBytes: 2048,
      needsMerge: true,
      isAudio: false,
    },
    {
      key: 'mp3',
      label: 'Extrair áudio MP3',
      height: null,
      ext: 'mp3',
      estimatedBytes: 512,
      needsMerge: false,
      isAudio: true,
    },
  ],
};

function makeFakeBot(sent, edits) {
  const handlers = {};
  const bot = {
    on: (event, handler) => {
      handlers[`on:${event}`] = handler;
    },
    command: (name, handler) => {
      handlers[`cmd:${name}`] = handler;
    },
    telegram: {
      sendMessage: async (chatId, text, options) => {
        sent.push({ type: 'message', text, keyboard: options?.reply_markup?.inline_keyboard });
        return { message_id: 100 };
      },
      sendPhoto: async (chatId, photo, options) => {
        sent.push({ type: 'photo', text: options.caption, keyboard: options.reply_markup.inline_keyboard });
        return { message_id: 101 };
      },
      editMessageText: async (chatId, messageId, inlineId, text) => {
        edits.push(text);
        return true;
      },
      editMessageReplyMarkup: async () => true,
      sendChatAction: async () => true,
      sendVideo: async (chatId, file, options) => {
        sent.push({ type: 'video', caption: options.caption });
        return {};
      },
      sendAudio: async () => ({}),
      sendDocument: async () => ({}),
    },
  };
  return { bot, handlers };
}

function textContext(text, sent) {
  return {
    from: { id: 42 },
    chat: { id: 42 },
    message: { text, message_id: 1 },
    reply: async (replyText) => {
      sent.push({ type: 'reply', text: replyText });
      return { message_id: 2 };
    },
    replyWithChatAction: async () => true,
  };
}

function callbackContext(data, sent) {
  return {
    from: { id: 42 },
    chat: { id: 42 },
    callbackQuery: { data, message: { message_id: 101 } },
    answerCbQuery: async () => true,
    reply: async (replyText) => {
      sent.push({ type: 'reply', text: replyText });
    },
  };
}

test('fluxo completo do bot com botões e cancelamento (sem rede)', async (t) => {
  const originalFetch = videoService.fetchVideoInfo;
  videoService.fetchVideoInfo = async () => fakeInfo;
  t.after(() => {
    videoService.fetchVideoInfo = originalFetch;
  });

  const sent = [];
  const edits = [];
  process.env.TELEGRAM_BOT_TOKEN = '000000:TEST_TOKEN_SEM_REDE';
  global.fetch = async (url) => {
    const method = new URL(String(url)).pathname.split('/').pop();
    sent.push({
      type: method === 'sendVideo' ? 'video' : method === 'sendAudio' ? 'audio' : 'document',
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  });
  const { bot, handlers } = makeFakeBot(sent, edits);
  const state = new StateManager();
  let downloadCalls = 0;
  let cancelCalls = 0;
  const workDir = path.join(os.tmpdir(), 'tvb-bot-flow-fake');
  const downloads = {
    isActive: () => false,
    cancel: () => {
      cancelCalls += 1;
      return true;
    },
    download: async (userId, info, quality, onProgress) => {
      downloadCalls += 1;
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(path.join(workDir, 'video.mp4'), Buffer.alloc(64, 1));
      onProgress({ percent: 100, phase: 'download' });
      return {
        filePath: path.join(workDir, 'video.mp4'),
        fileName: 'video.mp4',
        bytes: 1024,
        workDir,
        quality,
        mimeType: 'video/mp4',
      };
    },
  };
  const config = { maxFileSizeMB: 45, maxFileSizeBytes: 45 * 1024 * 1024, sessionTtlMs: 900_000, maxRequestsPerMinute: 5 };

  registerCommands({ bot, config, state, downloads });
  registerCallbacks({ bot, config, state, downloads });

  await handlers['cmd:start'](textContext('/start', sent));
  await handlers['cmd:help'](textContext('/help', sent));
  assert.ok(sent.some((item) => item.text.includes('Bot de vídeos')));
  assert.ok(sent.some((item) => item.text.includes('Limite')));

  await handlers['on:text'](textContext('https://evil.com/watch?v=aqz-KE-bpKQ', sent));
  assert.ok(sent.some((item) => item.text.includes('Link inválido')));

  await handlers['on:text'](
    textContext('https://www.youtube.com/watch?v=aqz-KE-bpKQ', sent),
  );
  assert.equal(state.size, 1);
  const selection = [...sent].reverse().find((item) => item.keyboard);
  assert.ok(selection);
  const callbackData = selection.keyboard.flat()[0].callback_data;
  assert.ok(callbackData.startsWith('q:360:'));

  await handlers['on:callback_query'](callbackContext(callbackData, sent));
  assert.equal(downloadCalls, 1);
  assert.equal(state.size, 0);
  assert.ok(sent.some((item) => item.type === 'video'));
  assert.ok(edits.some((text) => text.includes('Processando')));
  await removeDir(workDir);

  await handlers['on:text'](
    textContext('https://www.youtube.com/watch?v=aqz-KE-bpKQ', sent),
  );
  const cancelSelection = [...sent].reverse().find((item) => item.keyboard);
  const cancelData = cancelSelection.keyboard.flat().find((button) => button.text.includes('Cancelar')).callback_data;
  await handlers['on:callback_query'](callbackContext(cancelData, sent));
  assert.equal(cancelCalls, 1);
  assert.equal(state.size, 0);
});
