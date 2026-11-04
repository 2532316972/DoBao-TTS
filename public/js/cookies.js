/**
 * Cookie管理页面脚本（重构版）
 * 模块化设计，协调各个子模块完成Cookie管理功能
 */

import { CookieManager } from './cookies/cookieManager.js';
import { CookieStateManager } from './cookies/cookieStateManager.js';
import { CookieUI } from './cookies/cookieUI.js';
import { CookieBatch } from './cookies/cookieBatch.js';
import { QRLoginManager } from './cookies/qrLoginManager.js';
import { debounce } from './utils/debounce.js';
import { toast } from './utils/toast.js';
import { formatDateTime } from './utils/format.js';

// ==================== 全局模块实例 ====================

const cookieManager = new CookieManager();
const stateManager = new CookieStateManager();
const cookieUI = new CookieUI('cookieList', stateManager);
const cookieBatch = new CookieBatch(cookieManager, stateManager);
const qrLoginManager = new QRLoginManager();

// ==================== 页面初始化 ====================

/**
 * 页面加载完成后初始化
 */
document.addEventListener('DOMContentLoaded', function() {
  console.log('Cookie管理页面加载完成');
  initializePage();
});

/**
 * 初始化页面
 */
async function initializePage() {
  try {
    bindEventListeners();
    bindQRLoginEvents();
    bindModalEvents();
    await loadCookies();
    console.log('页面初始化完成');
  } catch (error) {
    console.error('页面初始化失败:', error);
    toast('error', '页面初始化失败', '请刷新页面重试');
  }
}

// ==================== 事件绑定 ====================

/**
 * 绑定主要事件监听器
 */
function bindEventListeners() {
  // 刷新按钮
  const refreshBtn = document.getElementById('refreshCookies');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', handleRefresh);
  }

  // 添加Cookie按钮
  const addCookieBtn = document.getElementById('addCookieBtn');
  if (addCookieBtn) {
    addCookieBtn.addEventListener('click', () => openCookieModal('add'));
  }

  // 搜索输入框（防抖）
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(handleSearch, 300));
  }

  // 排序选择器
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', handleSortChange);
  }

  // 排序顺序按钮
  const sortOrderBtn = document.getElementById('sortOrderBtn');
  if (sortOrderBtn) {
    sortOrderBtn.addEventListener('click', handleSortOrderToggle);
  }

  // 视图模式切换按钮
  const viewModeBtn = document.getElementById('viewModeBtn');
  if (viewModeBtn) {
    viewModeBtn.addEventListener('click', handleViewModeToggle);
  }

  // 批量操作按钮
  const batchTestBtn = document.getElementById('batchTestBtn');
  if (batchTestBtn) {
    batchTestBtn.addEventListener('click', () => cookieBatch.batchTest());
  }

  const batchDeleteBtn = document.getElementById('batchDeleteBtn');
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', () => cookieBatch.batchDelete());
  }

  // 全选按钮
  const selectAllWrapper = document.querySelector('.checkbox-wrapper');
  if (selectAllWrapper) {
    selectAllWrapper.addEventListener('click', handleSelectAllClick);
  }

  // Cookie列表事件委托
  const cookieList = document.getElementById('cookieList');
  if (cookieList) {
    cookieList.addEventListener('cookieAction', handleCookieAction);
    cookieList.addEventListener('cookieSelectionChange', handleCookieSelectionChange);
  }
}

/**
 * 绑定二维码登录事件
 */
