const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectQualityOptions,
  parseVideoInfo,
  pickThumbnail,
} = require('../dist/services/formatService.js');

const MB = 1024 * 1024;

function makeInfo() {
  return {
    id: 'aqz-KE-bpKQ',
    title: 'Vídeo de teste autorizado',
    duration: 600,
    thumbnails: [{ url: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg', width: 480 }],
    formats: [
      {
        format_id: '18',
        ext: 'mp4',
        height: 360,
        vcodec: 'h264',
        acodec: 'aac',
        filesize: 10 * MB,
        tbr: 500,
        protocol: 'https',
      },
      {
        format_id: '22',
        ext: 'mp4',
        height: 720,
        vcodec: 'h264',
        acodec: 'aac',
        filesize: 40 * MB,
        tbr: 1500,
        protocol: 'https',
      },
      {
        format_id: '137',
        ext: 'mp4',
        height: 1080,
        vcodec: 'h264',
        acodec: 'none',
        filesize: 80 * MB,
        tbr: 3000,
        protocol: 'https',
      },
      {
        format_id: '140',
        ext: 'm4a',
        vcodec: 'none',
        acodec: 'mp4a',
        filesize: 5 * MB,
        tbr: 128,
        protocol: 'https',
      },
      {
        format_id: 'sb',
        ext: 'mhtml',
        vcodec: 'none',
        acodec: 'none',
        protocol: 'https',
        format_note: 'storyboard',
      },
    ],
  };
}

test('gera opções apenas para qualidades realmente disponíveis', () => {
  const options = selectQualityOptions(makeInfo(), 45 * MB, true);
  assert.deepEqual(
    options.map((option) => option.key),
    ['360', '720', '1080', 'best', 'mp3'],
  );
  assert.equal(options.find((option) => option.key === '480'), undefined);
  const fullHd = options.find((option) => option.key === '1080');
  assert.equal(fullHd.formatId, '137');
  assert.equal(fullHd.audioFormatId, '140');
  assert.equal(fullHd.needsMerge, true);
  assert.equal(options.find((option) => option.key === 'mp3').isAudio, true);
});

test('prefere a faixa de áudio original/ididioma do vídeo', () => {
  const info = makeInfo();
  info.language = 'pt-BR';
  info.formats.push(
    {
      format_id: '140-0',
      ext: 'm4a',
      vcodec: 'none',
      acodec: 'mp4a',
      filesize: 6 * MB,
      tbr: 160,
      protocol: 'https',
      language: 'en-US',
      format_note: 'English (US), medium',
    },
    {
      format_id: '140-1',
      ext: 'm4a',
      vcodec: 'none',
      acodec: 'mp4a',
      filesize: 5 * MB,
      tbr: 128,
      protocol: 'https',
      language: 'pt-BR',
      format_note: 'Portuguese (BR) original (default), medium',
    },
  );

  const options = selectQualityOptions(info, 45 * MB, true);
  assert.equal(options.find((option) => option.key === '1080').audioFormatId, '140-1');
  assert.equal(options.find((option) => option.key === 'mp3').formatId, '140-1');
});

test('não inventa opções quando não há formatos utilizáveis', () => {
  const options = selectQualityOptions({ ...makeInfo(), formats: [] }, 45 * MB, true);
  assert.deepEqual(options, []);
});

test('desativa MP3 por configuração', () => {
  const options = selectQualityOptions(makeInfo(), 45 * MB, false);
  assert.equal(options.some((option) => option.key === 'mp3'), false);
});

test('parseVideoInfo preserva metadados e rejeita respostas inválidas', () => {
  const info = parseVideoInfo(makeInfo(), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 45 * MB, true);
  assert.equal(info.id, 'aqz-KE-bpKQ');
  assert.equal(info.durationSeconds, 600);
  assert.equal(info.qualities.length, 5);
  assert.equal(pickThumbnail(makeInfo()).startsWith('https://'), true);
  assert.throws(() => parseVideoInfo({}, 'url', 45 * MB, true));
});
