const {
  API_BASE_URL,
  REQUEST_TIMEOUT,
  UPLOAD_TIMEOUT,
  DOWNLOAD_TIMEOUT,
  getApiBaseUrl,
} = require('../config/env');

function normalizePath(path) {
  if (path && /^https?:\/\//i.test(path)) {
    return path;
  }

  const baseUrl = typeof getApiBaseUrl === 'function' ? getApiBaseUrl() : API_BASE_URL;
  if (!baseUrl) {
    throw new Error('尚未配置后端地址，请在 config/env.js 或 extConfig.apiBaseUrl 中配置。');
  }
  if (!path) {
    return baseUrl;
  }
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function looksLikeHtml(value) {
  return /<\s*(?:!doctype|html|head|body|title|meta|pre)\b/i.test(value);
}

function extractErrorMessage(payload, fallback) {
  if (!payload) {
    return fallback;
  }
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text || looksLikeHtml(text)) {
      return fallback;
    }
    return text.length > 300 ? `${text.slice(0, 300)}...` : text;
  }
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload.errMsg === 'string' && payload.errMsg.trim()) {
    return payload.errMsg;
  }
  return fallback;
}

function isTimeoutError(error) {
  const message = (error && (error.errMsg || error.message || '')) + '';
  return /timeout|timed out|超时/i.test(message);
}

function isJsonObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseResponse(raw) {
  if (isJsonObject(raw)) {
    return { payload: raw, isJson: true };
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return { payload: null, isJson: false };
  }
  try {
    const payload = JSON.parse(raw);
    return { payload, isJson: isJsonObject(payload) };
  } catch (error) {
    return { payload: raw, isJson: false };
  }
}

function responseErrorMessage(statusCode, payload, action) {
  if (statusCode === 413) {
    return '视频文件超过 200MB 上限，请选择更小的视频。';
  }
  if (statusCode === 429) {
    return '当前分析任务较多，请稍后重试。';
  }

  const fallback = `${action}失败 (${statusCode})`;
  const message = extractErrorMessage(payload, '');
  if (message) {
    return message;
  }
  if (typeof payload === 'string' && payload.trim()) {
    return `${fallback}，服务器返回了非 JSON 响应。`;
  }
  return fallback;
}

function request({ path, method = 'GET', data, header = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: normalizePath(path),
      method,
      data,
      timeout: REQUEST_TIMEOUT,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data || {});
          return;
        }
        reject(new Error(responseErrorMessage(res.statusCode, res.data, '请求')));
      },
      fail(error) {
        const message = isTimeoutError(error)
          ? '请求超时，请检查网络后重试。'
          : extractErrorMessage(error, '网络请求失败，请确认后端服务已启动。');
        reject(new Error(message));
      },
    });
  });
}

let currentUploadTask = null;

function doUploadFile({ filePath, formData, onProgress }) {
  return new Promise((resolve, reject) => {
    let task;
    try {
      task = wx.uploadFile({
        url: normalizePath('/api/upload'),
        filePath,
        name: 'video',
        formData,
        timeout: UPLOAD_TIMEOUT,
        success(res) {
          if (currentUploadTask === task) {
            currentUploadTask = null;
          }

          const statusCode = Number(res.statusCode) || 0;
          const parsed = parseResponse(res.data);
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(responseErrorMessage(statusCode, parsed.payload, '上传')));
            return;
          }
          if (!parsed.isJson) {
            reject(new Error('上传成功，但服务器返回的结果不是合法 JSON。'));
            return;
          }
          if (typeof parsed.payload.analysis_id !== 'string' || !parsed.payload.analysis_id.trim()) {
            reject(new Error('上传成功，但服务器未返回有效的 analysis_id。'));
            return;
          }
          resolve(parsed.payload);
        },
        fail(error) {
          if (currentUploadTask === task) {
            currentUploadTask = null;
          }
          const message = isTimeoutError(error)
            ? '视频上传超时，请检查网络后重试。'
            : extractErrorMessage(error, '视频上传失败，请稍后重试。');
          reject(new Error(message));
        },
      });
    } catch (error) {
      reject(error);
      return;
    }

    currentUploadTask = task;

    if (typeof onProgress === 'function' && task && typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate(onProgress);
    }
  });
}

function isConnectionBusyError(error) {
  const msg = (error && (error.errMsg || error.message || '')) + '';
  return msg.indexOf('exceed max upload connection') !== -1;
}

function uploadVideo({ filePath, formData = {}, onProgress, _retried = false }) {
  if (currentUploadTask) {
    try {
      currentUploadTask.abort();
    } catch (e) {}
    currentUploadTask = null;
  }

  return doUploadFile({ filePath, formData, onProgress }).catch((error) => {
    if (!_retried && isConnectionBusyError(error)) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          uploadVideo({ filePath, formData, onProgress, _retried: true }).then(resolve).catch(reject);
        }, 1500);
      });
    }
    throw new Error(extractErrorMessage(error, '视频上传失败，请稍后重试。'));
  });
}

const api = {
  uploadVideo,
  getStatus(analysisId) {
    return request({ path: `/api/status/${analysisId}` });
  },
  getResults(analysisId) {
    return request({ path: `/api/results/${analysisId}?compact=1` });
  },
  getPose3d(analysisId) {
    return request({ path: `/api/pose3d/${analysisId}` });
  },
  release(analysisId) {
    return request({ path: `/api/release/${analysisId}`, method: 'POST' });
  },
  getVideoUrl(analysisId) {
    return normalizePath(`/api/video/${analysisId}`);
  },
  downloadVideo(analysisId) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: normalizePath(`/api/video/${analysisId}/download`),
        timeout: DOWNLOAD_TIMEOUT,
        success(res) {
          if (res.statusCode === 200 && res.tempFilePath) {
            resolve(res.tempFilePath);
            return;
          }
          reject(new Error(responseErrorMessage(res.statusCode, res.data, '视频下载')));
        },
        fail(err) {
          const message = isTimeoutError(err)
            ? '视频下载超时，请检查网络后重试。'
            : extractErrorMessage(err, '视频下载失败，请稍后重试。');
          reject(new Error(message));
        },
      });
    });
  },
};

module.exports = {
  api,
  buildUrl: normalizePath,
};
