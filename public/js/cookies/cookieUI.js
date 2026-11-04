/**
 * Cookie UI渲染模块
 * 负责Cookie列表的渲染和UI交互处理
 */

import { escapeHtml, formatNumber, formatDate } from '../utils/format.js';

/**
 * Cookie UI渲染器类
 * 负责渲染Cookie列表和处理UI相关操作
 */
export class CookieUI {
  /**
   * 创建CookieUI实例
   * @param {string} containerId - Cookie列表容器元素ID
   * @param {CookieStateManager} stateManager - 状态管理器实例
   */
  constructor(containerId, stateManager) {
    this.container = document.getElementById(containerId);
    this.stateManager = stateManager;

    // 订阅状态变更，自动重新渲染
    this.unsubscribe = stateManager.subscribe(this.handleStateChange.bind(this));

    // 绑定事件委托
    this.bindEvents();
  }

  /**
   * 销毁UI实例，清理事件监听
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.container) {
      this.container.removeEventListener('click', this.handleClick);
      this.container.removeEventListener('change', this.handleChange);
    }
  }

  /**
   * 处理状态变更
   * @param {Object} state - 当前状态
   * @private
   */
  handleStateChange(state) {
    this.render(state);
  }

  /**
   * 绑定事件
   * @private
   */
  bindEvents() {
    if (!this.container) return;

    // 使用事件委托处理点击事件
    this.container.addEventListener('click', this.handleClick.bind(this));

    // 使用事件委托处理复选框变更事件
    this.container.addEventListener('change', this.handleChange.bind(this));
  }

  /**
   * 处理点击事件
   * @param {Event} event - 点击事件
   * @private
   */
  handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const cookieId = button.dataset.id;

    if (!action || !cookieId) return;

    // 触发自定义事件
    const customEvent = new CustomEvent('cookieAction', {
      detail: { action, cookieId },
      bubbles: true
    });

