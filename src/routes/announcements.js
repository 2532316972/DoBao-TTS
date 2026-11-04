/**
 * 公告管理路由
 * 提供公告查询和版本更新检查功能
 */

import { Router } from 'express'
import axios from 'axios'
import { log, logError } from '../utils/logger.js'
import { sendSuccess, sendError } from '../utils/apiResponse.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// 获取当前版本号
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJsonPath = join(__dirname, '../../package.json')
let currentVersion = '1.0.0'
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  currentVersion = packageJson.version || '1.0.0'
} catch (error) {
  log('error', '读取package.json失败', { error: error.message })
}

/**
 * 比较两个版本号
 * @param {string} v1 - 版本号1
 * @param {string} v2 - 版本号2
 * @returns {number} - 1: v1>v2, 0: v1=v2, -1: v1<v2
 */
function compareVersion(v1, v2) {
  // 去掉 v 前缀
  const ver1 = v1.replace(/^v/i, '').split('.').map(Number)
  const ver2 = v2.replace(/^v/i, '').split('.').map(Number)
  
  const maxLen = Math.max(ver1.length, ver2.length)
  
  for (let i = 0; i < maxLen; i++) {
    const num1 = ver1[i] || 0
    const num2 = ver2[i] || 0
    
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  
  return 0
}

export const announcementsRouter = Router()

// Gitee 仓库配置
const GITEE_CONFIG = {
  owner: process.env.GITEE_ANNOUNCEMENT_OWNER || 'YeYuRaoXinXian',
  repo: process.env.GITEE_ANNOUNCEMENT_REPO || 'AnnouncementManager',
  path: 'DoBao-TTS/announcement.json',
  branch: process.env.GITEE_ANNOUNCEMENT_BRANCH || 'master'
}

// 缓存配置
let announcementCache = {
  data: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000 // 5分钟缓存
}

/**
 * 从Gitee获取公告数据
 * 使用 Raw 文件内容获取（公开仓库）
 * @returns {Promise<Object>} 公告数据
 */
async function fetchAnnouncementFromGitee() {
  try {
    // 检查缓存是否有效
    const now = Date.now()
    if (announcementCache.data && (now - announcementCache.timestamp) < announcementCache.ttl) {
      log('debug', '使用缓存的公告数据')
      return { success: true, data: announcementCache.data, fromCache: true }
    }

    // 使用 Gitee Raw 文件 URL 获取内容（公开仓库，无 API 限制）
    const rawUrl = `https://gitee.com/${GITEE_CONFIG.owner}/${GITEE_CONFIG.repo}/raw/${GITEE_CONFIG.branch}/${GITEE_CONFIG.path}`

    const response = await axios.get(rawUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'DoBao-TTS-Server',
        'Accept': 'application/json, text/plain, */*'
      }
    })

    if (response.data) {
      // 直接获取 JSON 数据
      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data

      // 更新缓存
      announcementCache.data = data
      announcementCache.timestamp = now
      log('info', '公告数据获取成功')
      return { success: true, data: data, fromCache: false }
    }

    return { success: false, error: '返回数据为空' }
  } catch (error) {
    logError(error, { context: '获取云端公告数据' })
    // 如果有缓存数据，返回缓存
    if (announcementCache.data) {
      log('warn', '获取公告失败，使用缓存数据')
      return { success: true, data: announcementCache.data, fromCache: true }
    }
    return { success: false, error: error.message }
  }
}

/**
 * 获取公告列表
 * GET /api/announcements
 */
announcementsRouter.get('/announcements', async (req, res) => {
  try {
    const result = await fetchAnnouncementFromGitee()
    if (result.success) {
      return sendSuccess(res, result.data, {
        fromCache: result.fromCache || false
      })
    } else {
      return sendError(res, result.error || '获取公告失败', 500)
    }
  } catch (error) {
    logError(error, { context: '获取公告列表' })
    return sendError(res, '获取公告失败: ' + error.message, 500)
  }
})

