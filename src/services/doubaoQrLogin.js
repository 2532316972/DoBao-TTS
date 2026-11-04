/**
 * 豆包二维码登录服务
 * 基于 HAR 分析实现的纯 API 二维码登录
 * 不依赖 Puppeteer，适用于 Termux 等移动端环境
 */

import axios from 'axios';
import QRCode from 'qrcode';
import { log, logError } from '../utils/logger.js';
import { getCachedUserAgent } from '../utils/userAgentUtils.js';
import { generateSimulatedFingerprint } from '../utils/simulatedFingerprint.js';

/**
 * 二维码登录会话存储
 */
const qrLoginSessions = new Map();

/**
 * 会话有效期（毫秒）
 * 豆包二维码有效期约1分钟
 */
const SESSION_EXPIRY = 60 * 1000; // 1分钟

/**
 * 清理过期会话
 */
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of qrLoginSessions.entries()) {
    if (now - session.createdAt > SESSION_EXPIRY) {
      qrLoginSessions.delete(sessionId);
    }
  }
}

/**
 * 生成设备指纹
 * 复用 simulatedFingerprint 的统一格式（verify_{8}_{8}_{4}_{4}_{4}_{12}）
 * @returns {string} 设备指纹
 */
function generateVerifyFp() {
  return generateSimulatedFingerprint();
}

/**
 * 生成随机字符串
 * @param {number} length - 长度
 * @returns {string} 随机字符串
 */
function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成 CSRF Token
 * @returns {string} CSRF Token
 */
function generateCsrfToken() {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成二维码图片（Base64）
 * @param {string} text - 二维码内容
 * @returns {Promise<string>} Base64图片
 */
async function generateQrCodeImage(text) {
  try {
    log('info', '[QR] 开始生成二维码图片', { textLength: text.length, textPreview: text.substring(0, 50) });
    const dataUrl = await QRCode.toDataURL(text, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'M'
    });
    log('info', '[QR] 二维码图片生成成功', { dataUrlLength: dataUrl.length, dataUrlPreview: dataUrl.substring(0, 100) });
    return dataUrl;
  } catch (error) {
    logError(error, { stage: '生成二维码图片' });
    return null;
  }
}

/**
 * 获取二维码
 * @returns {Promise<Object>} 二维码信息
 */
