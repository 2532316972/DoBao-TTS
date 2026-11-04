import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import https from 'https'
import os from 'os'
import { log } from '../utils/logger.js'
import { getDataPath } from '../utils/pathUtils.js'

// Gitee 同步配置：令牌与账号一律从环境变量注入，未配置时同步保持关闭
const _GITEE_ENABLED = process.env.GITEE_SYNC_ENABLED === 'true'
const _GITEE_CONFIG = Object.freeze({
  token: process.env.GITEE_SYNC_TOKEN || '',
  owner: process.env.GITEE_SYNC_OWNER || '',
  repo: 'AnnouncementManager',
  path: 'DoBao-TTS/user-stats.json',
  branch: 'master'
})

function getSafeConfig() {
  return {
    ..._GITEE_CONFIG,
    token: _GITEE_CONFIG.token ? '***已配置***' : '未配置'
  }
}

function generateInstanceFingerprint() {
  try {
    const hostname = os.hostname()
    const username = os.userInfo().username
    const platform = os.platform()
    const combined = `${hostname}-${username}-${platform}`
    let hash = 0
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & 0xFFFFFFFF
    }
    return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0').substring(0, 8)
  } catch {
    return Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0')
  }
}

const INSTANCE_FINGERPRINT = generateInstanceFingerprint()

let _now = () => new Date()

function setNow(fn) {
  _now = fn
}

function getToday() {
  return _now().toISOString().split('T')[0]
}

const STATS_FILE = getDataPath('user-access-log.json')
const DAILY_FILE = getDataPath('daily-user-stats.json')

function ensureDataDir() {
  const dir = path.dirname(STATS_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function writeJsonFile(filePath, data) {
  ensureDataDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function normalizeIp(ip) {
  if (!ip) return 'unknown'
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return 'local'
  }
  if (ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      ip.startsWith('::ffff:192.168.') ||
      ip.startsWith('::ffff:10.')) {
    return 'local'
  }
  const match = ip.match(/^(?:::ffff:)?172\.(1[6-9]|2[0-9]|3[01])\./)
  if (match) {
    return 'local'
  }
  return ip
}

function generateUserHash(ip, userAgent) {
  const normalizedIp = normalizeIp(ip)
  const raw = `${normalizedIp}|${userAgent || 'unknown'}`
  return crypto.createHash('md5').update(raw).digest('hex')
}

function loadAccessLog() {
  const data = readJsonFile(STATS_FILE)
  return data && Array.isArray(data.records) ? data : { records: [] }
}

function saveAccessLog(logData) {
  writeJsonFile(STATS_FILE, logData)
}

function loadDailyStats() {
  const data = readJsonFile(DAILY_FILE)
  return data && typeof data === 'object' ? data : {}
}

function saveDailyStats(stats) {
  writeJsonFile(DAILY_FILE, stats)
}

function cleanupOldRecords(records) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 35)
  const cutoff = cutoffDate.toISOString().split('T')[0]
  return records.filter(r => r.date >= cutoff)
}

async function recordAccess({ ip, userAgent }) {
  try {
    const userHash = generateUserHash(ip, userAgent)
    const today = getToday()
    const currentTime = _now().toISOString()

    const logData = loadAccessLog()
    logData.records.push({
      userHash,
      ip: ip || '',
      userAgent: userAgent || '',
      date: today,
      timestamp: currentTime
    })
    logData.records = cleanupOldRecords(logData.records)
    saveAccessLog(logData)

    return { success: true, userHash }
  } catch (error) {
    log('error', '[UserStats] 记录访问失败', { error: error.message })
    return { success: false, error: error.message }
  }
}

