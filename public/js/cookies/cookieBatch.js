/**
 * Cookie批量操作模块
 * 负责Cookie的批量测试和批量删除功能
 */

import { toast } from '../utils/toast.js';

/**
 * Cookie批量操作类
 * 封装批量测试和批量删除功能
 */
export class CookieBatch {
  /**
   * 创建CookieBatch实例
   * @param {CookieManager} cookieManager - Cookie管理器实例
   * @param {CookieStateManager} stateManager - 状态管理器实例
   */
  constructor(cookieManager, stateManager) {
    this.cookieManager = cookieManager;
    this.stateManager = stateManager;
    this.isProcessing = false;
  }

  /**
   * 批量测试选中的Cookie
   * @returns {Promise<Object>} 测试结果对象 {successCount, failCount}
   */
  async batchTest() {
    if (this.isProcessing) {
      toast('warning', '提示', '批量操作正在进行中，请稍候');
      return null;
    }

    const selectedIds = this.stateManager.getSelectedCookieIds();

    if (selectedIds.length === 0) {
      toast('warning', '提示', '请先选择要检测的Cookie');
      return null;
    }

    this.isProcessing = true;

    // 更新按钮状态
    this.updateBatchTestButtonState(true);

    toast('info', '批量检测', `正在检测 ${selectedIds.length} 个Cookie...`);

    let successCount = 0;
    let failCount = 0;

    try {
      for (const cookieId of selectedIds) {
        try {
          await this.cookieManager.testCookie(cookieId);
          successCount++;
        } catch (error) {
          failCount++;
          console.error(`测试Cookie ${cookieId} 失败:`, error);
        }
      }

      // 重新加载Cookie数据以更新状态
      await this.cookieManager.loadCookies();

      // 清除选中状态
      this.stateManager.clearSelection();

      // 显示结果
      if (successCount > 0) {
        toast('success', '检测完成', `成功: ${successCount}, 失败: ${failCount}`);
      } else {
        toast('warning', '检测完成', `成功: ${successCount}, 失败: ${failCount}`);
      }

      return { successCount, failCount };

    } catch (error) {
      console.error('批量测试失败:', error);
      toast('error', '批量测试失败', error.message);
      return null;

    } finally {
      this.isProcessing = false;
      this.updateBatchTestButtonState(false);
    }
  }

  /**
   * 批量删除选中的Cookie
   * @returns {Promise<Object>} 删除结果对象 {successCount, failCount}
   */
  async batchDelete() {
    if (this.isProcessing) {
      toast('warning', '提示', '批量操作正在进行中，请稍候');
      return null;
    }

    const selectedIds = this.stateManager.getSelectedCookieIds();

    if (selectedIds.length === 0) {
      toast('warning', '提示', '请先选择要删除的Cookie');
      return null;
    }

    // 获取Cookie名称用于确认对话框
    const cookieNames = selectedIds.map(id => {
      const cookie = this.stateManager.getState().cookies.find(c => c.id === id);
      return cookie ? cookie.name : id;
    });

    // 显示确认对话框
    const confirmed = await this.showBatchDeleteConfirmDialog(selectedIds.length, cookieNames);

    if (!confirmed) {
      return null;
    }

    this.isProcessing = true;

    // 更新按钮状态
    this.updateBatchDeleteButtonState(true);

    toast('info', '批量删除', `正在删除 ${selectedIds.length} 个Cookie...`);

    let successCount = 0;
    let failCount = 0;

    try {
      for (const cookieId of selectedIds) {
        try {
          await this.cookieManager.deleteCookie(cookieId);
          successCount++;
        } catch (error) {
          failCount++;
          console.error(`删除Cookie ${cookieId} 失败:`, error);
        }
      }

      // 重新加载Cookie数据
      await this.cookieManager.loadCookies();

      // 清除选中状态
      this.stateManager.clearSelection();

      // 显示结果
      toast('success', '批量删除完成', `成功删除: ${successCount}, 失败: ${failCount}`);

      return { successCount, failCount };

    } catch (error) {
      console.error('批量删除失败:', error);
      toast('error', '批量删除失败', error.message);
      return null;

    } finally {
      this.isProcessing = false;
      this.updateBatchDeleteButtonState(false);
    }
  }

  /**
   * 显示批量删除确认对话框
   * @param {number} count - 要删除的Cookie数量
   * @param {Array<string>} cookieNames - Cookie名称列表
   * @returns {Promise<boolean>} 用户确认返回true，取消返回false
   * @private
   */
  showBatchDeleteConfirmDialog(count, cookieNames) {
    return new Promise((resolve) => {
      // 使用原生confirm对话框
      const message = `确定要删除以下 ${count} 个Cookie吗？\n\n${cookieNames.join(', ')}`;
      const confirmed = confirm(message);
      resolve(confirmed);
    });
  }

  /**
   * 更新批量测试按钮状态
   * @param {boolean} isLoading - 是否正在加载
   * @private
   */
  updateBatchTestButtonState(isLoading) {
    const btn = document.getElementById('batchTestBtn');
    if (!btn) return;

    if (isLoading) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>检测中...</span>';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-flask"></i><span>检测</span>';
    }
  }

  /**
   * 更新批量删除按钮状态
   * @param {boolean} isLoading - 是否正在加载
   * @private
   */
  updateBatchDeleteButtonState(isLoading) {
    const btn = document.getElementById('batchDeleteBtn');
    if (!btn) return;

    if (isLoading) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>删除中...</span>';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-trash"></i><span>删除</span>';
    }
  }

  /**
   * 检查是否正在处理中
   * @returns {boolean} 是否正在处理
   */
  isProcessingBatch() {
    return this.isProcessing;
  }
}
