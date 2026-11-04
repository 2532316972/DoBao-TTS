#!/usr/bin/env node

/**
 * DoBao TTS 独立更新脚本
 * 该脚本独立于主项目运行，负责解压更新包并替换文件
 * 然后重启主服务
 */

import fs from 'fs'
import path from 'path'
import { spawn, exec } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 更新脚本版本号，以后修改此脚本需手动更新此版本号
 */
const UPDATER_VERSION = 'v1.0.0'

/**
 * 应用根目录（从命令行参数获取）
 */
let appRootPath = null

/**
 * 封装 exec 为 Promise
 * @param {string} cmd - 要执行的命令
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
  })
}

/**
 * 日志文件路径
 */
let logFilePath = null

/**
 * 初始化日志系统
 * @param {string} appRoot - 应用根目录
 */
function initLogger(appRoot) {
  appRootPath = appRoot
  const logDir = path.join(appRootPath, 'logs')

  // 确保日志目录存在
  if (!fs.existsSync(logDir)) {
    try {
      fs.mkdirSync(logDir, { recursive: true })
    } catch (err) {
      console.error('创建日志目录失败:', err.message)
    }
  }

  logFilePath = path.join(logDir, 'update.log')

  // 写入启动标记
  const startMarker = `
========================================
更新程序启动: ${new Date().toISOString()}
应用根目录: ${appRoot}
========================================
`
  try {
    fs.appendFileSync(logFilePath, startMarker)
  } catch (err) {
    console.error('写入日志失败:', err.message)
  }
}

