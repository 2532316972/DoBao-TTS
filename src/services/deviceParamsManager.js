/**
 * 设备参数管理器（统一版）
 * 为每个Cookie生成并管理设备参数，支持设备ID轮换
 * 同时支持实时模式和预制书模式
 */

import fs from 'fs/promises';
import path from 'path';
import { log, logError } from '../utils/logger.js';
import { getDataPath } from '../utils/pathUtils.js';
import { 
    generateSimulatedFingerprint, 
    generateDeviceIdFromFingerprint,
    generateWebIdFromDeviceId 
} from '../utils/simulatedFingerprint.js';

// 存储文件路径
const STORAGE_FILE = 'cookie_device_params_v2.json';

/**
 * 设备参数管理器类
 * 统一管理所有Cookie的设备参数
 */
class DeviceParamsManager {
    constructor() {
        // 内存缓存: cookieId -> {fingerprint, deviceId, webId, isBlocked, createdAt, updatedAt}
        this.paramsCache = new Map();
        // 存储文件路径
        this.storagePath = getDataPath(STORAGE_FILE);
        // 是否已加载
        this.loaded = false;
        // 最后加载时间
        this.lastLoadTime = 0;
        // 缓存有效期（毫秒）- 5秒
        this.cacheTTL = 5000;
    }

    /**
     * 加载已保存的设备参数
     * 如果缓存过期，重新加载文件
     */
    async load() {
        const now = Date.now();
        
        // 检查缓存是否过期
        if (this.loaded && (now - this.lastLoadTime) < this.cacheTTL) {
            return;
        }

        try {
            const data = await fs.readFile(this.storagePath, 'utf-8');
            const saved = JSON.parse(data);
            this.paramsCache = new Map(Object.entries(saved));
            this.loaded = true;
            this.lastLoadTime = now;
            log('debug', '已加载设备参数', { count: this.paramsCache.size });
        } catch (error) {
            // 文件不存在或读取失败，使用空Map
            this.paramsCache = new Map();
            this.loaded = true;
            this.lastLoadTime = now;
            log('debug', '设备参数文件不存在，创建新的');
        }
    }

    /**
     * 保存设备参数到文件
     */
    async save() {
        try {
            const data = Object.fromEntries(this.paramsCache);
            await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
            log('debug', '已保存设备参数', { count: this.paramsCache.size });
        } catch (error) {
            logError(error, { stage: '保存设备参数' });
        }
    }

    /**
     * 获取或创建Cookie的设备参数
     * 如果当前参数被封禁，会自动生成新的
     * @param {string} cookieId - Cookie ID
     * @returns {Object} {fingerprint, deviceId, webId, isBlocked}
     */
    async getOrCreateParams(cookieId) {
        await this.load();

        // 检查是否已有保存的参数且未被封禁
        if (this.paramsCache.has(cookieId)) {
            const params = this.paramsCache.get(cookieId);
            if (!params.isBlocked) {
                log('debug', `使用已保存的设备参数`, { cookieId, deviceId: params.deviceId });
                return params;
            }
            log('info', `当前设备参数已被封禁，将生成新的`, { cookieId });
        }

        // 创建新的设备参数
        return await this.createNewParams(cookieId);
    }

