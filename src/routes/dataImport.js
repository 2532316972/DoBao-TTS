/**
 * 数据导入路由模块
 * 提供用户数据导入功能，包括Cookie、预制书任务、书籍缓存等
 */

import { Router } from 'express';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
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
 * POST /api/import/all
 * 导入数据
 * @body {Object} options - 导入选项
 * @body {boolean} options.cookies - 是否导入Cookie
 * @body {boolean} options.prefetchTasks - 是否导入预制书任务
 * @body {boolean} options.bookCache - 是否导入书籍缓存
 * @body {boolean} options.audioFiles - 是否导入音频文件
 * @body {boolean} options.mergeStrategy - 合并策略: 'merge'(合并) 或 'replace'(替换)
 */
router.post('/import/all', async (req, res) => {
  try {
    log('info', 'API请求: POST /api/import/all');

    await ensureInitialized();

    // 检查是否有文件上传
    if (!req.files || !req.files.importFile) {
      return res.status(400).json({
        success: false,
        error: '请上传导入文件'
      });
    }

    const importFile = req.files.importFile;
    const {
      cookies = true,
      prefetchTasks = true,
      bookCache = true,
      audioFiles = false,
      mergeStrategy = 'merge' // 'merge' 或 'replace'
    } = req.body;

    // 调试日志
    log('info', '导入参数', { cookies, prefetchTasks, bookCache, audioFiles, mergeStrategy });

    // 创建临时目录
    const tempDir = getDataPath('temp');
    const importDir = path.join(tempDir, `import_${Date.now()}`);
    await fs.mkdir(importDir, { recursive: true });

    // 确定zip文件路径
    let zipPath;
    let isUsingTempFile = false;

    // 如果使用了临时文件，直接使用临时文件路径
    if (importFile.tempFilePath) {
      zipPath = importFile.tempFilePath;
      isUsingTempFile = true;
      log('info', `使用上传临时文件`, {
        tempFilePath: zipPath,
        size: importFile.size,
        fileName: importFile.name
      });
    } else {
      // 小文件在内存中，需要保存到磁盘
      zipPath = path.join(tempDir, `import_${Date.now()}.zip`);
      await importFile.mv(zipPath);

      // 验证文件大小
      const stats = await fs.stat(zipPath);
      log('info', `导入文件已保存`, {
        originalSize: importFile.size,
        savedSize: stats.size,
        fileName: importFile.name
      });

      // 检查文件大小是否一致
      if (stats.size !== importFile.size) {
        throw new Error(`文件上传不完整: 原文件 ${importFile.size} 字节，实际保存 ${stats.size} 字节`);
      }
    }

    // 解压ZIP文件
    log('info', '正在解压导入文件...');
    await extractZip(zipPath, importDir);
    log('info', '文件解压完成');

    // 读取数据JSON文件
    const jsonPath = path.join(importDir, 'data.json');
    let importData;
    try {
      const jsonContent = await fs.readFile(jsonPath, 'utf-8');
      importData = JSON.parse(jsonContent);
      log('info', '导入数据结构', {
        hasCookies: !!importData.data?.cookies,
        cookieCount: importData.data?.cookies?.length || 0,
        hasPrefetchTasks: !!importData.data?.prefetchTasks,
        hasBookCache: !!importData.data?.bookCache
      });
    } catch (error) {
      throw new Error('无法读取导入数据文件，请确保文件格式正确');
    }

    const results = {
      cookies: { imported: 0, skipped: 0, errors: [] },
      prefetchTasks: { imported: 0, skipped: 0, errors: [] },
      bookCache: { imported: 0, skipped: 0, errors: [] },
      audioFiles: { imported: 0, skipped: 0, errors: [] }
    };

    // 导入Cookie数据
    if (cookies && importData.data?.cookies && importData.data.cookies.length > 0) {
      log('info', '正在导入Cookie数据...');
      const cookieResults = await importCookies(importData.data.cookies, mergeStrategy);
      results.cookies = cookieResults;
      log('info', `Cookie导入完成: ${cookieResults.imported} 个成功, ${cookieResults.skipped} 个跳过`);
    }

    // 导入预制书任务数据
    if (prefetchTasks && importData.data?.prefetchTasks && importData.data.prefetchTasks.length > 0) {
      log('info', '正在导入预制书任务数据...');
      const taskResults = await importPrefetchTasks(importData.data.prefetchTasks, mergeStrategy);
      results.prefetchTasks = taskResults;
      log('info', `预制书任务导入完成: ${taskResults.imported} 个成功, ${taskResults.skipped} 个跳过`);
    }

    // 导入书籍缓存数据
    if (bookCache && importData.data?.bookCache && importData.data.bookCache.length > 0) {
      log('info', '正在导入书籍缓存数据...');
      const bookResults = await importBookCache(importData.data.bookCache, mergeStrategy);
      results.bookCache = bookResults;
      log('info', `书籍缓存导入完成: ${bookResults.imported} 个成功, ${bookResults.skipped} 个跳过`);
    }

    // 导入音频文件
    if (audioFiles) {
      log('info', '正在导入音频文件...');
      const audioSourceDir = path.join(importDir, 'audio');
      try {
        await fs.access(audioSourceDir);
        log('info', `音频文件目录存在: ${audioSourceDir}`);
        const audioResults = await importAudioFiles(audioSourceDir, mergeStrategy);
        results.audioFiles = audioResults;
        log('info', `音频文件导入完成: ${audioResults.imported} 个成功, ${audioResults.skipped} 个跳过`);
      } catch (error) {
        log('warn', '导入文件中不包含音频文件或导入失败', { error: error.message });
        results.audioFiles.errors.push('导入文件中不包含音频文件');
      }
    }

    // 清理临时文件
    await fs.rm(importDir, { recursive: true, force: true });
    // 只有我们自己创建的文件才需要删除，express-fileupload的临时文件会自动清理
    if (!isUsingTempFile) {
      await fs.unlink(zipPath);
    }
    log('info', '临时文件已清理');

    res.json({
      success: true,
      data: results,
      message: '数据导入完成'
    });

  } catch (error) {
    logError(error, { stage: '导入数据' });
    res.status(500).json({
      success: false,
      error: error.message || '导入失败'
    });
  }
});

