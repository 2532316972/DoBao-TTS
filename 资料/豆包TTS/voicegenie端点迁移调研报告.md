# voicegenie 新端点迁移调研报告（P0）

调研对象：`har_26-7-31.txt`（2026-07-31，豆包网页端"朗读聊天消息"功能）
调研时间：2026-08-05
结论先行：**不建议立即迁移**。新端点面向"豆包聊天消息朗读"场景，上行请求不含自定义文本字段，与本项目"自供小说文本"的调用方式不兼容；旧端点未见停服证据。

---

## 一、新端点概况

- 地址：`wss://frontier-audio-web-ws.doubao.com/api/v2/sami/voicegenie`
- 音频格式：**Ogg Opus**，`bit_rate: 32000`、`sample_rate: 24000`（旧端点为 AAC）
- 连接方式：一次任务一条连接（与旧端点相同），但支持单连接内多次会话（StartSession/StartTTS/…/CancelSession）
- 鉴权：握手**无 Cookie 头、无 a_bogus/X-Gorgon/msToken 等签名参数**（详见第三节），风控压力反而低于旧端点

### URL 参数（与旧端点差异）
保留：`aid=497858`、`real_aid=497858`、`device_id`、`web_id`、`tea_uuid`、`web_tab_id`、`language=zh`、`region=CN`、`sys_region=CN`、`samantha_web=1`、`use-olympus-account=1`、`pkg_type=release_version`、`pc_version=3.29.11`
新增：`api_app_key=GOqQpfo1fO7slHv8`、`namespace=VoiceGenie`、`version_code=20800`、`device_platform=web`、`doubao_device_platform=web`、`doubao_pc_version=3.29.11`、`web_platform=browser`
移除：`speaker`、`format`、`speech_rate`、`pitch`（移入消息体 JSON）

> 现有 P2-4 的 `web_tab_id` 会话缓存、device_id/web_id 模拟逻辑在新端点依然适用。

---

## 二、WebSocket 消息协议（已完整逆向）

### 上行消息（opcode 2，protobuf）

外层结构（无需官方 schema，字段编号已确认）：

```
message Envelope {
  string api_app_key = 1;   // "GOqQpfo1fO7slHv8"
  string namespace = 2;     // "VoiceGenie"
  string command   = 5;     // StartTask / Ping / StartSession / StartTTS / CancelSession
  string payload   = 6;     // JSON 字符串
  string session_id = 9;    // CancelSession 时携带（= TaskStarted 返回的 task_id）
}
```

命令序列（一次朗读任务，总耗时约 4.7s）：

| 序号 | 方向 | 命令 | payload | 说明 |
|---|---|---|---|---|
| 1 | send | StartTask | `{}` | 建立任务 |
| 2 | send | Ping | `{}` | |
| 3 | recv | TaskStarted | - | 返回 `task_id`(75386b68-…)、`session_id`(4a398d0d-…)、code=200 OK、logid |
| 4 | send | StartSession | 大 JSON（见下） | 声明会话与 TTS 配置 |
| 5 | recv | Pong | - | |
| 6 | recv | SessionStarted | - | |
| 7 | send | StartTTS | 与 StartSession 几乎相同 | **无 text 字段** |
| 8 | recv | ChatResponse ×N | `{raw_content, content, seq_id, base_resp}` | LLM 流式文本分片（朗读内容的来源） |
| 9 | recv | ChatEnded | `{"no_content":true}` | |
| 10 | recv | TTSSentenceStart | `{text, silence_context, tts_task_id, section_context_results}` | 整句回显 + 韵律上下文 |
| 11 | recv | TTSResponse ×N | `{"timestamp_ms":…,"tts_content_scene":"normal"}` + **OggS 二进制** | 音频帧（每条 100~700 字节） |
| 12 | recv | TTSSentenceEnd | 同句 + `mute_cut_ms:90` | |
| 13 | recv | TTSEnded | `{"no_content":false}` | 任务完成 |
| 14 | send | CancelSession | `{}` + session_id | 主动关闭会话 |
| 15 | recv | SessionCanceled | - | |

### 下行消息外层结构

```
message Response {
  string request_id = 1;   // 连接级恒定（= task_id）
  string message_id = 2;   // 每条唯一 uuid
  string namespace  = 3;   // "VoiceGenie"
  string command    = 4;   // TaskStarted/Pong/SessionStarted/ChatResponse/ChatEnded/
                           // TTSSentenceStart/TTSResponse/TTSSentenceEnd/TTSEnded/SessionCanceled
  uint64 ?          = 5;   // 疑似时间戳标记
  string status     = 6;   // "OK"
  string metadata   = 7;   // JSON（TTSResponse 为 {"timestamp_ms":…,"tts_content_scene":"normal"}）
  bytes  payload    = 8;   // 音频数据（TTSResponse 中为 Ogg Opus 流）
  uint64 ?          = 9;   // 0/1 标记
  string logid      = 11;  // "5021785…" 52 字符
}
```

### StartSession / StartTTS 的 JSON payload（关键字段）

