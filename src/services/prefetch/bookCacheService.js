import fs from 'fs/promises'
import path from 'path'
import { legadoApiClient } from '../legadoApiClient.js'
import { log, logError } from '../../utils/logger.js'
import { getDataPath, getSafeDirName, isShortHash } from '../../utils/pathUtils.js'
import { configService } from '../configService.js'
import { getCachedUserAgent } from '../../utils/userAgentUtils.js'
import axios from 'axios'

/**
 * 书籍缓存服务
 * 负责整本书内容的缓存管理，包括获取所有章节内容并本地存储
 * 同时支持封面图片的缓存
 */
class BookCacheService {
  constructor() {
    this.baseDir = getDataPath('book-cache')
    this.cacheIndexFile = path.join(this.baseDir, 'cache-index.json')
    this.coversDir = path.join(this.baseDir, 'covers')
    this.cacheIndex = new Map()
    this.initialized = false
    // 取消标记映射表，用于跟踪正在缓存的书籍取消状态
    this.cancelTokens = new Map()
    // 索引缓存时间戳，用于控制重新加载频率
    this.indexLoadedAt = 0
    // 索引缓存有效期（毫秒），默认5秒
    this.indexCacheTTL = 5000
  }

  /**
   * 设置书籍的取消标记
   * @param {string} bookUrl - 书籍URL
   * @param {boolean} cancelled - 是否取消
   */
  setCancelToken(bookUrl, cancelled = true) {
    this.cancelTokens.set(bookUrl, cancelled)
    log('info', `设置书籍取消标记: ${bookUrl}, cancelled: ${cancelled}`)
  }

  /**
   * 检查书籍是否已取消
   * @param {string} bookUrl - 书籍URL
   * @returns {boolean} 是否已取消
   */
  isCancelled(bookUrl) {
    return this.cancelTokens.get(bookUrl) === true
  }

  /**
   * 清除书籍的取消标记
   * @param {string} bookUrl - 书籍URL
   */
  clearCancelToken(bookUrl) {
    this.cancelTokens.delete(bookUrl)
  }

  /**
   * 初始化服务
   */
  async initialize() {
    if (this.initialized) return

    try {
      await fs.mkdir(this.baseDir, { recursive: true })
      await fs.mkdir(this.coversDir, { recursive: true })
      await this.loadCacheIndex()
      this.initialized = true
      log('info', '书籍缓存服务初始化完成')
    } catch (error) {
      logError(error, { stage: '书籍缓存服务初始化' })
      throw error
    }
  }

  /**
   * 获取书籍封面文件路径
   * @param {string} bookId - 书籍ID
   * @returns {string} 封面文件路径
   */
  getCoverFilePath(bookId) {
    return path.join(this.coversDir, `${bookId}.jpg`)
  }

