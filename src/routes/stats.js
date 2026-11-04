/**
 * 用户统计路由
 * 提供用户访问统计相关接口
 */

import { Router } from 'express'
import { log } from '../utils/logger.js'
import { sendSuccess, sendError } from '../utils/apiResponse.js'
import {
  getDailyStats,
  recordAccess,
  generateSyncData,
  syncToGitee,
  updateDailyStats
} from '../services/userStatsService.js'

export const statsRouter = Router()

statsRouter.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || ''
  const userAgent = req.get('user-agent') || ''

  recordAccess({ ip, userAgent }).catch(err => {
    log('debug', '[Stats] 记录访问失败:', err.message)
  })

  next()
})

statsRouter.get('/stats/daily', async (req, res) => {
  try {
    const stats = await getDailyStats()
    sendSuccess(res, stats)
  } catch (error) {
    log('error', '[Stats] 获取统计失败:', error.message)
    sendError(res, '获取统计数据失败', 500)
  }
})

statsRouter.get('/stats/sync-data', async (req, res) => {
  try {
    const data = await generateSyncData()
    sendSuccess(res, data)
  } catch (error) {
    log('error', '[Stats] 获取同步数据失败:', error.message)
    sendError(res, '获取同步数据失败', 500)
  }
})

statsRouter.post('/stats/update', async (req, res) => {
  try {
    const stats = await updateDailyStats()
    sendSuccess(res, stats, '统计已更新')
  } catch (error) {
    log('error', '[Stats] 更新统计失败:', error.message)
    sendError(res, '更新统计失败', 500)
  }
})

statsRouter.post('/stats/sync', async (req, res) => {
  try {
    const syncResult = await syncToGitee()
    if (syncResult.success) {
      sendSuccess(res, { url: syncResult.url }, '数据已同步到云端')
    } else {
      sendError(res, syncResult.error, 500)
    }
  } catch (error) {
    log('error', '[Stats] 云端同步失败:', error.message)
    sendError(res, '云端同步失败', 500)
  }
})

statsRouter.get('/stats/health', (req, res) => {
  sendSuccess(res, { service: 'user-stats', timestamp: new Date().toISOString() })
})