/**
 * 导入Cookie数据
 * @param {Array} cookies - Cookie数据数组
 * @param {string} mergeStrategy - 合并策略
 * @returns {Object} 导入结果
 */
async function importCookies(cookies, mergeStrategy) {
  const result = { imported: 0, skipped: 0, errors: [] };

  // 如果是覆盖策略，先清空所有现有Cookie
  if (mergeStrategy === 'replace') {
    log('info', '覆盖模式：清空现有Cookie数据');
    const existingCookies = cookieManager.getCookies(true);
    for (const cookie of existingCookies) {
      await cookieManager.deleteCookie(cookie.id);
    }
  }

  for (const cookieData of cookies) {
    try {
      // 检查是否已存在相同ID的Cookie
      const existingCookies = cookieManager.getCookies(true);
      const exists = existingCookies.some(c => c.id === cookieData.id);

      if (exists) {
        if (mergeStrategy === 'replace') {
          // 覆盖模式：删除旧的（上面已经清空了，这里再检查一次以防万一）
          await cookieManager.deleteCookie(cookieData.id);
        } else {
          // 合并模式：跳过已存在的
          result.skipped++;
          continue;
        }
      }

      // 添加新Cookie，保留使用记录
      await cookieManager.addCookie({
        id: cookieData.id,
        name: cookieData.name,
        value: cookieData.value,
        description: cookieData.description || '',
        isActive: cookieData.status?.isActive || false,
        isValid: cookieData.status?.isValid !== false,
        isDisabled: cookieData.status?.isDisabled || false,
        lastValidated: cookieData.status?.lastValidated || null,
        validationStatus: cookieData.status?.validationStatus || 'pending',
        lastError: cookieData.status?.lastError || null,
        lastFailure: cookieData.status?.lastFailure || null,
        usageCount: cookieData.usage?.usageCount || 0,
        lastUsed: cookieData.usage?.lastUsed || null,
        successCount: cookieData.usage?.successCount || 0,
        failureCount: cookieData.usage?.failureCount || 0,
        createdAt: cookieData.metadata?.createdAt,
        updatedAt: cookieData.metadata?.updatedAt,
        tags: cookieData.metadata?.tags || [],
        priority: cookieData.metadata?.priority !== undefined ? cookieData.metadata.priority : 5,
        weight: cookieData.metadata?.weight !== undefined ? cookieData.metadata.weight : 1
      });

      result.imported++;
    } catch (error) {
      result.errors.push(`Cookie "${cookieData.name}": ${error.message}`);
    }
  }

  return result;
}

/**
 * 导入预制书任务数据
 * @param {Array} tasks - 任务数据数组
 * @param {string} mergeStrategy - 合并策略
 * @returns {Object} 导入结果
 */