function bindQRLoginEvents() {
  // 二维码登录按钮
  const qrLoginBtn = document.getElementById('qrLoginBtn');
  if (qrLoginBtn) {
    qrLoginBtn.addEventListener('click', openQrLoginModal);
  }

  // 获取二维码按钮
  const getQrCodeBtn = document.getElementById('getQrCodeBtn');
  if (getQrCodeBtn) {
    getQrCodeBtn.addEventListener('click', () => qrLoginManager.getQrCode());
  }

  // 确认登录按钮
  const confirmQrLoginBtn = document.getElementById('confirmQrLoginBtn');
  if (confirmQrLoginBtn) {
    confirmQrLoginBtn.addEventListener('click', handleQrLoginConfirm);
  }

  // Cookie名称输入验证
  const cookieNameInput = document.getElementById('cookieNameQr');
  if (cookieNameInput) {
    cookieNameInput.addEventListener('input', updateQrLoginButtonState);
  }

  // 注册二维码状态回调
  qrLoginManager.onStatusChange('init', () => updateQrCodeUI('init'));
  qrLoginManager.onStatusChange('loading', () => updateQrCodeUI('loading'));
  qrLoginManager.onStatusChange('pending', (data) => updateQrCodeUI('pending', data));
  qrLoginManager.onStatusChange('scanned', () => updateQrCodeUI('scanned'));
  qrLoginManager.onStatusChange('confirmed', () => updateQrCodeUI('confirmed'));
  qrLoginManager.onStatusChange('expired', () => updateQrCodeUI('expired'));
  qrLoginManager.onStatusChange('countdown', (data) => updateQrCodeTimer(data.remainingTime));
}

/**
 * 绑定模态框事件
 */
function bindModalEvents() {
  // Cookie表单模态框
  const cookieModal = document.getElementById('cookieModal');
  const closeModal = document.getElementById('closeModal');
  const cancelBtn = document.getElementById('cancelBtn');
  const cookieForm = document.getElementById('cookieForm');
  const testBtn = document.getElementById('testBtn');

  if (closeModal) closeModal.addEventListener('click', closeCookieModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeCookieModal);
  if (cookieForm) cookieForm.addEventListener('submit', handleCookieSubmit);
  if (testBtn) testBtn.addEventListener('click', handleTestCurrentCookie);

  // 点击遮罩层关闭
  if (cookieModal) {
    cookieModal.querySelector('.modal-overlay')?.addEventListener('click', closeCookieModal);
  }

  // 详情模态框
  const detailModal = document.getElementById('detailModal');
  const closeDetailModal = document.getElementById('closeDetailModal');
  const closeDetailBtn = document.getElementById('closeDetailBtn');

  if (closeDetailModal) closeDetailModal.addEventListener('click', closeDetailModalHandler);
  if (closeDetailBtn) closeDetailBtn.addEventListener('click', closeDetailModalHandler);

  if (detailModal) {
    detailModal.querySelector('.modal-overlay')?.addEventListener('click', closeDetailModalHandler);
  }

  // 确认删除模态框
  const confirmModal = document.getElementById('confirmModal');
  const closeConfirmModal = document.getElementById('closeConfirmModal');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  if (closeConfirmModal) closeConfirmModal.addEventListener('click', closeConfirmModalHandler);
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeConfirmModalHandler);
  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', handleConfirmDelete);

  if (confirmModal) {
    confirmModal.querySelector('.modal-overlay')?.addEventListener('click', closeConfirmModalHandler);
  }

  // 二维码登录模态框
  const qrLoginModal = document.getElementById('qrLoginModal');
  const closeQrLoginModal = document.getElementById('closeQrLoginModal');
  const cancelQrLoginBtn = document.getElementById('cancelQrLoginBtn');

  if (closeQrLoginModal) closeQrLoginModal.addEventListener('click', closeQrLoginModalHandler);
  if (cancelQrLoginBtn) cancelQrLoginBtn.addEventListener('click', closeQrLoginModalHandler);

  if (qrLoginModal) {
    qrLoginModal.querySelector('.modal-overlay')?.addEventListener('click', closeQrLoginModalHandler);
  }
}

// ==================== Cookie数据操作 ====================

/**
 * 加载Cookie数据
 */
async function loadCookies() {
  try {
    stateManager.setLoading(true);

    const cookies = await cookieManager.loadCookies();
    const state = stateManager.getState();

    const filteredCookies = cookieManager.applyFilters(
      state.searchQuery,
      state.currentSort,
      state.sortOrder
    );

    stateManager.setState({
      cookies: cookies,
      filteredCookies: filteredCookies,
      isLoading: false
    });

    // 更新统计信息
    const stats = cookieManager.getStatistics();
    cookieUI.updateStatistics(stats);

  } catch (error) {
    console.error('加载Cookie失败:', error);
    toast('error', '加载失败', '无法加载Cookie数据，请检查网络连接');
    stateManager.setLoading(false);
  }
}

