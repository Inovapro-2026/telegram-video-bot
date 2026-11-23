import { Telegraf } from 'telegraf';
import { registerCallbacks } from './bot/callbacks';
import { registerCommands } from './bot/commands';
import type { BotDependencies } from './bot/context';
import * as messages from './bot/messages';
import { StateManager } from './bot/state';
import { config } from './config/environment';
import { DownloadService } from './services/downloadService';
import { cleanupOldDirs, ensureDir } from './utils/fileManager';
import { logger, sanitizeError } from './utils/logger';

async function bootstrap(): Promise<void> {
  await ensureDir(config.tempDir);
  const removed = await cleanupOldDirs(config.tempDir, config.tempMaxAgeMs);
  if (removed > 0) logger.info('Diretórios temporários antigos removidos', { removed });

  const bot = new Telegraf(config.token);
  const state = new StateManager();
  const downloads = new DownloadService(config);
  const deps: BotDependencies = { bot, config, state, downloads };

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== undefined && config.allowedUserIds && !config.allowedUserIds.has(userId)) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Acesso restrito.').catch(() => undefined);
      else await ctx.reply(messages.unauthorizedMessage(), { parse_mode: 'HTML' });
      return;
    }
    await next();
  });

  registerCommands(deps);
  registerCallbacks(deps);

  bot.catch((error, ctx) => {
    logger.error('Erro não tratado no bot', {
      error: sanitizeError(error),
      updateId: ctx.update.update_id,
    });
  });

  const me = await bot.telegram.getMe();
  logger.info('Conexão com a API do Telegram estabelecida', { username: me.username });

  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Iniciar o bot' },
      { command: 'help', description: 'Ajuda e limites' },
      { command: 'cancel', description: 'Cancelar processamento' },
    ]);
  } catch (error) {
    logger.warn('Não foi possível registrar os comandos do bot', { error: sanitizeError(error) });
  }

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info(`Sinal ${signal} recebido. Encerrando com segurança.`);
    downloads.cancelAll();
    bot.stop(signal);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await bot.launch({
    dropPendingUpdates: config.dropPendingUpdates,
    allowedUpdates: ['message', 'callback_query'],
  });
  logger.info('Bot iniciado em modo long polling');
}

bootstrap().catch((error) => {
  logger.error('Falha na inicialização', { error: sanitizeError(error) });
  process.exitCode = 1;
});
