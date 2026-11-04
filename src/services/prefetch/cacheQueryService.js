import fs from 'fs/promises'
import path from 'path'
import { log, logError } from '../../utils/logger.js'
import { getDataPath, getSafeDirName } from '../../utils/pathUtils.js'

/**
 * 缓存查询服务
 * 负责在预制音频索引中查找匹配的音频文件
 */
class CacheQueryService {
  constructor() {
    this.baseDir = getDataPath('prefetch', 'books')
    this.indexCache = new Map()
    this.cacheExpiry = 60000 // 60秒缓存有效期
    // 添加监控指标
    this.metrics = {
      cacheHits: 0,          // 缓存命中次数
      cacheMisses: 0,        // 缓存未命中次数
      totalQueries: 0,       // 总查询次数
      indexLoads: 0,         // 索引加载次数
      indexCacheHits: 0,     // 索引缓存命中次数
      indexCacheMisses: 0,   // 索引缓存未命中次数
      lastReset: new Date().toISOString() // 最后重置时间
    }
  }

  /**
   * 根据文本内容查找音频文件
   * @param {string} text - 要查找的文本内容
   * @param {string|null} bookId - 书籍ID（可选）
   * @param {string|null} chapterId - 章节ID（可选）
   * @returns {Promise<Object|null>} 音频文件信息或null
   */
  async findAudioByText(text, bookId = null, chapterId = null) {
    if (!text) {
      throw new Error('文本参数不能为空')
    }

    // 更新查询计数
    this.metrics.totalQueries++

    const normalizedText = this.normalizeText(text)
    log('debug', '查找音频', { 
      textLength: text.length, 
      bookId, 
      chapterId,
      metrics: this.metrics
    })

    try {
      // 策略1: 如果提供了bookId和chapterId，直接在该章节查找
      if (bookId && chapterId) {
        const result = await this.findInChapterIndex(bookId, chapterId, normalizedText, text, 0.7)
        if (result) {
          this.metrics.cacheHits++
          log('info', '预制音频查询命中', {
            bookId, 
            chapterId,
            segmentId: result.segmentId,
            score: result.score,
            metrics: this.metrics
          })
          return result
        }
      }

      // 策略2: 如果只提供了bookId，遍历该书籍的所有章节
      if (bookId && !chapterId) {
        const result = await this.findInBookIndexes(bookId, normalizedText, text)
        if (result) {
          this.metrics.cacheHits++
          log('info', '预制音频查询命中', {
            bookId, 
            chapterId: result.chapterId,
            segmentId: result.segmentId,
            score: result.score,
            metrics: this.metrics
          })
          return result
        }
      }

      // 策略3: 遍历所有书籍的所有章节（性能较低）
      // 对于全文搜索，使用更低的匹配阈值(0.6)以提高命中率
      const result = await this.findInAllIndexes(normalizedText, text, 0.6)
      if (result) {
        this.metrics.cacheHits++
        log('info', '预制音频查询命中', {
          bookId: result.bookId, 
          chapterId: result.chapterId,
          segmentId: result.segmentId,
          score: result.score,
          metrics: this.metrics
        })
      } else {
        this.metrics.cacheMisses++
        log('info', '预制音频查询未命中', {
          textPreview: text.substring(0, 50),
          normalizedPreview: normalizedText.substring(0, 50),
          metrics: this.metrics
        })
      }
      return result
    } catch (error) {
      logError(error, { stage: '查找音频', bookId, chapterId })
      throw error
    }
  }