/**
 * 处理刷新
 */
async function handleRefresh() {
  const refreshBtn = document.getElementById('refreshCookies');
  if (refreshBtn) {
    const icon = refreshBtn.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    refreshBtn.disabled = true;
  }

  await loadCookies();

  if (refreshBtn) {
    const icon = refreshBtn.querySelector('i');
    if (icon) icon.classList.remove('fa-spin');
    refreshBtn.disabled = false;
  }
}

// ==================== 搜索和排序 ====================

/**
 * 处理搜索
 * @param {Event} event - 输入事件
 */
function handleSearch(event) {
  const searchQuery = event.target.value;
  stateManager.setSearchQuery(searchQuery);

  const state = stateManager.getState();
  const filteredCookies = cookieManager.applyFilters(
    searchQuery,
    state.currentSort,
    state.sortOrder
  );

  stateManager.setFilteredCookies(filteredCookies);
}

/**
 * 处理排序变化
 * @param {Event} event - 变更事件
 */
function handleSortChange(event) {
  const sortBy = event.target.value;
  const state = stateManager.getState();

  stateManager.setSort(sortBy, state.sortOrder);

  const filteredCookies = cookieManager.applyFilters(
    state.searchQuery,
    sortBy,
    state.sortOrder
  );

  stateManager.setFilteredCookies(filteredCookies);
}

/**
 * 处理排序顺序切换
 */
function handleSortOrderToggle() {
  stateManager.toggleSortOrder();

  const state = stateManager.getState();
  cookieUI.updateSortButtonIcon(state.sortOrder);

  const filteredCookies = cookieManager.applyFilters(
    state.searchQuery,
    state.currentSort,
    state.sortOrder
  );

  stateManager.setFilteredCookies(filteredCookies);
}

/**
 * 处理视图模式切换
 */
function handleViewModeToggle() {
  stateManager.toggleViewMode();

  const state = stateManager.getState();
  cookieUI.updateViewModeButtonIcon(state.viewMode);
}

// ==================== 多选功能 ====================

/**
 * 处理全选按钮点击
 * @param {Event} event - 点击事件
 */
function handleSelectAllClick(event) {
  event.preventDefault();

  const newMode = stateManager.cycleSelectionMode();
  cookieUI.updateSelectAllCheckbox(newMode);

  const selectedCount = stateManager.getSelectedCount();
  cookieUI.updateBatchToolbar(selectedCount);

  // 显示提示
  const messages = ['已退出多选模式', '已进入多选模式，请手动勾选', `已全选 ${selectedCount} 个Cookie`];
  const types = ['info', 'info', 'success'];
  toast(types[newMode], newMode === 2 ? '全选' : '多选模式', messages[newMode]);
}

/**
 * 处理Cookie选择变更
 * @param {CustomEvent} event - 自定义事件
 */
function handleCookieSelectionChange(event) {
  const { cookieId, selected } = event.detail;

  stateManager.setCookieSelected(cookieId, selected);

  const selectedCount = stateManager.getSelectedCount();
  cookieUI.updateBatchToolbar(selectedCount);

  if (selected) {
    const cookie = cookieManager.findCookieById(cookieId);
    if (cookie) {
      toast('success', '已选中', `已选择 "${cookie.name}"`);
    }
  }
}

// ==================== Cookie操作 ====================

/**
 * 处理Cookie操作
 * @param {CustomEvent} event - 自定义事件
 */
function handleCookieAction(event) {
  const { action, cookieId } = event.detail;

  switch (action) {
    case 'view':
      viewCookieDetails(cookieId);
      break;
    case 'test':
      testCookie(cookieId);
      break;
    case 'toggle':
      toggleCookieDisabled(cookieId);
      break;
    case 'edit':
      editCookie(cookieId);
      break;
    case 'delete':
      deleteCookie(cookieId);
      break;
  }
}

