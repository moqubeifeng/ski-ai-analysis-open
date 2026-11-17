# 滑雪分析系统 API 文档

> **Base URL**: `http://<server_ip>:5000`  
> **协议**: HTTP  
> **数据格式**: JSON (除文件上传使用 `multipart/form-data`)  
> **适用于**: 微信小程序 / Web / App 前端对接

---

## 目录

1. [核心流程](#核心流程)
2. [API 列表](#api-列表)
   - [1. 上传视频并启动分析](#1-上传视频并启动分析)
   - [2. 查询分析状态](#2-查询分析状态)
   - [3. 获取分析结果](#3-获取分析结果)
   - [4. 获取可视化视频](#4-获取可视化视频)
   - [5. 获取3D姿态数据（数字孪生）](#5-获取3d姿态数据数字孪生)
   - [6. 保存分析结果](#6-保存分析结果)
   - [7. 释放分析资源](#7-释放分析资源)
   - [8. 清理临时文件](#8-清理临时文件)
   - [9. 健康检查](#9-健康检查)
3. [数据结构详解](#数据结构详解)
4. [小程序对接指南](#小程序对接指南)
5. [错误码](#错误码)

---

## 核心流程

小程序前端的典型调用流程：

```
┌──────────┐    POST /api/upload     ┌──────────┐
│  选择视频  │ ──────────────────────→ │  上传视频  │
└──────────┘   (multipart/form-data) └──────────┘
                                          │
                                          ↓ 返回 analysis_id
┌──────────┐   GET /api/status/:id   ┌──────────┐
│  轮询状态  │ ←────────────────────→ │  处理中...  │
└──────────┘   (每1-2秒轮询一次)      └──────────┘
      │                                   │
      │ status === "completed"            ↓
      ↓
┌──────────────────────────────────────────────────┐
│  并行请求:                                         │
│  GET /api/results/:id     → 分析数据 (JSON)        │
│  GET /api/video/:id       → 可视化视频 (MP4)       │
│  GET /api/pose3d/:id      → 3D姿态数据 (JSON)      │
└──────────────────────────────────────────────────┘
      │
      ↓ 用户离开页面时
┌──────────┐
│  POST /api/release/:id  → 释放资源
└──────────┘
```

---

## API 列表

### 1. 上传视频并启动分析

上传视频文件，后端自动启动分析任务。

| 项目 | 说明 |
|------|------|
| **URL** | `POST /api/upload` |
| **Content-Type** | `multipart/form-data` |
| **文件大小限制** | 200MB |

#### 请求参数 (form-data)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `video` | File | ✅ | 视频文件 (MP4/MOV/AVI等) |
| `height_cm` | number | ❌ | 用户身高 (cm) |
| `weight_kg` | number | ❌ | 用户体重 (kg) |
| `board_length_cm` | number | ❌ | 雪板长度 (cm) |
| `board_type` | string | ❌ | 雪板类型: `"ski"` / `"snowboard"` |
| `assist_enabled` | string | ❌ | 是否启用辅助分析: `"true"` / `"false"` |

#### 小程序上传示例

```javascript
wx.uploadFile({
  url: 'http://<server>/api/upload',
  filePath: tempFilePath,  // wx.chooseMedia 获取的临时路径
  name: 'video',
  formData: {
    height_cm: '175',
    weight_kg: '70',
    board_type: 'ski',
    assist_enabled: 'true'
  },
  success(res) {
    const data = JSON.parse(res.data);
    // data.analysis_id → 用于后续轮询
  }
});
```

#### 成功响应 `200`

```json
{
  "success": true,
  "filename": "20260416_172000_ski_video.mp4",
  "analysis_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "user_context": {
    "height_cm": 175.0,
    "weight_kg": 70.0,
    "board_length_cm": null,
    "board_type": "ski",
    "assist_enabled": true
  },
  "message": "Upload successful, analysis started"
}
```

#### 错误响应

| 状态码 | 说明 |
|--------|------|
| `400` | `{"error": "No video file"}` — 未携带视频文件 |
| `400` | `{"error": "No selected file"}` — 文件名为空 |
| `400` | `{"error": "Invalid filename"}` — 文件名非法 |

---

### 2. 查询分析状态

轮询分析进度，建议每 **1~2秒** 轮询一次。

| 项目 | 说明 |
|------|------|
| **URL** | `GET /api/status/<analysis_id>` |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 状态: `"processing"` / `"completed"` / `"failed"` / `"cancelled"` / `"unknown"` |
| `progress` | number | 进度百分比 `0~100` |
| `message` | string | 当前阶段描述 |
| `error` | string | 失败时的错误信息 |
| `visualized_ready` | boolean | 可视化视频是否已生成 |
| `result_url` | string | 结果获取地址 |

#### 响应示例 — 处理中

```json
{
  "status": "processing",
  "progress": 45,
  "message": "Processed 120 frames",
  "result_url": "/api/results/a1b2c3d4-..."
}
```

#### 响应示例 — 完成

```json
{
  "status": "completed",
  "progress": 100,
  "visualized_ready": true
}
```

#### 响应示例 — 失败

```json
{
  "status": "failed",
  "progress": 30,
  "error": "可视化视频未生成。"
}
```

#### 小程序轮询示例

```javascript
function pollStatus(analysisId) {
  const timer = setInterval(() => {
    wx.request({
      url: `http://<server>/api/status/${analysisId}`,
      success(res) {
        const { status, progress } = res.data;
        // 更新进度条
        if (status === 'completed') {
          clearInterval(timer);
          loadResults(analysisId);
        } else if (status === 'failed') {
          clearInterval(timer);
          wx.showToast({ title: '分析失败', icon: 'error' });
        }
      }
    });
  }, 1500);
}
```

---

### 3. 获取分析结果

获取完整的分析数据，包括帧数据、事件、AI报告、评分指标等。

| 项目 | 说明 |
|------|------|
| **URL** | `GET /api/results/<analysis_id>` |

小程序推荐请求 `GET /api/results/<analysis_id>?compact=1`。精简响应会从 `frames[]` 中移除 `landmarks` 和 `world_landmarks`，3D 关键点改由 `/api/pose3d/<analysis_id>` 获取；其余报告字段保持不变。

#### 响应结构（顶层字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `frames` | array | 逐帧分析数据（详见下方） |
| `events` | array | 检测到的问题事件列表 |
| `timeline_events` | array | 时间线事件（用于时间轴展示） |
| `ai_analysis` | object | AI 综合分析报告 |
| `deep_metrics` | object | 综合评分卡片 + 雷达图数据 |
| `teaching_metrics` | object | 教学指标（卡片 + 时序曲线） |
| `metadata` | object | 视频元信息 |
| `filename` | string | 原始文件名 |
| `user_context` | object | 用户填写的身体参数 |
| `key_frames` | object | **🆕** 关键帧索引 |
| `components` | object | **🆕** 聚合评分 (balance/smoothness/symmetry/trajectory) |
| `series` | object | **🆕** 时序曲线数据 (顶层快捷入口，同 teaching_metrics.series) |
| `detection` | object | **🆕** 姿态检测质量汇总 |

#### `frames[]` 帧数据

每个元素代表一个被分析的视频帧（非逐帧，根据运动自适应采样）：

```json
{
  "frame_index": 30,
  "timestamp": 1.0,
  "human_box": [120, 50, 380, 520],
  "landmarks": [[x,y,z,visibility], ...],
  "world_landmarks": [[x,y,z], ...],
  "features": { ... },
  "errors": [ ... ],
  "skip_analysis": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `frame_index` | int | 帧序号 |
| `timestamp` | float | 时间戳(秒) |
| `human_box` | array\|null | 人体检测框 `[x1,y1,x2,y2]` (像素) |
| `landmarks` | array | 33个MediaPipe姿态关键点 `[x,y,z,visibility]` (像素坐标) |
| `world_landmarks` | array | 33个3D世界坐标关键点 `[x,y,z]` (米) |
| `features` | object | 该帧的特征数据（速度、角度、重心等） |
| `errors` | array | 该帧检测到的错误 |
| `skip_analysis` | boolean | 是否为跳过分析的插值帧 |
| `action_flags` | object | **🆕** 动作布尔标记（见下方） |
| `knee` | object | **🆕** 膝关节角度详情（见下方） |
| `asymmetry_ratio` | float | **🆕** 左右不对称比率 0~1 |
| `center_of_mass` | object | **🆕** 重心偏移 `{offset_xz_m: [x, z]}` |
| `detection` | object | **🆕** `{pose_quality_score: 0~1}` |
| `timestamp_sec` | float | **🆕** 时间戳(秒)，与 timestamp 相同，显式字段 |

#### `frames[].action_flags` 🆕 动作标记

```json
{
  "carving": true,
  "turning": true,
  "skidding": false,
  "accelerating": false,
  "decelerating": true,
  "turn_direction": "left"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `carving` | boolean | 是否在雕刻转弯 (立刃>20° + 转向>20°/s + 速度>3m/s) |
| `turning` | boolean | 是否在转弯 (转向角速度 > 15°/s) |
| `skidding` | boolean | 是否在搓雪 (低立刃 + 高转向) |
| `accelerating` | boolean | 是否在加速 |
| `decelerating` | boolean | 是否在减速 |
| `turn_direction` | string | 转弯方向: `"left"` / `"right"` / `"straight"` |

#### `frames[].knee` 🆕 膝关节角度

```json
{
  "left_deg": 125.3,
  "right_deg": 118.7,
  "diff_deg": 6.6,
  "mean_deg": 122.0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `left_deg` | float | 左膝关节角度 (度) |
| `right_deg` | float | 右膝关节角度 (度) |
| `diff_deg` | float | 左右膝角度差 (度) |
| `mean_deg` | float | 膝关节平均角度 (度) |

#### `features` 特征数据 (常用字段)

| 字段 | 类型 | 说明 |
|------|------|------|
| `estimated_speed_mps` | float | 估计速度 (m/s) |
| `turn_rate_dps` | float | 转弯角速度 (°/s) |
| `body_lean_3d` | float | 3D身体倾斜角度 (°) |
| `pose_quality_score` | float | 姿态质量 0~1 |
| `has_human` | boolean | 是否检测到人体 |
| `posture_angles` | object | 关节角度 (膝/髋/肩/踝等) |
| `temporal` | object | 时序特征 (加速度/jerk等) |
| `movement_stability` | object | 运动稳定性评分 |
| `action_signals` | object | 动作信号 (转弯/换刃等) |

#### `events[]` 事件数据

```json
{
  "type": "KneeAngle",
  "name": "膝关节角度异常",
  "severity": "medium",
  "start_ts": 2.5,
  "end_ts": 3.1,
  "timestamp": 2.8,
  "frame_id": 84,
  "message": "右膝过度弯曲",
  "description": "膝关节弯曲角度超出安全范围",
  "suggestion": "保持膝盖弯曲在90-120度之间",
  "evidence": {
    "value": 75.3,
    "threshold": 90.0,
    "confidence": 0.85
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 错误类型标识 |
| `name` | string | 错误名称 (中文) |
| `severity` | string | 严重程度: `"low"` / `"medium"` / `"high"` |
| `start_ts` / `end_ts` | float | 起止时间(秒) |
| `frame_id` | int | 对应帧号 |
| `message` | string | 简要描述 |
| `suggestion` | string | 改进建议 |

#### `ai_analysis` AI分析报告

```json
{
  "action_type": "平行转弯",
  "confidence": 0.82,
  "score": 75.5,
  "summary": "整体技术动作较为规范，转弯节奏稳定...",
  "strengths": ["重心控制良好", "转弯节奏均匀"],
  "weaknesses": ["外侧手臂摆动过大", "转弯时上身前倾不够"],
  "suggestions": ["加强点杖练习", "注意保持前倾角度"],
  "confidence_score": 0.82,
  "evidence": [...]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `action_type` | string | 识别的动作类型 |
| `confidence` | float | 置信度 0~1 |
| `score` | float | 综合评分 0~100 |
| `summary` | string | AI文字总结 |
| `strengths` | array[string] | 优点列表 |
| `weaknesses` | array[string] | 不足列表 |
| `suggestions` | array[string] | 改进建议列表 |

#### `deep_metrics` 综合评分

```json
{
  "overview_cards": [
    {"id": "stability", "label": "稳定性", "value": 78.5, "unit": "%"},
    {"id": "symmetry", "label": "对称性", "value": 65.2, "unit": "%"},
    {"id": "rhythm", "label": "节奏一致", "value": 82.1, "unit": "%"},
    {"id": "dynamic", "label": "动态控制", "value": 70.8, "unit": "%"}
  ],
  "radar": {
    "labels": ["稳定性", "对称性", "节奏", "动态控制"],
    "values": [78.5, 65.2, 82.1, 70.8]
  },
  "action_stats": {
    "turning_ratio": 0.35,
    "edge_change_ratio": 0.12,
    "left_turn_frames": 45,
    "right_turn_frames": 52
  },
  "motion_summary": {
    "speed_avg_mps": 3.2,
    "turn_rate_peak_dps": 85.6
  },
  "timeline_summary": {
    "event_count": 5,
    "problem_count": 3,
    "phase_count": 1,
    "highlight_count": 1
  },
  "confidence": 0.82
}
```

#### `teaching_metrics` 教学指标

```json
{
  "cards": [
    {"id": "posture_stability", "label": "姿态稳定", "value": 82.3, "unit": "%", "higher_better": true, "valid": true},
    {"id": "rhythm_consistency", "label": "节奏一致", "value": 75.1, "unit": "%", "higher_better": true, "valid": true},
    {"id": "dynamic_control", "label": "动态控制", "value": 68.9, "unit": "%", "higher_better": true, "valid": true},
    {"id": "ai_confidence", "label": "判定置信", "value": 82.0, "unit": "%", "higher_better": true}
  ],
  "series": {
    "speed": [0.5, 1.2, 2.1, ...],
    "turn_rate": [5.3, -12.1, ...],
    "body_lean": [3.2, 5.8, ...]
  },
  "event_match": [
    {"timestamp": 2.5, "name": "膝关节角度异常", "severity": "medium", "message": "右膝过度弯曲"}
  ]
}
```

> **小程序展示建议**: `overview_cards` / `cards` 做顶部评分卡片，`radar` 做雷达图，`series` 做折线图，`events` 做时间轴标记。

#### `key_frames` 🆕 关键帧索引

```json
{
  "best_control_frame": 120,
  "edge_peak_frame": 85,
  "issue_frame": 42
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `best_control_frame` | int\|null | 最佳控制帧 (姿态质量+稳定性最高) |
| `edge_peak_frame` | int\|null | 立刃角度峰值帧 |
| `issue_frame` | int\|null | 第一个问题事件所在帧 |

#### `components` 🆕 聚合评分

```json
{
  "balance": 78.5,
  "smoothness": 82.1,
  "symmetry": 65.2,
  "trajectory": 70.8
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `balance` | float | 平衡性 0~100 (来自 deep_metrics 稳定性) |
| `smoothness` | float | 流畅度 0~100 (来自 deep_metrics 节奏) |
| `symmetry` | float | 对称性 0~100 |
| `trajectory` | float | 运动轨迹控制 0~100 (来自 deep_metrics 动态控制) |

#### `series` 🆕 时序曲线数据

```json
{
  "speed": [0.5, 1.2, 2.1, ...],
  "turn_rate": [5.3, -12.1, ...],
  "body_lean": [3.2, 5.8, ...],
  "knee_left": [125.3, 122.1, ...],
  "knee_right": [118.7, 120.5, ...],
  "stability": [0.85, 0.82, ...],
  "com_offset_x": [0.012, -0.008, ...],
  "com_offset_z": [-0.03, -0.025, ...],
  "edge_trend": [15.2, 22.1, ...],
  "board_direction": [10.5, 12.3, ...]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `speed` | array[float] | 速度序列 (m/s) |
| `turn_rate` | array[float] | 转向角速度序列 (°/s) |
| `body_lean` | array[float] | 身体倾斜角度序列 (°) |
| `knee_left` | array[float] | 左膝角度序列 (°) |
| `knee_right` | array[float] | 右膝角度序列 (°) |
| `stability` | array[float] | 稳定性序列 0~1 |
| `com_offset_x` | array[float] | 重心X偏移序列 (m) |
| `com_offset_z` | array[float] | 重心Z偏移序列 (m) |
| `edge_trend` | array[float] | 立刃角度趋势序列 (°) |
| `board_direction` | array[float] | 滑板朝向序列 (°) |

> 数据点最多60个，超过则等间距降采样。

#### `detection` 🆕 姿态检测质量

```json
{
  "pose_quality_score": 0.82,
  "skeleton_detected_frames": 145,
  "total_analyzed_frames": 150
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `pose_quality_score` | float | 平均姿态质量分 0~1 |
| `skeleton_detected_frames` | int | 成功检测到骨骼的帧数 |
| `total_analyzed_frames` | int | 总分析帧数 |

#### 错误响应

| 状态码 | 说明 |
|--------|------|
| `404` | `{"error": "Not found"}` — 分析ID不存在或已过期 |

---

### 4. 获取可视化视频

获取带有骨架标注的可视化视频。

| 项目 | 说明 |
|------|------|
| **URL** | `GET /api/video/<analysis_id>` |
| **响应类型** | `video/mp4` (二进制流) |

保存到本地相册时使用 `GET /api/video/<analysis_id>/download`，该路由返回附件下载响应。

#### 小程序使用示例

```javascript
// 方式1: 直接用 video 组件播放
<video src="http://<server>/api/video/{{analysisId}}"></video>

// 方式2: 先下载再播放
wx.downloadFile({
  url: `http://<server>/api/video/${analysisId}/download`,
  success(res) {
    wx.saveVideoToPhotosAlbum({
      filePath: res.tempFilePath
    });
  }
});
```

#### 错误响应

| 状态码 | 说明 |
|--------|------|
| `404` | `{"error": "Video not found"}` — 视频未生成或已清理 |

---

### 5. 获取3D姿态数据（数字孪生）

获取用于3D骨架动画的精简姿态数据。

| 项目 | 说明 |
|------|------|
| **URL** | `GET /api/pose3d/<analysis_id>` |

#### 响应结构

```json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "total": 450,
  "frames": [
    {
      "fi": 0,
      "t": 0.0,
      "pts": [
        [0.012, -0.58, -0.06],
        [-0.015, -0.60, -0.065],
        ...
      ],
      "box": [120, 50, 380, 520]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `fps` | int | 视频帧率 |
| `width` / `height` | int | 视频分辨率 |
| `total` | int | 总帧数 |
| `frames[].fi` | int | 帧序号 |
| `frames[].t` | float | 时间戳(秒) |
| `frames[].pts` | array[33] | 33个3D关键点 `[x, y, z]`，MediaPipe世界坐标(米)，y轴向下 |
| `frames[].box` | array\|null | 人体检测框 `[x1,y1,x2,y2]` |

#### 33个关键点索引

```
0:  鼻子        11: 左肩        23: 左髋
1:  左内眼角    12: 右肩        24: 右髋
2:  左眼        13: 左肘        25: 左膝
3:  左外眼角    14: 右肘        26: 右膝
4:  右内眼角    15: 左手腕      27: 左踝
5:  右眼        16: 右手腕      28: 右踝
6:  右外眼角    17: 左小指      29: 左脚跟
7:  左耳        18: 右小指      30: 右脚跟
8:  右耳        19: 左食指      31: 左脚尖
9:  左嘴角      20: 右食指      32: 右脚尖
10: 右嘴角      21: 左拇指
                22: 右拇指
```

#### 错误响应

| 状态码 | 说明 |
|--------|------|
| `404` | `{"error": "Not found"}` |

---

### 6. 保存分析结果

将分析结果持久化保存到服务器磁盘。

| 项目 | 说明 |
|------|------|
| **URL** | `POST /api/save/<analysis_id>` |
| **Content-Type** | `application/json` |

#### 请求 Body

```json
{
  "path": "2026-04-16"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | ❌ | 保存子目录名 (默认存到 `~/Documents/SkiAnalysis/`) |

#### 成功响应 `200`

```json
{
  "success": true,
  "path": "C:/Users/.../SkiAnalysis/2026-04-16/a1b2c3d4.json",
  "video_path": "C:/Users/.../SkiAnalysis/2026-04-16/a1b2c3d4_visualized.mp4"
}
```

---

### 7. 释放分析资源

分析完成后，前端页面关闭时调用，释放服务器内存和临时文件。

| 项目 | 说明 |
|------|------|
| **URL** | `POST /api/release/<analysis_id>` |

#### 成功响应 `200`

```json
{
  "success": true
}
```

---

### 8. 清理临时文件

清理所有临时文件和内存中的分析结果（管理用途）。

| 项目 | 说明 |
|------|------|
| **URL** | `POST /api/cleanup` |

#### 成功响应 `200`

```json
{
  "success": true,
  "message": "Temp files cleaned"
}
```

### 9. 健康检查

| 项目 | 说明 |
|------|------|
| **URL** | `GET /api/health` |
| **用途** | 本地启动检查、反向代理或负载均衡健康检查 |

成功响应：

```json
{
  "status": "ok",
  "service": "ski-analysis-backend",
  "active_analysis": false
}
```

---

## 页面路由

| URL | 说明 |
|-----|------|
| `GET /` | 主页面（Web端） |
| `GET /twin?id=<analysis_id>` | 数字孪生3D查看器 |
| `GET /demo` | 演示页面（左视频右3D） |
| `GET /demo?video=<url>` | 演示页面（自动加载视频URL） |

---

## 小程序对接指南

### 1. 网络配置

在小程序 `app.json` 或开发者后台配置合法域名：
- 如果是本地开发，需在开发工具中勾选「不校验合法域名」
- 生产环境需将后端部署到有域名+HTTPS的服务器

### 2. 推荐页面结构

```
pages/
├── index/        首页
├── upload/       上传视频 + 填写身体参数
├── progress/     分析进度（轮询 /api/status）
├── result/       分析结果展示
│   ├── 评分卡片   (deep_metrics.overview_cards)
│   ├── 雷达图     (deep_metrics.radar)
│   ├── AI报告     (ai_analysis.summary/strengths/weaknesses)
│   ├── 事件列表   (events)
│   └── 视频播放   (/api/video/:id)
├── twin/         3D数字孪生（使用 three.js + WebGL）
└── history/      历史记录
```

### 3. 关键数据映射

| 小程序页面元素 | 数据来源 |
|----------------|----------|
| 顶部总分 | `ai_analysis.score` |
| 动作类型 | `ai_analysis.action_type` |
| 4维评分卡片 | `deep_metrics.overview_cards` 或 `teaching_metrics.cards` |
| 雷达图 | `deep_metrics.radar` |
| AI文字报告 | `ai_analysis.summary` |
| 优缺点列表 | `ai_analysis.strengths` / `ai_analysis.weaknesses` |
| 改进建议 | `ai_analysis.suggestions` |
| 问题时间轴 | `events[]` (按 `timestamp` 排序) |
| 速度/角度曲线 | `teaching_metrics.series.speed` / `turn_rate` |
| 可视化视频 | `GET /api/video/:id` |
| 3D骨架 | `GET /api/pose3d/:id` |

### 4. 注意事项

- **分析结果有TTL** (默认1小时) 和 **数量上限** (默认3个)，过期自动清理
- **每次只能运行一个分析**，新上传会自动取消之前的分析
- 视频文件最大 **200MB**
- `landmarks` 是像素坐标，`world_landmarks` 是3D米制坐标
- `pose3d` 接口返回的是 `world_landmarks` 优先，无则回退 `landmarks`
- 轮询状态时当 `progress >= 100` 或 `status === "completed"` 即可获取结果

---

## 错误码汇总

| HTTP状态码 | 含义 |
|-----------|------|
| `200` | 成功 |
| `400` | 请求参数错误 |
| `404` | 资源不存在 (分析ID无效/过期) |
| `500` | 服务器内部错误 |

所有错误响应格式：

```json
{
  "error": "错误描述信息"
}
```

---

## 静态资源

| URL | 说明 |
|-----|------|
| `GET /static/demo/demo_pose.json` | 演示用合成姿态数据 |

---

## 版本信息

- Flask 后端
- 分析引擎: MediaPipe Pose + YOLO + VLM (多模态视觉语言模型)
- 3D关键点格式: MediaPipe Pose 33-landmark
