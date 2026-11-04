/**
 * 文件权限工具模块
 * 处理 Termux 环境下的文件权限设置
 * 只在 Termux 环境中执行权限修复
 */

import fs from 'fs'
import fsPromises from 'fs/promises'
import { execSync } from 'child_process'

/**
 * 检查是否在 Termux 环境中
 * @returns {boolean}
 */
function isTermux() {
  return process.env.TERMUX_VERSION !== undefined ||
    process.env.PREFIX?.includes('termux') ||
    process.cwd().includes('/data/data/com.termux/')
}

/**
 * 设置文件权限为可读写（所有用户）
 * 只在 Termux 环境中执行
 * @param {string} filePath - 文件路径
 */
export function setReadableWritable(filePath) {
  // 只在 Termux 环境中执行
  if (!isTermux()) {
    return
  }

  try {
    // 设置文件权限为 644 (rw-r--r--)
    // 所有者可读写，其他用户可读
    fs.chmodSync(filePath, 0o644)

    // 执行额外的权限修复
    try {
      execSync(`chmod 644 "${filePath}"`, { stdio: 'ignore' })
    } catch (e) {
      // 忽略错误
    }
  } catch (error) {
    // 权限设置失败不影响主要功能
    console.warn(`设置文件权限失败: ${filePath}`, error.message)
  }
}

/**
 * 异步设置文件权限（用于 fs/promises 环境）
 * 只在 Termux 环境中执行
 * @param {string} filePath - 文件路径
 */
export async function setReadableWritableAsync(filePath) {
  // 只在 Termux 环境中执行
  if (!isTermux()) {
    return
  }

  try {
    // 设置文件权限为 644 (rw-r--r--)
    await fsPromises.chmod(filePath, 0o644)

    // 执行额外的权限修复
    try {
      execSync(`chmod 644 "${filePath}"`, { stdio: 'ignore' })
    } catch (e) {
      // 忽略错误
    }
  } catch (error) {
    // 权限设置失败不影响主要功能
    console.warn(`设置文件权限失败: ${filePath}`, error.message)
  }
}

/**
 * 设置目录权限
 * 只在 Termux 环境中执行
 * @param {string} dirPath - 目录路径
 */
export function setDirectoryPermissions(dirPath) {
  // 只在 Termux 环境中执行
  if (!isTermux()) {
    return
  }

  try {
    // 设置目录权限为 755 (rwxr-xr-x)
    fs.chmodSync(dirPath, 0o755)
  } catch (error) {
    // 忽略错误
  }
}

/**
 * 创建目录并设置权限
 * 只在 Termux 环境中执行权限设置
 * @param {string} dirPath - 目录路径
 * @param {boolean} recursive - 是否递归创建
 */
export function createDirectoryWithPermissions(dirPath, recursive = true) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive, mode: 0o755 })
    }
    // 只在 Termux 中设置权限
    if (isTermux()) {
      setDirectoryPermissions(dirPath)
    }
  } catch (error) {
    console.warn(`创建目录失败: ${dirPath}`, error.message)
  }
}

/**
 * 写入文件并设置权限
 * 只在 Termux 环境中执行权限设置
 * @param {string} filePath - 文件路径
 * @param {string|Buffer} data - 文件内容
 */
export function writeFileWithPermissions(filePath, data) {
  try {
    fs.writeFileSync(filePath, data)
    // 只在 Termux 中设置权限
    if (isTermux()) {
      setReadableWritable(filePath)
    }
  } catch (error) {
    console.error(`写入文件失败: ${filePath}`, error.message)
    throw error
  }
}
