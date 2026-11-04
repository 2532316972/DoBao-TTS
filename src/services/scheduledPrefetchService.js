import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { getDataPath } from '../utils/pathUtils.js'
import { log, logError } from '../utils/logger.js'
import { prefetchService } from './prefetch/prefetchService.js'
import { bookCacheService } from './prefetch/bookCacheService.js'

/**
 * 定时预制调度服务
 * 负责按固定时间间隔自动启动预制任务
 */
class ScheduledPrefetchService {
  constructor() {
    this.baseDir = getDataPath('scheduled-prefetch')
    this.configFile = path.join(this.baseDir, 'config.json')
    this.progressFile = path.join(this.baseDir, 'progress.json')
    this.tasks = new Map()
    this.progress = new Map()
    this.initialized = false
    this.checkInterval = null
    this.checkIntervalMs = 60 * 1000 // 每分钟检查一次
  }

  /**
   * 初始化服务
   */
  async initialize() {
    if (this.initialized) return

    try {
      await fs.mkdir(this.baseDir, { recursive: true })
      await this.loadConfig()
      await this.loadProgress()
      // 修复可能卡住的任务
      await this.fixStuckTasks()
      this.startChecker()
      this.initialized = true
      log('info', '定时预制服务初始化完成', { taskCount: this.tasks.size })
    } catch (error) {
      logError(error, { stage: '定时预制服务初始化' })
      throw error
    }
  }

