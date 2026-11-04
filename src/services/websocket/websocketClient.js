import WebSocket from 'ws'
import { log, logError } from '../../utils/logger.js'

/**
 * WebSocket消息处理器接口
 */
export class MessageHandler {
  constructor() {
    this.onTextEvent = null
    this.onAudioData = null
    this.onError = null
    this.onFinish = null
    this._settled = false
  }

  handleTextEvent(event) {
    if (this.onTextEvent) this.onTextEvent(event)
  }

  handleAudioData(data) {
    if (this.onAudioData) this.onAudioData(data)
  }

  handleError(error) {
    if (this._settled) return
    this._settled = true
    if (this.onError) this.onError(error)
  }

  handleFinish() {
    if (this._settled) return
    this._settled = true
    if (this.onFinish) this.onFinish()
  }
}

/**
 * WebSocket消息解析器
 */
export class MessageParser {
  /**
   * 解析WebSocket消息
   * @param {string|Buffer} data - 消息数据
   * @returns {Object|null} 解析结果
   */
  parse(data) {
    let eventData = null

    if (typeof data === 'string') {
      try {
        eventData = JSON.parse(data)
      } catch {
        // 不是有效的JSON
      }
    } else if (Buffer.isBuffer(data)) {
      try {
        const textData = data.toString('utf8')
        eventData = JSON.parse(textData)
      } catch {
        // 不是有效的JSON文本
      }
    }

    return eventData
  }

  /**
   * 判断是否为音频数据
   * @param {Buffer} data - 数据
   * @returns {boolean}
   */
  isAudioData(data) {
    if (!Buffer.isBuffer(data) || data.length < 4) {
      return false
    }

    const header = data.slice(0, 4)

    // AAC ADTS格式: 0xFF 0xF*
    if (header[0] === 0xFF && (header[1] & 0xF0) === 0xF0) {
      return true
    }

    // MP3格式: 0xFF 0xE*
    if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) {
      return true
    }

    // ID3标签
    if (data.length >= 3 && data.toString('ascii', 0, 3) === 'ID3') {
      return true
    }

    return false
  }
}

/**
 * 豆包TTS WebSocket客户端
 */
export class DoubaoWebSocketClient {
  constructor(options = {}) {
    this.url = options.url
    this.headers = options.headers || {}
    this.messageParser = new MessageParser()
    this.messageHandler = options.messageHandler || new MessageHandler()
    this.outputHandler = options.outputHandler
    this.cookieManager = options.cookieManager
  }

