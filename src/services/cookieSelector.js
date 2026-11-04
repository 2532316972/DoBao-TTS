/**
 * Cookie选择器类
 * 负责根据不同策略选择合适的Cookie
 * 当前支持round-robin（顺序轮询）策略
 */

import cookieManager from './cookieManager.js';
import { log, logError } from '../utils/logger.js';

/**
 * Cookie选择器类
 */
class CookieSelector {
  constructor() {
    this.cookieManager = cookieManager;
    this.healthyCookiesCache = null;
    this.cacheTimestamp = null;
    this.cacheDuration = 60000; // 缓存持续时间：60秒
  }

  /**
   * 根据策略选择Cookie
   * @param {string} strategy - 选择策略（默认使用配置中的策略）
   * @returns {Object|null} 选中的Cookie对象或null
   */
  async selectCookie(strategy = null) {
    try {
      // 确保Cookie管理器已初始化
      if (!this.cookieManager.initialized) {
        await this.cookieManager.initialize();
      }

      // 获取配置的策略
      const config = this.cookieManager.getConfig();
      const selectedStrategy = strategy || config.rotation.strategy;

      log('info', '选择Cookie', {
        strategy: selectedStrategy
      });

      // 根据策略选择Cookie
      switch (selectedStrategy) {
        case 'round-robin':
          return await this.selectRoundRobin();
        default:
          log('warn', '未知的选择策略，使用round-robin', { strategy: selectedStrategy });
          return await this.selectRoundRobin();
      }
    } catch (error) {
      logError(error, { stage: '选择Cookie' });
      return null;
    }
  }

  /**
   * 顺序轮询选择Cookie
   * @returns {Object|null} 选中的Cookie对象或null
   */
  async selectRoundRobin() {
    try {
      const validCookies = this.getValidCookies();
      
      if (validCookies.length === 0) {
        log('warn', '没有可用的有效Cookie');
        return null;
      }

      const config = this.cookieManager.getConfig();
      const currentIndex = config.rotation.currentIndex || 0;
      
      // 获取当前索引对应的Cookie
      const selectedCookie = validCookies[currentIndex % validCookies.length];
      
      log('info', 'Round-robin选择Cookie', {
        id: selectedCookie.id,
        name: selectedCookie.name,
        index: currentIndex
      });
      
      return selectedCookie;
    } catch (error) {
      logError(error, { stage: 'Round-robin选择' });
      return null;
    }
  }

  /**
   * 轮换到下一个Cookie
   * @returns {Promise<Object|null>} 下一个Cookie对象或null
   */
  async rotateToNext() {
    try {
      const validCookies = this.getValidCookies();

      if (validCookies.length === 0) {
        log('warn', '没有可用的有效Cookie进行轮换');
        return null;
      }

      const config = this.cookieManager.getConfig();
      const currentIndex = config.rotation.currentIndex || 0;
      const nextIndex = (currentIndex + 1) % validCookies.length;

      // 获取下一个Cookie
      const nextCookie = validCookies[nextIndex];

      // 设置为活跃Cookie
      await this.cookieManager.setActiveCookie(nextCookie.id);

      // 更新索引
      config.rotation.currentIndex = nextIndex;
      await this.cookieManager.saveCookies();

      log('info', 'Cookie轮换成功', {
        id: nextCookie.id,
        name: nextCookie.name,
        newIndex: nextIndex
      });

      return nextCookie;
    } catch (error) {
      logError(error, { stage: 'Cookie轮换' });
      return null;
    }
  }

  /**
   * 检查当前Cookie是否有效，如果无效则轮换到下一个
   * 新版逻辑：Cookie一直使用直到被标记为封禁/无效后才轮换
   * @returns {Promise<boolean>} 是否发生了轮换
   */
  async checkAndRotateIfInvalid() {
    try {
      // 获取当前活跃的Cookie
      const currentCookie = this.cookieManager.getActiveCookie();
      
      if (!currentCookie) {
        log('warn', '当前没有活跃的Cookie，尝试选择下一个');
        const nextCookie = await this.rotateToNext();
        return !!nextCookie;
      }

      // 检查当前Cookie是否仍然有效
      const isValid = currentCookie.status?.isValid !== false;
      const isDisabled = currentCookie.status?.isDisabled === true;
      
      log('info', '检查当前Cookie状态', {
        cookieId: currentCookie.id,
        cookieName: currentCookie.name,
        isValid: isValid,
        isDisabled: isDisabled
      });

      // 如果Cookie无效或被禁用，轮换到下一个
      if (!isValid || isDisabled) {
        log('info', '当前Cookie已失效或被禁用，准备轮换', {
          cookieId: currentCookie.id,
          cookieName: currentCookie.name,
          reason: !isValid ? '无效' : '被禁用'
        });

        // 轮换到下一个Cookie
        const nextCookie = await this.rotateToNext();

        if (nextCookie) {
          log('info', '已自动轮换到下一个Cookie', {
            id: nextCookie.id,
            name: nextCookie.name,
            reason: '当前Cookie失效'
          });
          return true;
        }
      }

      return false;
    } catch (error) {
      logError(error, { stage: '检查Cookie状态并轮换' });
      return false;
    }
  }

  /**
   * 获取所有有效的Cookie
   * @returns {Array} 有效的Cookie数组
   */
  getValidCookies() {
    try {
      // 检查缓存是否有效
      const now = Date.now();
      if (this.healthyCookiesCache &&
          this.cacheTimestamp &&
          (now - this.cacheTimestamp) < this.cacheDuration) {
        return this.healthyCookiesCache;
      }

      // 更新缓存
      return this.updateValidCache();
    } catch (error) {
      logError(error, { stage: '获取有效Cookie' });
      return [];
    }
  }

