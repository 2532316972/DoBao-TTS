/**
 * Cookie管理路由模块（重构版）
 * 使用CookieManager和CookieSelector进行统一管理
 * 提供Cookie的增删改查、轮换、测试、统计等API接口
 */

import { Router } from 'express';
import cookieManager from '../services/cookieManager.js';
import cookieSelector from '../services/cookieSelector.js';
import { validateCookie, validateCookies } from '../services/cookieValidator.js';
import { log, logError } from '../utils/logger.js';

export const router = Router();

/**
 * 初始化Cookie管理器
 */
async function ensureInitialized() {
  if (!cookieManager.initialized) {
    await cookieManager.initialize();
  }
}

/**
 * Cookie数据验证
 */
function validateCookieData(cookieData) {
  const errors = [];
  
  if (!cookieData.name || typeof cookieData.name !== 'string') {
    errors.push('Cookie名称不能为空');
  }
  
  if (!cookieData.value || typeof cookieData.value !== 'string') {
    errors.push('Cookie值不能为空');
  }
  
  if (cookieData.name && cookieData.name.length > 100) {
    errors.push('Cookie名称长度不能超过100个字符');
  }
  
  if (cookieData.value && cookieData.value.length > 10000) {
    errors.push('Cookie值长度不能超过10000个字符');
  }
  
  if (cookieData.description && cookieData.description.length > 500) {
    errors.push('Cookie描述长度不能超过500个字符');
  }
  
  return errors;
}

// ==================== API路由定义 ====================

/**
 * GET /api/cookies
 * 获取Cookie列表
 * @query {boolean} includeDisabled - 是否包含禁用的Cookie，默认true
 */
router.get('/cookies', async (req, res) => {
  try {
    log('info', 'API请求: GET /api/cookies');
    
    await ensureInitialized();
    
    // 获取所有Cookie（包括禁用的）
    const allCookies = cookieManager.getCookies(true);
    // 获取启用的Cookie用于统计
    const enabledCookies = cookieManager.getCookies();
    
    res.json({
      success: true,
      data: allCookies,
      total: allCookies.length,
      stats: {
        total: allCookies.length,
        enabled: enabledCookies.length,
        disabled: allCookies.length - enabledCookies.length,
        valid: enabledCookies.filter(c => c.status?.isValid === true).length,
        invalid: enabledCookies.filter(c => c.status?.isValid === false).length
      },
      message: '获取Cookie列表成功'
    });
  } catch (error) {
    logError(error, { stage: 'GET /api/cookies' });
    res.status(500).json({
      success: false,
      error: error.message || '获取Cookie列表失败'
    });
  }
});

/**
 * GET /api/cookies/stats
 * 获取Cookie统计信息
 */
router.get('/cookies/stats', async (req, res) => {
  try {
    log('info', 'API请求: GET /api/cookies/stats');

    await ensureInitialized();

    const cookies = cookieManager.getCookies();
    const metadata = cookieManager.getMetadata();
    const selectorStats = cookieSelector.getStatistics();
    const activeCookie = cookieManager.getActiveCookie();

    const stats = {
      total: cookies.length,
      valid: selectorStats.valid,
      invalid: selectorStats.invalid,
      active: activeCookie ? {
        id: activeCookie.id,
        name: activeCookie.name
      } : null,
      totalRequests: metadata.totalRequests,
      totalRotations: metadata.totalRotations,
      averageSuccessRate: selectorStats.averageSuccessRate,
      lastUpdated: metadata.lastUpdated
    };

    res.json({
      success: true,
      data: stats,
      message: '获取统计信息成功'
    });
  } catch (error) {
    logError(error, { stage: 'GET /api/cookies/stats' });
    res.status(500).json({
      success: false,
      error: error.message || '获取统计信息失败'
    });
  }
});



/**
 * PUT /api/cookies/:id/usage-limit
 * 设置单个Cookie的使用次数限制
 */
