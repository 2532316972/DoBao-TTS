/**
 * 总览页面API路由
 * 提供系统状态监控和Cookie管理的API接口
 */

import { Router } from 'express'
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { log, logError } from '../utils/logger.js'
import { getLogsPath, getDataPath } from '../utils/pathUtils.js'
import cookieManager from '../services/cookieManager.js'
import cookieSelector from '../services/cookieSelector.js'
import { sendSuccess, sendError } from '../utils/apiResponse.js'
import { prefetchService } from '../services/prefetch/prefetchService.js'

export const consoleRouter = Router()

// 服务启动时间
const SERVER_START_TIME = Date.now()

/**
 * 获取系统状态
 * GET /api/console/status
 * 返回服务运行状态、Cookie状态、请求队列等信息
 */
consoleRouter.get('/console/status', async (req, res) => {
  try {
    // 计算运行时长
    const uptimeMs = Date.now() - SERVER_START_TIME

    // 获取Cookie统计（使用CookieSelector）
    let cookieStats = { total: 0, valid: 0 }
    try {
      if (!cookieManager.initialized) await cookieManager.initialize()
      // 清除缓存以获取最新数据
      cookieSelector.clearHealthyCache()
      const selectorStats = cookieSelector.getStatistics()
      if (selectorStats) {
        cookieStats.total = selectorStats.total
        cookieStats.valid = selectorStats.valid
      }
    } catch (error) {
      logError(error, { context: '获取Cookie统计' })
    }
    
    // 构建响应数据
    const statusData = {
      service: {
        status: 'running',
        uptimeMs: uptimeMs,
        version: '1.0.0'
      },
      cookies: {
        total: cookieStats.total,
        valid: cookieStats.valid
      },
      queue: {
        size: 0 // 预留字段，实际项目中可以实现请求队列
      }
    }
    
    return sendSuccess(res, statusData)
  } catch (err) {
    logError(err, { route: 'console/status' })
    return sendError(res, '获取系统状态失败', 500)
  }
})

/**
 * 获取Cookie统计信息
 * GET /api/console/cookies
 * 返回Cookie总数、有效数量、当前使用的Cookie等信息
 */
consoleRouter.get('/console/cookies', async (req, res) => {
  try {
    if (!cookieManager.initialized) await cookieManager.initialize()

    // 清除缓存以获取最新数据
    cookieSelector.clearHealthyCache()

    const cookies = cookieManager.getCookies()
    const selectorStats = cookieSelector.getStatistics()
    const activeCookie = cookieManager.getActiveCookie()

    const cookieData = {
      total: selectorStats?.total || 0,
      valid: selectorStats?.valid || 0,
      invalid: selectorStats?.invalid || 0,
      currentCookie: activeCookie ? { id: activeCookie.id, name: activeCookie.name } : null,
      cookies: cookies.map(c => ({
        id: c.id,
        name: c.name,
        valid: c.health?.isHealthy || false,
        isActive: c.status?.isActive || false
      }))
    }

    return sendSuccess(res, cookieData)
  } catch (err) {
    logError(err, { route: 'console/cookies' })
    return sendError(res, err.message || '获取Cookie统计失败', 500)
  }
})

/**
 * 健康检查接口
 * GET /api/console/health
 * 简单的健康检查接口，用于监控服务是否正常运行
 */
consoleRouter.get('/console/health', async (req, res) => {
  try {
    return sendSuccess(res, {
      status: 'healthy',
      uptime: Date.now() - SERVER_START_TIME
    })
  } catch (err) {
    logError(err, { route: 'console/health' })
    return sendError(res, '服务不健康', 500)
  }
})

/**
 * 递归统计目录中的日志文件
 * @param {string} dir - 目录路径
 * @param {object} stats - 统计对象 { fileCount, totalSize }
 */
function countLogFiles(dir, stats = { fileCount: 0, totalSize: 0 }) {
  if (!fs.existsSync(dir)) {
    return stats
  }

  const items = fs.readdirSync(dir)
  for (const item of items) {
    const itemPath = path.join(dir, item)
    const itemStats = fs.statSync(itemPath)

    if (itemStats.isDirectory()) {
      // 递归统计子目录
      countLogFiles(itemPath, stats)
    } else if (itemStats.isFile() && (item.endsWith('.log') || item.endsWith('.txt'))) {
      // 统计日志文件
      stats.totalSize += itemStats.size
      stats.fileCount++
    }
  }

  return stats
}

