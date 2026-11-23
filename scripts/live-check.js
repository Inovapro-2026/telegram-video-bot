/**
 * Teste manual de ponta a ponta (não faz parte do npm test).
 *
 * Uso:
 *   TEST_CHAT_ID=123456789 LIVE_VIDEO_URL=https://www.youtube.com/watch?v=... node scripts/live-check.js
 *
 * Use apenas vídeos próprios ou autorizados. Nenhuma credencial é exibida.
 */
const { config } = require('../dist/config/environment');
const { parseYouTubeUrl } = require('../dist/utils/validators');
const { fetchVideoInfo } = require('../dist/services/videoService');
const { DownloadService } = require('../dist/services/downloadService');
const { sendDownloadedFile } = require('../dist/services/telegramService');
const { removeDir } = require('../dist/utils/fileManager');
const messages = require('../dist/bot/messages');

const videoUrl = process.env.LIVE_VIDEO_URL || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const chatId = process.env.TEST_CHAT_ID ? Number(process.env.TEST_CHAT_ID) : null;
const qualityKey = process.env.LIVE_QUALITY || '360';

async function getBotUsername() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${config.token}/getMe`, {
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json();
      if (response.ok && body.ok && body.result?.username) return body.result.username;
      throw new Error('Resposta inválida da API do Telegram.');
    } catch {
      if (attempt === 1) throw new Error('Não foi possível consultar o bot no Telegram.');
    }
  }
  throw new Error('Não foi possível consultar o bot no Telegram.');
}

async function main() {
  console.log(`Telegram OK: @${await getBotUsername()}`);

  const parsed = parseYouTubeUrl(videoUrl);
  if (!parsed) throw new Error('URL de teste inválida.');
  const info = await fetchVideoInfo(parsed, config);
  console.log('Vídeo:', info.title);
  console.log(
    'Qualidades:',
    info.qualities.map((option) => option.label).join(', ') || 'nenhuma',
  );

  if (!chatId) {
    console.log('TEST_CHAT_ID não definido: teste de entrega pulado.');
    return;
  }

  const quality = info.qualities.find((option) => option.key === qualityKey);
  if (!quality) throw new Error(`Qualidade ${qualityKey} indisponível neste vídeo.`);

  const downloads = new DownloadService(config);
  let lastPercent = -10;
  let result;
  try {
    result = await downloads.download(0, info, quality, (update) => {
      if (update.percent !== null && update.percent - lastPercent >= 10) {
        lastPercent = update.percent;
        console.log(`Progresso: ${Math.floor(update.percent)}%`);
      }
    });
    console.log('Arquivo gerado:', result.fileName, result.bytes, 'bytes');
    await sendDownloadedFile(
      {},
      chatId,
      result,
      messages.fileCaption(info, quality, result.bytes),
    );
    console.log('Entrega pelo Telegram: OK');
  } finally {
    if (result) await removeDir(result.workDir);
    console.log('Limpeza: OK');
  }
}

main().catch((error) => {
  console.error('FALHA NO TESTE:', error.name, String(error.message).slice(0, 400));
  process.exitCode = 1;
});
