import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import type { QualityOption } from '../services/types';

/** Botões montados somente a partir das qualidades reais retornadas pelo yt-dlp. */
export function buildQualityKeyboard(
  qualities: QualityOption[],
  sessionToken: string,
): InlineKeyboardButton[][] {
  const byKey = new Map(qualities.map((quality) => [quality.key, quality]));
  const button = (key: QualityOption['key']): InlineKeyboardButton[] | null => {
    const quality = byKey.get(key);
    return quality
      ? [Markup.button.callback(quality.label, `q:${key}:${sessionToken}`)]
      : null;
  };
  const pair = (
    left: QualityOption['key'],
    right: QualityOption['key'],
  ): InlineKeyboardButton[] | null => {
    const first = button(left);
    const second = button(right);
    if (first && second) return [...first, ...second];
    return first ?? second;
  };

  const rows: InlineKeyboardButton[][] = [];
  const low = pair('360', '480');
  const high = pair('720', '1080');
  if (low) rows.push(low);
  if (high) rows.push(high);

  for (const key of ['360', '480', '720', '1080'] as const) {
    if ((key === '360' || key === '480') && low) continue;
    if ((key === '720' || key === '1080') && high) continue;
    const single = button(key);
    if (single) rows.push(single);
  }

  const best = button('best');
  if (best) rows.push(best);

  const mp3 = button('mp3');
  if (mp3) rows.push(mp3);

  rows.push([Markup.button.callback('❌ Cancelar', `c:${sessionToken}`)]);
  return rows;
}
