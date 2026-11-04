import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import WebSocket from 'ws'
import { log, logError } from '../utils/logger.js'
import { loadTtsConfig, buildWsUrl } from '../utils/ttsUtils.js'
import { getAudioPath } from '../utils/pathUtils.js'
import { setReadableWritable } from '../utils/filePermissionUtils.js'
import { voiceService } from './voiceService.js'
import cookieManager from './cookieManager.js'
import cookieSelector from './cookieSelector.js'
import { validateCookies } from './cookieValidator.js'
import { isUnReadableText, logUnreadableText } from '../utils/textFilter.js'
import { getCachedUserAgent, clearCachedUserAgent } from '../utils/userAgentUtils.js'
import { DoubaoWebSocketClient, MessageHandler } from './websocket/websocketClient.js'
import { AudioProcessor } from './audio/audioProcessor.js'
import { DelayController } from './delay/delayController.js'
import { deviceParamsManager } from './deviceParamsManager.js'

/**
 * TTS服务类
 * 重构后只负责协调各个模块，不包含具体实现细节
 */
class TtsService {
  constructor() {
    this.config = null

    // 子模块
    this.audioProcessor = new AudioProcessor()
    this.delayController = new DelayController({
      requestDelay: 10,
      requestIntervalDelay: 0
    })

    // 暂停检查回调
    this.pauseCheckCallback = null

    // Cookie轮询状态
    this.lastCookieIndex = -1
    this.needRoundDelay = false
  }

  /**
   * 设置暂停检查回调函数
   * @param {Function} callback - 返回true表示应该暂停/取消
   */
  setPauseCheckCallback(callback) {
    this.pauseCheckCallback = callback
  }

  /**
   * 如果完成了整轮Cookie轮询，应用整轮延迟
   * 修复：needRoundDelay 置位后此前从未被消费（applyRoundDelay 无调用点），
   * 导致"完成一轮Cookie轮询后等待"的延迟从未真正生效
   * @returns {Promise<void>}
   */
  async applyRoundDelayIfNeeded() {
    if (this.needRoundDelay) {
      this.needRoundDelay = false
      await this.delayController.applyRoundDelay()
    }
  }

  /**
   * 检查是否应该暂停
   * @returns {boolean} 是否应该暂停
   */
  shouldPause() {
    if (this.pauseCheckCallback) {
      return this.pauseCheckCallback()
    }
    return false
  }

  /**
   * 加载TTS配置
   * @returns {Object} 配置对象
   */
  loadConfig() {
    if (!this.config) {
      this.config = loadTtsConfig()

      // 更新延迟控制器配置
      this.delayController.updateConfig({
        requestDelay: this.config.requestDelay || 10,
        requestIntervalDelay: this.config.requestIntervalDelay || 0
      })
    }
    return this.config
  }

  /**
   * 重新加载TTS配置
   * 用于配置更新后刷新配置
   */
  reloadConfig() {
    clearCachedUserAgent()
    this.config = null
    this.delayController = new DelayController({
      requestDelay: 10,
      requestIntervalDelay: 0
    })
    return this.loadConfig()
  }

  /**
   * 生成语音
   * @param {Object} options - 生成选项
   * @param {string} options.text - 要转换的文本
   * @param {string} options.voiceId - 发音人ID
   * @param {number} [options.rate=0] - 语速 (-50到100)
   * @param {number} [options.pitch=0] - 音调 (-12到12)
   * @param {string} [options.source='tts'] - 音频来源 (tts: 语音合成, reader: 阅读TTS)
   * @param {string} [options.outputPath] - 自定义输出路径（可选，如果提供则直接生成到该路径）
   * @param {number} [options.requestDelay] - Cookie轮询完成后的延迟（秒），覆盖配置值
   * @param {number} [options.requestIntervalDelay] - 请求间隔延迟（秒），覆盖配置值
   * @returns {Promise<Object>} 生成结果 {filePath, url, duration, size}
   */
  async generateSpeech(options) {
    const { text, voiceId, rate = 0, pitch = 0, source = 'tts', outputPath, requestDelay: customRequestDelay, requestIntervalDelay } = options

    // 首先检查是否应该暂停
    if (this.shouldPause()) {
      log('info', '检测到暂停请求，取消语音生成')
      throw new Error('任务已暂停')
    }

    // 验证发音人ID
    const voice = voiceService.findVoiceById(voiceId)
    if (!voice) {
      throw new Error(`无效的发音人ID: ${voiceId}`)
    }

    // 检查文本是否包含可朗读内容
    if (isUnReadableText(text)) {
      logUnreadableText(text, 'ttsService.generateSpeech')
      log('info', '检测到无朗读内容的文本，直接返回静音音频', { text: text || '(空)' })
      return this.generateSilentAudio(voice.name, source, outputPath)
    }

    // 保存原始延迟配置
    const originalDelayController = this.delayController

    // 应用自定义延迟配置（如果提供）
    if (customRequestDelay !== undefined || requestIntervalDelay !== undefined) {
      this.delayController = new DelayController({
        requestDelay: customRequestDelay !== undefined ? customRequestDelay : 10,
        requestIntervalDelay: requestIntervalDelay !== undefined ? requestIntervalDelay : 0
      })
    }

    try {
      // 应用请求延迟机制
      await this.delayController.resumeDelay()
      await this.applyRoundDelayIfNeeded()
      await this.delayController.applyIntervalDelay()

      // 延迟后再次检查是否应该暂停
      if (this.shouldPause()) {
        log('info', '延迟等待后检测到暂停请求，取消语音生成')
        throw new Error('任务已暂停')
      }

      log('info', '开始生成语音', { voiceId, textLength: text.length, rate, pitch, source, outputPath, customRequestDelay, requestIntervalDelay })

      // 短文本直接处理
      const filePath = await this.generateWithRetry({
        text,
        speaker: voiceId,
        speech_rate: rate,
        pitch,
        source,
        outputPath,
        requestIntervalDelay
      }, 3)

      const stats = fs.statSync(filePath)
      const url = '/audio/' + path.basename(filePath)

      return {
        filePath,
        url,
        size: stats.size,
        voice: voice.name
      }
    } finally {
      // 恢复原始延迟配置
      this.delayController = originalDelayController
    }
  }