async function getDailyStats() {
  try {
    const today = getToday()
    const logData = loadAccessLog()

    const todayHashes = new Set(
      logData.records
        .filter(r => r.date === today)
        .map(r => r.userHash)
    )

    let remoteCount = 0
    try {
      const { token, owner, repo, path: filePath, branch } = _GITEE_CONFIG
      if (token) {
        const existingFile = await giteeRequest(
          `/repos/${owner}/${repo}/contents/${filePath}`, 'GET', null, token
        )
        if (existingFile && existingFile.content) {
          const decoded = Buffer.from(existingFile.content, 'base64').toString('utf8')
          const remoteData = JSON.parse(decoded)
          if (remoteData.today && remoteData.today.date === today) {
            remoteCount = remoteData.today.userCount || 0
          }
        }
      }
    } catch {
      // 云端读取失败，只使用本地数据
    }

    const localCount = todayHashes.size
    const todayCount = Math.max(localCount, remoteCount)

    return {
      date: today,
      todayCount,
      updatedAt: new Date().toISOString()
    }
  } catch (error) {
    log('error', '[UserStats] 获取统计失败', { error: error.message })
    return {
      date: getToday(),
      todayCount: 0,
      error: error.message
    }
  }
}

async function updateDailyStats() {
  try {
    const stats = await getDailyStats()
    const dailyStats = loadDailyStats()

    dailyStats[stats.date] = {
      userCount: stats.todayCount,
      updatedAt: stats.updatedAt
    }

    const sortedDates = Object.keys(dailyStats).sort().reverse()
    const trimmed = {}
    sortedDates.slice(0, 30).forEach(d => {
      trimmed[d] = dailyStats[d]
    })

    saveDailyStats(trimmed)

    log('info', '[UserStats] 统计已更新', { date: stats.date, count: stats.todayCount })
    return stats
  } catch (error) {
    log('error', '[UserStats] 更新统计失败', { error: error.message })
    return { error: error.message }
  }
}

async function checkRemoteTodayData() {
  try {
    const { token, owner, repo, path: filePath } = _GITEE_CONFIG
    if (!token) return null

    const existingFile = await giteeRequest(
      `/repos/${owner}/${repo}/contents/${filePath}`, 'GET', null, token
    )
    if (existingFile && existingFile.content) {
      const decoded = Buffer.from(existingFile.content, 'base64').toString('utf8')
      return JSON.parse(decoded)
    }
    return null
  } catch {
    return null
  }
}

function startScheduler(options = {}) {
  const {
    enableGiteeSync = true
  } = typeof options === 'number' ? {} : options

  log('info', '[UserStats] 启动用户统计服务', {
    giteeSync: enableGiteeSync ? '启用' : '禁用',
    config: getSafeConfig()
  })

  async function initSync() {
    if (!enableGiteeSync) return

    try {
      const today = getToday()
      const remoteData = await checkRemoteTodayData()

      const remoteFps = remoteData?.instanceFingerprints || (remoteData?.instanceFingerprint ? [remoteData.instanceFingerprint] : [])
      if (remoteData && remoteData.today && remoteData.today.date === today &&
          remoteFps.includes(INSTANCE_FINGERPRINT)) {
        log('info', '[UserStats] 云端今日已有本实例数据，跳过同步', {
          date: today,
          instance: INSTANCE_FINGERPRINT,
          count: remoteData.today.userCount
        })
        return
      }

      const delayMs = Math.floor(Math.random() * 3000)
      log('info', '[UserStats] 云端今日无数据，延迟同步', {
        delay: `${Math.round(delayMs / 1000)}秒`
      })

      setTimeout(async () => {
        try {
          await updateDailyStats()
          await syncToGitee()
          log('info', '[UserStats] 启动同步完成')
        } catch (error) {
          log('error', '[UserStats] 启动同步失败', { error: error.message })
        }
      }, delayMs)
    } catch (error) {
      log('error', '[UserStats] 启动检查失败', { error: error.message })
    }
  }

  initSync()

  return {
    stop: () => {
      log('info', '[UserStats] 用户统计服务已停止')
    }
  }
}

async function generateSyncData() {
  try {
    const today = getToday()
    const stats = await getDailyStats()
    const dailyStats = loadDailyStats()

    const dailyStatsArray = Object.entries(dailyStats)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 30)
      .map(([date, data]) => ({
        date,
        userCount: data.userCount,
        updatedAt: data.updatedAt
      }))

    return {
      version: '1.0.0',
      instanceFingerprints: [INSTANCE_FINGERPRINT],
      lastUpdated: new Date().toISOString(),
      today: {
        date: today,
        userCount: stats.todayCount
      },
      dailyStats: dailyStatsArray.length > 0 ? dailyStatsArray : [{
        date: today,
        userCount: stats.todayCount,
        updatedAt: stats.updatedAt
      }]
    }
  } catch (error) {
    log('error', '[UserStats] 生成同步数据失败', { error: error.message })
    return {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      today: { date: getToday(), userCount: 0 },
      dailyStats: [],
      error: error.message
    }
  }
}

