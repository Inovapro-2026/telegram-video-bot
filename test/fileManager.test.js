const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createWorkDir,
  findMediaFile,
  cleanupOldDirs,
  removeDir,
} = require('../dist/utils/fileManager.js');

test('gerencia diretórios temporários e ignora arquivos parciais', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tvb-files-'));
  t.after(async () => removeDir(root));

  const workDir = await createWorkDir(root, 'job-');
  const finalFile = path.join(workDir, 'video.mp4');
  await fs.writeFile(finalFile, Buffer.alloc(1024, 1));
  await fs.writeFile(path.join(workDir, 'video.part'), Buffer.alloc(4096, 1));

  assert.equal(await findMediaFile(workDir), finalFile);

  const oldDir = await createWorkDir(root, 'old-');
  const past = new Date(Date.now() - 3600_000);
  await fs.utimes(oldDir, past, past);

  const removed = await cleanupOldDirs(root, 60_000);
  assert.ok(removed >= 1);
  assert.equal(await findMediaFile(workDir), finalFile);
});
