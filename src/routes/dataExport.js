/**
 * 数据导出路由模块
 * 提供用户数据导出功能，包括Cookie、预制书任务、书籍缓存等
 */

import { Router } from 'express';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import archiver from 'archiver';
import { pipeline } from 'stream/promises';
import cookieManager from '../services/cookieManager.js';
import { prefetchService } from '../services/prefetch/prefetchService.js';
import { bookCacheService } from '../services/prefetch/bookCacheService.js';
import { log, logError } from '../utils/logger.js';
import { getDataPath } from '../utils/pathUtils.js';

export const router = Router();

/**
 * 初始化所需服务
 */
async function ensureInitialized() {
  if (!cookieManager.initialized) {
    await cookieManager.initialize();
  }
  if (!prefetchService.initialized) {
    await prefetchService.initialize();
  }
  if (!bookCacheService.initialized) {
    await bookCacheService.initialize();
  }
}

/**
 * POST /api/export/all
 * 导出所有选中的数据
 * @body {Object} options - 导出选项
 * @body {boolean} options.cookies - 是否导出Cookie
 * @body {boolean} options.prefetchTasks - 是否导出预制书任务
 * @body {boolean} options.bookCache - 是否导出书籍缓存
 * @body {boolean} options.audioFiles - 是否导出音频文件
 */
router.post('/export/all', async (req, res) => {
  try {
    log('info', 'API请求: POST /api/export/all', { options: req.body });

    await ensureInitialized();

    const {
      cookies = true,
      prefetchTasks = true,
      bookCache = true,
      audioFiles = false
    } = req.body;

    // 创建临时目录
    const tempDir = getDataPath('temp');
    const exportDir = path.join(tempDir, `export_${Date.now()}`);
    await fs.mkdir(exportDir, { recursive: true });

    const exportData = {
      exportVersion: '1.0',
      exportTime: new Date().toISOString(),
      data: {}
    };

    // 导出Cookie数据
    if (cookies) {
      log('info', '正在导出Cookie数据...');
      const cookieData = cookieManager.getCookies(true);
      exportData.data.cookies = cookieData;
      log('info', `导出 ${cookieData.length} 个Cookie`);
    }

    // 导出预制书任务数据
    if (prefetchTasks) {
      log('info', '正在导出预制书任务数据...');
      const tasks = await prefetchService.getAllTasks();
      exportData.data.prefetchTasks = tasks;
      log('info', `导出 ${tasks.length} 个预制书任务`);
    }

    // 导出书籍缓存数据
    if (bookCache) {
      log('info', '正在导出书籍缓存数据...');
      const books = await bookCacheService.getCachedBooks();
      exportData.data.bookCache = books;
      log('info', `导出 ${books.length} 本书籍缓存`);
    }

    // 保存JSON数据文件
    const jsonPath = path.join(exportDir, 'data.json');
    await fs.writeFile(jsonPath, JSON.stringify(exportData, null, 2), 'utf-8');
    log('info', '数据JSON文件已保存');

    // 如果需要导出音频文件
    if (audioFiles) {
      log('info', '正在复制音频文件...');

      // 导出预制书的音频文件
      const prefetchDir = getDataPath('prefetch');
      const prefetchAudioDir = path.join(prefetchDir, 'books');
      log('info', `检查预制书音频目录: ${prefetchAudioDir}`);
      try {
        await fs.access(prefetchAudioDir);
        const prefetchTargetDir = path.join(exportDir, 'audio', 'prefetch');
        log('info', `开始复制预制书音频文件到: ${prefetchTargetDir}`);
        await copyDirectory(prefetchAudioDir, prefetchTargetDir);
        log('info', '预制书音频文件已复制');
      } catch (error) {
        log('warn', '预制书音频文件目录不存在或复制失败', { error: error.message });
      }

      // 导出阅读TTS的书籍缓存（章节内容）
      const bookCacheDir = getDataPath('book-cache');
      const booksSourceDir = path.join(bookCacheDir, 'books');
      try {
        await fs.access(booksSourceDir);
        const booksTargetDir = path.join(exportDir, 'audio', 'book-cache');
        await copyDirectory(booksSourceDir, booksTargetDir);
        log('info', '阅读TTS书籍缓存已复制');
      } catch (error) {
        log('warn', '阅读TTS书籍缓存目录不存在或复制失败', { error: error.message });
      }

      // 导出封面缓存
      const coversSourceDir = path.join(bookCacheDir, 'covers');
      try {
        await fs.access(coversSourceDir);
        const coversTargetDir = path.join(exportDir, 'audio', 'covers');
        await copyDirectory(coversSourceDir, coversTargetDir);
        log('info', '封面缓存已复制');
      } catch (error) {
        log('warn', '封面缓存目录不存在或复制失败', { error: error.message });
      }
    }

    // 创建ZIP文件
    const zipFilename = `dobao-tts-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const zipPath = path.join(tempDir, zipFilename);

    log('info', '正在创建ZIP文件...');
    await createZipArchive(exportDir, zipPath);
    log('info', 'ZIP文件创建完成');

    // 清理临时导出目录
    await fs.rm(exportDir, { recursive: true, force: true });

    // 发送文件
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const fileStream = createReadStream(zipPath);
    fileStream.pipe(res);

    // 文件发送完成后删除临时ZIP文件
    fileStream.on('close', async () => {
      try {
        await fs.unlink(zipPath);
        log('info', '临时ZIP文件已清理');
      } catch (error) {
        logError(error, { stage: '清理临时ZIP文件' });
      }
    });

    fileStream.on('error', (error) => {
      logError(error, { stage: '发送导出文件' });
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: '文件传输失败'
        });
      }
    });

  } catch (error) {
    logError(error, { stage: '导出数据' });
    res.status(500).json({
      success: false,
      error: error.message || '导出失败'
    });
  }
});

/**
 * GET /api/export/stats
 * 获取可导出数据的统计信息
 */
router.get('/export/stats', async (req, res) => {
  try {
    log('info', 'API请求: GET /api/export/stats');

    await ensureInitialized();

    // 获取Cookie数量
    const cookies = cookieManager.getCookies(true);
    const cookieCount = cookies.length;

    // 获取预制任务数量
    const tasks = await prefetchService.getAllTasks();
    const taskCount = tasks.length;

    // 获取书籍缓存数量
    const books = await bookCacheService.getCachedBooks();
    const bookCount = books.length;

    res.json({
      success: true,
      data: {
        cookieCount,
        taskCount,
        bookCount
      }
    });

  } catch (error) {
    logError(error, { stage: '获取导出统计' });
    res.status(500).json({
      success: false,
      error: error.message || '获取统计失败'
    });
  }
});

/**
 * 复制目录
 * @param {string} src - 源目录
 * @param {string} dest - 目标目录
 */
async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 创建ZIP压缩包
 * @param {string} sourceDir - 源目录
 * @param {string} zipPath - ZIP文件路径
 */
async function createZipArchive(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    output.on('close', () => {
      log('info', `ZIP文件创建完成: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        log('warn', 'ZIP创建警告', { error: err.message });
      } else {
        reject(err);
      }
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

export default router;
