import { Router } from 'express'
import { configService } from '../services/configService.js'
import { log, logError } from '../utils/logger.js'
import { sendSuccess, sendError } from '../utils/apiResponse.js'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import AdmZip from 'adm-zip'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const settingsRouter = Router()

/**
 * 获取当前平台
 * @returns {string} 平台标识 ('win32', 'linux', 'android', 'darwin')
 */
function getPlatform() {
  return process.platform
}

/**
 * 检查是否为 Android 环境
 * @returns {boolean} 是否为 Android
 */
function isAndroid() {
  const platform = getPlatform()
  // Android 上 process.platform 返回 'android' 或 'linux'
  if (platform === 'android') return true
  // 检查 Android 特有的环境变量
  if (process.env.ANDROID_ROOT || process.env.ANDROID_DATA) return true
  // 检查 Termux 环境
  if (process.env.PREFIX && process.env.PREFIX.includes('termux')) return true
  return false
}

/**
 * 删除目录递归
 * @param {string} dirPath - 目录路径
 */
function deleteRecursive(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file)
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteRecursive(curPath)
      } else {
        fs.unlinkSync(curPath)
      }
    })
    fs.rmdirSync(dirPath)
  }
}

/**
 * 验证 ZIP 文件完整性
 * @param {string} zipPath - ZIP 文件路径
 * @returns {{valid: boolean, error?: string}} 验证结果
 */
function validateZipFile(zipPath) {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(zipPath)) {
      return { valid: false, error: '文件不存在' }
    }

    const stats = fs.statSync(zipPath)

    // 检查文件大小
    if (stats.size === 0) {
      return { valid: false, error: '文件为空' }
    }

    // 读取文件末尾的 ZIP 结束标记
    // ZIP 文件的结束标记是 0x06054b50 (PK\x05\x06)
    const fd = fs.openSync(zipPath, 'r')
    const buffer = Buffer.alloc(22) // ZIP 文件结束记录最小 22 字节

    // 尝试读取文件末尾 22 字节
    const readSize = Math.min(stats.size, 65557) // 最大注释长度 + 22
    const readBuffer = Buffer.alloc(readSize)

    fs.readSync(fd, readBuffer, 0, readSize, stats.size - readSize)
    fs.closeSync(fd)

    // 查找 ZIP 结束标记
    const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]) // PK\x05\x06
    const signatureIndex = readBuffer.indexOf(endSignature)

    if (signatureIndex === -1) {
      return { valid: false, error: 'ZIP 文件格式错误：缺少结束标记，文件可能损坏或未完整上传' }
    }

    // 尝试用 AdmZip 打开验证
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()
      if (!entries || entries.length === 0) {
        return { valid: false, error: 'ZIP 文件为空或无法读取内容' }
      }
      return { valid: true, entriesCount: entries.length }
    } catch (admError) {
      return { valid: false, error: `ZIP 文件解析失败: ${admError.message}` }
    }
  } catch (error) {
    return { valid: false, error: `验证失败: ${error.message}` }
  }
}

/**
 * 检查更新包平台兼容性
 * @param {string} zipPath - 更新包路径
 * @param {string} tempDir - 临时目录
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function checkUpdatePackagePlatform(zipPath, tempDir) {
  try {
    // 首先验证 ZIP 文件完整性
    const validation = validateZipFile(zipPath)
    if (!validation.valid) {
      log('error', '更新包验证失败', { error: validation.error })
      return { success: false, message: `更新包验证失败: ${validation.error}` }
    }

    log('info', '更新包验证通过', { entriesCount: validation.entriesCount })

    // 解压 .platform 文件到临时目录
    const zip = new AdmZip(zipPath)

    // 查找 .platform 文件（可能在嵌套目录中）
    const allEntries = zip.getEntries()
    log('info', '更新包内容', { entries: allEntries.slice(0, 10).map(e => e.entryName) })

    const platformEntry = allEntries.find(entry =>
      entry.entryName.endsWith('.platform') &&
      !entry.isDirectory
    )

    // 如果没有平台标识文件，允许更新（向后兼容）
    if (!platformEntry) {
      log('warn', '更新包没有平台标识文件，跳过平台检查')
      return { success: true, message: '跳过平台检查' }
    }

    // 读取平台标识文件
    const platformContent = platformEntry.getData().toString('utf8')
    log('info', '平台标识文件内容', { content: platformContent })

    const platformInfo = JSON.parse(platformContent)
    const currentPlatform = process.platform
    const updatePlatform = platformInfo.platform

    log('info', '平台检查', { current: currentPlatform, update: updatePlatform, platformInfo })

    // 标准化平台标识
    const normalizePlatform = (p) => {
      if (p === 'win32' || p === 'win') return 'win'
      return p
    }

    const normalizedCurrent = normalizePlatform(currentPlatform)
    const normalizedUpdate = normalizePlatform(updatePlatform)

    log('info', '标准化平台标识', { normalizedCurrent, normalizedUpdate })

    // Windows 只能更新 Windows 包
    if (normalizedCurrent === 'win' && normalizedUpdate !== 'win') {
      return {
        success: false,
        message: '平台不兼容：Windows 只能使用 Windows 更新包（DoBao-TTS-Win.zip）'
      }
    }

    // Android 只能更新 Android 包
    if (normalizedCurrent !== 'win' && normalizedUpdate === 'win') {
      return {
        success: false,
        message: '平台不兼容：Android 只能使用 Android 更新包（DoBao-TTS-Android.zip）'
      }
    }

    log('info', '平台检查通过')
    return { success: true, message: '平台检查通过' }
  } catch (err) {
    log('warn', '检查更新包平台失败', { error: err.message, stack: err.stack })
    return { success: true, message: '检查失败，允许更新' }
  }
}

/**
 * 获取系统配置
 * GET /api/settings
 * 返回当前系统配置
 */
