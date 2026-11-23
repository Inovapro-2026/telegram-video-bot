import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../config/environment';
import type { DownloadService } from '../services/downloadService';
import type { StateManager } from './state';

export interface BotDependencies {
  bot: Telegraf;
  config: AppConfig;
  state: StateManager;
  downloads: DownloadService;
}