/**
 * 日志函数
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 */
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    level,
    message,
    ...data
  }

  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message} ${data && Object.keys(data).length > 0 ? JSON.stringify(data) : ''}`
  console.log(logLine)

  // 写入日志文件
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, logLine + '\n')
    } catch (err) {
      console.error('写入日志文件失败:', err.message)
    }
  }
}

/**
 * 等待指定时间
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 检测当前平台
 * @returns {string} 'win32', 'linux', 'darwin', 'android'
 */
function getPlatform() {
  return process.platform
}

/**
 * 检测是否为Android (Termux)
 * @returns {boolean}
 */
function isAndroid() {
  // Termux 环境检测
  return process.env.TERMUX_VERSION !== undefined ||
         process.env.PREFIX?.includes('termux') ||
         process.platform === 'android'
}

/**
 * 查找并终止主服务进程
 * @param {string} appRoot - 应用根目录
 */
async function stopMainService(appRoot) {
  log('info', '正在查找主服务进程...', { platform: getPlatform(), isAndroid: isAndroid() })
  console.log('[Updater] 正在查找主服务进程...')
  console.log('[Updater] 平台:', getPlatform(), '是否Android:', isAndroid())

  const platform = getPlatform()

  try {
    // 根据平台选择不同的命令
    let command
    if (platform === 'win32') {
      // Windows 使用 tasklist
      command = 'tasklist /FI "IMAGENAME eq node.exe" /FO CSV'
    } else {
      // Linux/Android 使用 ps
      command = 'ps aux | grep "node" | grep -v grep'
    }
    console.log('[Updater] 执行命令:', command)

    let stdout
    try {
      console.log('[Updater] 正在执行进程查询命令...')
      const result = await execPromise(command)
      stdout = result.stdout
      console.log('[Updater] 进程查询结果:', stdout.substring(0, 500))
    } catch (error) {
      // Android上，没有找到进程也是正常的
      log('info', 'Android环境：未找到需要终止的进程')
      console.log('[Updater] Android环境：未找到需要终止的进程')
      return
    }

    const nodeProcesses = []

    if (platform === 'win32') {
      // Windows: 解析CSV输出
      const lines = stdout.split('\n').filter(line => line.trim())
      const currentPid = String(process.pid)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        const match = line.match(/"node.exe","(\d+)"/)
        if (match) {
          const pid = match[1]
          // 排除当前更新脚本进程
          if (pid !== currentPid) {
            nodeProcesses.push(pid)
          } else {
            log('info', `跳过当前更新脚本进程 PID: ${pid}`)
          }
        }
      }
    } else {
      // Linux/Android: 解析ps输出
      const lines = stdout.split('\n').filter(line => line.trim())
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length > 1) {
          const pid = parts[1]
          // 排除当前更新脚本进程
          if (pid !== String(process.pid)) {
            nodeProcesses.push(pid)
          }
        }
      }
    }

    log('info', `找到 ${nodeProcesses.length} 个Node进程`, { pids: nodeProcesses })
    console.log('[Updater] 找到', nodeProcesses.length, '个Node进程:', nodeProcesses)

    if (nodeProcesses.length === 0) {
      console.log('[Updater] 没有找到需要终止的进程')
      return
    }

    // 终止所有node进程
    let killedCount = 0
    console.log('[Updater] 开始终止进程...')
    for (const pid of nodeProcesses) {
      try {
        console.log('[Updater] 正在终止进程 PID:', pid)
        if (platform === 'win32') {
          // Windows: 使用 taskkill /T 终止进程及其子进程，/F 强制终止
          // 先尝试正常终止（不使用 /F），给进程机会清理
          try {
            await execPromise(`taskkill /PID ${pid} /T`)
            log('info', `已正常终止进程 PID: ${pid}`)
            console.log('[Updater] 已正常终止进程 PID:', pid)
          } catch (err) {
            // 如果正常终止失败，强制终止
            log('info', `正常终止失败，尝试强制终止 PID: ${pid}`)
            console.log('[Updater] 正常终止失败，尝试强制终止 PID:', pid)
            await execPromise(`taskkill /PID ${pid} /T /F`)
            log('info', `已强制终止进程 PID: ${pid}`)
            console.log('[Updater] 已强制终止进程 PID:', pid)
          }
        } else {
          // Linux/Android: 使用 kill
          process.kill(parseInt(pid), 'SIGTERM')
          log('info', `已终止进程 PID: ${pid}`)
          console.log('[Updater] 已终止进程 PID:', pid)
        }
        killedCount++
      } catch (err) {
        log('warn', `终止进程失败 PID: ${pid}`, { error: err.message })
        console.error('[Updater] 终止进程失败 PID:', pid, '错误:', err.message)
      }
    }

    log('info', `已终止 ${killedCount} 个进程`)
    console.log('[Updater] 已终止', killedCount, '个进程')

    // 给进程一些时间来终止
    console.log('[Updater] 等待2秒让进程完全终止...')
    await sleep(2000)
    console.log('[Updater] 进程终止等待完成')
  } catch (err) {
    log('error', '停止服务时出错', { error: err.message })
    console.error('[Updater] 停止服务时出错:', err.message)
    throw err
  }
}

/**
 * 解压更新包
 * @param {string} zipPath - 更新包路径
 * @param {string} extractPath - 解压目标路径
 */
async function extractUpdatePackage(zipPath, extractPath) {
  log('info', '开始解压更新包', { zipPath, extractPath })
  console.log('[Updater] 开始解压更新包:', zipPath)
  console.log('[Updater] 解压目标路径:', extractPath)

  try {
    // 确保解压目录存在
    if (!fs.existsSync(extractPath)) {
      log('info', '创建解压目录')
      console.log('[Updater] 创建解压目录')
      fs.mkdirSync(extractPath, { recursive: true })
    }

    // 清空解压目录
    log('info', '清空解压目录')
    console.log('[Updater] 清空解压目录')
    const entries = fs.readdirSync(extractPath)
    for (const entry of entries) {
      const entryPath = path.join(extractPath, entry)
      deleteRecursive(entryPath)
    }

    // 使用系统命令解压（不依赖 adm-zip）
    const platform = getPlatform()
    log('info', '使用平台命令解压', { platform })
    console.log('[Updater] 使用平台命令解压:', platform)

    if (platform === 'win32') {
      // Windows: 使用 PowerShell
      log('info', '使用 PowerShell 解压')
      console.log('[Updater] 使用 PowerShell 解压')
      await new Promise((resolve, reject) => {
        const psCommand = `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force`
        log('info', 'PowerShell 命令', { command: psCommand })
        console.log('[Updater] PowerShell 命令:', psCommand)
        const child = spawn('powershell', ['-Command', psCommand], {
          stdio: 'pipe',
          shell: true
        })

        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (data) => {
          stdout += data.toString()
          console.log('[Updater] PowerShell stdout:', data.toString().trim())
        })

        child.stderr.on('data', (data) => {
          stderr += data.toString()
          console.error('[Updater] PowerShell stderr:', data.toString().trim())
        })

        child.on('close', (code) => {
          log('info', 'PowerShell 进程退出', { code })
          console.log('[Updater] PowerShell 进程退出，code:', code)
          if (code === 0) {
            log('info', 'PowerShell 解压完成')
            console.log('[Updater] PowerShell 解压完成')
            resolve()
          } else {
            const error = new Error(`PowerShell 解压失败: ${stderr || stdout}`)
            console.error('[Updater] PowerShell 解压失败:', stderr || stdout)
            reject(error)
          }
        })

        child.on('error', (err) => {
          console.error('[Updater] PowerShell 进程错误:', err.message)
          reject(err)
        })
      })
    } else {
      // Linux/Android/macOS: 使用 unzip
      log('info', '使用 unzip 命令解压')

      await new Promise((resolve, reject) => {
        const child = spawn('unzip', ['-o', zipPath, '-d', extractPath], {
          stdio: 'pipe'
        })

        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (data) => {
          stdout += data.toString()
        })

        child.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        child.on('close', (code) => {
          log('info', 'unzip 进程退出', { code, stdout: stdout.substring(0, 500), stderr: stderr.substring(0, 500) })
          // code 0: 成功
          // code 1: 有警告但成功（如 backslashes 警告）
          // code 2: 有错误
          if (code === 0 || code === 1) {
            if (code === 1) {
              log('warn', 'unzip 有警告但解压成功', { stderr })
            }
            log('info', 'unzip 解压完成')
            resolve()
          } else {
            reject(new Error(`unzip 解压失败 (code: ${code}): ${stderr || stdout}`))
          }
        })

        child.on('error', (err) => {
          log('error', 'unzip 进程错误', { error: err.message })
          reject(err)
        })
      })
    }

    log('info', '更新包解压完成')
    return true
  } catch (err) {
    log('error', '解压更新包失败', { error: err.message })
    throw err
  }
}

/**
 * 复制文件或目录
 * @param {string} src - 源路径
 * @param {string} dest - 目标路径
 */
function copyRecursive(src, dest) {
  const stats = fs.statSync(src)

  if (stats.isDirectory()) {
    // 创建目标目录
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }

    // 递归复制子文件和子目录
    const entries = fs.readdirSync(src)
    for (const entry of entries) {
      const srcPath = path.join(src, entry)
      const destPath = path.join(dest, entry)
      copyRecursive(srcPath, destPath)
    }
  } else {
    // 复制文件
    fs.copyFileSync(src, dest)
  }
}

/**
 * 删除文件或目录
 * @param {string} target - 目标路径
 */
function deleteRecursive(target) {
  if (!fs.existsSync(target)) {
    return
  }

  let stats
  try {
    stats = fs.statSync(target)
  } catch (err) {
    // 如果无法访问（如中文文件名编码问题），记录警告并跳过
    log('warn', `无法访问文件/目录，跳过删除: ${target}`, { error: err.message })
    return
  }

  if (stats.isDirectory()) {
    const entries = fs.readdirSync(target)
    for (const entry of entries) {
      const entryPath = path.join(target, entry)
      deleteRecursive(entryPath)
    }
    try {
      fs.rmdirSync(target)
    } catch (err) {
      log('warn', `删除目录失败: ${target}`, { error: err.message })
    }
  } else {
    try {
      fs.unlinkSync(target)
    } catch (err) {
      log('warn', `删除文件失败: ${target}`, { error: err.message })
    }
  }
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
    log('warn', '达到最大递归深度，返回当前目录')
    return dirPath
  }

  const entries = fs.readdirSync(dirPath)
  log('info', `检查目录层级 ${depth}: ${dirPath}`, { entries: entries.slice(0, 10) })

  // 检查是否包含关键目录（表示这是实际内容目录）
  const keyDirs = ['app', 'public', 'src', 'scripts', 'config', 'routes', 'services', 'utils']
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
    log('info', `找到实际内容目录（深度 ${depth}）: ${dirPath}`)
    return dirPath
  }

  // 查找子目录中是否包含关键目录（处理 DoBao-TTS-Win/ 这种结构）
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry)
    try {
      const stat = fs.statSync(entryPath)
      if (stat.isDirectory()) {
        // 检查这个子目录是否包含关键目录
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
          log('info', `在子目录中找到实际内容目录: ${entry}`)
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
        log('info', `检测到嵌套目录，进入: ${entries[0]}`)
        return findActualContentDir(singleEntry, depth + 1)
      }
    } catch {
      // 如果无法访问，返回原目录
    }
  }

  // 如果没有找到关键目录但有多于一个条目，返回当前目录
  // （可能是更新包格式不同，让调用方处理）
  log('warn', `未找到关键目录，可能需要手动检查: ${dirPath}`)
  return dirPath
}

/**
 * 检查平台兼容性
 * @param {string} actualContentPath - 实际更新内容路径
 * @returns {boolean} 是否兼容
 */
function checkPlatformCompatibility(actualContentPath) {
  const platformFile = path.join(actualContentPath, '.platform')

  // 如果没有平台标识文件，允许更新（向后兼容）
  if (!fs.existsSync(platformFile)) {
    log('warn', '更新包没有平台标识文件，跳过平台检查')
    return true
  }

  try {
    const platformInfo = JSON.parse(fs.readFileSync(platformFile, 'utf8'))
    const currentPlatform = getPlatform()
    const updatePlatform = platformInfo.platform

    log('info', '平台检查', { current: currentPlatform, update: updatePlatform })

    // 标准化平台标识
    // win32 -> win, android -> android, linux -> linux, darwin -> darwin
    const normalizePlatform = (p) => {
      if (p === 'win32' || p === 'win') return 'win'
      return p
    }

    const normalizedCurrent = normalizePlatform(currentPlatform)
    const normalizedUpdate = normalizePlatform(updatePlatform)

    // Windows 只能更新 Windows 包
    if (normalizedCurrent === 'win' && normalizedUpdate !== 'win') {
      log('error', '平台不兼容', { reason: 'Windows 只能使用 Windows 更新包' })
      return false
    }

    // Android 只能更新 Android 包
    if (normalizedCurrent !== 'win' && normalizedUpdate === 'win') {
      log('error', '平台不兼容', { reason: 'Android 只能使用 Android 更新包' })
      return false
    }

    log('info', '平台检查通过')
    return true
  } catch (err) {
    log('warn', '读取平台标识文件失败', { error: err.message })
    return true // 出错时允许更新
  }
}

/**
 * 递归遍历并复制所有文件
 * @param {string} srcDir - 源目录
 * @param {string} destDir - 目标目录
 * @param {Array} preserveDirs - 需要保留的目录名列表
 * @param {string} appRoot - 应用根目录（用于日志）
 * @param {number} depth - 递归深度（用于日志缩进）
 * @param {Array} preserveFiles - 需要保留的特定文件名列表
 * @param {string} parentDir - 父目录名（用于判断是否在保留目录内）
 * @returns {number} 复制的文件数量
 */
function copyAllFilesRecursive(srcDir, destDir, preserveDirs, appRoot, depth = 0, preserveFiles = [], parentDir = '') {
  let fileCount = 0
  const indent = '  '.repeat(depth)

  if (!fs.existsSync(srcDir)) {
    return fileCount
  }

  const entries = fs.readdirSync(srcDir)

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry)
    const destPath = path.join(destDir, entry)
    const currentParent = path.basename(srcDir)

    // 检查文件/目录是否存在，处理中文文件名编码问题
    let stats
    try {
      stats = fs.statSync(srcPath)
    } catch (statErr) {
      // 如果无法访问（如中文文件名编码问题），记录警告并跳过
      log('warn', `${indent}无法访问文件/目录，跳过: ${entry}`, { error: statErr.message })
      console.log(`[Updater] 警告: 无法访问文件/目录，跳过: ${entry}`)
      continue
    }

    // 跳过保留目录
    if (stats.isDirectory() && preserveDirs.includes(entry)) {
      log('info', `${indent}跳过保留目录: ${entry}`)
      continue
    }

    if (stats.isDirectory()) {
      // 创建目标子目录
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      // 递归复制子目录
      fileCount += copyAllFilesRecursive(srcPath, destPath, preserveDirs, appRoot, depth + 1, preserveFiles, currentParent)
    } else {
      // 检查是否需要保留此文件
      const shouldPreserve = preserveFiles.includes(entry) ||
                            (parentDir === 'config' && preserveFiles.includes(entry))

      if (shouldPreserve) {
        // 如果目标文件存在，保留不覆盖
        if (fs.existsSync(destPath)) {
          log('info', `${indent}保留用户文件: ${path.relative(appRoot, destPath)}`)
        } else {
          // 目标文件不存在则复制（首次安装场景）
          fs.copyFileSync(srcPath, destPath)
          fileCount++
          log('info', `${indent}复制新文件: ${path.relative(appRoot, srcPath)}`)
        }
        continue
      }

      // 复制文件
      const relativePath = path.relative(appRoot, srcPath)

      // 如果目标文件存在，先删除
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath)
      }

      // 复制文件
      fs.copyFileSync(srcPath, destPath)
      fileCount++

      // 每复制10个文件记录一次日志，避免日志过多
      if (fileCount % 10 === 1 || depth <= 1) {
        log('info', `${indent}复制文件: ${relativePath}`)
      }
    }
  }

  return fileCount
}

/**
 * 执行文件更新
 * @param {string} extractPath - 解压后的更新文件路径
 * @param {string} appRoot - 应用根目录
 * @returns {string} 实际的更新内容目录路径
 */
async function performUpdate(extractPath, appRoot) {
  log('info', '开始执行文件更新', { extractPath, appRoot })

  try {
    // 查找实际的更新内容目录（处理嵌套结构）
    const actualContentPath = findActualContentDir(extractPath)
    log('info', '实际更新内容路径', { path: actualContentPath })

    // 检查平台兼容性
    if (!checkPlatformCompatibility(actualContentPath)) {
      throw new Error('更新包平台与当前系统不兼容')
    }

    // 列出解压后的文件（递归统计）
    const entries = fs.readdirSync(actualContentPath)
    log('info', '更新包顶层内容', { entries })

    // 需要保留的目录（不覆盖）- 这些只在应用根目录下生效
    // audio: 用户音频文件目录（根目录下的 audio/，不是 src/services/audio/）
    // logs: 日志文件
    // update: 更新相关文件
    // runtime: Windows 便携版 Node.js 运行时目录（正在运行的 node.exe 不能被覆盖）
    // 注意：scripts 目录现在也会更新（因为更新脚本从更新包中调用）
    // 注意：config 目录不再整体保留，而是只保留特定文件
    const preserveDirs = ['audio', 'logs', 'update', 'runtime']

    // 需要保留的特定文件（相对于应用根目录）
    // tts.json: 用户配置
    const preserveFiles = ['tts.json']

    // 需要保留的目录内的文件映射（config 目录下的特定文件）
    const preserveConfigFiles = ['tts.json']

    // 遍历更新包中的文件（递归复制所有文件和子目录）
    let totalCopied = 0
    for (const entry of entries) {
      const srcPath = path.join(actualContentPath, entry)
      const destPath = path.join(appRoot, entry)
      const stats = fs.statSync(srcPath)

      // 跳过保留目录（只在应用根目录下生效）
      if (preserveDirs.includes(entry)) {
        log('info', `跳过保留目录: ${entry}`)
        continue
      }

      // 如果目标存在，先删除
      if (fs.existsSync(destPath)) {
        log('info', `删除旧项目: ${entry}`)
        deleteRecursive(destPath)
      }

      if (stats.isDirectory()) {
        // 创建目标目录
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true })
        }
        // 递归复制目录中的所有文件
        // 注意：子目录中不再传递 preserveDirs，避免错误跳过 src/services/audio/ 这样的目录
        const copied = copyAllFilesRecursive(srcPath, destPath, [], appRoot, 1, preserveConfigFiles, entry)
        log('info', `目录 ${entry} 复制完成，共 ${copied} 个文件`)
        totalCopied += copied
      } else {
        // 复制单个文件
        fs.copyFileSync(srcPath, destPath)
        log('info', `复制文件: ${entry}`)
        totalCopied++
      }
    }

    log('info', '文件更新完成', { totalFiles: totalCopied })
    // 返回实际的更新内容目录路径，用于后续更新 scripts 目录
    return actualContentPath
  } catch (err) {
    log('error', '文件更新失败', { error: err.message })
    throw err
  }
}

/**
 * 安装依赖（仅 Windows）
 * @param {string} appRoot - 应用根目录
 */
async function installDependencies(appRoot) {
  // Android 跳过依赖安装（手动启动时会处理）
  if (isAndroid()) {
    log('info', 'Android 环境，跳过依赖安装（将在手动启动时处理）')
    return
  }

  log('info', '开始安装依赖...')

  const packageJsonPath = path.join(appRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    log('warn', 'package.json 不存在，跳过依赖安装', { path: packageJsonPath })
    return
  }

  return new Promise((resolve, reject) => {
    const npmInstall = spawn('npm', ['install'], {
      cwd: appRoot,
      stdio: 'pipe',
      shell: true
    })

    let output = ''
    npmInstall.stdout.on('data', (data) => {
      output += data.toString()
    })

    npmInstall.stderr.on('data', (data) => {
      output += data.toString()
    })

    npmInstall.on('close', (code) => {
      if (code === 0) {
        log('info', '依赖安装完成')
        resolve()
      } else {
        log('error', '依赖安装失败', { code, output })
        // 即使安装失败也继续，因为可能不需要新依赖
        resolve()
      }
    })

    npmInstall.on('error', (err) => {
      log('error', '依赖安装出错', { error: err.message })
      // 即使出错也继续
      resolve()
    })
  })
}

/**
 * 清理临时文件
 * @param {string} updateDir - 更新目录
 * @param {string} actualContentPath - 实际的更新内容目录路径（需要清理）
 */
async function cleanup(updateDir, actualContentPath) {
  log('info', '开始清理临时文件...')
  console.log('[Updater] 开始清理临时文件...')

  try {
    const tempDir = path.join(updateDir, 'temp')

    // 删除临时解压目录
    if (fs.existsSync(tempDir)) {
      deleteRecursive(tempDir)
      log('info', '已删除临时目录')
    }

    // 删除更新包
    const updatePackagePath = path.join(updateDir, 'update.zip')
    if (fs.existsSync(updatePackagePath)) {
      fs.unlinkSync(updatePackagePath)
      log('info', '已删除更新包')
    }

    // 删除 actualContentPath（如果它在 temp 目录下）
    if (actualContentPath && fs.existsSync(actualContentPath)) {
      // 检查 actualContentPath 是否在 temp 目录下
      if (actualContentPath.startsWith(tempDir)) {
        // 已经在 deleteRecursive(tempDir) 中删除了，不需要重复删除
        log('info', '更新内容目录已随临时目录一起删除')
      } else {
        // actualContentPath 不在 temp 目录下，单独删除
        deleteRecursive(actualContentPath)
        log('info', '已删除更新内容目录')
      }
    }

    log('info', '清理完成')
    console.log('[Updater] 清理完成')
  } catch (err) {
    log('warn', '清理临时文件时出错', { error: err.message })
    console.error('[Updater] 清理临时文件时出错:', err.message)
  }
}

/**
 * 主函数
 */
async function main() {
  // 获取命令行参数
  // 参数1: actualContentPath (后端已经解压好的更新内容目录)
  // 参数2: appRoot (应用根目录)
  const args = process.argv.slice(2)
  const actualContentPath = args[0]
  const appRoot = args[1] || process.cwd()

  // 首先初始化日志系统
  initLogger(appRoot)

  log('info', '================== DoBao TTS 更新程序 ==================')
  log('info', '更新程序启动', { version: UPDATER_VERSION, contentPath: actualContentPath, appRoot, args: process.argv })
  
  // 添加控制台输出以便实时查看
  console.log('[Updater] ==================================================')
  console.log('[Updater] DoBao TTS 更新程序')
  console.log('[Updater] 更新脚本版本:', UPDATER_VERSION)
  console.log('[Updater] ==================================================')
  console.log('[Updater] 更新内容路径:', actualContentPath)
  console.log('[Updater] 应用根目录:', appRoot)

  if (!actualContentPath || !fs.existsSync(actualContentPath)) {
    log('error', '更新内容目录不存在', { path: actualContentPath })
    console.error('[Updater] 更新内容目录不存在:', actualContentPath)
    process.exit(1)
  }

  const updateDir = path.join(appRoot, 'update')
  
  console.log('[Updater] 更新目录:', updateDir)

  try {
    // 等待几秒确保主服务已处理完请求
    log('info', '等待主服务处理完请求...')
    console.log('[Updater] 等待主服务处理完请求...')
    await sleep(3000)

    // 1. 停止主服务
    log('info', '开始停止主服务...')
    console.log('[Updater] 开始停止主服务...')
    await stopMainService(appRoot)
    log('info', '主服务已停止')
    console.log('[Updater] 主服务已停止')
    await sleep(2000)

    // 2. 执行文件更新（直接使用后端传递的 actualContentPath，不需要再次解压）
    log('info', '开始执行文件更新...')
    console.log('[Updater] 开始执行文件更新...')
    await performUpdate(actualContentPath, appRoot)
    log('info', '文件更新完成', { actualContentPath })
    console.log('[Updater] 文件更新完成，实际内容路径:', actualContentPath)

    // 4. 安装依赖（如果需要）
    log('info', '开始安装依赖...')
    console.log('[Updater] 开始安装依赖...')
    await installDependencies(appRoot)
    log('info', '依赖安装完成')
    console.log('[Updater] 依赖安装完成')

    // 5. 清理临时文件（包括 actualContentPath，因为更新已经完成）
    log('info', '开始清理临时文件...')
    console.log('[Updater] 开始清理临时文件...')
    await cleanup(updateDir, actualContentPath)
    log('info', '临时文件清理完成')
    console.log('[Updater] 临时文件清理完成')

    // 7. 更新完成，不再自动启动服务（用户需手动启动）
    log('info', '================== 更新完成 ==================')
    log('info', '系统更新成功完成')
    log('info', '')
    log('info', '【请手动启动服务】')
    log('info', '')
    console.log('[Updater] ================== 更新完成 ==================')
    console.log('[Updater] 系统更新成功完成')
    console.log('[Updater] 【请手动启动服务】')

    if (isAndroid()) {
      log('info', 'Android 用户请执行：')
      log('info', `  cd "${appRoot}"`)
      log('info', '  ./start.sh')
      console.log('[Updater] Android 用户请执行：')
      console.log(`  cd "${appRoot}"`)
      console.log('  ./start.sh')
    } else {
      log('info', 'Windows 用户请执行：')
      log('info', `  cd "${appRoot}"`)
      log('info', '  npm start')
      console.log('[Updater] Windows 用户请执行：')
      console.log(`  cd "${appRoot}"`)
      console.log('  npm start')
    }

    // 退出更新程序
    console.log('[Updater] 更新程序正常退出')
    process.exit(0)
  } catch (err) {
    log('error', '更新过程出错', { error: err.message, stack: err.stack })
    console.error('[Updater] 更新过程出错:', err.message)
    console.error('[Updater] 错误堆栈:', err.stack)
    log('info', '更新失败，请检查错误日志后重试')
    console.log('[Updater] 更新失败，请检查错误日志后重试')
    process.exit(1)
  }
}

// 运行主函数
main().catch(err => {
  log('error', '更新程序异常', { error: err.message, stack: err.stack })
  process.exit(1)
})