/**
 * 查看Cookie详情
 * @param {string} cookieId - Cookie ID
 */
async function viewCookieDetails(cookieId) {
  try {
    const cookie = await cookieManager.getCookieDetail(cookieId);
    showDetailModal(cookie);
  } catch (error) {
    console.error('获取Cookie详情失败:', error);
    toast('error', '操作失败', error.message);
  }
}

/**
 * 测试Cookie
 * @param {string} cookieId - Cookie ID
 */
async function testCookie(cookieId) {
  try {
    toast('info', '测试中', '正在测试Cookie有效性...');
    await cookieManager.testCookie(cookieId);
    toast('success', '测试成功', 'Cookie有效');

    // 测试完成后刷新UI
    await loadCookies();
  } catch (error) {
    console.error('测试Cookie失败:', error);
    toast('error', '测试失败', error.message);
  }
}

/**
 * 编辑Cookie
 * @param {string} cookieId - Cookie ID
 */
function editCookie(cookieId) {
  const cookie = cookieManager.findCookieById(cookieId);
  if (!cookie) {
    toast('error', '错误', 'Cookie不存在');
    return;
  }

  openCookieModal('edit', cookie);
}

/**
 * 删除Cookie
 * @param {string} cookieId - Cookie ID
 */
function deleteCookie(cookieId) {
  const cookie = cookieManager.findCookieById(cookieId);
  if (!cookie) return;

  const modal = document.getElementById('confirmModal');
  const message = document.getElementById('confirmMessage');

  if (message) {
    message.textContent = `确定要删除Cookie "${cookie.name || '未命名'}"吗？`;
  }

  if (modal) {
    modal.classList.add('show');
    modal.dataset.deleteId = cookieId;
    delete modal.dataset.batchDelete;
  }
}

/**
 * 切换Cookie禁用状态
 * @param {string} cookieId - Cookie ID
 */
async function toggleCookieDisabled(cookieId) {
  try {
    const cookie = cookieManager.findCookieById(cookieId);
    if (!cookie) {
      toast('error', '错误', 'Cookie不存在');
      return;
    }

    const newDisabledState = !cookie.status?.isDisabled;
    const action = newDisabledState ? '禁用' : '启用';

    await cookieManager.toggleCookieDisabled(cookieId, newDisabledState);

    toast('success', `${action}成功`, `Cookie "${cookie.name}" 已${action}`);

    // 重新加载数据
    await loadCookies();
  } catch (error) {
    console.error('切换Cookie状态失败:', error);
    toast('error', '操作失败', error.message);
  }
}

// ==================== 模态框操作 ====================

/**
 * 打开Cookie模态框
 * @param {string} mode - 模式 ('add' 或 'edit')
 * @param {Object} [cookie] - Cookie对象（编辑模式）
 */
function openCookieModal(mode, cookie = null) {
  const modal = document.getElementById('cookieModal');
  const title = document.getElementById('modalTitle');
  const form = document.getElementById('cookieForm');
  const testBtn = document.getElementById('testBtn');

  if (!modal || !title || !form) return;

  // 重置表单
  form.reset();

  if (mode === 'add') {
    title.textContent = '添加新Cookie';
    stateManager.setEditingCookie(null);
    if (testBtn) testBtn.style.display = 'none';
  } else if (mode === 'edit' && cookie) {
    title.textContent = '编辑Cookie';
    stateManager.setEditingCookie(cookie);

    document.getElementById('cookieName').value = cookie.name || '';
    document.getElementById('cookieValue').value = cookie.value || '';
    document.getElementById('cookieDescription').value = cookie.description || '';

    if (testBtn) testBtn.style.display = 'inline-flex';
  }

  modal.classList.add('show');
}

/**
 * 关闭Cookie模态框
 */
function closeCookieModal() {
  const modal = document.getElementById('cookieModal');
  if (modal) {
    modal.classList.remove('show');
  }
  stateManager.setEditingCookie(null);
}