    /**
     * 创建新的设备参数
     * @param {string} cookieId - Cookie ID
     * @returns {Object} {fingerprint, deviceId, webId, isBlocked}
     */
    async createNewParams(cookieId) {
        // 生成模拟指纹
        const fingerprint = generateSimulatedFingerprint();
        
        // 基于指纹生成设备ID
        const deviceId = generateDeviceIdFromFingerprint(fingerprint, 0);
        const webId = generateDeviceIdFromFingerprint(fingerprint, 1);

        const params = {
            fingerprint,
            deviceId,
            webId,
            isBlocked: false,
            blockCount: 0,  // 封禁次数计数
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.paramsCache.set(cookieId, params);
        await this.save();

        log('info', `创建新的设备参数`, { cookieId, deviceId, webId, fingerprint: fingerprint.substring(0, 20) + '...' });
        return params;
    }

    /**
     * 轮换设备参数（生成新的）
     * 当设备ID被封时调用
     * 遇到BLOCK错误直接轮换，不检查次数
     * @param {string} cookieId - Cookie ID
     * @returns {Object} 新的设备参数
     */
    async rotateParams(cookieId) {
        await this.load();

        if (this.paramsCache.has(cookieId)) {
            const oldParams = this.paramsCache.get(cookieId);
            
            // 增加封禁次数
            oldParams.blockCount = (oldParams.blockCount || 0) + 1;
            oldParams.isBlocked = true;
            oldParams.updatedAt = new Date().toISOString();
            
            log('info', `设备参数封禁次数增加，直接轮换`, { 
                cookieId, 
                deviceId: oldParams.deviceId,
                blockCount: oldParams.blockCount 
            });
            
            // 保存旧参数的更新
            await this.save();
        }

        log('info', `轮换设备参数`, { cookieId });

        // 创建新的设备参数（blockCount从0开始）
        return await this.createNewParams(cookieId);
    }

    /**
     * 标记设备参数为被封禁（增加封禁次数）
     * @param {string} cookieId - Cookie ID
     * @returns {Promise<Object>} 更新后的设备参数
     */
    async markAsBlocked(cookieId) {
        await this.load();

        if (this.paramsCache.has(cookieId)) {
            const params = this.paramsCache.get(cookieId);
            params.blockCount = (params.blockCount || 0) + 1;
            params.isBlocked = true;
            params.updatedAt = new Date().toISOString();
            await this.save();
            log('info', `设备参数已标记为被封禁`, { 
                cookieId, 
                deviceId: params.deviceId,
                blockCount: params.blockCount 
            });
            return params;
        }
        return null;
    }

    /**
     * 获取设备参数（不自动创建）
     * @param {string} cookieId - Cookie ID
     * @returns {Object|null} 设备参数或null
     */
    async getParams(cookieId) {
        await this.load();
        return this.paramsCache.get(cookieId) || null;
    }

    /**
     * 检查设备参数是否存在且有效
     * @param {string} cookieId - Cookie ID
     * @returns {boolean} 是否存在且未被封禁
     */
    async hasValidParams(cookieId) {
        await this.load();
        const params = this.paramsCache.get(cookieId);
        return params && !params.isBlocked;
    }

    /**
     * 移除Cookie的设备参数
     * @param {string} cookieId - Cookie ID
     */
    async removeParams(cookieId) {
        await this.load();

        if (this.paramsCache.has(cookieId)) {
            this.paramsCache.delete(cookieId);
            await this.save();
            log('info', `已移除设备参数`, { cookieId });
        }
    }

    /**
     * 获取所有设备参数统计
     * @returns {Object} 统计信息
     */
    async getStatistics() {
        await this.load();
        
        const allParams = Array.from(this.paramsCache.values());
        const validCount = allParams.filter(p => !p.isBlocked).length;
        const blockedCount = allParams.filter(p => p.isBlocked).length;

        return {
            total: allParams.length,
            valid: validCount,
            blocked: blockedCount
        };
    }

    /**
     * 清理所有被封禁的设备参数
     */
    async clearBlockedParams() {
        await this.load();

        const beforeCount = this.paramsCache.size;
        for (const [cookieId, params] of this.paramsCache.entries()) {
            if (params.isBlocked) {
                this.paramsCache.delete(cookieId);
            }
        }
        const afterCount = this.paramsCache.size;
        
        if (beforeCount !== afterCount) {
            await this.save();
            log('info', `已清理被封禁的设备参数`, { 
                before: beforeCount, 
                after: afterCount,
                cleared: beforeCount - afterCount 
            });
        }
    }
}

// 导出单例实例
export const deviceParamsManager = new DeviceParamsManager();

export default deviceParamsManager;
