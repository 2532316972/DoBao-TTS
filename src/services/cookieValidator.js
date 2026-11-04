/**
 * Cookie验证服务
 * 通过真实调用TTS API来验证Cookie的有效性
 */

import WebSocket from 'ws';
import { log, logError } from '../utils/logger.js';
import { loadTtsConfig, buildWsUrl } from '../utils/ttsUtils.js';
import { getCachedUserAgent } from '../utils/userAgentUtils.js';
import { deviceParamsManager } from './deviceParamsManager.js';
import cookieManager from './cookieManager.js';

/**
 * 验证Cookie有效性
 * 使用Cookie对应的设备参数进行验证
 * @param {string} cookieId - Cookie ID
 * @param {string} cookieValue - Cookie值
 * @param {number} timeout - 超时时间（毫秒），默认5秒
 * @returns {Promise<Object>} 验证结果
 */
export async function validateCookie(cookieId, cookieValue, timeout = 5000) {
  return new Promise(async (resolve) => {
    const startTime = Date.now();

    // 使用简短的测试文本
    const testText = '测试';
    // 使用默认说话人
    const speaker = 'BV700_V2_streaming';

    // 获取Cookie级互斥锁（验证与生成/预制共用同一Cookie时避免并发）
    const releaseLock = await cookieManager.acquireCookieLock(cookieId);

    log('info', '开始验证Cookie', {
      cookieId,
      cookiePreview: cookieValue?.substring(0, 20) + '...',
      timeout
    });

    try {
      const cfg = loadTtsConfig();
      
      // 获取Cookie对应的设备参数
      let deviceParams = await deviceParamsManager.getOrCreateParams(cookieId);
      
      // 如果当前设备参数被封禁，强制轮换生成新的（验证时需要新的设备参数）
      if (deviceParams.isBlocked) {
        log('info', '当前设备参数已被封禁，强制生成新的设备参数进行验证', { 
          cookieId, 
          oldDeviceId: deviceParams.deviceId,
          blockCount: deviceParams.blockCount 
        });
        // 直接创建新的设备参数，不检查阈值
        deviceParams = await deviceParamsManager.createNewParams(cookieId);
      }
      
      log('info', '使用设备参数验证Cookie', { 
        cookieId, 
        deviceId: deviceParams.deviceId,
        fingerprint: deviceParams.fingerprint?.substring(0, 20) + '...'
      });
      
      // 构建URL时使用设备参数
      const url = await buildWsUrl({ 
        speaker, 
        speech_rate: 0, 
        pitch: 0,
        cookieId,
        deviceParams
      }, cfg);

      // 创建WebSocket连接
      // 握手头与主流程（ttsService）保持一致：不发送 samantha_web 头（HAR 证实真实请求无此头）
      const ws = new WebSocket(url, {
        headers: {
          Origin: 'https://www.doubao.com',
          'Accept-Language': 'zh,zh-CN;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': getCachedUserAgent(),
          Cookie: cookieValue
        }
      });

      let isValid = false;
      let errorMessage = '';
      let receivedData = false;
      let finished = false;

      // 设置超时
      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true;
          log('warn', 'Cookie验证超时');
          try {
            ws.close();
          } catch (e) {
            // 忽略关闭错误
          }
          releaseLock();
          resolve({
            isValid: false,
            message: '验证超时',
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime
          });
        }
      }, timeout);

      ws.on('open', () => {
        log('info', 'WebSocket连接已建立');
        try {
          // 发送测试请求
          ws.send(JSON.stringify({ event: 'text', text: testText }));
          ws.send(JSON.stringify({ event: 'finish' }));
        } catch (err) {
          logError(err, { stage: 'Cookie验证-发送消息' });
          errorMessage = '发送消息失败: ' + err.message;
        }
      });

      ws.on('message', (data) => {
        if (typeof data === 'string') {
          try {
            const msg = JSON.parse(data);
            log('info', '收到消息事件', { event: msg.event });

            if (msg.event === 'finish') {
              // 收到finish事件表示请求成功
              isValid = true;
              log('info', 'Cookie验证成功 - 收到finish事件');
            } else if (msg.event === 'error') {
              // 收到错误事件
              errorMessage = msg.message || msg.error || '未知错误';
              log('warn', 'Cookie验证失败 - 收到error事件', { error: errorMessage });
            }
          } catch (e) {
            logError(e, { stage: 'Cookie验证-解析消息' });
          }
        } else if (Buffer.isBuffer(data)) {
          // 检查数据大小，如果太小可能是错误消息
          if (data.length < 1024) {
            try {
              const text = data.toString('utf-8');
              const json = JSON.parse(text);
              if (json.code && json.message) {
                // 这是一个错误消息
                errorMessage = `${json.message} (code: ${json.code})`;
                log('warn', 'Cookie验证失败 - 收到错误消息', {
                  code: json.code,
                  message: json.message,
                  size: data.length
                });
                isValid = false;
                ws.close();
                return;
              }
            } catch (e) {
              // 不是JSON，可能是真实的音频数据
            }
          }
          // 收到音频数据表示Cookie有效
          receivedData = true;
          log('info', 'Cookie验证成功 - 收到音频数据', { size: data.length });
        }
      });

      ws.on('close', async () => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);

          const duration = Date.now() - startTime;

          // 如果收到了finish事件或音频数据，认为Cookie有效
          const finalIsValid = isValid || receivedData;

          // 如果验证失败且是BLOCK错误，轮换设备ID
          if (!finalIsValid && errorMessage.includes('block')) {
            log('warn', 'Cookie验证失败且检测到BLOCK错误，准备轮换设备ID', {
              cookieId,
              errorMessage,
              deviceId: deviceParams.deviceId
            });
            try {
              const newParams = await deviceParamsManager.rotateParams(cookieId);
              log('info', '设备参数已轮换', {
                cookieId,
                oldDeviceId: deviceParams.deviceId,
                newDeviceId: newParams.deviceId
              });
            } catch (rotateError) {
              logError(rotateError, { stage: 'Cookie验证-轮换设备参数', cookieId });
            }
          }

          log('info', 'Cookie验证完成', {
            isValid: finalIsValid,
            duration,
            receivedData,
            gotFinish: isValid
          });

          // 将验证结果写入缓存（供cookieSelector过滤，避免失效Cookie在缓存期内仍被选中）
          try {
            await cookieManager.setValidationResult(cookieId, {
              isValid: finalIsValid,
              message: finalIsValid ? 'Cookie有效' : errorMessage,
              timestamp: new Date().toISOString()
            });
          } catch (cacheError) {
            logError(cacheError, { stage: 'Cookie验证-写入缓存' });
          }

          releaseLock();

          resolve({
            isValid: finalIsValid,
            message: finalIsValid
              ? 'Cookie有效'
              : (errorMessage || 'Cookie无效或已过期'),
            timestamp: new Date().toISOString(),
            duration
          });
        }
      });

      ws.on('error', (error) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);

          const duration = Date.now() - startTime;
          errorMessage = error.message || '连接错误';

          logError(error, { stage: 'Cookie验证-WebSocket错误' });

          try {
            ws.close();
          } catch (e) {
            // 忽略关闭错误
          }

          releaseLock();

          resolve({
            isValid: false,
            message: `验证失败: ${errorMessage}`,
            timestamp: new Date().toISOString(),
            duration
          });
        }
      });

    } catch (error) {
      logError(error, { stage: 'Cookie验证-初始化' });
      releaseLock();
      resolve({
        isValid: false,
        message: `验证失败: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime
      });
    }
  });
}

/**
 * 批量验证多个Cookie
 * @param {Array<Object>} cookies - Cookie对象数组，每个对象包含id和value
 * @param {number} timeout - 单个Cookie的超时时间（毫秒）
 * @returns {Promise<Array>} 验证结果数组
 */
export async function validateCookies(cookies, timeout = 5000) {
  const results = [];

  log('info', '开始批量验证Cookie', { count: cookies.length });

  // 逐个验证（避免并发过多）
  for (const cookie of cookies) {
    try {
      const result = await validateCookie(cookie.id, cookie.value, timeout);
      results.push({
        cookieId: cookie.id,
        cookieName: cookie.name,
        ...result
      });

      // 短暂延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logError(error, { stage: '批量验证Cookie', cookieId: cookie.id });
      results.push({
        cookieId: cookie.id,
        cookieName: cookie.name,
        isValid: false,
        message: `验证异常: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: 0
      });
    }
  }

  log('info', '批量验证完成', {
    total: results.length,
    valid: results.filter(r => r.isValid).length,
    invalid: results.filter(r => !r.isValid).length
  });

  return results;
}

export default {
  validateCookie,
  validateCookies
};
