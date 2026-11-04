import { Router } from 'express'
import fs from 'fs'
import fsPromises from 'fs/promises'
import fsExtra from 'fs-extra'
import { voiceService } from '../services/voiceService.js'
import { log, logError } from '../utils/logger.js'
import { legadoApiClient } from '../services/legadoApiClient.js'
import * as apiResponse from '../utils/apiResponse.js'
import { prefetchService } from '../services/prefetch/prefetchService.js'
import { cacheQueryService } from '../services/prefetch/cacheQueryService.js'
import { bookCacheService } from '../services/prefetch/bookCacheService.js'
import { txtPrefabService } from '../services/txtPrefabService.js'
import { scheduledPrefetchService } from '../services/scheduledPrefetchService.js'
import { getDataPath, getSafeDirName } from '../utils/pathUtils.js'
import { loadTtsConfig } from '../utils/ttsUtils.js'
import path from 'path'
import { fileURLToPath } from 'url'

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 获取TTS配置中的延迟默认值
 * 使用loadTtsConfig以支持配置热更新
 * @returns {Object} 包含defaultRequestIntervalDelay和defaultRequestDelay的对象
 */
function getTtsDelayDefaults() {
  try {
    const ttsConfig = loadTtsConfig()
    return {
      defaultRequestIntervalDelay: ttsConfig.requestIntervalDelay ?? 3,
      defaultRequestDelay: ttsConfig.requestDelay ?? 15
    }
  } catch (error) {
    log('warn', '无法加载TTS配置，使用默认值', { error: error.message })
    return {
      defaultRequestIntervalDelay: 3,
      defaultRequestDelay: 15
    }
  }
}

export const legadoRouter = Router()

/**
 * 阅读APP TTS配置接口
 * GET /api/legado/tts-config
 * @param {string} voiceId - 发音人ID（必需）
 * @param {number} delay - 延迟秒数（可选，默认5）
 * @param {string} engineName - 引擎名称（可选，默认"豆包TTS"）
 * @param {string} contentType - 音频格式（可选，默认"audio/mpeg"）
 * @param {boolean} enableCookie - 是否启用Cookie（可选，默认false）
 */
legadoRouter.get('/legado/tts-config', (req, res) => {
  const {
    voiceId,
    delay,
    engineName = '豆包TTS',
    // 强制使用audio/mpeg格式，忽略用户选择
    contentType = 'audio/mpeg',
    enableCookie = 'false'
  } = req.query

  if (!voiceId) {
    log('warn', '阅读TTS配置请求缺少voiceId参数')
    // 返回JSON格式的错误响应
    return res.status(400).json({
      error: '缺少voiceId参数',
      message: '请提供有效的voiceId参数'
    })
  }

  // 处理delay参数：如果为空或未定义，使用配置中的requestDelay（默认15秒）
  // 这个delay参数用于Cookie轮询完成后的延迟
  const { defaultRequestDelay } = getTtsDelayDefaults()
  const effectiveDelay = delay && delay !== '' ? parseInt(delay) : defaultRequestDelay

  const baseUrl = `${req.protocol}://${req.get('host')}`
  // 实时模式：不使用预制音频，直接实时生成TTS
  // 将延迟参数传递给TTS流接口（用于Cookie轮询延迟）
  const ttsUrl = `${baseUrl}/api/reader/tts/stream?text={{java.encodeURI(speakText)}}&speed={{speakSpeed}}&voice=${voiceId}&usePrefetch=false&delay=${effectiveDelay}`

  const config = {
    id: Date.now(),
    name: engineName,
    url: ttsUrl,
    contentType: contentType,
    // TTS调用禁止并发，强制设置为1
    concurrentRate: '1',
    enabledCookieJar: enableCookie === 'true',
    header: '',
    loginUrl: '',
    loginUi: '',
    loginCheckJs: '',
    lastUpdateTime: Date.now()
  }

  log('info', '阅读TTS配置请求', { voiceId, engineName, delay, effectiveDelay })
  res.json(config)
})

/**
 * 阅读APP TTS配置接口 - 预制模式专用
 * GET /api/legado/tts-config-prefab
 * 预制模式的音频都是提前生成好的，不支持实时调节 speed 和 voice
 * @param {string} engineName - 引擎名称（可选，默认"DoBao-预制模式"）
 */
legadoRouter.get('/legado/tts-config-prefab', (req, res) => {
  const {
    engineName = 'DoBao-预制模式'
  } = req.query

  const baseUrl = `${req.protocol}://${req.get('host')}`
  // 预制模式：使用专用端点 /api/reader/tts/stream-prefetch
  // 此端点强制使用预制模式，不依赖usePrefetch参数，避免阅读APP丢失参数的问题
  // speed 和 voice 由服务端根据预制音频决定
  const ttsUrl = `${baseUrl}/api/reader/tts/stream-prefetch?text={{java.encodeURI(speakText)}}`

  const config = {
    id: Date.now(),
    name: engineName,
    url: ttsUrl,
    contentType: 'audio/mpeg',
    // TTS调用禁止并发，强制设置为1
    concurrentRate: '1',
    enabledCookieJar: false,
    header: '',
    loginUrl: '',
    loginUi: '',
    loginCheckJs: '',
    lastUpdateTime: Date.now()
  }

  log('info', '阅读TTS预制模式配置请求', { engineName })
  res.json(config)
})

/**
 * 阅读APP TTS接口
 * GET /api/reader/tts/stream
 * @param {string} text - 要转换的文本（必需）
 * @param {string} voice - 发音人ID（可选，默认使用系统默认发音人）
 * @param {number} speed - 语速（可选，默认0）
 * @param {boolean} usePrefetch - 是否使用预制音频（可选，默认false）
 *                                        true: 优先使用预制音频，未命中时返回静音
 *                                        false: 实时生成TTS音频
 * @param {number} delay - 请求延迟秒数（可选，默认使用配置值）
 */
legadoRouter.get('/reader/tts/stream', async (req, res) => {
  const { text, voice, speed = 0, usePrefetch = 'false', delay } = req.query

  // 记录完整的查询参数
  log('debug', '阅读TTS流请求参数', { query: req.query, url: req.url, originalUrl: req.originalUrl })

  // 检查usePrefetch参数值，用于调试
  log('debug', 'usePrefetch参数详情', {
    usePrefetch,
    usePrefetchType: typeof usePrefetch,
    isTrue: usePrefetch === 'true',
    queryKeys: Object.keys(req.query)
  })

  // 预定义静音MP3，确保在所有错误情况下都能返回
  const silentMp3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4Qvw1l8AAAAAAD/+xDEAAP8AFQCOEEBAYDBh/iAAABCJ3AXPwAAAmP/wgIhB4GAYCBgICAgICAgICAgICAgICAgICAgIA//sQxCkD/AAhP+YAAAlwAKn/4AAAH/wICAgICAgICAgICAgICAgICAgICAgICAgICAgICA', 'base64')

  // 验证参数 - 根据阅读APP文档，应该静默失败而不是返回错误
  if (!text) {
    log('warn', '阅读TTS请求缺少text参数')
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)
  }

  // 默认发音人（当没有提供voice参数时使用）
  const defaultVoiceId = 'zh_female_wenroutaozi_uranus_bigtts'
  const voiceId = voice || defaultVoiceId

  // 判断是否使用预制音频模式
  const shouldUsePrefetch = usePrefetch === 'true'

  try {
    // 如果使用预制音频模式，先检查是否有对应的预制音频
    if (shouldUsePrefetch) {
      log('info', '预制模式：开始查找预制音频', { textLength: text.length, voice: voiceId })
      const prefetchAudio = await cacheQueryService.findAudioByText(text)

      if (prefetchAudio) {
        // 找到匹配的预制音频，直接返回
        log('info', '预制模式：找到预制音频，直接返回', {
          bookId: prefetchAudio.bookId,
          chapterId: prefetchAudio.chapterId,
          segmentId: prefetchAudio.segmentId
        })

        // 验证音频文件是否存在
        if (fs.existsSync(prefetchAudio.audioPath)) {
          const stats = fs.statSync(prefetchAudio.audioPath)

          // 检查文件大小是否正常
          if (stats.size > 0) {
            // 更新Cookie使用统计（预制书模式也计入使用）
            try {
              const cookieManager = (await import('../services/cookieManager.js')).default
              const activeCookie = cookieManager.getActiveCookie()
              if (activeCookie) {
                await cookieManager.updateCookieUsage(activeCookie.id, true)
                log('debug', '预制模式：已更新Cookie使用统计', { cookieId: activeCookie.id })
              }
            } catch (statsError) {
              log('warn', '预制模式：更新Cookie统计失败', { error: statsError.message })
            }

            res.set('Content-Type', 'audio/mpeg')
            res.set('Content-Length', stats.size)
            res.sendFile(path.resolve(prefetchAudio.audioPath))
            return
          }
        }

        log('warn', '预制模式：预制音频文件不存在或无效', { audioPath: prefetchAudio.audioPath })
      }

      // 预制模式未找到音频，返回静音
      log('info', '预制模式：未找到匹配的预制音频，返回静音音频', { textLength: text.length })
      res.set('Content-Type', 'audio/mpeg')
      return res.send(silentMp3)
    }

    // 实时模式：直接生成TTS音频流，不保存到文件
    // 解析延迟参数
    // delay参数用于Cookie轮询完成后的延迟（requestDelay）
    // 请求间隔延迟（requestIntervalDelay）使用系统设置的默认值
    log('debug', '解析delay参数', { delay, delayType: typeof delay, delayValue: delay?.valueOf() })
    // 获取最新的延迟默认值（支持配置热更新）
    const { defaultRequestIntervalDelay, defaultRequestDelay } = getTtsDelayDefaults()
    // Cookie轮询延迟：使用传入的delay参数，或默认15秒
    const cookieRoundDelay = delay !== undefined && delay !== null && delay !== '' ? parseInt(delay) : defaultRequestDelay
    // 请求间隔延迟：使用系统设置的默认值（3秒）
    const intervalDelay = defaultRequestIntervalDelay
    log('info', '实时模式：开始生成TTS音频流', { textLength: text.length, voice: voiceId, speed, cookieRoundDelay, intervalDelay, rawDelay: delay, defaultRequestDelay, defaultRequestIntervalDelay })

    // 导入ttsService
    const { ttsService } = await import('../services/ttsService.js')

    // 生成语音流（直接返回Buffer，不保存到文件）
    // requestDelay: Cookie轮询完成后的延迟（实时模式设置）
    // requestIntervalDelay: 请求间隔延迟（系统设置）
    log('info', '实时模式：调用ttsService.generateSpeechStream', { textLength: text.length, voiceId, speed, cookieRoundDelay, intervalDelay })

    const requestStartTime = Date.now()
    let audioBuffer
    try {
      audioBuffer = await ttsService.generateSpeechStream({
        text,
        voiceId,
        rate: parseInt(speed) || 0,
        requestDelay: cookieRoundDelay,
        requestIntervalDelay: intervalDelay
      })
      log('info', '实时模式：ttsService.generateSpeechStream完成', { duration: Date.now() - requestStartTime, bufferSize: audioBuffer?.length })
    } catch (streamError) {
      logError(streamError, { stage: '实时模式TTS流生成', textLength: text.length, voiceId, duration: Date.now() - requestStartTime })
      throw streamError
    }

    // 直接返回音频流
    if (audioBuffer && audioBuffer.length > 0) {
      res.set('Content-Type', 'audio/mpeg')
      res.set('Content-Length', audioBuffer.length)
      res.send(audioBuffer)
      log('info', '实时模式：TTS音频流生成成功', { size: audioBuffer.length, duration: Date.now() - requestStartTime })
    } else {
      throw new Error('生成的音频流为空')
    }

  } catch (error) {
    logError(error, { stage: '阅读TTS生成', mode: shouldUsePrefetch ? 'prefetch' : 'realtime' })

    // 根据阅读APP的协议，即使出错也应该返回音频格式
    // 返回一个极小的静音MP3文件，记录错误但不中断播放
    log('error', '阅读TTS生成失败，返回静音音频', {
      error: error.message,
      textPreview: text.substring(0, 50),
      voice: voiceId,
      mode: shouldUsePrefetch ? 'prefetch' : 'realtime'
    })

    try {
      // 确保返回有效的静音MP3
      res.set('Content-Type', 'audio/mpeg')
      res.send(silentMp3)
    } catch (sendError) {
      // 最后的保障，确保响应被发送
      logError(sendError, { stage: '发送静音MP3' })
      // 如果连静音MP3都发送失败，尝试发送空响应
      try {
        res.set('Content-Type', 'audio/mpeg')
        res.end()
      } catch (finalError) {
        logError(finalError, { stage: '发送空响应' })
      }
    }
  }
})

