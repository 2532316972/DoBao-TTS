/**
 * 防抖工具模块
 * 提供防抖函数实现
 */

/**
 * 防抖函数
 * 延迟执行函数，如果在等待时间内再次调用，则重新计时
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间（毫秒），默认300ms
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, wait = 300) {
  let timeout;

  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数
 * 限制函数在一定时间内只能执行一次
 * @param {Function} func - 要执行的函数
 * @param {number} limit - 限制时间（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(func, limit) {
  let inThrottle;

  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
