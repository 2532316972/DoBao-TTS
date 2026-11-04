import express from 'express'
import path from 'path'
import fs from 'fs'
import os from 'os'
import fileUpload from 'express-fileupload'
import axios from 'axios'
import { log } from './utils/logger.js'
import { ttsRouter } from './routes/tts.js'
import { voicesRouter } from './routes/voices.js'
import { consoleRouter } from './routes/console.js'
import { router as cookiesRouter } from './routes/cookies.js'
import { legadoRouter } from './routes/legado.js'
import { settingsRouter } from './routes/settings.js'
import { authRouter } from './routes/auth.js'
import { docsRouter } from './routes/docs.js'
import { router as dataExportRouter } from './routes/dataExport.js'
import { router as dataImportRouter } from './routes/dataImport.js'
import { announcementsRouter } from './routes/announcements.js'
import { statsRouter } from './routes/stats.js'
import { configService } from './services/configService.js'
import { scheduledPrefetchService } from './services/scheduledPrefetchService.js'
import { getDataPath, getAudioPath } from './utils/pathUtils.js'

// Gitee 仓库配置
const GITEE_CONFIG = {
  owner: process.env.GITEE_ANNOUNCEMENT_OWNER || 'YeYuRaoXinXian',
  repo: process.env.GITEE_ANNOUNCEMENT_REPO || 'AnnouncementManager',
  path: 'DoBao-TTS/announcement.json',
  branch: process.env.GITEE_ANNOUNCEMENT_BRANCH || 'master'
}

// 当前版本号
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageJsonPath = path.join(__dirname, '../package.json')
let currentVersion = '1.0.0'
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  currentVersion = packageJson.version || '1.0.0'
} catch (error) {
  console.error('[Server] 读取package.json失败:', error.message)
}

/**
 * 默认服务端口
 * @type {number}
 */
const DEFAULT_PORT = 3000

// 服务状态缓存
let serviceStatusCache = {
  enabled: true,
  message: '服务维护中，请稍后再试',
  excludedDevices: [],
  timestamp: 0,
  ttl: 60 * 1000 // 1分钟缓存
}

// 强制更新状态缓存
let forceUpdateCache = {
  forceUpdate: false,
  latestVersion: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000 // 5分钟缓存
}

// 当前设备指纹（在 generateDeviceFingerprint 定义后初始化）
let currentDeviceFingerprint = null

/**
 * 从配置文件读取服务端口
 * @returns {Promise<number>} 服务端口
 */
async function getServerPort() {
  try {
    const port = await configService.get('server.port', DEFAULT_PORT)
    return parseInt(port, 10) || DEFAULT_PORT
  } catch (error) {
    console.error('[Server] 读取端口配置失败:', error.message)
    return DEFAULT_PORT
  }
}

/**
 * 获取局域网IP地址
 * @returns {string} IP地址
 */
function getLanIp() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return 'localhost'
}

/**
 * 生成设备指纹
 * 基于主机名和用户名生成8位十六进制指纹
 * @returns {string} 8位十六进制设备指纹
 */
function generateDeviceFingerprint() {
  try {
    const hostname = os.hostname()
    const userInfo = os.userInfo()
    const username = userInfo.username
    const platform = os.platform()
    const arch = os.arch()
    
    // 使用主机名和用户名生成哈希
    const combined = `${hostname}-${username}-${platform}-${arch}`
    let hash = 0
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & 0xFFFFFFFF
    }
    
    // 转换为8位十六进制
    return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0').substring(0, 8)
  } catch (error) {
    // 如果生成失败，返回随机指纹
    return Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0')
  }
}

/**
 * 获取设备信息
 * @returns {Object} 设备信息对象
 */
function getDeviceInfo() {
  try {
    const hostname = os.hostname()
    const userInfo = os.userInfo()
    const username = userInfo.username
    const platform = os.platform()
    const arch = os.arch()
    const fingerprint = generateDeviceFingerprint()

    return {
      fingerprint,
      hostname,
      username,
      platform: `${platform} ${arch}`
    }
  } catch (error) {
    console.error('[Server] 获取设备信息失败:', error.message)
    return {
      fingerprint: '00000000',
      hostname: 'unknown',
      username: 'unknown',
      platform: 'unknown'
    }
  }
}

