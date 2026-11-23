import { removeDir } from '../utils/fileManager';
import { logger, sanitizeError } from '../utils/logger';
import {
  DownloadCancelledError,
  FileTooLargeError,
  TelegramFileTooLargeError,
  YouTubeAccessError,
} from '../services/errors';
import type { DownloadResult, ProgressUpdate } from '../services/types';
import { sendDownloadedFile, editText, clearKeyboard } from '../services/telegramService';
import type { BotDependencies } from './context';
import * as messages from './messages';

export function registerCallbacks(deps: BotDependencies): void {
  const { bot, config, state, downloads } = deps;

  bot.on('callback_query', async (ctx) => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (userId === undefined || chatId === undefined) {
      await ctx.answerCbQuery().catch(() => undefined);
      return;
    }

    const session = state.get(userId);
    const targetMessageId = session?.messageId ?? ctx.callbackQuery.message?.message_id;
    const [action, first, second] = data.split(':');
    const requestedKey = action === 'q' ? first : '';
    const callbackToken = action === 'q' ? second : first;
    const quality =
      action === 'q'
        ? session?.videoInfo.qualities.find((option) => option.key === requestedKey)
        : undefined;
    const stale =
      (action === 'q' && (!session || callbackToken !== session.token || !quality)) ||
      (action === 'c' && session !== undefined && callbackToken !== session.token);

    await ctx
      .answerCbQuery(stale ? 'Opção indisponível. Envie o link novamente.' : undefined)
      .catch(() => undefined);
    if (stale) {
      logger.debug('Callback obsoleto ignorado', { userId, action });
      return;
    }

    if (action === 'c') {
      downloads.cancel(userId);
      state.delete(userId);
      if (targetMessageId !== undefined) {
        await clearKeyboard(bot, chatId, targetMessageId);
        await editText(bot, chatId, targetMessageId, messages.cancelledSelectionMessage());
      }
      return;
    }

    if (action !== 'q' || !session || !quality) return;
    if (downloads.isActive(userId)) {
      await ctx.reply(messages.busyMessage(), { parse_mode: 'HTML' });
      return;
    }

    const messageId = session.messageId;
    state.delete(userId);
    await clearKeyboard(bot, chatId, messageId);
    await editText(bot, chatId, messageId, messages.processingMessage(quality));
    logger.debug('Seleção de qualidade recebida', { userId, key: quality.key });

    const keepAlive = setInterval(() => {
      void bot.telegram.sendChatAction(chatId, 'upload_video').catch(() => undefined);
    }, 5000);

    let lastPercent = -100;
    let lastPhase = '';
    let lastEdit = 0;
    const onProgress = (update: ProgressUpdate): void => {
      const now = Date.now();
      const changed =
        update.phase !== lastPhase ||
        (update.percent !== null && Math.abs(update.percent - lastPercent) >= 5);
      if (!changed || now - lastEdit < 1500) return;
      lastPhase = update.phase;
      if (update.percent !== null) lastPercent = update.percent;
      lastEdit = now;
      void editText(bot, chatId, messageId, messages.progressMessage(update.percent, update.phase));
    };

    let result: DownloadResult | undefined;
    try {
      result = await downloads.download(userId, session.videoInfo, quality, onProgress);
      await editText(bot, chatId, messageId, messages.readyMessage(quality, result.bytes));
      try {
        await sendDownloadedFile(
          bot,
          chatId,
          result,
          messages.fileCaption(session.videoInfo, quality, result.bytes),
        );
      } catch (error) {
        if (error instanceof TelegramFileTooLargeError) {
          await editText(
            bot,
            chatId,
            messageId,
            messages.telegramTooLargeMessage(result.bytes, config.maxFileSizeBytes),
          );
        } else {
          logger.warn('Falha ao entregar arquivo', { error: sanitizeError(error) });
          await editText(bot, chatId, messageId, messages.sendFailedMessage());
        }
      }
    } catch (error) {
      if (error instanceof DownloadCancelledError) {
        await editText(bot, chatId, messageId, messages.cancelledMessage());
      } else if (error instanceof FileTooLargeError) {
        await editText(
          bot,
          chatId,
          messageId,
          messages.tooLargeMessage(error.bytes, error.limitBytes),
        );
      } else if (error instanceof YouTubeAccessError) {
        await editText(bot, chatId, messageId, messages.blockedMessage(error.message));
      } else {
        logger.error('Falha no processamento do download', { error: sanitizeError(error) });
        await editText(bot, chatId, messageId, messages.processingFailedMessage());
      }
    } finally {
      clearInterval(keepAlive);
      if (result?.workDir) await removeDir(result.workDir).catch(() => undefined);
      state.cleanup();
    }
  });
}