  /**
   * 修复卡住的任务
   * 检查 currentPrefetchTaskId 是否存在但对应的预制任务已不存在的情况
   */
  async fixStuckTasks() {
    let fixedCount = 0
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.currentPrefetchTaskId) {
        // 检查对应的预制任务是否还存在
        const prefetchTaskStatus = prefetchService.getTaskStatus(task.currentPrefetchTaskId)
        if (!prefetchTaskStatus) {
          // 预制任务已不存在，清除 currentPrefetchTaskId
          log('warn', '修复卡住的任务：预制任务已不存在', { taskId, prefetchTaskId: task.currentPrefetchTaskId })
          task.currentPrefetchTaskId = null
          if (!task.nextRunAt) {
            task.nextRunAt = this.calculateNextRunTime(task.intervalHours)
          }
          fixedCount++
        } else if (['completed', 'failed', 'paused'].includes(prefetchTaskStatus.status)) {
          // 预制任务已完成/失败/暂停，但 currentPrefetchTaskId 未清除
          log('warn', '修复卡住的任务：预制任务已结束但状态未更新', {
            taskId,
            prefetchTaskId: task.currentPrefetchTaskId,
            status: prefetchTaskStatus.status
          })
          task.currentPrefetchTaskId = null
          if (!task.nextRunAt) {
            task.nextRunAt = this.calculateNextRunTime(task.intervalHours)
          }
          fixedCount++
        }
      }
    }

    if (fixedCount > 0) {
      await this.saveConfig()
      log('info', `已修复 ${fixedCount} 个卡住的任务`)
    }
  }

  /**
   * 生成任务ID
   */
  generateTaskId() {
    return 'sched_' + crypto.randomBytes(8).toString('hex')
  }

  /**
   * 加载配置
   */
  async loadConfig() {
    try {
      const content = await fs.readFile(this.configFile, 'utf-8')
      const config = JSON.parse(content)
      if (config.tasks && Array.isArray(config.tasks)) {
        config.tasks.forEach(task => {
          this.tasks.set(task.taskId, task)
        })
      }
      log('debug', '定时预制配置已加载', { taskCount: this.tasks.size })
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logError(error, { stage: '加载定时预制配置' })
      }
      this.tasks = new Map()
    }
  }

  /**
   * 保存配置
   */
  async saveConfig() {
    try {
      const config = {
        tasks: Array.from(this.tasks.values()),
        updatedAt: new Date().toISOString()
      }
      await fs.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8')
      log('debug', '定时预制配置已保存', { taskCount: this.tasks.size })
    } catch (error) {
      logError(error, { stage: '保存定时预制配置' })
      throw error
    }
  }

  /**
   * 加载进度
   */
  async loadProgress() {
    try {
      const content = await fs.readFile(this.progressFile, 'utf-8')
      const data = JSON.parse(content)
      if (data.progress && typeof data.progress === 'object') {
        Object.entries(data.progress).forEach(([bookId, progress]) => {
          this.progress.set(bookId, progress)
        })
      }
      log('debug', '定时预制进度已加载', { progressCount: this.progress.size })
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logError(error, { stage: '加载定时预制进度' })
      }
      this.progress = new Map()
    }
  }

  /**
   * 保存进度
   */
  async saveProgress() {
    try {
      const data = {
        progress: Object.fromEntries(this.progress),
        updatedAt: new Date().toISOString()
      }
      await fs.writeFile(this.progressFile, JSON.stringify(data, null, 2), 'utf-8')
      log('debug', '定时预制进度已保存', { progressCount: this.progress.size })
    } catch (error) {
      logError(error, { stage: '保存定时预制进度' })
      throw error
    }
  }

  /**
   * 启动定时检查器
   */
  startChecker() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }

    this.checkInterval = setInterval(() => {
      this.checkDueTasks()
    }, this.checkIntervalMs)

    log('info', '定时预制检查器已启动', { intervalMs: this.checkIntervalMs })
  }

  /**
   * 停止定时检查器
   */
  stopChecker() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      log('info', '定时预制检查器已停止')
    }
  }

  /**
   * 检查到期的任务
   * 限制：同一时间只能有一个定时任务在执行
   */
  async checkDueTasks() {
    const now = new Date()

    // 检查是否已有正在运行的定时任务（全局限制，一次只能运行一个）
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.currentPrefetchTaskId) {
        log('debug', '已有定时任务正在运行，跳过本次检查', { runningTaskId: taskId, bookId: task.bookId })
        return
      }
    }

    for (const [taskId, task] of this.tasks.entries()) {
      if (!task.enabled) continue
      if (!task.nextRunAt) {
        // 如果nextRunAt为null但有currentPrefetchTaskId，说明任务正在进行中
        if (task.currentPrefetchTaskId) {
          log('debug', '定时任务正在进行中，等待完成', { taskId, bookId: task.bookId })
        }
        continue
      }

      const nextRun = new Date(task.nextRunAt)
      if (nextRun > now) continue

      // 检查该定时任务是否已有正在运行的预制任务
      if (task.currentPrefetchTaskId) {
        log('debug', '定时任务已有正在运行的预制任务，跳过本次触发', { taskId, bookId: task.bookId })
        continue
      }

      // 检查该书籍是否已有其他正在进行的预制任务
      const hasRunningTask = await this.hasRunningPrefetchTask(task.bookId)
      if (hasRunningTask) {
        log('debug', '书籍有正在进行的预制任务，跳过本次定时触发', { taskId, bookId: task.bookId })
        // 推迟下次执行时间
        task.nextRunAt = this.calculateNextRunTime(task.intervalHours)
        await this.saveConfig()
        continue
      }

      log('info', '定时任务到期，开始触发', { taskId, bookId: task.bookId })

      try {
        await this.triggerTask(task)
        // 触发一个任务后立即返回，等待下次检查周期再触发其他任务
        // 这样可以确保同一时间只有一个定时任务在执行
        return
      } catch (error) {
        logError(error, { stage: '触发定时任务', taskId })
      }
    }
  }

  /**
   * 检查某书籍是否有正在进行的预制任务
   */
  async hasRunningPrefetchTask(bookId) {
    await prefetchService.initialize()

    for (const [taskId, task] of prefetchService.processingTasks.entries()) {
      if (task.bookInfo && task.bookInfo.bookId === bookId) {
        return true
      }
    }

    return false
  }

  /**
   * 触发定时任务
   */
  async triggerTask(task) {
    const { bookId, bookUrl, bookName, voiceId, speed, chaptersPerRun } = task

    // 获取进度
    let progress = this.progress.get(bookId)
    if (!progress) {
      progress = {
        bookId,
        lastChapterIndex: -1,
        totalPrefetched: 0,
        totalChapters: 0,
        lastRunAt: null,
        status: 'running'
      }
    }

    // 获取书籍总章节数
    let totalChapters = progress.totalChapters
    if (!totalChapters) {
      try {
        await bookCacheService.initialize()
        const chapterList = await bookCacheService.getChapterListFromFiles(bookId)
        totalChapters = chapterList.length
        progress.totalChapters = totalChapters
      } catch (error) {
        log('warn', '无法获取书籍章节列表', { bookId, error: error.message })
        totalChapters = 0
      }
    }

    // 计算本次要预制的章节范围
    const startIndex = progress.lastChapterIndex + 1
    const endIndex = Math.min(startIndex + chaptersPerRun - 1, totalChapters - 1)

    // 检查是否已完成
    if (startIndex >= totalChapters) {
      log('info', '书籍所有章节已预制完成，停止定时任务', { taskId: task.taskId, bookId })
      progress.status = 'completed'
      task.enabled = false
      await this.saveProgress()
      await this.saveConfig()
      return
    }

    log('info', '开始定时预制', {
      taskId: task.taskId,
      bookId,
      startIndex,
      endIndex,
      totalChapters
    })

    // 获取章节列表
    const bookInfo = { bookId, bookName, bookUrl }
    const chaptersInfo = await prefetchService.getChaptersInRange(bookInfo, startIndex, endIndex)

    if (!chaptersInfo || chaptersInfo.length === 0) {
      log('warn', '无法获取章节列表，跳过本次预制', { bookId, startIndex, endIndex })
      // 推迟下次执行
      task.nextRunAt = this.calculateNextRunTime(task.intervalHours)
      await this.saveConfig()
      return
    }

    // 启动批量预制
    const options = {
      voiceId,
      speed: speed || 0,
      requestDelay: 15
    }

    const prefetchTask = await prefetchService.batchProcessChapters(bookInfo, chaptersInfo, options)

    // 保存当前运行的预制任务ID，以便后续可以取消
    task.currentPrefetchTaskId = prefetchTask.taskId

    // 更新进度
    progress.lastChapterIndex = endIndex
    progress.totalPrefetched += chaptersInfo.length
    progress.lastRunAt = new Date().toISOString()
    progress.status = 'running'
    this.progress.set(bookId, progress)
    await this.saveProgress()

    // 注意：下次执行时间在预制任务完成后才设置，而不是现在
    // 这样可以确保"每n小时启动一次，预制完成后等待n小时再启动"
    task.nextRunAt = null // 临时设为null，防止重复触发
    await this.saveConfig()

    log('info', '定时预制任务已启动，将在预制完成后设置下次执行时间', {
      taskId: task.taskId,
      prefetchTaskId: prefetchTask.taskId,
      bookId,
      chaptersCount: chaptersInfo.length
    })

    // 等待预制任务完成，然后设置下次执行时间
    this.waitForPrefetchTaskCompletion(task, prefetchTask.taskId).catch(error => {
      log('error', '等待预制任务完成时发生未捕获的错误', { taskId: task.taskId, prefetchTaskId: prefetchTask.taskId, error: error.message })
      // 确保即使出错也能清除 currentPrefetchTaskId
      if (this.tasks.has(task.taskId)) {
        task.currentPrefetchTaskId = null
        task.nextRunAt = this.calculateNextRunTime(task.intervalHours)
        this.saveConfig().catch(() => {})
      }
    })
  }

  /**
   * 等待预制任务完成
   */
  async waitForPrefetchTaskCompletion(scheduledTask, prefetchTaskId) {
    try {
      // 轮询检查预制任务状态
      const maxWaitTime = 60 * 60 * 1000 // 最大等待1小时
      const checkInterval = 5000 // 每5秒检查一次
      let waitedTime = 0

      while (waitedTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval))
        waitedTime += checkInterval

        // 检查定时任务是否还存在（可能已被删除）
        if (!this.tasks.has(scheduledTask.taskId)) {
          log('info', '定时任务已被删除，停止等待预制任务完成', { taskId: scheduledTask.taskId, prefetchTaskId })
          return
        }

        // 检查预制任务状态
        const prefetchTaskStatus = prefetchService.getTaskStatus(prefetchTaskId)
        if (!prefetchTaskStatus) {
          log('info', '预制任务记录已删除', { taskId: scheduledTask.taskId, prefetchTaskId })
          break
        }

        // 如果预制任务已完成、失败或暂停，则停止等待
        if (['completed', 'failed', 'paused'].includes(prefetchTaskStatus.status)) {
          log('info', '预制任务已结束', {
            taskId: scheduledTask.taskId,
            prefetchTaskId,
            status: prefetchTaskStatus.status
          })
          break
        }
      }

      // 预制任务已完成，设置下次执行时间
      if (this.tasks.has(scheduledTask.taskId)) {
        scheduledTask.currentPrefetchTaskId = null
        // 从当前时间开始计算下次执行时间（预制完成后等待n小时）
        scheduledTask.nextRunAt = this.calculateNextRunTime(scheduledTask.intervalHours)
        await this.saveConfig()
        log('info', '预制任务已完成，已设置下次执行时间', {
          taskId: scheduledTask.taskId,
          prefetchTaskId,
          nextRunAt: scheduledTask.nextRunAt
        })
      }
    } catch (error) {
      log('warn', '等待预制任务完成时出错', { taskId: scheduledTask.taskId, prefetchTaskId, error: error.message })
      // 即使出错也要设置下次执行时间，避免任务卡住
      if (this.tasks.has(scheduledTask.taskId)) {
        scheduledTask.currentPrefetchTaskId = null
        scheduledTask.nextRunAt = this.calculateNextRunTime(scheduledTask.intervalHours)
        await this.saveConfig().catch(() => {})
      }
    }
  }

  /**
   * 计算下次执行时间
   */
  calculateNextRunTime(intervalHours) {
    const now = new Date()
    return new Date(now.getTime() + intervalHours * 60 * 60 * 1000).toISOString()
  }

  /**
   * 创建定时任务
   */
  async createTask(config) {
    log('info', '[定时预制Service] createTask开始', config)
    await this.initialize()

    const { bookId, bookUrl, bookName, voiceId, speed, intervalHours, chaptersPerRun } = config

    log('info', '[定时预制Service] 解构参数', { bookId, voiceId, intervalHours, chaptersPerRun })

    if (!bookId || !voiceId || !intervalHours || !chaptersPerRun) {
      log('warn', '[定时预制Service] 参数校验失败', { bookId, voiceId, intervalHours, chaptersPerRun })
      throw new Error('缺少必需参数：bookId、voiceId、intervalHours、chaptersPerRun')
    }

    // 检查是否已存在相同书籍的任务，如果存在则更新配置而不是报错
    log('info', '[定时预制Service] 检查已有任务', { bookId, existingCount: this.tasks.size })
    for (const [existingId, existingTask] of this.tasks.entries()) {
      log('info', '[定时预制Service] 遍历任务', { existingId, existingBookId: existingTask.bookId })
      if (existingTask.bookId === bookId) {
        log('info', '[定时预制Service] 找到已有任务，执行更新', { existingId, bookId })
        // 更新现有任务的配置
        existingTask.intervalHours = intervalHours
        existingTask.chaptersPerRun = chaptersPerRun
        existingTask.voiceId = voiceId
        existingTask.speed = speed || 0
        existingTask.enabled = true
        // 更新配置后立即执行（设置为当前时间），完成后才等待间隔时间
        existingTask.nextRunAt = new Date().toISOString()
        await this.saveConfig()
        log('info', '[定时预制Service] 任务已更新并保存', { taskId: existingId, bookId, intervalHours, nextRunAt: existingTask.nextRunAt })

        // 立即触发检查，如果任务已到期则立即执行
        setImmediate(() => {
          this.checkDueTasks().catch(error => {
            log('warn', '更新任务后立即检查失败', { taskId: existingId, error: error.message })
          })
        })

        return existingTask
      }
    }

    log('info', '[定时预制Service] 未找到已有任务，创建新任务', { bookId })
    const taskId = this.generateTaskId()
    const now = new Date()
    const task = {
      taskId,
      bookId,
      bookUrl: bookUrl || '',
      bookName: bookName || '',
      voiceId,
      speed: speed || 0,
      intervalHours,
      chaptersPerRun,
      enabled: true,
      createdAt: now.toISOString(),
      // 首次执行立即开始（设置为当前时间），完成后才等待间隔时间
      nextRunAt: now.toISOString()
    }

    this.tasks.set(taskId, task)
    log('info', '[定时预制Service] 新任务已加入内存Map', { taskId, bookId })
    await this.saveConfig()
    log('info', '[定时预制Service] 配置已保存', { taskId, bookId })

    // 初始化进度记录
    if (!this.progress.has(bookId)) {
      let totalChapters = 0
      try {
        await bookCacheService.initialize()
        const chapterList = await bookCacheService.getChapterListFromFiles(bookId)
        totalChapters = chapterList.length
      } catch (error) {
        log('warn', '[定时预制Service] 创建任务时无法获取章节数', { bookId, error: error.message })
      }

      this.progress.set(bookId, {
        bookId,
        lastChapterIndex: -1,
        totalPrefetched: 0,
        totalChapters,
        lastRunAt: null,
        status: 'running'
      })
      await this.saveProgress()
    }

    log('info', '定时预制任务已创建', { taskId, bookId, intervalHours, chaptersPerRun, nextRunAt: task.nextRunAt })

    // 立即触发检查，如果任务已到期则立即执行
    setImmediate(() => {
      this.checkDueTasks().catch(error => {
        log('warn', '创建任务后立即检查失败', { taskId, error: error.message })
      })
    })

    return task
  }

  /**
   * 获取任务列表
   */
  async getTasks() {
    await this.initialize()
    // 注意：不要重新加载配置，以免覆盖内存中的更改（如 currentPrefetchTaskId）
    // 配置会在修改时自动保存，内存中的数据是最新的

    const tasks = Array.from(this.tasks.values()).map(task => {
      const progress = this.progress.get(task.bookId)
      return {
        ...task,
        progress: progress || null
      }
    })

    return tasks
  }

  /**
   * 暂停所有任务
   * 用于服务器关闭时优雅停止
   */
  async pauseAllTasks() {
    await this.initialize()

    let pausedCount = 0
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.enabled) {
        task.enabled = false
        pausedCount++
        log('info', '定时预制任务已自动暂停', { taskId, bookId: task.bookId })
      }
    }

    if (pausedCount > 0) {
      await this.saveConfig()
      log('info', `已暂停 ${pausedCount} 个定时预制任务`)
    }

    return pausedCount
  }

  /**
   * 切换任务启用状态
   */
  async toggleTask(taskId, enabled) {
    await this.initialize()

    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('任务不存在')
    }

    task.enabled = enabled
    if (enabled) {
      // 启用任务时立即执行（设置为当前时间），完成后才等待间隔时间
      // 注意：这里总是重置 nextRunAt，确保任务可以立即执行
      task.nextRunAt = new Date().toISOString()
    }
    await this.saveConfig()

    log('info', '定时预制任务状态已更新', { taskId, enabled, nextRunAt: task.nextRunAt })

    // 如果启用了任务且已到期，立即触发该任务
    if (enabled && task.nextRunAt) {
      const now = new Date()
      const nextRun = new Date(task.nextRunAt)
      if (nextRun <= now) {
        setImmediate(async () => {
          try {
            // 检查该任务是否已有正在运行的预制任务
            if (task.currentPrefetchTaskId) {
              log('debug', '该定时任务已有正在运行的预制任务，跳过触发', { taskId })
              return
            }

            // 检查该书籍是否已有其他正在进行的预制任务
            const hasRunningTask = await this.hasRunningPrefetchTask(task.bookId)
            if (hasRunningTask) {
              log('debug', '书籍有正在进行的预制任务，跳过本次定时触发', { taskId, bookId: task.bookId })
              // 推迟下次执行时间
              task.nextRunAt = this.calculateNextRunTime(task.intervalHours)
              await this.saveConfig()
              return
            }

            log('info', '启用任务后立即触发', { taskId, bookId: task.bookId })
            await this.triggerTask(task)
          } catch (error) {
            log('warn', '启用任务后立即触发失败', { taskId, error: error.message })
          }
        })
      }
    }

    return task
  }

  /**
   * 更新任务配置
   * @param {string} taskId - 任务ID
   * @param {Object} config - 配置对象
   * @param {number} config.intervalMinutes - 间隔分钟数
   * @param {number} config.chaptersPerRun - 每次预制章节数
   */
  async updateTaskConfig(taskId, config) {
    await this.initialize()

    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('任务不存在')
    }

    const { intervalMinutes, chaptersPerRun } = config

    // 验证参数
    if (intervalMinutes !== undefined) {
      if (intervalMinutes < 1 || intervalMinutes > 1440) {
        throw new Error('间隔时间必须在1分钟到24小时之间')
      }
      task.intervalHours = intervalMinutes / 60
    }

    if (chaptersPerRun !== undefined) {
      if (chaptersPerRun < 1) {
        throw new Error('每次预制章节数必须大于等于1')
      }
      task.chaptersPerRun = chaptersPerRun
    }

    await this.saveConfig()

    log('info', '定时预制任务配置已更新', {
      taskId,
      intervalHours: task.intervalHours,
      chaptersPerRun: task.chaptersPerRun
    })

    return task
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId) {
    await this.initialize()

    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('任务不存在')
    }

    // 如果有正在运行的预制任务，先取消它
    if (task.currentPrefetchTaskId) {
      try {
        await prefetchService.cancelTask(task.currentPrefetchTaskId, false)
        log('info', '已取消关联的预制任务', { taskId, prefetchTaskId: task.currentPrefetchTaskId })
      } catch (error) {
        log('warn', '取消预制任务失败', { taskId, prefetchTaskId: task.currentPrefetchTaskId, error: error.message })
      }
    }

    this.tasks.delete(taskId)
    await this.saveConfig()

    log('info', '定时预制任务已删除', { taskId })
    return true
  }

  /**
   * 获取某书籍的进度
   */
  async getProgress(bookId) {
    await this.initialize()
    return this.progress.get(bookId) || null
  }
}

// 导出单例
export const scheduledPrefetchService = new ScheduledPrefetchService()