router.put('/cookies/:id/usage-limit', async (req, res) => {
  try {
    const idParam = req.params.id;
    const { limit } = req.body;

    log('info', `API请求: PUT /api/cookies/${idParam}/usage-limit`, { limit });

    await ensureInitialized();

    // 支持数字索引访问
    let cookieId = idParam;
    if (/^\d+$/.test(idParam)) {
      const cookies = cookieManager.getCookies();
      const index = parseInt(idParam);
      if (index >= 0 && index < cookies.length) {
        cookieId = cookies[index].id;
      }
    }

    // 验证limit参数
    const limitValue = parseInt(limit);
    if (isNaN(limitValue) || limitValue < 0 || limitValue > 10000) {
      return res.status(400).json({
        success: false,
        error: '限制次数必须是0-10000之间的整数（0表示不限制）'
      });
    }

    const cookie = cookieManager.getCookieById(cookieId);
    if (!cookie) {
      return res.status(404).json({
        success: false,
        error: 'Cookie不存在'
      });
    }

    // 更新Cookie的使用限制
    await cookieManager.updateCookie(cookieId, {
      limits: {
        ...cookie.limits,
        customUsageLimit: limitValue
      }
    });

    // 清除缓存
    cookieSelector.clearHealthyCache();

    log('info', 'Cookie使用限制已更新', { id: cookieId, name: cookie.name, limit: limitValue });

    res.json({
      success: true,
      data: {
        id: cookieId,
        name: cookie.name,
        limit: limitValue
      },
      message: `Cookie使用限制已设置为 ${limitValue === 0 ? '不限制' : limitValue + '次'}`
    });
  } catch (error) {
    logError(error, { stage: 'PUT /api/cookies/:id/usage-limit' });
    res.status(500).json({
      success: false,
      error: error.message || '设置Cookie使用限制失败'
    });
  }
});

/**
 * GET /api/cookies/:id
 * 根据ID获取单个Cookie
 */
router.get('/cookies/:id', async (req, res) => {
  try {
    const cookieId = req.params.id;
    log('info', `API请求: GET /api/cookies/${cookieId}`);
    
    await ensureInitialized();
    const cookie = cookieManager.getCookieById(cookieId);
    
    if (!cookie) {
      return res.status(404).json({
        success: false,
        error: 'Cookie不存在'
      });
    }
    
    res.json({
      success: true,
      data: cookie,
      message: '获取Cookie成功'
    });
  } catch (error) {
    logError(error, { stage: 'GET /api/cookies/:id' });
    res.status(500).json({
      success: false,
      error: error.message || '获取Cookie失败'
    });
  }
});

/**
 * POST /api/cookies
 * 添加新Cookie
 */
router.post('/cookies', async (req, res) => {
  try {
    log('info', 'API请求: POST /api/cookies');
    
    const cookieData = req.body;
    log('info', '添加Cookie数据', { name: cookieData.name });
    
    // 验证Cookie数据
    const validationErrors = validateCookieData(cookieData);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: validationErrors.join('; ')
      });
    }
    
    await ensureInitialized();
    const newCookie = await cookieManager.addCookie(cookieData);
    
    // 清除健康Cookie缓存
    cookieSelector.clearHealthyCache();
    
    log('info', 'Cookie添加成功', { id: newCookie.id, name: newCookie.name });
    
    res.status(201).json({
      success: true,
      data: newCookie,
      message: 'Cookie添加成功'
    });
  } catch (error) {
    logError(error, { stage: 'POST /api/cookies' });
    res.status(400).json({
      success: false,
      error: error.message || '添加Cookie失败'
    });
  }
});

/**
 * PUT /api/cookies/:id
 * 更新Cookie（支持字符串ID和数字索引）
 */