settingsRouter.get('/settings', async (req, res) => {
  try {
    const config = await configService.getConfig()
    return sendSuccess(res, config)
  } catch (err) {
    logError(err, { route: 'settings/get' })
    const errorMsg = err?.message || err || '未知错误'
    return sendError(res, '获取配置失败: ' + errorMsg, 500)
  }
})

/**
 * 更新系统配置
 * POST /api/settings
 * 批量更新系统配置
 */
settingsRouter.post('/settings', async (req, res) => {
  try {
    const updates = req.body
    
    if (!updates || typeof updates !== 'object') {
      return sendError(res, '无效的请求数据', 400)
    }
    
    await configService.update(updates)
    const config = await configService.getConfig()
    
    return sendSuccess(res, config, '配置更新成功')
  } catch (err) {
    logError(err, { route: 'settings/update' })
    const errorMsg = err?.message || err || '未知错误'
    return sendError(res, '更新配置失败: ' + errorMsg, 500)
  }
})

/**
 * 更新单个配置项
 * PUT /api/settings/item
 * 更新指定路径的配置值
 */
settingsRouter.put('/settings/item', async (req, res) => {
  try {
    const { path, value } = req.body
    
    if (!path || value === undefined) {
      return sendError(res, '缺少path或value参数', 400)
    }
    
    await configService.set(path, value)
    
    return sendSuccess(res, { path, value }, '配置项更新成功')
  } catch (err) {
    logError(err, { route: 'settings/set' })
    const errorMsg = err?.message || err || '未知错误'
    return sendError(res, '更新配置项失败: ' + errorMsg, 500)
  }
})

/**
 * 获取单个配置项
 * GET /api/settings/item
 * 获取指定路径的配置值
 */
settingsRouter.get('/settings/item', async (req, res) => {
  try {
    const { path, default: defaultValue } = req.query
    
    if (!path) {
      return sendError(res, '缺少path参数', 400)
    }
    
    const value = await configService.get(path, defaultValue)
    
    return sendSuccess(res, { path, value })
  } catch (err) {
    logError(err, { route: 'settings/get-item' })
    const errorMsg = err?.message || err || '未知错误'
    return sendError(res, '获取配置项失败: ' + errorMsg, 500)
  }
})

/**
 * 重置配置为默认值
 * POST /api/settings/reset
 * 重置所有配置为默认值
 */
settingsRouter.post('/settings/reset', async (req, res) => {
  try {
    await configService.reset()
    const config = await configService.getConfig()

    return sendSuccess(res, config, '配置已重置为默认值')
  } catch (err) {
    logError(err, { route: 'settings/reset' })
    const errorMsg = err?.message || err || '未知错误'
    return sendError(res, '重置配置失败: ' + errorMsg, 500)
  }
})

/**
 * 获取应用根目录（兼容开发环境和pkg打包环境）
 * @returns {string} 应用根目录
 */
function getAppRoot() {
  if (process.pkg) {
    return process.cwd()
  }
  return process.cwd()
}

