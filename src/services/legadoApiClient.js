import axios from 'axios'
import { log, logError } from '../utils/logger.js'

/**
 * 阅读Web服务API客户端
 * 用于与阅读Web服务进行HTTP通信
 * 
 * 依赖: 需要安装 axios (npm install axios)
 */
class LegadoApiClient {
  constructor() {
    this.timeout = 10000 // 10秒超时
    this.maxRetries = 1 // 只重试1次
  }

  buildBaseUrl(serverIp, serverPort) {
    return `http://${serverIp}:${serverPort}`
  }

  async requestWithRetry(url, options = {}) {
    let lastError = null

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios({
          url,
          timeout: this.timeout,
          ...options
        })

        if (response.data && response.data.isSuccess === false) {
          throw new Error(response.data.errorMsg || '服务端返回错误')
        }

        return response.data

      } catch (error) {
        lastError = error
        
        let errorMessage = error.message
        if (error.code === 'ECONNREFUSED') {
          errorMessage = '连接被拒绝，请检查服务器是否启动'
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          errorMessage = '连接超时，请检查网络或服务器地址'
        } else if (error.code === 'ENOTFOUND') {
          errorMessage = '无法解析服务器地址，请检查IP是否正确'
        } else if (error.code === 'ENETUNREACH') {
          errorMessage = '网络不可达，请检查网络连接'
        }
        
        const responseErrorMsg = error.response?.data?.errorMsg || ''
        const fullErrorMessage = errorMessage + responseErrorMsg
        if (fullErrorMessage.includes('未在数据库找到对应书籍') || fullErrorMessage.includes('请先添加')) {
          log('warn', '业务逻辑错误，不重试', { url, errorMessage: fullErrorMessage })
          throw error
        }
        
        if (attempt >= this.maxRetries) {
          logError(error, { stage: 'API请求', url, errorCode: error.code })
        }

        if (attempt < this.maxRetries) {
          const delayMs = Math.pow(2, attempt - 1) * 1000
          await new Promise(resolve => setTimeout(resolve, delayMs))
        } else {
          lastError.message = errorMessage
        }
      }
    }

    throw lastError
  }

  async getBookshelf(serverIp, serverPort) {
    if (!serverIp || !serverPort) {
      throw new Error('服务器IP和端口不能为空')
    }
    const url = `${this.buildBaseUrl(serverIp, serverPort)}/getBookshelf`
    return await this.requestWithRetry(url, { method: 'GET' })
  }

  async getChapterList(serverIp, serverPort, bookUrl) {
    if (!serverIp || !serverPort || !bookUrl) {
      throw new Error('服务器IP、端口和书籍URL不能为空')
    }
    const url = `${this.buildBaseUrl(serverIp, serverPort)}/getChapterList`
    return await this.requestWithRetry(url, {
      method: 'GET',
      params: { url: bookUrl }
    })
  }

  async getChapterContent(serverIp, serverPort, bookUrl, chapterIndex) {
    if (!serverIp || !serverPort || !bookUrl || chapterIndex === undefined) {
      throw new Error('服务器IP、端口、书籍URL和章节索引不能为空')
    }
    const url = `${this.buildBaseUrl(serverIp, serverPort)}/getBookContent`
    return await this.requestWithRetry(url, {
      method: 'GET',
      params: {
        url: bookUrl,
        index: chapterIndex
      }
    })
  }

  async getCover(serverIp, serverPort, coverPath) {
    if (!serverIp || !serverPort || !coverPath) {
      throw new Error('服务器IP、端口和封面路径不能为空')
    }
    const url = `${this.buildBaseUrl(serverIp, serverPort)}/cover`
    return await this.requestWithRetry(url, {
      method: 'GET',
      params: { path: coverPath },
      responseType: 'arraybuffer'
    })
  }
}

export const legadoApiClient = new LegadoApiClient()