router.put('/cookies/:id', async (req, res) => {
  try {
    const idParam = req.params.id;
    const cookieData = req.body;
    
    log('info', `API请求: PUT /api/cookies/${idParam}`);
    
    await ensureInitialized();
    
    // 支持数字索引访问（向后兼容）
    let cookieId = idParam;
    if (/^\d+$/.test(idParam)) {
      const cookies = cookieManager.getCookies();
      const index = parseInt(idParam);
      if (index >= 0 && index < cookies.length) {
        cookieId = cookies[index].id;
        log('info', '索引转换为ID', { index, id: cookieId });
      }
    }
    
    // 验证Cookie数据
    const validationErrors = validateCookieData(cookieData);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: validationErrors.join('; ')
      });
    }
    
    // 构建更新对象
    const updates = {
      name: cookieData.name,
      value: cookieData.value,
      description: cookieData.description || ''
    };
    
    const updatedCookie = await cookieManager.updateCookie(cookieId, updates);
    
    // 清除健康Cookie缓存
    cookieSelector.clearHealthyCache();
    
    log('info', 'Cookie更新成功', { id: updatedCookie.id, name: updatedCookie.name });
    
    res.json({
      success: true,
      data: updatedCookie,
      message: 'Cookie更新成功'
    });
  } catch (error) {
    logError(error, { stage: 'PUT /api/cookies/:id' });
    const statusCode = error.message === 'Cookie不存在' ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: error.message || '更新Cookie失败'
    });
  }
});

/**
 * DELETE /api/cookies/:id
 * 删除Cookie（支持字符串ID和数字索引）
 */
router.delete('/cookies/:id', async (req, res) => {
  try {
    const idParam = req.params.id;
    
    log('info', `API请求: DELETE /api/cookies/${idParam}`);
    
    await ensureInitialized();
    
    // 支持数字索引访问（向后兼容）
    let cookieId = idParam;
    if (/^\d+$/.test(idParam)) {
      const cookies = cookieManager.getCookies();
      const index = parseInt(idParam);
      if (index >= 0 && index < cookies.length) {
        cookieId = cookies[index].id;
        log('info', '索引转换为ID', { index, id: cookieId });
      }
    }
    
    await cookieManager.deleteCookie(cookieId);
    
    // 清除健康Cookie缓存
    cookieSelector.clearHealthyCache();
    
    log('info', 'Cookie删除成功', { id: cookieId });
    
    res.json({
      success: true,
      message: 'Cookie删除成功'
    });
  } catch (error) {
    logError(error, { stage: 'DELETE /api/cookies/:id' });
    const statusCode = error.message === 'Cookie不存在' ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || '删除Cookie失败'
    });
  }
});

/**
 * POST /api/cookies/rotate
 * 轮换Cookie（设置活跃Cookie）
 */
router.post('/cookies/rotate', async (req, res) => {
  try {
    const { cookieId } = req.body;
    
    log('info', 'API请求: POST /api/cookies/rotate', { cookieId });
    
    await ensureInitialized();
    
    let activeCookie;
    if (cookieId) {
      // 设置指定的Cookie为活跃
      activeCookie = await cookieManager.setActiveCookie(cookieId);
    } else {
      // 轮换到下一个Cookie
      activeCookie = await cookieSelector.rotateToNext();
    }
    
    if (!activeCookie) {
      return res.status(404).json({
        success: false,
        error: '没有可用的Cookie进行轮换'
      });
    }
    
    log('info', 'Cookie轮换成功', { id: activeCookie.id, name: activeCookie.name });
    
    res.json({
      success: true,
      data: activeCookie,
      message: 'Cookie轮换成功'
    });
  } catch (error) {
    logError(error, { stage: 'POST /api/cookies/rotate' });
    res.status(500).json({
      success: false,
      error: error.message || 'Cookie轮换失败'
    });
  }
});

/**
 * POST /api/cookies/:id/test
 * 测试Cookie有效性（真实验证）
 */
