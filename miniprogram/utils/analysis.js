function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePercent(value) {
  const num = safeNumber(value, 0);
  return num <= 1 ? num * 100 : num;
}

function formatNumber(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '--';
  }
  return num.toFixed(digits);
}

function formatTime(seconds) {
  const total = Math.max(0, safeNumber(seconds, 0));
  const rounded = Math.round(total * 10) / 10;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}

function ensureList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function toneByScore(score) {
  const num = safeNumber(score, 0);
  if (num >= 85) {
    return 'emerald';
  }
  if (num >= 70) {
    return 'sky';
  }
  if (num >= 55) {
    return 'amber';
  }
  return 'rose';
}

function boardTypeLabel(boardType) {
  const raw = String(boardType || '').toLowerCase();
  if (raw === 'ski') {
    return '双板 Ski';
  }
  if (raw === 'snowboard') {
    return '单板 Snowboard';
  }
  return '--';
}

function makeSparkline(values) {
  const list = Array.isArray(values)
    ? values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];

  if (!list.length) {
    return {
      points: [],
      current: null,
      min: null,
      max: null,
      zeroLine: null,
    };
  }

  const min = Math.min(...list);
  const max = Math.max(...list);
  const span = max - min || 1;
  const zeroRatio = min < 0 && max > 0 ? (0 - min) / span : null;
  const points = list.map((value, index) => ({
    key: index,
    left: list.length === 1 ? 50 : Number(((index / (list.length - 1)) * 100).toFixed(2)),
    bottom: Number((12 + ((value - min) / span) * 72).toFixed(2)),
    active: index === list.length - 1,
  }));

  return {
    points,
    current: list[list.length - 1],
    min,
    max,
    zeroLine: zeroRatio === null ? null : Number((12 + zeroRatio * 72).toFixed(2)),
  };
}

function resolveFrameSeconds(result, frameIndex) {
  if (!Number.isFinite(Number(frameIndex))) {
    return null;
  }

  const frames = Array.isArray(result.frames) ? result.frames : [];
  const matched = frames.find(
    (frame) => safeNumber(frame.frame_index, -1) === safeNumber(frameIndex, -2)
  );

  if (matched) {
    const timestamp = matched.timestamp_sec ?? matched.timestamp;
    if (Number.isFinite(Number(timestamp))) {
      return Number(timestamp);
    }
  }

  const fps = safeNumber((result.metadata || {}).fps, 30) || 30;
  return Number(frameIndex) / fps;
}

function buildSummaryCard(result) {
  const ai = result.ai_analysis || {};
  const detection = result.detection || {};
  const deep = result.deep_metrics || {};
  const timelineSummary = deep.timeline_summary || {};
  const score = safeNumber(ai.score, 0);
  const confidence = normalizePercent(ai.confidence_score || ai.confidence || 0);
  const poseQuality = normalizePercent(detection.pose_quality_score || 0);

  return {
    scoreText: formatNumber(score, 0),
    scoreTone: toneByScore(score),
    actionType: ai.action_type || '动作识别完成',
    summary:
      ai.summary || 'AI 已完成动作识别与评分，可继续查看问题时间线、指标卡和训练建议。',
    confidenceText: `${formatNumber(confidence, 0)}%`,
    poseQualityText: `${formatNumber(poseQuality, 0)}%`,
    issueCountText: `${safeNumber(timelineSummary.problem_count || (result.events || []).length, 0)} 个`,
  };
}

function buildMetricCards(result) {
  const components = result.components || {};
  const cards = [
    {
      key: 'balance',
      label: '平衡控制',
      value: safeNumber(components.balance, 0),
      hint: '重心与下肢支撑',
    },
    {
      key: 'smoothness',
      label: '流畅衔接',
      value: safeNumber(components.smoothness, 0),
      hint: '节奏连续性',
    },
    {
      key: 'symmetry',
      label: '左右对称',
      value: safeNumber(components.symmetry, 0),
      hint: '身体协同程度',
    },
    {
      key: 'trajectory',
      label: '动态控制',
      value: safeNumber(components.trajectory, 0),
      hint: '切边与轨迹管理',
    },
  ];

  return cards.map((card) => ({
    ...card,
    valueText: formatNumber(card.value, 1),
    progress: clamp(card.value, 0, 100),
    tone: toneByScore(card.value),
  }));
}

