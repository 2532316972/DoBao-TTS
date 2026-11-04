/**
 * 路径工具模块
 * 提供兼容pkg打包和开发环境的路径处理函数
 */

import path from 'path'
import crypto from 'crypto'

/**
 * 获取应用根目录
 * 在pkg打包环境中，返回可执行文件所在目录
 * 在开发环境中，返回项目根目录（process.cwd()）
 * @returns {string} 应用根目录
 */
export function getAppRoot() {
  // pkg打包后，process.pkg会被设置为true
  if (process.pkg) {
    // 返回可执行文件所在目录
    return path.dirname(process.execPath)
  }
  // 开发环境
  return process.cwd()
}

/**
 * 获取数据目录路径
 * @param {...string} subPaths - 子路径
 * @returns {string} 完整路径
 */
export function getDataPath(...subPaths) {
  return path.join(getAppRoot(), 'data', ...subPaths)
}

/**
 * 获取配置目录路径
 * @param {...string} subPaths - 子路径
 * @returns {string} 完整路径
 */
export function getConfigPath(...subPaths) {
  return path.join(getAppRoot(), 'config', ...subPaths)
}

/**
 * 获取音频目录路径
 * @param {...string} subPaths - 子路径
 * @returns {string} 完整路径
 */
export function getAudioPath(...subPaths) {
  return path.join(getAppRoot(), 'audio', ...subPaths)
}

/**
 * 获取日志目录路径
 * @param {...string} subPaths - 子路径
 * @returns {string} 完整路径
 */
export function getLogsPath(...subPaths) {
  return path.join(getAppRoot(), 'logs', ...subPaths)
}

/**
 * 获取public目录路径
 * 在pkg环境中，public目录需要放在可执行文件同级目录
 * @param {...string} subPaths - 子路径
 * @returns {string} 完整路径
 */
export function getPublicPath(...subPaths) {
  if (process.pkg) {
    return path.join(path.dirname(process.execPath), 'public', ...subPaths)
  }
  return path.join(process.cwd(), 'public', ...subPaths)
}

/**
 * 生成字符串的MD5哈希值
 * 用于将长URL等转换为固定长度的短字符串，避免文件名过长问题
 * @param {string} str - 输入字符串
 * @returns {string} 32位小写MD5哈希值
 */
export function md5Hash(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex').toLowerCase()
}

/**
 * 检查字符串是否已经是短哈希格式（16位十六进制）
 * @param {string} str - 输入字符串
 * @returns {boolean} 是否是短哈希格式
 */
export function isShortHash(str) {
  return /^[a-f0-9]{16}$/i.test(String(str))
}

/**
 * 获取安全的目录名称
 * 将输入字符串转换为固定长度的短哈希值，避免文件名过长问题
 * 如果输入已经是短哈希格式，则直接返回（避免重复哈希）
 * @param {string} name - 原始名称（如URL、书名等）
 * @returns {string} 安全的目录名称（16位短哈希）
 */
export function getSafeDirName(name) {
  if (!name) return 'unknown'

  // 如果输入已经是短哈希格式（16位十六进制），直接返回
  if (isShortHash(name)) {
    return name.toLowerCase()
  }

  // 始终使用短哈希值（取MD5前16位），确保目录名简短且唯一
  // 这样可以避免Windows路径长度限制（最大260字符）
  const fullHash = md5Hash(name)
  return fullHash.substring(0, 16)
}