/**
 * 处理Cookie表单提交
 * @param {Event} event - 提交事件
 */
async function handleCookieSubmit(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const cookieData = {
    name: formData.get('name').trim(),
    value: formData.get('value').trim(),
    description: formData.get('description').trim()
  };

  // 表单验证
  if (!cookieData.name) {
    toast('error', '验证失败', '请输入Cookie名称');
    return;
  }

  if (!cookieData.value) {
    toast('error', '验证失败', '请输入Cookie值');
    return;
  }

  try {
    const editingCookie = stateManager.getState().editingCookie;
    const isEdit = editingCookie !== null;

    if (isEdit) {
      await cookieManager.updateCookie(editingCookie.id, cookieData);
      toast('success', '更新成功', 'Cookie更新成功');
    } else {
      await cookieManager.addCookie(cookieData);
      toast('success', '添加成功', 'Cookie添加成功');
    }

    closeCookieModal();
    await loadCookies();
  } catch (error) {
    console.error('保存Cookie失败:', error);
    toast('error', '操作失败', error.message);
  }
}

/**
 * 测试当前编辑的Cookie
 */
async function handleTestCurrentCookie() {
  const editingCookie = stateManager.getState().editingCookie;
  if (!editingCookie) return;

  await testCookie(editingCookie.id);
}

/**
 * 显示详情模态框
 * @param {Object} cookie - Cookie对象
 */
function showDetailModal(cookie) {
  const modal = document.getElementById('detailModal');
  const content = document.getElementById('cookieDetailContent');

  if (!modal || !content) return;

  const successCount = cookie.usage?.successCount || 0;
  const failureCount = cookie.usage?.failureCount || 0;
  const totalAttempts = successCount + failureCount;
  const successRate = totalAttempts > 0 ? (successCount / totalAttempts * 100) : 0;
  const isValid = cookie.status?.isValid === true;

  content.innerHTML = `
    <div class="detail-section">
      <div class="detail-title">
        <i class="fas fa-info-circle"></i>
        基本信息
      </div>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-label">Cookie名称</div>
          <div class="detail-item-value">${escapeHtml(cookie.name || '未命名')}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">状态</div>
          <div class="detail-item-value">
            ${cookie.status?.isActive ? '<span class="badge badge-active">活跃</span>' : '<span class="badge">未激活</span>'}
            ${isValid ?
              '<span class="badge badge-healthy">有效</span>' :
              '<span class="badge badge-unhealthy">无效</span>'
            }
          </div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">创建时间</div>
          <div class="detail-item-value">${formatDateTime(cookie.metadata?.createdAt)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">更新时间</div>
          <div class="detail-item-value">${formatDateTime(cookie.metadata?.updatedAt)}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-title">
        <i class="fas fa-chart-line"></i>
        使用统计
      </div>
      <div class="cookie-meta">
        <span class="meta-item">
          <i class="fas fa-chart-line"></i>
          使用 <strong>${formatNumber(cookie.usage?.usageCount || 0)}</strong>
        </span>
        <span class="meta-separator">|</span>
        <span class="meta-item meta-success">
          <i class="fas fa-check-circle"></i>
          成功 <strong>${formatNumber(successCount)}</strong>
        </span>
        <span class="meta-separator">|</span>
        <span class="meta-item meta-error">
          <i class="fas fa-times-circle"></i>
          失败 <strong>${formatNumber(failureCount)}</strong>
        </span>
        <span class="meta-separator">|</span>
        <span class="meta-item">
          <i class="fas fa-percentage"></i>
          成功率 <strong>${successRate.toFixed(1)}%</strong>
        </span>
      </div>
    </div>

    ${!isValid && cookie.status?.lastError ? `
      <div class="detail-section">
        <div class="detail-title">
          <i class="fas fa-exclamation-triangle"></i>
          错误信息
        </div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-item-label">最后错误</div>
            <div class="detail-item-value">${escapeHtml(cookie.status.lastError)}</div>
          </div>
        </div>
      </div>
    ` : ''}

    ${cookie.description ? `
      <div class="detail-section">
        <div class="detail-title">
          <i class="fas fa-align-left"></i>
          描述信息
        </div>
        <div class="detail-content">${escapeHtml(cookie.description)}</div>
      </div>
    ` : ''}

    <div class="detail-section">
      <div class="detail-title">
        <i class="fas fa-key"></i>
        Cookie值
      </div>
      <div class="detail-content" style="font-family: var(--font-mono); word-break: break-all;">
        ${escapeHtml(cookie.value || '')}
      </div>
    </div>
  `;

  modal.classList.add('show');
}

