# 第三方资源说明

本公开仓库主要包含项目团队自研的客户端与接口工具，不直接分发核心视觉模型或训练数据。

项目完整系统在服务端研究和实验过程中使用过以下开源资源：

| 资源 | 主要用途 | 上游许可证 | 本仓库中的状态 |
|---|---|---|---|
| MediaPipe | 人体姿态关键点提取 | Apache License 2.0 | 未分发其源码与模型 |
| Ultralytics YOLO | 人体目标检测 | AGPL-3.0 或商业许可 | 未分发其源码、模型与后端实现 |
| OpenCV | 视频读取与图像处理 | Apache License 2.0 | 公开客户端不直接依赖 |
| Flask | 服务端 API 框架 | BSD-3-Clause | 公开客户端不直接依赖 |

使用者若自行实现分析后端并选择上述组件，应查阅其官方仓库和当前许可证，独立履行署名、源码开放或商业授权等义务。本文件仅用于项目资源披露，不构成法律意见。

- MediaPipe: https://github.com/google-ai-edge/mediapipe
- Ultralytics: https://github.com/ultralytics/ultralytics
- OpenCV: https://github.com/opencv/opencv
- Flask: https://github.com/pallets/flask