router.post('/cookies/:id/test', async (req, res) => {
  try {
    const idParam = req.params.id;
    
    log('info', `API请求: POST /api/cookies/${idParam}/test`);
    
    await ensureInitialized();
    
    // 支持数字索引访问（向后兼容）
    let cookieId = idParam;
    if (/^\d+$/.test(idParam)) {
      const cookies = cookieManager.getCookies();
      const index = parseInt(idParam);
      if (index >= 0 && index < cookies.length) {
        cookieId = cookies[index].id;
      }
    }
    
    const cookie = cookieManager.getCookieById(cookieId);
    if (!cookie) {
      return res.status(404).json({
        success: false,
        error: 'Cookie不存在'
      });
    }
    
    log('info', '开始真实验证Cookie', { id: cookieId, name: cookie.name });
    
    // 使用真实的TTS API验证Cookie
    const validationResult = await validateCookie(cookieId, cookie.value);
    
    if (validationResult.isValid) {
      // 验证成功，更新使用统计
      await cookieManager.updateCookieUsage(cookieId, true);
      
      // 更新Cookie的验证状态
      await cookieManager.updateCookie(cookieId, {
        status: {
          ...cookie.status,
          isValid: true,
          lastValidated: validationResult.timestamp,
          validationStatus: 'success',
          lastError: null
        }
      });
    } else {
      // 验证失败，标记Cookie为无效
      await cookieManager.markCookieAsInvalid(cookieId, validationResult.message || 'Cookie验证失败');
      
      // 更新验证状态
      await cookieManager.updateCookie(cookieId, {
        status: {
          ...cookie.status,
          lastValidated: validationResult.timestamp,
          validationStatus: 'failed'
        }
      });
    }
    
    // 清除健康Cookie缓存
    cookieSelector.clearHealthyCache();
    
    // 重新获取更新后的Cookie
    const updatedCookie = cookieManager.getCookieById(cookieId);
    
    const result = {
      isValid: validationResult.isValid,
      message: validationResult.message,
      checkedAt: validationResult.timestamp,
      duration: validationResult.duration,
      lastError: updatedCookie.status.lastError
    };
    
    log('info', 'Cookie测试完成', {
      id: cookieId,
      isValid: validationResult.isValid,
      duration: validationResult.duration
    });
    
    res.json({
      success: validationResult.isValid,
      message: result.message,
      data: result
    });
  } catch (error) {
    logError(error, { stage: 'POST /api/cookies/:id/test' });
    res.status(500).json({
      success: false,
      error: error.message || '测试Cookie失败'
    });
  }
});

/**
 * POST /api/cookies/:id/toggle
 * 切换Cookie的启用/禁用状态
 */
router.post('/cookies/:id/toggle', async (req, res) => {
  try {
    const idParam = req.params.id;
    const { disabled } = req.body;
    
    log('info', `API请求: POST /api/cookies/${idParam}/toggle`, { disabled });
    
    await ensureInitialized();
    
    // 支持数字索引访问（向后兼容）
    let cookieId = idParam;
    if (/^\d+$/.test(idParam)) {
      const cookies = cookieManager.getCookies();
      const index = parseInt(idParam);
      if (index >= 0 && index < cookies.length) {
        cookieId = cookies[index].id;
      }
    }
    
    const cookie = cookieManager.getCookieById(cookieId);
    if (!cookie) {
      return res.status(404).json({
        success: false,
        error: 'Cookie不存在'
      });
    }
    
    // 如果未提供disabled参数，则取反当前状态
    const newDisabledState = disabled !== undefined ? disabled : !cookie.status?.isDisabled;
    
    // 更新Cookie的禁用状态
    await cookieManager.updateCookie(cookieId, {
      status: {
        ...cookie.status,
        isDisabled: newDisabledState
      }
    });

    // 清除Cookie选择器缓存，确保状态同步
    cookieSelector.clearHealthyCache();

    const action = newDisabledState ? '禁用' : '启用';
    log('info', `Cookie已${action}`, { id: cookieId, name: cookie.name, isDisabled: newDisabledState });
    
    // 获取更新后的Cookie
    const updatedCookie = cookieManager.getCookieById(cookieId);
    
    return res.json({
      success: true,
      message: `Cookie已${action}`,
      data: {
        id: cookieId,
        name: cookie.name,
        isDisabled: newDisabledState,
        cookie: updatedCookie
      }
    });
  } catch (error) {
    logError(error, { stage: 'POST /api/cookies/:id/toggle' });
    return res.status(500).json({
      success: false,
      error: error.message || '切换Cookie状态失败'
    });
  }
});

/**
 * POST /api/cookies/batch/test
 * 批量测试Cookie（真实验证）
 */