async function importPrefetchTasks(tasks, mergeStrategy) {
  const result = { imported: 0, skipped: 0, errors: [] };

  // 如果是覆盖策略，先清空所有现有任务
  if (mergeStrategy === 'replace') {
    log('info', '覆盖模式：清空现有预制书任务');
    const existingTasks = await prefetchService.getAllTasks();
    for (const task of existingTasks) {
      await prefetchService.deleteTask(task.taskId || task.id);
    }
  }

  for (const taskData of tasks) {
    try {
      const taskId = taskData.taskId || taskData.id;

      // 检查是否已存在相同ID的任务
      const existingTasks = await prefetchService.getAllTasks();
      const exists = existingTasks.some(t => (t.taskId || t.id) === taskId);

      if (exists) {
        if (mergeStrategy === 'replace') {
          // 覆盖模式：删除旧的（上面已经清空了，这里再检查一次以防万一）
          await prefetchService.deleteTask(taskId);
        } else {
          // 合并模式：跳过已存在的
          result.skipped++;
          continue;
        }
      }

      // 直接使用 saveTask 保存完整任务数据，保留所有原始信息
      // 确保任务数据完整，包括 bookInfo、chapters、progress 等
      const taskToSave = {
        ...taskData,
        taskId: taskId,
        // 确保关键字段存在
        bookId: taskData.bookId || taskData.bookInfo?.bookId,
        bookName: taskData.bookName || taskData.bookInfo?.bookName || '未知书籍',
        status: taskData.status || 'pending',
        progress: taskData.progress || {
          current: 0,
          total: taskData.chapters?.length || 0,
          completed: [],
          failed: []
        },
        chapters: taskData.chapters || [],
        // 保留原始时间戳或更新
        createdAt: taskData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 直接使用 saveTask 而不是 createTask，避免数据被重置
      await prefetchService.saveTask(taskToSave);
      // 同时更新内存中的任务映射
      prefetchService.tasks.set(taskId, taskToSave);

      log('info', `任务导入成功: ${taskToSave.bookName}`, {
        taskId,
        totalChapters: taskToSave.chapters?.length || 0,
        progressTotal: taskToSave.progress?.total || 0,
        status: taskToSave.status
      });

      result.imported++;
    } catch (error) {
      result.errors.push(`任务 "${taskData.bookName || taskData.bookInfo?.bookName || '未知书籍'}": ${error.message}`);
      log('error', '导入任务失败', { error: error.message, taskId: taskData.taskId || taskData.id });
    }
  }

  return result;
}

/**
 * 导入书籍缓存数据
 * @param {Array} books - 书籍数据数组
 * @param {string} mergeStrategy - 合并策略
 * @returns {Object} 导入结果
 */
async function importBookCache(books, mergeStrategy) {
  const result = { imported: 0, skipped: 0, errors: [] };

  // 如果是覆盖策略，先清空所有现有书籍缓存
  if (mergeStrategy === 'replace') {
    log('info', '覆盖模式：清空现有书籍缓存数据');
    const existingBooks = await bookCacheService.getCachedBooks();
    for (const book of existingBooks) {
      await bookCacheService.deleteBookCache(book.bookUrl || book.sourceUrl);
    }
  }

  for (const bookData of books) {
    try {
      // 检查是否已存在相同ID的书籍
      const existingBooks = await bookCacheService.getCachedBooks();
      const exists = existingBooks.some(b => b.bookId === bookData.bookId);

      if (exists) {
        if (mergeStrategy === 'replace') {
          // 覆盖模式：删除旧的（上面已经清空了，这里再检查一次以防万一）
          await bookCacheService.deleteBookCache(bookData.sourceUrl || bookData.bookUrl);
        } else {
          // 合并模式：跳过已存在的
          result.skipped++;
          continue;
        }
      }

      // 添加书籍缓存
      await bookCacheService.addBookToIndex({
        bookId: bookData.bookId,
        name: bookData.name || bookData.bookName,
        author: bookData.author,
        totalChapters: bookData.totalChapters,
        cachedChapters: bookData.cachedChapters || 0,
        coverUrl: bookData.coverUrl,
        intro: bookData.intro,
        lastChapterTitle: bookData.lastChapterTitle,
        lastUpdateTime: bookData.lastUpdateTime,
        bookUrl: bookData.bookUrl || bookData.sourceUrl
      });

      result.imported++;
    } catch (error) {
      result.errors.push(`书籍 "${bookData.name || bookData.bookName || '未知'}": ${error.message}`);
    }
  }

  return result;
}

/**
 * 导入音频文件
 * @param {string} sourceDir - 音频文件源目录
 * @param {string} mergeStrategy - 合并策略
 * @returns {Object} 导入结果
 */
async function importAudioFiles(sourceDir, mergeStrategy) {
  const result = { imported: 0, skipped: 0, errors: [] };

  try {
    // 导入预制书音频文件
    const prefetchSourceDir = path.join(sourceDir, 'prefetch');
    try {
      await fs.access(prefetchSourceDir);
      const prefetchDir = getDataPath('prefetch');
      const prefetchTargetDir = path.join(prefetchDir, 'books');

      // 替换策略：先清空目标目录
      if (mergeStrategy === 'replace') {
        log('info', '替换模式：清空现有预制书音频文件');
        try {
          await fs.rm(prefetchTargetDir, { recursive: true, force: true });
          log('info', '已清空现有预制书音频文件');
        } catch (e) {
          // 目录可能不存在，忽略错误
        }
      }

      await fs.mkdir(prefetchTargetDir, { recursive: true });
      await copyDirectory(prefetchSourceDir, prefetchTargetDir, mergeStrategy, result);
      log('info', '预制书音频文件导入完成');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        result.errors.push(`预制书音频文件导入失败: ${error.message}`);
      }
    }

    // 导入阅读TTS书籍缓存（章节内容）
    const bookCacheSourceDir = path.join(sourceDir, 'book-cache');
    try {
      await fs.access(bookCacheSourceDir);
      const bookCacheDir = getDataPath('book-cache');
      const bookCacheTargetDir = path.join(bookCacheDir, 'books');

      // 替换策略：先清空目标目录
      if (mergeStrategy === 'replace') {
        log('info', '替换模式：清空现有阅读TTS书籍缓存');
        try {
          await fs.rm(bookCacheTargetDir, { recursive: true, force: true });
          log('info', '已清空现有阅读TTS书籍缓存');
        } catch (e) {
          // 目录可能不存在，忽略错误
        }
      }

      await fs.mkdir(bookCacheTargetDir, { recursive: true });
      await copyDirectory(bookCacheSourceDir, bookCacheTargetDir, mergeStrategy, result);
      log('info', '阅读TTS书籍缓存导入完成');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        result.errors.push(`阅读TTS书籍缓存导入失败: ${error.message}`);
      }
    }

    // 导入封面缓存
    const coversSourceDir = path.join(sourceDir, 'covers');
    try {
      await fs.access(coversSourceDir);
      const bookCacheDir = getDataPath('book-cache');
      const coversTargetDir = path.join(bookCacheDir, 'covers');

      // 替换策略：先清空目标目录
      if (mergeStrategy === 'replace') {
        log('info', '替换模式：清空现有封面缓存');
        try {
          await fs.rm(coversTargetDir, { recursive: true, force: true });
          log('info', '已清空现有封面缓存');
        } catch (e) {
          // 目录可能不存在，忽略错误
        }
      }

      await fs.mkdir(coversTargetDir, { recursive: true });
      await copyDirectory(coversSourceDir, coversTargetDir, mergeStrategy, result);
      log('info', '封面缓存导入完成');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        result.errors.push(`封面缓存导入失败: ${error.message}`);
      }
    }
  } catch (error) {
    result.errors.push(`音频文件导入失败: ${error.message}`);
  }

  return result;
}