/**
 * 阅读APP TTS接口 - 预制模式专用端点
 * GET /api/reader/tts/stream-prefetch
 * 此端点强制使用预制模式，不依赖usePrefetch参数
 * 用于解决阅读APP可能不支持或丢失URL参数的问题
 * @param {string} text - 要转换的文本（必需）
 */
legadoRouter.get('/reader/tts/stream-prefetch', async (req, res) => {
  const { text } = req.query

  // 记录请求参数
  log('debug', '预制模式专用端点请求参数', { query: req.query, url: req.url })

  // 预定义静音MP3
  const silentMp3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4Qvw1l8AAAAAAD/+xDEAAP8AFQCOEEBAYDBh/iAAABCJ3AXPwAAAmP/wgIhB4GAYCBgICAgICAgICAgICAgICAgICAgIA//sQxCkD/AAhP+YAAAlwAKn/4AAAH/wICAgICAgICAgICAgICAgICAgICAgICAgICAgICA', 'base64')

  // 验证参数
  if (!text) {
    log('warn', '预制模式专用端点缺少text参数')
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)
  }

  try {
    log('info', '预制模式专用端点：开始查找预制音频', { textLength: text.length })
    const prefetchAudio = await cacheQueryService.findAudioByText(text)

    if (prefetchAudio) {
      // 验证音频文件是否存在
      if (fs.existsSync(prefetchAudio.audioPath)) {
        const stats = fs.statSync(prefetchAudio.audioPath)

        if (stats.size > 0) {
          log('info', '预制模式专用端点：找到预制音频，直接返回', {
            bookId: prefetchAudio.bookId,
            chapterId: prefetchAudio.chapterId,
            fileSize: stats.size
          })

          // 更新Cookie使用统计（预制书模式也计入使用）
          try {
            const cookieManager = (await import('../services/cookieManager.js')).default
            const activeCookie = cookieManager.getActiveCookie()
            if (activeCookie) {
              await cookieManager.updateCookieUsage(activeCookie.id, true)
              log('debug', '预制模式：已更新Cookie使用统计', { cookieId: activeCookie.id })
            }
          } catch (statsError) {
            log('warn', '预制模式：更新Cookie统计失败', { error: statsError.message })
          }

          res.set('Content-Type', 'audio/mpeg')
          res.set('Content-Length', stats.size)
          return res.sendFile(path.resolve(prefetchAudio.audioPath))
        }
      }
      log('warn', '预制模式专用端点：预制音频文件不存在或无效', { audioPath: prefetchAudio.audioPath })
    }

    // 未找到音频，返回静音
    log('info', '预制模式专用端点：未找到匹配的预制音频，返回静音音频', { textLength: text.length })
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)

  } catch (error) {
    logError(error, { stage: '预制模式专用端点TTS生成' })
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)
  }
})

/**
 * 代理阅读Web服务 - 获取书架列表
 * POST /api/legado/proxy/bookshelf
 */
legadoRouter.post('/legado/proxy/bookshelf', async (req, res) => {
  const { serverIp, serverPort } = req.body

  if (!serverIp || !serverPort) {
    return res.status(400).json({
      success: false,
      message: '缺少必需参数：serverIp 和 serverPort'
    })
  }

  try {
    const result = await legadoApiClient.getBookshelf(serverIp, serverPort)
    
    let books = result
    if (result && result.data && Array.isArray(result.data)) {
      books = result.data
    } else if (!Array.isArray(result)) {
      books = []
    }
    
    const enhancedBooks = await Promise.all(books.map(async (book) => {
      try {
        const chapterResult = await legadoApiClient.getChapterList(serverIp, serverPort, book.bookUrl)
        
        let chapterCount = 0
        if (chapterResult && chapterResult.data && Array.isArray(chapterResult.data)) {
          chapterCount = chapterResult.data.length
        } else if (Array.isArray(chapterResult)) {
          chapterCount = chapterResult.length
        }
        
        return {
          ...book,
          totalChapters: chapterCount
        }
      } catch (error) {
        return {
          ...book,
          totalChapters: book.durChapterIndex + 1 || 0
        }
      }
    }))
    
    res.json({
      success: true,
      data: enhancedBooks,
      message: '获取书架列表成功'
    })
  } catch (error) {
    logError(error, { stage: '获取书架列表', serverIp, serverPort })
    res.status(500).json({
      success: false,
      message: error.message || '连接失败，请检查服务器地址和端口是否正确'
    })
  }
})

/**
 * 代理阅读Web服务 - 获取章节列表
 * POST /api/legado/proxy/chapters
 */
