# 参与贡献

在提交 Issue 或 Pull Request 之前，请先读一遍这份说明。

## 提交 Issue

- 先搜索已有 Issue，避免重复。
- 反馈 Bug 时请附上：Node 版本、操作系统、复现步骤、`logs/` 里的相关报错。
- 涉及 TTS 合成的 Bug，请说明用的发音人与调用接口。
- **严禁**在 Issue 中粘贴豆包 Cookie、`data/` 下任何文件内容。

## 提交 Pull Request

1. Fork 本仓库，基于 `main` 创建分支，分支名用 `feature/xxx` 或 `fix/xxx`。
2. 保持改动小而聚焦，一次 PR 只做一件事。
3. 保持现有代码风格：ESM、2 空格缩进、无分号、中文注释。
4. 提交信息遵循 Conventional Commits：`feat:` `fix:` `docs:` `refactor:` `chore:`。
5. 提交前确认没有把 `.env`、`data/`、`logs/`、`audio/` 里的文件带进去。

## 本地开发

```bash
npm install
npm run dev
```

需要 FFmpeg（或依赖包自带的 ffmpeg-static）做音频格式转换。

## 安全相关

安全问题请勿公开提 Issue，请私下联系维护者。