/**
 * 递归复制目录
 * @param {string} src - 源目录
 * @param {string} dest - 目标目录
 * @param {string} mergeStrategy - 合并策略
 * @param {Object} result - 结果对象
 */
async function copyDirectory(src, dest, mergeStrategy, result) {
  log('info', `复制目录: ${src} -> ${dest}`);
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  log('info', `源目录包含 ${entries.length} 个条目`);

  // 音频文件扩展名
  const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma'];

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath, mergeStrategy, result);
    } else {
      try {
        // 检查目标文件是否已存在
        let fileExists = false;
        try {
          await fs.access(destPath);
          fileExists = true;
        } catch {
          // 文件不存在
          fileExists = false;
        }

        // 如果是合并模式且文件已存在，则跳过
        if (fileExists && mergeStrategy === 'merge') {
          result.skipped++;
          log('debug', `文件已存在，跳过: ${entry.name}`);
          continue;
        }

        await fs.copyFile(srcPath, destPath);

        // 只统计音频文件
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.includes(ext)) {
          result.imported++;
          log('debug', `已复制音频文件: ${entry.name}`);
        } else {
          log('debug', `已复制文件: ${entry.name}`);
        }
      } catch (error) {
        result.errors.push(`文件 "${entry.name}": ${error.message}`);
        log('error', `复制文件失败: ${entry.name}`, { error: error.message });
      }
    }
  }
}

/**
 * 解压ZIP文件（使用 adm-zip，支持大文件）
 * @param {string} zipPath - ZIP文件路径
 * @param {string} extractDir - 解压目标目录
 */
async function extractZip(zipPath, extractDir) {
  try {
    log('info', `开始解压文件: ${zipPath}`);

    // 使用 adm-zip 解压
    const zip = new AdmZip(zipPath);

    // 解压所有条目
    zip.extractAllTo(extractDir, true);

    log('info', 'ZIP文件解压完成');
  } catch (error) {
    log('error', `解压失败: ${error.message}`);
    throw new Error(`解压失败: ${error.message}`);
  }
}

export default router;