function buildAiSections(result) {
  const ai = result.ai_analysis || {};
  const suggestionList = [
    ...ensureList(ai.suggestions),
    ...ensureList(ai.training_suggestion),
    ...ensureList(ai.error_suggestion),
  ];

  return [
    {
      key: 'strengths',
      badge: '亮点',
      title: '做得好的地方',
      tone: 'emerald',
      items: ensureList(ai.strengths).length
        ? ensureList(ai.strengths)
        : ['整体节奏较稳定，可以继续巩固现有动作模式。'],
    },
    {
      key: 'weaknesses',
      badge: '短板',
      title: '当前最值得修正',
      tone: 'amber',
      items: ensureList(ai.weaknesses).length
        ? ensureList(ai.weaknesses)
        : ['未识别到明显的高风险问题，可优先关注稳定性与细节优化。'],
    },
    {
      key: 'suggestions',
      badge: '建议',
      title: '下一次训练重点',
      tone: 'sky',
      items: suggestionList.length
        ? suggestionList
        : ['保持当前速度区间，优先通过重复练习强化稳定发力。'],
    },
  ];
}

function buildInsightPills(result) {
  const deep = result.deep_metrics || {};
  const motionSummary = deep.motion_summary || {};
  const timelineSummary = deep.timeline_summary || {};
  const detection = result.detection || {};

  return [
    {
      label: '平均速度',
      value: `${formatNumber(motionSummary.speed_avg_mps, 1)} m/s`,
    },
    {
      label: '峰值转向',
      value: `${formatNumber(motionSummary.turn_rate_peak_dps, 0)} °/s`,
    },
    {
      label: '问题事件',
      value: `${safeNumber(timelineSummary.problem_count || (result.events || []).length, 0)} 个`,
    },
    {
      label: '骨架覆盖',
      value: `${safeNumber(detection.skeleton_detected_frames, 0)}/${safeNumber(
        detection.total_analyzed_frames,
        (result.frames || []).length
      )}`,
    },
  ];
}

function buildKeyMoments(result) {
  const keyFrames = result.key_frames || {};
  const configs = [
    {
      key: 'best_control_frame',
      label: '最佳控制',
      tone: 'emerald',
      description: '姿态与稳定性最佳的片段',
    },
    {
      key: 'edge_peak_frame',
      label: '立刃峰值',
      tone: 'sky',
      description: '切边控制最明显的时刻',
    },
    {
      key: 'issue_frame',
      label: '首个问题',
      tone: 'amber',
      description: '建议优先回看的问题节点',
    },
  ];

  return configs.map((config) => {
    const frame = keyFrames[config.key];
    const seconds = resolveFrameSeconds(result, frame);
    return {
      ...config,
      frame,
      seconds: seconds === null ? null : Number(seconds.toFixed(2)),
      available: Number.isFinite(seconds),
      timeText: seconds === null ? '未生成' : formatTime(seconds),
    };
  });
}

