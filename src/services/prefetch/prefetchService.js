import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { legadoApiClient } from '../legadoApiClient.js'
import { ttsService } from '../ttsService.js'
import { bookCacheService } from './bookCacheService.js'
import { log, logError } from '../../utils/logger.js'
import { getDataPath, getSafeDirName } from '../../utils/pathUtils.js'
import { setReadableWritableAsync } from '../../utils/filePermissionUtils.js'
import { isUnReadableText, logUnreadableText } from '../../utils/textFilter.js'
import { loadTtsConfig } from '../../utils/ttsUtils.js'
import { fileURLToPath } from 'url'
import { parallelPrefetchManager } from './parallelPrefetchManager.js'
import cookieManager from '../cookieManager.js'
import cookieSelector from '../cookieSelector.js'

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 获取TTS配置中的延迟默认值
 * 使用loadTtsConfig以支持配置热更新
 * @returns {Object} 包含systemRequestIntervalDelay和systemRequestDelay的对象
 */
function getTtsDelayDefaults() {
  try {
    const ttsConfig = loadTtsConfig()
    return {
      systemRequestIntervalDelay: ttsConfig.requestIntervalDelay ?? 3,
      systemRequestDelay: ttsConfig.requestDelay ?? 15
    }
  } catch (error) {
    log('warn', '预制书服务：无法加载TTS配置，使用默认值', { error: error.message })
    return {
      systemRequestIntervalDelay: 3,
      systemRequestDelay: 15
    }
  }
}

/**
 * 预制书处理服务
 * 负责预制书模式的完整处理流程：文本分段、音频生成、缓存管理
 */
class PrefetchService {
  constructor() {
    this.baseDir = getDataPath('prefetch')
    this.tasksDir = path.join(this.baseDir, 'tasks')
    this.indexDir = path.join(this.baseDir, 'index')
    this.tasks = new Map()
    this.initialized = false
    this.processingTasks = new Map() // 正在处理的任务
    this.processingSegments = new Map() // 跟踪每个任务正在处理的段落 { taskId: { isProcessing: boolean, currentSegment: number } }
  }

  /**
   * 初始化服务
   */
  async initialize() {
    if (this.initialized) return

    try {
      await fs.mkdir(this.baseDir, { recursive: true })
      await fs.mkdir(this.tasksDir, { recursive: true })
      await fs.mkdir(this.indexDir, { recursive: true })
      
      await this.loadExistingTasks()
      
      // 清理残留的 processingTasks（服务器异常关闭时可能残留）
      this.processingTasks.clear()
      log('debug', '已清理残留的 processingTasks')
      
      this.initialized = true
      log('info', '预制书服务初始化完成')
    } catch (error) {
      logError(error, { stage: '预制书服务初始化' })
      throw error
    }
  }

