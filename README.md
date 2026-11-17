# Ski AI Analysis Open Toolkit

面向滑雪训练与教学场景的开放接入工具。仓库提供微信小程序客户端、标准化 API 文档、脱敏演示数据和接口测试，帮助教学机构与开发者快速搭建“上传视频—查询任务—查看动作报告”的应用原型。

> 本仓库开放的是客户端与接入工具，不包含项目的训练数据、专业动作评分规则、核心分析服务和生产环境配置。开放边界见 [OPEN_SOURCE_SCOPE.md](OPEN_SOURCE_SCOPE.md)。

## 已开放成果

```text
ski-ai-analysis-open/
├── miniprogram/          # 微信小程序精简客户端
├── docs/API.md           # 视频分析接口规范
├── examples/demo-data/   # 脱敏姿态演示数据
├── tests/                # 公开组件测试入口
└── OPEN_SOURCE_SCOPE.md  # 开放范围与权利边界
```

## 工作流程

```text
滑雪视频
   ↓
微信小程序选择并上传
   ↓
标准 API 创建分析任务
   ↓
分析服务返回进度与结构化报告
   ↓
小程序展示评分、问题与训练建议
```

公开仓库负责上传、接口适配、状态管理和结果展示；分析服务可由使用者按 [API 规范](docs/API.md) 自行实现，也可以接入项目团队提供的服务。

## 快速体验

1. 安装微信开发者工具。
2. 导入 `miniprogram/` 目录。
3. 打开 `miniprogram/config/env.js`，将测试环境地址改为你的 HTTPS API 地址。
4. 后端按 [API.md](docs/API.md) 实现上传、状态查询和结果查询接口。
5. 编译小程序，选择视频并查看分析报告。

本地开发可继续使用 `http://127.0.0.1:5000`。微信体验版必须配置 HTTPS 和微信公众平台合法域名。

## 运行测试

项目使用 Node.js 内置测试能力，不需要安装第三方依赖：

```bash
node --test miniprogram/tests/analysis.test.js miniprogram/tests/report-state.test.js miniprogram/tests/request.test.js
```

## 开放与保留

已开放：

- 微信小程序上传与报告展示代码
- API 请求封装与字段适配工具
- 接口文档、脱敏演示数据和测试
- 部署说明与社区协作文件

暂未开放：

- 原始训练视频、人工标注和用户数据
- 专业动作评分规则、阈值与融合策略
- 核心推理服务、自研模型权重和专家提示词
- 密钥、AppID、服务器地址等生产配置

## 开源许可

本仓库自研公开代码采用 [Apache License 2.0](LICENSE)。第三方项目和素材仍遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

欢迎通过 Issue 提交问题，通过 Pull Request 改进公开客户端、接口文档、测试和示例。参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 使用说明

本项目用于辅助训练与教学，不替代专业教练判断，也不用于医疗诊断。上传视频前请确保已取得拍摄对象授权，不要将含有个人隐私的视频提交到不可信服务。
