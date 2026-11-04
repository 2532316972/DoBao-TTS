import fs from 'fs'
import path from 'path'
import { log, logError } from '../utils/logger.js'
import { getConfigPath } from '../utils/pathUtils.js'

/**
 * 发音人服务类
 * 负责加载、缓存和查询发音人数据
 */
class VoiceService {
  constructor() {
    this.voices = null
    this.loadVoices()
  }

  /**
   * 从配置文件加载发音人数据并缓存到内存
   */
  loadVoices() {
    try {
      const configPath = getConfigPath('voices.json')
      const data = fs.readFileSync(configPath, 'utf-8')
      const config = JSON.parse(data)
      this.voices = config.voices || []
    } catch (err) {
      logError(err, { context: 'VoiceService.loadVoices' })
      this.voices = []
    }
  }

  /**
   * 获取所有发音人列表
   * @returns {Array} 发音人数组
   */
  getAllVoices() {
    return this.voices
  }

  /**
   * 根据ID查找发音人（支持id或style_id）
   * @param {string} id - 发音人ID或style_id
   * @returns {Object|undefined} 发音人对象或undefined
   */
  findVoiceById(id) {
    return this.voices.find(v => v.id === id || v.style_id === id)
  }

  /**
   * 搜索发音人
   * @param {Object} params - 搜索参数
   * @param {string} params.query - 关键词（匹配name）
   * @param {string} params.language - 语言筛选
   * @param {string} params.gender - 性别筛选
   * @returns {Array} 匹配的发音人数组
   */
  searchVoices({ query, language, gender }) {
    let results = this.voices

    // 关键词搜索（name匹配）
    if (query) {
      results = results.filter(v => v.name.includes(query))
    }

    // 语言筛选
    if (language) {
      results = results.filter(v => v.language === language)
    }

    // 性别筛选
    if (gender) {
      results = results.filter(v => v.gender === gender)
    }

    log('info', '发音人搜索完成', { 
      query, 
      language, 
      gender, 
      resultCount: results.length 
    })

    return results
  }
}

// 导出单例实例
export const voiceService = new VoiceService()