/**
 * 检查版本更新
 * GET /api/force-update
 * 返回最新的版本更新信息
 */
announcementsRouter.get('/force-update', async (req, res) => {
  try {
    log('info', '检查版本更新')
    const result = await fetchAnnouncementFromGitee()
    
    if (!result.success) {
      return sendError(res, '获取更新信息失败', 500)
    }

    const data = result.data
    
    // 获取更新日志列表
    const changelogs = data['更新日志'] || []
    
    if (changelogs.length === 0) {
      return sendSuccess(res, { forceUpdate: false })
    }

    // 按日期排序，获取最新的更新日志
    const sortedChangelogs = changelogs.sort((a, b) => {
      return new Date(b.date) - new Date(a.date)
    })

    const latestChangelog = sortedChangelogs[0]
    const latestVersion = latestChangelog.version || '1.0.0'
    
    // 比较版本号，只有当最新版本大于当前版本时才需要更新
    const versionCompare = compareVersion(latestVersion, currentVersion)
    const isNewerVersion = versionCompare > 0
    
    // 检查是否需要更新（最新版本大于当前版本且设置了forceUpdate）
    const needForceUpdate = isNewerVersion && latestChangelog.forceUpdate === true

    // 构建更新信息
    const forceUpdateInfo = {
      forceUpdate: needForceUpdate,
      hasNewVersion: isNewerVersion,
      currentVersion: currentVersion,
      version: latestVersion,
      date: latestChangelog.date,
      changes: latestChangelog.changes || {},
      message: latestChangelog.updateMessage || '为了保证项目稳定与安全，请更新到最新版本以继续使用本项目。',
      updateMessage: latestChangelog.updateMessage || '为了保证项目稳定与安全，请更新到最新版本以继续使用本项目。',
      quarkUrl: latestChangelog.quarkUrl || 'https://pan.quark.cn/s/bec6b4aa62b8',
      baiduUrl: latestChangelog.baiduUrl || 'https://pan.baidu.com/s/15Xxj3xaXZn6i2rjcWvU2Sw?pwd=e4n7',
      isExcluded: false
    }

    // 检查设备是否在排除列表中
    const serviceStatus = data.serviceStatus || {}
    const excludedDevices = serviceStatus.excludedDevices || []

    // 获取设备指纹（从请求头或查询参数）
    const deviceFingerprint = req.headers['x-device-fingerprint'] || req.query.fingerprint

    log('info', '设备排除检查', {
      deviceFingerprint: deviceFingerprint || '未提供',
      excludedDevicesCount: excludedDevices.length
    })

    if (deviceFingerprint && excludedDevices.length > 0) {
      forceUpdateInfo.isExcluded = excludedDevices.some(device =>
        device.fingerprint === deviceFingerprint
      )
    }

    log('info', '版本更新检查结果', { 
      needUpdate: forceUpdateInfo.forceUpdate, 
      version: forceUpdateInfo.version,
      isExcluded: forceUpdateInfo.isExcluded
    })

    return sendSuccess(res, forceUpdateInfo)
  } catch (error) {
    logError(error, { context: '检查版本更新' })
    return sendError(res, '检查更新失败: ' + error.message, 500)
  }
})

/**
 * 刷新公告缓存
 * POST /api/announcements/refresh
 */
announcementsRouter.post('/announcements/refresh', async (req, res) => {
  try {
    // 清除缓存
    announcementCache.data = null
    announcementCache.timestamp = 0
    
    log('info', '手动刷新公告缓存')
    const result = await fetchAnnouncementFromGitee()
    
    if (result.success) {
      return sendSuccess(res, result.data, {
        fromCache: result.fromCache || false,
        message: '缓存已刷新'
      })
    } else {
      return sendError(res, result.error || '刷新公告失败', 500)
    }
  } catch (error) {
    logError(error, { context: '刷新公告缓存' })
    return sendError(res, '刷新公告失败: ' + error.message, 500)
  }
})