  /**
   * 加载现有任务
   */
  async loadExistingTasks() {
    try {
      const files = await fs.readdir(this.tasksDir)
      log('info', `任务目录 ${this.tasksDir} 中的文件:`, files)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const taskPath = path.join(this.tasksDir, file)
          try {
            const content = await fs.readFile(taskPath, 'utf-8')
            if (!content || content.trim() === '') {
              log('warn', `任务文件为空，跳过: ${file}`)
              continue
            }
            const task = JSON.parse(content)
          
          // 修复服务器中断导致的任务状态问题
          // 如果任务状态是 processing，说明服务器异常中断，需要恢复为 paused
          let needSave = false
          if (task.status === 'processing') {
            task.status = 'paused'
            task.updatedAt = new Date().toISOString()
            log('info', `任务 ${task.taskId} 状态从 processing 恢复为 paused`, { bookName: task.bookInfo?.bookName })
            needSave = true
          }

          // 无论任务状态如何，都要检查并修复 processing 状态的章节
          // 这些章节可能是之前中断遗留下来的
          if (task.chapters && Array.isArray(task.chapters)) {
            let resetCount = 0
            task.chapters.forEach(chapter => {
              if (chapter.status === 'processing') {
                const oldStatus = chapter.status
                chapter.status = 'pending'
                resetCount++
                log('debug', `章节 ${chapter.chapterTitle} 状态从 ${oldStatus} 重置为 pending`, { taskId: task.taskId })
              }
            })
            if (resetCount > 0) {
              log('info', `重置 ${resetCount} 个处理中的章节为 pending 状态`, { taskId: task.taskId })
              needSave = true
            }
          }

          // 保存修复后的任务
          if (needSave) {
            await this.saveTask(task)
          }
          
          this.tasks.set(task.taskId, task)
          } catch (parseError) {
            log('error', `解析任务文件失败，跳过: ${file}`, { error: parseError.message })
          }
        }
      }
      log('info', `加载了 ${this.tasks.size} 个现有任务`)
    } catch (error) {
      logError(error, { stage: '加载现有任务' })
    }
  }

  /**
   * 处理章节
   * @param {Object} bookInfo - 书籍信息
   * @param {Object} chapterInfo - 章节信息
   * @param {Object} options - 处理选项
   * @param {string} taskId - 任务ID（可选，用于检查任务状态）
   * @returns {Promise<Object>} 处理结果
   */
  async processChapter(bookInfo, chapterInfo, options, taskId = null) {
    await this.initialize()
    // 确保 bookCacheService 已初始化
    await bookCacheService.initialize()

    let { bookId, bookName, bookUrl } = bookInfo
    const { chapterId, chapterTitle, chapterUrl, chapterIndex } = chapterInfo
    const { voiceId, serverIp, serverPort, requestDelay = 15, forceRegenerate = false, speed = 0, useCacheOnly = false } = options

    // 如果bookId是'unknown'或无效，使用bookUrl作为标识
    if (bookId === 'unknown' || !bookId) {
      if (bookUrl) {
        log('info', 'bookId无效，使用bookUrl作为标识', { bookId, bookUrl })
        bookId = bookUrl
      } else {
        throw new Error('书籍信息无效：bookId和bookUrl都为空')
      }
    }

    log('info', '开始处理章节', { bookId, bookName, chapterId, chapterTitle, voiceId, requestDelay, taskId, useCacheOnly })

    try {
      // 检查索引
      let existingIndex = null
      if (!forceRegenerate) {
        existingIndex = await this.loadChapterIndex(bookId, chapterId)
        if (existingIndex && existingIndex.metadata.status === 'completed') {
          log('info', '使用已完成的章节索引', { bookId, chapterId })
          return existingIndex
        }
      }

      // 获取章节内容
      let content = ''

      // 如果强制使用缓存，或者没有Web链接，直接使用本地缓存
      if (useCacheOnly) {
        log('info', '强制使用本地缓存模式', { bookId, chapterIndex })
        const cachedChapter = await bookCacheService.getChapterContent(bookId, chapterIndex)
        if (cachedChapter && cachedChapter.content) {
          log('info', '使用本地缓存的章节内容', { bookId, chapterIndex, contentLength: cachedChapter.content.length })
          content = cachedChapter.content
        } else {
          throw new Error('强制使用缓存模式，但本地缓存不存在')
        }
      } else if (serverIp && serverPort) {
        // 有Web链接，从Web获取最新内容
        log('info', '从Web获取章节内容（最新）', { bookUrl, chapterIndex, serverIp, serverPort })
        try {
          const contentData = await legadoApiClient.getChapterContent(serverIp, serverPort, bookUrl, chapterIndex)
          // 打印完整响应用于调试
          const fullResponseStr = JSON.stringify(contentData, null, 2)
          log('info', '章节内容API完整响应', {
            fullResponse: fullResponseStr.substring(0, 2000),
            responseLength: fullResponseStr.length
          })

          // 尝试多种可能的数据结构
          // 阅读Web服务可能返回: { data: "内容" } 或 { content: "内容" } 或 直接 "内容"
          if (typeof contentData === 'string') {
            content = contentData
          } else if (contentData && typeof contentData === 'object') {
            // 尝试各种可能的字段
            content = contentData.data ||
                     contentData.content ||
                     contentData.text ||
                     contentData.body ||
                     contentData.result ||
                     contentData.value ||
                     ''
          }

          // 如果 content 还是对象，尝试进一步提取
          if (typeof content === 'object' && content !== null) {
            content = content.content ||
                     content.data ||
                     content.text ||
                     JSON.stringify(content)
          }
          log('debug', '提取的章节内容长度', { contentLength: content.length })
        } catch (webError) {
          logError(webError, { stage: '从Web获取章节内容失败，尝试使用缓存', bookId, chapterIndex })
          // Web获取失败，尝试使用本地缓存
          log('info', '尝试从本地缓存读取', { bookId, chapterIndex, bookCacheDir: `data/book-cache/books/${bookId}` })
          const cachedChapter = await bookCacheService.getChapterContent(bookId, chapterIndex)
          log('info', '本地缓存查询结果', { bookId, chapterIndex, found: !!cachedChapter, hasContent: !!(cachedChapter && cachedChapter.content) })
          if (cachedChapter && cachedChapter.content) {
            log('info', 'Web获取失败，使用本地缓存的章节内容', { bookId, chapterIndex, contentLength: cachedChapter.content.length })
            content = cachedChapter.content
          } else {
            throw new Error('Web获取失败且无本地缓存: ' + webError.message)
          }
        }
      } else {
        // 无Web链接，使用本地缓存
        log('info', '无Web链接，尝试使用本地缓存', { bookId, chapterIndex, bookCacheDir: `data/book-cache/books/${bookId}` })
        const cachedChapter = await bookCacheService.getChapterContent(bookId, chapterIndex)
        log('info', '本地缓存查询结果', { bookId, chapterIndex, found: !!cachedChapter, hasContent: !!(cachedChapter && cachedChapter.content) })
        if (cachedChapter && cachedChapter.content) {
          log('info', '使用本地缓存的章节内容', { bookId, chapterIndex, contentLength: cachedChapter.content.length })
          content = cachedChapter.content
        } else {
          throw new Error('无Web链接且无本地缓存')
        }
      }

      if (!content || content.trim() === '') {
        const error = new Error('章节内容为空')
        error.detail = {
          bookId,
          chapterId,
          chapterIndex,
          bookUrl,
          serverIp,
          serverPort,
          attemptedSources: ['contentData.data.content', 'contentData.data.data', 'contentData.content', 'contentData.data']
        }
        throw error
      }

      // 在内容前面加上章节标题
      const contentWithTitle = `${chapterTitle}\n\n${content}`
      log('info', '已添加章节标题到内容', { chapterTitle, contentLength: content.length, newLength: contentWithTitle.length })

      // 分段处理
      const segments = this.splitTextByNewline(contentWithTitle)
      log('info', `文本分段完成，共 ${segments.length} 段`)

      // 渐进式生成音频并更新索引
      const index = await this.generateAudioBatchWithProgressiveIndex(
        segments,
        voiceId,
        bookId,
        chapterId,
        requestDelay,
        {
          bookName,
          chapterTitle,
          voiceId,
          content: contentWithTitle
        },
        existingIndex,
        taskId,
        speed
      )

      log('info', '章节处理完成', { bookId, chapterId, totalSegments: segments.length })
      return index
    } catch (error) {
      // 对于正常的业务逻辑错误（如暂停、取消），不记录为错误日志
      if (error.message === '任务已暂停' || error.message === '任务已取消') {
        log('info', `章节处理${error.message}`, { bookId, chapterId, taskId })
      } else {
        logError(error, { stage: '处理章节', bookId, chapterId })
      }
      throw error
    }
  }

  /**
   * 获取指定范围的章节列表
   * 优先从本地缓存获取，如果没有则从源站获取
   * @param {Object} bookInfo - 书籍信息 { bookId, bookName, bookUrl }
   * @param {number} startIndex - 起始章节索引
   * @param {number} endIndex - 结束章节索引
   * @returns {Promise<Array<Object>>} 章节信息数组 [{ chapterId, chapterTitle, chapterIndex }]
   */
  async getChaptersInRange(bookInfo, startIndex, endIndex) {
    await this.initialize()
    await bookCacheService.initialize()

    const { bookId, bookUrl } = bookInfo
    let chapters = []

    try {
      // 首先尝试从本地缓存获取章节列表
      const cachedChapters = await bookCacheService.getChapterListFromFiles(bookId)

      if (cachedChapters && cachedChapters.length > 0) {
        log('info', '从本地缓存获取章节列表', { bookId, totalChapters: cachedChapters.length })
        chapters = cachedChapters.map(c => ({
          chapterId: `chapter_${c.index}`,
          chapterTitle: c.title || `第${c.index + 1}章`,
          chapterIndex: c.index
        }))
      } else {
        // 本地没有缓存，尝试从源站获取
        log('info', '本地缓存无章节列表，尝试从源站获取', { bookId, bookUrl })

        // 优先使用 bookInfo 中的服务器信息，如果没有则尝试从缓存索引获取
        let serverIp = bookInfo.serverIp
        let serverPort = bookInfo.serverPort

        if (!serverIp || !serverPort) {
          const cacheInfo = await bookCacheService.getCachedBookInfo(bookId)
          if (cacheInfo) {
            serverIp = cacheInfo.serverIp
            serverPort = cacheInfo.serverPort
          }
        }

        if (serverIp && serverPort) {
          const chapterResult = await legadoApiClient.getChapterList(serverIp, serverPort, bookUrl)
          const apiChapters = chapterResult.data || []

          chapters = apiChapters.map(c => ({
            chapterId: `chapter_${c.index}`,
            chapterTitle: c.title || `第${c.index + 1}章`,
            chapterIndex: c.index
          }))

          log('info', '从源站获取章节列表成功', { bookId, totalChapters: chapters.length })
        } else {
          log('warn', '无法获取服务器信息', { bookId, bookUrl })
        }
      }

      if (chapters.length === 0) {
        log('warn', '无法获取章节列表', { bookId, bookUrl })
        return []
      }

      // 过滤指定范围的章节
      const filteredChapters = chapters.filter(c =>
        c.chapterIndex >= startIndex && c.chapterIndex <= endIndex
      )

      log('info', '获取章节范围成功', {
        bookId,
        startIndex,
        endIndex,
        totalChapters: chapters.length,
        filteredCount: filteredChapters.length
      })

      return filteredChapters
    } catch (error) {
      logError(error, { stage: '获取章节范围', bookId, startIndex, endIndex })
      return []
    }
  }

  /**
   * 批量处理多个章节
   * @param {Object} bookInfo - 书籍信息
   * @param {Array<Object>} chaptersInfo - 章节信息数组
   * @param {Object} options - 处理选项
   * @returns {Promise<Object>} 任务信息
   */
  async batchProcessChapters(bookInfo, chaptersInfo, options) {
    await this.initialize()

    let { bookId, bookName, bookUrl } = bookInfo
    // TTS调用禁止并发，强制使用单线程处理
    const { voiceId, serverIp, serverPort, requestDelay = 15 } = options

    // 如果bookId是'unknown'或无效，使用bookUrl作为标识
    if (bookId === 'unknown' || !bookId) {
      if (bookUrl) {
        log('info', 'bookId无效，使用bookUrl作为标识', { bookId, bookUrl })
        bookId = bookUrl
      } else {
        throw new Error('书籍信息无效：bookId和bookUrl都为空')
      }
    }

    log('info', '开始批量处理章节（单线程模式）', { bookId, totalChapters: chaptersInfo.length, voiceId })

    // 检查是否已有包含这些章节的暂停任务
    const newChapterIds = new Set(chaptersInfo.map(c => c.chapterId))
    for (const [existingTaskId, existingTask] of this.tasks.entries()) {
      if (existingTask.bookInfo?.bookId === bookId && existingTask.status === 'paused') {
        const existingChapterIds = new Set(existingTask.chapters.map(c => c.chapterId))
        // 检查是否有重叠的章节
        const hasOverlap = chaptersInfo.some(c => existingChapterIds.has(c.chapterId))
        if (hasOverlap) {
          log('info', '找到包含相同章节的暂停任务，恢复该任务', {
            existingTaskId,
            bookId,
            newChapters: chaptersInfo.map(c => c.chapterTitle),
            existingChapters: existingTask.chapters.map(c => c.chapterTitle)
          })
          // 恢复任务
          existingTask.status = 'processing'
          existingTask.updatedAt = new Date().toISOString()
          await this.saveTask(existingTask)
          // 启动处理
          this.startBatchProcessing(existingTaskId)
          return existingTask
        }
      }
    }

    // 创建新任务
    const task = await this.createTask({
      bookInfo,
      chaptersInfo,
      options,
      chapters: chaptersInfo.map(chapter => ({
        chapterId: chapter.chapterId,
        chapterTitle: chapter.chapterTitle,
        chapterIndex: chapter.chapterIndex,
        status: 'pending',
        completedSegments: 0,
        totalSegments: 0,
        error: null
      }))
    })

    // 启动处理 - 强制单线程，不使用并发
    this.startBatchProcessing(task.taskId)

    return task
  }

  /**
   * 开始批量处理
   * @param {string} taskId - 任务ID
   */
  async startBatchProcessing(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    // 检查是否已经在处理中（避免重复启动）
    if (this.processingTasks.has(taskId)) {
      log('warn', '任务已经在处理中', { taskId })
      return
    }

    // 更新任务状态
    task.status = 'processing'
    task.updatedAt = new Date().toISOString()
    await this.saveTask(task)

    // 添加到正在处理的任务列表
    this.processingTasks.set(taskId, task)

    log('info', '开始执行批量处理任务（单线程模式）', { taskId, totalChapters: task.chapters.length })

    // 单线程顺序处理章节 - 禁止并发TTS调用
    // 处理 pending、failed 和 partial 状态的章节（failed 状态需要重试，partial 状态需要继续完成）
    const chapters = task.chapters.filter(chapter =>
      chapter.status === 'pending' ||
      chapter.status === 'failed' ||
      chapter.status === 'partial'
    )
    // 将 failed 和 partial 状态的章节重置为 pending，以便重新处理
    chapters.forEach(chapter => {
      if (chapter.status === 'failed' || chapter.status === 'partial') {
        log('info', `重置章节为 pending 状态以便继续处理`, { taskId, chapterId: chapter.chapterId, previousStatus: chapter.status, previousError: chapter.error })
        chapter.status = 'pending'
        chapter.error = null
      }
    })
    await this.saveTask(task)
    const results = await this.processChaptersSequential(chapters, task)

    // 检查任务当前状态，如果被暂停则保持暂停状态
    const currentTask = this.tasks.get(taskId)
    if (currentTask && currentTask.status === 'paused') {
      log('info', '任务已暂停，保持暂停状态', { taskId, results })
    } else if (currentTask) {
      // 根据处理结果设置任务状态
      // 只有当所有章节都成功完成时，任务状态才设置为 completed
      // 如果有失败的章节，设置为 failed；如果有部分完成，设置为 partial
      if (results.failed > 0 && results.completed === 0) {
        // 所有章节都失败
        task.status = 'failed'
        log('warn', '批量处理任务失败，所有章节处理失败', { taskId, results })
      } else if (results.failed > 0 && results.completed > 0) {
        // 部分章节成功，部分失败
        task.status = 'partial'
        log('info', '批量处理任务部分完成', { taskId, results })
      } else if (results.completed > 0) {
        // 所有章节都成功完成
        task.status = 'completed'
        log('info', '批量处理任务全部完成', { taskId, results })
      } else {
        // 没有完成任何章节（可能是全部跳过或其他情况）
        task.status = 'failed'
        log('warn', '批量处理任务未完成任何章节', { taskId, results })
      }
      task.updatedAt = new Date().toISOString()
      await this.saveTask(task)
    }

    // 从正在处理的任务列表中移除
    this.processingTasks.delete(taskId)

    log('info', '批量处理任务完成', { taskId, results })
  }

  /**
   * 顺序处理章节（单线程模式）
   * @param {Array<Object>} chapters - 章节列表
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 处理结果
   */
  async processChaptersSequential(chapters, task) {
    const results = {
      total: chapters.length,
      completed: 0,
      failed: 0,
      skipped: 0
    }

    // 单线程顺序处理 - 禁止并发TTS调用
    for (const chapter of chapters) {
      // 检查任务是否被取消或删除
      const currentTask = this.tasks.get(task.taskId)
      if (!currentTask || currentTask.status === 'paused') {
        log('info', '任务已暂停或删除，停止处理章节', { taskId: task.taskId })
        results.skipped += chapters.length - results.completed - results.failed
        break
      }

      try {
        await this.processSingleChapter(chapter, task, results)
      } catch (error) {
        if (error.message === '任务已取消') {
          log('info', '章节处理被取消', { taskId: task.taskId, chapterId: chapter.chapterId })
          results.skipped += chapters.length - results.completed - results.failed
          break
        }
        if (error.message === '任务已暂停') {
          log('info', '章节处理被暂停', { taskId: task.taskId, chapterId: chapter.chapterId })
          results.skipped += chapters.length - results.completed - results.failed
          break
        }
        throw error
      }
    }

    return results
  }

  /**
   * 处理单个章节
   * @param {Object} chapter - 章节信息
   * @param {Object} task - 任务对象
   * @param {Object} results - 处理结果
   */
  async processSingleChapter(chapter, task, results) {
    const { bookInfo, options } = task
    const { serverIp, serverPort, voiceId, requestDelay = 15 } = options

    try {
      // 更新章节状态为处理中
      chapter.status = 'processing'
      await this.saveTask(task)

      // 处理章节
      const chapterInfo = {
        chapterId: chapter.chapterId,
        chapterTitle: chapter.chapterTitle,
        chapterUrl: bookInfo.bookUrl,
        chapterIndex: chapter.chapterIndex
      }

      const result = await this.processChapter(bookInfo, chapterInfo, {
        voiceId,
        serverIp,
        serverPort,
        requestDelay,
        forceRegenerate: false,
        useCacheOnly: options.useCacheOnly
      }, task.taskId)

      // 根据实际完成状态设置章节状态
      chapter.completedSegments = result.metadata.completedSegments
      chapter.totalSegments = result.metadata.totalSegments
      chapter.error = null

      // 只有全部完成才标记为 completed，否则标记为 partial
      if (result.metadata.status === 'completed') {
        chapter.status = 'completed'
        results.completed++
      } else if (result.metadata.status === 'partial') {
        chapter.status = 'partial'
        results.completed++ // 部分完成也算完成
      } else {
        chapter.status = 'failed'
        results.failed++
      }

      log('info', '章节处理完成', {
        taskId: task.taskId,
        chapterId: chapter.chapterId,
        chapterTitle: chapter.chapterTitle,
        completedSegments: chapter.completedSegments,
        totalSegments: chapter.totalSegments,
        status: chapter.status
      })
    } catch (error) {
      // 检查是否是取消错误、暂停错误或停止错误
      if (error.message === '任务已取消' || error.message === '任务已暂停' || error.message === '任务已停止') {
        // 对于暂停错误，将章节状态重置为 pending，以便恢复时继续处理
        if (error.message === '任务已暂停') {
          chapter.status = 'pending'
          await this.saveTask(task)
          log('info', '章节状态已重置为 pending，等待恢复后继续处理', {
            taskId: task.taskId,
            chapterId: chapter.chapterId
          })
        }
        // 对于停止错误，保持当前状态，直接抛出
        throw error
      }

      // 更新章节状态为失败
      chapter.status = 'failed'
      chapter.error = error.message
      results.failed++

      logError(error, {
        stage: '批量处理章节',
        taskId: task.taskId,
        chapterId: chapter.chapterId
      })
    } finally {
      // 保存任务状态（仅当任务仍存在时）
      const currentTask = this.tasks.get(task.taskId)
      if (currentTask) {
        await this.saveTask(task)
      }
    }
  }

  /**
   * 并发处理章节（已废弃，保留用于兼容性）
   * @deprecated 请使用 processChaptersSequential
   */
  async processChaptersInParallel(chapters, task, concurrentRate) {
    log('warn', 'processChaptersInParallel 已废弃，强制使用单线程模式')
    return this.processChaptersSequential(chapters, task)
  }

  /**
   * 从队列中处理章节
   * @param {Array<Object>} queue - 章节队列
   * @param {Object} task - 任务对象
   * @param {Object} results - 处理结果
   * @returns {Promise<void>}
   */
  async processChapterFromQueue(queue, task, results) {
    while (queue.length > 0) {
      // 检查任务是否被取消或删除
      const currentTask = this.tasks.get(task.taskId)
      if (!currentTask || currentTask.status === 'paused') {
        log('info', '任务已暂停或删除，停止处理章节', { taskId: task.taskId })
        // 将剩余章节标记为跳过
        const remainingChapters = queue.length
        if (remainingChapters > 0) {
          results.skipped += remainingChapters
          log('info', `跳过剩余 ${remainingChapters} 个章节`, { taskId: task.taskId })
          // 清空队列
          queue.length = 0
        }
        return
      }

      const chapter = queue.shift()
      const { bookInfo, options } = task
      const { serverIp, serverPort, voiceId, requestDelay = 15 } = options

      try {
        // 再次检查任务状态
        const currentTaskBeforeProcess = this.tasks.get(task.taskId)
        if (!currentTaskBeforeProcess || currentTaskBeforeProcess.status === 'paused') {
          log('info', '任务已暂停，跳过章节处理', { taskId: task.taskId, chapterId: chapter.chapterId })
          // 将章节放回队列或标记为跳过
          results.skipped++
          continue
        }

        // 更新章节状态为处理中
        chapter.status = 'processing'
        await this.saveTask(task)

        // 处理章节
        const chapterInfo = {
          chapterId: chapter.chapterId,
          chapterTitle: chapter.chapterTitle,
          chapterUrl: bookInfo.bookUrl,
          chapterIndex: chapter.chapterIndex
        }

        const result = await this.processChapter(bookInfo, chapterInfo, {
          voiceId,
          serverIp,
          serverPort,
          requestDelay,
          forceRegenerate: false,
          useCacheOnly: options.useCacheOnly
        }, task.taskId)

        // 更新章节状态为已完成
        chapter.status = 'completed'
        chapter.completedSegments = result.metadata.completedSegments
        chapter.totalSegments = result.metadata.totalSegments
        chapter.error = null
        results.completed++

        log('info', '章节处理完成', {
          taskId: task.taskId,
          chapterId: chapter.chapterId,
          chapterTitle: chapter.chapterTitle,
          completedSegments: chapter.completedSegments,
          totalSegments: chapter.totalSegments
        })
      } catch (error) {
        // 检查是否是取消错误、暂停错误或停止错误
        if (error.message === '任务已取消') {
          log('info', '章节处理被取消', { taskId: task.taskId, chapterId: chapter.chapterId })
          results.skipped++
          // 清空剩余队列
          const remainingChapters = queue.length
          if (remainingChapters > 0) {
            results.skipped += remainingChapters
            queue.length = 0
          }
          return
        }

        if (error.message === '任务已暂停') {
          log('info', '章节处理因暂停而中止', { taskId: task.taskId, chapterId: chapter.chapterId })
          // 标记为跳过，等待恢复
          results.skipped++
          // 将当前章节放回队列，恢复后继续处理
          queue.unshift(chapter)
          return
        }

        if (error.message === '任务已暂停') {
          log('info', '章节处理因暂停而中止', { taskId: task.taskId, chapterId: chapter.chapterId })
          // 标记为跳过，不再继续处理
          results.skipped++
          // 清空剩余队列
          const remainingChapters = queue.length
          if (remainingChapters > 0) {
            results.skipped += remainingChapters
            queue.length = 0
          }
          return
        }

        // 更新章节状态为失败
        chapter.status = 'failed'
        chapter.error = error.message
        results.failed++

        logError(error, {
          stage: '批量处理章节',
          taskId: task.taskId,
          chapterId: chapter.chapterId
        })
      } finally {
        // 保存任务状态（仅当任务仍存在时）
        const currentTask = this.tasks.get(task.taskId)
        if (currentTask) {
          await this.saveTask(task)
        }
      }
    }
  }

  /**
   * 使用换行符分段文本，并合并短段落
   * @param {string} content - 原始文本内容
   * @returns {Array<string>} 分段后的文本数组
   */
  splitTextByNewline(content) {
    if (!content) return []

    // 处理各种换行符格式（\r\n, \n, \r），并按换行符分段
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const rawSegments = normalizedContent.split('\n')
      .map(seg => seg.trim())
      .filter(seg => seg.length > 0)

    // 注意：不再合并短段落，确保每个段落都能被独立匹配
    // 阅读APP请求的文本可能只包含短段落（如"但是"、"……"等）
    // 如果合并段落，会导致缓存查询无法命中
    const segments = rawSegments

    log('debug', '文本分段详情', {
      totalSegments: segments.length,
      avgLength: segments.length > 0 ? Math.round(segments.reduce((sum, s) => sum + s.length, 0) / segments.length) : 0,
      contentLength: content.length,
      originalContentPreview: content.substring(0, 100),
      normalizedContentPreview: normalizedContent.substring(0, 100)
    })

    return segments
  }

  /**
   * 批量生成音频并渐进式更新索引
   * 每生成一个音频就立即更新索引文件
   * @param {Array<string>} segments - 文本段落数组
   * @param {string} voiceId - 发音人ID
   * @param {string} bookId - 书籍ID
   * @param {string} chapterId - 章节ID
   * @param {number} requestDelay - Cookie轮询延迟（秒）
   * @param {Object} meta - 元数据
   * @param {Object|null} existingIndex - 已存在的索引
   * @returns {Promise<Object>} 索引对象
   */
  async generateAudioBatchWithProgressiveIndex(segments, voiceId, bookId, chapterId, requestDelay, meta, existingIndex = null, taskId = null, speed = 0) {
    const { bookName, chapterTitle, content } = meta
    // 确保 chapterId 和 bookId 都使用安全的目录名（短哈希）
    const chapterIdStr = getSafeDirName(chapterId)
    const safeBookId = getSafeDirName(bookId)
    const audioDir = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr, 'audio')

    const totalSegments = segments.length
    log('info', '开始批量生成音频（并行处理模式）', { totalSegments, voiceId, requestDelay, speed })

    // 检查段落是否为空
    if (totalSegments === 0) {
      log('warn', '段落为空，创建空索引', { bookId, chapterId })
      await fs.mkdir(audioDir, { recursive: true })
      const emptyIndex = {
        bookId,
        bookName,
        chapterId,
        chapterTitle,
        voiceId,
        content,
        segments: [],
        metadata: {
          totalSegments: 0,
          completedSegments: 0,
          totalDuration: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'completed',
          parallelProcessing: true,
          cookieCount: 0
        }
      }
      // 保存空索引
      const chapterDir = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr)
      await fs.mkdir(chapterDir, { recursive: true })
      const indexPath = path.join(chapterDir, 'index.json')
      await fs.writeFile(indexPath, JSON.stringify(emptyIndex, null, 2), 'utf-8')
      log('info', '空索引已创建', { bookId: safeBookId, chapterId: chapterIdStr })
      return emptyIndex
    }

    // 首先检查任务是否已被取消，避免创建不必要的文件夹
    if (taskId) {
      const task = this.tasks.get(taskId)
      if (!task || task.status === 'paused') {
        log('info', '任务已暂停，跳过音频生成', { taskId })
        throw new Error('任务已暂停')
      }
    }

    await fs.mkdir(audioDir, { recursive: true })

    // 初始化或加载现有索引段
    let indexSegments = []

    // 立即创建初始索引文件，确保 bookName 被保存
    // 这样即使任务刚开始，也能从 index.json 中读取到正确的书名
    const chapterDir = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr)
    const initialIndexPath = path.join(chapterDir, 'index.json')
    try {
      await fs.access(initialIndexPath)
    } catch {
      // 索引文件不存在，创建初始索引
      const initialIndex = {
        bookId,
        bookName,
        chapterId,
        chapterTitle,
        voiceId,
        content,
        segments: [],
        metadata: {
          totalSegments,
          completedSegments: 0,
          totalDuration: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'processing'
        }
      }
      await fs.mkdir(chapterDir, { recursive: true })
      await fs.writeFile(initialIndexPath, JSON.stringify(initialIndex, null, 2), 'utf-8')
      log('info', '初始索引已创建', { bookId: safeBookId, chapterId: chapterIdStr, bookName })
    }
    if (existingIndex && existingIndex.segments) {
      // 加载现有索引段
      indexSegments = existingIndex.segments.map(s => ({
        segmentId: s.segmentId,
        text: s.text || '',
        audioFile: s.audioFile || null,
        fileSize: s.fileSize || 0,
        generatedAt: s.generatedAt || null,
        error: s.error || null
      }))
      log('info', '加载现有索引段', { count: indexSegments.length })
    }

    // 确保索引段数组长度与段落数一致
    while (indexSegments.length < totalSegments) {
      const i = indexSegments.length
      indexSegments.push({
        segmentId: `seg_${String(i + 1).padStart(3, '0')}`,
        text: segments[i] || '',
        audioFile: null,
        fileSize: 0,
        generatedAt: null,
        error: null
      })
    }

    // 检查已存在的有效音频文件
    for (let i = 0; i < totalSegments; i++) {
      const segmentId = `seg_${String(i + 1).padStart(3, '0')}`
      const targetPath = path.join(audioDir, `${segmentId}.mp3`)
      
      // 如果索引中标记为有音频且文件存在，跳过
      if (indexSegments[i].audioFile) {
        try {
          const stats = await fs.stat(targetPath)
          if (stats.size > 0 && !indexSegments[i].error) {
            log('info', `音频文件已存在，跳过生成 ${i + 1}/${totalSegments}`, { segmentId, fileSize: stats.size })
            continue
          }
        } catch (error) {
          // 文件不存在，需要重新生成
          indexSegments[i].audioFile = null
        }
      }
    }

    // 获取所有有效Cookie
    // 确保cookieManager已初始化
    if (!cookieManager.initialized) {
      await cookieManager.initialize()
    }
    const allCookies = cookieManager.getCookies()
    const validCookies = allCookies.filter(c =>
      c.status?.isValid && !c.status?.isDisabled
    )
    
    if (validCookies.length === 0) {
      throw new Error('没有可用的Cookie，请先配置Cookie')
    }

    log('info', '使用并行处理模式', {
      cookieCount: validCookies.length,
      segmentCount: totalSegments
    })

    // 过滤出需要处理的段落（未生成或之前有错误的）
    const pendingSegments = []
    for (let i = 0; i < totalSegments; i++) {
      // 跳过已有有效音频的段落
      if (indexSegments[i].audioFile && !indexSegments[i].error) {
        continue
      }
      
      // 清除之前的错误状态
      if (indexSegments[i].error) {
        indexSegments[i].error = null
        indexSegments[i].generatedAt = null
      }
      
      pendingSegments.push({
        index: i,
        text: segments[i],
        segmentId: `seg_${String(i + 1).padStart(3, '0')}`
      })
    }

    // 如果没有需要处理的段落，检查是否需要保存索引
    if (pendingSegments.length === 0) {
      log('info', '所有音频文件已存在，无需处理')

      // 扫描实际存在的音频文件并同步到索引
      await this.syncAudioFilesToIndex(audioDir, indexSegments)

      const completedSegments = indexSegments.filter(s => s.audioFile && s.fileSize > 0).length

      // 检查索引文件是否实际存在
      const chapterDir = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr)
      const indexPath = path.join(chapterDir, 'index.json')
      let indexFileExists = false
      try {
        await fs.access(indexPath)
        indexFileExists = true
      } catch {
        indexFileExists = false
      }

      // 如果没有现有索引或索引文件不存在，需要创建/重新创建索引
      if (!existingIndex || !indexFileExists) {
        log('info', indexFileExists ? '没有现有索引数据，创建新索引' : '索引文件不存在，重新创建索引', { bookId, chapterId, safeBookId, chapterIdStr, completedSegments, indexFileExists })
        try {
          await this.saveProgressiveIndex(safeBookId, chapterIdStr, segments, indexSegments, {
            bookName,
            chapterTitle,
            voiceId,
            content
          }, bookId, chapterId)
          log('info', '索引创建成功', { safeBookId, chapterIdStr, completedSegments })
        } catch (saveError) {
          log('error', '创建索引失败', { safeBookId, chapterIdStr, error: saveError.message })
        }
      } else {
        // 索引存在且文件也存在，但仍需同步更新以确保一致性
        log('info', '索引已存在，同步更新', { bookId, chapterId, safeBookId, chapterIdStr, completedSegments })
        try {
          await this.saveProgressiveIndex(safeBookId, chapterIdStr, segments, indexSegments, {
            bookName,
            chapterTitle,
            voiceId,
            content
          }, bookId, chapterId)
          log('info', '索引同步更新成功', { safeBookId, chapterIdStr, completedSegments })
        } catch (saveError) {
          log('warn', '索引同步更新失败', { safeBookId, chapterIdStr, error: saveError.message })
        }
      }

      return {
        bookId,
        bookName,
        chapterId,
        chapterTitle,
        voiceId,
        content,
        segments: indexSegments,
        metadata: {
          totalSegments,
          completedSegments,
          totalDuration: 0,
          createdAt: existingIndex?.metadata?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: completedSegments === totalSegments ? 'completed' : 'partial',
          parallelProcessing: true,
          cookieCount: validCookies.length
        }
      }
    }

    // 更新任务总段数
    if (taskId) {
      const task = this.tasks.get(taskId)
      if (task) {
        task.progress.total = totalSegments
        task.progress.current = totalSegments - pendingSegments.length
        await this.saveTask(task)
      }
    }

    try {
      // 使用并行处理管理器的动态处理模式
      // 每个Cookie先分配1-10句，处理完并延迟后，继续分配下一批
      log('info', '使用动态并行处理模式', {
        pendingSegments: pendingSegments.length,
        cookieCount: validCookies.length
      })

      const parallelResults = await parallelPrefetchManager.processDynamic(
        pendingSegments,
        validCookies,
        voiceId,
        taskId,
        audioDir,
        requestDelay        // 批次完成后的延迟（秒）
      )

      // 合并结果到索引
      for (const result of parallelResults) {
        if (result.success) {
          indexSegments[result.index] = {
            segmentId: result.segmentId,
            text: segments[result.index],
            audioFile: `audio/${result.segmentId}.mp3`,
            fileSize: result.fileSize,
            generatedAt: new Date().toISOString(),
            error: null
          }
        } else {
          indexSegments[result.index].error = result.error
          indexSegments[result.index].generatedAt = new Date().toISOString()
        }
      }

      // 保存索引
      log('info', '准备保存索引（处理完成后）', { safeBookId, chapterIdStr, bookId, chapterId, completedCount: indexSegments.filter(s => s.audioFile).length })
      await this.saveProgressiveIndex(safeBookId, chapterIdStr, segments, indexSegments, {
        bookName,
        chapterTitle,
        voiceId,
        content
      }, bookId, chapterId)
      log('info', '索引保存完成（处理完成后）', { safeBookId, chapterIdStr })

      // 处理失败的段落（重试）
      const failedSegments = parallelPrefetchManager.getFailedSegments(parallelResults, pendingSegments)
      if (failedSegments.length > 0) {
        log('info', `有 ${failedSegments.length} 个段落处理失败，尝试重试`, { failedCount: failedSegments.length })

        // 使用相同的动态处理模式重试
        const retryResults = await parallelPrefetchManager.processDynamic(
          failedSegments,
          validCookies,
          voiceId,
          taskId,
          audioDir,
          requestDelay
        )

        // 合并重试结果
        for (const result of retryResults) {
          if (result.success) {
            const failedSeg = failedSegments.find(s => s.index === result.index)
            if (failedSeg) {
              indexSegments[result.index] = {
                segmentId: failedSeg.segmentId,
                text: failedSeg.text,
                audioFile: `audio/${failedSeg.segmentId}.mp3`,
                fileSize: result.fileSize,
                generatedAt: new Date().toISOString(),
                error: null
              }
            }
          }
        }

        // 再次保存索引
        log('info', '准备保存索引（重试后）', { safeBookId, chapterIdStr, completedCount: indexSegments.filter(s => s.audioFile).length })
        await this.saveProgressiveIndex(safeBookId, chapterIdStr, segments, indexSegments, {
          bookName,
          chapterTitle,
          voiceId,
          content
        }, bookId, chapterId)
      }

      // 更新任务进度
      if (taskId) {
        const task = this.tasks.get(taskId)
        if (task) {
          const completedCount = indexSegments.filter(s => s.audioFile).length
          task.progress.current = completedCount
          await this.saveTask(task)
        }
      }

      // 最终索引状态
      const completedSegments = indexSegments.filter(s => s.audioFile).length
      const failedCount = indexSegments.filter(s => s.error).length
      const status = completedSegments === totalSegments ? 'completed' : (completedSegments > 0 ? 'partial' : 'failed')

      log('info', '批量音频生成完成（并行处理模式）', {
        total: totalSegments,
        success: completedSegments,
        failed: failedCount,
        status,
        cookieCount: validCookies.length
      })

      // 返回最终索引
      return {
        bookId,
        bookName,
        chapterId,
        chapterTitle,
        voiceId,
        content,
        segments: indexSegments,
        metadata: {
          totalSegments,
          completedSegments,
          totalDuration: 0,
          createdAt: existingIndex?.metadata?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status,
          parallelProcessing: true,
          cookieCount: validCookies.length
        }
      }
    } catch (error) {
      // 即使发生暂停或其他错误，也要保存当前进度（只要有任何音频已生成或索引段已初始化）
      const completedSegments = indexSegments.filter(s => s.audioFile).length
      if (indexSegments.length > 0) {
        const isPaused = error.message === '任务已暂停'
        log('info', isPaused ? '任务暂停，保存当前进度索引' : '发生错误，保存当前进度索引', { bookId, chapterId, completedSegments, totalSegments: indexSegments.length, error: error.message })
        try {
          await this.saveProgressiveIndex(safeBookId, chapterIdStr, segments, indexSegments, {
            bookName,
            chapterTitle,
            voiceId,
            content
          }, bookId, chapterId)
          log('info', isPaused ? '暂停状态下索引保存成功' : '错误状态下索引保存成功', { safeBookId, chapterIdStr, completedSegments, totalSegments: indexSegments.length })
        } catch (saveError) {
          log('warn', isPaused ? '暂停状态下保存索引失败' : '错误状态下保存索引失败', { bookId, chapterId, error: saveError.message })
        }
      }

      // 重新抛出错误
      throw error
    }
  }

  /**
   * 将AAC文件转换为MP3
   * @param {string} aacPath - AAC文件路径
   * @param {string} mp3Path - MP3输出路径
   * @returns {Promise<boolean>} 是否转换成功
   */
  async convertAacToMp3(aacPath, mp3Path) {
    try {
      // 动态导入ttsService以使用其convertToMp3方法
      const { ttsService } = await import('../ttsService.js')
      await ttsService.convertToMp3(aacPath, mp3Path)
      
      // 验证转换结果
      const stats = await fs.stat(mp3Path)
      if (stats.size > 0) {
        // 转换成功，删除AAC文件
        await fs.unlink(aacPath).catch(() => {})
        log('info', `AAC转MP3成功`, { aacPath, mp3Path, size: stats.size })
        return true
      }
      return false
    } catch (error) {
      log('warn', `AAC转MP3失败`, { aacPath, error: error.message })
      return false
    }
  }

  /**
   * 扫描实际存在的音频文件并同步到索引
   * @param {string} audioDir - 音频文件目录
   * @param {Array<Object>} indexSegments - 索引段数组
   * @returns {Promise<number>} 同步的段落数量
   */
  async syncAudioFilesToIndex(audioDir, indexSegments) {
    let syncedCount = 0
    const audioExtensions = ['.mp3', '.aac', '.wav', '.m4a']

    try {
      // 读取音频目录中的所有文件
      const files = await fs.readdir(audioDir).catch(() => [])
      
      for (let i = 0; i < indexSegments.length; i++) {
        const segment = indexSegments[i]
        const segmentId = segment.segmentId
        
        // 如果索引中已经有有效的MP3文件，跳过
        if (segment.audioFile && segment.audioFile.endsWith('.mp3') && segment.fileSize > 0) {
          continue
        }
        
        // 首先检查是否存在MP3文件
        const mp3FileName = `${segmentId}.mp3`
        const mp3Path = path.join(audioDir, mp3FileName)
        
        try {
          const mp3Stats = await fs.stat(mp3Path)
          if (mp3Stats.size > 0) {
            // 找到有效的MP3文件，更新索引
            indexSegments[i].audioFile = `audio/${mp3FileName}`
            indexSegments[i].fileSize = mp3Stats.size
            indexSegments[i].generatedAt = segment.generatedAt || new Date().toISOString()
            indexSegments[i].error = null
            syncedCount++
            log('debug', `同步MP3文件到索引`, { segmentId, file: mp3FileName, size: mp3Stats.size })
            continue
          }
        } catch (error) {
          // MP3文件不存在，继续检查其他格式
        }
        
        // 检查是否存在AAC文件（未转换完成的临时文件）
        const aacFileName = `${segmentId}.aac`
        const aacPath = path.join(audioDir, aacFileName)
        
        try {
          const aacStats = await fs.stat(aacPath)
          if (aacStats.size > 0) {
            // 找到AAC文件，尝试转换为MP3
            log('info', `发现AAC文件，尝试转换为MP3`, { segmentId, aacPath })
            const convertSuccess = await this.convertAacToMp3(aacPath, mp3Path)
            
            if (convertSuccess) {
              // 转换成功，更新索引
              const mp3Stats = await fs.stat(mp3Path)
              indexSegments[i].audioFile = `audio/${mp3FileName}`
              indexSegments[i].fileSize = mp3Stats.size
              indexSegments[i].generatedAt = segment.generatedAt || new Date().toISOString()
              indexSegments[i].error = null
              syncedCount++
              log('info', `AAC转MP3成功并同步到索引`, { segmentId, size: mp3Stats.size })
            } else {
              // 转换失败，直接使用AAC文件
              indexSegments[i].audioFile = `audio/${aacFileName}`
              indexSegments[i].fileSize = aacStats.size
              indexSegments[i].generatedAt = segment.generatedAt || new Date().toISOString()
              indexSegments[i].error = null
              syncedCount++
              log('warn', `AAC转MP3失败，使用AAC文件`, { segmentId, size: aacStats.size })
            }
            continue
          }
        } catch (error) {
          // AAC文件也不存在，继续检查其他格式
        }
        
        // 查找其他格式的音频文件
        for (const ext of ['.wav', '.m4a']) {
          const audioFileName = `${segmentId}${ext}`
          const audioPath = path.join(audioDir, audioFileName)
          
          try {
            const stats = await fs.stat(audioPath)
            if (stats.size > 0) {
              // 找到有效的音频文件，更新索引
              indexSegments[i].audioFile = `audio/${audioFileName}`
              indexSegments[i].fileSize = stats.size
              indexSegments[i].generatedAt = segment.generatedAt || new Date().toISOString()
              indexSegments[i].error = null
              syncedCount++
              log('debug', `同步音频文件到索引`, { segmentId, file: audioFileName, size: stats.size })
              break
            }
          } catch (error) {
            // 文件不存在，继续检查下一个扩展名
            continue
          }
        }
      }
      
      if (syncedCount > 0) {
        log('info', `索引同步完成`, { syncedCount, totalSegments: indexSegments.length })
      }
    } catch (error) {
      log('warn', `同步音频文件到索引失败`, { error: error.message })
    }
    
    return syncedCount
  }

  /**
   * 保存渐进式索引
   * @param {string} safeBookId - 书籍ID（已转换为安全的目录名/短哈希）
   * @param {string} chapterIdStr - 章节ID（已转换为安全的目录名/短哈希）
   * @param {Array<string>} segments - 文本段落数组
   * @param {Array<Object>} indexSegments - 索引段数组
   * @param {Object} meta - 元数据
   * @param {string} originalBookId - 原始书籍ID（用于存储在index.json中）
   * @param {string} originalChapterId - 原始章节ID（用于存储在index.json中）
   */
  async saveProgressiveIndex(safeBookId, chapterIdStr, segments, indexSegments, meta, originalBookId = null, originalChapterId = null) {
    log('info', '开始保存索引', { safeBookId, chapterIdStr, originalBookId, originalChapterId, segmentCount: segments.length, indexSegmentCount: indexSegments.length })
    const { bookName, chapterTitle, voiceId, content } = meta
    log('info', '索引元数据', { bookName: bookName || '(空)', chapterTitle: chapterTitle || '(空)', originalBookId: originalBookId || '(空)' })
    
    // 在保存前，先扫描实际存在的音频文件并同步到索引
    const audioDir = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr, 'audio')
    await this.syncAudioFilesToIndex(audioDir, indexSegments)
    
    // 注意：safeBookId 和 chapterIdStr 已经是短哈希，不需要再次转换
    const completedSegments = indexSegments.filter(s => s.audioFile && s.fileSize > 0).length
    const totalSegments = segments.length
    const status = completedSegments === totalSegments ? 'completed' : 'paused'

    const index = {
      bookId: originalBookId || safeBookId, // 保存原始bookId，如果没有则使用短哈希
      bookName,
      chapterId: originalChapterId || chapterIdStr, // 保存原始chapterId，如果没有则使用短哈希
      chapterTitle,
      voiceId,
      content,
      segments: indexSegments,
      metadata: {
        totalSegments,
        completedSegments,
        totalDuration: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status
      }
    }

    const chapterDir = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr)
    await fs.mkdir(chapterDir, { recursive: true })

    const indexPath = path.join(chapterDir, 'index.json')
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')

    log('debug', '索引已更新', { bookId: safeBookId, originalBookId, chapterId: chapterIdStr, completedSegments, totalSegments, status })
  }

  /**
   * 加载章节索引
   * @param {string} bookId - 书籍ID
   * @param {string} chapterId - 章节ID
   * @returns {Promise<Object|null>} 索引数据或null
   */
  async loadChapterIndex(bookId, chapterId) {
    try {
      // 确保 chapterId 和 bookId 都使用安全的目录名（短哈希）
      const chapterIdStr = getSafeDirName(chapterId)
      const safeBookId = getSafeDirName(bookId)
      const indexPath = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr, 'index.json')
      const content = await fs.readFile(indexPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      return null
    }
  }

  /**
   * 构建索引文件
   * @param {string} bookId - 书籍ID
   * @param {string} chapterId - 章节ID
   * @param {Array<string>} segments - 文本段落数组
   * @param {Array<Object>} audioFiles - 音频文件信息数组
   * @param {Object} meta - 元数据
   * @returns {Promise<Object>} 索引对象
   */
  async buildIndex(bookId, chapterId, segments, audioFiles, meta) {
    const { bookName, chapterTitle, voiceId, content } = meta

    const indexSegments = segments.map((text, i) => {
      const audioInfo = audioFiles[i] || {}
      return {
        segmentId: `seg_${String(i + 1).padStart(3, '0')}`,
        text,
        audioFile: audioInfo.audioFile || null,
        fileSize: audioInfo.fileSize || 0,
        generatedAt: audioInfo.generatedAt || null,
        error: audioInfo.error || null
      }
    })

    const completedSegments = indexSegments.filter(s => s.audioFile).length
    const totalSegments = segments.length

    const index = {
      bookId,
      bookName,
      chapterId,
      chapterTitle,
      voiceId,
      content,
      segments: indexSegments,
      metadata: {
        totalSegments,
        completedSegments,
        totalDuration: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: completedSegments === totalSegments ? 'completed' : 'paused'
      }
    }

    // 确保 chapterId 和 bookId 都使用安全的目录名（短哈希）
    const chapterIdStr = getSafeDirName(chapterId)
    const safeBookId = getSafeDirName(bookId)
    const chapterDir = path.join(this.baseDir, 'books', safeBookId, 'chapters', chapterIdStr)
    await fs.mkdir(chapterDir, { recursive: true })

    const indexPath = path.join(chapterDir, 'index.json')
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')

    log('info', '索引文件已创建', { bookId: safeBookId, chapterId: chapterIdStr, completedSegments, totalSegments })
    return index
  }

  /**
   * 创建任务
   * @param {Object} taskConfig - 任务配置
   * @returns {Promise<Object>} 任务对象
   */
  async createTask(taskConfig) {
    await this.initialize()

    // 使用外部传入的 taskId 或生成新的
    const taskId = taskConfig.taskId || `task_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const task = {
      taskId,
      ...taskConfig,
      status: taskConfig.status || 'pending',
      progress: taskConfig.progress || {
        current: 0,
        total: taskConfig.chapters?.length || 0,
        completed: [],
        failed: []
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    this.tasks.set(taskId, task)
    await this.saveTask(task)

    log('info', '任务已创建', { taskId, total: task.progress.total, status: task.status })
    return task
  }

  /**
   * 更新任务状态
   * @param {string} taskId - 任务ID
   * @param {string} status - 新状态
   * @param {Object} progress - 进度信息
   */
  async updateTaskStatus(taskId, status, progress = null) {
    const task = this.tasks.get(taskId)
    if (!task) {
      log('warn', '任务不存在，无法更新状态', { taskId })
      return
    }

    task.status = status
    task.updatedAt = new Date().toISOString()
    if (progress) {
      task.progress = { ...task.progress, ...progress }
    }
    await this.saveTask(task)

    log('info', '任务状态已更新', { taskId, status })
  }

  /**
   * 暂停任务
   * 智能暂停：等待当前正在接收的音频完成后再暂停
   * @param {string} taskId - 任务ID
   */
  async pauseTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    // 首先调用并行处理管理器的停止方法（暂停模式，不立即取消，等待当前批次完成）
    log('info', '正在停止并行处理', { taskId })
    parallelPrefetchManager.stop(false) // false 表示暂停模式，允许当前批次完成

    // 检查是否正在处理段落
    let processingInfo = this.processingSegments.get(taskId)
    if (processingInfo && processingInfo.isProcessing) {
      log('info', '任务正在处理段落，等待当前音频接收完成后再暂停', {
        taskId,
        currentSegment: processingInfo.currentSegment
      })

      // 标记任务需要暂停（处理循环会检查这个标志）
      task.pendingPause = true
      await this.saveTask(task)

      // 等待当前处理完成（最多等待30秒，减少等待时间）
      const startTime = Date.now()
      const maxWaitTime = 30000 // 30秒超时保护
      while (true) {
        processingInfo = this.processingSegments.get(taskId)
        if (!processingInfo || !processingInfo.isProcessing) {
          break
        }
        // 超时检查
        if (Date.now() - startTime > maxWaitTime) {
          log('warn', '等待处理完成超时，强制暂停', { taskId, waitedTime: Date.now() - startTime })
          break
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // 清除暂停标记
      delete task.pendingPause
    }

    task.status = 'paused'
    task.updatedAt = new Date().toISOString()
    await this.saveTask(task)

    // 从正在处理的任务列表中移除，以便后续可以恢复
    this.processingTasks.delete(taskId)

    log('info', '任务已暂停', { taskId })
  }

  /**
   * 恢复任务
   * @param {string} taskId - 任务ID
   */
  async resumeTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    // 更新任务状态为处理中，并清除暂停标志
    task.status = 'processing'
    task.pendingPause = false
    task.updatedAt = new Date().toISOString()
    await this.saveTask(task)

    log('info', '任务已恢复', { taskId })

    // 重新启动批量处理（只处理pending状态的章节）
    // 使用异步执行，不等待完成，让API立即返回
    // TTS调用禁止并发，强制单线程处理
    this.startBatchProcessing(taskId).catch(error => {
      logError(error, { stage: '恢复任务后处理', taskId })
    })
  }

  /**
   * 取消任务
   * @param {string} taskId - 任务ID
   * @param {boolean} deleteTaskRecord - 是否删除任务记录（默认true，保留已预制内容）
   */
  async cancelTask(taskId, deleteTaskRecord = true) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    // 如果任务已经完成或失败，直接返回成功
    if (['completed', 'failed', 'paused'].includes(task.status)) {
      log('info', `任务状态为 ${task.status}，无需取消`, { taskId })
      return { alreadyFinished: true, status: task.status }
    }

    // 首先调用并行处理管理器的停止方法（使用立即取消模式）
    log('info', '正在停止并行处理（立即取消模式）', { taskId })
    parallelPrefetchManager.stop(true) // true 表示立即取消，跳过批次间延迟

    // 标记任务为暂停状态（保留已预制内容）
    task.status = 'paused'
    task.updatedAt = new Date().toISOString()
    await this.saveTask(task)

    log('info', '任务已标记为暂停，等待处理停止', { taskId })

    // 等待一小段时间让处理循环检测到取消状态
    await new Promise(resolve => setTimeout(resolve, 500))

    // 延迟删除任务记录，让处理循环有时间检测到取消状态并退出
    if (deleteTaskRecord) {
      setTimeout(async () => {
        try {
          // 从内存中删除任务
          this.tasks.delete(taskId)

          // 从文件系统中删除任务文件
          const taskPath = path.join(this.tasksDir, `${taskId}.json`)
          await fs.unlink(taskPath).catch(() => {})

          log('info', '任务记录已删除，已预制内容已保留', { taskId })
        } catch (error) {
          log('warn', '删除任务记录失败', { taskId, error: error.message })
        }
      }, 2000) // 延迟2秒，确保处理循环已检测到取消状态
    }

    return { success: true, deleted: deleteTaskRecord }
  }

  /**
   * 重试失败的任务
   * @param {string} taskId - 任务ID
   * @param {string} chapterId - 章节ID（可选，如果不指定则重试所有失败的章节）
   * @returns {Promise<boolean>} 是否成功
   */
  async retryTask(taskId, chapterId = null) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    log('info', '开始重试任务', { taskId, chapterId })

    // 确定要重试的章节
    let chaptersToRetry
    if (chapterId) {
      const chapter = task.chapters.find(c => c.chapterId === chapterId)
      if (!chapter) {
        throw new Error(`章节不存在: ${chapterId}`)
      }
      if (chapter.status !== 'failed') {
        throw new Error(`章节状态不是失败，无法重试: ${chapter.status}`)
      }
      chaptersToRetry = [chapter]
    } else {
      chaptersToRetry = task.chapters.filter(c => c.status === 'failed')
    }

    if (chaptersToRetry.length === 0) {
      log('info', '没有需要重试的章节', { taskId })
      return false
    }

    // 更新任务状态
    task.status = 'processing'
    task.updatedAt = new Date().toISOString()
    await this.saveTask(task)

    // 重试每个失败的章节
    for (const chapter of chaptersToRetry) {
      try {
        const chapterInfo = {
          chapterId: chapter.chapterId,
          chapterTitle: chapter.chapterTitle,
          chapterUrl: task.bookInfo.bookUrl,
          chapterIndex: chapter.chapterIndex
        }

        await this.processChapter(task.bookInfo, chapterInfo, {
          ...task.options,
          forceRegenerate: true
        }, taskId)

        log('info', '章节重试成功', { taskId, chapterId: chapter.chapterId })
      } catch (error) {
        logError(error, { stage: '重试章节', taskId, chapterId: chapter.chapterId })
      }
    }

    // 更新最终任务状态
    this.updateTaskProgress(taskId)
    await this.saveTask(task)

    return true
  }

  /**
   * 获取任务状态
   * @param {string} taskId - 任务ID
   * @returns {Object|null} 任务对象或null
   */
  getTaskStatus(taskId) {
    return this.tasks.get(taskId) || null
  }

  /**
   * 删除任务
   * @param {string} taskId - 任务ID
   * @returns {Promise<boolean>} 是否成功删除
   */
  async deleteTask(taskId) {
    await this.initialize()

    const task = this.tasks.get(taskId)
    if (!task) {
      log('warn', '任务不存在，无法删除', { taskId })
      return false
    }

    try {
      // 从内存中删除
      this.tasks.delete(taskId)

      // 从文件系统中删除
      const taskPath = path.join(this.tasksDir, `${taskId}.json`)
      await fs.unlink(taskPath).catch(() => {})

      log('info', '任务已删除', { taskId })
      return true
    } catch (error) {
      log('error', '删除任务失败', { taskId, error: error.message })
      return false
    }
  }

  /**
   * 根据书籍ID删除所有相关任务
   * @param {string} bookId - 书籍ID
   * @returns {Promise<number>} 删除的任务数量
   */
  async deleteTasksByBookId(bookId) {
    await this.initialize()

    const tasksToDelete = []
    for (const [taskId, task] of this.tasks.entries()) {
      const taskBookId = task.bookInfo?.bookId || task.bookInfo?.bookUrl
      if (taskBookId === bookId) {
        tasksToDelete.push(taskId)
      }
    }

    let deletedCount = 0
    for (const taskId of tasksToDelete) {
      const success = await this.deleteTask(taskId)
      if (success) {
        deletedCount++
      }
    }

    log('info', '已删除书籍相关任务', { bookId, deletedCount })
    return deletedCount
  }

  /**
   * 获取所有任务
   * @returns {Array<Object>} 任务数组
   */
  async getAllTasks() {
    await this.initialize()
    return Array.from(this.tasks.values()).map(task => ({
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      bookInfo: task.bookInfo,
      chapterInfo: task.chapterInfo,
      chaptersInfo: task.chaptersInfo,
      chapters: task.chapters?.map(c => ({
        chapterId: c.chapterId,
        chapterTitle: c.chapterTitle,
        chapterIndex: c.chapterIndex,
        status: c.status,
        completedSegments: c.completedSegments,
        totalSegments: c.totalSegments,
        error: c.error
      })),
      options: task.options,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }))
  }

  /**
   * 清空所有任务
   * @returns {Promise<number>} 删除的任务数量
   */
  async clearAllTasks() {
    await this.initialize()

    const taskCount = this.tasks.size
    if (taskCount === 0) {
      return 0
    }

    try {
      // 1. 清空内存中的任务
      this.tasks.clear()

      // 2. 清空文件系统中的任务文件
      const files = await fs.readdir(this.tasksDir)
      let deletedCount = 0
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const taskPath = path.join(this.tasksDir, file)
            await fs.unlink(taskPath)
            deletedCount++
          } catch (e) {
            log('warn', '删除任务文件失败', { file, error: e.message })
          }
        }
      }

      // 3. 清空正在处理的任务
      this.processingTasks.clear()

      log('info', '已清空所有任务', { taskCount, deletedCount })
      return deletedCount
    } catch (error) {
      log('error', '清空所有任务失败', { error: error.message })
      throw error
    }
  }

  /**
   * 保存任务
   * @param {Object} task - 任务对象
   */
  async saveTask(task) {
    const taskPath = path.join(this.tasksDir, `${task.taskId}.json`)
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2), 'utf-8')
  }
}

// 导出单例实例
export const prefetchService = new PrefetchService()