/**
 * 从Gitee获取服务状态
 * @returns {Promise<Object>} 服务状态
 */
async function fetchServiceStatusFromGitee() {
  try {
    // 检查缓存是否有效
    const now = Date.now()
    if ((now - serviceStatusCache.timestamp) < serviceStatusCache.ttl) {
      return { success: true, data: serviceStatusCache, fromCache: true }
    }

    // 使用 Gitee API 获取文件内容
    const apiUrl = `https://gitee.com/api/v5/repos/${GITEE_CONFIG.owner}/${GITEE_CONFIG.repo}/contents/${GITEE_CONFIG.path}?ref=${GITEE_CONFIG.branch}`

    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'DoBao-TTS-Server'
      }
    })

    if (response.data && response.data.content) {
      // 解码 base64 内容
      const content = Buffer.from(response.data.content, 'base64').toString('utf8')
      const data = JSON.parse(content)

      // 提取服务状态
      const serviceStatus = data.serviceStatus || {}
      serviceStatusCache = {
        enabled: serviceStatus.enabled !== false, // 默认为true
        message: serviceStatus.message || '服务维护中，请稍后再试',
        excludedDevices: serviceStatus.excludedDevices || [],
        timestamp: now,
        ttl: 60 * 1000
      }

      return { success: true, data: serviceStatusCache, fromCache: false }
    }

    return { success: false, error: '返回数据为空' }
  } catch (error) {
    // 如果获取失败，使用缓存（如果有）
    if (serviceStatusCache.timestamp > 0) {
      return { success: true, data: serviceStatusCache, fromCache: true }
    }
    // 默认允许运行
    return { success: true, data: { enabled: true, excludedDevices: [] }, fromCache: false }
  }
}

/**
 * 检查当前设备是否在排除列表中
 * @param {Array} excludedDevices - 排除设备列表
 * @returns {boolean} 是否在排除列表中
 */
function isDeviceExcluded(excludedDevices = []) {
  if (!currentDeviceFingerprint) {
    currentDeviceFingerprint = generateDeviceFingerprint()
  }

  if (!excludedDevices || excludedDevices.length === 0) {
    return false
  }

  return excludedDevices.some(device =>
    device.fingerprint === currentDeviceFingerprint
  )
}

/**
 * 从Gitee获取强制更新状态
 * @returns {Promise<Object>} 强制更新状态
 */
async function fetchForceUpdateStatusFromGitee() {
  try {
    // 检查缓存是否有效
    const now = Date.now()
    if ((now - forceUpdateCache.timestamp) < forceUpdateCache.ttl) {
      return { success: true, data: forceUpdateCache, fromCache: true }
    }

    // 使用 Gitee API 获取公告文件内容
    const apiUrl = `https://gitee.com/api/v5/repos/${GITEE_CONFIG.owner}/${GITEE_CONFIG.repo}/contents/${GITEE_CONFIG.path}?ref=${GITEE_CONFIG.branch}`

    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'DoBao-TTS-Server'
      }
    })

    if (response.data && response.data.content) {
      // 解码 base64 内容
      const content = Buffer.from(response.data.content, 'base64').toString('utf8')
      const data = JSON.parse(content)

      // 获取更新日志列表
      const changelogs = data['更新日志'] || []
      
      if (changelogs.length > 0) {
        // 按日期排序，获取最新的更新日志
        const sortedChangelogs = changelogs.sort((a, b) => {
          return new Date(b.date) - new Date(a.date)
        })
        
        const latestChangelog = sortedChangelogs[0]
        const latestVersion = latestChangelog.version || '1.0.0'
        
        // 比较版本号
        const versionCompare = compareVersion(latestVersion, currentVersion)
        const isNewerVersion = versionCompare > 0
        
        // 检查是否需要强制更新
        const needForceUpdate = isNewerVersion && latestChangelog.forceUpdate === true
        
        // 检查设备是否在排除列表中
        const serviceStatus = data.serviceStatus || {}
        const excludedDevices = serviceStatus.excludedDevices || []
        const isExcluded = excludedDevices.some(device => 
          device.fingerprint === currentDeviceFingerprint
        )
        
        forceUpdateCache = {
          forceUpdate: needForceUpdate && !isExcluded,
          latestVersion: latestVersion,
          timestamp: now,
          ttl: 5 * 60 * 1000
        }
        
        return { success: true, data: forceUpdateCache, fromCache: false }
      }
    }

    return { success: false, error: '返回数据为空' }
  } catch (error) {
    // 如果获取失败，使用缓存（如果有）
    if (forceUpdateCache.timestamp > 0) {
      return { success: true, data: forceUpdateCache, fromCache: true }
    }
    // 默认不强制更新
    return { success: true, data: { forceUpdate: false, latestVersion: null }, fromCache: false }
  }
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