function normalizeTimelineEvents(result) {
  const rawTimeline =
    Array.isArray(result.timeline_events) && result.timeline_events.length
      ? result.timeline_events
      : (Array.isArray(result.events) ? result.events : []).map((event) => ({
          event_kind: 'problem',
          label: event.name || event.type || '问题节点',
          timestamp: event.timestamp ?? event.start_ts ?? 0,
          end_timestamp: event.end_ts ?? event.timestamp ?? event.start_ts ?? 0,
          severity: event.severity || 'medium',
          description: event.message || event.suggestion || event.description || '建议回看该片段。',
        }));

  return rawTimeline.slice(0, 18).map((event, index) => {
    const kind = event.event_kind || 'phase';
    const tone =
      kind === 'highlight'
        ? 'emerald'
        : kind === 'problem'
          ? event.severity === 'high'
            ? 'rose'
            : event.severity === 'low'
              ? 'sky'
              : 'amber'
          : 'sky';
    const seconds = safeNumber(event.timestamp, 0);
    const endTimestamp = safeNumber(event.end_timestamp, seconds);
    const kindLabel =
      kind === 'problem' ? '问题' : kind === 'highlight' ? '亮点' : '阶段';
    const badgeMap = {
      high: '严重',
      medium: '提醒',
      low: '轻微',
    };

    return {
      id: `${kind}-${index}-${seconds}`,
      title: event.label || '事件节点',
      description: event.description || event.message || '查看该片段的具体表现。',
      seconds,
      tone,
      kindLabel,
      badge: event.severity ? badgeMap[event.severity] || kindLabel : kindLabel,
      timeText:
        endTimestamp > seconds
          ? `${formatTime(seconds)} - ${formatTime(endTimestamp)}`
          : formatTime(seconds),
    };
  });
}

function buildSeriesCards(result) {
  const series = result.series || ((result.teaching_metrics || {}).series || {});
  const definitions = [
    {
      key: 'speed',
      label: '速度趋势',
      unit: 'm/s',
      accent: '#7cf5d1',
      hint: '观察控速是否平顺',
      digits: 1,
    },
    {
      key: 'turn_rate',
      label: '转向速率',
      unit: '°/s',
      accent: '#53e0ff',
      hint: '左右转向节奏变化',
      digits: 0,
    },
    {
      key: 'edge_trend',
      label: '立刃趋势',
      unit: '°',
      accent: '#90a7ff',
      hint: '切边是否清晰有力',
      digits: 1,
    },
    {
      key: 'stability',
      label: '稳定指数',
      unit: '',
      accent: '#f7c66b',
      hint: '越接近 1 越稳定',
      digits: 2,
    },
  ];

  return definitions
    .map((definition) => {
      const sparkline = makeSparkline(series[definition.key]);
      if (!sparkline.points.length) {
        return null;
      }

      return {
        key: definition.key,
        label: definition.label,
        accent: definition.accent,
        hint: definition.hint,
        points: sparkline.points,
        zeroLine: sparkline.zeroLine,
        currentText: definition.unit
          ? `${formatNumber(sparkline.current, definition.digits)} ${definition.unit}`
          : formatNumber(sparkline.current, definition.digits),
        minText: definition.unit
          ? `${formatNumber(sparkline.min, definition.digits)} ${definition.unit}`
          : formatNumber(sparkline.min, definition.digits),
        maxText: definition.unit
          ? `${formatNumber(sparkline.max, definition.digits)} ${definition.unit}`
          : formatNumber(sparkline.max, definition.digits),
      };
    })
    .filter(Boolean);
}

function buildMetadataItems(result) {
  const metadata = result.metadata || {};
  const userContext = result.user_context || {};

  const height = userContext.height_cm ? `${formatNumber(userContext.height_cm, 0)} cm` : '--';
  const weight = userContext.weight_kg ? `${formatNumber(userContext.weight_kg, 0)} kg` : '--';
  const boardLength = userContext.board_length_cm
    ? `${formatNumber(userContext.board_length_cm, 0)} cm`
    : '--';

  return [
    {
      label: '视频文件',
      value: result.filename || '--',
    },
    {
      label: '视频分辨率',
      value:
        metadata.width && metadata.height ? `${metadata.width} x ${metadata.height}` : '--',
    },
    {
      label: 'FPS',
      value: metadata.fps ? `${formatNumber(metadata.fps, 0)} FPS` : '--',
    },
    {
      label: '雪板类型',
      value: boardTypeLabel(userContext.board_type),
    },
    {
      label: '身高 / 体重',
      value: `${height} / ${weight}`,
    },
    {
      label: '雪板长度',
      value: boardLength,
    },
    {
      label: '辅助分析',
      value: userContext.assist_enabled ? '已开启' : '未开启',
    },
  ];
}