/**
 * 递归查找实际的更新内容目录
 * 有时更新包会包含多层嵌套的顶层文件夹（如 DoBao-TTS-Win/DoBao-TTS）
 * @param {string} dirPath - 要检查的目录路径
 * @param {number} depth - 递归深度，防止无限循环
 * @returns {string} 实际包含更新内容的目录
 */
function findActualContentDir(dirPath, depth = 0) {
  // 防止无限递归，限制最大深度为3
  if (depth > 3) {
    return dirPath
  }

  const entries = fs.readdirSync(dirPath)

  // 检查是否包含关键目录（表示这是实际内容目录）
  const keyDirs = ['app', 'public', 'src', 'scripts', 'config']
  const hasKeyDir = entries.some(entry => {
    try {
      const entryPath = path.join(dirPath, entry)
      const stat = fs.statSync(entryPath)
      return stat.isDirectory() && keyDirs.includes(entry)
    } catch {
      return false
    }
  })

  // 如果找到关键目录，返回当前目录
  if (hasKeyDir) {
    return dirPath
  }

  // 查找子目录中是否包含关键目录
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry)
    try {
      const stat = fs.statSync(entryPath)
      if (stat.isDirectory()) {
        const subEntries = fs.readdirSync(entryPath)
        const subHasKeyDir = subEntries.some(subEntry => {
          try {
            const subEntryPath = path.join(entryPath, subEntry)
            const subStat = fs.statSync(subEntryPath)
            return subStat.isDirectory() && keyDirs.includes(subEntry)
          } catch {
            return false
          }
        })
        
        if (subHasKeyDir) {
          return findActualContentDir(entryPath, depth + 1)
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  // 如果只有一个文件夹且没有找到关键目录，尝试进入该文件夹
  if (entries.length === 1) {
    const singleEntry = path.join(dirPath, entries[0])
    try {
      const stat = fs.statSync(singleEntry)
      if (stat.isDirectory()) {
        return findActualContentDir(singleEntry, depth + 1)
      }
    } catch {
      // 如果无法访问，返回原目录
    }
  }

  return dirPath
}

/**
 * 系统更新接口
 * POST /api/settings/update
 * 接收更新包并启动更新流程
 */
settingsRouter.post('/settings/update', async (req, res) => {
  let updatePackagePath = null
  let tempDir = null

  try {
    log('info', '开始处理系统更新请求')

    // 检查是否有文件上传
    if (!req.files || !req.files.updatePackage) {
      return sendError(res, '请上传更新包文件', 400)
    }

    const updateFile = req.files.updatePackage
    const appRoot = getAppRoot()
    const updateDir = path.join(appRoot, 'update')
    tempDir = path.join(updateDir, 'temp')

    // 验证上传文件大小
    if (!updateFile.size || updateFile.size === 0) {
      return sendError(res, '上传的文件为空', 400)
    }

    // 检查文件是否被截断（express-fileupload 会在文件超过限制时截断）
    if (updateFile.truncated) {
      log('error', '更新包上传被截断', { size: updateFile.size, expected: updateFile.size })
      return sendError(res, '文件上传不完整，请检查文件大小是否超过500MB限制', 400)
    }

    log('info', '收到更新包', {
      name: updateFile.name,
      size: updateFile.size,
      mimetype: updateFile.mimetype,
      truncated: updateFile.truncated
    })

    // 确保更新目录存在
    if (!fs.existsSync(updateDir)) {
      fs.mkdirSync(updateDir, { recursive: true })
    }
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    // 保存更新包
    updatePackagePath = path.join(updateDir, 'update.zip')
    await updateFile.mv(updatePackagePath)

    log('info', '更新包已保存', { path: updatePackagePath, size: updateFile.size })

    // 验证更新包文件是否存在
    if (!fs.existsSync(updatePackagePath)) {
      return sendError(res, '更新包保存失败', 500)
    }

    // 验证文件大小匹配
    const savedStats = fs.statSync(updatePackagePath)
    if (savedStats.size !== updateFile.size) {
      log('error', '文件大小不匹配', { expected: updateFile.size, actual: savedStats.size })
      try {
        fs.unlinkSync(updatePackagePath)
      } catch (e) {}
      return sendError(res, '文件保存不完整，请重新上传', 500)
    }

    // 检查平台兼容性（包含 ZIP 完整性验证）
    const platformCheck = await checkUpdatePackagePlatform(updatePackagePath, tempDir)
    if (!platformCheck.success) {
      // 删除不兼容的更新包
      try {
        fs.unlinkSync(updatePackagePath)
        deleteRecursive(tempDir)
      } catch (e) {
        // 忽略清理错误
      }
      return sendError(res, platformCheck.message, 400)
    }

    // 解压更新包到临时目录
    log('info', '解压更新包到临时目录...')
    const zip = new AdmZip(updatePackagePath)
    zip.extractAllTo(tempDir, true)
    log('info', '更新包解压完成')

    // 查找实际的更新内容目录（处理嵌套结构）
    const actualContentPath = findActualContentDir(tempDir)
    log('info', '找到实际更新内容目录', { path: actualContentPath })

    // 从更新包中查找 updater.js
    const updateScriptPath = path.join(actualContentPath, 'scripts', 'updater.js')

    // 检查更新脚本是否存在
    if (!fs.existsSync(updateScriptPath)) {
      log('error', '更新包中不存在更新脚本', { path: updateScriptPath })
      // 清理临时文件
      try {
        deleteRecursive(tempDir)
        fs.unlinkSync(updatePackagePath)
      } catch (e) {
        // 忽略清理错误
      }
      return sendError(res, '更新包中不存在更新脚本，请检查更新包完整性', 500)
    }

    log('info', '找到更新包中的更新脚本', { script: updateScriptPath })

    // 获取 Node.js 可执行文件路径
    const nodePath = process.execPath
    log('info', '使用 Node.js 路径', { nodePath })

    // 启动更新进程（使用更新包中的 updater.js）
    // 传递 actualContentPath 而不是 updatePackagePath，这样更新脚本就不需要再次解压
    log('info', '启动更新脚本', { script: updateScriptPath, appRoot, contentPath: actualContentPath })

    let updateProcess
    if (isAndroid()) {
      // Android/Termux 环境：直接使用 spawn 启动 node 进程
      // 不使用 shell 命令，避免引号转义问题
      log('info', 'Android环境：直接启动更新进程')
      
      // 先给更新脚本添加执行权限
      try {
        fs.chmodSync(updateScriptPath, 0o755)
        log('info', '已给更新脚本添加执行权限')
      } catch (e) {
        log('warn', '添加执行权限失败', { error: e.message })
      }
      
      // 直接使用 spawn 启动 node 进程
      // 注意：在 Android 上 detached 模式可能不支持，所以使用同步方式
      // 更新脚本会自己处理停止主服务的逻辑
      log('info', '启动更新进程', { 
        nodePath, 
        script: updateScriptPath, 
        contentPath: actualContentPath,
        appRoot 
      })
      
      updateProcess = spawn(nodePath, [updateScriptPath, actualContentPath, appRoot], {
        detached: false,
        stdio: 'inherit',
        cwd: appRoot
      })
      
      log('info', '更新进程已启动（Android模式）', { pid: updateProcess.pid })
    } else {
      // Windows 环境：使用 cmd /c start 在新窗口中启动
      log('info', 'Windows环境：使用新窗口启动更新进程')
      updateProcess = spawn('cmd', ['/c', 'start', 'DoBao-TTS Updater', nodePath, updateScriptPath, actualContentPath, appRoot], {
        detached: true,
        windowsHide: false,
        cwd: appRoot
      })
      log('info', '更新进程已启动（Windows新窗口模式）', { pid: updateProcess.pid, command: `cmd /c start ${nodePath} ${updateScriptPath} ${actualContentPath} ${appRoot}` })
    }

    // 监听进程退出
    updateProcess.on('exit', (code) => {
      log('info', '更新进程已退出', { code })
    })

    updateProcess.on('error', (err) => {
      log('error', '更新进程启动失败', { error: err.message })
    })

    // 返回成功响应
    return sendSuccess(res, {
      message: '更新已启动',
      pid: updateProcess.pid
    }, '系统更新已启动，请在终端日志完成更新后手动重启项目')

  } catch (err) {
    logError(err, { route: 'settings/update' })
    const errorMsg = err?.message || err || '未知错误'

    // 发生错误时清理临时文件
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        deleteRecursive(tempDir)
        log('info', '已清理临时目录', { tempDir })
      }
      if (updatePackagePath && fs.existsSync(updatePackagePath)) {
        fs.unlinkSync(updatePackagePath)
        log('info', '已删除更新包', { updatePackagePath })
      }
    } catch (cleanupErr) {
      log('warn', '清理临时文件失败', { error: cleanupErr.message })
    }

    return sendError(res, '更新失败: ' + errorMsg, 500)
  }
})
