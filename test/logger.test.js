const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, sanitizeError, configureLoggerSecrets } = require('../dist/utils/logger.js');

test('reduz tokens e segredos configurados', () => {
  configureLoggerSecrets(['segredo-local-de-teste']);
  const text = 'falha com segredo-local-de-teste e 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
  const redacted = redact(text);
  assert.equal(redacted.includes('segredo-local-de-teste'), false);
  assert.equal(redacted.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), false);
  assert.ok(redacted.includes('<redacted>'));
});

test('mantém logs em uma única linha', () => {
  assert.equal(sanitizeError(new Error('linha um\nlinha dois')), 'linha um | linha dois');
});