const INSTABILITY_TYPES = new Set([
  'Fall', 'BackSeat', 'Backseat', 'EdgeControl', 'Edge_Control',
  'LeanBack', 'Lean_Back', 'Instability', 'BalanceLoss', 'Balance_Loss',
]);

function buildAnomalyAlerts(result) {
  const rawEvents = Array.isArray(result.events) ? result.events : [];
  const tlEvents = Array.isArray(result.timeline_events) ? result.timeline_events : [];

  const alerts = [];
  const allSources = [...rawEvents, ...tlEvents];

  allSources.forEach((ev) => {
    if (!ev || typeof ev !== 'object') return;
    const type = String(ev.type || ev.event_kind || '');
    const name = String(ev.name || ev.label || '');
    const severity = ev.severity || 'medium';
    const isFall = type === 'Fall' || name.includes('\u6454\u5012');
    const isHighInstability = severity === 'high' && INSTABILITY_TYPES.has(type);
    if (!isFall && !isHighInstability) return;

    const seconds = safeNumber(ev.timestamp ?? ev.start_ts ?? 0, 0);
    const endSeconds = safeNumber(ev.end_ts ?? ev.end_timestamp ?? seconds, seconds);
    const confidence = typeof ev.confidence === 'number' ? ev.confidence : null;
    const confidenceText = confidence !== null ? `${Math.round(confidence * 100)}%` : null;

    alerts.push({
      id: `anomaly-${type}-${seconds}`,
      type,
      name: isFall ? '\u6454\u5012\u68c0\u6d4b' : (name || type),
      tag: isFall ? '\u9ad8\u98ce\u9669' : '\u5931\u7a33',
      description:
        ev.suggestion ||
        ev.description ||
        ev.message ||
        (isFall
          ? '\u68c0\u6d4b\u5230\u4eba\u7269\u6454\u5012\uff0c\u8bf7\u786e\u8ba4\u4eba\u8eab\u5b89\u5168\u5e76\u56de\u770b\u8be5\u7247\u6bb5\u3002'
          : '\u8be5\u7247\u6bb5\u5b58\u5728\u660e\u663e\u5931\u7a33\uff0c\u5efa\u8bae\u56de\u770b\u5e76\u52a0\u5f3a\u5e73\u8861\u7ec3\u4e60\u3002'),
      seconds,
      timeText:
        endSeconds > seconds
          ? `${formatTime(seconds)} - ${formatTime(endSeconds)}`
          : formatTime(seconds),
      tone: isFall ? 'rose' : 'amber',
      confidenceText,
      pattern: ev.fall_pattern || null,
    });
  });

  const deduped = [];
  alerts.forEach((alert) => {
    const tooClose = deduped.some((a) => Math.abs(a.seconds - alert.seconds) < 2.0);
    if (!tooClose) deduped.push(alert);
  });

  return deduped.slice(0, 6);
}

function buildViewModel(result) {
  return {
    summaryCard: buildSummaryCard(result),
    metricCards: buildMetricCards(result),
    aiSections: buildAiSections(result),
    insightPills: buildInsightPills(result),
    keyMoments: buildKeyMoments(result),
    timelineItems: normalizeTimelineEvents(result),
    seriesCards: buildSeriesCards(result),
    metadataItems: buildMetadataItems(result),
    anomalyAlerts: buildAnomalyAlerts(result),
  };
}

function getFrameTimestamp(frame, fps = 30) {
  if (!frame || typeof frame !== 'object') {
    return 0;
  }

  const raw = frame.timestamp_sec ?? frame.timestamp;
  if (Number.isFinite(Number(raw))) {
    return Number(raw);
  }

  const frameIndex = Number(frame.frame_index);
  if (Number.isFinite(frameIndex)) {
    return frameIndex / Math.max(1, safeNumber(fps, 30));
  }

  return 0;
}