/**
 * 关闭详情模态框
 */
function closeDetailModalHandler() {
  const modal = document.getElementById('detailModal');
  if (modal) {
    modal.classList.remove('show');
  }
}

/**
 * 关闭确认删除模态框
 */
function closeConfirmModalHandler() {
  const modal = document.getElementById('confirmModal');
  if (modal) {
    modal.classList.remove('show');
    delete modal.dataset.deleteId;
    delete modal.dataset.batchDelete;
  }
}

/**
 * 处理确认删除
 */
async function handleConfirmDelete() {
  const modal = document.getElementById('confirmModal');
  const isBatchDelete = modal?.dataset.batchDelete === 'true';

  if (isBatchDelete) {
    // 批量删除由cookieBatch处理
    closeConfirmModalHandler();
    return;
  }

  const cookieId = modal?.dataset.deleteId;
  if (!cookieId) return;

  try {
    await cookieManager.deleteCookie(cookieId);
    toast('success', '删除成功', 'Cookie已成功删除');
    closeConfirmModalHandler();
    await loadCookies();
  } catch (error) {
    console.error('删除Cookie失败:', error);
    toast('error', '删除失败', error.message);
  }
}

// ==================== 二维码登录 ====================

/**
 * 打开二维码登录模态框
 */
function openQrLoginModal() {
  const modal = document.getElementById('qrLoginModal');
  const form = document.getElementById('qrLoginForm');

  if (!modal) return;

  // 重置表单
  if (form) form.reset();

  // 重置状态
  qrLoginManager.reset();

  modal.classList.add('show');
}

/**
 * 关闭二维码登录模态框
 */
function closeQrLoginModalHandler() {
  const modal = document.getElementById('qrLoginModal');
  if (modal) {
    modal.classList.remove('show');
  }

  // 清除定时器
  qrLoginManager.reset();
}

/**
 * 更新二维码登录按钮状态
 */
function updateQrLoginButtonState() {
  const cookieNameInput = document.getElementById('cookieNameQr');
  const confirmQrLoginBtn = document.getElementById('confirmQrLoginBtn');

  if (!cookieNameInput || !confirmQrLoginBtn) return;

  const name = cookieNameInput.value.trim();
  confirmQrLoginBtn.disabled = name.length === 0 || !qrLoginManager.canConfirm();
}

/**
 * 处理二维码登录确认
 */
async function handleQrLoginConfirm() {
  const cookieNameInput = document.getElementById('cookieNameQr');
  if (!cookieNameInput) return;

  const cookieName = cookieNameInput.value.trim();

  const result = await qrLoginManager.confirmLogin(cookieName);

  if (result) {
    // 延迟关闭模态框并刷新列表
    setTimeout(() => {
      closeQrLoginModalHandler();
      loadCookies();
    }, 1500);
  }
}

/**
 * 更新二维码UI状态
 * @param {string} status - 状态名称
 * @param {Object} data - 附加数据
 */
