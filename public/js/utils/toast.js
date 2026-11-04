/**
 * Toast通知工具模块
 * 提供统一的Toast通知显示功能
 */

/**
 * 显示Toast通知
 * @param {string} type - 通知类型: 'success', 'error', 'warning', 'info'
 * @param {string} title - 通知标题
 * @param {string} message - 通知消息内容
 * @param {number} duration - 显示时长（毫秒），默认5000ms
 */
export function toast(type, title, message, duration = 5000) {
  const container = document.getElementById('toastContainer');
  if (!container) {
    console.warn('Toast容器不存在，请确保页面包含id为toastContainer的元素');
    return;
  }

  const toastEl = document.createElement('div');
  toastEl.className = `toast ${type}`;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };

  const icon = iconMap[type] || 'fa-info-circle';

  toastEl.innerHTML = `
    <div class="toast-header">
      <div class="toast-title">
        <i class="fas ${icon}"></i>
        ${escapeHtml(title)}
      </div>
      <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="toast-message">${escapeHtml(message)}</div>
  `;

  container.appendChild(toastEl);

  // 显示动画
  requestAnimationFrame(() => {
    toastEl.classList.add('show');
  });

  // 自动隐藏
  setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => {
      if (toastEl.parentElement) {
        toastEl.remove();
      }
    }, 300);
  }, duration);
}

/**
 * HTML转义，防止XSS攻击
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
 * 显示成功类型的Toast通知
 * @param {string} title - 通知标题
 * @param {string} message - 通知消息内容
 * @param {number} duration - 显示时长（毫秒）
 */
export function toastSuccess(title, message, duration) {
  toast('success', title, message, duration);
}

/**
 * 显示错误类型的Toast通知
 * @param {string} title - 通知标题
 * @param {string} message - 通知消息内容
 * @param {number} duration - 显示时长（毫秒）
 */
export function toastError(title, message, duration) {
  toast('error', title, message, duration);
}

/**
 * 显示警告类型的Toast通知
 * @param {string} title - 通知标题
 * @param {string} message - 通知消息内容
 * @param {number} duration - 显示时长（毫秒）
 */
export function toastWarning(title, message, duration) {
  toast('warning', title, message, duration);
}

/**
 * 显示信息类型的Toast通知
 * @param {string} title - 通知标题
 * @param {string} message - 通知消息内容
 * @param {number} duration - 显示时长（毫秒）
 */
export function toastInfo(title, message, duration) {
  toast('info', title, message, duration);
}
