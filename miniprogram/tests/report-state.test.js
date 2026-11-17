'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout(callback) {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
}

function applyData(target, update) {
  Object.entries(update).forEach(([key, value]) => {
    if (!key.includes('.')) {
      target[key] = value;
      return;
    }

    const parts = key.split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => {
      cursor[part] = cursor[part] || {};
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  });
}

function loadReportPage(apiOverrides = {}, wxOverrides = {}) {
  const timers = createTimers();
  const api = {
    getStatus: async () => ({ status: 'processing', progress: 0 }),
    getResults: async () => ({}),
    getPose3d: async () => ({ frames: [] }),
    getVideoUrl: () => 'https://example.test/video.mp4',
    downloadVideo: async () => 'temp.mp4',
    release: async () => ({}),
    ...apiOverrides,
  };
  const wx = {
    stopPullDownRefresh() {},
    createVideoContext() {
      return {};
    },
    showLoading() {},
    hideLoading() {},
    showToast() {},
    showModal() {},
    openSetting() {},
    saveVideoToPhotosAlbum({ success }) {
      success();
    },
    navigateBack() {},
    reLaunch() {},
    ...wxOverrides,
  };

  let definition;
  const sourcePath = path.join(__dirname, '..', 'pages', 'report', 'index.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sandbox = {
    Page(value) {
      definition = value;
    },
    require(request) {
      if (request === '../../config/env') {
        return { POLL_INTERVAL: 1500 };
      }
      if (request === '../../utils/request') {
        return { api };
      }
      if (request === '../../utils/analysis') {
        return {
          buildViewModel: () => ({
            summaryCard: {},
            metricCards: [],
            aiSections: [],
            insightPills: [],
            keyMoments: [],
            timelineItems: [],
            seriesCards: [],
            metadataItems: [],
          }),
          buildAnomalyAlerts: () => [],
          buildRealtimeFrameView: () => ({}),
          findNearestFrameIndexByTime: () => -1,
          findNearestPoseFrameIndex: () => 0,
          formatTime: () => '00:00.0',
        };
      }
      throw new Error(`Unexpected require: ${request}`);
    },
    wx,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });

  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update, callback) {
      applyData(this.data, update);
      if (typeof callback === 'function') {
        callback();
      }
    },
  };
  page.isDestroyed = false;
  page.isPageVisible = true;
  page.pollToken = 1;
  page.pollStartedAt = Date.now();
  page.statusRequestInFlight = false;
  page.consecutiveStatusErrors = 0;
  page.reportRequestId = 0;
  page.data.analysisId = 'analysis-1';

  return { page, timers };
}

async function testStoppedPollCannotWriteBack() {
  const response = deferred();
  let requestCount = 0;
  const { page } = loadReportPage({
    getStatus() {
      requestCount += 1;
      return response.promise;
    },
  });

  const refresh = page.refreshStatus(false, 1);
  page.stopPolling();
  response.resolve({ status: 'processing', progress: 78, message: 'stale' });
  await refresh;

  assert.equal(requestCount, 1);
  assert.equal(page.data.progress, 0);
  assert.notEqual(page.data.message, 'stale');
}

async function testConcurrentRefreshDoesNotOverlapRequests() {
  const response = deferred();
  let requestCount = 0;
  const { page, timers } = loadReportPage({
    getStatus() {
      requestCount += 1;
      return response.promise;
    },
  });

  const first = page.refreshStatus(false, 1);
  await page.refreshStatus(false, 1);
  assert.equal(requestCount, 1);
  assert.equal(timers.pending.size, 1);

  page.stopPolling();
  response.resolve({ status: 'processing', progress: 20 });
  await first;
}

async function testUnknownStatusIsTerminal() {
  const { page } = loadReportPage({
    getStatus: async () => ({ status: 'unknown', message: 'expired' }),
  });

  await page.refreshStatus(false, 1);
  assert.equal(page.data.status, 'unknown');
  assert.equal(page.data.isErrorState, true);
}

async function testDownloadUnlocksAfterAlbumSaveCompletes() {
  let albumRequest;
  const { page } = loadReportPage(
    { downloadVideo: async () => 'downloaded.mp4' },
    {
      saveVideoToPhotosAlbum(options) {
        albumRequest = options;
      },
    }
  );

  const saving = page.downloadVideo();
  await flushAsyncWork();
  assert.ok(albumRequest);
  assert.equal(page.data.isDownloading, true);

  albumRequest.success();
  await saving;
  assert.equal(page.data.isDownloading, false);
}

async function run() {
  await testStoppedPollCannotWriteBack();
  await testConcurrentRefreshDoesNotOverlapRequests();
  await testUnknownStatusIsTerminal();
  await testDownloadUnlocksAfterAlbumSaveCompletes();
  console.log('report state tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
