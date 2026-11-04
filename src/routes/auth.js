/**
 * 认证路由模块
 * 提供二维码登录获取Cookie的功能
 * 支持豆包（Doubao）账号的二维码登录
 */

import { Router } from 'express';
import cookieManager from '../services/cookieManager.js';
import { log, logError } from '../utils/logger.js';
import {
  getQrCode,
  checkQrStatus,
  getSession,
  deleteSession,
  getSessionCount
} from '../services/doubaoQrLogin.js';

export const router = Router();

/**
 * POST /api/auth/qr-code
 * 获取二维码
 */
router.post('/auth/qr-code', async (req, res) => {
  try {
    log('info', 'API请求: POST /api/auth/qr-code');

    const result = await getQrCode();

    if (result.success) {
      res.json({
        success: true,
        message: '二维码获取成功',
        data: {
          sessionId: result.sessionId,
          qrCodeUrl: result.qrCodeUrl,
          qrCodeImg: result.qrCodeImg,
          expiresIn: result.expiresIn
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || '获取二维码失败',
        message: result.message
      });
    }

  } catch (error) {
    logError(error, { stage: 'POST /api/auth/qr-code' });
    res.status(500).json({
      success: false,
      error: error.message || '获取二维码失败'
    });
  }
});

/**
 * POST /api/auth/qr-status
 * 检查二维码状态
 */
router.post('/auth/qr-status', async (req, res) => {
  try {
    const { sessionId } = req.body;

    log('info', 'API请求: POST /api/auth/qr-status', { sessionId });

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: '缺少会话ID'
      });
    }

    const result = await checkQrStatus(sessionId);

    res.json(result);

  } catch (error) {
    logError(error, { stage: 'POST /api/auth/qr-status' });
    res.status(500).json({
      success: false,
      error: error.message || '检查状态失败'
    });
  }
});

/**
 * POST /api/auth/qr-confirm
 * 确认二维码登录并保存Cookie
 */
router.post('/auth/qr-confirm', async (req, res) => {
  try {
    const { sessionId, cookieName } = req.body;

    log('info', 'API请求: POST /api/auth/qr-confirm', { sessionId, cookieName });

    // 验证参数
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: '缺少会话ID'
      });
    }

    if (!cookieName || cookieName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: '请输入Cookie名称'
      });
    }

    // 获取会话
    const session = getSession(sessionId);
    if (!session) {
      return res.status(400).json({
        success: false,
        error: '会话不存在或已过期'
      });
    }

    // 检查是否已获取Cookie
    if (session.status !== 'confirmed' || !session.cookies) {
      return res.status(400).json({
        success: false,
        error: '登录尚未完成，请先在手机上确认登录'
      });
    }

    // 初始化Cookie管理器
    if (!cookieManager.initialized) {
      await cookieManager.initialize();
    }

    // 检查Cookie名称是否已存在
    const existingCookies = cookieManager.getCookies(true);
    if (existingCookies.some(c => c.name === cookieName.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Cookie名称已存在，请使用其他名称'
      });
    }

    // 添加Cookie
    const newCookie = await cookieManager.addCookie({
      name: cookieName.trim(),
      value: session.cookies,
      description: `通过二维码登录获取`
    });

    // 删除会话
    deleteSession(sessionId);

    log('info', '二维码登录成功，Cookie已保存', {
      id: newCookie.id,
      name: newCookie.name
    });

    res.json({
      success: true,
      message: '登录成功，Cookie已保存',
      data: {
        id: newCookie.id,
        name: newCookie.name
      }
    });

  } catch (error) {
    logError(error, { stage: 'POST /api/auth/qr-confirm' });
    res.status(500).json({
      success: false,
      error: error.message || '保存Cookie失败'
    });
  }
});

/**
 * GET /api/auth/qr-sessions
 * 获取当前二维码会话数量（用于监控）
 */
router.get('/auth/qr-sessions', async (req, res) => {
  try {
    const count = getSessionCount();

    res.json({
      success: true,
      data: {
        sessionCount: count
      }
    });

  } catch (error) {
    logError(error, { stage: 'GET /api/auth/qr-sessions' });
    res.status(500).json({
      success: false,
      error: error.message || '获取会话数量失败'
    });
  }
});

// 导出路由器
export { router as authRouter };