legadoRouter.post('/legado/proxy/chapters', async (req, res) => {
  const { serverIp, serverPort, bookUrl } = req.body

  if (!serverIp || !serverPort) {
    return res.status(400).json(apiResponse.error('缺少必需参数：serverIp 和 serverPort', 400))
  }

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  try {
    const result = await legadoApiClient.getChapterList(serverIp, serverPort, bookUrl)
    
    let chapters = []
    if (result && result.data && Array.isArray(result.data)) {
      chapters = result.data
    } else if (Array.isArray(result)) {
      chapters = result
    }
    
    res.json(apiResponse.success(chapters, '获取章节列表成功'))
  } catch (error) {
    logError(error, { stage: '获取章节列表', serverIp, serverPort, bookUrl })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 代理阅读Web服务 - 获取章节内容
 * POST /api/legado/proxy/content
 */
legadoRouter.post('/legado/proxy/content', async (req, res) => {
  const { serverIp, serverPort, bookUrl, chapterIndex } = req.body

  if (!serverIp || !serverPort) {
    return res.status(400).json(apiResponse.error('缺少必需参数：serverIp 和 serverPort', 400))
  }

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  if (chapterIndex === undefined || chapterIndex === null) {
    return res.status(400).json(apiResponse.error('缺少必需参数：chapterIndex', 400))
  }

  try {
    const data = await legadoApiClient.getChapterContent(serverIp, serverPort, bookUrl, chapterIndex)
    res.json(apiResponse.success(data, '获取章节内容成功'))
  } catch (error) {
    logError(error, { stage: '获取章节内容' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 代理阅读Web服务 - 获取书籍封面
 * GET /api/legado/proxy/cover
 */
legadoRouter.get('/legado/proxy/cover', async (req, res) => {
  const { serverIp, serverPort, coverPath } = req.query

  if (!serverIp || !serverPort) {
    return res.status(400).json(apiResponse.error('缺少必需参数：serverIp 和 serverPort', 400))
  }

  if (!coverPath) {
    return res.status(400).json(apiResponse.error('缺少必需参数：coverPath', 400))
  }

  try {
    const imageBuffer = await legadoApiClient.getCover(serverIp, serverPort, coverPath)
    
    res.set('Content-Type', 'image/jpeg')
    res.send(imageBuffer)
  } catch (error) {
    logError(error, { stage: '获取书籍封面' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 开始处理单个章节
 * POST /api/legado/prefetch/start
 */
legadoRouter.post('/legado/prefetch/start', async (req, res) => {
  const { bookInfo, chapterInfo, options } = req.body

  if (!bookInfo || !chapterInfo || !options) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookInfo、chapterInfo 或 options', 400))
  }

  if (!bookInfo.bookId || !bookInfo.bookName || !bookInfo.bookUrl) {
    return res.status(400).json(apiResponse.error('bookInfo 缺少必需字段', 400))
  }

  if (!chapterInfo.chapterId || !chapterInfo.chapterTitle || !chapterInfo.chapterUrl || chapterInfo.chapterIndex === undefined) {
    return res.status(400).json(apiResponse.error('chapterInfo 缺少必需字段', 400))
  }

  if (!options.voiceId) {
    return res.status(400).json(apiResponse.error('options 缺少必需字段: voiceId', 400))
  }

  // serverIp 和 serverPort 不再是必需字段，允许使用本地缓存

  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    log('info', '开始预制书处理', { bookId: bookInfo.bookId, chapterId: chapterInfo.chapterId })

    // 生成任务ID
    const taskId = `task_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

    // 创建任务记录
    await prefetchService.createTask({
      taskId,
      bookInfo,
      chapterInfo,
      options,
      status: 'processing',
      progress: {
        current: 0,
        total: 0,
        completed: [],
        failed: []
      }
    })

    // 异步处理章节（不等待完成）
    prefetchService.processChapter(bookInfo, chapterInfo, options, taskId).then(async result => {
      log('info', '章节处理完成', { taskId, bookId: bookInfo.bookId, chapterId: chapterInfo.chapterId })
      // 更新任务状态为已完成
      await prefetchService.updateTaskStatus(taskId, 'completed', {
        total: result.metadata.totalSegments,
        completed: result.metadata.completedSegments
      })
    }).catch(async error => {
      logError(error, { stage: '章节处理失败', taskId, bookId: bookInfo.bookId, chapterId: chapterInfo.chapterId })
      // 更新任务状态为失败或取消
      const status = error.message === '任务已取消' ? 'cancelled' : 'failed'
      await prefetchService.updateTaskStatus(taskId, status)
    })

    // 立即返回任务ID，让前端可以轮询状态
    res.json({
      success: true,
      data: {
        taskId: taskId,
        status: 'processing',
        progress: {
          total: 0,
          completed: 0,
          failed: 0
        }
      },
      message: '任务已启动'
    })
  } catch (error) {
    logError(error, { stage: '预制书处理启动' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 批量处理多个章节
 * POST /api/legado/prefetch/batch-start
 * 
 * 支持两种模式：
 * 1. 完整章节列表模式：传入 chaptersInfo 数组（兼容旧版本）
 * 2. 章节范围模式：传入 chapterRange { startIndex, endIndex }（推荐，减少数据传输）
 */
legadoRouter.post('/legado/prefetch/batch-start', async (req, res) => {
  const { bookInfo, chaptersInfo, chapterRange, options } = req.body

  if (!bookInfo || !options) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookInfo 或 options', 400))
  }

  if (!bookInfo.bookId || !bookInfo.bookName || !bookInfo.bookUrl) {
    return res.status(400).json(apiResponse.error('bookInfo 缺少必需字段', 400))
  }

  if (!options.voiceId) {
    return res.status(400).json(apiResponse.error('options 缺少必需字段: voiceId', 400))
  }

  try {
    let finalChaptersInfo = chaptersInfo

    // 如果传入的是章节范围模式，从书籍缓存或源站获取章节列表
    if (!chaptersInfo && chapterRange) {
      const { startIndex, endIndex } = chapterRange
      if (typeof startIndex !== 'number' || typeof endIndex !== 'number') {
        return res.status(400).json(apiResponse.error('chapterRange 必须包含 startIndex 和 endIndex', 400))
      }
      if (startIndex < 0 || endIndex < startIndex) {
        return res.status(400).json(apiResponse.error('章节范围无效', 400))
      }

      log('info', '使用章节范围模式获取章节列表', { bookId: bookInfo.bookId, startIndex, endIndex })

      // 从书籍缓存服务获取章节列表
      finalChaptersInfo = await prefetchService.getChaptersInRange(bookInfo, startIndex, endIndex)

      if (!finalChaptersInfo || finalChaptersInfo.length === 0) {
        return res.status(400).json(apiResponse.error('无法获取指定范围的章节列表', 400))
      }

      log('info', '成功获取章节列表', { bookId: bookInfo.bookId, count: finalChaptersInfo.length })
    }

    if (!Array.isArray(finalChaptersInfo) || finalChaptersInfo.length === 0) {
      return res.status(400).json(apiResponse.error('chaptersInfo 必须是包含至少一个章节的数组', 400))
    }

    // 验证每个章节的信息
    for (let i = 0; i < finalChaptersInfo.length; i++) {
      const chapter = finalChaptersInfo[i]
      if (!chapter.chapterId || !chapter.chapterTitle || chapter.chapterIndex === undefined) {
        return res.status(400).json(apiResponse.error(`第 ${i + 1} 个章节缺少必需字段`, 400))
      }
    }

    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    log('info', '开始批量预制书处理', { bookId: bookInfo.bookId, totalChapters: finalChaptersInfo.length })

    // 使用批量处理方法
    const task = await prefetchService.batchProcessChapters(bookInfo, finalChaptersInfo, options)

    // 立即返回任务ID，让前端可以轮询状态
    res.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: 'processing',
        progress: {
          total: finalChaptersInfo.length,
          completed: 0,
          failed: 0
        }
      },
      message: `批量任务已启动，共 ${finalChaptersInfo.length} 个章节`
    })
  } catch (error) {
    logError(error, { stage: '批量预制书处理启动' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 查询任务状态
 * GET /api/legado/prefetch/status/:taskId
 * 支持两种查询方式：
 * 1. 通过 taskId 查询（向后兼容）
 * 2. 通过 query 参数 bookId 和 chapterId 查询实际处理状态
 */
legadoRouter.get('/legado/prefetch/status/:taskId', async (req, res) => {
  const { taskId } = req.params
  const { bookId, chapterId } = req.query

  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    // 优先从任务管理器查询（这样可以获取到 cancelled、paused 等实时状态）
    const task = prefetchService.getTaskStatus(taskId)

    if (task) {
      // 如果任务存在，返回任务状态
      // 对于 completed、failed、cancelled 状态，直接返回
      // 对于 processing、paused 状态，也返回任务状态
      
      // 判断是否是批量任务（有 chapters 数组）
      const isBatchTask = task.chapters && Array.isArray(task.chapters) && task.chapters.length > 0
      
      let progress
      if (isBatchTask) {
        // 批量任务：计算已完成的章节数
        const completedChapters = task.chapters.filter(c => c.status === 'completed').length
        const failedChapters = task.chapters.filter(c => c.status === 'failed').length
        progress = {
          completed: completedChapters,
          total: task.chapters.length,
          failed: failedChapters
        }
      } else {
        // 单章节任务：使用原有进度逻辑
        progress = {
          completed: task.progress.current || 0,
          total: task.progress.total || 0,
          failed: task.progress.failed?.length || 0
        }
      }
      
      return res.json({
        success: true,
        data: {
          taskId: task.taskId,
          status: task.status,
          progress: progress,
          currentSegment: task.progress.current,
          chapters: isBatchTask ? task.chapters.map(c => ({
            chapterId: c.chapterId,
            chapterTitle: c.chapterTitle,
            status: c.status,
            completedSegments: c.completedSegments,
            totalSegments: c.totalSegments
          })) : null,
          startTime: task.createdAt,
          estimatedTimeRemaining: null
        }
      })
    }

    // 任务不存在时，如果提供了 bookId 和 chapterId，从索引文件查询
    if (bookId && chapterId) {
      const index = await prefetchService.loadChapterIndex(bookId, chapterId)
      if (index) {
        return res.json({
          success: true,
          data: {
            taskId: taskId,
            status: index.metadata.status,
            progress: {
              total: index.metadata.totalSegments,
              completed: index.metadata.completedSegments,
              failed: index.metadata.totalSegments - index.metadata.completedSegments
            },
            currentSegment: index.metadata.completedSegments,
            startTime: index.metadata.createdAt,
            estimatedTimeRemaining: null
          }
        })
      }
    }

    // 任务不存在且没有索引
    return res.status(404).json(apiResponse.error('任务不存在', 404))
  } catch (error) {
    logError(error, { stage: '查询任务状态', taskId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 暂停任务
 * POST /api/legado/prefetch/pause/:taskId
 */
legadoRouter.post('/legado/prefetch/pause/:taskId', async (req, res) => {
  const { taskId } = req.params

  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    await prefetchService.pauseTask(taskId)
    
    res.json({
      success: true,
      message: '任务已暂停'
    })
  } catch (error) {
    logError(error, { stage: '暂停任务', taskId })
    
    if (error.message.includes('不存在')) {
      return res.status(404).json(apiResponse.error(error.message, 404))
    }
    
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 恢复任务
 * POST /api/legado/prefetch/resume/:taskId
 */
legadoRouter.post('/legado/prefetch/resume/:taskId', async (req, res) => {
  const { taskId } = req.params

  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    await prefetchService.resumeTask(taskId)
    
    res.json({
      success: true,
      message: '任务已恢复'
    })
  } catch (error) {
    logError(error, { stage: '恢复任务', taskId })
    
    if (error.message.includes('不存在')) {
      return res.status(404).json(apiResponse.error(error.message, 404))
    }
    
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 取消任务
 * POST /api/legado/prefetch/cancel/:taskId
 * 只停止当前处理，不删除任务记录和已预制内容
 */
legadoRouter.post('/legado/prefetch/cancel/:taskId', async (req, res) => {
  const { taskId } = req.params

  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    // 传入 false 表示不删除任务记录，保留已预制内容
    const result = await prefetchService.cancelTask(taskId, false)

    if (result.alreadyFinished) {
      return res.json({
        success: true,
        message: `任务已经${result.status === 'completed' ? '完成' : result.status === 'failed' ? '失败' : '部分完成'}`,
        data: { alreadyFinished: true, status: result.status }
      })
    }

    res.json({
      success: true,
      message: '任务已停止，已预制内容已保留'
    })
  } catch (error) {
    logError(error, { stage: '取消任务', taskId })

    if (error.message.includes('不存在')) {
      return res.status(404).json(apiResponse.error(error.message, 404))
    }

    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 删除任务相关文件
 * DELETE /api/legado/prefetch/files/:taskId
 */
legadoRouter.delete('/legado/prefetch/files/:taskId', async (req, res) => {
  const { taskId } = req.params

  try {
    // 解析任务ID，提取bookId和chapterId
    // 任务ID格式：${bookId}_${chapterId}
    const [bookId, chapterId] = taskId.split('_')
    
    if (!bookId || !chapterId) {
      return res.status(400).json(apiResponse.error('无效的任务ID格式', 400))
    }
    
    // 清理书籍目录下的章节文件夹，使用安全的目录名
    const safeBookId = getSafeDirName(bookId)
    const chapterDir = getDataPath('prefetch', 'books', safeBookId, 'chapters', chapterId)
    if (await fsExtra.pathExists(chapterDir)) {
      await fsExtra.remove(chapterDir)
      log('info', '已清理章节文件夹', { chapterDir })
    }

    // 清理任务文件
    const taskDir = getDataPath('prefetch', 'tasks')
    const taskFile = path.join(taskDir, `${taskId}.json`)
    if (await fsExtra.pathExists(taskFile)) {
      await fsExtra.remove(taskFile)
      log('info', '已清理任务文件', { taskFile })
    }
    
    res.json({
      success: true,
      message: '任务文件已清理'
    })
  } catch (error) {
    logError(error, { stage: '清理任务文件', taskId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 重试失败的任务
 * POST /api/legado/prefetch/retry/:taskId
 */
legadoRouter.post('/legado/prefetch/retry/:taskId', async (req, res) => {
  const { taskId } = req.params
  const { chapterId } = req.body

  try {
    log('info', '重试任务请求', { taskId, chapterId })
    const result = await prefetchService.retryTask(taskId, chapterId || null)
    
    res.json({
      success: true,
      data: { retried: result },
      message: result ? '任务重试已启动' : '没有需要重试的任务'
    })
  } catch (error) {
    logError(error, { stage: '重试任务', taskId, chapterId })
    
    if (error.message.includes('不存在')) {
      return res.status(404).json(apiResponse.error(error.message, 404))
    }
    
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 获取所有任务列表
 * GET /api/legado/prefetch/tasks
 */
legadoRouter.get('/legado/prefetch/tasks', async (req, res) => {
  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    const tasks = await prefetchService.getAllTasks()

    res.json({
      success: true,
      data: tasks,
      message: '获取任务列表成功'
    })
  } catch (error) {
    logError(error, { stage: '获取任务列表' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 删除任务
 * DELETE /api/legado/prefetch/tasks/:taskId
 */
legadoRouter.delete('/legado/prefetch/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params

  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    const success = await prefetchService.deleteTask(taskId)

    if (success) {
      res.json({
        success: true,
        message: '任务已删除'
      })
    } else {
      res.status(404).json({
        success: false,
        message: '任务不存在或删除失败'
      })
    }
  } catch (error) {
    logError(error, { stage: '删除任务', taskId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 清空所有任务（只删除任务记录，保留已预制内容）
 * DELETE /api/legado/prefetch/tasks
 */
legadoRouter.delete('/legado/prefetch/tasks', async (req, res) => {
  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    const clearedCount = await prefetchService.clearAllTasks()
    log('info', '已清空所有预制任务', { count: clearedCount })

    res.json({
      success: true,
      data: { clearedCount },
      message: `已清空 ${clearedCount} 个任务`
    })
  } catch (error) {
    logError(error, { stage: '清空所有任务' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 删除书籍的所有任务（可选保留缓存）
 * DELETE /api/legado/prefetch/book/:bookId?keepCache=true
 */
legadoRouter.delete('/legado/prefetch/book/:bookId', async (req, res) => {
  const { bookId } = req.params
  const { keepCache } = req.query

  try {
    // 确保服务已初始化
    if (!prefetchService.initialized) {
      await prefetchService.initialize()
    }

    let deletedTaskCount = 0
    let cacheDeleted = false

    // 1. 删除该书籍的所有任务
    try {
      deletedTaskCount = await prefetchService.deleteTasksByBookId(bookId)
    } catch (e) {
      log('warn', '删除书籍任务失败', { bookId, error: e.message })
    }

    // 2. 如果不保留缓存，则删除预制缓存目录
    if (keepCache !== 'true') {
      try {
        const prefetchBooksDir = getDataPath('prefetch', 'books')
        // 使用安全的目录名（短哈希）
        const safeBookId = getSafeDirName(bookId)
        const bookDir = path.join(prefetchBooksDir, safeBookId)
        if (await fsExtra.pathExists(bookDir)) {
          await fsExtra.remove(bookDir)
          cacheDeleted = true
          log('info', '已删除书籍预制缓存目录', { bookId, safeBookId })
        }
      } catch (e) {
        log('warn', '删除书籍预制缓存目录失败', { bookId, error: e.message })
      }
    } else {
      log('info', '保留书籍预制缓存', { bookId })
    }

    res.json({
      success: true,
      data: {
        deletedTaskCount,
        cacheDeleted: keepCache === 'true' ? false : cacheDeleted
      },
      message: `已删除《${bookId}》的${deletedTaskCount}个任务${keepCache === 'true' ? '（保留缓存）' : ''}`
    })
  } catch (error) {
    logError(error, { stage: '删除书籍预制数据', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 已预制内容 - 删除单本书的已预制内容（只删除音频文件，保留任务记录）
 * DELETE /api/legado/prefetched-content/:bookId
 */
legadoRouter.delete('/legado/prefetched-content/:bookId', async (req, res) => {
  const { bookId } = req.params

  try {
    let cacheDeleted = false

    // 只删除预制缓存目录（音频文件），不删除任务记录
    try {
      const prefetchBooksDir = getDataPath('prefetch', 'books')
      // 使用安全的目录名（短哈希）
      const safeBookId = getSafeDirName(bookId)
      const bookDir = path.join(prefetchBooksDir, safeBookId)
      if (await fsExtra.pathExists(bookDir)) {
        await fsExtra.remove(bookDir)
        cacheDeleted = true
        log('info', '已删除书籍已预制内容（保留任务记录）', { bookId, safeBookId })
      }
    } catch (e) {
      log('warn', '删除书籍已预制内容失败', { bookId, error: e.message })
    }

    res.json({
      success: true,
      data: {
        cacheDeleted
      },
      message: cacheDeleted ? '已预制内容已删除（任务记录已保留）' : '未找到已预制内容'
    })
  } catch (error) {
    logError(error, { stage: '删除书籍已预制内容', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制书处理 - 查询缓存状态
 * GET /api/legado/prefetch/cache/:bookId/:chapterId
 */
legadoRouter.get('/legado/prefetch/cache/:bookId/:chapterId', async (req, res) => {
  const { bookId, chapterId } = req.params

  try {
    const cache = await prefetchService.loadChapterCache(bookId, chapterId)

    res.json({
      success: true,
      data: {
        exists: !!cache,
        index: cache || null
      }
    })
  } catch (error) {
    logError(error, { stage: '查询缓存状态', bookId, chapterId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 查询书籍所有章节的预制状态
 * POST /api/legado/prefetch/chapters-status/:bookId
 * @param {string} bookId - 书籍ID（从URL参数获取）
 * @param {Array<{index: number, url: string}>} chapters - 章节信息数组（从body获取）
 * @returns {Object} 各章节的预制状态 { chapterIndex: boolean }
 */
legadoRouter.post('/legado/prefetch/chapters-status/:bookId', async (req, res) => {
  const { bookId } = req.params
  const { chapters } = req.body

  if (!bookId) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookId', 400))
  }

  if (!Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json(apiResponse.error('缺少必需参数：chapters（章节信息数组）', 400))
  }

  try {
    log('info', '查询章节预制状态', { bookId, chapterCount: chapters.length })

    // 批量查询每个章节的预制状态
    const statusMap = {}

    for (const chapter of chapters) {
      // 从章节URL中提取路径部分作为chapterId
      // 存储时使用的是路径格式（如 /read/208941/69872402.html）
      let chapterId = String(chapter.index)
      if (chapter.url) {
        // 处理TXT书籍的章节URL格式：txt://bookId/chapterIndex
        if (chapter.url.startsWith('txt://')) {
          chapterId = `txt_chapter_${chapter.index}`
        } else {
          try {
            const urlObj = new URL(chapter.url)
            chapterId = urlObj.pathname // 提取路径部分，如 /read/208941/69872402.html
          } catch (e) {
            // 如果URL解析失败，直接使用原始url
            chapterId = chapter.url
          }
        }
      }

      const index = await prefetchService.loadChapterIndex(bookId, chapterId)
      // 只有当索引存在且状态为completed时才认为是完成的
      statusMap[chapter.index] = !!(index && index.metadata && index.metadata.status === 'completed')
    }

    const completedCount = Object.values(statusMap).filter(v => v).length
    log('info', '章节预制状态查询完成', { bookId, total: chapters.length, completed: completedCount })

    res.json({
      success: true,
      data: {
        bookId,
        chapterStatus: statusMap,
        completedCount,
        totalCount: chapters.length
      },
      message: `查询完成，${completedCount}/${chapters.length} 个章节已完成预制`
    })
  } catch (error) {
    logError(error, { stage: '查询章节预制状态', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 删除章节预制音频
 * DELETE /api/legado/prefetch/chapter/:bookId/:chapterId
 * @param {string} bookId - 书籍ID（从URL参数获取）
 * @param {string} chapterId - 章节ID（从URL参数获取）
 * @returns {Object} 删除结果
 */
legadoRouter.delete('/legado/prefetch/chapter/:bookId/:chapterId', async (req, res) => {
  const { bookId, chapterId } = req.params

  if (!bookId || !chapterId) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookId 或 chapterId', 400))
  }

  try {
    log('info', '删除章节预制音频', { bookId, chapterId })

    // 构建章节目录路径，使用安全的目录名（短哈希）
    const safeBookId = getSafeDirName(bookId)
    const safeChapterId = getSafeDirName(chapterId)
    const chapterDir = path.join(prefetchService.baseDir, 'books', safeBookId, 'chapters', safeChapterId)

    // 检查目录是否存在
    try {
      await fsPromises.access(chapterDir)
    } catch (error) {
      return res.status(404).json(apiResponse.error('未找到该章节的预制音频', 404))
    }

    // 删除章节目录及其所有内容
    await fsPromises.rm(chapterDir, { recursive: true, force: true })

    log('info', '章节预制音频删除成功', { bookId, chapterId })

    res.json({
      success: true,
      data: { bookId, chapterId },
      message: '章节预制音频已删除'
    })
  } catch (error) {
    logError(error, { stage: '删除章节预制音频', bookId, chapterId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 预制音频播放端点
 * GET /api/legado/prefetch/audio
 * @param {string} text - 要播放的文本内容（必需）
 * @param {string} bookId - 书籍ID（可选）
 * @param {string} chapterId - 章节ID（可选）
 */
legadoRouter.get('/legado/prefetch/audio', async (req, res) => {
  const { text, bookId, chapterId } = req.query

  // 验证必需参数
  if (!text) {
    log('warn', '预制音频请求缺少text参数')
    return res.status(400).json({
      success: false,
      message: '缺少必需参数：text',
      error: '请提供要播放的文本内容'
    })
  }

  try {
    log('info', '查找预制音频', {
      textLength: text.length,
      bookId: bookId || 'all',
      chapterId: chapterId || 'all'
    })

    // 查找匹配的音频文件
    const result = await cacheQueryService.findAudioByText(text, bookId, chapterId)

    if (!result) {
      log('warn', '未找到预制音频', { textPreview: text.substring(0, 50) })
      return res.status(404).json({
        success: false,
        message: '未找到预制音频',
        error: '该文本内容没有对应的预制音频文件'
      })
    }

    // 验证音频文件是否存在
    if (!fs.existsSync(result.audioPath)) {
      log('error', '音频文件不存在', { audioPath: result.audioPath })
      return res.status(500).json({
        success: false,
        message: '音频文件不存在',
        error: '预制音频文件已损坏或被删除'
      })
    }

    // 获取文件信息
    const stats = fs.statSync(result.audioPath)
    
    log('info', '返回预制音频', {
      bookId: result.bookId,
      chapterId: result.chapterId,
      segmentId: result.segmentId,
      fileSize: stats.size
    })

    // 返回音频流
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', stats.size)
    res.sendFile(path.resolve(result.audioPath))
  } catch (error) {
    logError(error, { stage: '预制音频播放', textPreview: text.substring(0, 50) })
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
      error: error.message
    })
  }
})

/**
 * 书籍缓存进度存储（用于SSE推送）
 * key: bookUrl, value: { progress, timestamp, status }
 */
const bookCacheProgressMap = new Map()

/**
 * 清理过期的进度数据（5分钟前）
 */
function cleanExpiredProgress() {
  const now = Date.now()
  const expireTime = 5 * 60 * 1000 // 5分钟
  for (const [key, value] of bookCacheProgressMap.entries()) {
    if (now - value.timestamp > expireTime) {
      bookCacheProgressMap.delete(key)
    }
  }
}

/**
 * 更新缓存进度
 */
function updateCacheProgress(bookUrl, progress) {
  bookCacheProgressMap.set(bookUrl, {
    progress,
    timestamp: Date.now(),
    status: progress.status
  })
}

/**
 * 书籍缓存 - 开始缓存整本书
 * POST /api/legado/book-cache/start
 */
legadoRouter.post('/legado/book-cache/start', async (req, res) => {
  const { bookInfo, serverIp, serverPort } = req.body

  if (!bookInfo || !bookInfo.bookUrl || !bookInfo.name) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookInfo（包含bookUrl和name）', 400))
  }

  if (!serverIp || !serverPort) {
    return res.status(400).json(apiResponse.error('缺少必需参数：serverIp 和 serverPort', 400))
  }

  try {
    log('info', '开始缓存整本书', { bookName: bookInfo.name, serverIp, serverPort })

    // 清理过期进度
    cleanExpiredProgress()

    // TTS调用禁止并发，使用单线程处理
    const result = await bookCacheService.cacheBook(bookInfo, serverIp, serverPort, (progress) => {
      // 存储进度，供SSE查询
      updateCacheProgress(bookInfo.bookUrl, progress)
      log('debug', '缓存进度', progress)
    })

    // 标记为完成
    updateCacheProgress(bookInfo.bookUrl, {
      ...result,
      status: 'completed',
      percent: 100
    })

    const message = result.skippedChapters > 0
      ? `书籍缓存完成，跳过 ${result.skippedChapters} 个已缓存章节，新缓存 ${result.newCachedChapters}/${result.totalChapters} 个章节`
      : `书籍缓存完成，共缓存 ${result.cachedChapters}/${result.totalChapters} 个章节`

    res.json({
      success: true,
      data: result,
      message
    })
  } catch (error) {
    // 标记为错误
    updateCacheProgress(bookInfo.bookUrl, {
      status: 'error',
      error: error.message
    })
    logError(error, { stage: '缓存整本书', bookName: bookInfo.name })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 获取实时进度（SSE）
 * GET /api/legado/book-cache/progress
 */
legadoRouter.get('/legado/book-cache/progress', async (req, res) => {
  const { bookUrl } = req.query

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  // 设置SSE响应头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // 发送初始进度
  const initialData = bookCacheProgressMap.get(bookUrl)
  if (initialData) {
    res.write(`data: ${JSON.stringify(initialData.progress)}\n\n`)
  }

  // 定期检查进度变化
  let lastProgress = initialData?.progress
  const interval = setInterval(() => {
    const currentData = bookCacheProgressMap.get(bookUrl)
    if (currentData && currentData.progress !== lastProgress) {
      lastProgress = currentData.progress
      res.write(`data: ${JSON.stringify(currentData.progress)}\n\n`)

      // 如果完成或出错，关闭连接
      if (currentData.status === 'completed' || currentData.status === 'error') {
        clearInterval(interval)
        res.end()
      }
    }
  }, 500) // 每500ms检查一次

  // 客户端断开连接时清理
  req.on('close', () => {
    clearInterval(interval)
  })
})

/**
 * 书籍缓存 - 清除进度数据（开始新缓存前调用）
 * POST /api/legado/book-cache/clear-progress
 */
legadoRouter.post('/legado/book-cache/clear-progress', async (req, res) => {
  const { bookUrl } = req.body

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  try {
    // 清除该书籍的进度数据
    bookCacheProgressMap.delete(bookUrl)
    log('info', '已清除书籍缓存进度数据', { bookUrl })

    res.json({
      success: true,
      message: '进度数据已清除'
    })
  } catch (error) {
    logError(error, { stage: '清除缓存进度数据', bookUrl })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 取消缓存
 * POST /api/legado/book-cache/cancel
 */
legadoRouter.post('/legado/book-cache/cancel', async (req, res) => {
  const { bookUrl } = req.body

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  try {
    // 检查书籍是否正在缓存中
    const cacheInfo = bookCacheService.getBookCacheInfo(bookUrl)
    if (!cacheInfo || cacheInfo.status !== 'caching') {
      return res.json({
        success: true,
        data: {
          alreadyFinished: true,
          status: cacheInfo?.status || 'unknown'
        },
        message: '书籍不在缓存中，无需取消'
      })
    }

    // 设置取消标记
    bookCacheService.setCancelToken(bookUrl, true)

    log('info', '已设置书籍缓存取消标记', { bookUrl, bookName: cacheInfo.name })

    res.json({
      success: true,
      data: {
        alreadyFinished: false,
        status: 'cancelling'
      },
      message: '已发送取消请求，当前章节缓存完成后将停止'
    })
  } catch (error) {
    logError(error, { stage: '取消书籍缓存', bookUrl })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 获取缓存状态
 * GET /api/legado/book-cache/status/:bookUrl
 */
legadoRouter.get('/legado/book-cache/status', async (req, res) => {
  const { bookUrl } = req.query

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  try {
    const cacheInfo = bookCacheService.getBookCacheInfo(bookUrl)
    const isCached = bookCacheService.isBookCached(bookUrl)

    res.json({
      success: true,
      data: {
        isCached,
        cacheInfo: cacheInfo || null
      },
      message: isCached ? '书籍已缓存' : '书籍未缓存'
    })
  } catch (error) {
    logError(error, { stage: '获取缓存状态', bookUrl })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 获取所有缓存的书籍列表
 * GET /api/legado/book-cache/list
 */
legadoRouter.get('/legado/book-cache/list', async (req, res) => {
  try {
    const { source } = req.query
    const books = []

    // 1. 从 book-cache 索引获取（通过"缓存"按钮缓存的整本书）
    if (!source || source === 'cache') {
      const cachedBooks = await bookCacheService.getCachedBooks()
      log('info', `从book-cache获取到 ${cachedBooks.length} 本书`, { books: cachedBooks.map(b => ({ name: b.name, cachedChapters: b.cachedChapters, coverCached: b.coverCached })) })
      for (const book of cachedBooks) {
        if (book.cachedChapters > 0) {
          // 如果有本地缓存的封面，使用本地URL
          let coverUrl = book.coverUrl
          if (book.coverCached) {
            coverUrl = bookCacheService.getLocalCoverUrl(book.bookId)
            log('debug', `使用本地封面: ${book.name}`, { coverUrl })
          }

          books.push({
            bookId: book.bookId,
            bookUrl: book.bookUrl,
            name: book.name,
            totalChapters: book.totalChapters,
            cachedChapters: book.cachedChapters,
            coverUrl: coverUrl,
            coverCached: book.coverCached,
            chapterList: book.chapterList || [],
            cachedAt: book.cachedAt,
            source: 'cache'
          })
        }
      }
    }

    // 2. 从 prefetch 目录获取（通过"预制"处理的书籍）
    if (!source || source === 'prefetch') {
      const prefetchBooksDir = getDataPath('prefetch', 'books')
      try {
        const bookDirs = await fsPromises.readdir(prefetchBooksDir)
        for (const bookDirName of bookDirs) {
          const bookDir = path.join(prefetchBooksDir, bookDirName)
          const stat = await fsPromises.stat(bookDir)
          if (!stat.isDirectory()) continue

          const chaptersDir = path.join(bookDir, 'chapters')
          let chapterCount = 0
          let completedChapterCount = 0
          let bookName = bookDirName
          let chapterList = []
          let originalBookId = bookDirName // 保存原始bookId（从index.json中读取）
          let chapters = [] // 提升到外部作用域，供后续计算音频文件大小使用

          try {
            chapters = await fsPromises.readdir(chaptersDir)
            chapterCount = chapters.length

            // 尝试读取第一个章节获取书名和原始bookId
            // 章节目录可能是数字索引或哈希值，尝试读取任意一个章节
            const firstChapterDir = chapters[0]
            if (firstChapterDir) {
              const indexPath = path.join(chaptersDir, firstChapterDir, 'index.json')
              try {
                const indexContent = await fsPromises.readFile(indexPath, 'utf-8')
                const indexData = JSON.parse(indexContent)
                log('debug', '读取index.json', { bookDirName, bookName: indexData.bookName, bookId: indexData.bookId })
                // 修复：bookName可能是空字符串，需要额外检查
                bookName = (indexData.bookName && indexData.bookName.trim()) ? indexData.bookName.trim() : bookDirName
                // 从index.json中获取原始bookId（存储在bookId字段中）
                originalBookId = (indexData.bookId && indexData.bookId.trim()) ? indexData.bookId.trim() : bookDirName
              } catch (e) {
                // index.json 不存在或读取失败，使用目录名作为书名
                log('debug', '无法读取章节index.json', { bookDirName, firstChapterDir, error: e.message })
              }
            }

            // 获取所有章节列表，并统计已完成（metadata.status === 'completed'）的章节数
            let chapterIndexCounter = 0
            for (const chapterDir of chapters) {
              try {
                const indexPath = path.join(chaptersDir, chapterDir, 'index.json')
                const indexContent = await fsPromises.readFile(indexPath, 'utf-8')
                const indexData = JSON.parse(indexContent)
                // 使用index.json中的chapterIndex或按顺序分配
                const chapterIndex = indexData.chapterIndex !== undefined ? indexData.chapterIndex : chapterIndexCounter
                chapterList.push({
                  index: chapterIndex,
                  title: indexData.chapterTitle || `第${chapterIndex + 1}章`,
                  url: ''
                })
                // 检查该章节是否已完成（metadata.status === 'completed'）
                if (indexData.metadata && indexData.metadata.status === 'completed') {
                  completedChapterCount++
                }
              } catch (e) {
                // index.json 不存在，使用目录顺序作为章节索引
                chapterList.push({
                  index: chapterIndexCounter,
                  title: `第${chapterIndexCounter + 1}章`,
                  url: ''
                })
              }
              chapterIndexCounter++
            }
            chapterList.sort((a, b) => a.index - b.index)
          } catch (e) {
            log('warn', '读取章节列表失败', { bookDirName, error: e.message })
          }

          // 只显示有已完成章节的（有音频文件）
          if (completedChapterCount > 0) {
            // 如果书名看起来像短哈希（16位十六进制），说明没有正确获取到书名
            // 这种情况下显示为"未知书籍"
            const isHashLike = /^[a-f0-9]{16}$/i.test(bookName)
            const displayName = isHashLike ? '未知书籍' : bookName
            // 如果bookId是短哈希格式，说明没有正确获取到原始bookId
            // 这种情况下使用目录名作为标识
            const displayBookId = isHashLike ? bookDirName : originalBookId

            // 计算音频文件总大小
            let totalSize = 0
            try {
              for (const chapterDir of chapters) {
                const audioDir = path.join(chaptersDir, chapterDir, 'audio')
                try {
                  const audioFiles = await fsPromises.readdir(audioDir)
                  for (const audioFile of audioFiles) {
                    if (audioFile.endsWith('.mp3') || audioFile.endsWith('.aac') || audioFile.endsWith('.wav')) {
                      const audioPath = path.join(audioDir, audioFile)
                      const audioStat = await fsPromises.stat(audioPath)
                      totalSize += audioStat.size
                    }
                  }
                } catch (e) {
                  // 音频目录不存在或读取失败，跳过
                }
              }
            } catch (e) {
              log('debug', '计算音频文件大小失败', { bookDirName, error: e.message })
            }

            log('debug', '添加prefetch书籍到列表', { bookDirName, bookName, isHashLike, displayName, displayBookId, originalBookId, totalSize, completedChapterCount })

            books.push({
              bookUrl: displayBookId, // 使用原始bookId而不是短哈希目录名
              name: displayName,
              totalChapters: chapterCount,
              cachedChapters: completedChapterCount, // 使用实际完成的章节数
              chapterList: chapterList,
              cachedAt: stat.ctime.toISOString(),
              source: 'prefetch',
              totalSize: totalSize
            })
          }
        }
      } catch (e) {
        log('warn', 'prefetch书籍目录读取失败', { error: e.message })
      }
    }

    log('info', `API /book-cache/list 返回 ${books.length} 本书`, { books: books.map(b => ({ name: b.name, source: b.source })) })
    res.json({
      success: true,
      data: books,
      message: `获取到 ${books.length} 个书籍`
    })
  } catch (error) {
    logError(error, { stage: '获取缓存列表' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 获取本地缓存的封面图片
 * GET /api/legado/book-cache/cover/:bookId
 */
legadoRouter.get('/legado/book-cache/cover/:bookId', async (req, res) => {
  const { bookId } = req.params

  if (!bookId) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookId', 400))
  }

  try {
      const coverPath = bookCacheService.getCoverFilePath(bookId)

      // 检查文件是否存在
      try {
        await fsPromises.access(coverPath)
      } catch {
        return res.status(404).json(apiResponse.error('封面不存在', 404))
      }

      // 读取并返回封面图片
      const imageBuffer = await fsPromises.readFile(coverPath)
    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400') // 缓存1天
    res.send(imageBuffer)
  } catch (error) {
    logError(error, { stage: '获取本地封面', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 获取缓存的章节列表
 * GET /api/legado/book-cache/chapters
 */
legadoRouter.get('/legado/book-cache/chapters', async (req, res) => {
  const { bookUrl, source } = req.query

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  try {
    const chapters = []
    // 将bookUrl转换为安全的目录名（使用MD5哈希避免文件名过长）
    const bookId = getSafeDirName(bookUrl)
    // 兼容性：生成旧的目录名格式（完整URL清理后）
    const oldBookId = String(bookUrl)
      .replace(/[<>:"|?*\\/]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 50)

    // 1. 从 book-cache 目录读取（通过"缓存"按钮缓存的整本书）
    if (!source || source === 'cache') {
      // 尝试新的短哈希目录名
      let bookCacheDir = getDataPath('book-cache', 'books', bookId)
      let usingOldFormat = false

      try {
        await fsPromises.access(bookCacheDir)
      } catch (e) {
        // 新格式不存在，尝试旧格式
        if (oldBookId !== bookId) {
          const oldBookCacheDir = getDataPath('book-cache', 'books', oldBookId)
          try {
            await fsPromises.access(oldBookCacheDir)
            bookCacheDir = oldBookCacheDir
            usingOldFormat = true
            log('info', '使用旧格式目录名找到缓存', { bookUrl, oldBookId })
          } catch (oldError) {
            // 旧格式也不存在
          }
        }
      }

      try {
        const chapterFiles = await fsPromises.readdir(bookCacheDir)
        for (const file of chapterFiles) {
          if (file.startsWith('chapter_') && file.endsWith('.json')) {
            const chapterIndex = parseInt(file.replace('chapter_', '').replace('.json', ''))
            if (!isNaN(chapterIndex)) {
              try {
                const chapterPath = path.join(bookCacheDir, file)
                const chapterContent = await fsPromises.readFile(chapterPath, 'utf-8')
                const chapterData = JSON.parse(chapterContent)
                chapters.push({
                  index: chapterIndex,
                  title: chapterData.title || `第${chapterIndex + 1}章`,
                  url: chapterData.url || ''
                })
              } catch (e) {
                chapters.push({
                  index: chapterIndex,
                  title: `第${chapterIndex + 1}章`,
                  url: ''
                })
              }
            }
          }
        }
        if (usingOldFormat && chapters.length > 0) {
          log('info', '从旧格式目录成功读取章节', { bookUrl, chapterCount: chapters.length })
        }
      } catch (e) {
        // book-cache 目录不存在或读取失败
        log('debug', 'book-cache 目录读取失败', { bookUrl, error: e.message })
      }
    }

    // 2. 从 prefetch 目录读取（通过"预制"处理的书籍）
    if ((!source || source === 'prefetch') && chapters.length === 0) {
      const prefetchBookDir = getDataPath('prefetch', 'books', bookId)
      const chaptersDir = path.join(prefetchBookDir, 'chapters')
      try {
        const chapterDirs = await fsPromises.readdir(chaptersDir)
        for (const chapterDir of chapterDirs) {
          const chapterIndex = parseInt(chapterDir)
          if (!isNaN(chapterIndex)) {
            try {
              const indexPath = path.join(chaptersDir, chapterDir, 'index.json')
              const indexContent = await fsPromises.readFile(indexPath, 'utf-8')
              const indexData = JSON.parse(indexContent)
              chapters.push({
                index: chapterIndex,
                title: indexData.chapterTitle || `第${chapterIndex + 1}章`,
                url: ''
              })
            } catch (e) {
              chapters.push({
                index: chapterIndex,
                title: `第${chapterIndex + 1}章`,
                url: ''
              })
            }
          }
        }
      } catch (e) {
        // prefetch 目录不存在或读取失败
        log('debug', 'prefetch 目录读取失败', { bookUrl, error: e.message })
      }
    }

    // 按索引排序
    chapters.sort((a, b) => a.index - b.index)

    res.json({
      success: true,
      data: chapters,
      message: `获取到 ${chapters.length} 个章节`
    })
  } catch (error) {
    logError(error, { stage: '获取缓存章节列表', bookUrl })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 删除书籍缓存
 * DELETE /api/legado/book-cache/:bookUrl
 */
legadoRouter.delete('/legado/book-cache/delete', async (req, res) => {
  const { bookUrl } = req.query

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  try {
    // 1. 删除 book-cache 中的缓存
    const deletedFromCache = await bookCacheService.deleteBookCache(bookUrl)
    log('info', '删除book-cache结果', { bookUrl, deletedFromCache })

    // 2. 删除 prefetch 中的数据
    let deletedFromPrefetch = false
    try {
      // 将bookUrl转换为安全的目录名（使用MD5哈希避免文件名过长）
      let bookId = getSafeDirName(bookUrl)

      // 如果bookUrl是txt://格式，提取原始bookId
      if (bookUrl && bookUrl.startsWith('txt://')) {
        const originalId = bookUrl.replace('txt://', '')
        // 如果原始ID是16位哈希格式，直接使用
        if (/^[a-f0-9]{16}$/i.test(originalId)) {
          bookId = originalId.toLowerCase()
        }
      }

      const prefetchBookDir = getDataPath('prefetch', 'books', bookId)
      log('info', '准备删除prefetch目录', { bookUrl, bookId, prefetchBookDir })
      await fsExtra.remove(prefetchBookDir)
      deletedFromPrefetch = true
      log('info', '已删除prefetch书籍数据', { bookUrl, bookId })
    } catch (e) {
      log('warn', '删除prefetch书籍数据失败或不存在', { bookUrl, error: e.message })
    }

    if (deletedFromCache || deletedFromPrefetch) {
      res.json({
        success: true,
        message: '书籍缓存已删除'
      })
    } else {
      res.status(404).json(apiResponse.error('书籍缓存不存在或删除失败', 404))
    }
  } catch (error) {
    logError(error, { stage: '删除书籍缓存', bookUrl })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 生成书籍ID
 * GET /api/legado/book-id/generate
 * @param {string} bookUrl - 书籍URL
 * @returns {string} 生成的bookId（16位MD5短哈希）
 */
legadoRouter.get('/legado/book-id/generate', (req, res) => {
  const { bookUrl } = req.query

  if (!bookUrl) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl', 400))
  }

  try {
    const bookId = getSafeDirName(bookUrl)
    res.json({
      success: true,
      data: { bookId, bookUrl },
      message: '生成成功'
    })
  } catch (error) {
    logError(error, { stage: '生成书籍ID', bookUrl })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 清空所有缓存
 * DELETE /api/legado/book-cache/clear
 * @param {string} type - 清理类型：'cache'(仅缓存), 'prefetch'(仅预制), 'all'(全部)，默认'all'
 */
legadoRouter.delete('/legado/book-cache/clear', async (req, res) => {
  const { type = 'all' } = req.query

  try {
    let cacheDeletedCount = 0
    let prefetchDeletedCount = 0

    // 根据类型清理
    if (type === 'cache' || type === 'all') {
      // 清空 book-cache
      const stats = await bookCacheService.clearAllCache()
      cacheDeletedCount = stats.deletedCount
    }

    if (type === 'prefetch' || type === 'all') {
      // 1. 先清空 prefetchService 内存中的任务
      try {
        const clearedTaskCount = await prefetchService.clearAllTasks()
        log('info', '已清空prefetchService中的任务', { count: clearedTaskCount })
      } catch (e) {
        log('warn', '清空prefetchService任务失败', { error: e.message })
      }

      // 2. 清空 prefetch/books 目录
      try {
        const prefetchBooksDir = getDataPath('prefetch', 'books')
        log('debug', '准备清空prefetch书籍目录', { dir: prefetchBooksDir })

        // 确保目录存在
        await fsExtra.ensureDir(prefetchBooksDir)

        const bookDirs = await fsExtra.readdir(prefetchBooksDir)
        log('debug', '读取到书籍目录', { count: bookDirs.length, dirs: bookDirs })

        for (const bookDir of bookDirs) {
          try {
            const bookPath = path.join(prefetchBooksDir, bookDir)
            const stat = await fsExtra.stat(bookPath)
            if (stat.isDirectory()) {
              await fsExtra.remove(bookPath)
              prefetchDeletedCount++
              log('debug', '已删除书籍目录', { bookDir })
            }
          } catch (e) {
            log('warn', '删除单个书籍目录失败', { bookDir, error: e.message })
          }
        }
        log('info', `已清空prefetch书籍数据`, { count: prefetchDeletedCount })
      } catch (e) {
        log('warn', '清空prefetch书籍数据失败', { error: e.message })
      }

      // 3. 清空 prefetch/tasks 目录中的任务文件（作为备份清理）
      try {
        const prefetchTasksDir = getDataPath('prefetch', 'tasks')
        log('debug', '准备清空prefetch任务目录', { dir: prefetchTasksDir })

        // 确保目录存在
        await fsExtra.ensureDir(prefetchTasksDir)

        const taskFiles = await fsExtra.readdir(prefetchTasksDir)
        log('debug', '读取到任务文件', { count: taskFiles.length, files: taskFiles })
        let taskDeletedCount = 0

        for (const taskFile of taskFiles) {
          try {
            if (taskFile.endsWith('.json')) {
              const taskPath = path.join(prefetchTasksDir, taskFile)
              await fsExtra.remove(taskPath)
              taskDeletedCount++
              log('debug', '已删除任务文件', { taskFile })
            }
          } catch (e) {
            log('warn', '删除单个任务文件失败', { taskFile, error: e.message })
          }
        }
        log('info', `已清空prefetch任务数据`, { count: taskDeletedCount })
      } catch (e) {
        log('warn', '清空prefetch任务数据失败', { error: e.message })
      }
    }

    // 根据类型返回不同的消息
    let message
    if (type === 'cache') {
      message = `已清空 ${cacheDeletedCount} 本书籍的缓存`
    } else if (type === 'prefetch') {
      message = `已清空 ${prefetchDeletedCount} 本书籍的预制数据`
    } else {
      message = `已清空 ${cacheDeletedCount + prefetchDeletedCount} 本书籍的缓存和预制数据`
    }

    res.json({
      success: true,
      data: {
        cacheDeletedCount,
        prefetchDeletedCount,
        totalDeletedCount: cacheDeletedCount + prefetchDeletedCount
      },
      message
    })
  } catch (error) {
    logError(error, { stage: '清空所有缓存', type })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 已预制内容 - 清空所有已预制内容（只删除音频文件，保留任务记录）
 * DELETE /api/legado/prefetched-content/clear
 */
legadoRouter.delete('/legado/prefetched-content/clear', async (req, res) => {
  try {
    let deletedCount = 0

    // 只清空 prefetch/books 目录（音频文件），保留 prefetch/tasks 目录（任务记录）
    try {
      const prefetchBooksDir = getDataPath('prefetch', 'books')
      log('debug', '准备清空prefetch书籍目录（保留任务记录）', { dir: prefetchBooksDir })

      // 确保目录存在
      await fsExtra.ensureDir(prefetchBooksDir)

      const bookDirs = await fsExtra.readdir(prefetchBooksDir)
      log('debug', '读取到书籍目录', { count: bookDirs.length, dirs: bookDirs })

      for (const bookDir of bookDirs) {
        try {
          const bookPath = path.join(prefetchBooksDir, bookDir)
          const stat = await fsExtra.stat(bookPath)
          if (stat.isDirectory()) {
            await fsExtra.remove(bookPath)
            deletedCount++
            log('debug', '已删除书籍目录', { bookDir })
          }
        } catch (e) {
          log('warn', '删除单个书籍目录失败', { bookDir, error: e.message })
        }
      }
      log('info', `已清空prefetch书籍数据（保留任务记录）`, { count: deletedCount })
    } catch (e) {
      log('warn', '清空prefetch书籍数据失败', { error: e.message })
    }

    res.json({
      success: true,
      data: { deletedCount },
      message: `已清空 ${deletedCount} 本书籍的已预制内容（任务记录已保留）`
    })
  } catch (error) {
    logError(error, { stage: '清空已预制内容' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 获取缓存统计信息
 * GET /api/legado/book-cache/stats
 */
legadoRouter.get('/legado/book-cache/stats', async (req, res) => {
  try {
    const stats = await bookCacheService.getCacheStats()

    res.json({
      success: true,
      data: stats,
      message: '获取缓存统计信息成功'
    })
  } catch (error) {
    logError(error, { stage: '获取缓存统计' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 书籍缓存 - 从缓存获取章节内容
 * GET /api/legado/book-cache/chapter
 */
legadoRouter.get('/legado/book-cache/chapter', async (req, res) => {
  const { bookUrl, chapterIndex } = req.query

  if (!bookUrl || chapterIndex === undefined) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookUrl 和 chapterIndex', 400))
  }

  try {
    const chapterData = await bookCacheService.getCachedChapter(bookUrl, parseInt(chapterIndex))

    if (chapterData) {
      res.json({
        success: true,
        data: chapterData,
        message: '获取缓存章节成功'
      })
    } else {
      res.status(404).json(apiResponse.error('章节未缓存', 404))
    }
  } catch (error) {
    logError(error, { stage: '获取缓存章节', bookUrl, chapterIndex })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

// ==================== TXT文件预制书功能 ====================

/**
 * TXT文件预制书 - 上传并解析TXT文件
 * POST /api/legado/txt-prefab/upload
 */
legadoRouter.post('/legado/txt-prefab/upload', async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json(apiResponse.error('请上传TXT文件', 400))
    }

    let file = req.files.file
    
    // 修复中文文件名乱码：express-fileupload在Windows上把UTF-8文件名错误解码为Latin1
    if (file.name) {
      const latin1Buffer = Buffer.from(file.name, 'latin1')
      const fixedName = latin1Buffer.toString('utf-8')
      file = Object.assign({}, file, { name: fixedName })
    }
    
    const result = await txtPrefabService.uploadAndParse(file)

    res.json({
      success: true,
      data: result,
      message: `成功解析《${result.bookName}》，共${result.totalChapters}章`
    })
  } catch (error) {
    logError(error, { stage: '上传并解析TXT文件' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * TXT文件预制书 - 开始预制任务
 * POST /api/legado/txt-prefab/start
 */
legadoRouter.post('/legado/txt-prefab/start', async (req, res) => {
  const { bookId, chapterIndices, options } = req.body

  if (!bookId) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookId', 400))
  }

  if (!Array.isArray(chapterIndices) || chapterIndices.length === 0) {
    return res.status(400).json(apiResponse.error('缺少必需参数：chapterIndices（章节索引数组）', 400))
  }

  if (!options || !options.voiceId) {
    return res.status(400).json(apiResponse.error('缺少必需参数：options.voiceId', 400))
  }

  try {
    const result = await txtPrefabService.startPrefetch(bookId, chapterIndices, options)

    res.json({
      success: true,
      data: result,
      message: `TXT预制任务已启动，共${chapterIndices.length}个章节`
    })
  } catch (error) {
    logError(error, { stage: '启动TXT预制任务', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * TXT文件预制书 - 获取TTS配置
 * GET /api/legado/txt-prefab/tts-config
 */
legadoRouter.get('/legado/txt-prefab/tts-config', async (req, res) => {
  const { bookId } = req.query

  if (!bookId) {
    return res.status(400).json(apiResponse.error('缺少必需参数：bookId', 400))
  }

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    const config = await txtPrefabService.generateTtsConfig(bookId, baseUrl)

    res.json({
      success: true,
      data: config,
      message: '获取TTS配置成功'
    })
  } catch (error) {
    logError(error, { stage: '生成TXT预制书TTS配置', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * TXT文件预制书 - 获取已上传的书籍列表
 * GET /api/legado/txt-prefab/books
 */
legadoRouter.get('/legado/txt-prefab/books', async (req, res) => {
  try {
    const books = await txtPrefabService.getUploadedBooks()

    res.json({
      success: true,
      data: books,
      message: `获取到${books.length}本已上传的TXT书籍`
    })
  } catch (error) {
    logError(error, { stage: '获取TXT书籍列表' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * TXT文件预制书 - 获取书籍信息
 * GET /api/legado/txt-prefab/book/:bookId
 */
legadoRouter.get('/legado/txt-prefab/book/:bookId', async (req, res) => {
  const { bookId } = req.params

  try {
    const bookInfo = await txtPrefabService.getBookInfo(bookId)

    if (!bookInfo) {
      return res.status(404).json(apiResponse.error('找不到书籍信息', 404))
    }

    res.json({
      success: true,
      data: bookInfo,
      message: '获取书籍信息成功'
    })
  } catch (error) {
    logError(error, { stage: '获取TXT书籍信息', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * 阅读APP TTS接口 - TXT预制书专用端点
 * GET /api/reader/tts/stream-txt
 * @param {string} text - 要转换的文本（必需）
 * @param {string} bookId - TXT书籍ID（必需）
 */
legadoRouter.get('/reader/tts/stream-txt', async (req, res) => {
  const { text, bookId } = req.query

  // 记录请求参数
  log('debug', 'TXT预制书TTS流请求', { bookId, textLength: text?.length })

  // 预定义静音MP3
  const silentMp3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4Qvw1l8AAAAAAD/+xDEAAP8AFQCOEEBAYDBh/iAAABCJ3AXPwAAAmP/wgIhB4GAYCBgICAgICAgICAgICAgICAgICAgIA//sQxCkD/AAhP+YAAAlwAKn/4AAAH/wICAgICAgICAgICAgICAgICAgICAgICAgICAgICA', 'base64')

  // 验证参数
  if (!text) {
    log('warn', 'TXT预制书TTS请求缺少text参数')
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)
  }

  if (!bookId) {
    log('warn', 'TXT预制书TTS请求缺少bookId参数')
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)
  }

  try {
    // 查找预制音频
    const prefetchAudio = await txtPrefabService.findAudioByText(text, bookId)

    if (prefetchAudio) {
      // 验证音频文件是否存在
      if (fsSync.existsSync(prefetchAudio.audioPath)) {
        const stats = fsSync.statSync(prefetchAudio.audioPath)

        if (stats.size > 0) {
          log('info', 'TXT预制书：找到预制音频', {
            bookId,
            fileSize: stats.size
          })

          // 更新Cookie使用统计
          try {
            const cookieManager = (await import('../services/cookieManager.js')).default
            const activeCookie = cookieManager.getActiveCookie()
            if (activeCookie) {
              await cookieManager.updateCookieUsage(activeCookie.id, true)
            }
          } catch (statsError) {
            log('warn', 'TXT预制书：更新Cookie统计失败', { error: statsError.message })
          }

          res.set('Content-Type', 'audio/mpeg')
          res.set('Content-Length', stats.size)
          return res.sendFile(path.resolve(prefetchAudio.audioPath))
        }
      }
      log('warn', 'TXT预制书：预制音频文件不存在或无效', { audioPath: prefetchAudio.audioPath })
    }

    // 未找到音频，返回静音
    log('info', 'TXT预制书：未找到匹配的预制音频', { bookId, textPreview: text.slice(0, 50) })
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)

  } catch (error) {
    logError(error, { stage: 'TXT预制书TTS流生成', bookId })
    res.set('Content-Type', 'audio/mpeg')
    return res.send(silentMp3)
  }
})

/**
 * POST /api/legado/scheduled-prefetch/create
 * 创建定时预制任务
 */
legadoRouter.post('/legado/scheduled-prefetch/create', async (req, res) => {
  const { bookId, bookUrl, bookName, voiceId, speed, intervalMinutes, intervalHours, chaptersPerRun } = req.body

  log('info', '[定时预制API] 收到创建请求', { bookId, bookName, voiceId, intervalMinutes, intervalHours, chaptersPerRun })

  let finalIntervalHours = intervalHours
  if (intervalMinutes !== undefined && intervalMinutes !== null) {
    finalIntervalHours = intervalMinutes / 60
  }

  log('info', '[定时预制API] 计算后finalIntervalHours', { finalIntervalHours })

  if (!bookId || !voiceId || !finalIntervalHours) {
    log('warn', '[定时预制API] 参数校验失败', { bookId, voiceId, finalIntervalHours })
    return res.status(400).json(apiResponse.error('缺少必需参数：bookId、voiceId、intervalMinutes', 400))
  }

  if (finalIntervalHours < 1 / 60 || finalIntervalHours > 24) {
    log('warn', '[定时预制API] 间隔时间超出范围', { finalIntervalHours })
    return res.status(400).json(apiResponse.error('间隔时间必须在1分钟到24小时之间', 400))
  }

  try {
    log('info', '[定时预制API] 调用service.createTask', { bookId, finalIntervalHours })
    const task = await scheduledPrefetchService.createTask({
      bookId,
      bookUrl,
      bookName,
      voiceId,
      speed,
      intervalHours: finalIntervalHours,
      chaptersPerRun: chaptersPerRun || 9999
    })

    log('info', '[定时预制API] 创建成功', { taskId: task.taskId })
    res.json(apiResponse.success({
      taskId: task.taskId,
      nextRunAt: task.nextRunAt
    }))
  } catch (error) {
    logError(error, { stage: '[定时预制API] 创建定时预制任务' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * GET /api/legado/scheduled-prefetch/list
 * 获取定时预制任务列表
 */
legadoRouter.get('/legado/scheduled-prefetch/list', async (req, res) => {
  try {
    const tasks = await scheduledPrefetchService.getTasks()
    res.json(apiResponse.success(tasks))
  } catch (error) {
    logError(error, { stage: '获取定时预制任务列表' })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * POST /api/legado/scheduled-prefetch/:taskId/toggle
 * 启用/禁用定时任务
 */
legadoRouter.post('/legado/scheduled-prefetch/:taskId/toggle', async (req, res) => {
  const { taskId } = req.params
  const { enabled } = req.body

  if (typeof enabled !== 'boolean') {
    return res.status(400).json(apiResponse.error('enabled参数必须是布尔值', 400))
  }

  try {
    const task = await scheduledPrefetchService.toggleTask(taskId, enabled)
    res.json(apiResponse.success(task))
  } catch (error) {
    logError(error, { stage: '切换定时任务状态', taskId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * DELETE /api/legado/scheduled-prefetch/:taskId
 * 删除定时任务
 */
legadoRouter.delete('/legado/scheduled-prefetch/:taskId', async (req, res) => {
  const { taskId } = req.params

  try {
    await scheduledPrefetchService.deleteTask(taskId)
    res.json(apiResponse.success({ deleted: true }))
  } catch (error) {
    logError(error, { stage: '删除定时任务', taskId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * POST /api/legado/scheduled-prefetch/:taskId/update
 * 更新定时任务配置（间隔时间和章节数）
 */
legadoRouter.post('/legado/scheduled-prefetch/:taskId/update', async (req, res) => {
  const { taskId } = req.params
  const { intervalMinutes, chaptersPerRun } = req.body

  try {
    const task = await scheduledPrefetchService.updateTaskConfig(taskId, {
      intervalMinutes,
      chaptersPerRun
    })
    res.json(apiResponse.success({ task }))
  } catch (error) {
    logError(error, { stage: '更新定时任务配置', taskId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})

/**
 * GET /api/legado/scheduled-prefetch/progress/:bookId
 * 获取某书籍的预制进度
 */
legadoRouter.get('/legado/scheduled-prefetch/progress/:bookId', async (req, res) => {
  const { bookId } = req.params

  try {
    const progress = await scheduledPrefetchService.getProgress(bookId)
    if (!progress) {
      return res.status(404).json(apiResponse.error('未找到该书籍的进度记录', 404))
    }
    res.json(apiResponse.success(progress))
  } catch (error) {
    logError(error, { stage: '获取定时预制进度', bookId })
    res.status(500).json(apiResponse.error(error.message, 500))
  }
})