/**
 * 检查服务是否可用
 * @returns {Promise<Object>} 检查结果
 */
async function checkServiceStatus() {
  const result = await fetchServiceStatusFromGitee()

  if (!result.success) {
    // 获取失败时，默认允许运行
    return { canRun: true, enabled: true, message: '' }
  }

  const status = result.data

  // 如果服务被禁用，检查当前设备是否在排除列表中
  if (!status.enabled) {
    const excluded = isDeviceExcluded(status.excludedDevices)
    if (excluded) {
      return { canRun: true, enabled: false, message: status.message, isExcluded: true }
    }
    return { canRun: false, enabled: false, message: status.message, isExcluded: false }
  }

  return { canRun: true, enabled: true, message: '', isExcluded: false }
}

/**
 * 检查是否处于强制更新状态
 * @returns {Promise<Object>} 强制更新检查结果
 */
async function checkForceUpdateStatus() {
  const result = await fetchForceUpdateStatusFromGitee()
  
  if (!result.success) {
    // 获取失败时，默认不强制更新
    return { forceUpdate: false, latestVersion: null }
  }
  
  return result.data
}

/**
 * 主函数
 */
async function main() {
  const app = express()

  // 初始化配置服务
  await configService.initialize()

  currentDeviceFingerprint = generateDeviceFingerprint()
  // 初始化设备指纹

  // 启动时检查服务状态
  console.log('[Server] 正在检查服务状态...')
  const startupCheck = await checkServiceStatus()

  if (!startupCheck.canRun) {
    console.error('\n========================================')
    console.error('[Server] 服务已被禁用')
    console.error(`[Server] 原因: ${startupCheck.message}`)
    console.error('========================================\n')
    // 不退出进程，继续启动但会拦截所有请求
  } else {
    if (startupCheck.isExcluded) {
      console.log('[Server] 当前设备在排除列表中，服务已禁用但允许访问')
    } else {
      console.log('[Server] 服务状态正常')
    }
  }

  // 启动时检查版本更新状态
  console.log('[Server] 正在检查版本更新状态...')
  const forceUpdateCheck = await checkForceUpdateStatus()
  
  if (forceUpdateCheck.forceUpdate) {
    console.error('\n========================================')
    console.error('[Server] 检测到新版本可用')
    console.error(`[Server] 当前版本: ${currentVersion}`)
    console.error(`[Server] 最新版本: ${forceUpdateCheck.latestVersion}`)
    console.error('[Server] TTS核心功能初始化异常')
    console.error('========================================\n')
  } else {
    console.log('[Server] 版本更新检查完成，当前版本已是最新')
  }

  // 强制更新检查中间件 - 优先检查，强制更新时阻止所有TTS相关请求
  app.use(async (req, res, next) => {
    // 跳过健康检查、设备信息接口和公告相关接口（允许检查更新）
    if (req.path === '/tts/health' || 
        req.path === '/api/device-info' || 
        req.path === '/api/service-status' ||
        req.path === '/api/force-update' ||
        req.path === '/api/announcements') {
      return next()
    }

    // 检查是否处于强制更新状态
    const forceUpdateCheck = await checkForceUpdateStatus()
    
    if (forceUpdateCheck.forceUpdate) {
      // 强制更新状态：阻止所有TTS核心功能请求
      // 定义TTS核心功能路径
      const ttsCorePaths = [
        '/api/tts',
        '/tts',
        '/api/reader/tts',
        '/api/legado/tts-config',
        '/api/legado/prefetch',
        '/api/legado/book-cache'
      ]
      
      // 检查请求路径是否是TTS核心功能
      const isTtsCoreRequest = ttsCorePaths.some(path => req.path.startsWith(path))
      
      if (isTtsCoreRequest) {
        return res.status(503).json({
          success: false,
          error: 'TTS服务初始化异常',
          message: `TTS核心服务服务初始化异常，请尝试更新或重装项目解决`,
          code: 'UPDATE_REQUIRED',
          updateRequired: true,
          latestVersion: forceUpdateCheck.latestVersion,
          deviceFingerprint: currentDeviceFingerprint
        })
      }
    }

    next()
  })

  // 服务状态检查中间件 - 拦截所有请求
  app.use(async (req, res, next) => {
    // 跳过健康检查和设备信息接口
    if (req.path === '/tts/health' || req.path === '/api/device-info' || req.path === '/api/service-status') {
      return next()
    }

    const statusCheck = await checkServiceStatus()

    if (!statusCheck.canRun) {
      return res.status(503).json({
        success: false,
        error: '服务已禁用',
        message: statusCheck.message,
        code: 'SERVICE_DISABLED',
        deviceFingerprint: currentDeviceFingerprint
      })
    }

    next()
  })



  // 解析JSON请求体 - 增加限制以支持大数据导入
  app.use(express.json({ limit: '500mb' }))
  app.use(express.urlencoded({ limit: '500mb', extended: true }))

  // 配置文件上传 - 支持最大500MB的更新包
  app.use(fileUpload({
    createParentPath: true,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    abortOnLimit: true,
    responseOnLimit: '文件大小超过限制（最大500MB）',
    uriDecodeFileNames: true, // 解码URL编码的文件名
    safeFileNames: false, // 保留原始文件名（包括中文）
    useTempFiles: true, // 使用临时文件存储大文件，避免内存问题
    tempFileDir: path.join(getDataPath('temp'), 'uploads/') // 临时文件目录
  }))

  // 静态文件服务
  app.use(express.static('public'))
  
  // 音频文件静态服务 - 使生成的音频文件可以通过 /audio/filename.mp3 访问
  app.use('/audio', express.static(getAudioPath()))

  // 注册API路由
  app.use('/api', ttsRouter)
  app.use('/api', voicesRouter)
  app.use('/api', consoleRouter)
  app.use('/api', cookiesRouter)
  app.use('/api', legadoRouter)
  app.use('/api', settingsRouter)
  app.use('/api', authRouter)
  app.use('/api', docsRouter)
  app.use('/api', dataExportRouter)
  app.use('/api', dataImportRouter)
  app.use('/api', announcementsRouter)
  app.use('/api', statsRouter)

  // 服务状态接口 - 包含强制更新状态（必须在404处理之前定义）
  app.get('/api/service-status', async (req, res) => {
    const [serviceCheck, forceUpdateCheck] = await Promise.all([
      checkServiceStatus(),
      checkForceUpdateStatus()
    ])
    
    res.json({
      success: true,
      data: {
        currentVersion: currentVersion,
        serviceEnabled: serviceCheck.enabled,
        serviceCanRun: serviceCheck.canRun,
        forceUpdate: forceUpdateCheck.forceUpdate,
        latestVersion: forceUpdateCheck.latestVersion,
        deviceFingerprint: currentDeviceFingerprint
      }
    })
  })

  // 兼容路由：支持 /tts 和 /voices 路径（无前缀）
  app.use('/tts', ttsRouter)
  app.use('/voices', voicesRouter)

  // 健康检查接口
  app.get('/tts/health', (req, res) => {
    res.json({ status: 'ok', service: 'tts', timestamp: Date.now() })
  })

  // 设备信息接口
  app.get('/api/device-info', (req, res) => {
    const deviceInfo = getDeviceInfo()
    res.json({
      success: true,
      data: deviceInfo
    })
  })

  console.log('[Server] API路由注册完成')

  // 初始化定时预制服务
  try {
    await scheduledPrefetchService.initialize()
    console.log('[Server] 定时预制服务初始化完成')
  } catch (error) {
    console.error('[Server] 定时预制服务初始化失败:', error.message)
  }

  // 打印设备信息
  const deviceInfo = getDeviceInfo()
  console.log('[Server] 设备信息:')
  console.log(`  设备指纹: ${deviceInfo.fingerprint}`)
  console.log(`  主机名: ${deviceInfo.hostname}`)
  console.log(`  用户名: ${deviceInfo.username}`)
  console.log(`  系统: ${deviceInfo.platform}`)

  // 添加错误处理中间件
  app.use((err, req, res, next) => {
    console.error('[Server] 请求处理错误:', err)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  })

  // 处理404 - API路由未找到
  app.use('/api', (req, res) => {
    console.log('[Server] API路由未找到:', req.method, req.path)
    res.status(404).json({ success: false, error: 'API接口不存在' })
  })

  // 从配置文件读取端口
  const port = await getServerPort()
  const host = '0.0.0.0'
  console.log('[Server] 准备启动监听...')

  const server = app.listen(port, host, () => {
    const lanIp = getLanIp()
    const nodeVersion = process.version
    const env = process.env.NODE_ENV || 'development'

    console.log('\nDoBao-TTS 服务器启动成功')
    console.log(`  系统环境: Node.js ${nodeVersion} | ${env}`)
    console.log(`  服务端口: ${port}`)
    console.log(`  本地访问地址: http://127.0.0.1:${port}/`)
    console.log(`  局域网访问地址: http://${lanIp}:${port}/\n`)
  })

  // 启动用户统计定时任务
  try {
    const { startScheduler } = await import('./services/userStatsService.js')
    startScheduler(2 * 60 * 60 * 1000)
    console.log('[Server] 用户统计定时任务已启动')
  } catch (err) {
    console.error('[Server] 启动用户统计任务失败:', err.message)
  }

  // 优雅关闭处理
  async function gracefulShutdown(signal) {
    console.log(`\n[Server] 收到 ${signal} 信号，关闭服务...`)

    // 暂停所有定时预制任务
    try {
      console.log('[Server] 正在暂停所有定时预制任务...')
      await scheduledPrefetchService.pauseAllTasks()
      console.log('[Server] 所有定时预制任务已暂停')
    } catch (error) {
      console.error('[Server] 暂停定时预制任务失败:', error.message)
    }

    // 关闭 HTTP 服务器
    server.close(() => {
      console.log('[Server] HTTP 服务器已关闭')
      process.exit(0)
    })

    // 超时强制退出
    setTimeout(() => {
      console.error('[Server] 关闭超时，强制退出')
      process.exit(1)
    }, 10000)
  }

  // 监听关闭信号
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

  // 全局错误处理器 - 防止未捕获的异常导致服务器崩溃
  process.on('uncaughtException', (error) => {
    log('error', '未捕获的异常（服务器继续运行）', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    })
    // 不退出进程，让服务器继续运行
  })

  process.on('unhandledRejection', (reason, promise) => {
    log('error', '未处理的Promise拒绝（服务器继续运行）', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack?.split('\n').slice(0, 5).join('\n') : 'N/A'
    })
    // 不退出进程，让服务器继续运行
  })
}

main().catch((err) => {
  log('error', '服务器启动失败', { err: String(err) })
  process.exit(1)
})
