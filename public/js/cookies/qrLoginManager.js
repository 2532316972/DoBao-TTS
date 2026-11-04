/**
 * 二维码登录管理模块
 * 负责二维码登录的完整流程：获取二维码、状态轮询、确认登录
 */

import { toast } from '../utils/toast.js';

/**
 * 二维码登录管理器类
 * 封装二维码登录的所有功能
 */
export class QRLoginManager {
  constructor() {
    this.state = {
      sessionId: null,
      statusCheckTimer: null,
      countdownTimer: null,
      remainingTime: 300,
      isLoading: false,
      currentStatus: 'init' // init, loading, pending, scanned, confirmed, expired
    };

    this.statusCallbacks = new Map();
  }

  /**
   * 重置所有状态
   */
  reset() {
    this.clearTimers();

    this.state.sessionId = null;
    this.state.currentStatus = 'init';
    this.state.isLoading = false;
    this.state.remainingTime = 300;

    // 触发状态变更回调
    this.triggerStatusCallback('init');
  }

  /**
   * 清除所有定时器
   * @private
   */
  clearTimers() {
    if (this.state.statusCheckTimer) {
      clearInterval(this.state.statusCheckTimer);
      this.state.statusCheckTimer = null;
    }

    if (this.state.countdownTimer) {
      clearInterval(this.state.countdownTimer);
      this.state.countdownTimer = null;
    }
  }

  /**
   * 获取当前状态
   * @returns {string} 当前状态
   */
  getCurrentStatus() {
    return this.state.currentStatus;
  }

  /**
   * 获取二维码
   * @returns {Promise<boolean>} 获取成功返回true，失败返回false
   */
  async getQrCode() {
    if (this.state.isLoading) {
      return false;
    }

    this.state.isLoading = true;
    this.state.currentStatus = 'loading';
    this.triggerStatusCallback('loading');

    try {
      const response = await fetch('/api/auth/qr-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (result.success) {
        this.state.sessionId = result.data.sessionId;
        this.state.currentStatus = 'pending';

        // 触发状态变更回调
        this.triggerStatusCallback('pending', { qrCodeImg: result.data.qrCodeImg });

        // 开始倒计时
        this.startCountdown();

        // 开始状态检查
        this.startStatusCheck();

        toast('success', '二维码已生成', '请使用豆包APP或抖音APP扫描');
        return true;
      } else {
        throw new Error(result.error || '获取二维码失败');
      }
    } catch (error) {
      console.error('获取二维码失败:', error);
      this.state.currentStatus = 'init';
      this.triggerStatusCallback('init');
      toast('error', '获取失败', error.message);
      return false;
    } finally {
      this.state.isLoading = false;
    }
  }

  /**
   * 开始倒计时
   * @private
   */
  startCountdown() {
    this.state.remainingTime = 60; // 1分钟有效期

    // 立即更新一次显示
    this.triggerStatusCallback('countdown', { remainingTime: this.state.remainingTime });

    this.state.countdownTimer = setInterval(() => {
      this.state.remainingTime--;

      if (this.state.remainingTime <= 0) {
        this.clearTimers();
        this.state.currentStatus = 'expired';
        this.triggerStatusCallback('expired');
        return;
      }

      this.triggerStatusCallback('countdown', { remainingTime: this.state.remainingTime });
    }, 1000);
  }

  /**
   * 开始状态检查轮询
   * @private
   */
  startStatusCheck() {
    // 清除之前的定时器
    if (this.state.statusCheckTimer) {
      clearInterval(this.state.statusCheckTimer);
    }

    // 每3秒检查一次状态
    this.state.statusCheckTimer = setInterval(async () => {
      // 如果没有会话ID，停止检查
      if (!this.state.sessionId) {
        this.clearTimers();
        return;
      }

      // 如果已过期或已确认，停止检查
      if (this.state.currentStatus === 'expired' || this.state.currentStatus === 'confirmed') {
        this.clearTimers();
        return;
      }

      try {
        const response = await fetch('/api/auth/qr-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sessionId: this.state.sessionId
          })
        });

        const result = await response.json();

        if (!result.success) {
          // 会话过期
          if (result.status === 'expired') {
            this.state.currentStatus = 'expired';
            this.clearTimers();
            this.triggerStatusCallback('expired');
          }
          return;
        }

        // 根据状态更新UI
        switch (result.status) {
          case 'scanned':
            if (this.state.currentStatus !== 'scanned') {
              this.state.currentStatus = 'scanned';
              this.triggerStatusCallback('scanned');
              toast('info', '已扫描', '请在手机上确认登录');
            }
            break;

          case 'confirmed':
            this.state.currentStatus = 'confirmed';
            this.clearTimers();
            this.triggerStatusCallback('confirmed');
            toast('success', '登录成功', '请点击"保存Cookie"按钮');
            break;
        }

      } catch (error) {
        console.error('检查二维码状态失败:', error);
      }
    }, 3000);
  }

  /**
   * 确认登录并保存Cookie
   * @param {string} cookieName - Cookie名称
   * @returns {Promise<Object|null>} 保存成功返回Cookie对象，失败返回null
   */
  async confirmLogin(cookieName) {
    if (!this.state.sessionId) {
      toast('error', '错误', '会话已过期，请重新获取二维码');
      return null;
    }

    if (!cookieName || !cookieName.trim()) {
      toast('error', '验证失败', '请输入Cookie名称');
      return null;
    }

    try {
      const response = await fetch('/api/auth/qr-confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.state.sessionId,
          cookieName: cookieName.trim()
        })
      });

      const result = await response.json();

      if (result.success) {
        toast('success', '保存成功', `Cookie "${result.data.name}" 已添加`);
        return result.data;
      } else {
        throw new Error(result.error || '保存Cookie失败');
      }
    } catch (error) {
      console.error('保存Cookie失败:', error);
      toast('error', '保存失败', error.message);
      return null;
    }
  }

  /**
   * 注册状态变更回调
   * @param {string} status - 状态名称
   * @param {Function} callback - 回调函数
   */
  onStatusChange(status, callback) {
    if (!this.statusCallbacks.has(status)) {
      this.statusCallbacks.set(status, []);
    }
    this.statusCallbacks.get(status).push(callback);
  }

  /**
   * 移除状态变更回调
   * @param {string} status - 状态名称
   * @param {Function} callback - 回调函数
   */
  offStatusChange(status, callback) {
    if (!this.statusCallbacks.has(status)) return;

    const callbacks = this.statusCallbacks.get(status);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * 触发状态变更回调
   * @param {string} status - 状态名称
   * @param {Object} data - 附加数据
   * @private
   */
  triggerStatusCallback(status, data = {}) {
    if (!this.statusCallbacks.has(status)) return;

    const callbacks = this.statusCallbacks.get(status);
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('状态回调执行失败:', error);
      }
    });
  }

  /**
   * 格式化倒计时显示
   * @param {number} seconds - 剩余秒数
   * @returns {string} 格式化后的时间字符串
   */
  formatCountdown(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs.toString().padStart(2, '0')}秒`;
  }

  /**
   * 检查是否正在加载中
   * @returns {boolean} 是否正在加载
   */
  isLoading() {
    return this.state.isLoading;
  }

  /**
   * 检查是否可以确认登录
   * @returns {boolean} 是否可以确认
   */
  canConfirm() {
    return this.state.currentStatus === 'confirmed' && this.state.sessionId !== null;
  }
}