export async function getQrCode() {
  try {
    log('info', '[QR] 开始获取豆包登录二维码');

    // 生成必要的参数
    const verifyFp = generateVerifyFp();
    const csrfToken = generateCsrfToken();
    const deviceId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    log('info', '[QR] 生成的参数', { verifyFp: verifyFp.substring(0, 20) + '...', csrfToken: csrfToken.substring(0, 20) + '...', deviceId });

    // 构建请求参数
    const params = {
      next: 'https://www.doubao.com',
      aid: '497858',
      account_sdk_source: 'web',
      sdk_version: '2.2.11-doubao.0',
      verifyFp: verifyFp,
      fp: verifyFp,
      // sign 和 a_bogus 是动态生成的，这里使用简化版本
      // 实际可能需要逆向算法或使用固定值
      sign: '',
      qs: '',
      msToken: '',
      a_bogus: ''
    };

    log('info', '[QR] 请求参数', { next: params.next, aid: params.aid, sdk_version: params.sdk_version });

    // 构建请求头
    const headers = {
      'authority': 'www.doubao.com',
      'method': 'GET',
      'path': `/passport/web/get_qrcode/?next=${encodeURIComponent(params.next)}&aid=${params.aid}&account_sdk_source=${params.account_sdk_source}&sdk_version=${params.sdk_version}&verifyFp=${params.verifyFp}&fp=${params.fp}`,
      'scheme': 'https',
      'accept': 'application/json, text/javascript',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      'referer': 'https://www.doubao.com/chat/?from_logout=1',
      'user-agent': getCachedUserAgent(),
      'x-tt-passport-csrf-token': csrfToken,
      'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Microsoft Edge";v="144"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin'
    };

    // 发送请求
    const response = await axios.get('https://www.doubao.com/passport/web/get_qrcode/', {
      params: {
        next: params.next,
        aid: params.aid,
        account_sdk_source: params.account_sdk_source,
        sdk_version: params.sdk_version,
        verifyFp: params.verifyFp,
        fp: params.fp
      },
      headers: headers,
      timeout: 30000,
      // 允许接收和发送Cookie
      withCredentials: true
    });

    log('info', '[QR] 获取二维码响应', { status: response.status, hasData: !!response.data, hasDataData: !!(response.data && response.data.data) });

    // 检查响应
    if (response.data && response.data.data) {
      const qrData = response.data.data;

      log('info', '[QR] 二维码数据解析', { qrDataKeys: Object.keys(qrData) });
      log('info', '[QR] 完整响应数据', { responseData: JSON.stringify(response.data).substring(0, 500) });

      // 豆包API返回的二维码图片是Base64编码的PNG图片，字段名为 'qrcode'
      let qrCodeImg = '';
      let qrCodeUrl = '';

      if (qrData.qrcode && qrData.qrcode.startsWith('iVBORw0KGgo')) {
        // 这是Base64编码的PNG图片，添加data URL前缀
        qrCodeImg = `data:image/png;base64,${qrData.qrcode}`;
        qrCodeUrl = qrData.qrcode_index_url || '';
        log('info', '[QR] 使用豆包返回的Base64二维码图片', { qrCodeImgLength: qrCodeImg.length, qrCodeUrl: qrCodeUrl ? '有' : '无' });
      } else {
        // 如果没有Base64图片，尝试使用URL生成
        qrCodeUrl = qrData.qrcode_index_url || qrData.scan_url || '';
        log('info', '[QR] 豆包未返回Base64图片，尝试使用URL生成', { qrCodeUrl: qrCodeUrl ? qrCodeUrl.substring(0, 100) : '无', hasQrcode: !!qrData.qrcode });
        if (qrCodeUrl) {
          qrCodeImg = await generateQrCodeImage(qrCodeUrl);
          log('info', '[QR] 使用生成的二维码图片', { qrCodeImgLength: qrCodeImg ? qrCodeImg.length : 0 });
        }
      }

      if (!qrCodeImg) {
        log('error', '[QR] 获取二维码失败，无可用图片数据', { availableFields: Object.keys(qrData) });
        throw new Error(`获取二维码失败：未返回二维码数据。可用字段: ${Object.keys(qrData).join(', ')}`);
      }

      // 创建会话
      const sessionId = generateRandomString(32);
      const session = {
        id: sessionId,
        token: qrData.token || '',
        qrCodeUrl: qrCodeUrl,
        qrCodeImg: qrCodeImg,
        verifyFp: verifyFp,
        csrfToken: csrfToken,
        deviceId: deviceId,
        createdAt: Date.now(),
        status: 'pending', // pending, scanned, confirmed, expired
        cookies: null
      };

      // 存储会话
      cleanExpiredSessions();
      qrLoginSessions.set(sessionId, session);

      log('info', '[QR] 二维码会话创建成功', { sessionId: session.id, qrCodeImgLength: session.qrCodeImg.length });

      const result = {
        success: true,
        sessionId: session.id,
        qrCodeUrl: session.qrCodeUrl,
        qrCodeImg: session.qrCodeImg,
        token: session.token,
        expiresIn: 60 // 1分钟有效期
      };

      log('info', '[QR] 返回结果', { success: result.success, sessionId: result.sessionId, qrCodeImgLength: result.qrCodeImg.length, qrCodeUrl: result.qrCodeUrl ? '有' : '无' });

      return result;
    } else {
      // 如果API返回错误，可能是反爬虫机制
      log('error', '[QR] API返回错误', { error_code: response.data?.error_code, description: response.data?.description, data: JSON.stringify(response.data).substring(0, 200) });
      if (response.data && response.data.error_code) {
        throw new Error(`豆包API错误: ${response.data.description || response.data.error_code}`);
      }
      throw new Error('获取二维码失败：响应格式不正确');
    }

  } catch (error) {
    logError(error, { stage: '获取二维码' });

    // 如果是反爬虫错误，返回友好提示
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 403) {
        return {
          success: false,
          error: '请求被拦截，豆包更新了反爬虫机制',
          message: '请使用手动方式添加Cookie',
          details: data
        };
      }

      if (status === 429) {
        return {
          success: false,
          error: '请求过于频繁，请稍后再试',
          message: '豆包限制了请求频率'
        };
      }
    }

    return {
      success: false,
      error: error.message || '获取二维码失败'
    };
  }
}

