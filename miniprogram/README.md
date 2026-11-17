# 微信小程序端说明

这个目录是原生微信小程序端，对接当前仓库里的 Flask 后端接口：

- `POST /api/upload`
- `GET /api/status/<analysis_id>`
- `GET /api/results/<analysis_id>?compact=1`
- `GET /api/video/<analysis_id>`
- `GET /api/pose3d/<analysis_id>`

## 目录结构

```text
miniprogram/
├─ app.js / app.json / app.wxss
├─ config/env.js
├─ utils/request.js
├─ utils/analysis.js
└─ pages/
   ├─ home/
   └─ report/
```

## 本地运行

1. 用微信开发者工具直接打开 `miniprogram` 目录
2. 在 `config/env.js` 里确认开发环境的后端地址
3. 启动后端服务

`develop` 环境默认使用：

```js
const ENV_API_BASE_URLS = {
  develop: 'http://127.0.0.1:5000',
  trial: '',
  release: '',
};
```

也可以通过 `wx.getExtConfigSync()` 可读取的 `extConfig.apiBaseUrl` 覆盖对应环境的映射值。
地址解析顺序是 extConfig 优先、`ENV_API_BASE_URLS` 其次。

## 体验版和正式版配置

`trial` 和 `release` 环境不会回退到 localhost。普通小程序可以直接填写
`config/env.js` 中对应的 `trial` / `release` 映射；第三方代开发场景也可以通过 extConfig
注入后端地址：

```json
{
  "apiBaseUrl": "https://<你的后端合法域名>"
}
```

这里必须替换为真实的 HTTPS 地址，不能使用 localhost、127.0.0.1 或 `0.0.0.0`。
未配置、格式错误或仍指向本机时，请求层会直接显示配置错误，避免把请求静默发到用户
手机自身。仓库没有预填正式域名，发布者需要填写已在微信后台登记的真实域名。

## 真机调试

局域网真机调试需要让后端监听局域网地址。例如在 PowerShell 中运行：

```powershell
$env:SKI_APP_HOST='0.0.0.0'
python backend\app.py
```

然后把 `config/env.js` 中 `ENV_API_BASE_URLS.develop` 改成电脑的实际局域网地址：

```js
develop: 'http://<电脑局域网 IP>:5000',
```

开发者工具中可以临时关闭合法域名校验。体验版和正式版必须把真实后端域名加入微信
小程序后台的 request、uploadFile、downloadFile 和 media 合法域名列表。

## 上传限制

首页仅接受 MP4、MOV、AVI 视频，单文件上限 200MB。可选训练参数范围与 Web 端一致：
身高 80-250cm、体重 20-250kg、雪板长度 60-240cm。

## 发布前清单

- 在 `project.private.config.json` 或 CI 发布配置中提供真实 AppID；仓库不提交账号标识。
- 在微信公众平台完成《用户隐私保护指引》，覆盖选择/上传视频、身高体重等训练参数、
  保存视频到相册等用途，并按平台要求配置隐私授权交互。
- 为公开服务接入 `wx.login` 对应的服务端会话和用户级授权。当前 `analysis_id` 是随机能力标识，
  已能隔离任务和防止相互取消，但不能替代正式用户认证。
- 使用真机分别验证相册拒绝、弱网、200MB 边界、任务满载、后台切换和报告删除流程。

## 当前页面

- 首页：选择视频、填写训练参数、上传并发起分析
- 结果页：轮询进度、播放可视化视频、展示评分卡、AI 建议、时间线、趋势曲线和 3D 骨骼预览
