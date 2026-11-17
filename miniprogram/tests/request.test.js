'use strict';

const assert = require('node:assert/strict');

const calls = {
  requests: [],
  uploads: [],
  downloads: [],
};

global.wx = {
  request(options) {
    calls.requests.push(options);
    options.success({ statusCode: 200, data: { ok: true } });
  },
  uploadFile(options) {
    calls.uploads.push(options);
    const task = {
      onProgressUpdate(callback) {
        task.progressCallback = callback;
      },
      abort() {},
    };
    process.nextTick(() => {
      options.success({
        statusCode: 200,
        data: JSON.stringify({ analysis_id: 'analysis-123' }),
      });
    });
    return task;
  },
  downloadFile(options) {
    calls.downloads.push(options);
    options.success({ statusCode: 200, tempFilePath: 'temp-video.mp4' });
  },
};

const { api } = require('../utils/request');

async function run() {
  await api.getStatus('abc');
  await api.getResults('abc');
  await api.getPose3d('abc');
  await api.release('abc');

  assert.deepEqual(
    calls.requests.map((call) => [call.method, call.url]),
    [
      ['GET', 'http://127.0.0.1:5000/api/status/abc'],
      ['GET', 'http://127.0.0.1:5000/api/results/abc?compact=1'],
      ['GET', 'http://127.0.0.1:5000/api/pose3d/abc'],
      ['POST', 'http://127.0.0.1:5000/api/release/abc'],
    ]
  );

  assert.equal(api.getVideoUrl('abc'), 'http://127.0.0.1:5000/api/video/abc');

  const upload = await api.uploadVideo({
    filePath: 'clip.mp4',
    formData: { height_cm: '175' },
    onProgress() {},
  });
  assert.equal(upload.analysis_id, 'analysis-123');
  assert.equal(calls.uploads[0].name, 'video');
  assert.equal(calls.uploads[0].url, 'http://127.0.0.1:5000/api/upload');
  assert.deepEqual(calls.uploads[0].formData, { height_cm: '175' });

  const downloaded = await api.downloadVideo('abc');
  assert.equal(downloaded, 'temp-video.mp4');
  assert.equal(
    calls.downloads[0].url,
    'http://127.0.0.1:5000/api/video/abc/download'
  );

  console.log('request contract tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