router.post('/cookies/batch/test', async (req, res) => {
  try {
    const { indexes } = req.body;
    
    log('info', 'API请求: POST /api/cookies/batch/test', { indexes });
    
    if (!Array.isArray(indexes) || indexes.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供有效的Cookie索引列表'
      });
    }
    
    await ensureInitialized();
    const cookies = cookieManager.getCookies();
    
    // 准备要验证的Cookie列表
    const cookiesToValidate = [];
    const results = [];
    
    for (const index of indexes) {
      if (index < 0 || index >= cookies.length) {
        results.push({
          index,
          success: false,
          error: `Cookie索引 ${index} 不存在`
        });
      } else {
        const cookie = cookies[index];
        cookiesToValidate.push({
          index,
          id: cookie.id,
          name: cookie.name,
          value: cookie.value
        });
      }
    }
    
    if (cookiesToValidate.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有有效的Cookie可以测试'
      });
    }
    
    log('info', '开始批量真实验证Cookie', { count: cookiesToValidate.length });
    
    // 批量验证Cookie
    const validationResults = await validateCookies(cookiesToValidate);
    
    let successCount = 0;
    let failCount = 0;
    
    // 处理验证结果并更新Cookie状态
    for (const validationResult of validationResults) {
      const cookie = cookies.find(c => c.id === validationResult.cookieId);
      if (!cookie) continue;
      
      const isValid = validationResult.isValid;
      
      if (isValid) {
        // 验证成功，更新使用统计
        await cookieManager.updateCookieUsage(validationResult.cookieId, true);
        
        // 更新Cookie的验证状态
        await cookieManager.updateCookie(validationResult.cookieId, {
          status: {
            ...cookie.status,
            isValid: true,
            lastValidated: validationResult.timestamp,
            validationStatus: 'success',
            lastError: null
          }
        });
      } else {
        // 验证失败，标记Cookie为无效
        await cookieManager.markCookieAsInvalid(
          validationResult.cookieId,
          validationResult.message || 'Cookie验证失败'
        );
        
        // 更新验证状态
        await cookieManager.updateCookie(validationResult.cookieId, {
          status: {
            ...cookie.status,
            lastValidated: validationResult.timestamp,
            validationStatus: 'failed'
          }
        });
      }
      
      if (isValid) {
        successCount++;
      } else {
        failCount++;
      }
      
      // 查找对应的索引
      const cookieToValidate = cookiesToValidate.find(c => c.id === validationResult.cookieId);
      
      results.push({
        index: cookieToValidate ? cookieToValidate.index : -1,
        cookieId: validationResult.cookieId,
        name: validationResult.cookieName,
        success: isValid,
        result: {
          isValid: isValid,
          message: validationResult.message,
          checkedAt: validationResult.timestamp,
          duration: validationResult.duration
        }
      });
    }
    
    // 清除健康Cookie缓存
    cookieSelector.clearHealthyCache();
    
    log('info', '批量测试完成', {
      successCount,
      failCount,
      total: cookiesToValidate.length
    });
    
    res.json({
      success: true,
      message: `批量测试完成: 成功 ${successCount} 个，失败 ${failCount} 个`,
      data: {
        successCount,
        failCount,
        total: results.length,
        results
      }
    });
  } catch (error) {
    logError(error, { stage: 'POST /api/cookies/batch/test' });
    res.status(500).json({
      success: false,
      error: error.message || '批量测试Cookie失败'
    });
  }
});

/**
 * DELETE /api/cookies
 * 清空所有Cookie数据
 */
router.delete('/cookies', async (req, res) => {
  try {
    log('info', 'API请求: DELETE /api/cookies - 清空所有Cookie');

    await ensureInitialized();

    // 使用clearAllCookies方法清空所有Cookie
    const deletedCount = await cookieManager.clearAllCookies();

    // 清除健康Cookie缓存
    cookieSelector.clearHealthyCache();

    log('info', '所有Cookie已清空', { deletedCount });

    res.json({
      success: true,
      code: 0,
      message: deletedCount === 0 ? '没有Cookie需要清理' : `成功清理 ${deletedCount} 个Cookie`,
      data: { deletedCount }
    });
  } catch (error) {
    logError(error, { stage: 'DELETE /api/cookies' });
    res.status(500).json({
      success: false,
      code: 500,
      error: error.message || '清理Cookie失败'
    });
  }
});

// 导出路由器
export { router as cookiesRouter };