```json
{
  "business": 1,
  "conversation_id": "38436358212841474",
  "chat": {
    "bot_id": "7338286299411103781",
    "conversation_id": "38436358212841474",
    "question_id": "51467032536358146",
    "message_id": "51466423763751170",
    "uid": "191792127156931",
    "new_conversation": false,
    "chat_next": "1",
    "enable_toast_reading": "true",
    "extra": {
      "chat_next": "1",
      "reply_unique_key": "5f6153e2-…",
      "query_local_message_id": "6f8d5b29-…"
    },
    "reply_unique_key": "5f6153e2-…",
    "section_id": "38436358212841730",
    "local_message_id": "616adfac-…",
    "query_local_message_id": "6f8d5b29-…"
  },
  "request_type": 4,
  "enable_text_reading": true,
  "interrupt_type": 0,
  "query_mode": 2,
  "tts": {
    "speaker": "zh_female_xiaohe_conversation_wvae_bigtts",
    "audio_config": { "bit_rate": 32000, "format": "ogg_opus", "sample_rate": 24000 },
    "extra": {
      "chat_next": "1",
      "query_local_message_id": "6f8d5b29-…",
      "post_process": { "pitch": 0, "speech_rate": 1 }
    }
  },
  "extra": {
    "enable_toast_reading": "true",
    "chat_next": "1",
    "uid": "191792127156931",
    "section_id": "38436358212841730",
    "reply_unique_key": "5f6153e2-…",
    "query_local_message_id": "6f8d5b29-…",
    "enable_text_simple_report": true,
    "enable_section_report": true,
    "enable_card_simple_report": true,
    "enable_image_asr_ctx": true,
    "disable_markdown_filter": true,
    "enable_asr_audio_context": false,
    "is_server_error_retry": false,
    "enable_card_report": false,
    "enable_chat_bot_card_report": false,
    "enable_timestamp_report": false,
    "enable_report_adaptive_card": false,
    "sequence": 1
  }
}
```

---

## 三、握手头（无签名）

```
Upgrade: websocket
Origin: https://www.doubao.com
Cache-Control: no-cache
Accept-Language: zh,zh-CN;q=0.9
Pragma: no-cache
Connection: Upgrade
Sec-WebSocket-Key: …
Accept-Encoding: gzip, deflate, br, zstd
User-Agent: Chrome/144 … Edg/144 …
Sec-WebSocket-Version: 13
Host: frontier-audio-web-ws.doubao.com
Sec-WebSocket-Extensions: permessage-deflate
```

无 Cookie 头、无签名参数 → 新端点身份凭据仅靠 URL 参数（device_id/web_id 等）+ TLS。本项目现有 cookie 体系（扫码登录、切换、校验）对新端点**不适用**；设备指纹模拟（P2-1 修正后的 verifyFp 6 段格式）仍可用于 URL 参数中的 device_id/web_id 生成。

---

## 四、迁移障碍（核心结论）

1. **上行无文本字段**：StartTTS payload 中不存在 `text`/`content` 字段（已逐字段确认）。朗读内容由服务端从 `conversation_id` + `question_id`/`message_id` 关联的**真实豆包聊天消息**中取出（下行 ChatResponse 流式回传 LLM 文本，TTSSentenceStart 回显整句）。
2. **会话上下文必须真实**：`bot_id=7338286299411103781`（豆包主聊天 bot）、`uid`、`conversation_id`、`section_id`、`message_id` 均为网页端真实值。若伪造，服务端需能按该 uid 解析出对应消息；本项目"任意小说文本"无法通过此通道注入。
3. **结论**：新端点无法直接承载本项目场景（自供文本合成）。除非后续抓到"自定义文本朗读"工具（如豆包 AI 阅读/其他网页工具）的 HAR，确认存在带 text 的协议变体（如 `aria`、`text2speech` 等 command），否则不可迁移。

---

## 五、建议（分级处置）

1. **保持旧端点**（`wss://ws-samantha.doubao.com/samantha/audio/tts`）为主通道：
   - har_26-3-6、har_26-4-9 证明旧端点 2026-04-09 前正常；7-31 网页端切换只说明"聊天朗读"功能迁至 voicegenie，无旧端点停服证据。
   - 继续依赖现有 BLOCK 错误码识别 + Cookie 轮换机制。
2. **加装失效哨兵**：若旧端点 4xx/5xx 或秒断频率突增（可复用现有失败统计），输出告警日志，提示排查新端点 HAR。
3. **预留迁移改造点**（一旦出现带 text 的 voicegenie 变体，改造量较小）：
   - `websocketClient.js`：换 URL 模板 + 消息构造改为 Envelope（protobuf 手写编码即可，字段编号已确定，无需 proto 文件）；
   - 消息序列改为 StartTask→Ping→StartSession→StartTTS→（音频帧）→CancelSession；
   - `audioProcessor.js`：`convertAacBufferToMp3` 的 `inputFormat('aac')` 改为 Ogg Opus 输入（ffmpeg 原生支持），`validateAudio` 的魔数识别从 AAC 帧改为 `OggS`；
   - cookie 体系停用，改为纯设备参数（device_id/web_id/web_tab_id/verifyFp）鉴权。

---

## 六、附：证据索引（har_26-7-31.txt）

- URL：L7854
- 握手头：L7855-7905（无 Cookie / 无签名）
- `_webSocketMessages` 完整序列：L7632-7848
- 音频格式证据：StartSession/StartTTS 的 `tts.audio_config`（ogg_opus / 32000 / 24000）；TTSResponse 中 `OggS` 魔数（L7715 等）
- 文本无上行注入证据：StartTTS 解码全文（L7673）无 `text` 字段；朗读文本源自 ChatResponse 流（L7679-7703，seq_id 3/6/9/12）与 TTSSentenceStart 回显（L7709）
