# DoBao TTS - 豆包语音合成服务

一个基于豆包（字节跳动）TTS API 的语音合成服务，支持 Web 界面操作和阅读 APP 集成。

## 功能特性

- **语音合成**：将文本转换为高质量语音，支持多种发音人
- **阅读 APP 集成**：为阅读 APP 提供 TTS 服务接口
- **书籍缓存**：预缓存整本书的音频，提升阅读体验
- **Cookie 管理**：支持多 Cookie 轮询，提高服务稳定性
- **Web 管理界面**：直观的浏览器操作界面
- **多平台支持**：支持 Windows 和 Android (Termux)

## 技术栈

- **后端**：Node.js + Express
- **实时通信**：WebSocket
- **音频处理**：FFmpeg
- **前端**：原生 HTML/CSS/JavaScript
- **代码保护**：esbuild 打包混淆

## 快速开始

### 方式一：使用打包版本（推荐）

#### Windows 版本

1. 下载 `DoBao-TTS-Win.zip` 并解压
2. 双击运行 `start.bat`
3. 在浏览器中访问显示的地址

#### Android (Termux) 版本

1. 安装 [Termux](https://f-droid.org/packages/com.termux/) (F-Droid 版本)
2. 在 Termux 中安装依赖：
   ```bash
   pkg update
   pkg install nodejs ffmpeg
   ```
   > **注意**: `ffmpeg` 是必需的，用于音频格式转换（AAC 转 MP3）
3. 下载 `DoBao-TTS-Android.zip` 并解压到 Termux 目录
4. 运行启动脚本：
   ```bash
   bash start.sh
   ```

### 方式二：源码运行

#### 安装要求

- Node.js >= 18.0.0
- Windows / Linux / macOS / Android (Termux)

#### 安装依赖

```bash
npm install
```

#### 启动服务

**开发模式**：
```bash
npm run dev
```

**生产模式**：
```bash
npm start
```

#### 访问服务

服务启动后，在浏览器中访问：
```
http://localhost:3000
```

## 打包构建

### 打包命令

```bash
# 交互式菜单（选择平台）
npm run build

# 直接打包 Windows 版本
npm run build:win

# 直接打包 Android (Termux) 版本
npm run build:android

# 打包所有平台
npm run build:all
```

### 打包输出

打包后的文件位于 `build/` 目录：

```
build/
├── DoBao-TTS-Win/          # Windows 版本
├── DoBao-TTS-Win.zip       # Windows 压缩包
├── DoBao-TTS-Android/      # Android 版本
└── DoBao-TTS-Android.zip   # Android 压缩包
```

### 打包特性

- **代码混淆**：服务端和前端代码全部混淆压缩
- **智能清理**：只清理对应平台的旧构建，不会误删其他平台
- **自动下载**：Windows 版本自动下载 Node.js 运行环境
- **中文文档**：自动生成中文使用说明

## 配置说明

### Cookie 配置

首次使用需要配置豆包 Cookie：

1. 打开浏览器访问 `http://localhost:3000/pages/cookies.html`
2. 登录 [豆包](https://www.doubao.com) 网站
3. 按 F12 打开开发者工具
4. 复制 Cookie 中的 `session` 值
5. 在 Cookie 管理页面添加 Cookie

### 系统设置

访问 `http://localhost:3000/pages/settings.html` 可配置：

- **请求延迟**：控制请求频率，避免触发限制
- **最大重试次数**：TTS 失败时的重试次数
- **默认发音人**：设置默认语音
- **语速/音调**：默认语音参数

## API 接口

### 语音合成

```http
POST /api/tts
Content-Type: application/json

{
  "text": "要转换的文本",
  "voiceId": "zh-CN-XiaoxiaoNeural",
  "rate": 0,
  "pitch": 0
}
```

### 获取发音人列表

```http
GET /api/voices
```

### 阅读 APP TTS 配置

```http
GET /api/legado/tts-config?voiceId=zh-CN-XiaoxiaoNeural
```

### 阅读 APP TTS 流

```http
GET /api/reader/tts/stream?text=文本内容&voice=发音人ID&speed=语速
```

## 项目结构

```
DoBao-TTS/
├── src/                      # 源代码
│   ├── server.js             # 服务入口
│   ├── routes/               # API 路由
│   ├── services/             # 业务逻辑
│   └── utils/                # 工具函数
├── public/                   # 静态资源
│   ├── index.html            # 首页
│   ├── pages/                # 页面
│   └── js/                   # 前端脚本
├── config/                   # 配置文件
├── build/                    # 打包输出目录
├── build-prod.js             # 打包脚本
├── data/                     # 数据存储
├── audio/                    # 音频缓存
└── logs/                     # 日志文件
```

## 可用脚本

```bash
# 开发模式启动
npm run dev

# 生产模式启动
npm start

# 打包（交互式菜单）
npm run build

# 打包 Windows 版本
npm run build:win

# 打包 Android 版本
npm run build:android

# 打包所有平台
npm run build:all

# 清空日志
npm run clean:logs

# 清空音频缓存
npm run clean:audio
```

## 注意事项

1. **Cookie 有效期**：豆包 Cookie 会过期，需要定期更新
2. **请求频率**：建议设置适当的请求延迟，避免触发频率限制
3. **音频格式**：服务自动将 AAC 转换为 MP3 格式
4. **缓存管理**：定期清理音频缓存以释放磁盘空间
5. **Termux 版本**：Android 版本需要在 Termux 中手动安装 Node.js

## 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| Windows | ✅ 完整支持 | 带 Node.js 运行环境 |
| Android (Termux) | ✅ 完整支持 | 需手动安装 Node.js |
| Linux | ✅ 源码支持 | 使用 npm start |
| macOS | ✅ 源码支持 | 使用 npm start |

## 许可证

ISC

## 相关链接

- [豆包](https://www.doubao.com)
- [阅读 APP](https://github.com/gedoor/legado)
- [Termux](https://termux.dev/)

## docs 目录与资料

- `docs/` 收录功能开发与移植指南（用户统计、预制书）的整理版
- `资料/` 保留开发过程的原始资料：阅读 APP 接口文档、豆包端点迁移调研、音色列表、移植指南等
