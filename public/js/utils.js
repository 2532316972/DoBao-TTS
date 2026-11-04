/**
 * 公共工具函数库
 * 供所有页面共享的工具函数
 */

// ==================== Toast通知 ====================

/**
 * 显示Toast提示
 * @param {string} message - 提示消息
 * @param {string} type - 提示类型: 'success', 'error', 'warning', 'info'
 * @param {string} title - 标题（可选）
 * @param {number} duration - 显示时长（毫秒），默认3000ms
 */
function showToast(message, type = 'info', title = '', duration = 3000) {
  const container = document.getElementById('toastContainer')
  if (!container) {
    console.warn('Toast容器不存在，请确保页面包含id为toastContainer的元素')
    return
  }

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  }

  const icon = iconMap[type] || 'fa-info-circle'

  if (title) {
    // 带标题的Toast样式
    toast.innerHTML = `
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
    `
  } else {
    // 简洁Toast样式
    toast.innerHTML = `
      <i class="fas ${icon}"></i>
      <span class="toast-message">${escapeHtml(message)}</span>
    `
  }

  container.appendChild(toast)

  // 显示动画
  requestAnimationFrame(() => {
    toast.classList.add('show')
  })

  // 自动隐藏
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove()
      }
    }, 300)
  }, duration)
}

// ==================== HTML转义 ====================

/**
 * HTML转义，防止XSS攻击
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ==================== 防抖函数 ====================

/**
 * 防抖函数
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, wait = 300) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// ==================== 时间格式化 ====================

/**
 * 格式化日期时间
 * @param {string|Date|number} date - 日期对象、时间戳或ISO字符串
 * @param {string} format - 格式：'date'(日期), 'time'(时间), 'datetime'(日期时间), 'relative'(相对时间)
 * @returns {string} 格式化后的字符串
 */
function formatDate(date, format = 'datetime') {
  if (!date) return '-'

  const d = new Date(date)
  if (isNaN(d.getTime())) return '-'

  const now = new Date()
  const diff = now - d

  // 相对时间
  if (format === 'relative') {
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (seconds < 60) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`
    if (days < 30) return `${Math.floor(days / 7)}周前`
    if (days < 365) return `${Math.floor(days / 30)}个月前`
    return `${Math.floor(days / 365)}年前`
  }

  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')

  switch (format) {
    case 'date':
      return `${year}-${month}-${day}`
    case 'time':
      return `${hours}:${minutes}:${seconds}`
    case 'datetime':
    default:
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }
}

/**
 * 格式化时长（毫秒转为可读格式）
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化后的时长
 */
function formatDuration(ms) {
  if (!ms || ms < 0) return '0秒'

  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天${hours % 24}小时`
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟${seconds % 60}秒`
  return `${seconds}秒`
}

// ==================== 文件大小格式化 ====================

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
function formatFileSize(bytes) {
  if (!bytes || bytes < 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

// ==================== 复制到剪贴板 ====================

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>} 是否复制成功
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    console.error('复制失败:', err)
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      return true
    } catch (e) {
      return false
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

// ==================== 导出函数 ====================
// 将这些函数挂载到window对象，供其他脚本使用
window.Utils = {
  showToast,
  escapeHtml,
  debounce,
  formatDate,
  formatDuration,
  formatFileSize,
  copyToClipboard
}
