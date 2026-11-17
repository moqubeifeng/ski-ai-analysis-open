const { POLL_INTERVAL } = require('../../config/env');
const { api } = require('../../utils/request');
const {
  buildViewModel,
  buildAnomalyAlerts,
  buildRealtimeFrameView,
  findNearestFrameIndexByTime,
  findNearestPoseFrameIndex,
  formatTime,
} = require('../../utils/analysis');

const MAX_POLL_DURATION = 15 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
];

function createEmptyRealtimeState() {
  return {
    currentTimeText: '00:00.0',
    frameText: '帧 --',
    frameNote: '播放视频后，这里的逐帧指标会跟着一起刷新。',
    actionText: '等待播放',
    directionText: '方向未知',
    liveHeroCards: [
      { key: 'speed', label: '速度', valueText: '--', hint: '当前速度估计', progress: 0, tone: 'emerald' },
      { key: 'turnRate', label: '转向速率', valueText: '--', hint: '切换方向的强度', progress: 0, tone: 'sky' },
      { key: 'stability', label: '稳定度', valueText: '--', hint: 'movement stability', progress: 0, tone: 'amber' },
      { key: 'pose', label: '姿态质量', valueText: '--', hint: '骨架可信度', progress: 0, tone: 'sky' },
    ],
    liveRows: [
      { label: '提示', value: '播放视频后，这里会持续显示当前帧的速度、角度、重心与问题信息。' },
    ],
    liveFlags: [{ label: '等待播放', tone: 'sky' }],
    currentEvent: null,
    poseStats: [
      { label: '左膝', value: '--' },
      { label: '右膝', value: '--' },
      { label: '膝差', value: '--' },
      { label: '重心 X/Z', value: '--' },
    ],
  };
}

