/**
 * Cookie管理服务类
 * 负责Cookie数据的加载、保存、增删改查和统计更新
 * 使用单例模式确保全局只有一个实例
 */

import fs from 'fs/promises';
import path from 'path';
import { log, logError } from '../utils/logger.js';
import { getDataPath } from '../utils/pathUtils.js';

// Cookie数据文件路径
const COOKIES_FILE = getDataPath('cookies.json');

/**
 * Cookie管理器类（单例模式）
 */
class CookieManager {
  constructor() {
    if (CookieManager.instance) {
      return CookieManager.instance;
    }
    
    this.data = null;
    this.initialized = false;
    // Cookie级互斥锁：cookieId -> 锁Promise（防止实时与预制并发打同一Cookie）
    this.cookieLocks = new Map();
    CookieManager.instance = this;
  }

  /**
   * 初始化Cookie数据
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }
    
    try {
      await this.loadCookies();
      this.initialized = true;
      log('info', 'Cookie管理器初始化成功', { 
        cookieCount: this.data.cookies.length 
      });
    } catch (error) {
      logError(error, { stage: 'CookieManager初始化' });
      throw error;
    }
  }

  /**
   * 获取默认的Cookie数据结构
   * @returns {Object} 默认数据结构
   */
  getDefaultData() {
    return {
      version: "2.1.0",
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalRequests: 0,
        totalRotations: 0
      },
      config: {
        rotation: {
          strategy: "round-robin",
          autoRotate: true,
          rotateInterval: 100,
          currentIndex: 0
        },
        validation: {
          enabled: true,
          interval: 3600000,
          retryCount: 3,
          retryDelay: 1000,
          timeout: 5000,
          cacheEnabled: true,
          cacheDuration: 300000
        },
        errorHandling: {
          maxRetries: 3,
          retryBackoff: "exponential",
          fallbackStrategy: "next-available"
        }
      },
      cookies: [],
      validationCache: {}
    };
  }

  /**
   * 创建完整的Cookie对象
   * @param {Object} cookieData - 基础Cookie数据
   * @returns {Object} 完整的Cookie对象
   */
  createCookieObject(cookieData) {
    const now = new Date().toISOString();
    return {
      id: cookieData.id || `cookie_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: cookieData.name || '',
      value: cookieData.value || '',
      description: cookieData.description || '',
      status: {
        isActive: cookieData.isActive !== undefined ? cookieData.isActive : false,
        isValid: cookieData.isValid !== undefined ? cookieData.isValid : true,
        isDisabled: cookieData.isDisabled !== undefined ? cookieData.isDisabled : false,
        lastValidated: cookieData.lastValidated || null,
        validationStatus: cookieData.validationStatus || 'pending',
        lastError: cookieData.lastError || null,
        lastFailure: cookieData.lastFailure || null
      },
      usage: {
        usageCount: cookieData.usageCount || 0,
        lastUsed: cookieData.lastUsed || null,
        successCount: cookieData.successCount || 0,
        failureCount: cookieData.failureCount || 0
      },
      metadata: {
        createdAt: cookieData.createdAt || now,
        updatedAt: cookieData.updatedAt || now,
        tags: cookieData.tags || [],
        priority: cookieData.priority !== undefined ? cookieData.priority : 5,
        weight: cookieData.weight !== undefined ? cookieData.weight : 1
      },
      limits: {
        maxUsageCount: cookieData.maxUsageCount || 10000,
        maxRequestsPerMinute: cookieData.maxRequestsPerMinute || 60,
        currentMinuteCount: cookieData.currentMinuteCount || 0
      }
    };
  }

  /**
   * 加载Cookie数据
   * @returns {Promise<Object>} Cookie数据对象
   */
  async loadCookies() {
    try {
      // 确保数据目录存在
      const dataDir = path.dirname(COOKIES_FILE);
      await fs.mkdir(dataDir, { recursive: true });

      // 尝试读取文件
      try {
        const fileContent = await fs.readFile(COOKIES_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
        
        // 验证数据结构
        if (!this.data.version || !this.data.cookies) {
          log('warn', 'Cookie数据结构不完整，使用默认结构');
          this.data = this.getDefaultData();
        }
        
        log('info', 'Cookie数据加载成功', { 
          cookieCount: this.data.cookies.length 
        });
      } catch (error) {
        if (error.code === 'ENOENT') {
          log('info', 'Cookie数据文件不存在，创建默认数据');
          this.data = this.getDefaultData();
          await this.saveCookies();
        } else {
          throw error;
        }
      }

      return this.data;
    } catch (error) {
      logError(error, { stage: '加载Cookie数据' });
      throw new Error('加载Cookie数据失败');
    }
  }

  /**
   * 保存Cookie数据（使用原子操作）
   * @returns {Promise<void>}
   */
  async saveCookies() {
    try {
      if (!this.data) {
        throw new Error('Cookie数据未初始化');
      }

      // 更新元数据
      this.data.metadata.lastUpdated = new Date().toISOString();

      // 使用临时文件+重命名实现原子操作
      const tmpFile = `${COOKIES_FILE}.tmp`;
      const dataStr = JSON.stringify(this.data, null, 2);
      
      await fs.writeFile(tmpFile, dataStr, 'utf8');
      await fs.rename(tmpFile, COOKIES_FILE);
      
      log('info', 'Cookie数据保存成功');
    } catch (error) {
      logError(error, { stage: '保存Cookie数据' });
      throw new Error('保存Cookie数据失败');
    }
  }

  /**
   * 获取所有Cookie
   * @param {boolean} includeDisabled - 是否包含禁用的Cookie，默认false
   * @returns {Array} Cookie数组
   */
  getCookies(includeDisabled = false) {
    if (!this.data) {
      throw new Error('Cookie数据未初始化');
    }
    const cookies = this.data.cookies || [];
    if (includeDisabled) {
      return cookies;
    }
    // 过滤掉被禁用的Cookie
    return cookies.filter(c => !c.status?.isDisabled);
  }

  /**
   * 根据ID获取Cookie
   * @param {string} id - Cookie ID
   * @returns {Object|null} Cookie对象或null
   */
  getCookieById(id) {
    // 使用 getCookies(true) 获取所有Cookie，包括禁用的
    const cookies = this.getCookies(true);
    return cookies.find(c => c.id === id) || null;
  }

  /**
   * 添加新Cookie
   * @param {Object} cookieData - Cookie数据
   * @returns {Promise<Object>} 新添加的Cookie对象
   */
  async addCookie(cookieData) {
    try {
      // 验证必填字段
      if (!cookieData.name || !cookieData.value) {
        throw new Error('Cookie名称和值不能为空');
      }

      // 使用 getCookies(true) 获取所有Cookie，包括禁用的
      const cookies = this.getCookies(true);
      
      // 检查名称是否已存在
      const existingCookie = cookies.find(c => c.name === cookieData.name);
      if (existingCookie) {
        throw new Error('Cookie名称已存在');
      }

      // 创建完整的Cookie对象
      const newCookie = this.createCookieObject(cookieData);
      
      // 如果是第一个Cookie，自动设为活跃状态
      if (cookies.length === 0) {
        newCookie.status.isActive = true;
      }

      cookies.push(newCookie);
      await this.saveCookies();
      
      log('info', 'Cookie添加成功', { 
        id: newCookie.id, 
        name: newCookie.name 
      });
      
      return newCookie;
    } catch (error) {
      logError(error, { stage: '添加Cookie' });
      throw error;
    }
  }

  /**
   * 更新Cookie
   * @param {string} id - Cookie ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<Object>} 更新后的Cookie对象
   */
  async updateCookie(id, updates) {
    try {
      // 使用 getCookies(true) 获取所有Cookie，包括禁用的
      const cookies = this.getCookies(true);
      const cookieIndex = cookies.findIndex(c => c.id === id);
      
      if (cookieIndex === -1) {
        throw new Error('Cookie不存在');
      }

      const existingCookie = cookies[cookieIndex];
      
      // 如果更新名称，检查是否与其他Cookie冲突
      if (updates.name && updates.name !== existingCookie.name) {
        const nameConflict = cookies.find(c => c.id !== id && c.name === updates.name);
        if (nameConflict) {
          throw new Error('Cookie名称已被其他Cookie使用');
        }
      }

      // 合并更新
      const updatedCookie = {
        ...existingCookie,
        ...updates,
        metadata: {
          ...existingCookie.metadata,
          updatedAt: new Date().toISOString()
        }
      };

      cookies[cookieIndex] = updatedCookie;
      await this.saveCookies();
      
      log('info', 'Cookie更新成功', { 
        id: updatedCookie.id, 
        name: updatedCookie.name 
      });
      
      return updatedCookie;
    } catch (error) {
      logError(error, { stage: '更新Cookie' });
      throw error;
    }
  }

  /**
   * 删除Cookie
   * @param {string} id - Cookie ID
   * @returns {Promise<void>}
   */
  async deleteCookie(id) {
    try {
      // 使用 getCookies(true) 获取所有Cookie，包括禁用的
      const cookies = this.getCookies(true);
      const cookieIndex = cookies.findIndex(c => c.id === id);

      if (cookieIndex === -1) {
        throw new Error('Cookie不存在');
      }

      const deletedCookie = cookies[cookieIndex];
      const wasActive = deletedCookie.status.isActive;

      // 从数组中移除
      cookies.splice(cookieIndex, 1);

      // 如果删除的是活跃Cookie，自动选择下一个（从启用的Cookie中选择）
      if (wasActive) {
        const enabledCookies = cookies.filter(c => !c.status?.isDisabled);
        if (enabledCookies.length > 0) {
          enabledCookies[0].status.isActive = true;
          log('info', 'Cookie轮换', {
            newActiveCookie: enabledCookies[0].name
          });
        }
      }

      await this.saveCookies();

      log('info', 'Cookie删除成功', {
        id: deletedCookie.id,
        name: deletedCookie.name
      });
    } catch (error) {
      logError(error, { stage: '删除Cookie' });
      throw error;
    }
  }

  /**
   * 清空所有Cookie数据
   * @returns {Promise<number>} 清空的Cookie数量
   */
  async clearAllCookies() {
    try {
      const cookies = this.getCookies();
      const count = cookies.length;

      if (count === 0) {
        return 0;
      }

      // 清空Cookie数组
      cookies.length = 0;

      // 清空验证缓存
      if (this.data.validationCache) {
        this.data.validationCache = {};
      }

      // 重置元数据
      this.data.metadata.totalRequests = 0;
      this.data.metadata.totalRotations = 0;
      this.data.metadata.lastUpdated = new Date().toISOString();

      // 重置配置
      this.data.config.rotation.currentIndex = 0;

      await this.saveCookies();

      log('info', '所有Cookie已清空', { count });
      return count;
    } catch (error) {
      logError(error, { stage: '清空所有Cookie' });
      throw error;
    }
  }

  /**
   * 获取所有Cookie（包括被禁用的）
   * @returns {Array} Cookie数组
   */
  getAllCookies() {
    if (!this.data) {
      throw new Error('Cookie数据未初始化');
    }
    return this.data.cookies || [];
  }

  /**
   * 获取Cookie级互斥锁
   * 防止同一Cookie被实时模式和预制模式并发使用（真人浏览器单页面不会同时发起两条TTS）
   * 链式队列：后续请求等待前一个持锁者释放后获得锁
   * @param {string} cookieId - Cookie ID
   * @returns {Promise<Function>} 释放锁的函数
   */
  async acquireCookieLock(cookieId) {
    if (!cookieId) {
      return () => {};
    }
    const prev = this.cookieLocks.get(cookieId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    // 链尾：前一个持锁者释放后本链才resolve
    const chain = prev.then(() => current);
    this.cookieLocks.set(cookieId, chain);

    // 等待前一个持锁者释放（首把锁 prev 为已resolve，立即获得）
    await prev;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
      // 若没有后续请求接续（链仍是本请求的），则清理锁记录
      queueMicrotask(() => {
        if (this.cookieLocks.get(cookieId) === chain) {
          this.cookieLocks.delete(cookieId);
        }
      });
    };
  }

  /**
   * 检查Cookie当前是否被占用（是否有进行中或排队中的请求）
   * @param {string} cookieId - Cookie ID
   * @returns {boolean} 是否被占用
   */
  isCookieLocked(cookieId) {
    return !!cookieId && this.cookieLocks.has(cookieId);
  }

  /**
   * 获取所有Cookie的锁定状态统计
   * @returns {Object} 锁定统计
   */
  getLockStats() {
    return {
      lockedCount: this.cookieLocks.size
    };
  }

  /**
   * 获取验证缓存（真实落地实现）
   * @returns {Object} 验证缓存 { cookieId: {isValid, message, timestamp} }
   */
  getValidationCache() {
    if (!this.data) {
      throw new Error('Cookie数据未初始化');
    }
    if (!this.data.validationCache) {
      this.data.validationCache = {};
    }
    return this.data.validationCache;
  }

  /**
   * 写入Cookie验证结果到缓存
   * @param {string} cookieId - Cookie ID
   * @param {Object} result - 验证结果 {isValid, message, timestamp}
   * @returns {Promise<void>}
   */
  async setValidationResult(cookieId, result) {
    try {
      const cache = this.getValidationCache();
      cache[cookieId] = {
        isValid: !!result.isValid,
        message: result.message || '',
        timestamp: result.timestamp || new Date().toISOString()
      };
      await this.saveCookies();
      log('debug', '验证结果已缓存', { cookieId, isValid: cache[cookieId].isValid });
    } catch (error) {
      logError(error, { stage: '缓存验证结果' });
    }
  }

  /**
   * 获取Cookie的验证缓存结果
   * @param {string} cookieId - Cookie ID
   * @returns {Object|null} 验证结果或null
   */
  getValidationResult(cookieId) {
    const cache = this.getValidationCache();
    return cache[cookieId] || null;
  }

  /**
   * 更新Cookie状态字段（合并到status中，保留其他状态信息）
   * @param {string} id - Cookie ID
   * @param {Object} statusUpdates - 状态更新字段（如 { isValid, isDisabled }）
   * @returns {Promise<Object>} 更新后的Cookie对象
   */
  async updateCookieStatus(id, statusUpdates) {
    try {
      const cookies = this.getCookies(true);
      const cookie = cookies.find(c => c.id === id);

      if (!cookie) {
        throw new Error('Cookie不存在');
      }

      cookie.status = {
        ...cookie.status,
        ...statusUpdates
      };

      await this.saveCookies();

      log('info', 'Cookie状态更新成功', {
        id: cookie.id,
        name: cookie.name,
        statusUpdates
      });

      return cookie;
    } catch (error) {
      logError(error, { stage: '更新Cookie状态' });
      throw error;
    }
  }

  /**
   * 获取当前活跃Cookie
   * @returns {Object|null} 活跃Cookie对象或null
   */
  getActiveCookie() {
    const cookies = this.getCookies();
    return cookies.find(c => c.status.isActive) || null;
  }

  /**
   * 设置活跃Cookie
   * @param {string} id - Cookie ID
   * @returns {Promise<Object>} 设置的活跃Cookie对象
   */
  async setActiveCookie(id) {
    try {
      // 获取所有Cookie（包括禁用的），确保清除所有活跃状态
      const allCookies = this.getCookies(true);
      const targetCookie = allCookies.find(c => c.id === id);

      if (!targetCookie) {
        throw new Error('Cookie不存在');
      }

      // 清除所有Cookie的活跃状态（包括禁用的）
      allCookies.forEach(c => {
        c.status.isActive = false;
      });

      // 设置新的活跃Cookie
      targetCookie.status.isActive = true;
      targetCookie.usage.lastUsed = new Date().toISOString();

      // 更新轮换索引
      const newIndex = allCookies.indexOf(targetCookie);
      this.data.config.rotation.currentIndex = newIndex;
      
      // 增加轮换计数
      this.data.metadata.totalRotations++;
      
      await this.saveCookies();
      
      log('info', 'Cookie切换成功', { 
        id: targetCookie.id, 
        name: targetCookie.name 
      });
      
      return targetCookie;
    } catch (error) {
      logError(error, { stage: '设置活跃Cookie' });
      throw error;
    }
  }

  /**
   * 更新Cookie使用统计
   * @param {string} id - Cookie ID
   * @param {boolean} success - 是否成功
   * @returns {Promise<Object>} 更新后的Cookie对象
   */
  async updateCookieUsage(id, success = true) {
    try {
      const cookies = this.getCookies();
      const cookie = cookies.find(c => c.id === id);

      if (!cookie) {
        throw new Error('Cookie不存在');
      }

      const now = new Date().toISOString();

      // 更新使用统计
      cookie.usage.usageCount++;
      cookie.usage.lastUsed = now;

      if (success) {
        cookie.usage.successCount++;
        // 成功时确保标记为有效
        cookie.status.isValid = true;
        cookie.status.lastError = null;
      } else {
        cookie.usage.failureCount++;
      }

      // 更新全局请求计数
      this.data.metadata.totalRequests++;

      await this.saveCookies();

      log('info', 'Cookie使用统计更新', {
        id: cookie.id,
        success,
        isValid: cookie.status.isValid
      });

      return cookie;
    } catch (error) {
      logError(error, { stage: '更新Cookie使用统计' });
      throw error;
    }
  }

  /**
   * 标记Cookie为无效
   * @param {string} id - Cookie ID
   * @param {string} errorMessage - 错误信息
   * @returns {Promise<Object>} 更新后的Cookie对象
   */
  async markCookieAsInvalid(id, errorMessage) {
    try {
      const cookies = this.getCookies();
      const cookie = cookies.find(c => c.id === id);

      if (!cookie) {
        throw new Error('Cookie不存在');
      }

      const now = new Date().toISOString();

      // 标记为无效
      cookie.status.isValid = false;
      cookie.status.lastError = errorMessage;
      cookie.status.lastFailure = now;
      // 更新使用统计：增加总使用次数和失败次数
      cookie.usage.usageCount++;
      cookie.usage.failureCount++;
      cookie.usage.lastUsed = now;

      // 更新全局请求计数
      this.data.metadata.totalRequests++;

      await this.saveCookies();
      
      log('warn', 'Cookie标记为无效', {
        id: cookie.id,
        name: cookie.name,
        error: errorMessage
      });
      
      return cookie;
    } catch (error) {
      logError(error, { stage: '标记Cookie无效' });
      throw error;
    }
  }

  /**
   * 获取配置信息
   * @returns {Object} 配置对象
   */
  getConfig() {
    if (!this.data) {
      throw new Error('Cookie数据未初始化');
    }
    return this.data.config;
  }

  /**
   * 获取元数据
   * @returns {Object} 元数据对象
   */
  getMetadata() {
    if (!this.data) {
      throw new Error('Cookie数据未初始化');
    }
    return this.data.metadata;
  }
}

// 创建并导出单例实例
const cookieManager = new CookieManager();

export default cookieManager;