/**
 * TXT文件预制书服务
 * 处理TXT文件上传、解析、章节分割和预制任务管理
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDataPath, getSafeDirName } from '../utils/pathUtils.js'
import { log, logError } from '../utils/logger.js'
import { prefetchService } from './prefetch/prefetchService.js'
import { ttsService } from './ttsService.js'
import { fileURLToPath } from 'url'
import iconv from 'iconv-lite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 中文数字转阿拉伯数字
 * @param {string} chineseNum - 中文数字
 * @returns {number} 阿拉伯数字
 */
function chineseToNumber(chineseNum) {
  const chineseMap = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '十': 10, '百': 100, '千': 1000, '万': 10000
  }

  let result = 0
  let temp = 0
  let lastUnit = 1

  for (let i = chineseNum.length - 1; i >= 0; i--) {
    const char = chineseNum[i]
    const value = chineseMap[char]

    if (value === undefined) continue

    if (value >= 10) {
      if (temp === 0) temp = 1
      result += temp * value
      temp = 0
      lastUnit = value
    } else {
      temp = temp * 10 + value
    }
  }

  if (temp > 0) {
    result += temp
  }

  return result || parseInt(chineseNum) || 0
}

/**
 * TXT文件预制书服务
 */
class TxtPrefabService {
  constructor() {
    // 使用标准目录：
    // - 任务映射放到 data/prefetch/tasks/（和现有任务统一）
    // - 书籍元数据和章节内容放到 data/book-cache/（作为本地缓存）
    this.tasksDir = getDataPath('prefetch', 'tasks')
    this.uploadedBooks = new Map() // 内存中缓存已上传的书籍信息
    this.initialized = false
  }

  /**
   * 初始化服务
   */
  async initialize() {
    if (this.initialized) return

    try {
      await fs.mkdir(this.tasksDir, { recursive: true })
      this.initialized = true
      log('info', 'TXT预制书服务初始化完成')
    } catch (error) {
      logError(error, { stage: 'TXT预制书服务初始化' })
      throw error
    }
  }

  /**
   * 生成书籍ID（基于文件名和内容的哈希）
   * @param {string} fileName - 文件名
   * @param {Buffer} content - 文件内容
   * @returns {string} 书籍ID（16位短哈希）
   */
  generateBookId(fileName, content) {
    const hash = crypto.createHash('md5')
    hash.update(fileName)
    hash.update(content.slice(0, 1024)) // 使用前1KB内容参与哈希
    return hash.digest('hex').substring(0, 16)
  }