/**
 * 检查二维码扫描状态
 * @param {string} sessionId - 会话ID
 * @returns {Promise<Object>} 状态信息
 */
export async function checkQrStatus(sessionId) {
  try {
    const session = qrLoginSessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: '会话不存在或已过期',
        status: 'expired'
      };
    }

    // 检查是否过期
    if (Date.now() - session.createdAt > SESSION_EXPIRY) {
      qrLoginSessions.delete(sessionId);
      return {
        success: false,
        error: '二维码已过期',
        status: 'expired'
      };
    }

    // 如果已经获取到Cookie，直接返回
    if (session.status === 'confirmed' && session.cookies) {
      return {
        success: true,
        status: 'confirmed',
        cookies: session.cookies
      };
    }

    // 构建请求头
    const headers = {
      'authority': 'www.doubao.com',
      'accept': 'application/json, text/javascript',
      'accept-language': 'zh-CN,zh;q=0.9',
      'content-type': 'application/x-www-form-urlencoded',
      'referer': 'https://www.doubao.com/chat/?from_logout=1',
      'user-agent': getCachedUserAgent(),
      'x-tt-passport-csrf-token': session.csrfToken,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin'
    };

    // 发送检查请求
    const response = await axios.get('https://www.doubao.com/passport/web/check_qrconnect/', {
      params: {
        next: 'https://www.doubao.com',
        token: session.token,
        aid: '497858',
        account_sdk_source: 'web',
        sdk_version: '2.2.11-doubao.0',
        verifyFp: session.verifyFp,
        fp: session.verifyFp
      },
      headers: headers,
      timeout: 30000,
      withCredentials: true
    });

    log('info', '检查二维码状态响应', { status: response.status, data: response.data });

    // 解析响应
    if (response.data) {
      const data = response.data;

      // 根据响应判断状态
      if (data.data && data.data.status) {
        const qrStatus = data.data.status;

        if (qrStatus === 'confirmed' || data.data.redirect_url) {
          // 登录成功，提取Cookie
          // 注意：set-cookie 每个条目形如 "name=value; Path=/; Domain=...; HttpOnly"，
          // 必须剥离属性段只保留 name=value，否则属性会混入Cookie值导致服务端解析失败
          const cookies = response.headers['set-cookie'];
          if (cookies) {
            session.status = 'confirmed';
            const cookieList = Array.isArray(cookies) ? cookies : [cookies];
            session.cookies = cookieList
              .map(cookie => cookie.split(';')[0].trim())
              .filter(cookie => cookie.includes('='))
              .join('; ');
            qrLoginSessions.set(sessionId, session);

            return {
              success: true,
              status: 'confirmed',
              cookies: session.cookies
            };
          }
        } else if (qrStatus === 'scanned') {
          session.status = 'scanned';
          qrLoginSessions.set(sessionId, session);

          return {
            success: true,
            status: 'scanned',
            message: '二维码已扫描，请在手机上确认登录'
          };
        }
      }

      // 继续等待
      return {
        success: true,
        status: 'pending',
        message: '等待扫描二维码'
      };
    }

    return {
      success: true,
      status: 'pending',
      message: '等待扫描二维码'
    };

  } catch (error) {
    logError(error, { stage: '检查二维码状态', sessionId });

    return {
      success: false,
      error: error.message || '检查状态失败',
      status: 'error'
    };
  }
}

/**
 * 获取会话信息
 * @param {string} sessionId - 会话ID
 * @returns {Object|null} 会话信息
 */
export function getSession(sessionId) {
  return qrLoginSessions.get(sessionId) || null;
}

/**
 * 删除会话
 * @param {string} sessionId - 会话ID
 */
export function deleteSession(sessionId) {
  qrLoginSessions.delete(sessionId);
}

/**
 * 获取所有会话数量（用于监控）
 * @returns {number} 会话数量
 */
export function getSessionCount() {
  cleanExpiredSessions();
  return qrLoginSessions.size;
}

export default {
  getQrCode,
  checkQrStatus,
  getSession,
  deleteSession,
  getSessionCount
};