Page({
  data: {
    analysisId: '',
    filename: '',
    status: 'processing',
    statusLabel: '分析中',
    statusDescription: '上传成功后，系统会自动执行骨架识别、动作评分和问题定位。',
    progress: 0,
    message: '分析引擎启动中',
    errorMessage: '',
    isCompleted: false,
    isErrorState: false,
    resultReady: false,
    videoUrl: '',
    videoPlaying: false,
    summaryCard: {
      scoreText: '--',
      scoreTone: 'sky',
      actionType: '等待分析',
      summary: '报告生成后会在这里显示动作总体结论。',
      confidenceText: '--',
      poseQualityText: '--',
      issueCountText: '--',
    },
    metricCards: [],
    aiSections: [],
    insightPills: [],
    keyMoments: [],
    timelineItems: [],
    seriesCards: [],
    metadataItems: [],
    anomalyAlerts: [],
    isDownloading: false,
    poseAvailable: false,
    poseTip: '3D 骨骼数据加载中',
    poseFrameCount: 0,
    poseCurrentLabel: '--',
    ...createEmptyRealtimeState(),
  },

  onLoad(options) {
    this.isDestroyed = false;
    this.isPageVisible = false;
    this.pollToken = 0;
    this.pollStartedAt = Date.now();
    this.statusRequestInFlight = false;
    this.consecutiveStatusErrors = 0;
    this.reportRequestId = 0;
    this.reportReloadPending = false;
    this.releasePromise = null;

    const analysisId = decodeURIComponent(options.analysisId || '');
    const filename = decodeURIComponent(options.filename || '');

    if (!analysisId) {
      this.setError('缺少 analysis_id，无法获取分析结果。');
      return;
    }

    this.setData({
      analysisId,
      filename,
    });
  },

  onShow() {
    this.isPageVisible = true;
    if (!this.data.analysisId) {
      return;
    }

    if (this.data.isCompleted) {
      if (!this.data.resultReady) {
        this.loadReport(false);
      }
      return;
    }

    if (!this.data.isErrorState) {
      this.startPolling({ immediate: true });
    }
  },

  onHide() {
    this.isPageVisible = false;
    this.reportRequestId += 1;
    this.stopPolling();
  },

  onUnload() {
    this.releaseCurrentAnalysis();
    this.isDestroyed = true;
    this.isPageVisible = false;
    this.reportRequestId += 1;
    this.stopPolling();
  },

  onPullDownRefresh() {
    if (this.data.isCompleted) {
      this.loadReport(true);
      return;
    }
    if (this.data.isErrorState) {
      this.resetPollingState();
    }
    this.startPolling({ immediate: true, stopPullDown: true });
  },

  startPolling({ immediate = true, resetElapsed = false, stopPullDown = false } = {}) {
    this.stopPolling();
    if (resetElapsed || !this.pollStartedAt) {
      this.pollStartedAt = Date.now();
    }

    if (
      this.isDestroyed ||
      !this.isPageVisible ||
      !this.data.analysisId ||
      this.data.isCompleted ||
      this.data.isErrorState
    ) {
      if (stopPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    this.schedulePoll(this.pollToken, immediate ? 0 : POLL_INTERVAL, stopPullDown);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollToken = (this.pollToken || 0) + 1;
  },

  schedulePoll(token, delay, stopPullDown = false) {
    if (!this.isCurrentPoll(token)) {
      if (stopPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.refreshStatus(stopPullDown, token);
    }, delay);
  },

  isCurrentPoll(token) {
    return (
      !this.isDestroyed &&
      this.isPageVisible &&
      token === this.pollToken &&
      !this.data.isCompleted &&
      !this.data.isErrorState
    );
  },

  getStatusLabel(status) {
    const map = {
      processing: '分析中',
      completed: '分析完成',
      failed: '分析失败',
      cancelled: '已取消',
      unknown: '任务不存在',
      timeout: '等待超时',
      network_error: '连接失败',
    };
    return map[status] || '分析中';
  },

  getStatusDescription(status, message) {
    if (status === 'completed') {
      return '报告已生成，视频播放时会同步刷新逐帧数据和 3D 骨骼。';
    }
    if (status === 'failed') {
      return '请确认后端服务是否正常运行，或返回首页重新上传视频。';
    }
    if (status === 'cancelled') {
      return '当前分析被更新的视频任务取代，请重新发起新的分析。';
    }
    if (status === 'unknown') {
      return '任务不存在或已过期，请返回首页重新上传，或重新获取任务状态。';
    }
    return message || '系统正在执行骨架识别、动作评分和问题定位。';
  },

  async refreshStatus(stopPullDown = false, token = this.pollToken) {
    if (!this.isCurrentPoll(token)) {
      if (stopPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    if (this.statusRequestInFlight) {
      if (stopPullDown) {
        wx.stopPullDownRefresh();
      }
      this.schedulePoll(token, POLL_INTERVAL);
      return;
    }

    this.statusRequestInFlight = true;
    let shouldContinue = false;

    try {
      const status = await api.getStatus(this.data.analysisId);
      if (!this.isCurrentPoll(token)) {
        return;
      }

      const nextStatus = status.status || 'processing';
      const nextMessage = status.error || status.message || this.data.message;
      const nextProgress = Math.max(0, Math.min(100, Number(status.progress) || 0));
      this.consecutiveStatusErrors = 0;

      if (nextStatus === 'unknown') {
        this.setPollingError(
          'unknown',
          nextMessage || '任务不存在或结果已过期。',
          this.getStatusDescription('unknown')
        );
        return;
      }

      this.setData({
        status: nextStatus,
        progress: nextStatus === 'completed' ? 100 : nextProgress,
        message: nextMessage,
        errorMessage: status.error || '',
        statusLabel: this.getStatusLabel(nextStatus),
        statusDescription: this.getStatusDescription(nextStatus, nextMessage),
        isCompleted: nextStatus === 'completed',
        isErrorState: nextStatus === 'failed' || nextStatus === 'cancelled',
      });

      if (nextStatus === 'completed') {
        this.stopPolling();
        if (!this.data.resultReady) {
          await this.loadReport(false);
        }
        return;
      }

      if (nextStatus === 'failed' || nextStatus === 'cancelled') {
        this.stopPolling();
        return;
      }

      if (Date.now() - this.pollStartedAt >= MAX_POLL_DURATION) {
        this.setPollingError(
          'timeout',
          '分析等待时间过长，请重新获取状态或返回首页重新上传。',
          '任务长时间没有完成，已停止自动查询，避免页面持续请求。'
        );
        return;
      }

      shouldContinue = true;
    } catch (error) {
      if (!this.isCurrentPoll(token)) {
        return;
      }

      this.consecutiveStatusErrors += 1;
      const errorMessage = error.message || '状态查询失败';
      if (this.consecutiveStatusErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        this.setPollingError(
          'network_error',
          `${errorMessage}（已连续失败 ${this.consecutiveStatusErrors} 次）`,
          '后端状态连续查询失败，已停止自动请求，可点击重新获取。'
        );
        return;
      }

      this.setData({
        message: `${errorMessage}，正在自动重试（${this.consecutiveStatusErrors}/${MAX_CONSECUTIVE_POLL_ERRORS}）`,
        statusDescription: '后端状态暂不可用，系统会自动重试。',
      });
      shouldContinue = true;
    } finally {
      this.statusRequestInFlight = false;
      if (stopPullDown) {
        wx.stopPullDownRefresh();
      }
      if (shouldContinue && this.isCurrentPoll(token)) {
        this.schedulePoll(token, POLL_INTERVAL);
      }
    }
  },

  setPollingError(status, message, description) {
    this.stopPolling();
    if (this.isDestroyed) {
      return;
    }
    this.setData({
      status,
      statusLabel: this.getStatusLabel(status),
      statusDescription: description,
      message,
      errorMessage: message,
      isCompleted: false,
      isErrorState: true,
    });
  },

  resetPollingState() {
    this.consecutiveStatusErrors = 0;
    this.pollStartedAt = Date.now();
    this.setData({
      status: 'processing',
      statusLabel: '重新连接中',
      statusDescription: '正在重新获取任务状态。',
      message: '正在连接分析服务',
      errorMessage: '',
      isCompleted: false,
      isErrorState: false,
    });
  },

  async loadReport(stopPullDown) {
    if (this.isDestroyed || this.loadingReport) {
      if (!this.isDestroyed && this.data.isCompleted && !this.data.resultReady) {
        this.reportReloadPending = true;
      }
      if (stopPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    this.loadingReport = true;
    this.reportReloadPending = false;
    const requestId = ++this.reportRequestId;

    try {
      const analysisId = this.data.analysisId;
      const [result, poseData] = await Promise.all([
        api.getResults(analysisId),
        api.getPose3d(analysisId).catch(() => null),
      ]);
      if (
        this.isDestroyed ||
        !this.isPageVisible ||
        requestId !== this.reportRequestId
      ) {
        this.reportReloadPending = !this.isDestroyed && !this.data.resultReady;
        return;
      }

      const viewModel = buildViewModel(result);
      this.analysisResult = result;
      this.analysisFrames = Array.isArray(result.frames) ? result.frames : [];
      this.analysisEvents = Array.isArray(result.events) ? result.events : [];
      this.poseFrames =
        poseData && Array.isArray(poseData.frames) ? poseData.frames : [];
      this.currentFrameIndex = -1;
      this.currentPoseFrameIndex = -1;
      this.poseEmptyDrawn = false;

      this.setData(
        {
          resultReady: true,
          isCompleted: true,
          isErrorState: false,
          status: 'completed',
          statusLabel: '分析完成',
          statusDescription: '报告已生成，视频播放时会同步刷新逐帧数据和 3D 骨骼。',
          progress: 100,
          message: '报告已生成',
          videoUrl: api.getVideoUrl(analysisId),
          summaryCard: viewModel.summaryCard,
          metricCards: viewModel.metricCards,
          aiSections: viewModel.aiSections,
          insightPills: viewModel.insightPills,
          keyMoments: viewModel.keyMoments,
          timelineItems: viewModel.timelineItems,
          seriesCards: viewModel.seriesCards,
          metadataItems: viewModel.metadataItems,
          anomalyAlerts: buildAnomalyAlerts(result),
          poseAvailable: this.poseFrames.length > 0,
          poseTip: this.poseFrames.length
            ? '3D 骨骼会跟随视频同步刷新。'
            : '后端未返回 3D 骨骼数据，可先查看视频和指标卡。',
          poseFrameCount: this.poseFrames.length,
          poseCurrentLabel: this.poseFrames.length
            ? formatTime(this.poseFrames[0].t || 0)
            : '--',
          videoPlaying: false,
          ...createEmptyRealtimeState(),
        },
        () => {
          if (this.isDestroyed || requestId !== this.reportRequestId) {
            return;
          }
          this.ensureVideoContext();

          if (this.analysisFrames.length) {
            this.applyFrameAtTime(0, true);
          } else if (this.poseFrames.length) {
            this.drawPoseFrame(0);
          } else {
            this.drawPoseEmpty();
          }
        }
      );
    } catch (error) {
      if (!this.isDestroyed && requestId === this.reportRequestId) {
        this.setError(error.message || '结果加载失败，请稍后重试。');
      }
    } finally {
      this.loadingReport = false;
      if (stopPullDown) {
        wx.stopPullDownRefresh();
      }
      if (
        !this.isDestroyed &&
        this.isPageVisible &&
        this.reportReloadPending &&
        this.data.isCompleted &&
        !this.data.resultReady
      ) {
        this.reportReloadPending = false;
        setTimeout(() => this.loadReport(false), 0);
      }
    }
  },

  ensureVideoContext() {
    this.videoContext = wx.createVideoContext('analysisVideo', this);
  },

  async openHome() {
    if (this.isLeavingPage) {
      return;
    }
    this.isLeavingPage = true;
    this.stopPolling();

    await Promise.race([
      this.releaseCurrentAnalysis(),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
    if (this.isDestroyed) {
      return;
    }

    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({
          url: '/pages/home/index',
          fail: () => {
            this.isLeavingPage = false;
          },
        });
      },
    });
  },

  releaseCurrentAnalysis() {
    if (this.releasePromise) {
      return this.releasePromise;
    }

    const analysisId = this.data.analysisId;
    if (!analysisId) {
      return Promise.resolve();
    }

    this.releasePromise = api.release(analysisId).catch(() => null);
    return this.releasePromise;
  },

  saveVideoToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveVideoToPhotosAlbum({
        filePath,
        success: resolve,
        fail: reject,
      });
    });
  },

  isAlbumPermissionError(error) {
    const message = String((error && (error.errMsg || error.message)) || '');
    return /auth|authorize|permission|scope\.writePhotosAlbum|deny/i.test(message);
  },

  showAlbumPermissionHelp() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '需要相册权限',
        content: '请在设置中允许保存到相册后重试。',
        confirmText: '去设置',
        cancelText: '取消',
        success: (result) => {
          if (!result.confirm) {
            resolve();
            return;
          }
          wx.openSetting({ complete: resolve });
        },
        fail: resolve,
      });
    });
  },

  async downloadVideo() {
    const { analysisId, isDownloading } = this.data;
    if (!analysisId || isDownloading) return;
    this.setData({ isDownloading: true });
    wx.showLoading({ title: '下载中…', mask: true });
    let loadingVisible = true;

    try {
      const tempPath = await api.downloadVideo(analysisId);
      if (this.isDestroyed) {
        return;
      }
      await this.saveVideoToAlbum(tempPath);
      if (!this.isDestroyed) {
        wx.hideLoading();
        loadingVisible = false;
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      }
    } catch (error) {
      if (loadingVisible) {
        wx.hideLoading();
        loadingVisible = false;
      }
      if (!this.isDestroyed) {
        if (this.isAlbumPermissionError(error)) {
          await this.showAlbumPermissionHelp();
        } else {
          wx.showToast({
            title: error.message || '下载或保存失败',
            icon: 'none',
            duration: 2500,
          });
        }
      }
    } finally {
      if (loadingVisible) {
        wx.hideLoading();
      }
      if (!this.isDestroyed) {
        this.setData({ isDownloading: false });
      }
    }
  },

  retryLoad() {
    if (this.data.isCompleted) {
      this.loadReport(false);
      return;
    }
    this.resetPollingState();
    this.startPolling({ immediate: true, resetElapsed: true });
  },

  setError(message) {
    this.stopPolling();
    if (this.isDestroyed) {
      return;
    }
    this.analysisFrames = [];
    this.analysisEvents = [];
    this.poseFrames = [];
    this.currentFrameIndex = -1;
    this.currentPoseFrameIndex = -1;
    this.poseEmptyDrawn = false;

    this.setData({
      status: 'failed',
      statusLabel: '加载失败',
      statusDescription: '请确认后端服务是否正常运行，或返回首页重新上传视频。',
      message,
      errorMessage: message,
      isCompleted: false,
      isErrorState: true,
      resultReady: false,
      poseAvailable: false,
      poseTip: '暂无骨骼数据',
      videoPlaying: false,
      ...createEmptyRealtimeState(),
    });

    this.drawPoseEmpty();
  },

  handleVideoLoaded() {
    this.applyFrameAtTime(0, true);
  },

  handleVideoPlay() {
    this.setData({ videoPlaying: true });
  },

  handleVideoPause() {
    this.setData({ videoPlaying: false });
  },

  handleVideoEnded() {
    this.setData({ videoPlaying: false });
    if (Array.isArray(this.analysisFrames) && this.analysisFrames.length) {
      const lastFrame = this.analysisFrames[this.analysisFrames.length - 1];
      const seconds = Number(lastFrame.timestamp_sec ?? lastFrame.timestamp ?? 0);
      this.applyFrameAtTime(seconds, true);
    }
  },

  handleVideoTimeUpdate(event) {
    this.applyFrameAtTime(Number(event.detail.currentTime) || 0, false);
  },

  applyFrameAtTime(seconds, force = false) {
    if (!Array.isArray(this.analysisFrames) || !this.analysisFrames.length) {
      return;
    }

    const playbackTimeText = formatTime(seconds);
    const nextIndex = findNearestFrameIndexByTime(this.analysisFrames, seconds);
    if (nextIndex < 0) {
      return;
    }

    if (!force && nextIndex === this.currentFrameIndex) {
      this.setData({
        currentTimeText: playbackTimeText,
      });
      this.syncPoseByTime(seconds, false);
      return;
    }

    this.currentFrameIndex = nextIndex;
    const frame = this.analysisFrames[nextIndex];
    const realtime = buildRealtimeFrameView(frame, this.analysisEvents);

    this.setData({
      currentTimeText: playbackTimeText,
      frameText: realtime.frameText,
      frameNote: realtime.frameNote,
      actionText: realtime.actionText,
      directionText: realtime.directionText,
      liveHeroCards: realtime.heroCards,
      liveRows: realtime.liveRows,
      liveFlags: realtime.liveFlags,
      currentEvent: realtime.currentEvent,
      poseStats: realtime.poseStats,
    });

    this.syncPoseByTime(seconds, force);
  },

  syncPoseByTime(seconds, force = false) {
    if (!Array.isArray(this.poseFrames) || !this.poseFrames.length) {
      if (force || !this.poseEmptyDrawn) {
        this.drawPoseEmpty();
        this.poseEmptyDrawn = true;
      }
      return;
    }

    this.poseEmptyDrawn = false;
    const poseIndex = findNearestPoseFrameIndex(this.poseFrames, seconds);
    if (!force && poseIndex === this.currentPoseFrameIndex) {
      return;
    }

    this.currentPoseFrameIndex = poseIndex;
    this.drawPoseFrame(poseIndex);
  },

  seekToMoment(event) {
    const seconds = Number(event.currentTarget.dataset.seconds);
    if (!Number.isFinite(seconds)) {
      return;
    }

    this.ensureVideoContext();
    if (this.videoContext) {
      this.videoContext.seek(seconds);
      this.videoContext.play();
    }

    this.setData({
      videoPlaying: true,
    });
    this.applyFrameAtTime(seconds, true);
  },

  drawPoseEmpty() {
    const ctx = wx.createCanvasContext('poseCanvas', this);
    const width = 660;
    const height = 440;

    ctx.setFillStyle('#081321');
    ctx.fillRect(0, 0, width, height);

    this.drawPoseBackdrop(ctx, width, height);

    ctx.setFillStyle('rgba(255, 255, 255, 0.72)');
    ctx.setFontSize(20);
    ctx.fillText('暂无 3D 骨骼数据', 246, 210);
    ctx.setFillStyle('rgba(155, 183, 202, 0.72)');
    ctx.setFontSize(14);
    ctx.fillText('可先查看上方视频回放与逐帧指标', 220, 244);
    ctx.draw();
  },

  drawPoseBackdrop(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#07121f');
    gradient.addColorStop(0.6, '#10263c');
    gradient.addColorStop(1, '#091521');
    ctx.setFillStyle(gradient);
    ctx.fillRect(0, 0, width, height);

    const horizonY = 118;
    const floorBottom = height - 28;
    const centerX = width / 2;

    ctx.setStrokeStyle('rgba(156, 214, 255, 0.08)');
    ctx.setLineWidth(1);

    for (let i = 0; i <= 7; i += 1) {
      const ratio = i / 7;
      const y = horizonY + Math.pow(ratio, 1.45) * (floorBottom - horizonY);
      const inset = 28 + (1 - ratio) * 160;
      ctx.beginPath();
      ctx.moveTo(inset, y);
      ctx.lineTo(width - inset, y);
      ctx.stroke();
    }

    for (let i = 0; i <= 8; i += 1) {
      const x = 28 + ((width - 56) / 8) * i;
      ctx.beginPath();
      ctx.moveTo(x, floorBottom);
      ctx.lineTo(centerX, horizonY);
      ctx.stroke();
    }

    ctx.setStrokeStyle('rgba(124, 245, 209, 0.10)');
    ctx.setLineWidth(2);
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(width, horizonY);
    ctx.stroke();
  },

  projectPose(points, width, height) {
    const vectors = (points || []).map((point) => {
      const raw = Array.isArray(point)
        ? point
        : [point.x || 0, point.y || 0, point.z || 0];
      const x = Number(raw[0]);
      const y = Number(raw[1]);
      const z = Number(raw[2]);
      return {
        x,
        y,
        z,
        valid: Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
      };
    });

    const validPoints = vectors.filter((point) => point.valid);
    if (!validPoints.length) {
      return [];
    }

    const center = validPoints.reduce(
      (accumulator, point) => ({
        x: accumulator.x + point.x,
        y: accumulator.y + point.y,
        z: accumulator.z + point.z,
      }),
      { x: 0, y: 0, z: 0 }
    );

    center.x /= validPoints.length;
    center.y /= validPoints.length;
    center.z /= validPoints.length;

    const yaw = 0.64;
    const pitch = -0.22;
    const prepared = validPoints.map((point) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const dz = point.z - center.z;

      const rx = dx * Math.cos(yaw) + dz * Math.sin(yaw);
      const rz = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const ry = dy * Math.cos(pitch) - rz * Math.sin(pitch);
      const finalZ = dy * Math.sin(pitch) + rz * Math.cos(pitch);
      const perspective = 1 + finalZ * 0.28;

      return {
        px: rx * perspective,
        py: ry * perspective,
        depth: finalZ,
      };
    });

    const xs = prepared.map((point) => point.px);
    const ys = prepared.map((point) => point.py);
    const spanX = Math.max(...xs) - Math.min(...xs) || 1;
    const spanY = Math.max(...ys) - Math.min(...ys) || 1;
    const scale = Math.min((width - 190) / spanX, (height - 150) / spanY);

    return vectors.map((point) => {
      if (!point.valid) {
        return { valid: false, x: 0, y: 0, depth: 0 };
      }

      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const dz = point.z - center.z;

      const rx = dx * Math.cos(yaw) + dz * Math.sin(yaw);
      const rz = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const ry = dy * Math.cos(pitch) - rz * Math.sin(pitch);
      const finalZ = dy * Math.sin(pitch) + rz * Math.cos(pitch);
      const perspective = 1 + finalZ * 0.28;

      return {
        valid: true,
        x: width / 2 + rx * perspective * scale,
        y: height / 2 - 10 - ry * perspective * scale,
        depth: finalZ,
      };
    });
  },

  getPoseHistory(index, trailLength = 3) {
    if (!Array.isArray(this.poseFrames) || !this.poseFrames.length) {
      return [];
    }

    const history = [];
    const start = Math.max(0, index - trailLength);
    for (let cursor = start; cursor < index; cursor += 1) {
      history.push(this.poseFrames[cursor]);
    }
    return history;
  },

  drawPoseShadow(ctx, projected, height) {
    const leftAnkle = projected[27];
    const rightAnkle = projected[28];
    const reference = leftAnkle && leftAnkle.valid ? leftAnkle : rightAnkle;

    if (!reference) {
      return;
    }

    const centerX =
      leftAnkle && leftAnkle.valid && rightAnkle && rightAnkle.valid
        ? (leftAnkle.x + rightAnkle.x) / 2
        : reference.x;
    const groundY = height - 40;

    ctx.setFillStyle('rgba(0, 0, 0, 0.18)');
    ctx.beginPath();
    ctx.arc(centerX, groundY, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.setFillStyle('rgba(83, 224, 255, 0.06)');
    ctx.beginPath();
    ctx.arc(centerX, groundY - 2, 24, 0, Math.PI * 2);
    ctx.fill();
  },

  drawPoseSkeleton(ctx, projected, options = {}) {
    const validPoints = projected.filter((point) => point.valid);
    if (!validPoints.length) {
      return;
    }

    const minDepth = Math.min(...validPoints.map((point) => point.depth));
    const maxDepth = Math.max(...validPoints.map((point) => point.depth));
    const depthSpan = maxDepth - minDepth || 1;
    const alphaScale = options.alphaScale || 1;
    const pointScale = options.pointScale || 1;
    const lineScale = options.lineScale || 1;

    const torso = [projected[11], projected[12], projected[24], projected[23]];
    if (torso.every((point) => point && point.valid)) {
      ctx.setFillStyle(`rgba(83, 224, 255, ${0.06 * alphaScale})`);
      ctx.beginPath();
      ctx.moveTo(torso[0].x, torso[0].y);
      ctx.lineTo(torso[1].x, torso[1].y);
      ctx.lineTo(torso[2].x, torso[2].y);
      ctx.lineTo(torso[3].x, torso[3].y);
      ctx.closePath();
      ctx.fill();
    }

    const segments = POSE_CONNECTIONS
      .map(([start, end]) => {
        const a = projected[start];
        const b = projected[end];
        if (!a || !b || !a.valid || !b.valid) {
          return null;
        }
        return {
          a,
          b,
          depth: (a.depth + b.depth) / 2,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.depth - right.depth);

    segments.forEach((segment) => {
      const nearRatio = (segment.depth - minDepth) / depthSpan;
      const alpha = (0.18 + nearRatio * 0.68) * alphaScale;
      const width = (1.8 + nearRatio * 2.6) * lineScale;

      ctx.setStrokeStyle(`rgba(83, 224, 255, ${alpha.toFixed(3)})`);
      ctx.setLineWidth(width);
      ctx.setLineCap('round');
      ctx.beginPath();
      ctx.moveTo(segment.a.x, segment.a.y);
      ctx.lineTo(segment.b.x, segment.b.y);
      ctx.stroke();
    });

    const joints = projected
      .map((point, index) => ({ ...point, index }))
      .filter((point) => point.valid)
      .sort((left, right) => left.depth - right.depth);

    joints.forEach((point) => {
      const nearRatio = (point.depth - minDepth) / depthSpan;
      const radius = (2.2 + nearRatio * 3.6) * pointScale;
      const alpha = (0.22 + nearRatio * 0.74) * alphaScale;
      const color = point.index < 11 ? '124, 245, 209' : '237, 248, 255';

      ctx.setFillStyle(`rgba(${color}, ${(alpha * 0.28).toFixed(3)})`);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.setFillStyle(`rgba(${color}, ${alpha.toFixed(3)})`);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  },

  drawPoseFrame(index) {
    const frame = this.poseFrames[index];
    if (!frame || !Array.isArray(frame.pts) || !frame.pts.length) {
      this.drawPoseEmpty();
      return;
    }

    const ctx = wx.createCanvasContext('poseCanvas', this);
    const width = 660;
    const height = 440;
    const projected = this.projectPose(frame.pts, width, height);
    const historyFrames = this.getPoseHistory(index, 3);

    this.drawPoseBackdrop(ctx, width, height);
    this.drawPoseShadow(ctx, projected, height);

    historyFrames.forEach((historyFrame, historyIndex) => {
      const historyProjected = this.projectPose(historyFrame.pts, width, height);
      this.drawPoseSkeleton(ctx, historyProjected, {
        alphaScale: 0.20 + historyIndex * 0.10,
        pointScale: 0.75,
        lineScale: 0.8,
      });
    });

    this.drawPoseSkeleton(ctx, projected, {
      alphaScale: 1,
      pointScale: 1,
      lineScale: 1,
    });

    ctx.setFillStyle('rgba(255, 255, 255, 0.92)');
    ctx.setFontSize(16);
    ctx.fillText(`Pose Frame ${frame.fi || 0}`, 28, 34);
    ctx.setFillStyle('rgba(155, 183, 202, 0.90)');
    ctx.setFontSize(12);
    ctx.fillText(`Synced ${formatTime(frame.t || 0)}`, 28, 58);
    ctx.fillText('Perspective Twin View', width - 166, 34);
    ctx.draw();

    this.setData({
      poseCurrentLabel: formatTime(frame.t || 0),
    });
  },
});