  /**
   * 检测文件编码并转换为UTF-8
   * @param {Buffer} buffer - 文件内容Buffer
   * @returns {string} UTF-8编码的字符串
   */
  detectAndConvertEncoding(buffer) {
    // 检查BOM
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      // UTF-8 BOM
      return buffer.slice(3).toString('utf-8')
    }
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
      // UTF-16 LE BOM
      return iconv.decode(buffer.slice(2), 'utf-16le')
    }
    if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
      // UTF-16 BE BOM
      return iconv.decode(buffer.slice(2), 'utf-16be')
    }

    // 尝试UTF-8解码
    try {
      const utf8Content = buffer.toString('utf-8')
      // 检查是否有乱码（简单启发式）
      if (!this.hasGarbledText(utf8Content)) {
        return utf8Content
      }
    } catch (e) {
      // 不是有效的UTF-8
    }

    // 尝试GBK解码
    try {
      const gbkContent = iconv.decode(buffer, 'gbk')
      if (!this.hasGarbledText(gbkContent)) {
        return gbkContent
      }
    } catch (e) {
      // 不是有效的GBK
    }

    // 默认返回UTF-8（可能包含乱码，但总比报错好）
    return buffer.toString('utf-8')
  }

  /**
   * 简单检查文本是否有乱码
   * @param {string} text - 文本内容
   * @returns {boolean} 是否有乱码
   */
  hasGarbledText(text) {
    // 检查常见的乱码字符
    const garbledPattern = /[\uFFFD\u0000-\u0008\u000B-\u000C\u000E-\u001F]/
    const sample = text.slice(0, 2000)

    // 检查是否有大量连续的非ASCII字符（可能是GBK被误读为UTF-8）
    const nonAsciiPattern = /[\x80-\xBF]{4,}/
    const hasNonAsciiSequence = nonAsciiPattern.test(sample)

    // 检查是否有UTF-8多字节字符被错误解码的特征（如：Ã© Ã¨ 等）
    const utf8MojibakePattern = /[ÃÂ][\x80-\xBF]/
    const hasUtf8Mojibake = utf8MojibakePattern.test(sample)

    return garbledPattern.test(sample) || (hasNonAsciiSequence && hasUtf8Mojibake)
  }

  /**
   * 从文件名提取书名
   * @param {string} fileName - 文件名
   * @returns {string} 书名
   */
  extractBookName(fileName) {
    // 移除扩展名
    let name = fileName.replace(/\.txt$/i, '')
    // 移除常见的文件名后缀
    name = name.replace(/\s*[\(\[【](完结|精校|校对|全本)[\)\]】]\s*/gi, '')
    name = name.replace(/\s*by\s*.+$/i, '')
    name = name.replace(/\s*作者[：:].*$/i, '')
    // 清理多余空格
    name = name.trim()
    return name || '未知书籍'
  }

  /**
   * 解析章节标题
   * @param {string} line - 行文本
   * @returns {Object|null} 章节信息或null
   */
  parseChapterTitle(line) {
    const trimmedLine = line.trim()
    if (!trimmedLine) return null

    // 匹配模式列表（按优先级排序）
    const patterns = [
      // 第X章 / 第X回 / 第X节 / 第X卷 / 第X篇
      {
        regex: /^第\s*([一二三四五六七八九十百千零\d]+)\s*(章|回|节|卷|篇)\s*[\s:：]?(.*)$/,
        type: 'chapter'
      },
      // Chapter X / CHAPTER X
      {
        regex: /^Chapter\s*(\d+)\s*[\s:：-]?(.*)$/i,
        type: 'chapter'
      },
      // X、标题 / X.标题 / X．标题
      {
        regex: /^(\d+)\s*[、.．]\s*(.+)$/,
        type: 'chapter'
      },
      // 第X章（无空格版本）
      {
        regex: /^第([一二三四五六七八九十百千零\d]+)(章|回|节|卷|篇)\s*[\s:：]?(.*)$/,
        type: 'chapter'
      }
    ]

    for (const pattern of patterns) {
      const match = trimmedLine.match(pattern.regex)
      if (match) {
        let chapterNum = match[1]
        let chapterTitle = match[3] || ''

        // 转换中文数字
        if (/[一二三四五六七八九十百千零]/.test(chapterNum)) {
          chapterNum = chineseToNumber(chapterNum)
        } else {
          chapterNum = parseInt(chapterNum) || 0
        }

        // cleanTitle 保留完整的章节标题（如：第1章 荒野猎杀）
        const cleanTitle = trimmedLine

        return {
          number: chapterNum,
          title: trimmedLine,
          cleanTitle: cleanTitle
        }
      }
    }

    return null
  }

  /**
   * 分割文本为章节
   * @param {string} content - 文本内容
   * @returns {Array<Object>} 章节数组
   */
  splitIntoChapters(content) {
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    const chapters = []
    let currentChapter = null
    let currentContent = []
    let chapterIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const chapterInfo = this.parseChapterTitle(line)

      if (chapterInfo) {
        // 保存上一个章节
        if (currentChapter) {
          currentChapter.content = currentContent.join('\n').trim()
          currentChapter.wordCount = currentChapter.content.length
          if (currentChapter.content) {
            chapters.push(currentChapter)
          }
        }

        // 创建新章节
        currentChapter = {
          index: chapterIndex++,
          title: chapterInfo.title,
          cleanTitle: chapterInfo.cleanTitle,
          content: '',
          wordCount: 0
        }
        currentContent = []
      } else {
        currentContent.push(line)
      }
    }

    // 保存最后一个章节
    if (currentChapter) {
      currentChapter.content = currentContent.join('\n').trim()
      currentChapter.wordCount = currentChapter.content.length
      if (currentChapter.content) {
        chapters.push(currentChapter)
      }
    }

    // 如果没有识别到任何章节，将整个文本作为一个章节
    if (chapters.length === 0 && content.trim()) {
      // 按固定字数分段（每段约5000字）
      const segmentSize = 5000
      const fullContent = content.trim()

      for (let i = 0; i < fullContent.length; i += segmentSize) {
        const segment = fullContent.slice(i, i + segmentSize)
        chapters.push({
          index: chapterIndex++,
          title: `第${chapterIndex}段`,
          cleanTitle: `第${chapterIndex}段`,
          content: segment,
          wordCount: segment.length
        })
      }
    }

    return chapters
  }

  /**
   * 上传并解析TXT文件
   * @param {Object} file - 上传的文件对象 { name, data, size, tempFilePath, mimetype, mv }
   * @returns {Promise<Object>} 解析结果
   */
  async uploadAndParse(file) {
    await this.initialize()

    // express-fileupload 使用 name 而不是 originalname
    let rawName = file.name || file.originalname || 'unknown.txt'
    
    // express-fileupload 在Windows上会把UTF-8文件名错误解码为Latin1
    // 导致中文变成乱码。修复方法：总是尝试重新解码
    try {
      // 将错误解码的字符串按Latin1重新编码为原始字节，再按UTF-8解码
      const latin1Buffer = Buffer.from(rawName, 'latin1')
      const fixedName = latin1Buffer.toString('utf-8')
      
      // 如果修复后的文件名包含中文字符，说明修复成功
      if (/[\u4e00-\u9fff]/.test(fixedName) && !/[\u4e00-\u9fff]/.test(rawName)) {
        log('debug', '修复文件名编码成功', { rawName, fixedName })
        rawName = fixedName
      }
    } catch (e) {
      log('warn', '文件名编码修复失败', { rawName, error: e.message })
    }
    
    const originalname = rawName
    const size = file.size || 0

    log('debug', '上传文件信息', { 
      name: file.name, 
      originalname: file.originalname, 
      size: file.size,
      hasData: !!file.data,
      hasBuffer: !!file.buffer,
      tempFilePath: file.tempFilePath
    })

    // 检查文件大小（最大50MB）
    const maxSize = 50 * 1024 * 1024
    if (size > maxSize) {
      throw new Error(`文件过大，最大支持50MB，当前文件${(size / 1024 / 1024).toFixed(2)}MB`)
    }

    // 检查文件扩展名
    if (!originalname.toLowerCase().endsWith('.txt')) {
      throw new Error('只支持.txt格式的文件')
    }

    log('info', '开始解析TXT文件', { fileName: originalname, size })

    try {
      // 获取文件内容 - 支持 buffer 和 tempFilePath 两种方式
      let fileBuffer
      if (file.data && file.data.length > 0) {
        // express-fileupload 默认使用内存模式时提供 data
        fileBuffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data)
      } else if (file.tempFilePath) {
        // express-fileupload 使用临时文件模式（useTempFiles: true时file.data为空Buffer，实际内容在临时文件中）
        fileBuffer = await fs.readFile(file.tempFilePath)
      } else if (file.buffer) {
        // 兼容原始格式
        fileBuffer = file.buffer
      } else {
        throw new Error('无法获取文件内容')
      }

      // 检测编码并转换
      const content = this.detectAndConvertEncoding(fileBuffer)

      // 提取书名
      const bookName = this.extractBookName(originalname)
      log('info', '提取书名', { originalname, bookName: bookName || '(空)' })

      // 分割章节
      const chapters = this.splitIntoChapters(content)

      // 生成书籍ID
      const bookId = this.generateBookId(originalname, fileBuffer)

      // 保存书籍元数据
      const bookInfo = {
        bookId,
        bookName,
        fileName: originalname,
        fileSize: size,
        totalChapters: chapters.length,
        chapters: chapters.map(c => ({
          index: c.index,
          title: c.title,
          cleanTitle: c.cleanTitle,
          wordCount: c.wordCount
        })),
        uploadedAt: new Date().toISOString()
      }

      // 使用 bookCacheService 缓存章节内容（和Web书籍缓存统一）
      const { bookCacheService } = await import('./prefetch/bookCacheService.js')
      await bookCacheService.initialize()

      // 如果书籍已存在，先删除旧缓存避免叠加
      const existingCache = await bookCacheService.getCachedBookInfo(bookId)
      if (existingCache) {
        log('info', '书籍已存在，删除旧缓存', { bookId, bookName })
        await bookCacheService.deleteBookCache(bookId)
      }

      // 先保存元数据到 book-cache 目录（确保 cacheChapterContent 能读取到）
      const bookCacheDir = bookCacheService.getBookCacheDir(bookId)
      await fs.mkdir(bookCacheDir, { recursive: true })
      await fs.writeFile(
        path.join(bookCacheDir, 'meta.json'),
        JSON.stringify(bookInfo, null, 2),
        'utf-8'
      )

      // 保存章节内容到 book-cache
      for (const chapter of chapters) {
        await bookCacheService.cacheChapterContent(bookId, chapter.index, {
          title: chapter.title,
          content: chapter.content,
          url: `txt://${bookId}/${chapter.index}`
        })
      }

      // 缓存到内存
      this.uploadedBooks.set(bookId, bookInfo)

      log('info', 'TXT文件解析完成', { bookId, bookName, chapterCount: chapters.length })

      return {
        bookId,
        bookName,
        fileName: originalname,
        fileSize: size,
        totalChapters: chapters.length,
        chapters: bookInfo.chapters
      }
    } catch (error) {
      logError(error, { stage: '解析TXT文件', fileName: originalname })
      throw error
    }
  }

  /**
   * 获取书籍信息
   * @param {string} bookId - 书籍ID
   * @returns {Promise<Object|null>} 书籍信息
   */
  async getBookInfo(bookId) {
    await this.initialize()

    // 先从内存缓存查找
    if (this.uploadedBooks.has(bookId)) {
      return this.uploadedBooks.get(bookId)
    }

    // 从 book-cache 加载元数据
    try {
      const { bookCacheService } = await import('./prefetch/bookCacheService.js')
      await bookCacheService.initialize()
      const bookCacheDir = bookCacheService.getBookCacheDir(bookId)
      const metaPath = path.join(bookCacheDir, 'meta.json')
      const metaContent = await fs.readFile(metaPath, 'utf-8')
      const bookInfo = JSON.parse(metaContent)
      this.uploadedBooks.set(bookId, bookInfo)
      return bookInfo
    } catch (error) {
      log('warn', '找不到书籍信息', { bookId })
      return null
    }
  }

  /**
   * 获取章节内容
   * @param {string} bookId - 书籍ID
   * @param {number} chapterIndex - 章节索引
   * @returns {Promise<string>} 章节内容
   */
  async getChapterContent(bookId, chapterIndex) {
    await this.initialize()

    try {
      // 从 book-cache 读取章节内容
      const { bookCacheService } = await import('./prefetch/bookCacheService.js')
      await bookCacheService.initialize()
      const chapterData = await bookCacheService.getCachedChapter(bookId, chapterIndex)
      if (chapterData && chapterData.content) {
        return chapterData.content
      }
      throw new Error('章节内容不存在')
    } catch (error) {
      logError(error, { stage: '读取章节内容', bookId, chapterIndex })
      throw new Error(`无法读取章节内容: ${error.message}`)
    }
  }

  /**
   * 开始TXT预制任务
   * @param {string} bookId - 书籍ID
   * @param {Array<number>} chapterIndices - 要预制的章节索引数组
   * @param {Object} options - 预制选项 { voiceId, speed, delay }
   * @returns {Promise<Object>} 任务信息
   */
  async startPrefetch(bookId, chapterIndices, options) {
    await this.initialize()

    const { voiceId, speed = 0, delay = 50 } = options

    if (!voiceId) {
      throw new Error('必须指定发音人voiceId')
    }

    if (!Array.isArray(chapterIndices) || chapterIndices.length === 0) {
      throw new Error('必须选择至少一个章节')
    }

    // 获取书籍信息
    const bookInfo = await this.getBookInfo(bookId)
    if (!bookInfo) {
      throw new Error('找不到书籍信息，请重新上传文件')
    }

    log('info', '开始TXT预制任务', { bookId, chapterCount: chapterIndices.length, voiceId })

    // 准备章节信息
    const chaptersInfo = []
    for (const index of chapterIndices) {
      const chapter = bookInfo.chapters[index]
      if (!chapter) {
        throw new Error(`无效的章节索引: ${index}`)
      }

      chaptersInfo.push({
        chapterId: `txt_chapter_${index}`,
        chapterTitle: chapter.cleanTitle,
        chapterIndex: index
      })
    }

    // 先注入章节内容到缓存（必须在任务开始前完成）
    log('info', '正在注入章节内容到缓存', { bookId, chapterCount: chaptersInfo.length })
    await this.injectChapterContentSync(bookId, chaptersInfo)

    // 创建书籍信息对象（用于prefetchService）
    // 使用原始bookId，让prefetchService的目录和bookCacheService一致
    const prefetchBookInfo = {
      bookId: bookId,
      bookName: bookInfo.bookName,
      bookUrl: `txt://${bookId}` // 特殊标记，表示TXT文件来源
    }

    // 创建处理选项 - 强制使用缓存模式，因为我们已经注入内容了
    const prefetchOptions = {
      voiceId,
      speed,
      requestDelay: delay,
      useCacheOnly: true // 强制使用缓存（我们已注入内容）
    }

    // 使用现有的批量预制功能
    const task = await prefetchService.batchProcessChapters(
      prefetchBookInfo,
      chaptersInfo,
      prefetchOptions
    )

    // 保存TXT任务映射关系到标准任务目录（和现有prefetch任务统一）
    const txtTaskInfo = {
      taskId: task.taskId,
      bookId,
      bookName: bookInfo.bookName,
      chapterIndices,
      options: { voiceId, speed, delay },
      source: 'txt', // 标记来源为TXT
      createdAt: new Date().toISOString()
    }

    await fs.writeFile(
      path.join(this.tasksDir, `${task.taskId}.json`),
      JSON.stringify(txtTaskInfo, null, 2),
      'utf-8'
    )

    return {
      taskId: task.taskId,
      bookId,
      bookName: bookInfo.bookName,
      status: 'processing',
      totalChapters: chapterIndices.length
    }
  }

  /**
   * 将章节内容同步注入到bookCacheService（在任务开始前调用）
   * @param {string} bookId - 书籍ID
   * @param {Array<Object>} chaptersInfo - 章节信息
   */
  async injectChapterContentSync(bookId, chaptersInfo) {
    const { bookCacheService } = await import('./prefetch/bookCacheService.js')
    await bookCacheService.initialize()

    let successCount = 0

    for (const chapter of chaptersInfo) {
      try {
        const content = await this.getChapterContent(bookId, chapter.chapterIndex)

        // 保存到bookCacheService（使用原始bookId，和上传时一致）
        await bookCacheService.cacheChapterContent(
          bookId,
          chapter.chapterIndex,
          {
            title: chapter.chapterTitle,
            content: content,
            url: `txt://${bookId}/${chapter.chapterIndex}`
          }
        )

        successCount++
        log('debug', '章节内容已注入', { bookId, chapterIndex: chapter.chapterIndex })
      } catch (error) {
        log('warn', '注入章节内容失败', { bookId, chapterIndex: chapter.chapterIndex, error: error.message })
      }
    }

    log('info', '章节内容注入完成', { bookId, total: chaptersInfo.length, success: successCount })

    if (successCount === 0) {
      throw new Error('所有章节内容注入失败')
    }
  }

  /**
   * 生成TXT预制书TTS配置
   * @param {string} bookId - 书籍ID
   * @param {string} baseUrl - 基础URL
   * @returns {Promise<Object>} TTS配置
   */
  async generateTtsConfig(bookId, baseUrl) {
    const bookInfo = await this.getBookInfo(bookId)
    if (!bookInfo) {
      throw new Error('找不到书籍信息')
    }

    const config = {
      id: Date.now(),
      name: `TXT-${bookInfo.bookName}`,
      url: `${baseUrl}/api/reader/tts/stream-txt?text={{java.encodeURI(speakText)}}&bookId=${bookId}`,
      contentType: 'audio/mpeg',
      concurrentRate: '1',
      enabledCookieJar: false,
      header: '',
      loginUrl: '',
      loginUi: '',
      loginCheckJs: '',
      lastUpdateTime: Date.now()
    }

    return config
  }

  /**
   * 根据文本查找音频（用于TTS流端点）
   * @param {string} text - 文本内容
   * @param {string} bookId - 书籍ID
   * @returns {Promise<Object|null>} 音频信息
   */
  async findAudioByText(text, bookId) {
    await this.initialize()

    // 使用cacheQueryService查找音频（使用原始bookId）
    try {
      const { cacheQueryService } = await import('./prefetch/cacheQueryService.js')
      return await cacheQueryService.findAudioByText(text, bookId)
    } catch (error) {
      log('warn', '查找音频失败', { bookId, textPreview: text.slice(0, 50), error: error.message })
      return null
    }
  }

  /**
   * 清理TXT书籍缓存
   * @param {string} bookId - 书籍ID
   */
  async cleanupBookCache(bookId) {
    try {
      // 使用 bookCacheService 删除缓存（使用原始bookId）
      const { bookCacheService } = await import('./prefetch/bookCacheService.js')
      await bookCacheService.initialize()
      await bookCacheService.deleteBookCache(bookId)
      this.uploadedBooks.delete(bookId)
      log('info', '已清理TXT书籍缓存', { bookId })
    } catch (error) {
      log('warn', '清理TXT书籍缓存失败', { bookId, error: error.message })
    }
  }

  /**
   * 获取所有已上传的TXT书籍列表
   * @returns {Promise<Array<Object>>} 书籍列表
   */
  async getUploadedBooks() {
    await this.initialize()

    const books = []
    try {
      // 从 book-cache/books 目录读取所有TXT书籍
      const { bookCacheService } = await import('./prefetch/bookCacheService.js')
      await bookCacheService.initialize()
      const booksDir = path.join(bookCacheService.baseDir, 'books')

      try {
        await fs.access(booksDir)
      } catch {
        // 目录不存在，返回空列表
        return books
      }

      const dirs = await fs.readdir(booksDir)

      for (const dir of dirs) {
        try {
          const metaPath = path.join(booksDir, dir, 'meta.json')
          const metaContent = await fs.readFile(metaPath, 'utf-8')
          const bookInfo = JSON.parse(metaContent)
          // 只返回有meta.json且是TXT上传的书籍（通过fileName字段判断）
          if (bookInfo.fileName && bookInfo.fileName.endsWith('.txt')) {
            books.push({
              bookId: bookInfo.bookId,
              bookName: bookInfo.bookName,
              fileName: bookInfo.fileName,
              totalChapters: bookInfo.totalChapters,
              uploadedAt: bookInfo.uploadedAt
            })
          }
        } catch (e) {
          // 忽略无法读取的目录
        }
      }
    } catch (error) {
      log('warn', '读取上传书籍列表失败', { error: error.message })
    }

    return books.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
  }
}

// 导出单例
export const txtPrefabService = new TxtPrefabService()