    button.dispatchEvent(customEvent);
  }

  /**
   * 处理变更事件（复选框）
   * @param {Event} event - 变更事件
   * @private
   */
  handleChange(event) {
    const checkbox = event.target.closest('input[type="checkbox"][data-id]');
    if (!checkbox) return;

    const cookieId = checkbox.dataset.id;

    // 触发自定义事件
    const customEvent = new CustomEvent('cookieSelectionChange', {
      detail: { cookieId, selected: checkbox.checked },
      bubbles: true
    });

    checkbox.dispatchEvent(customEvent);
  }

  /**
   * 渲染Cookie列表
   * @param {Object} state - 当前状态
   */
  render(state) {
    if (!this.container) {
      console.warn('Cookie列表容器不存在');
      return;
    }

    if (state.isLoading) {
      this.renderLoadingState();
      return;
    }

    if (state.filteredCookies.length === 0) {
      this.renderEmptyState(state.searchQuery);
      return;
    }

    const html = state.filteredCookies
      .map(cookie => this.renderCookieItem(cookie, state))
      .join('');

    this.container.innerHTML = html;
    this.container.className = `cookie-list ${state.viewMode}-view`;
  }

  /**
   * 渲染加载状态
   * @private
   */
  renderLoadingState() {
    this.container.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>正在加载Cookie列表...</p>
      </div>
    `;
  }

  /**
   * 渲染空状态
   * @param {string} searchQuery - 当前搜索关键词
   * @private
   */
  renderEmptyState(searchQuery) {
    const isSearch = searchQuery && searchQuery.trim() !== '';

    this.container.innerHTML = `
      <div class="empty-state">
        <i class="fas ${isSearch ? 'fa-search' : 'fa-cookie-brite'}"></i>
        <h3>${isSearch ? '未找到匹配的Cookie' : '暂无Cookie'}</h3>
        <p>${isSearch ? '尝试调整搜索关键词或清空搜索条件' : '开始添加你的第一个Cookie来使用TTS服务'}</p>
        ${!isSearch ? '<button class="btn btn-primary" onclick="window.openCookieModal(\'add\')">添加Cookie</button>' : ''}
      </div>
    `;
  }

  /**
   * 渲染单个Cookie项
   * @param {Object} cookie - Cookie对象
   * @param {Object} state - 当前状态
   * @returns {string} HTML字符串
   * @private
   */
  renderCookieItem(cookie, state) {
    const usageCount = cookie.usage?.usageCount || 0;
    const successCount = cookie.usage?.successCount || 0;
    const failureCount = cookie.usage?.failureCount || 0;
    const lastUsed = cookie.usage?.lastUsed;
    const isValid = cookie.status?.isValid === true;
    const isDisabled = cookie.status?.isDisabled === true;
    const isSelected = state.selectedCookies.has(cookie.id);
    const showCheckbox = state.selectionMode > 0;

    return `
      <div class="cookie-item ${isDisabled ? 'cookie-item-disabled' : ''}" data-id="${cookie.id}">
        <div class="cookie-header">
          ${showCheckbox ? this.renderCheckbox(cookie.id, isSelected, isDisabled) : ''}
          <div class="cookie-title-group">
            <div class="cookie-name">
              <span>${escapeHtml(cookie.name || '未命名Cookie')}</span>
              <div class="cookie-badges">
                ${cookie.status?.isActive ? '<span class="badge badge-active"><i class="fas fa-star"></i> 活跃</span>' : ''}
                ${isDisabled ? '<span class="badge badge-disabled"><i class="fas fa-ban"></i> 已禁用</span>' : ''}
                ${!isDisabled && isValid ?
                  '<span class="badge badge-healthy"><i class="fas fa-check-circle"></i> 有效</span>' :
                  '<span class="badge badge-unhealthy"><i class="fas fa-times-circle"></i> 无效</span>'
                }
              </div>
            </div>
          </div>
          <div class="cookie-actions">
            <button class="btn-icon btn-primary" data-action="view" data-id="${cookie.id}" title="查看详情">
              <i class="fas fa-info-circle"></i>
            </button>
            <button class="btn-icon btn-success" data-action="test" data-id="${cookie.id}" title="测试" ${isDisabled ? 'disabled' : ''}>
              <i class="fas fa-flask"></i>
            </button>
            <button class="btn-icon ${isDisabled ? 'btn-secondary' : 'btn-success'}" data-action="toggle" data-id="${cookie.id}" title="${isDisabled ? '启用' : '禁用'}">
              <i class="fas ${isDisabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
            </button>
            <button class="btn-icon btn-secondary" data-action="edit" data-id="${cookie.id}" title="编辑">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon btn-danger" data-action="delete" data-id="${cookie.id}" title="删除">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>

        <div class="cookie-meta">
          <span class="meta-item" title="总使用次数: ${usageCount}">
            <i class="fas fa-chart-line"></i>
            使用 <strong>${formatNumber(usageCount)}</strong>
          </span>
          <span class="meta-separator">|</span>
          <span class="meta-item meta-success" title="成功次数: ${successCount}">
            <i class="fas fa-check-circle"></i>
            成功 <strong>${formatNumber(successCount)}</strong>
          </span>
          <span class="meta-separator">|</span>
          <span class="meta-item meta-error" title="失败次数: ${failureCount}">
            <i class="fas fa-times-circle"></i>
            失败 <strong>${formatNumber(failureCount)}</strong>
          </span>
          <span class="meta-separator">|</span>
          <span class="meta-item">
            <i class="fas fa-clock"></i>
            最后使用 <strong>${formatDate(lastUsed)}</strong>
          </span>
        </div>

        ${this.renderStatusMessage(cookie, isValid, isDisabled)}
        ${cookie.description ? this.renderDescription(cookie.description) : ''}
      </div>
    `;
  }

  /**
   * 渲染复选框
   * @param {string} cookieId - Cookie ID
   * @param {boolean} isSelected - 是否选中
   * @param {boolean} isDisabled - 是否禁用
   * @returns {string} HTML字符串
   * @private
   */
  renderCheckbox(cookieId, isSelected, isDisabled) {
    return `
      <label class="cookie-checkbox-wrapper" for="cookie_${cookieId}">
        <input type="checkbox"
               id="cookie_${cookieId}"
               data-id="${cookieId}"
               ${isSelected ? 'checked' : ''}
               ${isDisabled ? 'disabled' : ''}>
        <span class="cookie-checkbox-custom"></span>
      </label>
    `;
  }

  /**
   * 渲染状态消息
   * @param {Object} cookie - Cookie对象
   * @param {boolean} isValid - 是否有效
   * @param {boolean} isDisabled - 是否禁用
   * @returns {string} HTML字符串
   * @private
   */
  renderStatusMessage(cookie, isValid, isDisabled) {
    if (!isValid && cookie.status?.lastError) {
      return `
        <div class="cookie-error">
          <span class="error-label">错误信息：</span>
          <span class="error-message">${escapeHtml(cookie.status.lastError)}</span>
        </div>
      `;
    } else if (isDisabled) {
      return `
        <div class="cookie-status cookie-status-disabled">
          <span class="status-label">状态：</span>
          <span class="status-message">已禁用</span>
        </div>
      `;
    } else if (isValid) {
      return `
        <div class="cookie-status">
          <span class="status-label">状态：</span>
          <span class="status-message">运行正常</span>
        </div>
      `;
    }
    return '';
  }

  /**
   * 渲染描述信息
   * @param {string} description - 描述文本
   * @returns {string} HTML字符串
   * @private
   */
  renderDescription(description) {
    return `
      <div class="cookie-description">
        <i class="fas fa-info-circle"></i>
        ${escapeHtml(description)}
      </div>
    `;
  }

  /**
   * 更新统计信息UI
   * @param {Object} stats - 统计数据对象
   */
  updateStatistics(stats) {
    this.updateElement('totalCookies', stats.total);
    this.updateElement('validCookies', stats.valid);
    this.updateElement('invalidCookies', stats.invalid);
    this.updateElement('disabledCookies', stats.disabled);
    this.updateElement('activeCookie', stats.active);
  }

  /**
   * 更新单个元素内容
   * @param {string} id - 元素ID
   * @param {string} content - 内容文本
   * @private
   */
  updateElement(id, content) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = content;
    }
  }

  /**
   * 更新排序按钮图标
   * @param {string} sortOrder - 排序顺序 ('asc' 或 'desc')
   */
  updateSortButtonIcon(sortOrder) {
    const sortOrderBtn = document.getElementById('sortOrderBtn');
    if (!sortOrderBtn) return;

    const icon = sortOrderBtn.querySelector('i');
    if (icon) {
      icon.className = sortOrder === 'asc' ?
        'fas fa-sort-amount-down' : 'fas fa-sort-amount-up';
    }
  }

  /**
   * 更新视图模式按钮图标
   * @param {string} viewMode - 视图模式 ('list' 或 'grid')
   */
  updateViewModeButtonIcon(viewMode) {
    const viewModeBtn = document.getElementById('viewModeBtn');
    if (!viewModeBtn) return;

    const icon = viewModeBtn.querySelector('i');
    if (icon) {
      icon.className = viewMode === 'list' ?
        'fas fa-th-large' : 'fas fa-list';
    }
  }

  /**
   * 更新全选复选框状态
   * @param {number} selectionMode - 多选模式 (0, 1, 2)
   */
  updateSelectAllCheckbox(selectionMode) {
    const selectAllCheckbox = document.getElementById('selectAllCookies');
    const checkboxLabel = document.querySelector('.checkbox-label');

    if (!selectAllCheckbox) return;

    const labels = ['多选', '全选', '清空'];

    switch (selectionMode) {
      case 0:
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        break;
      case 1:
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
        break;
      case 2:
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
        break;
    }

    if (checkboxLabel) {
      checkboxLabel.textContent = labels[selectionMode];
    }
  }

  /**
   * 更新批量操作工具栏
   * @param {number} selectedCount - 选中的Cookie数量
   */
  updateBatchToolbar(selectedCount) {
    const batchToolbar = document.getElementById('batchToolbar');
    const selectedCountEl = document.getElementById('selectedCount');

    if (selectedCountEl) {
      selectedCountEl.textContent = selectedCount;
    }

    if (batchToolbar) {
      batchToolbar.style.display = selectedCount > 0 ? 'flex' : 'none';
    }
  }
}
