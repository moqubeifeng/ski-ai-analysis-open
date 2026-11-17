const { api } = require('../../utils/request');

const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;
const MAX_RECORD_DURATION_SECONDS = 60;
const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi'];
const NUMBER_FIELD_RULES = [
  { field: 'heightCm', label: '身高', min: 80, max: 250, unit: 'cm' },
  { field: 'weightKg', label: '体重', min: 20, max: 250, unit: 'kg' },
  { field: 'boardLengthCm', label: '雪板长度', min: 60, max: 240, unit: 'cm' },
];

function getFileName(file, filePath) {
  if (file && typeof file.name === 'string' && file.name.trim()) {
    return file.name.trim();
  }
  return String(filePath || '').split('\\').pop().split('/').pop().split('?')[0];
}

function getFileExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function resolveFileSize(filePath, reportedSize) {
  const numericSize = Number(reportedSize);
  if (reportedSize !== undefined && reportedSize !== null && Number.isFinite(numericSize)) {
    return Promise.resolve(numericSize);
  }

  return new Promise((resolve, reject) => {
    if (typeof wx.getFileInfo !== 'function') {
      reject(new Error('无法读取视频文件大小，请重新选择视频。'));
      return;
    }
    wx.getFileInfo({
      filePath,
      success(result) {
        const size = Number(result.size);
        if (Number.isFinite(size)) {
          resolve(size);
          return;
        }
        reject(new Error('无法读取视频文件大小，请重新选择视频。'));
      },
      fail() {
        reject(new Error('无法读取视频文件大小，请重新选择视频。'));
      },
    });
  });
}

function validateVideo(video) {
  const size = Number(video && video.size);
  if (!Number.isFinite(size) || size <= 0) {
    return '视频文件为空或无法读取，请重新选择。';
  }
  if (size > MAX_VIDEO_SIZE_BYTES) {
    return '视频文件超过 200MB 上限，请压缩后重新选择。';
  }

  const extension = getFileExtension(video && video.name);
  if (!SUPPORTED_VIDEO_EXTENSIONS.includes(extension)) {
    return '仅支持 MP4、MOV 或 AVI 格式的视频。';
  }
  return '';
}

function validateNumberFields(form) {
  for (let i = 0; i < NUMBER_FIELD_RULES.length; i += 1) {
    const rule = NUMBER_FIELD_RULES[i];
    const rawValue = String(form[rule.field] || '').trim();
    if (!rawValue) {
      continue;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return `${rule.label}必须填写有效数字。`;
    }
    if (value < rule.min || value > rule.max) {
      return `${rule.label}需在 ${rule.min}-${rule.max} ${rule.unit} 之间。`;
    }
  }
  return '';
}