  /**
   * 在特定章节索引中查找
   * @param {string} bookId - 书籍ID
   * @param {string} chapterId - 章节ID
   * @param {string} normalizedText - 标准化后的文本
   * @param {string} originalText - 原始文本（用于变体检查）
   * @param {number} minScore - 最低匹配分数阈值（默认0.7）
   * @returns {Promise<Object|null>} 音频文件信息或null
   */
  async findInChapterIndex(bookId, chapterId, normalizedText, originalText = '', minScore = 0.7) {
    try {
      // 使用安全的目录名（短哈希）构建路径
      const safeBookId = getSafeDirName(bookId)
      const safeChapterId = getSafeDirName(chapterId)
      const indexPath = path.join(this.baseDir, safeBookId, 'chapters', safeChapterId, 'index.json')
      const index = await this.loadIndex(indexPath)
      
      if (!index || !index.segments) return null

      // 存储匹配结果和分数
      const matches = []

      for (const segment of index.segments) {
        const segmentNormalized = this.normalizeText(segment.text)
        const matchScore = this.calculateMatchScore(normalizedText, segmentNormalized)
        
        // 只保留匹配度较高的结果
        if (matchScore > minScore) {
          matches.push({
            segment,
            score: matchScore
          })
        }
      }

      // 如果没有匹配结果，返回null
      if (matches.length === 0) return null

      // 按匹配分数排序，返回最匹配的结果
      matches.sort((a, b) => b.score - a.score)
      const bestMatch = matches[0]

      if (bestMatch.score >= 0.95) {
        // 高度匹配，直接返回
        const segment = bestMatch.segment
        const audioPath = this.getAudioPath(bookId, chapterId, segment)
        if (!audioPath) {
          log('debug', '高度匹配但音频路径无效', { bookId, chapterId, segmentId: segment.segmentId })
          return null
        }
        return {
          bookId,
          chapterId,
          segmentId: segment.segmentId,
          audioPath,
          text: segment.text,
          score: bestMatch.score
        }
      } else if (bestMatch.score >= 0.85) {
        // 中度匹配，检查是否是精确匹配的变体
        const segment = bestMatch.segment
        const segmentOriginal = segment.text
        const exactMatch = this.checkExactMatchVariants(originalText, segmentOriginal)
        
        if (exactMatch) {
          const audioPath = this.getAudioPath(bookId, chapterId, segment)
          if (!audioPath) {
            log('debug', '中度匹配但音频路径无效', { bookId, chapterId, segmentId: segment.segmentId })
            return null
          }
          return {
            bookId,
            chapterId,
            segmentId: segment.segmentId,
            audioPath,
            text: segment.text,
            score: bestMatch.score
          }
        }
      } else if (bestMatch.score >= minScore) {
        // 低度匹配但超过阈值，记录调试信息
        log('debug', '匹配分数不足', { 
          bookId, 
          chapterId, 
          score: bestMatch.score, 
          minScore,
          textPreview: originalText.substring(0, 30),
          segmentPreview: bestMatch.segment.text.substring(0, 30)
        })
      }

      return null
    } catch (error) {
      log('debug', '章节索引不存在或读取失败', { bookId, chapterId })
      return null
    }
  }

