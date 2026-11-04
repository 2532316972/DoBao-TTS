/**
 * 统一的API响应工具
 * 提供标准化的JSON响应格式
 */

/**
 * 成功响应
 * @param {Object} data - 响应数据
 * @param {string} [msg=''] - 响应消息
 * @returns {Object} 标准响应对象
 */
export function success(data = null, msg = '') {
  return {
    code: 0,
    msg,
    data
  }
}

/**
 * 错误响应
 * @param {string} msg - 错误消息
 * @param {number} [code=1] - 错误代码
 * @param {Object} [data=null] - 附加数据
 * @returns {Object} 标准响应对象
 */
export function error(msg, code = 1, data = null) {
  return {
    code,
    msg,
    ...(data && { data })
  }
}

/**
 * 发送成功响应
 * @param {Object} res - Express响应对象
 * @param {Object} data - 响应数据
 * @param {string} [msg=''] - 响应消息
 */
export function sendSuccess(res, data = null, msg = '') {
  res.json(success(data, msg))
}

/**
 * 发送错误响应
 * @param {Object} res - Express响应对象
 * @param {string} msg - 错误消息
 * @param {number} [statusCode=400] - HTTP状态码
 * @param {number} [code=1] - 错误代码
 */
export function sendError(res, msg, statusCode = 400, code = 1) {
  res.status(statusCode).json(error(msg, code))
}