function findNearestFrameIndexByTime(frames, seconds) {
  if (!Array.isArray(frames) || !frames.length) {
    return -1;
  }

  const target = safeNumber(seconds, 0);
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = getFrameTimestamp(frames[mid]);

    if (current < target) {
      low = mid + 1;
    } else if (current > target) {
      high = mid - 1;
    } else {
      return mid;
    }
  }

  if (low >= frames.length) {
    return frames.length - 1;
  }
  if (high < 0) {
    return 0;
  }

  const lowDistance = Math.abs(getFrameTimestamp(frames[low]) - target);
  const highDistance = Math.abs(getFrameTimestamp(frames[high]) - target);
  return lowDistance < highDistance ? low : high;
}

function formatMetricValue(value, digits = 1, unit = '') {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '--';
  }
  return `${num.toFixed(digits)}${unit}`;
}

function severityTone(severity) {
  if (severity === 'high') {
    return 'rose';
  }
  if (severity === 'low') {
    return 'sky';
  }
  return 'amber';
}

function normalizeRatioPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num <= 1 ? num * 100 : num;
}

function formatDirection(direction) {
  const raw = String(direction || '').toLowerCase();
  if (raw === 'left') {
    return '左转';
  }
  if (raw === 'right') {
    return '右转';
  }
  if (raw === 'straight') {
    return '直滑';
  }
  return '方向未知';
}

function formatActionLabel(action) {
  const text = String(action || '').trim();
  if (!text) {
    return '动作识别中';
  }
  if (text.includes('_')) {
    return text.replace(/_/g, ' ');
  }
  return text;
}

function findNearestEvent(events, seconds, maxDistance = 0.7) {
  if (!Array.isArray(events) || !events.length) {
    return null;
  }

  const target = safeNumber(seconds, 0);
  let candidate = null;
  let distance = maxDistance;

  events.forEach((event) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    const rawStart = event.start_ts ?? event.timestamp ?? event.start_timestamp;
    const rawEnd = event.end_ts ?? event.end_timestamp ?? rawStart;
    const parsedStart = Number(rawStart);
    const parsedEnd = Number(rawEnd);
    if (!Number.isFinite(parsedStart) && !Number.isFinite(parsedEnd)) {
      return;
    }

    const start = Number.isFinite(parsedStart) ? parsedStart : parsedEnd;
    const end = Number.isFinite(parsedEnd) ? parsedEnd : start;
    const intervalStart = Math.min(start, end);
    const intervalEnd = Math.max(start, end);
    const diff =
      target < intervalStart
        ? intervalStart - target
        : target > intervalEnd
          ? target - intervalEnd
          : 0;

    if (diff <= distance) {
      distance = diff;
      candidate = event;
    }
  });

  return candidate;
}

function buildActionFlagList(actionFlags, nearestEvent) {
  const flags = [];

  if (actionFlags.turn_direction) {
    flags.push({
      label: formatDirection(actionFlags.turn_direction),
      tone: 'sky',
    });
  }

  if (actionFlags.carving) {
    flags.push({
      label: '刻滑中',
      tone: 'emerald',
    });
  }

  if (actionFlags.turning) {
    flags.push({
      label: '转向中',
      tone: 'sky',
    });
  }

  if (actionFlags.skidding) {
    flags.push({
      label: '搓雪',
      tone: 'amber',
    });
  }

  if (actionFlags.accelerating) {
    flags.push({
      label: '加速',
      tone: 'emerald',
    });
  }

  if (actionFlags.decelerating) {
    flags.push({
      label: '减速',
      tone: 'amber',
    });
  }

  if (nearestEvent) {
    flags.push({
      label: nearestEvent.name || nearestEvent.type || '问题提醒',
      tone: severityTone(nearestEvent.severity),
    });
  }

  if (!flags.length) {
    flags.push({
      label: '平稳滑行',
      tone: 'sky',
    });
  }

  return flags.slice(0, 6);
}

