const ENV_API_BASE_URLS = {
  develop: 'http://127.0.0.1:5000',
  trial: '',
  release: '',
};
const REQUEST_TIMEOUT = 30000;
const UPLOAD_TIMEOUT = 600000;
const DOWNLOAD_TIMEOUT = 600000;
const POLL_INTERVAL = 1500;

function getEnvironmentVersion() {
  if (typeof wx === 'undefined' || typeof wx.getAccountInfoSync !== 'function') {
    return 'develop';
  }

  try {
    const accountInfo = wx.getAccountInfoSync() || {};
    return (accountInfo.miniProgram && accountInfo.miniProgram.envVersion) || 'develop';
  } catch (error) {
    return 'develop';
  }
}

function getExtConfig() {
  if (typeof wx === 'undefined' || typeof wx.getExtConfigSync !== 'function') {
    return {};
  }

  try {
    const config = wx.getExtConfigSync() || {};
    return config.extConfig && typeof config.extConfig === 'object'
      ? config.extConfig
      : config;
  } catch (error) {
    return {};
  }
}

function normalizeBaseUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function isLocalAddress(url) {
  return /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(
    url
  );
}

const ENV_VERSION = getEnvironmentVersion();
const EXT_CONFIG = getExtConfig();
const EXT_API_BASE_URL = normalizeBaseUrl(
  EXT_CONFIG.apiBaseUrl || EXT_CONFIG.api_base_url || EXT_CONFIG.API_BASE_URL
);
const IS_DEPLOYED_ENV = ENV_VERSION === 'trial' || ENV_VERSION === 'release';
const MAPPED_API_BASE_URL = normalizeBaseUrl(ENV_API_BASE_URLS[ENV_VERSION]);

let API_BASE_URL = EXT_API_BASE_URL || MAPPED_API_BASE_URL;
let API_CONFIG_ERROR = '';

if (API_BASE_URL && !/^https?:\/\//i.test(API_BASE_URL)) {
  API_CONFIG_ERROR = '后端地址必须是以 http:// 或 https:// 开头的完整地址，请检查 ENV_API_BASE_URLS 或 extConfig.apiBaseUrl。';
} else if (IS_DEPLOYED_ENV && !API_BASE_URL) {
  API_CONFIG_ERROR = `当前为 ${ENV_VERSION} 环境，尚未配置后端地址。请在 ENV_API_BASE_URLS.${ENV_VERSION} 中填写，或通过 extConfig.apiBaseUrl 注入已登记的 HTTPS 合法域名。`;
} else if (IS_DEPLOYED_ENV && isLocalAddress(API_BASE_URL)) {
  API_CONFIG_ERROR = `当前为 ${ENV_VERSION} 环境，不能使用 localhost 或本机回环地址。请在 ENV_API_BASE_URLS.${ENV_VERSION} 或 extConfig.apiBaseUrl 中配置可访问的 HTTPS 后端域名。`;
} else if (IS_DEPLOYED_ENV && !/^https:\/\//i.test(API_BASE_URL)) {
  API_CONFIG_ERROR = `当前为 ${ENV_VERSION} 环境，后端地址必须使用 HTTPS 合法域名。`;
}

function getApiBaseUrl() {
  if (API_CONFIG_ERROR) {
    throw new Error(API_CONFIG_ERROR);
  }
  return API_BASE_URL;
}

module.exports = {
  API_BASE_URL,
  API_CONFIG_ERROR,
  ENV_API_BASE_URLS,
  ENV_VERSION,
  REQUEST_TIMEOUT,
  UPLOAD_TIMEOUT,
  DOWNLOAD_TIMEOUT,
  POLL_INTERVAL,
  getApiBaseUrl,
};