Page({
  data: {
    form: {
      heightCm: '',
      weightKg: '',
      boardLengthCm: '',
      boardType: 'ski',
      assistEnabled: true,
    },
    selectedVideo: {},
    canSubmit: false,
    isUploading: false,
    uploadProgress: 0,
    uploadStatusText: '上传后会自动开始分析',
    heroMetrics: [
      { label: '姿态骨架', value: '33 点' },
      { label: '训练评分', value: '4 维' },
      { label: '问题定位', value: '时间线' },
    ],
    flowSteps: [
      {
        step: '01',
        title: '上传训练片段',
        description: '支持相册或现场录制，单段视频上限 200MB。',
      },
      {
        step: '02',
        title: '自动识别动作',
        description: '后端会执行骨架提取、动作识别和关键问题定位。',
      },
      {
        step: '03',
        title: '生成复盘报告',
        description: '输出评分卡、时间线、可视化回放和 3D 骨骼预览。',
      },
    ],
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) {
      return;
    }
    this.setData(
      {
        [`form.${field}`]: event.detail.value,
      },
      () => this.syncCanSubmit()
    );
  },

  selectBoardType(event) {
    const value = event.currentTarget.dataset.value;
    if (!value) {
      return;
    }
    this.setData({
      'form.boardType': value,
    });
  },

  onAssistChange(event) {
    this.setData({
      'form.assistEnabled': !!event.detail.value,
    });
  },

  syncCanSubmit() {
    const hasVideo = !!this.data.selectedVideo.tempFilePath;
    this.setData({
      canSubmit: hasVideo && !this.data.isUploading,
    });
  },

  chooseVideo() {
    if (this.data.isUploading) {
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: MAX_RECORD_DURATION_SECONDS,
      success: async (res) => {
        const file = (res.tempFiles || [])[0] || {};
        const tempFilePath = file.tempFilePath || '';
        if (!tempFilePath) {
          wx.showToast({
            title: '未读取到视频路径',
            icon: 'none',
          });
          return;
        }

        const name = getFileName(file, tempFilePath);
        let size;
        try {
          size = await resolveFileSize(tempFilePath, file.size);
        } catch (error) {
          wx.showModal({
            title: '无法选择视频',
            content: error.message,
            showCancel: false,
          });
          return;
        }

        const validationError = validateVideo({ name, size });
        if (validationError) {
          wx.showModal({
            title: '视频不可用',
            content: validationError,
            showCancel: false,
          });
          return;
        }

        this.setData(
          {
            selectedVideo: {
              tempFilePath,
              name,
              size,
              sizeLabel: `${(size / 1024 / 1024).toFixed(1)} MB`,
              durationLabel:
                typeof file.duration === 'number' ? `${Math.round(file.duration)} s` : '--',
              resolutionLabel:
                file.width && file.height ? `${file.width} x ${file.height}` : '自动识别',
            },
          },
          () => this.syncCanSubmit()
        );
      },
      fail: (error) => {
        const message = (error && error.errMsg) || '';
        if (message.toLowerCase().indexOf('cancel') !== -1) {
          return;
        }
        wx.showModal({
          title: '选择视频失败',
          content: message || '无法访问相册或相机，请检查权限后重试。',
          showCancel: false,
        });
      },
    });
  },

  buildFormData() {
    const { form } = this.data;
    const payload = {
      board_type: form.boardType,
      assist_enabled: form.assistEnabled ? 'true' : 'false',
    };

    if (String(form.heightCm).trim()) {
      payload.height_cm = String(form.heightCm).trim();
    }
    if (String(form.weightKg).trim()) {
      payload.weight_kg = String(form.weightKg).trim();
    }
    if (String(form.boardLengthCm).trim()) {
      payload.board_length_cm = String(form.boardLengthCm).trim();
    }

    return payload;
  },

  async startAnalysis() {
    const { selectedVideo, canSubmit, isUploading } = this.data;
    if (!canSubmit || isUploading || !selectedVideo.tempFilePath) {
      return;
    }

    const videoValidationError = validateVideo(selectedVideo);
    const formValidationError = validateNumberFields(this.data.form);
    const validationError = videoValidationError || formValidationError;
    if (validationError) {
      wx.showModal({
        title: '请检查上传信息',
        content: validationError,
        showCancel: false,
      });
      return;
    }

    this.setData({
      isUploading: true,
      uploadProgress: 0,
      uploadStatusText: '正在上传视频...',
    });

    try {
      const result = await api.uploadVideo({
        filePath: selectedVideo.tempFilePath,
        formData: this.buildFormData(),
        onProgress: (progress) => {
          this.setData({
            uploadProgress: progress.progress || 0,
            uploadStatusText:
              (progress.progress || 0) >= 100
                ? '上传完成，正在启动分析...'
                : `视频上传中 ${progress.progress || 0}%`,
          });
        },
      });

      wx.navigateTo({
        url: `/pages/report/index?analysisId=${encodeURIComponent(
          result.analysis_id
        )}&filename=${encodeURIComponent(result.filename || selectedVideo.name || '')}`,
      });
    } catch (error) {
      wx.showModal({
        title: '上传失败',
        content: error.message || '请稍后重试。',
        showCancel: false,
        confirmText: '我知道了',
      });
    } finally {
      this.setData({
        isUploading: false,
        uploadStatusText: '上传后会自动开始分析',
      });
      this.syncCanSubmit();
    }
  },
});