function buildRealtimeFrameView(frame, events = []) {
  if (!frame || typeof frame !== 'object') {
    return {
      currentTimeText: '--',
      frameText: '帧 --',
      frameNote: '视频播放到对应时刻后，逐帧数据会在这里刷新。',
      actionText: '等待播放',
      directionText: '方向未知',
      heroCards: [],
      liveRows: [],
      liveFlags: [],
      currentEvent: null,
      poseStats: [],
    };
  }

  const features = frame.features || {};
  const temporal = features.temporal || {};
  const stability = features.movement_stability || {};
  const posture = features.posture_angles || {};
  const quality = features.quality || {};
  const actionFlags = frame.action_flags || {};
  const knee = frame.knee || posture.knee || {};
  const hip = posture.hip || {};
  const timestamp = getFrameTimestamp(frame);
  const nearestEvent = findNearestEvent(events, timestamp);

  const speed = safeNumber(features.estimated_speed_mps ?? features.speed, 0);
  const turnRate = safeNumber(features.turn_rate_dps ?? temporal.turn_rate_mean, 0);
  const stabilityPct = normalizePercent(
    stability.score ?? features.posture_stability_index ?? 0
  );
  const poseQuality = normalizePercent(
    frame.detection?.pose_quality_score ?? features.pose_quality_score ?? quality.score ?? 0
  );
  const visibleLandmarks = quality.visible_landmarks;
  const jerk = safeNumber(temporal.com_jerk, 0);
  const acceleration = safeNumber(temporal.acceleration_magnitude, 0);
  const bodyLean = safeNumber(features.body_lean_3d, 0);
  const kneeMean = safeNumber(knee.mean_deg, 0);
  const hipMean = safeNumber(hip.mean_deg, 0);
  const asymmetryPct = normalizeRatioPercent(frame.asymmetry_ratio);
  const comOffset = frame.center_of_mass?.offset_xz_m || features.center_of_mass?.offset_xz_m || [];
  const comX = Array.isArray(comOffset) ? Number(comOffset[0]) : Number.NaN;
  const comZ = Array.isArray(comOffset) ? Number(comOffset[1]) : Number.NaN;
  const poseSource = String(frame.pose_source || 'none');
  const frameIndex = Number(frame.frame_index);
  const actionText = formatActionLabel(
    features.action_signals?.dominant_action ||
      frame.rule_reference?.action_label ||
      frame.rule_reference?.action_pattern
  );

  const problemTags = Array.isArray(frame.errors)
    ? frame.errors
        .map((item) => item.name || item.type || item.message || '')
        .filter(Boolean)
        .slice(0, 3)
    : [];

  if (!problemTags.length && nearestEvent) {
    problemTags.push(nearestEvent.name || nearestEvent.type || '问题提醒');
  }

  const heroCards = [
    {
      key: 'speed',
      label: '速度',
      valueText: formatMetricValue(speed, 1, ' m/s'),
      hint: '当前速度估计',
      progress: clamp((speed / 12) * 100, 0, 100),
      tone: 'emerald',
    },
    {
      key: 'turnRate',
      label: '转向速率',
      valueText: formatMetricValue(turnRate, 1, ' °/s'),
      hint: '切换方向的强度',
      progress: clamp((Math.abs(turnRate) / 90) * 100, 0, 100),
      tone: 'sky',
    },
    {
      key: 'stability',
      label: '稳定度',
      valueText: formatMetricValue(stabilityPct, 0, '%'),
      hint: stability.label || 'movement stability',
      progress: clamp(stabilityPct, 0, 100),
      tone: 'amber',
    },
    {
      key: 'pose',
      label: '姿态质量',
      valueText: formatMetricValue(poseQuality, 0, '%'),
      hint: '骨架可信度',
      progress: clamp(poseQuality, 0, 100),
      tone: 'sky',
    },
  ];

  const liveRows = [
    {
      label: '姿态来源',
      value: poseSource,
    },
    {
      label: '可见关键点',
      value: Number.isFinite(Number(visibleLandmarks)) ? `${Number(visibleLandmarks)}` : '--',
    },
    {
      label: '身体倾角',
      value: formatMetricValue(bodyLean, 1, ' °'),
    },
    {
      label: '膝角均值',
      value: formatMetricValue(kneeMean, 1, ' °'),
    },
    {
      label: '髋角均值',
      value: formatMetricValue(hipMean, 1, ' °'),
    },
    {
      label: '不对称比',
      value:
        asymmetryPct === null ? '--' : `${formatMetricValue(asymmetryPct, 1, '%')}`,
    },
    {
      label: '加速度',
      value: formatMetricValue(acceleration, 2, ' m/s²'),
    },
    {
      label: '冲击度',
      value: formatMetricValue(jerk, 2, ' m/s³'),
    },
    {
      label: '重心偏移',
      value:
        Number.isFinite(comX) && Number.isFinite(comZ)
          ? `X ${formatMetricValue(comX, 2)} / Z ${formatMetricValue(comZ, 2)}`
          : '--',
    },
    {
      label: '当前问题',
      value: problemTags.length ? problemTags.join(' / ') : '当前帧未命中明显问题',
    },
  ];

  const currentEvent = nearestEvent
    ? {
        title: nearestEvent.name || nearestEvent.type || '问题提醒',
        description:
          nearestEvent.message ||
          nearestEvent.description ||
          nearestEvent.suggestion ||
          '建议回看当前片段。',
        timeText: formatTime(
          nearestEvent.timestamp ?? nearestEvent.start_ts ?? nearestEvent.end_ts ?? timestamp
        ),
        tone: severityTone(nearestEvent.severity),
      }
    : null;

  const poseStats = [
    {
      label: '左膝',
      value: formatMetricValue(knee.left_deg, 1, ' °'),
    },
    {
      label: '右膝',
      value: formatMetricValue(knee.right_deg, 1, ' °'),
    },
    {
      label: '膝差',
      value: formatMetricValue(knee.diff_deg, 1, ' °'),
    },
    {
      label: '重心 X/Z',
      value:
        Number.isFinite(comX) && Number.isFinite(comZ)
          ? `${formatMetricValue(comX, 2)} / ${formatMetricValue(comZ, 2)}`
          : '--',
    },
  ];

  return {
    currentTimeText: formatTime(timestamp),
    frameText: Number.isFinite(frameIndex) ? `帧 #${frameIndex}` : '帧 --',
    frameNote: `${Number.isFinite(frameIndex) ? `帧 #${frameIndex}` : '帧 --'} · ${formatTime(
      timestamp
    )} · pose ${poseSource}`,
    actionText,
    directionText: formatDirection(actionFlags.turn_direction),
    heroCards,
    liveRows,
    liveFlags: buildActionFlagList(actionFlags, nearestEvent),
    currentEvent,
    poseStats,
  };
}

function findNearestPoseFrameIndex(frames, seconds) {
  if (!Array.isArray(frames) || !frames.length) {
    return 0;
  }

  const target = safeNumber(seconds, 0);
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = safeNumber(frames[mid].t, 0);
    if (current < target) {
      low = mid + 1;
    } else if (current > target) {
      high = mid - 1;
    } else {
      return mid;
    }
  }

  if (low >= frames.length) {
    return frames.length - 1;
  }
  if (high < 0) {
    return 0;
  }

  const lowDistance = Math.abs(safeNumber(frames[low].t, 0) - target);
  const highDistance = Math.abs(safeNumber(frames[high].t, 0) - target);
  return lowDistance < highDistance ? low : high;
}

module.exports = {
  buildViewModel,
  buildAnomalyAlerts,
  buildRealtimeFrameView,
  findNearestEvent,
  findNearestFrameIndexByTime,
  findNearestPoseFrameIndex,
  formatTime,
};