  /**
   * 检查封面是否已缓存
   * @param {string} bookId - 书籍ID
   * @returns {Promise<boolean>} 是否已缓存
   */
  async isCoverCached(bookId) {
    try {
      const coverPath = this.getCoverFilePath(bookId)
      await fs.access(coverPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 下载并缓存封面图片
   * @param {string} bookId - 书籍ID
   * @param {string} coverUrl - 封面URL
   * @param {string} serverIp - 服务器IP（用于代理请求）
   * @param {string} serverPort - 服务器端口（用于代理请求）
   * @returns {Promise<boolean>} 是否缓存成功
   */
  async cacheCover(bookId, coverUrl, serverIp = null, serverPort = null) {
    if (!coverUrl || coverUrl.trim() === '') {
      log('debug', '封面URL为空，跳过缓存', { bookId })
      return false
    }

    // 检查是否已缓存
    if (await this.isCoverCached(bookId)) {
      log('debug', '封面已缓存，跳过', { bookId })
      return true
    }

    try {
      let imageBuffer

      // 判断封面URL类型
      if (coverUrl.startsWith('http')) {
        // 直接下载网络图片
        log('info', '下载网络封面', { bookId, coverUrl: coverUrl.substring(0, 100) })
        const response = await axios.get(coverUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
          headers: {
            'User-Agent': getCachedUserAgent()
          }
        })
        imageBuffer = Buffer.from(response.data)
      } else if (coverUrl.startsWith('/')) {
        // 相对路径，需要通过阅读服务获取
        if (!serverIp || !serverPort) {
          log('warn', '缺少服务器信息，无法获取封面', { bookId, coverUrl })
          return false
        }
        log('info', '通过阅读服务获取封面', { bookId, serverIp, serverPort, coverUrl })
        imageBuffer = await legadoApiClient.getCover(serverIp, serverPort, coverUrl)
      } else {
        log('warn', '未知的封面URL格式', { bookId, coverUrl: coverUrl.substring(0, 100) })
        return false
      }

      // 保存封面图片
      const coverPath = this.getCoverFilePath(bookId)
      await fs.writeFile(coverPath, imageBuffer)

      log('info', '封面缓存成功', { bookId, size: imageBuffer.length })
      return true
    } catch (error) {
      logError(error, { stage: '缓存封面', bookId, coverUrl: coverUrl.substring(0, 100) })
      return false
    }
  }

  /**
   * 获取本地封面URL
   * @param {string} bookId - 书籍ID
   * @returns {string|null} 本地封面URL，如果不存在返回null
   */
  getLocalCoverUrl(bookId) {
    const coverPath = this.getCoverFilePath(bookId)
    // 返回相对路径，前端可以通过 /api/legado/book-cache/cover/:bookId 访问
    return `/api/legado/book-cache/cover/${bookId}`
  }

  /**
   * 加载缓存索引，如果不存在则扫描目录重建
   * @param {boolean} force - 是否强制重新加载，忽略缓存
   */
  async loadCacheIndex(force = false) {
    // 检查索引缓存是否在有效期内
    const now = Date.now()
    if (!force && this.indexLoadedAt > 0 && (now - this.indexLoadedAt) < this.indexCacheTTL) {
      log('debug', `使用内存缓存的索引，${this.cacheIndex.size} 个书籍`)
      return
    }

    try {
      const content = await fs.readFile(this.cacheIndexFile, 'utf-8')
      const data = JSON.parse(content)
      this.cacheIndex = new Map(Object.entries(data))
      this.indexLoadedAt = now
      log('info', `加载了 ${this.cacheIndex.size} 个书籍缓存记录`)
    } catch (error) {
      // 文件不存在或解析失败，扫描目录重建索引
      log('info', '缓存索引文件不存在，扫描目录重建索引...')
      await this.rebuildCacheIndex()
      this.indexLoadedAt = now
    }
  }

  /**
   * 扫描缓存目录重建索引
   */
  async rebuildCacheIndex() {
    try {
      const booksDir = path.join(this.baseDir, 'books')
      this.cacheIndex = new Map()

      // 检查目录是否存在
      try {
        await fs.access(booksDir)
      } catch {
        log('info', '缓存目录不存在，创建空索引')
        return
      }

      // 扫描所有书籍目录
      const bookDirs = await fs.readdir(booksDir)
      log('info', `发现 ${bookDirs.length} 个书籍目录，正在重建索引...`)

      for (const bookDirName of bookDirs) {
        const bookDir = path.join(booksDir, bookDirName)
        const stat = await fs.stat(bookDir)

        if (!stat.isDirectory()) continue

        // 读取该书籍的所有章节文件
        const chapterFiles = await fs.readdir(bookDir)
        const chapterCount = chapterFiles.filter(f => f.startsWith('chapter_') && f.endsWith('.json')).length

        if (chapterCount === 0) continue

        // 尝试读取meta.json获取书籍信息（TXT上传的书籍有meta.json）
        let bookName = bookDirName
        let bookUrl = ''
        let totalChapters = chapterCount

        try {
          const metaPath = path.join(bookDir, 'meta.json')
          const metaContent = await fs.readFile(metaPath, 'utf-8')
          const metaInfo = JSON.parse(metaContent)
          if (metaInfo.bookName) {
            bookName = metaInfo.bookName
          }
          if (metaInfo.bookId) {
            bookUrl = `txt://${metaInfo.bookId}`
          }
          if (metaInfo.totalChapters) {
            totalChapters = metaInfo.totalChapters
          }
        } catch (e) {
          // meta.json不存在，尝试从prefetch/books/下的index.json读取bookName
          let foundInPrefetch = false
          try {
            const prefetchBooksDir = path.join(process.cwd(), 'data', 'prefetch', 'books')
            const prefetchBookDir = path.join(prefetchBooksDir, bookDirName)
            const prefetchChaptersDir = path.join(prefetchBookDir, 'chapters')
            const prefetchChapters = await fs.readdir(prefetchChaptersDir)
            if (prefetchChapters.length > 0) {
              const firstPrefetchChapter = prefetchChapters[0]
              const prefetchIndexPath = path.join(prefetchChaptersDir, firstPrefetchChapter, 'index.json')
              const prefetchIndexContent = await fs.readFile(prefetchIndexPath, 'utf-8')
              const prefetchIndexData = JSON.parse(prefetchIndexContent)
              if (prefetchIndexData.bookName) {
                bookName = prefetchIndexData.bookName
                foundInPrefetch = true
              }
              if (prefetchIndexData.bookId) {
                bookUrl = prefetchIndexData.bookId
              }
            }
          } catch (e2) {
            // prefetch目录不存在或读取失败，忽略
          }

          // 如果prefetch中也没有找到，尝试从章节文件推断
          if (!foundInPrefetch) {
            try {
              const firstChapterPath = path.join(bookDir, 'chapter_0.json')
              const firstChapterContent = await fs.readFile(firstChapterPath, 'utf-8')
              const firstChapter = JSON.parse(firstChapterContent)
              if (firstChapter.title) {
                bookName = firstChapter.title.split(' ')[0] || bookDirName
              }
              if (firstChapter.url) {
                const urlParts = firstChapter.url.split('/')
                if (urlParts.length > 1) {
                  bookUrl = urlParts.slice(0, -1).join('/')
                }
              }
            } catch (e3) {
              // 忽略读取错误
            }
          }
        }

        // 使用安全的目录名作为bookId
        const safeBookId = this.generateBookId(bookDirName)

        // 创建缓存记录
        const cacheInfo = {
          bookId: safeBookId,
          bookUrl: bookUrl || bookDirName, // 优先使用推断的URL，否则使用目录名
          name: bookName,
          author: '',
          totalChapters,
          cachedChapters: chapterCount,
          newCachedChapters: 0,
          skippedChapters: 0,
          failedChapters: 0,
          cachedAt: stat.ctime.toISOString(),
          updatedAt: new Date().toISOString(),
          serverIp: '',
          serverPort: '',
          chapterList: [],
          status: chapterCount > 0 ? 'completed' : 'partial'
        }

        this.cacheIndex.set(safeBookId, cacheInfo)
        log('debug', `重建索引: ${bookName} - ${chapterCount} 章, bookUrl: ${cacheInfo.bookUrl}`)
      }

      // 保存重建的索引
      await this.saveCacheIndex()
      log('info', `索引重建完成，共 ${this.cacheIndex.size} 本书籍`)
    } catch (error) {
      logError(error, { stage: '重建缓存索引' })
      this.cacheIndex = new Map()
    }
  }

  /**
   * 保存缓存索引
   */
  async saveCacheIndex() {
    try {
      const data = Object.fromEntries(this.cacheIndex)
      await fs.writeFile(this.cacheIndexFile, JSON.stringify(data, null, 2), 'utf-8')
      // 重置索引加载时间戳，确保下次获取最新数据
      this.indexLoadedAt = Date.now()
      log('debug', '缓存索引已保存')
    } catch (error) {
      logError(error, { stage: '保存缓存索引' })
    }
  }

  /**
   * 生成书籍ID
   * @param {string} bookUrl - 书籍URL
   * @returns {string} 书籍ID（使用MD5哈希确保唯一性且长度固定）
   */
  generateBookId(bookUrl) {
    // 使用getSafeDirName确保生成的ID是安全的目录名
    // 对于长URL会自动使用MD5哈希（32位），短URL则清理后使用原值
    return getSafeDirName(bookUrl)
  }

  /**
   * 获取书籍缓存目录
   * @param {string} bookId - 书籍ID（原始ID或短哈希）
   * @returns {string} 缓存目录路径
   */
  getBookCacheDir(bookId) {
    // 使用generateBookId确保得到安全的目录名
    // generateBookId内部会调用getSafeDirName，它会智能判断是否已经是短哈希
    const safeBookId = this.generateBookId(bookId)
    return path.join(this.baseDir, 'books', safeBookId)
  }

  /**
   * 获取已缓存书籍的信息
   * @param {string} bookId - 书籍ID
   * @returns {Object|null} 缓存信息对象，如果没有则返回null
   */
  async getCachedBookInfo(bookId) {
    await this.initialize()

    // 先尝试直接从内存索引获取
    if (this.cacheIndex.has(bookId)) {
      return this.cacheIndex.get(bookId)
    }

    // 尝试使用生成的bookId查找
    const generatedId = this.generateBookId(bookId)
    if (this.cacheIndex.has(generatedId)) {
      return this.cacheIndex.get(generatedId)
    }

    // 遍历查找匹配的bookUrl
    for (const [key, value] of this.cacheIndex.entries()) {
      if (value.bookId === bookId || value.bookUrl === bookId) {
        return value
      }
    }

    return null
  }

  /**
   * 获取章节内容文件路径
   * @param {string} bookId - 书籍ID
   * @param {number} chapterIndex - 章节索引
   * @returns {string} 文件路径
   */
  getChapterFilePath(bookId, chapterIndex) {
    return path.join(this.getBookCacheDir(bookId), `chapter_${chapterIndex}.json`)
  }

  /**
   * 检查书籍是否已缓存
   * @param {string} bookUrl - 书籍URL
   * @returns {boolean} 是否已缓存
   */
  isBookCached(bookUrl) {
    const bookId = this.generateBookId(bookUrl)
    return this.cacheIndex.has(bookId)
  }

  /**
   * 获取书籍缓存信息
   * @param {string} bookUrl - 书籍URL
   * @returns {Object|null} 缓存信息
   */
  getBookCacheInfo(bookUrl) {
    const bookId = this.generateBookId(bookUrl)
    return this.cacheIndex.get(bookId) || null
  }

  /**
   * 检查章节是否已缓存
   * @param {string} bookId - 书籍ID
   * @param {number} chapterIndex - 章节索引
   * @returns {Promise<boolean>} 是否已缓存
   */
  async isChapterCached(bookId, chapterIndex) {
    try {
      const chapterFilePath = this.getChapterFilePath(bookId, chapterIndex)
      await fs.access(chapterFilePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取章节内容
   * @param {string} bookId - 书籍ID
   * @param {number} chapterIndex - 章节索引
   * @returns {Promise<Object|null>} 章节内容对象
   */
  async getChapterContent(bookId, chapterIndex) {
    try {
      const chapterFilePath = this.getChapterFilePath(bookId, chapterIndex)
      log('debug', '尝试读取章节缓存', { bookId, chapterIndex, chapterFilePath })
      const content = await fs.readFile(chapterFilePath, 'utf-8')
      const chapterData = JSON.parse(content)
      log('debug', '章节缓存读取成功', { bookId, chapterIndex, title: chapterData.title })
      return chapterData
    } catch (error) {
      log('warn', '章节缓存读取失败', { bookId, chapterIndex, error: error.message })
      return null
    }
  }

  /**
   * 从章节文件读取章节列表
   * @param {string} bookId - 书籍ID
   * @returns {Promise<Array>} 章节列表
   */
  async getChapterListFromFiles(bookId) {
    try {
      const bookCacheDir = this.getBookCacheDir(bookId)

      // 检查目录是否存在
      try {
        await fs.access(bookCacheDir)
      } catch {
        // 目录不存在，返回空数组
        return []
      }

      const files = await fs.readdir(bookCacheDir)

      const chapters = []
      for (const file of files) {
        if (file.startsWith('chapter_') && file.endsWith('.json')) {
          try {
            const chapterIndex = parseInt(file.replace('chapter_', '').replace('.json', ''))
            const chapterContent = await this.getChapterContent(bookId, chapterIndex)
            if (chapterContent) {
              chapters.push({
                index: chapterIndex,
                title: chapterContent.title || `第${chapterIndex + 1}章`,
                url: chapterContent.url || ''
              })
            }
          } catch (e) {
            // 忽略单个章节读取错误
          }
        }
      }

      // 按索引排序
      chapters.sort((a, b) => a.index - b.index)

      log('info', `从文件读取到 ${chapters.length} 个章节`, { bookId })
      return chapters
    } catch (error) {
      logError(error, { stage: '从文件读取章节列表', bookId })
      return []
    }
  }

  /**
   * 缓存单个章节内容
   * @param {string} bookId - 书籍ID
   * @param {number} chapterIndex - 章节索引
   * @param {Object} chapterData - 章节数据
   * @returns {Promise<boolean>} 是否缓存成功
   */
  async cacheChapterContent(bookId, chapterIndex, chapterData) {
    try {
      // 确保书籍缓存目录存在
      const bookCacheDir = this.getBookCacheDir(bookId)
      await fs.mkdir(bookCacheDir, { recursive: true })

      // 保存章节内容到文件
      const chapterFilePath = this.getChapterFilePath(bookId, chapterIndex)
      const dataToSave = {
        ...chapterData,
        cachedAt: new Date().toISOString()
      }
      await fs.writeFile(chapterFilePath, JSON.stringify(dataToSave, null, 2), 'utf-8')

      // 更新缓存索引
      let cacheInfo = this.cacheIndex.get(bookId)
      if (!cacheInfo) {
        // 尝试读取meta.json获取书籍信息（TXT上传的书籍有meta.json）
        let bookName = ''
        let bookUrl = ''
        let totalChapters = 0
        try {
          const metaPath = path.join(bookCacheDir, 'meta.json')
          const metaContent = await fs.readFile(metaPath, 'utf-8')
          const metaInfo = JSON.parse(metaContent)
          bookName = metaInfo.bookName || ''
          bookUrl = metaInfo.bookId ? `txt://${metaInfo.bookId}` : ''
          totalChapters = metaInfo.totalChapters || 0
        } catch (e) {
          // meta.json不存在或读取失败，忽略
        }

        cacheInfo = {
          bookId,
          bookUrl: bookUrl || '',
          name: bookName || '',
          author: '',
          totalChapters: totalChapters || 0,
          cachedChapters: 0,
          cachedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'partial'
        }
      }
      cacheInfo.cachedChapters = (cacheInfo.cachedChapters || 0) + 1
      cacheInfo.updatedAt = new Date().toISOString()
      this.cacheIndex.set(bookId, cacheInfo)
      await this.saveCacheIndex()

      log('debug', `章节内容已缓存`, { bookId, chapterIndex })
      return true
    } catch (error) {
      logError(error, { stage: '缓存单个章节', bookId, chapterIndex })
      return false
    }
  }

  /**
   * 缓存整本书
   * @param {Object} bookInfo - 书籍信息
   * @param {string} serverIp - 服务器IP
   * @param {string} serverPort - 服务器端口
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<Object>} 缓存结果
   */
  async cacheBook(bookInfo, serverIp, serverPort, progressCallback = null) {
    await this.initialize()

    const { bookUrl, name, author, coverUrl } = bookInfo
    const bookId = this.generateBookId(bookUrl)

    log('info', '开始缓存书籍', { bookId, bookName: name, author, hasCover: !!coverUrl })

    try {
      // 创建书籍缓存目录
      const bookCacheDir = this.getBookCacheDir(bookId)
      await fs.mkdir(bookCacheDir, { recursive: true })

      // 并行缓存封面（如果有）
      let coverCached = false
      if (coverUrl) {
        coverCached = await this.cacheCover(bookId, coverUrl, serverIp, serverPort)
        log('info', `封面缓存${coverCached ? '成功' : '失败'}`, { bookId, coverUrl: coverUrl.substring(0, 100) })
      }

      // 获取章节列表
      log('info', '获取章节列表', { bookUrl })
      const chapterResult = await legadoApiClient.getChapterList(serverIp, serverPort, bookUrl)
      const chapters = chapterResult.data || []

      if (chapters.length === 0) {
        throw new Error('书籍没有章节')
      }

      log('info', `获取到 ${chapters.length} 个章节，开始缓存内容`)

      // 检查已缓存的章节
      const skippedChapters = []
      const chaptersToCache = []

      for (const chapter of chapters) {
        const isCached = await this.isChapterCached(bookId, chapter.index)
        if (isCached) {
          skippedChapters.push(chapter)
        } else {
          chaptersToCache.push(chapter)
        }
      }

      log('info', `跳过 ${skippedChapters.length} 个已缓存章节，需要缓存 ${chaptersToCache.length} 个新章节`)

      // 初始化缓存信息（一开始就保存到索引）
      let cacheInfo = {
        bookId,
        bookUrl,
        name,
        author: author || '',
        coverUrl: coverUrl || '',
        coverCached,
        totalChapters: chapters.length,
        cachedChapters: skippedChapters.length,
        newCachedChapters: 0,
        skippedChapters: skippedChapters.length,
        failedChapters: 0,
        cachedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        serverIp,
        serverPort,
        chapterList: chapters.map(c => ({ index: c.index, title: c.title })),
        status: 'caching' // 初始状态为缓存中
      }
      this.cacheIndex.set(bookId, cacheInfo)
      await this.saveCacheIndex()

      // 发送初始进度（包含跳过信息）
      if (progressCallback) {
        progressCallback({
          current: skippedChapters.length,
          total: chapters.length,
          toCache: chaptersToCache.length,
          cached: 0,
          skipped: skippedChapters.length,
          failed: 0,
          chapter: '',
          percent: Math.round((skippedChapters.length / chapters.length) * 100),
          status: 'starting'
        })
      }

      // 获取缓存并发数配置
      const cacheConcurrent = await configService.get('prefetch.cacheConcurrent', 20)
      log('info', `使用缓存并发数: ${cacheConcurrent}`, { bookId })

      // 缓存所有章节内容 - 支持并发处理
      const cachedChapters = []
      const failedChapters = []
      let processedCount = 0
      // 用于跟踪正在处理的章节，以便正确报告进度
      const processingChapters = new Set()
      let saveCounter = 0
      // 保存间隔与并发数相同，减少I/O同时保证进度正确
      const SAVE_INTERVAL = cacheConcurrent

      // 更新缓存索引的辅助函数（减少写文件频率）
      const updateCacheIndex = async (forceSave = false) => {
        const totalCached = skippedChapters.length + cachedChapters.length
        cacheInfo.cachedChapters = totalCached
        cacheInfo.newCachedChapters = cachedChapters.length
        cacheInfo.failedChapters = failedChapters.length
        cacheInfo.updatedAt = new Date().toISOString()
        if (cacheInfo.status !== 'cancelled') {
          cacheInfo.status = processedCount >= chaptersToCache.length
            ? (failedChapters.length === 0 ? 'completed' : 'partial')
            : 'caching'
        }
        this.cacheIndex.set(bookId, cacheInfo)
        
        saveCounter++
        if (forceSave || saveCounter >= SAVE_INTERVAL) {
          await this.saveCacheIndex()
          saveCounter = 0
        }
      }

      // 发送进度回调的辅助函数
      const sendProgress = async (chapterTitle = '', status = 'processing', errorMsg = null) => {
        if (progressCallback) {
          const progress = {
            current: skippedChapters.length + processedCount,
            total: chapters.length,
            toCache: chaptersToCache.length,
            cached: cachedChapters.length,
            skipped: skippedChapters.length,
            failed: failedChapters.length,
            processing: processingChapters.size,
            chapter: chapterTitle,
            percent: Math.round(((skippedChapters.length + processedCount) / chapters.length) * 100),
            status: status,
            concurrent: cacheConcurrent
          }
          if (errorMsg) {
            progress.error = errorMsg
          }
          progressCallback(progress)
        }
      }

      // 处理单个章节的辅助函数
      const processChapter = async (chapter, chapterIndexInQueue) => {
        const chapterIndex = chapter.index
        processingChapters.add(chapterIndex)
        await sendProgress(chapter.title)

        try {
          // 检查是否已取消
          if (this.isCancelled(bookUrl)) {
            processingChapters.delete(chapterIndex)
            return { status: 'cancelled', chapterIndex }
          }

          // 获取章节内容
          const contentResult = await legadoApiClient.getChapterContent(
            serverIp,
            serverPort,
            bookUrl,
            chapterIndex
          )

          const chapterData = {
            index: chapterIndex,
            title: chapter.title,
            url: chapter.url,
            content: contentResult.data || '',
            cachedAt: new Date().toISOString()
          }

          // 保存章节内容到文件
          const chapterFilePath = this.getChapterFilePath(bookId, chapterIndex)
          await fs.writeFile(chapterFilePath, JSON.stringify(chapterData, null, 2), 'utf-8')

          cachedChapters.push(chapterData)
          processedCount++
          processingChapters.delete(chapterIndex)
          log('debug', `章节缓存成功 ${processedCount}/${chaptersToCache.length}`, { chapterIndex, title: chapter.title })

          // 实时更新缓存索引
          await updateCacheIndex()
          await sendProgress(chapter.title)

          return { status: 'success', chapterIndex, chapterData }
        } catch (error) {
          logError(error, { stage: '缓存章节', chapterIndex, title: chapter.title })
          failedChapters.push({ index: chapterIndex, title: chapter.title, error: error.message })
          processedCount++
          processingChapters.delete(chapterIndex)

          // 实时更新缓存索引
          await updateCacheIndex()
          await sendProgress(chapter.title, 'error', error.message)

          return { status: 'error', chapterIndex, error: error.message }
        }
      }

      // 使用并发控制处理章节
      if (cacheConcurrent <= 1) {
        // 单线程顺序处理
        log('info', '使用单线程顺序处理章节')
        for (let i = 0; i < chaptersToCache.length; i++) {
          const result = await processChapter(chaptersToCache[i], i)
          
          // 检查是否已取消
          if (result.status === 'cancelled' || this.isCancelled(bookUrl)) {
            log('info', `书籍缓存被取消，已缓存 ${cachedChapters.length} 个章节后停止`, { bookId, bookName: name })
            cacheInfo.status = 'cancelled'
            cacheInfo.cancelledAt = new Date().toISOString()
            this.cacheIndex.set(bookId, cacheInfo)
            await this.saveCacheIndex()
            this.clearCancelToken(bookUrl)
            break
          }
        }
      } else {
        // 并发处理 - 使用信号量控制并发数
        log('info', `使用并发处理章节，并发数: ${cacheConcurrent}`)
        
        const chapterQueue = [...chaptersToCache]
        let cancelled = false
        let activeCount = 0
        const maxConcurrent = Math.min(cacheConcurrent, chaptersToCache.length)
        
        const worker = async () => {
          while (chapterQueue.length > 0 && !cancelled && !this.isCancelled(bookUrl)) {
            const chapter = chapterQueue.shift()
            if (!chapter) break
            
            activeCount++
            const currentActive = activeCount
            
            try {
              const result = await processChapter(chapter)
              
              if (result.status === 'cancelled' || this.isCancelled(bookUrl)) {
                cancelled = true
                break
              }
            } finally {
              activeCount--
            }
          }
        }

        const workers = []
        for (let i = 0; i < maxConcurrent; i++) {
          workers.push(worker())
        }

        await Promise.all(workers)

        // 检查是否被取消
        if (cancelled || this.isCancelled(bookUrl)) {
          log('info', `书籍缓存被取消，已缓存 ${cachedChapters.length} 个章节后停止`, { bookId, bookName: name })
          cacheInfo.status = 'cancelled'
          cacheInfo.cancelledAt = new Date().toISOString()
          this.cacheIndex.set(bookId, cacheInfo)
          await this.saveCacheIndex()
          this.clearCancelToken(bookUrl)
        }
      }

      // 最终更新缓存索引（强制保存）
      await updateCacheIndex(true)

      // 发送完成进度
      if (progressCallback) {
        // 根据最终状态确定进度状态
        let finalStatus
        if (cacheInfo.status === 'cancelled') {
          finalStatus = 'cancelled'
        } else if (failedChapters.length === 0) {
          finalStatus = 'completed'
        } else {
          finalStatus = 'partial'
        }
        
        progressCallback({
          current: skippedChapters.length + cachedChapters.length,
          total: chapters.length,
          toCache: chaptersToCache.length,
          cached: cachedChapters.length,
          skipped: skippedChapters.length,
          failed: failedChapters.length,
          chapter: '',
          percent: Math.round(((skippedChapters.length + cachedChapters.length) / chapters.length) * 100),
          status: finalStatus
        })
      }

      log('info', '书籍缓存完成', {
        bookId,
        total: chapters.length,
        skipped: skippedChapters.length,
        cached: cachedChapters.length,
        failed: failedChapters.length,
        coverCached
      })

      return {
        success: true,
        bookId,
        totalChapters: chapters.length,
        cachedChapters: skippedChapters.length + cachedChapters.length,
        newCachedChapters: cachedChapters.length,
        skippedChapters: skippedChapters.length,
        failedChapters: failedChapters.length,
        failedDetails: failedChapters,
        coverCached,
        status: cacheInfo.status
      }
    } catch (error) {
      logError(error, { stage: '缓存书籍', bookId, bookName: name })
      throw error
    }
  }

  /**
   * 获取缓存的章节内容
   * @param {string} bookUrl - 书籍URL
   * @param {number} chapterIndex - 章节索引
   * @returns {Promise<Object|null>} 章节内容
   */
  async getCachedChapter(bookUrl, chapterIndex) {
    await this.initialize()

    const bookId = this.generateBookId(bookUrl)
    const chapterFilePath = this.getChapterFilePath(bookId, chapterIndex)

    try {
      const content = await fs.readFile(chapterFilePath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      log('warn', '获取缓存章节失败', { bookId, chapterIndex, error: error.message })
      return null
    }
  }

  /**
   * 获取所有缓存的书籍列表
   * @param {boolean} forceReload - 是否强制重新加载索引，默认false
   * @returns {Promise<Array>} 缓存的书籍列表
   */
  async getCachedBooks(forceReload = false) {
    await this.initialize()
    // 使用 loadCacheIndex 的内部缓存机制，避免频繁磁盘I/O
    await this.loadCacheIndex(forceReload)
    return Array.from(this.cacheIndex.values())
  }

  /**
   * 删除书籍缓存
   * @param {string} bookUrl - 书籍URL
   * @returns {Promise<boolean>} 是否成功删除
   */
  async deleteBookCache(bookUrl) {
    await this.initialize()

    let bookId = this.generateBookId(bookUrl)

    // 如果bookUrl是txt://格式，提取原始bookId
    if (bookUrl && bookUrl.startsWith('txt://')) {
      const originalId = bookUrl.replace('txt://', '')
      // 如果原始ID是16位哈希格式，直接使用
      if (isShortHash(originalId)) {
        bookId = originalId.toLowerCase()
      }
    }

    try {
      // 删除缓存目录
      const bookCacheDir = this.getBookCacheDir(bookId)
      await fs.rm(bookCacheDir, { recursive: true, force: true })

      // 删除封面缓存
      const coverPath = this.getCoverFilePath(bookId)
      try {
        await fs.access(coverPath)
        await fs.unlink(coverPath)
        log('debug', '封面缓存已删除', { bookId })
      } catch {
        // 封面不存在，忽略错误
      }

      // 从索引中移除
      this.cacheIndex.delete(bookId)
      await this.saveCacheIndex()

      log('info', '书籍缓存已删除', { bookId })
      return true
    } catch (error) {
      logError(error, { stage: '删除书籍缓存', bookId })
      return false
    }
  }

  /**
   * 清理过期的缓存（超过30天的缓存）
   * @param {number} maxAgeDays - 最大保留天数
   * @returns {Promise<number>} 清理的缓存数量
   */
  async cleanExpiredCache(maxAgeDays = 30) {
    await this.initialize()

    const now = new Date()
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000
    let cleanedCount = 0

    for (const [bookId, cacheInfo] of this.cacheIndex.entries()) {
      const cachedAt = new Date(cacheInfo.cachedAt)
      const age = now - cachedAt

      if (age > maxAge) {
        await this.deleteBookCache(cacheInfo.bookUrl)
        cleanedCount++
      }
    }

    log('info', `清理了 ${cleanedCount} 个过期缓存`)
    return cleanedCount
  }

  /**
   * 获取缓存统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getCacheStats() {
    await this.initialize()

    const books = Array.from(this.cacheIndex.values())
    let totalChapters = 0
    let totalSize = 0

    // 计算缓存目录总大小
    try {
      const booksDir = path.join(this.baseDir, 'books')
      const bookDirs = await fs.readdir(booksDir)

      for (const dir of bookDirs) {
        const bookDir = path.join(booksDir, dir)
        const stat = await fs.stat(bookDir)
        if (stat.isDirectory()) {
          const files = await fs.readdir(bookDir)
          for (const file of files) {
            const fileStat = await fs.stat(path.join(bookDir, file))
            totalSize += fileStat.size
          }
        }
      }
    } catch (error) {
      log('warn', '计算缓存大小失败', { error: error.message })
    }

    books.forEach(book => {
      totalChapters += book.cachedChapters || 0
    })

    return {
      totalBooks: books.length,
      totalChapters,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
    }
  }

  /**
   * 清空所有缓存
   * @returns {Promise<Object>} 清空统计
   */
  async clearAllCache() {
    await this.initialize()

    const booksDir = path.join(this.baseDir, 'books')
    let deletedCount = 0

    try {
      // 删除所有书籍缓存目录
      try {
        await fs.access(booksDir)
        await fs.rm(booksDir, { recursive: true, force: true })
        await fs.mkdir(booksDir, { recursive: true })
        deletedCount = this.cacheIndex.size
      } catch {
        // 目录不存在
      }

      // 删除所有封面缓存
      try {
        await fs.access(this.coversDir)
        const coverFiles = await fs.readdir(this.coversDir)
        for (const file of coverFiles) {
          if (file.endsWith('.jpg')) {
            await fs.unlink(path.join(this.coversDir, file))
          }
        }
        log('info', `已清空所有封面缓存，共 ${coverFiles.length} 个`)
      } catch {
        // 目录不存在
      }

      // 清空索引
      this.cacheIndex.clear()
      await this.saveCacheIndex()

      log('info', `已清空所有缓存，共 ${deletedCount} 本书籍`)
      return { deletedCount }
    } catch (error) {
      logError(error, { stage: '清空所有缓存' })
      throw error
    }
  }

  /**
   * 添加书籍到缓存索引（用于数据导入）
   * @param {Object} bookData - 书籍数据
   * @param {string} bookData.bookId - 书籍ID
   * @param {string} bookData.bookName - 书籍名称
   * @param {string} bookData.name - 书籍名称（备选）
   * @param {string} bookData.author - 作者
   * @param {number} bookData.totalChapters - 总章节数
   * @param {number} bookData.cachedChapters - 已缓存章节数
   * @param {string} bookData.coverUrl - 封面URL
   * @param {string} bookData.intro - 简介
   * @param {string} bookData.lastChapterTitle - 最后章节标题
   * @param {string} bookData.lastUpdateTime - 最后更新时间
   * @param {string} bookData.sourceUrl - 源URL
   * @param {string} bookData.bookUrl - 书籍URL（备选）
   * @returns {Promise<boolean>} 是否成功添加
   */
  async addBookToIndex(bookData) {
    await this.initialize()

    try {
      const bookId = bookData.bookId || this.generateBookId(bookData.sourceUrl || bookData.bookUrl)

      // 获取书籍名称（兼容多种字段名）
      const bookName = bookData.name || bookData.bookName || '未知书籍'
      const bookUrl = bookData.sourceUrl || bookData.bookUrl || ''

      // 构建缓存信息对象
      const cacheInfo = {
        bookId,
        bookUrl,
        name: bookName,
        author: bookData.author || '未知作者',
        coverUrl: bookData.coverUrl,
        intro: bookData.intro,
        lastChapterTitle: bookData.lastChapterTitle,
        lastUpdateTime: bookData.lastUpdateTime || new Date().toISOString(),
        totalChapters: bookData.totalChapters || 0,
        cachedChapters: bookData.cachedChapters || 0,
        newCachedChapters: 0,
        skippedChapters: 0,
        failedChapters: 0,
        coverCached: false,
        cachedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        serverIp: '',
        serverPort: '',
        chapterList: [],
        status: 'completed'
      }

      // 添加到缓存索引
      this.cacheIndex.set(bookId, cacheInfo)

      // 保存索引
      await this.saveCacheIndex()

      log('info', `书籍已添加到缓存索引`, { bookId, bookName: cacheInfo.name })
      return true
    } catch (error) {
      logError(error, { stage: '添加书籍到缓存索引', bookData })
      throw error
    }
  }
}

// 导出单例实例
export const bookCacheService = new BookCacheService()
