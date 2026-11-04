/**
 * Cookie数据管理模块
 * 负责Cookie数据的加载、保存、验证等业务逻辑
 */

import { toast } from '../utils/toast.js';

/**
 * Cookie管理器类
 * 封装Cookie的所有数据操作
 */
export class CookieManager {
  constructor() {
    this.cookies = [];
    this.filteredCookies = [];
    this.isLoading = false;
  }

  /**
   * 加载Cookie数据
   * @returns {Promise<Array>} Cookie数据数组
   * @throws {Error} 加载失败时抛出错误
   */
  async loadCookies() {
    this.isLoading = true;

    try {
      const response = await fetch('/api/cookies');
      const result = await response.json();

      if (result.success) {
        this.cookies = result.data || [];
        this.filteredCookies = [...this.cookies];
        return this.cookies;
      } else {
        throw new Error(result.error || '加载Cookie数据失败');
      }
    } catch (error) {
      console.error('加载Cookie失败:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * 应用筛选和排序
   * @param {string} searchQuery - 搜索关键词
   * @param {string} sortBy - 排序字段
   * @param {string} sortOrder - 排序顺序 ('asc' 或 'desc')
   * @returns {Array} 筛选和排序后的Cookie数组
   */
  applyFilters(searchQuery = '', sortBy = 'name', sortOrder = 'asc') {
    let filtered = [...this.cookies];

    // 应用搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(cookie =>
        (cookie.name && cookie.name.toLowerCase().includes(query)) ||
        (cookie.description && cookie.description.toLowerCase().includes(query))
      );
    }

    // 应用排序
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'usageCount':
          aVal = a.usage?.usageCount || 0;
          bVal = b.usage?.usageCount || 0;
          break;
        case 'createdAt':
          aVal = new Date(a.metadata?.createdAt || 0).getTime();
          bVal = new Date(b.metadata?.createdAt || 0).getTime();
          break;
        default:
          aVal = a.name || '';
          bVal = b.name || '';
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    this.filteredCookies = filtered;
    return this.filteredCookies;
  }

  /**
   * 添加新Cookie
   * @param {Object} cookieData - Cookie数据对象
   * @param {string} cookieData.name - Cookie名称
   * @param {string} cookieData.value - Cookie值
   * @param {string} [cookieData.description] - Cookie描述
   * @returns {Promise<Object>} 添加成功的Cookie对象
   * @throws {Error} 添加失败时抛出错误
   */
  async addCookie(cookieData) {
    const response = await fetch('/api/cookies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cookieData)
    });

    const result = await response.json();

    if (result.success) {
      await this.loadCookies();
      return result.data;
    } else {
      throw new Error(result.error || '添加Cookie失败');
    }
  }

  /**
   * 更新Cookie
   * @param {string} cookieId - Cookie ID
   * @param {Object} cookieData - 更新的Cookie数据
   * @returns {Promise<Object>} 更新后的Cookie对象
   * @throws {Error} 更新失败时抛出错误
   */
  async updateCookie(cookieId, cookieData) {
    const response = await fetch(`/api/cookies/${cookieId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cookieData)
    });

    const result = await response.json();

    if (result.success) {
      await this.loadCookies();
      return result.data;
    } else {
      throw new Error(result.error || '更新Cookie失败');
    }
  }

  /**
   * 删除Cookie
   * @param {string} cookieId - Cookie ID
   * @returns {Promise<boolean>} 删除成功返回true
   * @throws {Error} 删除失败时抛出错误
   */
  async deleteCookie(cookieId) {
    const response = await fetch(`/api/cookies/${cookieId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      await this.loadCookies();
      return true;
    } else {
      throw new Error(result.error || '删除Cookie失败');
    }
  }

  /**
   * 测试Cookie有效性
   * @param {string} cookieId - Cookie ID
   * @returns {Promise<boolean>} 测试成功返回true
   * @throws {Error} 测试失败时抛出错误
   */
  async testCookie(cookieId) {
    const response = await fetch(`/api/cookies/${cookieId}/test`, {
      method: 'POST'
    });

    const result = await response.json();

    if (result.success) {
      await this.loadCookies();
      return true;
    } else {
      throw new Error(result.error || '测试Cookie失败');
    }
  }

  /**
   * 切换Cookie禁用状态
   * @param {string} cookieId - Cookie ID
   * @param {boolean} disabled - 是否禁用
   * @returns {Promise<Object>} 更新后的Cookie对象
   * @throws {Error} 操作失败时抛出错误
   */
  async toggleCookieDisabled(cookieId, disabled) {
    const response = await fetch(`/api/cookies/${cookieId}/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ disabled })
    });

    const result = await response.json();

    if (result.success) {
      // 更新本地状态
      const cookie = this.cookies.find(c => c.id === cookieId);
      if (cookie) {
        cookie.status.isDisabled = disabled;
      }
      return result.data;
    } else {
      throw new Error(result.error || '切换Cookie状态失败');
    }
  }

  /**
   * 获取Cookie详情
   * @param {string} cookieId - Cookie ID
   * @returns {Promise<Object>} Cookie详情对象
   * @throws {Error} 获取失败时抛出错误
   */
  async getCookieDetail(cookieId) {
    const response = await fetch(`/api/cookies/${cookieId}`);
    const result = await response.json();

    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error || '获取Cookie详情失败');
    }
  }

  /**
   * 获取Cookie统计数据
   * @returns {Object} 统计数据对象
   */
  getStatistics() {
    return {
      total: this.cookies.length,
      valid: this.cookies.filter(c => c.status?.isValid === true && !c.status?.isDisabled).length,
      invalid: this.cookies.filter(c => c.status?.isValid === false || c.status?.isDisabled).length,
      disabled: this.cookies.filter(c => c.status?.isDisabled === true).length,
      active: this.cookies.find(c => c.status?.isActive)?.name || '-'
    };
  }

  /**
   * 根据ID查找Cookie
   * @param {string} cookieId - Cookie ID
   * @returns {Object|undefined} Cookie对象或undefined
   */
  findCookieById(cookieId) {
    return this.cookies.find(c => c.id === cookieId);
  }

  /**
   * 获取所有Cookie
   * @returns {Array} Cookie数组
   */
  getAllCookies() {
    return this.cookies;
  }

  /**
   * 获取筛选后的Cookie
   * @returns {Array} 筛选后的Cookie数组
   */
  getFilteredCookies() {
    return this.filteredCookies;
  }
}