  /**
   * 递归获取所有包含index.json的章节目录
   * @param {string} dir - 起始目录
   * @param {string} basePath - 基础路径（用于计算相对路径）
   * @returns {Promise<string[]>} 章节ID列表
   */
  async getAllChapterIds(dir, basePath) {
    const chapters = []

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      log('info', 'getAllChapterIds: 扫描目录', { dir, entryCount: entries.length, entries: entries.map(e => e.name) })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          // 递归查找子目录
          const subChapters = await this.getAllChapterIds(fullPath, basePath)
          chapters.push(...subChapters)
        } else if (entry.name === 'index.json') {
          // 找到index.json，计算相对路径作为chapterId
          const relativePath = path.relative(basePath, dir)
          log('info', 'getAllChapterIds: 找到index.json', { dir, basePath, relativePath })
          chapters.push(relativePath)
        }
      }
    } catch (error) {
      // 目录不存在或无法读取，忽略错误
      log('info', 'getAllChapterIds: 读取目录失败', { dir, error: error.message })
    }

    return chapters
  }

  /**
   * 在书籍的所有章节索引中查找
   * @param {string} bookId - 书籍ID
   * @param {string} normalizedText - 标准化后的文本
   * @param {string} originalText - 原始文本（用于变体检查）
   * @param {number} minScore - 最低匹配分数阈值
   * @returns {Promise<Object|null>} 音频文件信息或null
   */
  async findInBookIndexes(bookId, normalizedText, originalText = '', minScore = 0.7) {
    try {
      // 使用安全的目录名（短哈希）构建路径
      const safeBookId = getSafeDirName(bookId)
      const bookPath = path.join(this.baseDir, safeBookId, 'chapters')
      
      // 递归获取所有章节ID
      const chapters = await this.getAllChapterIds(bookPath, bookPath)
      
      if (chapters.length === 0) {
        log('debug', '书籍没有章节索引', { bookId })
        return null
      }

      // 存储所有章节的匹配结果
      const allMatches = []

      for (const chapterId of chapters) {
        const result = await this.findInChapterIndex(bookId, chapterId, normalizedText, originalText, minScore)
        if (result) {
          allMatches.push(result)
        }
      }

      // 如果没有匹配结果，返回null
      if (allMatches.length === 0) return null

      // 按匹配分数排序，返回最高分的匹配结果
      allMatches.sort((a, b) => b.score - a.score)
      return allMatches[0]
    } catch (error) {
      log('debug', '书籍目录不存在或读取失败', { bookId })
      return null
    }
  }

  /**
   * 在所有索引中查找
   * @param {string} normalizedText - 标准化后的文本
   * @param {string} originalText - 原始文本（用于变体检查）
   * @param {number} minScore - 最低匹配分数阈值
   * @returns {Promise<Object|null>} 音频文件信息或null
   */
  async findInAllIndexes(normalizedText, originalText = '', minScore = 0.7) {
    try {
      // 获取所有书籍目录（已经是短哈希格式）
      const bookDirs = await fs.readdir(this.baseDir)
      log('info', 'findInAllIndexes: 扫描到的书籍目录', { bookCount: bookDirs.length, books: bookDirs })

      // 存储所有书籍的匹配结果
      const allMatches = []

      for (const safeBookId of bookDirs) {
        // 直接使用目录名（短哈希）构建路径，不再调用getSafeDirName
        const bookPath = path.join(this.baseDir, safeBookId, 'chapters')

        try {
          // 递归获取所有章节ID
          const chapters = await this.getAllChapterIds(bookPath, bookPath)
          log('info', 'findInAllIndexes: 获取章节列表', { safeBookId, chapterCount: chapters.length, chapters })

          for (const safeChapterId of chapters) {
            // 直接使用章节目录名（短哈希）构建路径
            const indexPath = path.join(bookPath, safeChapterId, 'index.json')
            const index = await this.loadIndex(indexPath)

            if (!index || !index.segments) continue

            // 在章节中查找匹配
            for (const segment of index.segments) {
              const segmentNormalized = this.normalizeText(segment.text)
              const matchScore = this.calculateMatchScore(normalizedText, segmentNormalized)

              if (matchScore > minScore) {
                allMatches.push({
                  bookId: safeBookId,
                  chapterId: safeChapterId,
                  segmentId: segment.segmentId,
                  audioPath: this.getAudioPath(safeBookId, safeChapterId, segment, true),
                  text: segment.text,
                  score: matchScore
                })
              }
            }
          }
        } catch (error) {
          // 忽略单个书籍的读取错误，继续处理其他书籍
          continue
        }
      }

      // 如果没有匹配结果，返回null
      if (allMatches.length === 0) return null

      // 按匹配分数排序，返回最高分的匹配结果
      allMatches.sort((a, b) => b.score - a.score)
      return allMatches[0]
    } catch (error) {
      log('debug', '预制书目录不存在或读取失败')
      return null
    }
  }

  /**
   * 加载索引文件（带缓存）
   * @param {string} indexPath - 索引文件路径
   * @returns {Promise<Object|null>} 索引对象或null
   */
  async loadIndex(indexPath) {
    // 更新索引加载计数
    this.metrics.indexLoads++

    const cached = this.indexCache.get(indexPath)
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      // 索引缓存命中
      this.metrics.indexCacheHits++
      return cached.data
    }

    // 索引缓存未命中
    this.metrics.indexCacheMisses++

    try {
      const content = await fs.readFile(indexPath, 'utf-8')
      const data = JSON.parse(content)
      
      this.indexCache.set(indexPath, {
        data,
        timestamp: Date.now()
      })

      // 清理过期缓存
      this.cleanExpiredCache()
      
      return data
    } catch (error) {
      return null
    }
  }

  /**
   * 标准化文本（去除空白字符和特殊字符）
   * @param {string} text - 原始文本
   * @returns {string} 标准化后的文本
   */
  normalizeText(text) {
    return text
      .replace(/[\s\u3000]+/g, '')   // 去除所有空白字符（包括全角空格\u3000）
      .replace(/[^一-龥a-zA-Z0-9]/g, '')  // 只保留中文、英文和数字
      .toLowerCase()                 // 转为小写
      .trim()
  }

  /**
   * 计算文本匹配分数
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @returns {number} 匹配分数（0-1）
   */
  calculateMatchScore(text1, text2) {
    // 如果其中一个文本为空，返回0
    if (!text1 || !text2) return 0

    // 精确匹配
    if (text1 === text2) return 1.0

    // 计算最长公共子序列长度
    const lcsLength = this.longestCommonSubsequence(text1, text2)
    
    // 计算匹配分数
    const score = lcsLength / Math.max(text1.length, text2.length)
    return score
  }

  /**
   * 计算最长公共子序列长度
   * @param {string} text1 - 文本1
   * @param {string} text2 - 文本2
   * @returns {number} 最长公共子序列长度
   */
  longestCommonSubsequence(text1, text2) {
    const m = text1.length
    const n = text2.length
    
    // 创建二维数组
    const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0))
    
    // 动态规划计算最长公共子序列
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (text1[i - 1] === text2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
        }
      }
    }
    
    return dp[m][n]
  }

  /**
   * 检查文本变体的精确匹配
   * @param {string} originalText - 原始文本
   * @param {string} segmentText - 分段文本
   * @returns {boolean} 是否为精确匹配的变体
   */
  checkExactMatchVariants(originalText, segmentText) {
    // 变体1: 去除所有空白字符后匹配
    const noSpaces1 = originalText.replace(/\s+/g, '')
    const noSpaces2 = segmentText.replace(/\s+/g, '')
    if (noSpaces1 === noSpaces2) return true
    
    // 变体2: 去除所有标点符号后匹配
    // 使用更兼容的正则表达式匹配标点符号
    const punctuationRegex = /[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E\s]/g
    const noPunct1 = originalText.replace(punctuationRegex, '')
    const noPunct2 = segmentText.replace(punctuationRegex, '')
    if (noPunct1 === noPunct2) return true
    
    // 变体3: 去除所有空白字符和标点符号后匹配
    const normalized1 = originalText.replace(punctuationRegex, '').toLowerCase()
    const normalized2 = segmentText.replace(punctuationRegex, '').toLowerCase()
    if (normalized1 === normalized2) return true
    
    return false
  }

  /**
   * 获取音频文件路径
   * 支持 index.json 和 cache.json 两种格式
   * @param {string} bookId - 书籍ID
   * @param {string} chapterId - 章节ID
   * @param {Object} segment - 分段对象
   * @param {boolean} isAlreadySafe - bookId和chapterId是否已经是短哈希格式
   * @returns {string|null} 音频文件路径或null
   */
  getAudioPath(bookId, chapterId, segment, isAlreadySafe = false) {
    // 如果已经是短哈希格式，直接使用；否则需要转换
    const safeBookId = isAlreadySafe ? bookId : getSafeDirName(bookId)
    const safeChapterId = isAlreadySafe ? chapterId : getSafeDirName(chapterId)

    // 如果 segment 中有 audioFile 字段（index.json 格式），直接使用
    if (segment.audioFile) {
      return path.join(this.baseDir, safeBookId, 'chapters', safeChapterId, segment.audioFile)
    }

    // 否则根据 segmentId 构建路径（cache.json 格式）
    if (segment.segmentId) {
      return path.join(this.baseDir, safeBookId, 'chapters', safeChapterId, 'audio', `${segment.segmentId}.mp3`)
    }

    log('warn', '无法确定音频文件路径', { bookId, chapterId, segment })
    return null
  }

  /**
   * 清理过期缓存
   */
  cleanExpiredCache() {
    const now = Date.now()
    for (const [key, value] of this.indexCache.entries()) {
      if (now - value.timestamp >= this.cacheExpiry) {
        this.indexCache.delete(key)
      }
    }
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.indexCache.clear()
    log('info', '缓存已清空')
  }

  /**
   * 获取监控指标
   * @returns {Object} 监控指标
   */
  getMetrics() {
    // 计算命中率
    const hitRate = this.metrics.totalQueries > 0 
      ? (this.metrics.cacheHits / this.metrics.totalQueries * 100).toFixed(2) 
      : '0.00'
    
    const indexCacheHitRate = this.metrics.indexLoads > 0 
      ? (this.metrics.indexCacheHits / this.metrics.indexLoads * 100).toFixed(2) 
      : '0.00'

    return {
      ...this.metrics,
      hitRate: parseFloat(hitRate),
      indexCacheHitRate: parseFloat(indexCacheHitRate)
    }
  }

  /**
   * 重置监控指标
   */
  resetMetrics() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      totalQueries: 0,
      indexLoads: 0,
      indexCacheHits: 0,
      indexCacheMisses: 0,
      lastReset: new Date().toISOString()
    }
    log('info', '监控指标已重置')
  }
}

// 导出单例实例
export const cacheQueryService = new CacheQueryService()