  /**
   * 生成静音音频文件
   * 用于空文本或纯省略号文本的情况
   * @param {string} voiceName - 发音人名称
   * @param {string} source - 音频来源
   * @param {string} [outputPath] - 自定义输出路径（可选）
   * @returns {Promise<Object>} 生成结果 {filePath, url, size, voice}
   */
  async generateSilentAudio(voiceName, source = 'tts', outputPath = null) {
    let outPath

    if (outputPath) {
      // 使用自定义输出路径
      outPath = outputPath
      // 确保目标目录存在
      const outputDir = path.dirname(outPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
    } else {
      // 使用默认音频目录
      const audioDir = getAudioPath()
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true })
      }

      const sourcePrefix = source === 'reader' ? 'reader_tts_' : 'tts_'
      const baseName = `${sourcePrefix}silent_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      outPath = path.join(audioDir, `${baseName}.mp3`)
    }

    // 使用FFmpeg生成静音音频（0.5秒的静音）
    await this.audioProcessor.generateSilentMp3(outPath, 0.5)

    const stats = fs.statSync(outPath)
    const url = '/audio/' + path.basename(outPath)

    // 设置文件权限
    setReadableWritable(outPath)

    log('info', '静音音频生成成功', { filePath: outPath, size: stats.size })

    return {
      filePath: outPath,
      url,
      size: stats.size,
      voice: voiceName
    }
  }

  /**
   * 带重试机制的语音生成
   * @param {Object} opts - TTS参数
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<string>} 生成的音频文件路径
   */
  async generateWithRetry(opts, maxRetries = 3) {
    let lastError = null
    let attemptCount = 0

    while (attemptCount < maxRetries) {
      try {
        attemptCount++
        log('info', `TTS转换尝试 ${attemptCount}/${maxRetries}`)

        const filePath = await this.generateOnce(opts)

        log('info', 'TTS转换成功', {
          attempt: attemptCount,
          filePath
        })

        return filePath
      } catch (error) {
        lastError = error
        logError(error, {
          stage: 'TTS转换',
          attempt: attemptCount,
          maxRetries
        })

        // 如果是BLOCK错误需要切换Cookie，立即重试不等待
        if (error.message === 'BLOCK_ERROR_SWITCH_COOKIE') {
          log('info', 'BLOCK错误，立即使用下一个Cookie重试', { attempt: attemptCount })
          // 应用请求延迟
          await this.delayController.applyIntervalDelay()
          continue
        }

        // 如果是登录已过期错误，也需要切换Cookie
        if (error.message === 'LOGIN_EXPIRED_ERROR') {
          log('info', '登录已过期错误，立即使用下一个Cookie重试', { attempt: attemptCount })
          // 应用请求延迟
          await this.delayController.applyIntervalDelay()
          continue
        }

        // 处理WebSocket握手超时错误
        if (error.message?.includes('Opening handshake has timed out') || 
            error.message?.includes('WebSocket连接超时')) {
          log('warn', 'WebSocket握手超时，可能是网络波动或服务器繁忙', { attempt: attemptCount })
          
          if (attemptCount < maxRetries) {
            // 握手超时后等待更长时间再重试
            const waitTime = attemptCount * 10000 // 10秒、20秒、30秒...
            log('info', `等待 ${waitTime / 1000} 秒后重试...`)
            await new Promise(resolve => setTimeout(resolve, waitTime))
            
            // 轮换设备参数（可能是设备参数被风控）
            if (attemptCount >= 2) {
              log('info', '尝试轮换请求参数')
              await this.rotateDeviceId()
            }
            
            continue
          }
        }

        if (attemptCount < maxRetries) {
          // 重试间隔从10秒起步，每次翻倍（10秒、20秒、40秒...）
          await this.delayController.applyRetryDelay({ retryCount: attemptCount - 1 })

          // Cookie轮换已在getCookieForRequest中完成
          // 重试时会自动获取下一个Cookie，无需在此处轮换
          log('info', '准备使用下一个Cookie重试')

          // 重试前应用请求延迟机制，遵守请求延迟规范
          log('info', '重试前应用请求延迟机制')
          await this.delayController.applyIntervalDelay()
        }
      }
    }

    throw new Error(`TTS转换失败，已重试${maxRetries}次: ${lastError?.message}`)
  }

  /**
   * 执行单次语音生成
   * @param {Object} opts - TTS参数
   * @param {string} [opts.outputPath] - 自定义输出路径（可选）
   * @returns {Promise<string>} 生成的音频文件路径
   */
  async generateOnce(opts) {
    const cfg = this.loadConfig()

    // 获取Cookie
    const cookie = await this.getCookieForRequest()
    const cookieHeader = cookie?.value || ''
    const cookieId = cookie?.id

    // 获取Cookie级互斥锁（防止实时与预制模式并发打同一Cookie）
    const releaseLock = await cookieManager.acquireCookieLock(cookieId)

    try {
      // 获取设备参数
      const deviceParams = cookieId ? await deviceParamsManager.getOrCreateParams(cookieId) : null

      // 构建URL时传入cookieId和设备参数
      const url = await buildWsUrl({ ...opts, cookieId, deviceParams }, cfg)

      // 确定输出路径
      const { outPath, tmpAacPath } = this.prepareOutputPaths(opts)

      // 确保输出目录存在
      const outputDir = path.dirname(tmpAacPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      const fileStream = fs.createWriteStream(tmpAacPath)

      // 创建消息处理器
      const messageHandler = new MessageHandler()
      let resolvePromise, rejectPromise

      const completionPromise = new Promise((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })

      messageHandler.onFinish = () => {
        log('info', 'TTS转换完成')
        resolvePromise()
      }

      messageHandler.onError = (error) => {
        if (error.type === 'API_ERROR') {
          // await handleApiError：使其内部的 BLOCK_ERROR_SWITCH_COOKIE / 全部Cookie失效
          // 能真实传递到重试层（未await时错误被吞掉，重试永远走通用退避）
          this.handleApiError(error, cookie)
            .then(() => rejectPromise(new Error(error.message)))
            .catch((switchError) => rejectPromise(switchError))
          return
        }
        rejectPromise(new Error(error.message))
      }

      // 创建WebSocket客户端
      const wsClient = new DoubaoWebSocketClient({
        url,
        headers: {
          Origin: 'https://www.doubao.com',
          'Accept-Language': 'zh,zh-CN;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': getCachedUserAgent(),
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        messageHandler,
        outputHandler: fileStream,
        cookieManager
      })

      // 发送请求（带超时）
      await wsClient.sendRequest(opts.text, 30000)

      // 等待完成（带整体超时保护）
      const overallTimeout = 60000 // 60秒整体超时
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TTS生成整体超时')), overallTimeout)
      })

      try {
        await Promise.race([completionPromise, timeoutPromise])
      } catch (error) {
        // 关闭连接
        wsClient.close()
        throw error
      }

      // 关闭连接
      wsClient.close()

      // 等待文件流完全关闭
      await new Promise((resolve) => {
        fileStream.end(() => {
          log('info', '文件流已关闭')
          resolve()
        })
      })

      // 额外等待文件系统完成写入
      await new Promise(resolve => setTimeout(resolve, 500))

      // 验证和转码
      await this.validateAndTranscode(tmpAacPath, outPath, cookie)

      // 更新Cookie使用统计
      if (cookie) {
        try {
          await cookieManager.updateCookieUsage(cookie.id, true)
        } catch (updateError) {
          logError(updateError, { stage: 'Cookie统计更新' })
        }
      }

      return outPath
    } finally {
      releaseLock()
    }
  }

  /**
   * 准备输出路径
   * @param {Object} opts - TTS参数
   * @returns {Object} { outPath, tmpAacPath }
   */
  prepareOutputPaths(opts) {
    let outPath, tmpAacPath, outputDir

    if (opts.outputPath) {
      // 使用自定义输出路径
      outPath = opts.outputPath
      outputDir = path.dirname(outPath)
      // 临时文件放在同一目录
      const baseName = path.basename(outPath, '.mp3')
      tmpAacPath = path.join(outputDir, `${baseName}.aac`)
    } else {
      // 使用默认音频目录
      outputDir = getAudioPath()
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
      const sourcePrefix = opts.source === 'reader' ? 'reader_tts_' : 'tts_'
      const baseName = `${sourcePrefix}${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      tmpAacPath = path.join(outputDir, `${baseName}.aac`)
      outPath = path.join(outputDir, `${baseName}.mp3`)
    }

