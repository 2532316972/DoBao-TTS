import fs from 'fs/promises'
import path from 'path'
import { log, logError } from '../utils/logger.js'
import { getDataPath } from '../utils/pathUtils.js'

/**
 * 配置服务
 * 管理系统配置的持久化存储
 */
class ConfigService {
  constructor() {
    this.configPath = getDataPath('config.json')
    this.config = null
    this.initialized = false
  }

  /**
   * 初始化配置服务
   */
  async initialize() {
    if (this.initialized) return

    try {
      await this.loadConfig()
      this.initialized = true
      log('info', '配置服务初始化完成')
    } catch (error) {
      logError(error, { stage: '配置服务初始化' })
      // 使用默认配置
      this.config = this.getDefaultConfig()
      this.initialized = true
    }
  }

  /**
   * 获取默认配置
   * @returns {Object} 默认配置
   */
  getDefaultConfig() {
    return {
      // 预制音频设置
      prefetch: {
        // 缓存并发数
        cacheConcurrent: 20
      },
      // TTS设置
      tts: {
        // 默认请求延迟（秒）
        requestDelay: 10,
        // 最大重试次数
        maxRetries: 3
      },
      // 其他设置
      system: {
        // 日志级别
        logLevel: 'info'
      },
      // 服务器端口设置
      server: {
        // 服务监听端口
        port: 3000
      },
      // 配置版本
      version: '1.0.0',
      // 最后更新时间
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * 加载配置
   */
  async loadConfig() {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const loadedConfig = JSON.parse(content)
      
      // 合并默认配置和加载的配置
      this.config = {
        ...this.getDefaultConfig(),
        ...loadedConfig,
        // 确保嵌套对象也被合并
        prefetch: {
          ...this.getDefaultConfig().prefetch,
          ...(loadedConfig.prefetch || {})
        },
        tts: {
          ...this.getDefaultConfig().tts,
          ...(loadedConfig.tts || {})
        },
        system: {
          ...this.getDefaultConfig().system,
          ...(loadedConfig.system || {})
        },
        server: {
          ...this.getDefaultConfig().server,
          ...(loadedConfig.server || {})
        }
      }
      
      log('debug', '配置加载成功')
    } catch (error) {
      // 配置文件不存在或读取失败，使用默认配置
      this.config = this.getDefaultConfig()
      await this.saveConfig()
    }
  }

  /**
   * 保存配置
   */
  async saveConfig() {
    try {
      const configDir = path.dirname(this.configPath)
      await fs.mkdir(configDir, { recursive: true })
      
      this.config.updatedAt = new Date().toISOString()
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
      
      log('debug', '配置保存成功')
    } catch (error) {
      logError(error, { stage: '保存配置' })
      throw error
    }
  }

  /**
   * 获取完整配置
   * @returns {Object} 完整配置对象
   */
  async getConfig() {
    await this.initialize()
    return { ...this.config }
  }

  /**
   * 获取指定路径的配置值
   * @param {string} path - 配置路径，如 'prefetch.enableMissTTS'
   * @param {*} defaultValue - 默认值
   * @returns {*} 配置值
   */
  async get(path, defaultValue = null) {
    await this.initialize()
    
    const keys = path.split('.')
    let value = this.config
    
    for (const key of keys) {
      if (value === null || value === undefined || typeof value !== 'object') {
        return defaultValue
      }
      value = value[key]
    }
    
    return value !== undefined ? value : defaultValue
  }

  /**
   * 设置配置值
   * @param {string} path - 配置路径，如 'prefetch.enableMissTTS'
   * @param {*} value - 配置值
   */
  async set(path, value) {
    await this.initialize()
    
    const keys = path.split('.')
    let target = this.config
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      if (target[key] === undefined || typeof target[key] !== 'object') {
        target[key] = {}
      }
      target = target[key]
    }
    
    target[keys[keys.length - 1]] = value
    
    await this.saveConfig()
    log('info', '配置已更新', { path, value })
  }

  /**
   * 批量更新配置
   * @param {Object} updates - 配置更新对象
   */
  async update(updates) {
    await this.initialize()

    this.config = {
      ...this.config,
      ...updates,
      prefetch: {
        ...this.config.prefetch,
        ...(updates.prefetch || {})
      },
      tts: {
        ...this.config.tts,
        ...(updates.tts || {})
      },
      system: {
        ...this.config.system,
        ...(updates.system || {})
      },
      server: {
        ...this.config.server,
        ...(updates.server || {})
      }
    }

    await this.saveConfig()
    log('info', '配置批量更新成功')
  }

  /**
   * 重置配置为默认值
   */
  async reset() {
    this.config = this.getDefaultConfig()
    await this.saveConfig()
    log('info', '配置已重置为默认值')
  }
}

// 导出单例实例
export const configService = new ConfigService()