  /**
   * 发送TTS请求
   * @param {string} text - 要转换的文本
   * @param {number} timeoutMs - 超时时间（毫秒），默认30秒
   * @returns {Promise<void>}
   */
  async sendRequest(text, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      let errorHandled = false
      // 设置连接超时
      const connectionTimeout = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate()
        }
        reject(new Error('WebSocket连接超时'))
      }, timeoutMs)

      log('info', '正在连接WebSocket', {
        url: this.url,
        headers: {
          ...this.headers,
          Cookie: this.headers.Cookie ? this.headers.Cookie.substring(0, 50) + '...' : 'none'
        }
      })

      // 添加调试：捕获HTTP响应
      const wsOptions = {
        headers: this.headers,
        handshakeTimeout: 15000 // 握手超时15秒（增加容错）
      }

      this.ws = new WebSocket(this.url, wsOptions)

      this.ws.on('open', () => {
        // 清除连接超时
        clearTimeout(connectionTimeout)

        log('info', 'WebSocket连接成功')

        try {
          const textEvent = { event: 'text', text }
          const finishEvent = { event: 'finish' }

          log('info', '发送TTS请求', {
            textLength: text.length,
            textPreview: text.substring(0, 50)
          })

          this.ws.send(JSON.stringify(textEvent))
          this.ws.send(JSON.stringify(finishEvent))

          resolve()
        } catch (err) {
          logError(err, { stage: 'send' })
          reject(err)
        }
      })

      this.ws.on('message', (data) => {
        // 重置响应超时
        this.resetResponseTimeout(reject)
        this.handleMessage(data)
      })

      // 捕获意外的HTTP响应（如200而不是101）
      this.ws.on('unexpected-response', (req, res) => {
        if (errorHandled) return
        errorHandled = true
        clearTimeout(connectionTimeout)
        this.clearResponseTimeout()

        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          const errorInfo = {
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: body.substring(0, 500) // 限制日志大小
          }
          log('error', 'WebSocket收到意外HTTP响应', errorInfo)

          // 尝试解析错误响应
          let apiError = null
          try {
            const errorData = JSON.parse(body)
            if (errorData.code || errorData.error?.code) {
              apiError = {
                type: 'API_ERROR',
                message: errorData.msg || errorData.message || errorData.error?.message || 'Unknown error',
                code: errorData.code || errorData.error?.code,
                eventData: errorData
              }
              log('error', '解析到API错误', { code: apiError.code, message: apiError.message })
            }
          } catch (e) {
            // 无法解析为JSON，使用通用错误
          }

          if (apiError) {
            this.messageHandler.handleError(apiError)
          } else {
            this.handleError(new Error(`Unexpected server response: ${res.statusCode}`))
          }
          reject(new Error(`Unexpected server response: ${res.statusCode}`))
        })
      })

      this.ws.on('error', (err) => {
        if (errorHandled) return
        errorHandled = true
        clearTimeout(connectionTimeout)
        this.clearResponseTimeout()

        // 提供更好的诊断信息
        const diagnosticInfo = {
          message: err.message,
          code: err.code,
          type: err.type,
          stack: err.stack?.split('\n').slice(0, 3).join('\n')
        }

        // 特殊处理 "Unexpected server response" 错误
        if (err.message?.includes('Unexpected server response')) {
          log('error', 'WebSocket握手失败 - 服务器返回非101响应', {
            ...diagnosticInfo,
            possibleCauses: [
              '豆包API端点变更',
              '网络环境限制（代理/防火墙）',
              'Cookie认证失败',
              '服务器维护中'
            ],
            suggestion: '检查Cookie是否有效，或尝试更换网络环境'
          })
        } else {
          log('error', 'WebSocket连接错误', diagnosticInfo)
        }

        this.handleError(err)
        reject(err)
      })
      this.ws.on('close', (code, reason) => {
        this.clearResponseTimeout()
        this.handleClose(code, reason)

        // 如果请求已正常完成（finish事件已处理或错误已处理），
        // 连接关闭属于收尾，即使code为1006也不应报错
        if (this.messageHandler._settled) {
          return
        }

        // 如果连接异常关闭，通知错误处理器
        if (code !== 1000 && code !== 1001 && !errorHandled) {
          errorHandled = true
          const errorMsg = reason ? reason.toString() : `WebSocket异常关闭 (code: ${code})`
          log('error', 'WebSocket连接异常关闭', { code, reason: errorMsg })
          this.handleError(new Error(errorMsg))
          reject(new Error(errorMsg))
        }
      })
    })
  }

  /**
   * 重置响应超时计时器
   * @param {Function} reject - Promise reject函数
   * @param {number} timeoutMs - 超时时间（毫秒），默认20秒
   */
  resetResponseTimeout(reject, timeoutMs = 20000) {
    this.clearResponseTimeout()
    this.responseTimeout = setTimeout(() => {
      log('error', 'WebSocket响应超时', { timeoutMs })
      if (this.ws) {
        this.ws.terminate()
      }
      if (reject) {
        reject(new Error('WebSocket响应超时'))
      }
    }, timeoutMs)
  }

  /**
   * 清除响应超时计时器
   */
  clearResponseTimeout() {
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout)
      this.responseTimeout = null
    }
  }

  /**
   * 处理WebSocket消息
   * @param {string|Buffer} data - 消息数据
   */
  async handleMessage(data) {
    const eventData = this.messageParser.parse(data)

    if (eventData) {
      await this.handleTextEvent(eventData)
    } else if (this.messageParser.isAudioData(data)) {
      this.handleAudioData(data)
    }
  }

  /**
   * 处理文本事件
   * @param {Object} event - 事件对象
   */
  async handleTextEvent(event) {
    const expectedEvents = ['finish', 'open_success', 'sentence_start', 'audio', 'synthesis_started']

    if (!expectedEvents.includes(event.event) || event.error || (event.code && event.code !== 0)) {
      log('debug', '接收到事件消息', {
        event: event.event,
        code: event.code,
        hasError: !!event.error
      })
    }

    // 处理finish事件
    if (event.event === 'finish') {
      log('info', 'TTS转换完成事件接收')
      this.messageHandler.handleFinish()
      return
    }

    // 处理open_success事件
    if (event.event === 'open_success') {
      log('debug', 'WebSocket连接成功', { code: event.code })
      return
    }

    // 处理错误事件
    if (event.error || (event.code && event.code !== 0)) {
      const errorMsg = event.message || event.error || `错误代码: ${event.code}`
      log('error', '豆包API返回错误响应', { errorData: event })

      this.messageHandler.handleError({
        type: 'API_ERROR',
        message: errorMsg,
        code: event.code,
        eventData: event
      })

      return
    }

    // 其他事件
    this.messageHandler.handleTextEvent(event)
  }

  /**
   * 处理音频数据
   * @param {Buffer} data - 音频数据
   */
  handleAudioData(data) {
    if (this.outputHandler) {
      this.outputHandler.write(data)
    }

    this.messageHandler.handleAudioData(data)
  }

  /**
   * 处理错误
   * @param {Error} err - 错误对象
   */
  handleError(err) {
    logError(err, { stage: 'ws' })
    this.messageHandler.handleError({
      type: 'WEBSOCKET_ERROR',
      message: err.message,
      error: err
    })
  }

  /**
   * 处理连接关闭
   * @param {number} code - 关闭代码
   * @param {string} reason - 关闭原因
   */
  handleClose(code, reason) {
    log('debug', 'WebSocket连接已关闭', { code, reason: reason?.toString() })
  }

  /**
   * 关闭连接
   */
  close() {
    this.clearResponseTimeout()
    if (this.ws) {
      this.ws.close()
    }
  }
}