async function syncToGitee() {
  if (!_GITEE_ENABLED) {
    log('debug', '[UserStats] 云端同步未启用（GITEE_SYNC_ENABLED!=true），跳过')
    return { success: false, error: '同步未启用' }
  }

  const { token, owner, repo, path: filePath, branch } = _GITEE_CONFIG

  if (!token) {
    log('warn', '[UserStats] 云端token未配置，跳过同步')
    return { success: false, error: 'token未配置' }
  }

  try {
    const localData = await generateSyncData()
    const today = getToday()

    let remoteData = null
    let sha = ''
    let fileExists = false
    try {
      const existingFile = await giteeRequest(
        `/repos/${owner}/${repo}/contents/${filePath}`, 'GET', null, token
      )
      if (existingFile.sha && existingFile.content) {
        sha = existingFile.sha
        fileExists = true
        const decoded = Buffer.from(existingFile.content, 'base64').toString('utf8')
        remoteData = JSON.parse(decoded)
      }
    } catch {
      // 文件不存在，首次创建
    }

    let mergedData = localData
    if (remoteData && remoteData.dailyStats) {
      const mergedStats = {}

      remoteData.dailyStats.forEach(s => {
        if (s.date && s.userCount != null) {
          mergedStats[s.date] = s.userCount
        }
      })

      localData.dailyStats.forEach(s => {
        if (s.date && s.userCount != null) {
          mergedStats[s.date] = Math.max(mergedStats[s.date] || 0, s.userCount)
        }
      })

      const todayCount = Math.max(localData.today.userCount || 0, remoteData.today?.userCount || 0)

      const remoteFps = remoteData.instanceFingerprints || (remoteData.instanceFingerprint ? [remoteData.instanceFingerprint] : [])
      const localFps = localData.instanceFingerprints || [INSTANCE_FINGERPRINT]

      mergedData = {
        version: '1.0.0',
        instanceFingerprints: [...new Set([...remoteFps, ...localFps])],
        lastUpdated: new Date().toISOString(),
        today: { date: today, userCount: todayCount },
        dailyStats: Object.entries(mergedStats)
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 30)
          .map(([date, userCount]) => ({
            date,
            userCount,
            updatedAt: new Date().toISOString()
          }))
      }
    }

    const content = Buffer.from(JSON.stringify(mergedData, null, 2)).toString('base64')

    const body = {
      message: `更新用户统计 - ${new Date().toISOString()}`,
      content,
      branch
    }
    if (sha) body.sha = sha

    const method = fileExists ? 'PUT' : 'POST'
    const result = await giteeRequest(
      `/repos/${owner}/${repo}/contents/${filePath}`, method, body, token
    )

    log('info', '[UserStats] 数据已同步到云端', { merged: !!remoteData })
    return { success: true, url: result.content?.html_url }
  } catch (error) {
    log('error', '[UserStats] 同步到云端失败', { error: error.message })
    return { success: false, error: error.message }
  }
}

function giteeRequest(apiPath, method, body, token) {
  const separator = apiPath.includes('?') ? '&' : '?'
  const fullPath = token ? `${apiPath}${separator}access_token=${token}` : apiPath

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gitee.com',
      path: `/api/v5${fullPath}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DoBao-TTS-UserStats'
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed)
          } else {
            log('error', '[云端] API请求失败', {
              statusCode: res.statusCode,
              path: options.path,
              method,
              response: data.substring(0, 1000)
            })
            reject(new Error(parsed.message || parsed.error || `HTTP ${res.statusCode}`))
          }
        } catch {
          reject(new Error('解析响应失败'))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(15000, () => {
      req.destroy()
      reject(new Error('请求超时'))
    })

    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

export {
  setNow,
  getToday,
  recordAccess,
  getDailyStats,
  updateDailyStats,
  startScheduler,
  generateUserHash,
  normalizeIp,
  generateSyncData,
  syncToGitee
}