/**
 * 递归删除目录中的日志文件
 * @param {string} dir - 目录路径
 * @param {object} stats - 统计对象 { deletedCount, totalSize }
 */
function deleteLogFiles(dir, stats = { deletedCount: 0, totalSize: 0 }) {
  if (!fs.existsSync(dir)) {
    return stats
  }

  const items = fs.readdirSync(dir)
  for (const item of items) {
    const itemPath = path.join(dir, item)
    const itemStats = fs.statSync(itemPath)

    if (itemStats.isDirectory()) {
      // 递归清理子目录
      deleteLogFiles(itemPath, stats)
    } else if (itemStats.isFile() && (item.endsWith('.log') || item.endsWith('.txt'))) {
      // 删除日志文件
      stats.totalSize += itemStats.size
      fs.unlinkSync(itemPath)
      stats.deletedCount++
    }
  }

  return stats
}

/**
 * 获取日志缓存统计接口
 * GET /api/console/cache-stats
 * 获取logs文件夹中日志文件的统计信息
 */
consoleRouter.get('/console/cache-stats', async (req, res) => {
  try {
    const logsDir = getLogsPath()
    let logStats = { fileCount: 0, totalSize: 0 }

    if (fs.existsSync(logsDir)) {
      countLogFiles(logsDir, logStats)
    }

    return sendSuccess(res, logStats)
  } catch (err) {
    logError(err, { route: 'console/cache-stats' })
    const errorMsg = err?.message || err || '未知错误'
    return sendError(res, '获取日志统计失败: ' + errorMsg, 500)
  }
})

/**
 * 清理日志缓存接口
 * GET /api/console/clean-cache
 * 清理logs文件夹中的所有日志文件
 */
consoleRouter.get('/console/clean-cache', async (req, res) => {
  try {
    const logsDir = getLogsPath()

    // 检查logs目录是否存在
    if (!fs.existsSync(logsDir)) {
      return sendSuccess(res, { deletedCount: 0, totalSize: 0 }, '日志目录不存在，无需清理')
    }

    // 递归删除所有日志文件
    const stats = deleteLogFiles(logsDir, { deletedCount: 0, totalSize: 0 })

    log('info', '日志缓存清理完成', { deletedCount: stats.deletedCount, totalSize: stats.totalSize })

    return sendSuccess(res, { deletedCount: stats.deletedCount, totalSize: stats.totalSize }, '日志缓存清理完成')
  } catch (err) {
    logError(err, { route: 'console/clean-cache' })
    const errorMsg = err?.message || err || '未知错误'
    return sendError(res, '清理日志失败: ' + errorMsg, 500)
  }
})

/**
 * 扫描并修复指定章节的索引
 * POST /api/console/fix-chapter-index
 * 扫描实际存在的音频文件并同步到索引文件
 */
consoleRouter.post('/console/fix-chapter-index', async (req, res) => {
  try {
    const { bookId, chapterId } = req.body
    
    if (!bookId || !chapterId) {
      return sendError(res, '缺少必要参数: bookId 和 chapterId', 400)
    }
    
    log('info', '开始修复章节索引', { bookId, chapterId })
    
    // 加载现有索引
    const existingIndex = await prefetchService.loadChapterIndex(bookId, chapterId)
    if (!existingIndex) {
      return sendError(res, '章节索引不存在', 404)
    }
    
    const beforeCount = existingIndex.metadata?.completedSegments || 0
    const totalSegments = existingIndex.segments?.length || 0
    
    // 使用 syncAudioFilesToIndex 方法同步音频文件
    const baseDir = getDataPath('prefetch')
    const { getSafeDirName } = await import('../utils/pathUtils.js')
    const safeBookId = getSafeDirName(bookId)
    const chapterIdStr = getSafeDirName(chapterId)
    const audioDir = path.join(baseDir, 'books', safeBookId, 'chapters', chapterIdStr, 'audio')
    
    // 同步音频文件到索引
    const syncedCount = await prefetchService.syncAudioFilesToIndex(audioDir, existingIndex.segments)
    
    // 重新计算完成状态
    const completedSegments = existingIndex.segments.filter(s => s.audioFile && s.fileSize > 0).length
    const status = completedSegments === totalSegments ? 'completed' : 'paused'
    
    // 更新元数据
    existingIndex.metadata = {
      ...existingIndex.metadata,
      completedSegments,
      status,
      updatedAt: new Date().toISOString()
    }
    
    // 保存修复后的索引
    const chapterDir = path.join(baseDir, 'books', safeBookId, 'chapters', chapterIdStr)
    const indexPath = path.join(chapterDir, 'index.json')
    await fsPromises.writeFile(indexPath, JSON.stringify(existingIndex, null, 2), 'utf-8')
    
    log('info', '章节索引修复完成', { 
      bookId, 
      chapterId, 
      beforeCount, 
      afterCount: completedSegments,
      syncedCount,
      status 
    })
    
    return sendSuccess(res, {
      bookId,
      chapterId,
      beforeCount,
      afterCount: completedSegments,
      syncedCount,
      totalSegments,
      status
    }, '章节索引修复完成')
  } catch (err) {
    logError(err, { route: 'console/fix-chapter-index' })
    return sendError(res, err.message || '修复章节索引失败', 500)
  }
})

