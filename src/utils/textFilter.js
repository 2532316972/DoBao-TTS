/**
 * 文本过滤工具模块
 * 用于检测和处理TTS无法朗读的文本内容
 */

import { log } from './logger.js'

/**
 * 可朗读字符的正则表达式
 * 包含：
 * - 中文字符：\u4e00-\u9fa5 (CJK统一表意文字)
 * - 中文标点：\u3000-\u303f (CJK符号和标点)
 * - 英文大小写字母：a-zA-Z
 * - 数字：0-9
 * - 常用符号（保留部分有语义的可读符号）
 */
const READABLE_CHAR_REGEX = /[\u4e00-\u9fa5a-zA-Z0-9]/

/**
 * 检查文本是否包含可朗读的内容
 * @param {string} text - 要检查的文本
 * @returns {boolean} - 如果包含可朗读内容返回true，否则返回false
 */
export function hasReadableContent(text) {
  if (!text || typeof text !== 'string') {
    return false
  }

  const trimmedText = text.trim()
  if (!trimmedText) {
    return false
  }

  // 检查是否包含至少一个可朗读字符
  return READABLE_CHAR_REGEX.test(trimmedText)
}

/**
 * 检查文本是否为纯特殊符号/无意义内容
 * 这是 hasReadableContent 的反向检查
 * @param {string} text - 要检查的文本
 * @returns {boolean} - 如果是纯特殊符号返回true，否则返回false
 */
export function isUnReadableText(text) {
  return !hasReadableContent(text)
}

/**
 * 提取文本中的可朗读内容
 * 过滤掉无法朗读的特殊字符
 * @param {string} text - 原始文本
 * @returns {string} - 过滤后的可朗读文本
 */
export function extractReadableContent(text) {
  if (!text || typeof text !== 'string') {
    return ''
  }

  // 保留：中文、英文、数字、常用空格和标点
  // 过滤：特殊符号、装饰性字符、控制字符等
  return text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\u3000-\u303f\uff00-\uffef]/g, '')
    .trim()
}

/**
 * 获取文本的可读性统计信息
 * 用于调试和分析
 * @param {string} text - 要分析的文本
 * @returns {object} - 统计信息对象
 */
export function getTextReadabilityStats(text) {
  if (!text || typeof text !== 'string') {
    return {
      originalLength: 0,
      readableLength: 0,
      unreadableChars: [],
      isReadable: false,
      readableRatio: 0
    }
  }

  const originalLength = text.length
  const readableContent = extractReadableContent(text)
  const readableLength = readableContent.length

  // 找出不可读的字符
  const unreadableChars = []
  for (const char of text) {
    if (!READABLE_CHAR_REGEX.test(char) && !/\s/.test(char)) {
      unreadableChars.push({
        char,
        codePoint: char.codePointAt(0).toString(16).toUpperCase(),
        unicode: `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
      })
    }
  }

  // 去重
  const uniqueUnreadable = unreadableChars.filter((item, index, self) =>
    index === self.findIndex(t => t.char === item.char)
  )

  return {
    originalLength,
    readableLength,
    unreadableChars: uniqueUnreadable,
    isReadable: readableLength > 0,
    readableRatio: originalLength > 0 ? readableLength / originalLength : 0
  }
}

/**
 * 批量检查文本数组，返回需要跳过的索引
 * @param {string[]} texts - 文本数组
 * @returns {number[]} - 需要跳过的索引数组
 */
export function findUnreadableIndices(texts) {
  if (!Array.isArray(texts)) {
    return []
  }

  const indices = []
  for (let i = 0; i < texts.length; i++) {
    if (isUnReadableText(texts[i])) {
      indices.push(i)
    }
  }
  return indices
}

/**
 * 记录不可读文本的日志（用于调试）
 * @param {string} text - 原始文本
 * @param {string} context - 上下文信息
 */
export function logUnreadableText(text, context = '') {
  const stats = getTextReadabilityStats(text)

  if (!stats.isReadable) {
    log('info', '检测到无朗读内容的文本', {
      context,
      originalText: text,
      originalLength: stats.originalLength,
      unreadableChars: stats.unreadableChars.map(c => ({
        char: c.char,
        unicode: c.unicode
      }))
    })
  }
}

// 兼容旧版正则的导出（用于渐进式迁移）
/**
 * @deprecated 使用 isUnReadableText 替代
 * 保留此函数用于向后兼容
 */
export function isEmptyOrPunctuationOnly(text) {
  return isUnReadableText(text)
}
