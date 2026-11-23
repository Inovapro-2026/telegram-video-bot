const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseYouTubeUrl,
  sanitizeFileName,
  formatDuration,
  formatBytes,
} = require('../dist/utils/validators.js');

test('aceita URLs legítimas do YouTube e normaliza o vídeo', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ?si=abc123', 'aqz-KE-bpKQ'],
    ['youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://m.youtube.com/shorts/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
  ];
  for (const [input, expectedId] of cases) {
    const parsed = parseYouTubeUrl(input);
    assert.equal(parsed?.videoId, expectedId, input);
    assert.equal(parsed?.canonicalUrl, `https://www.youtube.com/watch?v=${expectedId}`, input);
  }
});

test('rejeita domínios falsos, esquemas inválidos e IDs incorretos', () => {
  const invalid = [
    'https://evil.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.br/watch?v=aqz-KE-bpKQ',
    'ftp://youtube.com/watch?v=aqz-KE-bpKQ',
    'javascript:alert(1)',
    'https://user:pass@youtube.com/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/watch?v=curto',
    'https://www.youtube.com/watch',
    '',
  ];
  for (const input of invalid) assert.equal(parseYouTubeUrl(input), null, input);
});

test('sanitiza nomes de arquivo e impede separadores de caminho', () => {
  const sanitized = sanitizeFileName('../../Vídeo: teste? "legal"', 'video');
  assert.ok(!sanitized.includes('/'));
  assert.ok(!sanitized.includes('\\'));
  assert.ok(!sanitized.includes(':'));
  assert.equal(sanitizeFileName('   ', 'video'), 'video');
  assert.ok(sanitizeFileName('a'.repeat(300)).length <= 90);
});

test('formata duração e tamanho', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');
  assert.equal(formatBytes(0), 'desconhecido');
});