  /**
   * 更新有效Cookie缓存
   * @returns {Array} 有效的Cookie数组
   */
  updateValidCache() {
    try {
      const allCookies = this.cookieManager.getCookies();
      const validationCache = this.cookieManager.getValidationCache();

      // 筛选有效的Cookie（结合验证缓存：最近验证为无效的cookie即使status标记未更新也先剔除）
      const validCookies = allCookies.filter(cookie => {
        // 检查Cookie是否有效
        if (!(cookie.status && cookie.status.isValid === true)) {
          return false;
        }
        // 若存在较新的验证记录且判为无效，则剔除（补充status未及时更新的情况）
        const cacheEntry = validationCache[cookie.id];
        if (cacheEntry && cacheEntry.isValid === false) {
          const cacheTime = cacheEntry.timestamp ? new Date(cacheEntry.timestamp).getTime() : 0;
          const lastValidated = cookie.status.lastValidated ? new Date(cookie.status.lastValidated).getTime() : 0;
          // 仅当缓存验证时间不早于status更新时间时采纳（避免旧缓存误伤已恢复的Cookie）
          if (cacheTime >= lastValidated) {
            log('debug', '验证缓存判定Cookie无效，跳过', {
              cookieId: cookie.id,
              cacheMessage: cacheEntry.message
            });
            return false;
          }
        }
        return true;
      });

      // 按优先级排序
      validCookies.sort((a, b) => {
        // 首先按优先级排序（高优先级在前）
        const priorityDiff = (b.metadata?.priority || 5) - (a.metadata?.priority || 5);
        if (priorityDiff !== 0) return priorityDiff;
        
        // 优先级相同时按使用次数排序（使用少的优先）
        return (a.usage?.usageCount || 0) - (b.usage?.usageCount || 0);
      });

      // 更新缓存
      this.healthyCookiesCache = validCookies;
      this.cacheTimestamp = Date.now();

      log('info', '有效Cookie缓存更新', {
        total: allCookies.length,
        valid: validCookies.length
      });

      return validCookies;
    } catch (error) {
      logError(error, { stage: '更新有效Cookie缓存' });
      return [];
    }
  }

  /**
   * 清除有效Cookie缓存
   */
  clearHealthyCache() {
    this.healthyCookiesCache = null;
    this.cacheTimestamp = null;
    log('info', '有效Cookie缓存已清除');
  }

  /**
   * 获取所有健康的Cookie（向后兼容方法）
   * @returns {Array} 有效的Cookie数组
   */
  getHealthyCookies() {
    return this.getValidCookies();
  }

  /**
   * 选择最佳Cookie（基于优先级和使用次数）
   * @returns {Object|null} 最佳Cookie对象或null
   */
  selectBestCookie() {
    try {
      const validCookies = this.getValidCookies();
      
      if (validCookies.length === 0) {
        return null;
      }

      // 计算每个Cookie的综合得分
      const cookiesWithScore = validCookies.map(cookie => {
        const successCount = cookie.usage?.successCount || 0;
        const failureCount = cookie.usage?.failureCount || 0;
        const totalAttempts = successCount + failureCount;
        const successRate = totalAttempts > 0 ? successCount / totalAttempts : 1.0;
        const priority = cookie.metadata?.priority || 5;
        const usageCount = cookie.usage?.usageCount || 0;
        
        // 综合得分 = 成功率 * 100 * 0.5 + 优先级 * 10 * 0.3 - 使用次数 * 0.2
        const totalScore = successRate * 100 * 0.5 + priority * 10 * 0.3 - usageCount * 0.2;
        
        return {
          cookie,
          score: totalScore
        };
      });

      // 按得分排序
      cookiesWithScore.sort((a, b) => b.score - a.score);
      
      const bestCookie = cookiesWithScore[0].cookie;
      
      log('info', '选择最佳Cookie', {
        id: bestCookie.id,
        name: bestCookie.name,
        score: cookiesWithScore[0].score.toFixed(2)
      });
      
      return bestCookie;
    } catch (error) {
      logError(error, { stage: '选择最佳Cookie' });
      return null;
    }
  }

  /**
   * 获取Cookie统计信息
   * @returns {Object} 统计信息对象
   */
  getStatistics() {
    try {
      const allCookies = this.cookieManager.getCookies();
      const validCookies = this.getValidCookies();
      const metadata = this.cookieManager.getMetadata();

      return {
        total: allCookies.length,
        valid: validCookies.length,
        invalid: allCookies.length - validCookies.length,
        // 保留healthy/unhealthy以兼容旧代码
        healthy: validCookies.length,
        unhealthy: allCookies.length - validCookies.length,
        totalRequests: metadata.totalRequests || 0,
        totalRotations: metadata.totalRotations || 0,
        averageSuccessRate: this.calculateAverageSuccessRate(allCookies)
      };
    } catch (error) {
      logError(error, { stage: '获取统计信息' });
      return null;
    }
  }

  /**
   * 计算平均成功率
   * @param {Array} cookies - Cookie数组
   * @returns {number} 平均成功率
   */
  calculateAverageSuccessRate(cookies) {
    if (cookies.length === 0) return 0;
    
    let totalSuccess = 0;
    let totalAttempts = 0;
    
    cookies.forEach(cookie => {
      const success = cookie.usage?.successCount || 0;
      const failure = cookie.usage?.failureCount || 0;
      totalSuccess += success;
      totalAttempts += (success + failure);
    });
    
    return totalAttempts > 0 ? totalSuccess / totalAttempts : 1.0;
  }
}

// 创建并导出单例实例
const cookieSelector = new CookieSelector();

export default cookieSelector;