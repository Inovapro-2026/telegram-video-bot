import { randomBytes } from 'node:crypto';
import { YouTubeAccessError } from '../services/errors';
import { fetchVideoInfo } from '../services/videoService';
import { parseYouTubeUrl } from '../utils/validators';
import { logger } from '../utils/logger';
import type { BotDependencies } from './context';
import { buildQualityKeyboard } from './keyboard';
import * as messages from './messages';
import { editText, sendSelection } from '../services/telegramService';

export function registerCommands(deps: BotDependencies): void {
  const { bot, config, state, downloads } = deps;

  bot.command('start', async (ctx) => {
    logger.debug('Comando /start recebido', { userId: ctx.from?.id });
    await ctx.reply(messages.startMessage(), { parse_mode: 'HTML' });
  });

  bot.command('help', async (ctx) => {
    logger.debug('Comando /help recebido', { userId: ctx.from?.id });
    await ctx.reply(messages.helpMessage(config.maxFileSizeMB), { parse_mode: 'HTML' });
  });

  bot.command('cancel', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const cancelled = downloads.cancel(userId);
    state.delete(userId);
    await ctx.reply(
      cancelled ? messages.cancelledMessage() : messages.nothingToCancelMessage(),
      { parse_mode: 'HTML' },
    );
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (userId === undefined || chatId === undefined || text.startsWith('/')) return;

    if (!state.allowRequest(userId, config.maxRequestsPerMinute, 60_000)) {
      await ctx.reply(messages.rateLimitMessage(), { parse_mode: 'HTML' });
      return;
    }
    if (downloads.isActive(userId)) {
      await ctx.reply(messages.busyMessage(), { parse_mode: 'HTML' });
      return;
    }

    const parsed = parseYouTubeUrl(text);
    logger.debug('Mensagem de texto processada', { userId, isValidLink: Boolean(parsed) });
    if (!parsed) {
      await ctx.reply(messages.invalidLinkMessage(), { parse_mode: 'HTML' });
      return;
    }

    await ctx.replyWithChatAction('typing');
    const status = await ctx.reply('🔎 Consultando metadados...');

    let info;
    try {
      info = await fetchVideoInfo(parsed, config);
    } catch (error) {
      await editText(
        bot,
        chatId,
        status.message_id,
        error instanceof YouTubeAccessError
          ? messages.blockedMessage(error.message)
          : messages.metadataErrorMessage(),
      );
      return;
    }

    if (info.qualities.length === 0) {
      await editText(bot, chatId, status.message_id, messages.noQualitiesMessage());
      return;
    }

    const sessionToken = randomBytes(6).toString('hex');
    const keyboard = buildQualityKeyboard(info.qualities, sessionToken);
    const caption = messages.videoFoundMessage(info, config.maxFileSizeBytes);

    try {
      const messageId = await sendSelection(
        bot,
        chatId,
        caption,
        keyboard,
        info.thumbnailUrl,
      );
      state.set(userId, {
        token: sessionToken,
        videoInfo: info,
        chatId,
        messageId,
        createdAt: Date.now(),
        expiresAt: Date.now() + config.sessionTtlMs,
      });
      await editText(bot, chatId, status.message_id, '✅ Escolha uma qualidade nas opções abaixo.');
    } catch {
      await editText(
        bot,
        chatId,
        status.message_id,
        '❌ Não foi possível apresentar as opções. Tente novamente.',
      );
    }
  });
}