    return { outPath, tmpAacPath }
  }

  /**
   * 验证和转码音频
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} cookie - Cookie对象
   * @returns {Promise<void>}
   */
  async validateAndTranscode(inputPath, outputPath, cookie) {
    // 验证文件存在性
    if (!fs.existsSync(inputPath)) {
      throw new Error('音频文件未生成')
    }

    const stats = fs.statSync(inputPath)
    log('info', '音频文件写入完成', {
      path: inputPath,
      size: stats.size,
      sizeKB: (stats.size / 1024).toFixed(2)
    })

    // 验证文件内容和大小
    const buffer = fs.readFileSync(inputPath)
    const validationResult = this.audioProcessor.validateAudio(buffer)

    if (!validationResult.isValid) {
      const error = validationResult.error

      // 清理无效文件
      try { fs.unlinkSync(inputPath) } catch {}

      // 标记Cookie失效（只有block错误或rate limited才标记）
      if (cookie && (error.type === 'RATE_LIMITED' || error.type === 'BLOCKED')) {
        try {
          await cookieManager.markCookieAsInvalid(cookie.id, error.message)
          log('info', 'Cookie已标记为无效', { cookieId: cookie.id, reason: error.message })
        } catch (updateError) {
          logError(updateError, { stage: 'Cookie状态更新' })
        }
      }

      throw new Error(error.message)
    }

    // 转码为MP3
    await this.audioProcessor.convertToMp3(inputPath, outputPath)
    log('info', '转码成功')

    // 验证转码结果
    if (fs.existsSync(outputPath)) {
      const finalStats = fs.statSync(outputPath)
      if (finalStats.size > 0) {
        try { fs.unlinkSync(inputPath) } catch {}
        setReadableWritable(outputPath)
        log('info', 'TTS音频文件保存成功', { filePath: outputPath, size: finalStats.size })
      } else {
        throw new Error('转码后文件为空')
      }
    } else {
      throw new Error('转码后文件不存在')
    }
  }

  /**
   * 处理API错误
   * @param {Object} error - 错误对象
   * @param {Object} cookie - Cookie对象
   */
  async handleApiError(error, cookie) {
    log('error', '豆包API返回错误响应', { errorData: error.eventData })

    // 检测到block错误、710022002错误码、或710012001(登录已过期)错误码时，处理Cookie失效逻辑
    const errorCode = error.eventData?.code || error.eventData?.error?.code
    const isBlockError = error.eventData?.message === 'block' || errorCode === 710022002
    const isLoginExpired = errorCode === 710012001

    if (isBlockError || isLoginExpired) {
      const errorType = isBlockError ? 'BLOCK' : '登录已过期'
      log('error', `检测到${errorType}错误，立即标记当前Cookie失效`, {
        cookieId: cookie?.id,
        errorCode,
        errorData: error.eventData
      })

      // 标记当前Cookie失效
      if (cookie) {
        const errorMessage = isBlockError ? `豆包API返回block错误: ${error.message}` : `豆包API返回登录已过期错误 (code: ${errorCode}): ${error.message}`
        await cookieManager.markCookieAsInvalid(cookie.id, errorMessage)
        log('info', 'Cookie已标记为无效', { cookieId: cookie.id, reason: errorMessage })
      }

      // 检查是否还有可用Cookie
      const activeCookie = cookieManager.getActiveCookie()
      if (activeCookie && activeCookie.id !== cookie?.id) {
        // 还有可用Cookie，使用下一个
        log('info', '切换到下一个可用Cookie', { newCookieId: activeCookie.id })
        throw new Error('BLOCK_ERROR_SWITCH_COOKIE')
      }

      // 没有可用Cookie了，轮换设备ID
      log('warn', 'Cookie池中无可用Cookie，更换请求参数', { cookieId: cookie?.id })
      await this.rotateDeviceId(cookie?.id)

      // 重新验证所有失效的Cookie
      await this.revalidateInvalidCookies()

      // 再次检查是否有可用Cookie
      const newActiveCookie = cookieManager.getActiveCookie()
      if (newActiveCookie) {
        log('info', '重新验证后找到可用Cookie', { cookieId: newActiveCookie.id })
        throw new Error('BLOCK_ERROR_SWITCH_COOKIE')
      }

      // 还是没有可用Cookie，暂停并抛出错误
      log('error', '所有Cookie均已失效，暂停服务', { cookieId: cookie?.id })
      this.pause('所有Cookie均已失效，请添加新的Cookie')
      throw new Error('所有Cookie均已失效，请添加新的Cookie')
    }
  }

  /**
   * 重新验证失效的Cookie
   */
  async revalidateInvalidCookies() {
    const allCookies = await cookieManager.getAllCookies()
    const invalidCookies = allCookies.filter(c => c.status?.isValid === false || c.status?.isDisabled === true)

    if (invalidCookies.length > 0) {
      log('info', '开始重新验证失效的Cookie', { count: invalidCookies.length })
      const validationResults = await validateCookies(
        invalidCookies.map(c => ({ id: c.id, value: c.value })),
        5000
      )

      // 更新验证结果
      for (const result of validationResults) {
        if (result.isValid) {
          await cookieManager.updateCookieStatus(result.cookieId, { isValid: true, isDisabled: false })
          log('info', 'Cookie重新验证通过', { cookieId: result.cookieId })
        }
      }
    }
  }

  /**
   * 轮换设备ID
   * 当Cookie返回BLOCK错误时，直接轮换设备参数
   * @param {string} [cookieId] - Cookie ID（可选，如果不提供则获取当前活跃Cookie）
   * @returns {Promise<Object|null>} 新的设备参数或null
   */
  async rotateDeviceId(cookieId) {
    try {
      // 如果没有提供cookieId，尝试获取当前活跃的Cookie
      if (!cookieId) {
        const activeCookie = cookieManager.getActiveCookie()
        if (activeCookie) {
          cookieId = activeCookie.id
          log('info', '使用当前活跃Cookie轮换设备参数', { cookieId })
        } else {
          log('warn', '没有可用的Cookie，无法轮换设备参数')
          return null
        }
      }

      // 获取轮换前的参数
      const beforeParams = await deviceParamsManager.getParams(cookieId)
      const beforeDeviceId = beforeParams?.deviceId
      
      // 轮换设备参数
      const newParams = await deviceParamsManager.rotateParams(cookieId)
      
      log('info', '设备参数已轮换', { 
        cookieId,
        oldDeviceId: beforeDeviceId,
        newDeviceId: newParams.deviceId
      })
      
      return newParams
    } catch (error) {
      logError(error, { stage: '轮换设备参数', cookieId })
      return null
    }
  }

  /**
   * 暂停服务
   * @param {string} reason - 暂停原因
   */
  pause(reason) {
    log('error', '服务暂停', { reason })
    // 可以在这里添加暂停逻辑，如设置标志位、通知外部等
  }

  /**
   * 获取用于请求的Cookie
   * 使用轮询策略选择Cookie，每个Cookie使用N次后才轮换
   * @returns {Promise<Object|null>} Cookie对象或null
   */
  async getCookieForRequest() {
    try {
      if (!cookieManager.initialized) {
        await cookieManager.initialize()
      }

      // 获取当前索引（轮换前）
      const config = cookieManager.getConfig()
      const previousIndex = config.rotation.currentIndex || 0

      // 获取有效Cookie数量（用于判断是否完成一轮轮询）
      const validCookies = cookieSelector.getValidCookies()
      const validCookieCount = validCookies.length

      let cookie = await cookieSelector.selectCookie('round-robin')

      if (!cookie) {
        log('warn', '没有可用的Cookie')
        return null
      }

      // 判断是否是第一次请求（在更新lastRequestTime之前判断）
      const isFirstRequest = this.delayController.lastRequestTime === 0

      // 更新最后请求时间
      this.delayController.updateLastRequestTime()

      // 检查当前Cookie是否有效，如果无效则轮换到下一个
      const rotated = await cookieSelector.checkAndRotateIfInvalid()

      // 如果发生了轮换，需要重新获取当前活跃的Cookie
      if (rotated) {
        log('info', '当前Cookie已失效，已自动轮换到下一个')
        const newCookie = cookieManager.getActiveCookie()
        if (newCookie) {
          cookie = newCookie
        }
      }

      // 获取轮换后的索引
      const newConfig = cookieManager.getConfig()
      const currentIndex = newConfig.rotation.currentIndex || 0

      // 判断是否需要在下次请求时应用延迟：
      // 场景1：多Cookie轮询完成一轮（从最后一个轮换到第一个）
      // 场景2：单Cookie模式下，使用次数达到限制
      const isMultiCookieRound = validCookieCount > 1 &&
                                 rotated &&
                                 previousIndex === validCookieCount - 1 &&
                                 currentIndex === 0 &&
                                 !isFirstRequest

      // 单Cookie模式：只有一个有效Cookie，且使用次数达到限制
      // 此时虽然没有发生轮换（因为没有其他Cookie），但仍然需要延迟
      const isSingleCookieLimit = validCookieCount === 1 &&
                                  rotated &&
                                  !isFirstRequest

      const needDelay = isMultiCookieRound || isSingleCookieLimit

      log('debug', '延迟判断详情', {
        validCookieCount,
        previousIndex,
        currentIndex,
        rotated,
        isFirstRequest,
        isMultiCookieRound,
        isSingleCookieLimit,
        needDelay
      })

      if (needDelay) {
        // 设置延迟标志，下次调用applyRequestDelay时会执行延迟
        this.needRoundDelay = true
        if (isMultiCookieRound) {
          log('info', '检测到完成一轮Cookie轮询，将在下次请求时应用延迟', {
            validCookieCount,
            previousIndex,
            currentIndex
          })
        } else if (isSingleCookieLimit) {
          log('info', '单Cookie模式：当前Cookie已失效，将在下次请求时应用延迟', {
            validCookieCount
          })
        }
      }

      // 更新上一次请求的Cookie索引
      this.lastCookieIndex = currentIndex

      log('info', '获取Cookie成功', {
        id: cookie.id,
        name: cookie.name,
        previousIndex,
        currentIndex,
        rotated,
        needDelay,
        needRoundDelay: this.needRoundDelay
      })

      return cookie
    } catch (error) {
      logError(error, { stage: '获取Cookie' })
      return null
    }
  }

  /**
   * 生成语音流（实时模式使用）
   * 直接返回MP3格式的音频Buffer，不保存到文件系统
   * @param {Object} options - 生成选项
   * @param {string} options.text - 要转换的文本
   * @param {string} options.voiceId - 发音人ID
   * @param {number} [options.rate=0] - 语速 (-50到100)
   * @param {number} [options.pitch=0] - 音调 (-12到12)
   * @param {number} [options.requestIntervalDelay] - 请求间隔延迟（秒），覆盖配置值
   * @param {number} [options.requestDelay] - Cookie轮询完成后的延迟（秒），覆盖配置值
   * @returns {Promise<Buffer>} MP3音频Buffer
   */
  async generateSpeechStream(options) {
    const { text, voiceId, rate = 0, pitch = 0, requestIntervalDelay, requestDelay: customRequestDelay } = options

    log('debug', 'generateSpeechStream接收到的参数', { requestIntervalDelay, customRequestDelay, options })

    // 首先检查是否应该暂停
    if (this.shouldPause()) {
      log('info', '检测到暂停请求，取消语音生成')
      throw new Error('任务已暂停')
    }

    // 验证发音人ID
    const voice = voiceService.findVoiceById(voiceId)
    if (!voice) {
      throw new Error(`无效的发音人ID: ${voiceId}`)
    }

    // 检查文本是否包含可朗读内容
    if (isUnReadableText(text)) {
      logUnreadableText(text, 'ttsService.generateSpeechStream')
      log('info', '检测到无朗读内容的文本，返回静音音频', { text: text || '(空)' })
      return this.audioProcessor.generateSilentMp3Buffer(0.5)
    }

    // 保存原始延迟设置
    const originalDelayController = this.delayController

    // 应用自定义延迟设置（如果提供）
    if (customRequestDelay !== undefined) {
      this.delayController = new DelayController({
        requestDelay: customRequestDelay,
        requestIntervalDelay: this.delayController.requestIntervalDelay
      })
      log('info', '应用自定义requestDelay', { customRequestDelay, originalRequestDelay: originalDelayController.roundDelayStrategy.baseDelayMs / 1000 })
    }
    if (requestIntervalDelay !== undefined) {
      this.delayController = new DelayController({
        requestDelay: this.delayController.roundDelayStrategy.baseDelayMs / 1000,
        requestIntervalDelay
      })
      log('info', '应用自定义requestIntervalDelay', { requestIntervalDelay, originalRequestIntervalDelay: originalDelayController.intervalDelayStrategy.baseDelayMs / 1000 })
    }

    try {
      // 应用请求延迟机制（传入自定义延迟值）
      await this.applyRoundDelayIfNeeded()
      await this.delayController.applyIntervalDelay()

      // 延迟后再次检查是否应该暂停
      if (this.shouldPause()) {
        log('info', '延迟等待后检测到暂停请求，取消语音生成')
        throw new Error('任务已暂停')
      }

      log('info', '开始生成语音流', { voiceId, textLength: text.length, rate, pitch, requestIntervalDelay, customRequestDelay })

      // 使用重试机制生成语音流
      return await this.generateStreamWithRetry({
        text,
        speaker: voiceId,
        speech_rate: rate,
        pitch,
        requestIntervalDelay
      }, 3)
    } finally {
      // 恢复原始延迟设置
      this.delayController = originalDelayController
      log('debug', '恢复原始延迟设置', { originalRequestDelay: originalDelayController.roundDelayStrategy.baseDelayMs / 1000, originalRequestIntervalDelay: originalDelayController.intervalDelayStrategy.baseDelayMs / 1000 })
    }
  }

  /**
   * 带重试机制的语音流生成
   * @param {Object} opts - TTS参数
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<Buffer>} MP3音频Buffer
   */
  async generateStreamWithRetry(opts, maxRetries = 3) {
    let lastError = null
    let attemptCount = 0
    // 保存自定义延迟值用于重试
    const customIntervalDelay = opts.requestIntervalDelay

    while (attemptCount < maxRetries) {
      try {
        attemptCount++
        log('info', `TTS流生成尝试 ${attemptCount}/${maxRetries}`)

        const buffer = await this.generateStreamOnce(opts)

        log('info', 'TTS流生成成功', { attempt: attemptCount, size: buffer.length })
        return buffer
      } catch (error) {
        lastError = error
        logError(error, {
          stage: 'TTS流生成',
          attempt: attemptCount,
          maxRetries
        })

        // 如果是BLOCK错误需要切换Cookie，立即重试不等待
        if (error.message === 'BLOCK_ERROR_SWITCH_COOKIE') {
          log('info', 'BLOCK错误，立即使用下一个Cookie重试', { attempt: attemptCount })
          // 应用请求延迟
          await this.delayController.applyIntervalDelay()
          continue
        }

        // 如果是登录已过期错误，也需要切换Cookie
        if (error.message === 'LOGIN_EXPIRED_ERROR') {
          log('info', '登录已过期错误，立即使用下一个Cookie重试', { attempt: attemptCount })
          // 应用请求延迟
          await this.delayController.applyIntervalDelay()
          continue
        }

        // 处理WebSocket握手超时错误
        if (error.message?.includes('Opening handshake has timed out') ||
            error.message?.includes('WebSocket连接超时')) {
          log('warn', 'WebSocket握手超时，可能是网络波动或服务器繁忙', { attempt: attemptCount })

          if (attemptCount < maxRetries) {
            // 握手超时后等待更长时间再重试
            const waitTime = attemptCount * 10000 // 10秒、20秒、30秒...
            log('info', `等待 ${waitTime / 1000} 秒后重试...`)
            await new Promise(resolve => setTimeout(resolve, waitTime))

            // 轮换设备参数（可能是设备参数被风控）
            if (attemptCount >= 2) {
              log('info', '尝试轮换设备参数')
              await this.rotateDeviceId()
            }

            continue
          }
        }

        // 处理WebSocket握手失败 - 服务器返回非101响应（如200）
        if (error.message?.includes('Unexpected server response')) {
          log('error', 'WebSocket握手失败 - 目标服务器不接受WebSocket连接', {
            attempt: attemptCount,
            errorMessage: error.message,
            diagnosticInfo: {
              possibleCauses: [
                '豆包API端点已变更',
                '网络环境限制（代理/防火墙/运营商拦截）',
                'Cookie认证失败，服务器返回错误页面',
                '服务器维护或故障',
                'Android/Termux网络环境问题'
              ],
              suggestions: [
                '检查Cookie是否有效',
                '尝试更换网络环境（WiFi/移动数据）',
                '检查是否有代理/VPN影响',
                '查看服务器返回的具体内容（检查日志中的body字段）'
              ]
            }
          })

          // 这种错误通常不会因重试而解决，但仍然尝试
          if (attemptCount < maxRetries) {
            const waitTime = attemptCount * 15000 // 更长的等待时间
            log('info', `等待 ${waitTime / 1000} 秒后重试...`)
            await new Promise(resolve => setTimeout(resolve, waitTime))

            // 轮换设备参数和Cookie
            if (attemptCount >= 1) {
              log('info', '尝试轮换设备参数')
              await this.rotateDeviceId()
            }

            continue
          }
        }

        if (attemptCount < maxRetries) {
          // 重试间隔从10秒起步，每次翻倍
          await this.delayController.applyRetryDelay({ retryCount: attemptCount - 1 })

          log('info', '准备使用下一个Cookie重试')

          // 重试前应用请求延迟机制（传入自定义延迟值）
          log('info', '重试前应用请求延迟机制')
          await this.delayController.applyIntervalDelay()
        }
      }
    }

    throw new Error(`TTS流生成失败，已重试${maxRetries}次: ${lastError?.message}`)
  }

  /**
   * 执行单次语音流生成
   * @param {Object} opts - TTS参数
   * @returns {Promise<Buffer>} MP3音频Buffer
   */
  async generateStreamOnce(opts) {
    const cfg = this.loadConfig()

    // 获取Cookie
    const cookie = await this.getCookieForRequest()
    const cookieHeader = cookie?.value || ''
    const cookieId = cookie?.id

    // 获取设备参数
    const deviceParams = cookieId ? await deviceParamsManager.getOrCreateParams(cookieId) : null

    // 构建URL时传入cookieId和设备参数
    const url = await buildWsUrl({ ...opts, cookieId, deviceParams }, cfg)

    const audioChunks = []

    // 创建消息处理器
    const messageHandler = new MessageHandler()
    let resolvePromise, rejectPromise

    const completionPromise = new Promise((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    let audioDataReceived = false
    let lastAudioDataTime = Date.now()

    messageHandler.onFinish = () => {
      log('info', 'TTS流转换完成', {
        totalChunks: audioChunks.length,
        receivedData: audioDataReceived,
        duration: Date.now() - lastAudioDataTime
      })
      resolvePromise()
    }

    messageHandler.onError = (error) => {
      log('error', 'TTS流处理错误', {
        type: error.type,
        message: error.message,
        chunksReceived: audioChunks.length,
        hasAudioData: audioDataReceived
      })
      if (error.type === 'API_ERROR') {
        this.handleStreamApiError(error, cookie, rejectPromise)
      } else {
        rejectPromise(new Error(error.message))
      }
    }

    messageHandler.onAudioData = (data) => {
      audioDataReceived = true
      lastAudioDataTime = Date.now()
      audioChunks.push(data)
    }

    // 创建WebSocket客户端
    const wsClient = new DoubaoWebSocketClient({
      url,
      headers: {
        Origin: 'https://www.doubao.com',
        'Accept-Language': 'zh,zh-CN;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent': getCachedUserAgent(),
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      },
      messageHandler,
      cookieManager
    })

    // 发送请求（带超时）
    await wsClient.sendRequest(opts.text, 30000)

    // 等待完成（带整体超时保护）
    const overallTimeout = 60000 // 60秒整体超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TTS生成整体超时')), overallTimeout)
    })

    try {
      await Promise.race([completionPromise, timeoutPromise])
    } catch (error) {
      // 即使超时，如果已经收到部分音频数据，尝试使用
      if (audioChunks.length > 0) {
        log('warn', 'TTS生成超时，但已收到部分音频数据', {
          chunksCount: audioChunks.length,
          totalSize: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
        })
        // 继续处理已有数据
      } else {
        throw error
      }
    } finally {
      // 关闭连接
      wsClient.close()
    }

    // 处理音频数据
    if (audioChunks.length === 0) {
      throw new Error('未接收到音频数据')
    }

    // 合并所有音频数据
    const aacBuffer = Buffer.concat(audioChunks)

    // 验证音频数据
    const validationResult = this.audioProcessor.validateAudio(aacBuffer)

    if (!validationResult.isValid) {
      const error = validationResult.error

      // 检查是否是BLOCK或RATE_LIMITED错误
      if (error.type === 'RATE_LIMITED' || error.type === 'BLOCKED') {
        if (cookie) {
          await cookieManager.markCookieAsInvalid(cookie.id, error.message)
          log('info', 'Cookie已标记为无效', { cookieId: cookie.id, reason: error.message })
        }

        // 检查是否还有可用Cookie
        const activeCookie = cookieManager.getActiveCookie()
        if (activeCookie && activeCookie.id !== cookie?.id) {
          log('info', '切换到下一个可用Cookie', { newCookieId: activeCookie.id })
          throw new Error('BLOCK_ERROR_SWITCH_COOKIE')
        }

        // 没有可用Cookie，暂停服务
        log('error', '所有Cookie均已失效，暂停服务')
        this.pause('所有Cookie均已失效，请添加新的Cookie')
        throw new Error('所有Cookie均已失效，请添加新的Cookie')
      }

      throw new Error(error.message)
    }

    // 将AAC转换为MP3
    const mp3Buffer = await this.audioProcessor.convertAacBufferToMp3(aacBuffer)

    // 更新Cookie使用统计
    if (cookie) {
      try {
        await cookieManager.updateCookieUsage(cookie.id, true)
      } catch (updateError) {
        logError(updateError, { stage: 'Cookie统计更新' })
      }
    }

    log('info', 'TTS音频流生成成功', { size: mp3Buffer.length })
    return mp3Buffer
  }

  /**
   * 处理流式API错误
   * @param {Object} error - 错误对象
   * @param {Object} cookie - Cookie对象
   * @param {Function} reject - Promise reject函数
   */
  async handleStreamApiError(error, cookie, reject) {
    log('error', '豆包API返回错误响应', { errorData: error.eventData })

    // 检测到block错误、710022002错误码、或710012001(登录已过期)错误码时，处理Cookie失效逻辑
    const errorCode = error.eventData?.code || error.eventData?.error?.code
    const isBlockError = error.eventData?.message === 'block' || errorCode === 710022002
    const isLoginExpired = errorCode === 710012001

    if (isBlockError || isLoginExpired) {
      const errorType = isBlockError ? 'BLOCK' : '登录已过期'
      log('error', `检测到${errorType}错误，开始处理Cookie失效`, {
        cookieId: cookie?.id,
        errorCode,
        errorData: error.eventData
      })

      // 标记当前Cookie失效
      if (cookie) {
        const errorMessage = isBlockError ? `豆包API返回block错误: ${error.message}` : `豆包API返回登录已过期错误 (code: ${errorCode}): ${error.message}`
        await cookieManager.markCookieAsInvalid(cookie.id, errorMessage)
        log('info', 'Cookie已标记为无效', { cookieId: cookie.id, reason: errorMessage })
      }

      // 检查是否还有可用Cookie
      const activeCookie = cookieManager.getActiveCookie()
      if (activeCookie && activeCookie.id !== cookie?.id) {
        // 还有可用Cookie，使用下一个
        log('info', '切换到下一个可用Cookie', { newCookieId: activeCookie.id })
        reject(new Error('BLOCK_ERROR_SWITCH_COOKIE'))
        return
      }

      // 没有可用Cookie了，轮换设备ID
      log('warn', 'Cookie池中无可用Cookie，更换请求参数', { cookieId: cookie?.id })
      await this.rotateDeviceId(cookie?.id)

      // 重新验证所有失效的Cookie（使用新的设备参数）
      await this.revalidateInvalidCookies()

      // 再次检查是否有可用Cookie
      const newActiveCookie = cookieManager.getActiveCookie()
      if (newActiveCookie) {
        log('info', '重新验证后找到可用Cookie', { cookieId: newActiveCookie.id })
        reject(new Error('BLOCK_ERROR_SWITCH_COOKIE'))
        return
      }

      // 还是没有可用Cookie，暂停并抛出错误
      log('error', '所有Cookie均已失效，暂停服务', { cookieId: cookie?.id })
      this.pause('所有Cookie均已失效，请添加新的Cookie')
      reject(new Error('所有Cookie均已失效，请添加新的Cookie'))
      return
    }

    reject(new Error(`豆包API错误: ${error.message}`))
  }

  /**
   * 使用指定Cookie生成语音
   *
   * 关键：使用传入的cookieValue生成独立的设备指纹和请求参数
   * 保持原有的请求流程不变（延迟抖动、设备ID生成等）
   *
   * @param {Object} options - 生成选项
   * @param {string} options.text - 要转换的文本
   * @param {string} options.voiceId - 发音人ID
   * @param {string} options.cookieValue - Cookie值（用于生成设备指纹）
   * @param {string} [options.rate=0] - 语速
   * @param {string} [options.pitch=0] - 音调
   * @param {string} [options.source='tts'] - 音频来源
   * @param {string} [options.outputPath] - 输出路径
   * @param {number} [options.requestDelay=15] - Cookie轮询完成后的延迟（秒）
   * @param {number} [options.requestIntervalDelay=3] - 请求间隔延迟（秒）
   * @returns {Promise<Object>} 生成结果
   */
  async generateSpeechWithCookie(options) {
    const { text, voiceId, cookieValue, cookieId, deviceParams, rate = 0, pitch = 0, source = 'tts', outputPath, requestDelay = 15, requestIntervalDelay = 3, abortSignal = null } = options

    // 验证发音人
    const voice = voiceService.findVoiceById(voiceId)
    if (!voice) {
      throw new Error(`无效的发音人ID: ${voiceId}`)
    }

    // 检查文本
    if (isUnReadableText(text)) {
      logUnreadableText(text, 'ttsService.generateSpeechWithCookie')
      return this.generateSilentAudio(voice.name, source, outputPath)
    }

    // 检查取消信号
    if (abortSignal?.aborted) {
      throw new Error('任务已取消')
    }

    // 保存原始延迟配置
    const originalDelayController = this.delayController

    // 设置自定义延迟
    this.delayController = new DelayController({
      requestDelay,
      requestIntervalDelay
    })

    try {
      // 应用请求延迟（保持原有的抖动逻辑）
      await this.applyRoundDelayIfNeeded()
      await this.delayController.applyIntervalDelay()

      // 再次检查取消信号（延迟后）
      if (abortSignal?.aborted) {
        throw new Error('任务已取消')
      }

      log('info', '使用指定Cookie生成语音', {
        voiceId,
        textLength: text.length,
        requestDelay,
        requestIntervalDelay,
        hasFixedDeviceParams: !!deviceParams,
        cookieValuePreview: cookieValue?.substring(0, 30) + '...'
      })

      // 使用指定Cookie执行生成
      // 如果传入了deviceParams（预制书模式），则使用固定的设备参数
      const filePath = await this.generateOnceWithCookie({
        text,
        speaker: voiceId,
        speech_rate: rate,
        pitch,
        source,
        outputPath,
        cookieValue,
        cookieId,
        deviceParams,
        abortSignal // 传递取消信号
      })

      const stats = fs.statSync(filePath)

      return {
        filePath,
        url: '/audio/' + path.basename(filePath),
        size: stats.size,
        voice: voice.name
      }
    } finally {
      // 恢复原始延迟配置
      this.delayController = originalDelayController
    }
  }

  /**
   * 使用指定Cookie执行单次生成
   *
   * 关键特性：
   * 1. 支持传入固定的设备参数（deviceParams），用于预制书模式
   * 2. 如果没有传入deviceParams，则从cookieValue生成（保持兼容性）
   * 3. 此逻辑只用于预制书模式，不干扰实时模式
   * 4. 支持取消信号，可在生成过程中中断
   */
  async generateOnceWithCookie(opts) {
    const cfg = this.loadConfig()
    const abortSignal = opts.abortSignal

    // 检查取消信号
    if (abortSignal?.aborted) {
      throw new Error('任务已取消')
    }

    // 统一Cookie锁key：优先使用传入的cookieId（与实时模式一致），
    // 否则退化为md5(cookieValue)（保持向后兼容）
    const lockCookieId = opts.cookieId ||
      (opts.cookieValue ? crypto.createHash('md5').update(opts.cookieValue).digest('hex').substring(0, 16) : null)

    // 获取Cookie级互斥锁（防止预制与实时模式并发打同一Cookie）
    const releaseLock = await cookieManager.acquireCookieLock(lockCookieId)

    try {
      return await this.generateOnceWithCookieInner(opts, cfg)
    } finally {
      releaseLock()
    }
  }

  /**
   * generateOnceWithCookie 的实际执行体（由锁包裹）
   */
  async generateOnceWithCookieInner(opts, cfg) {
    const abortSignal = opts.abortSignal

    // 检查取消信号
    if (abortSignal?.aborted) {
      throw new Error('任务已取消')
    }

    let url

    // 如果传入了固定的设备参数（预制书模式），直接使用
    if (opts.deviceParams && opts.deviceParams.deviceId && opts.deviceParams.webId) {
      log('info', '使用固定的设备参数构建URL', {
        deviceId: opts.deviceParams.deviceId,
        webId: opts.deviceParams.webId
      })

      // 使用buildWsUrl构建URL，确保参数一致
      url = await buildWsUrl({
        speaker: opts.speaker,
        speech_rate: opts.speech_rate,
        pitch: opts.pitch,
        cookieId: opts.cookieId,
        deviceParams: opts.deviceParams
      }, cfg)
    } else {
      // 没有固定参数，使用cookieId获取设备参数
      const cookieId = opts.cookieId || (opts.cookieValue ? crypto.createHash('md5').update(opts.cookieValue).digest('hex').substring(0, 16) : null)
      const deviceParams = cookieId ? await deviceParamsManager.getOrCreateParams(cookieId) : null

      url = await buildWsUrl({
        speaker: opts.speaker,
        speech_rate: opts.speech_rate,
        pitch: opts.pitch,
        cookieId,
        deviceParams
      }, cfg)
    }

    // 确定输出路径
    const { outPath, tmpAacPath } = this.prepareOutputPaths(opts)

    // 确保输出目录存在
    const outputDir = path.dirname(tmpAacPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const fileStream = fs.createWriteStream(tmpAacPath)

    // 创建消息处理器
    const messageHandler = new MessageHandler()
    let resolvePromise, rejectPromise
    let isCancelled = false
    let wsClient = null

    const completionPromise = new Promise((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    // 监听取消信号
    const abortHandler = () => {
      isCancelled = true
      log('info', 'TTS生成被取消，关闭WebSocket连接')
      try {
        // 安全关闭WebSocket（可能还未建立连接）
        if (wsClient && wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN) {
          wsClient.close()
        }
      } catch (closeError) {
        log('debug', '关闭WebSocket时出错（可能还未建立连接）', { error: closeError.message })
      }
      rejectPromise(new Error('任务已取消'))
    }

    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler)
    }

    messageHandler.onFinish = () => {
      log('info', 'TTS转换完成（指定Cookie）')
      resolvePromise()
    }

    messageHandler.onError = (error) => {
      if (error.type === 'API_ERROR') {
        const errorCode = error.eventData?.code || error.eventData?.error?.code
        // 检测到block错误、710022002错误码、或710012001(登录已过期)错误码
        if (error.eventData?.message === 'block' || errorCode === 710022002 || errorCode === 710012001) {
          const errorType = errorCode === 710012001 ? '登录已过期' : 'BLOCK'
          log('error', `检测到${errorType}错误`, { errorCode, errorData: error.eventData })
          rejectPromise(new Error(errorCode === 710012001 ? 'LOGIN_EXPIRED_ERROR' : 'BLOCK_ERROR'))
          return
        }
      }
      rejectPromise(new Error(error.message))
    }

    // 创建WebSocket客户端
    // 注意：只使用outputHandler写入文件，不在onAudioData中重复写入
    wsClient = new DoubaoWebSocketClient({
      url,
      headers: {
        Origin: 'https://www.doubao.com',
        'Accept-Language': 'zh,zh-CN;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent': getCachedUserAgent(),
        ...(opts.cookieValue ? { Cookie: opts.cookieValue } : {})
      },
      messageHandler,
      outputHandler: fileStream
    })

    try {
      // 发送请求（带超时）
      await wsClient.sendRequest(opts.text, 30000)

      // 等待完成（带整体超时保护）
      const overallTimeout = 60000 // 60秒整体超时
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TTS生成整体超时')), overallTimeout)
      })

      try {
        await Promise.race([completionPromise, timeoutPromise])
      } catch (error) {
        // 关闭连接
        wsClient.close()
        throw error
      }

      // 关闭连接
      wsClient.close()

      // 等待文件流完全关闭
      await new Promise((resolve) => {
        fileStream.end(() => {
          log('info', '文件流已关闭')
          resolve()
        })
      })

      // 额外等待文件系统完成写入
      await new Promise(resolve => setTimeout(resolve, 500))

      // 验证和转码
      await this.validateAndTranscode(tmpAacPath, outPath, null)

      // 设置文件权限
      setReadableWritable(outPath)

      log('info', 'TTS音频文件保存成功（指定Cookie）', { filePath: outPath })

      return outPath
    } catch (error) {
      // 清理：关闭文件流和WebSocket
      wsClient?.close()
      fileStream.end()

      // 删除临时文件
      try {
        if (fs.existsSync(tmpAacPath)) {
          fs.unlinkSync(tmpAacPath)
        }
      } catch (cleanupError) {
        log('warn', '清理临时文件失败', { error: cleanupError.message })
      }

      // 处理BLOCK或登录已过期错误，标记Cookie为无效
      if (error.message === 'BLOCK_ERROR' || error.message === 'LOGIN_EXPIRED_ERROR') {
        const cookieValue = opts.cookieValue
        if (cookieValue) {
          try {
            // 优先使用真实cookieId，否则从cookieValue md5得出
            const cookieId = opts.cookieId ||
              crypto.createHash('md5').update(cookieValue).digest('hex').substring(0, 16)
            const errorMessage = error.message === 'LOGIN_EXPIRED_ERROR' ? '登录已过期' : 'BLOCK错误'
            await cookieManager.markCookieAsInvalid(cookieId, `豆包API返回${errorMessage}`)
            log('info', 'Cookie已标记为无效', { cookieId, reason: errorMessage })
          } catch (markError) {
            log('warn', '标记Cookie失效失败', { error: markError.message })
          }
        }
      }

      throw error
    } finally {
      // 移除取消信号监听器
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler)
      }
    }
  }
}

// 导出单例实例
export const ttsService = new TtsService()
