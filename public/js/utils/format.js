/**
 * 格式化工具模块
 * 提供数字、日期、HTML等格式化功能
 */

/**
 * 格式化数字（大数字显示为带单位的格式）
 * @param {number} num - 要格式化的数字
 * @returns {string} 格式化后的字符串
 */
export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';

  const n = Number(num);

  // 小于10000直接显示
  if (n < 10000) return n.toString();

  // 1万-9999万显示为X.X万
  if (n < 100000000) {
    const wan = (n / 10000).toFixed(1);
    // 去掉末尾的.0
    return wan.endsWith('.0') ? wan.slice(0, -2) + '万' : wan + '万';
  }

  // 1亿以上显示为X.X亿
  const yi = (n / 100000000).toFixed(1);
  return yi.endsWith('.0') ? yi.slice(0, -2) + '亿' : yi + '亿';
}

/**
 * 格式化日期（相对时间）
 * @param {string|Date} dateString - 日期字符串或Date对象
 * @returns {string} 格式化后的相对时间字符串
 */
export function formatDate(dateString) {
  if (!dateString) return '从未';

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    return date.toLocaleDateString('zh-CN');
  } catch (error) {
    return '无效日期';
  }
}

/**
 * 格式化完整日期时间
 * @param {string|Date} dateString - 日期字符串或Date对象
 * @returns {string} 格式化后的日期时间字符串
 */
export function formatDateTime(dateString) {
  if (!dateString) return '无';

  try {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (error) {
    return '无效日期';
  }
}

/**
 * HTML转义，防止XSS攻击
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 截断文本，超出长度显示省略号
 * @param {string} text - 原始文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的文本
 */
export function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小字符串
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
