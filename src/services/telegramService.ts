import fs from 'node:fs/promises';
import type { Telegraf } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import { TelegramFileTooLargeError } from './errors';
import type { DownloadResult } from './types';

interface TelegramError extends Error {
  response?: { error_code?: number };
}

interface UploadFields {
  caption: string;
  parse_mode: 'HTML';
  title?: string;
  supports_streaming?: boolean;
}

function isFileTooLargeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const candidate = error as { response?: { error_code?: number }; code?: number };
  const code = candidate?.response?.error_code ?? candidate?.code;
  return code === 413 || /too large|file is too big|request entity too large/i.test(message);
}

/**
 * Upload via fetch nativo: o caminho multipart do node-fetch usado pelo Telegraf 4
 * falha em algumas versões recentes do Node.js. Nenhuma credencial é incluída em mensagens.
 */
async function uploadFile(
  chatId: number,
  method: 'sendVideo' | 'sendAudio' | 'sendDocument',
  filePath: string,
  fileName: string,
  fields: UploadFields,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const form = new FormData();
  form.append('chat_id', String(chatId));
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, String(value));
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    throw new Error('Arquivo temporário não pôde ser lido para envio.');
  }
  const fieldName = method === 'sendVideo' ? 'video' : method === 'sendAudio' ? 'audio' : 'document';
  form.append(fieldName, new Blob([bytes]), fileName);

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new Error('Falha de rede ao enviar o arquivo para o Telegram.');
  }

  let body: { ok?: boolean; description?: string; error_code?: number };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error('Resposta inválida da API do Telegram.');
  }

  if (!response.ok || !body.ok) {
    const error: TelegramError = new Error(
      body.description ? `Telegram: ${body.description}` : `Telegram: HTTP ${response.status}`,
    );
    error.response = { error_code: body.error_code ?? response.status };
    throw error;
  }
}

/** Envia uma vez como vídeo/áudio e, no máximo uma vez, como documento. */
export async function sendDownloadedFile(
  bot: Telegraf,
  chatId: number,
  result: DownloadResult,
  caption: string,
): Promise<void> {
  const fields: UploadFields = { caption, parse_mode: 'HTML' };
  const isAudio = result.quality.isAudio || result.mimeType.startsWith('audio/');

  try {
    if (isAudio) {
      await uploadFile(chatId, 'sendAudio', result.filePath, result.fileName, {
        ...fields,
        title: result.fileName,
      });
    } else {
      await uploadFile(chatId, 'sendVideo', result.filePath, result.fileName, {
        ...fields,
        supports_streaming: true,
      });
    }
    return;
  } catch (error) {
    if (isFileTooLargeError(error)) {
      throw new TelegramFileTooLargeError('Arquivo acima do limite da Bot API do Telegram.');
    }
  }

  // Segunda e última tentativa: documento, para áudio e vídeo.
  await uploadFile(chatId, 'sendDocument', result.filePath, result.fileName, fields);
}

export async function editText(
  bot: Telegraf,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await bot.telegram.editMessageText(chatId, messageId, undefined, text, {
      parse_mode: 'HTML',
    });
  } catch {
    // Mensagem antiga ou texto igual: não é erro de processamento.
  }
}

export async function clearKeyboard(
  bot: Telegraf,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
      inline_keyboard: [],
    });
  } catch {
    // Botão já removido ou mensagem antiga.
  }
}

export async function sendSelection(
  bot: Telegraf,
  chatId: number,
  caption: string,
  keyboard: InlineKeyboardButton[][],
  thumbnailUrl: string | null,
): Promise<number> {
  const replyMarkup = { inline_keyboard: keyboard };
  if (thumbnailUrl) {
    try {
      const photo = await bot.telegram.sendPhoto(chatId, thumbnailUrl, {
        caption,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
      return photo.message_id;
    } catch {
      // Miniatura indisponível: seguir apenas com o texto.
    }
  }
  const message = await bot.telegram.sendMessage(chatId, caption, {
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
  return message.message_id;
}