function updateQrCodeUI(status, data = {}) {
  const initEl = document.getElementById('qrCodeInit');
  const loadingEl = document.getElementById('qrCodeLoading');
  const containerEl = document.getElementById('qrCodeContainer');
  const overlayEl = document.getElementById('qrCodeOverlay');
  const getQrCodeBtn = document.getElementById('getQrCodeBtn');
  const confirmQrLoginBtn = document.getElementById('confirmQrLoginBtn');

  // 隐藏所有状态
  if (initEl) initEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'none';
  if (containerEl) containerEl.style.display = 'none';
  if (overlayEl) overlayEl.style.display = 'none';

  switch (status) {
    case 'init':
      if (initEl) initEl.style.display = 'flex';
      if (getQrCodeBtn) {
        getQrCodeBtn.style.display = 'inline-flex';
        getQrCodeBtn.disabled = false;
        getQrCodeBtn.innerHTML = '<i class="fas fa-qrcode"></i> 获取二维码';
      }
      if (confirmQrLoginBtn) confirmQrLoginBtn.style.display = 'none';
      break;

    case 'loading':
      if (loadingEl) loadingEl.style.display = 'flex';
      if (getQrCodeBtn) {
        getQrCodeBtn.disabled = true;
        getQrCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 获取中...';
      }
      break;

    case 'pending':
      if (containerEl) containerEl.style.display = 'flex';
      if (getQrCodeBtn) getQrCodeBtn.style.display = 'none';
      if (confirmQrLoginBtn) confirmQrLoginBtn.style.display = 'none';

      if (data.qrCodeImg) {
        const qrImage = document.getElementById('qrCodeImage');
        if (qrImage) qrImage.src = data.qrCodeImg;
      }
      break;

    case 'scanned':
      if (containerEl) containerEl.style.display = 'flex';
      if (overlayEl) {
        overlayEl.style.display = 'flex';
        overlayEl.innerHTML = `
          <div class="qr-code-status">
            <i class="fas fa-mobile-alt"></i>
            <span>已扫描<br>请在手机上确认</span>
          </div>
        `;
      }
      if (getQrCodeBtn) getQrCodeBtn.style.display = 'none';
      if (confirmQrLoginBtn) confirmQrLoginBtn.style.display = 'none';
      break;

    case 'confirmed':
      if (containerEl) containerEl.style.display = 'flex';
      if (overlayEl) {
        overlayEl.style.display = 'flex';
        overlayEl.innerHTML = `
          <div class="qr-code-status">
            <i class="fas fa-check-circle"></i>
            <span>登录成功！<br>请点击保存Cookie</span>
          </div>
        `;
      }
      if (getQrCodeBtn) getQrCodeBtn.style.display = 'none';
      if (confirmQrLoginBtn) {
        confirmQrLoginBtn.style.display = 'inline-flex';
        updateQrLoginButtonState();
      }
      break;

    case 'expired':
      if (containerEl) containerEl.style.display = 'flex';
      if (overlayEl) {
        overlayEl.style.display = 'flex';
        overlayEl.innerHTML = `
          <div class="qr-code-status" style="color: var(--error-color);">
            <i class="fas fa-times-circle"></i>
            <span>二维码已过期<br>请重新获取</span>
          </div>
        `;
      }
      if (getQrCodeBtn) {
        getQrCodeBtn.style.display = 'inline-flex';
        getQrCodeBtn.disabled = false;
        getQrCodeBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 重新获取';
      }
      if (confirmQrLoginBtn) confirmQrLoginBtn.style.display = 'none';
      break;
  }
}

/**
 * 更新二维码倒计时显示
 * @param {number} remainingTime - 剩余秒数
 */
function updateQrCodeTimer(remainingTime) {
  const timerEl = document.getElementById('qrCodeTimer');
  if (timerEl) {
    timerEl.textContent = `有效期：${qrLoginManager.formatCountdown(remainingTime)}`;
  }
}

// ==================== 工具函数 ====================

/**
 * HTML转义
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 格式化数字
 * @param {number} num - 数字
 * @returns {string} 格式化后的字符串
 */
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';

  const n = Number(num);

  if (n < 10000) return n.toString();

  if (n < 100000000) {
    const wan = (n / 10000).toFixed(1);
    return wan.endsWith('.0') ? wan.slice(0, -2) + '万' : wan + '万';
  }

  const yi = (n / 100000000).toFixed(1);
  return yi.endsWith('.0') ? yi.slice(0, -2) + '亿' : yi + '亿';
}

// ==================== 全局函数暴露 ====================

// 为了兼容性，将一些函数暴露到window对象
window.openCookieModal = openCookieModal;