/**
 * 批量修复所有章节的索引
 * POST /api/console/fix-all-indexes
 * 扫描所有章节的音频文件并同步到索引
 */
consoleRouter.post('/console/fix-all-indexes', async (req, res) => {
  try {
    log('info', '开始批量修复所有章节索引')
    
    const baseDir = getDataPath('prefetch')
    const booksDir = path.join(baseDir, 'books')
    
    // 检查books目录是否存在
    try {
      await fsPromises.access(booksDir)
    } catch {
      return sendSuccess(res, { fixedCount: 0, details: [] }, '没有需要修复的索引')
    }
    
    const results = []
    let totalFixed = 0
    
    // 遍历所有书籍
    const bookDirs = await fsPromises.readdir(booksDir)
    for (const bookDir of bookDirs) {
      const bookPath = path.join(booksDir, bookDir)
      const chaptersDir = path.join(bookPath, 'chapters')
      
      try {
        const chapterDirs = await fsPromises.readdir(chaptersDir)
        
        // 遍历所有章节
        for (const chapterDir of chapterDirs) {
          const chapterPath = path.join(chaptersDir, chapterDir)
          const indexPath = path.join(chapterPath, 'index.json')
          
          try {
            // 读取索引文件
            const indexContent = await fsPromises.readFile(indexPath, 'utf-8')
            const index = JSON.parse(indexContent)
            
            const beforeCount = index.metadata?.completedSegments || 0
            const totalSegments = index.segments?.length || 0
            
            // 同步音频文件
            const audioDir = path.join(chapterPath, 'audio')
            const syncedCount = await prefetchService.syncAudioFilesToIndex(audioDir, index.segments)
            
            if (syncedCount > 0) {
              // 重新计算完成状态
              const completedSegments = index.segments.filter(s => s.audioFile && s.fileSize > 0).length
              const status = completedSegments === totalSegments ? 'completed' : 'paused'
              
              // 更新元数据
              index.metadata = {
                ...index.metadata,
                completedSegments,
                status,
                updatedAt: new Date().toISOString()
              }
              
              // 保存修复后的索引
              await fsPromises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')
              
              totalFixed++
              results.push({
                bookId: index.bookId,
                chapterId: index.chapterId,
                chapterTitle: index.chapterTitle,
                beforeCount,
                afterCount: completedSegments,
                syncedCount
              })
              
              log('info', '章节索引已修复', {
                bookId: index.bookId,
                chapterId: index.chapterId,
                beforeCount,
                afterCount: completedSegments
              })
            }
          } catch (error) {
            log('warn', `处理章节索引失败`, { chapterDir, error: error.message })
          }
        }
      } catch (error) {
        log('warn', `处理书籍目录失败`, { bookDir, error: error.message })
      }
    }
    
    log('info', '批量修复完成', { totalFixed, totalChapters: results.length })
    
    return sendSuccess(res, {
      fixedCount: totalFixed,
      details: results
    }, `成功修复 ${totalFixed} 个章节索引`)
  } catch (err) {
    logError(err, { route: 'console/fix-all-indexes' })
    return sendError(res, err.message || '批量修复索引失败', 500)
  }
})