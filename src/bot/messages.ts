import { formatBytes, formatDuration } from '../utils/validators';
import type { QualityOption, VideoInfo } from '../services/types';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function startMessage(): string {
  return [
    '👋 <b>Bot de vídeos do YouTube</b>',
    '',
    'Envie um link público de um vídeo do YouTube para ver as qualidades disponíveis e escolher uma.',
    '',
    'Comandos:',
    '/help — ajuda e limites',
    '/cancel — cancela o processamento atual',
    '',
    '⚖️ Use somente conteúdo próprio, autorizado ou livre para download. Este bot não contorna DRM, login, bloqueios regionais ou medidas de proteção da plataforma.',
  ].join('\n');
}

export function helpMessage(maxFileSizeMB: number): string {
  return [
    'ℹ️ <b>Como usar</b>',
    '',
    '1. Envie um link de vídeo do YouTube (youtube.com ou youtu.be).',
    '2. Escolha uma qualidade entre as opções realmente disponíveis.',
    '3. Aguarde o processamento e receba o arquivo nesta conversa.',
    '',
    `<b>Limite:</b> ${maxFileSizeMB} MB por arquivo (limite da API do Telegram).`,
    'Arquivos maiores não são enviados e não são divididos automaticamente.',
    '',
    'Cada pessoa tem seu próprio estado de solicitação; nenhuma escolha interfere em outra.',
    'Use /cancel para interromper seu processamento.',
    '',
    '⚖️ Baixe apenas conteúdo próprio ou autorizado.',
  ].join('\n');
}

export function invalidLinkMessage(): string {
  return [
    '❌ Link inválido ou não suportado.',
    '',
    'Envie um link público de <b>um vídeo</b> do YouTube, por exemplo:',
    'https://www.youtube.com/watch?v=...',
    'https://youtu.be/...',
  ].join('\n');
}

export function metadataErrorMessage(): string {
  return '❌ Não foi possível consultar as informações do vídeo. Tente novamente mais tarde.';
}

export function blockedMessage(detail: string): string {
  return `🚫 ${escapeHtml(detail)}`;
}

export function noQualitiesMessage(): string {
  return '❌ Nenhuma qualidade utilizável foi encontrada para este vídeo. O download não está disponível.';
}

export function videoFoundMessage(info: VideoInfo, maxFileSizeBytes: number): string {
  const lines: string[] = [
    '✅ <b>Vídeo encontrado!</b>',
    '',
    `<b>Título:</b> ${escapeHtml(info.title)}`,
    `<b>Duração:</b> ${formatDuration(info.durationSeconds)}`,
    '',
    'Escolha a qualidade:',
    '',
  ];

  let hasOversized = false;
  for (const quality of info.qualities) {
    const size = quality.estimatedBytes;
    let suffix = '';
    if (size !== null) {
      const oversized = size > maxFileSizeBytes;
      if (oversized) hasOversized = true;
      suffix = ` — ~${formatBytes(size)}${oversized ? ' ⚠️ acima do limite' : ''}`;
    }
    lines.push(`• ${escapeHtml(quality.label)}${suffix}`);
  }

  if (hasOversized) {
    lines.push('', '⚠️ Opções marcadas podem ultrapassar o limite de envio do Telegram.');
  }
  lines.push('', '⚖️ Apenas conteúdo próprio ou autorizado.');
  return lines.join('\n');
}

export function processingMessage(quality: QualityOption): string {
  const label = escapeHtml(quality.label);
  return quality.isAudio
    ? `⏳ Extraindo <b>${label}</b>...`
    : `⏳ Processando <b>${label}</b>. Isso pode levar alguns minutos.`;
}

export function progressMessage(percent: number | null, phase: 'download' | 'processing'): string {
  if (phase === 'processing') return '⚙️ Juntando áudio e vídeo / convertendo...';
  if (percent === null) return '⬇️ Baixando...';
  return `⬇️ Baixando... <b>${Math.floor(percent)}%</b>`;
}

export function readyMessage(quality: QualityOption, bytes: number): string {
  return `✅ Pronto! Enviando <b>${escapeHtml(quality.label)}</b> (${formatBytes(bytes)}).`;
}

export function fileCaption(
  info: VideoInfo,
  quality: QualityOption,
  bytes: number,
): string {
  return [
    `<b>${escapeHtml(info.title.slice(0, 90))}</b>`,
    `${escapeHtml(quality.label)} • ${formatBytes(bytes)} • ${formatDuration(info.durationSeconds)}`,
  ].join('\n');
}

export function tooLargeMessage(bytes: number, limitBytes: number): string {
  return [
    '⚠️ O arquivo gerado tem ',
    `<b>${formatBytes(bytes)}</b> e excede o limite de <b>${formatBytes(limitBytes)}</b>.`,
    'Ele não foi enviado. O arquivo não foi dividido automaticamente.',
  ].join('');
}

export function telegramTooLargeMessage(bytes: number, limitBytes: number): string {
  return [
    '⚠️ O Telegram recusou o arquivo de ',
    `<b>${formatBytes(bytes)}</b> (limite de <b>${formatBytes(limitBytes)}</b>).`,
    'Não houve nova tentativa de envio.',
  ].join('');
}

export function sendFailedMessage(): string {
  return '❌ Não foi possível entregar o arquivo pelo Telegram. Tente outra qualidade.';
}

export function processingFailedMessage(): string {
  return '❌ Falha no processamento. O arquivo temporário foi removido. Tente novamente ou escolha outra qualidade.';
}

export function cancelledMessage(): string {
  return '🛑 Processamento cancelado. Arquivos temporários removidos.';
}

export function cancelledSelectionMessage(): string {
  return '🛑 Solicitação cancelada. Nenhum download foi iniciado.';
}

export function nothingToCancelMessage(): string {
  return 'Não há processamento ativo para cancelar.';
}

export function busyMessage(): string {
  return '⏳ Você já possui um processamento em andamento. Use /cancel para interrompê-lo.';
}

export function rateLimitMessage(): string {
  return '⏱️ Muitas solicitações em pouco tempo. Aguarde um momento e tente novamente.';
}

export function expiredMessage(): string {
  return '⏳ Esta opção expirou. Envie o link do vídeo novamente.';
}

export function queuedMessage(position: number): string {
  return `🕒 Seu download está na fila (posição ${position}).`;
}

export function unauthorizedMessage(): string {
  return '🔒 Este bot está configurado para usuários autorizados apenas.';
}

export function startupFailureMessage(): string {
  return '❌ Falha na inicialização. Verifique a configuração e os logs do servidor.';
}
