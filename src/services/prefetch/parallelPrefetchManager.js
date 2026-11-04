import fs from 'fs/promises'
import path from 'path'
import { log, logError } from '../../utils/logger.js'
import { ttsService } from '../ttsService.js'
import { deviceParamsManager } from '../deviceParamsManager.js'

/**
 * 并行预制书处理管理器
 *
 * 设计原则：
 * 1. 使用所有可用Cookie并行处理
 * 2. 每个Cookie使用自己的固定请求参数（创建后不变，直到Cookie失效）
 * 3. 添加随机抖动避免规律性请求
 * 4. 完全替代原有串行处理机制
 * 5. 此逻辑只用于预制书模式，不干扰实时模式
 * 6. 使用统一的设备参数管理器
 *
 * 工作流程：
 * 1. 获取所有可用Cookie并为每个获取/创建设备参数
 * 2. 将所有待处理段落放入全局队列
 * 3. 每个Cookie从队列中取出1-10句进行处理
 * 4. 处理完成后进入延迟
 * 5. 延迟结束后，如果队列还有段落，继续取出1-10句处理
 * 6. 循环直到所有段落处理完毕
 */
class ParallelPrefetchManager {
  constructor() {
    // 配置参数
    this.config = {
      maxSegmentsPerCookie: 10,    // 每个Cookie最大处理段落数（随机1-10句）
      enableJitter: true,          // 是否启用随机抖动
      jitterRange: { min: 0.8, max: 1.3 }, // 抖动范围 0.8-1.3倍
      maxStartupDelay: 500         // 最大启动延迟（毫秒）
    }
    this.taskStopFlag = false
    this.cancelMode = false       // 快速取消模式标志
    this.abortController = null   // AbortController 用于取消 TTS 请求
    this.processingSegments = new Set() // 正在处理的段落集合，防止重复处理
    this.processingLock = { locked: false } // 处理集合的锁
  }

  /**
   * 计算带抖动的延迟
   */
  calculateJitteredDelay(baseDelayMs) {
    if (!this.config.enableJitter || baseDelayMs <= 0) {
      return baseDelayMs
    }

    const { min, max } = this.config.jitterRange
    const jitterFactor = min + (Math.random() * (max - min))
    return Math.round(baseDelayMs * jitterFactor)
  }

  /**
   * 获取锁（自旋锁实现）
   * @param {Object} lock - 锁对象 { locked: boolean }
   */
  async acquireLock(lock) {
    while (true) {
      while (lock.locked) {
        await new Promise(resolve => setTimeout(resolve, 1))
      }
      // 再次检查，防止竞争条件
      if (!lock.locked) {
        lock.locked = true
        return
      }
    }
  }

  /**
   * 使用指定Cookie处理一批段落
   *
   * 注意：批次内的句子之间无延迟，只有批次之间有延迟
   *
   * @param {Object} cookie - Cookie对象
   * @param {Object} deviceParams - 固定的设备参数 {deviceId, webId}
   * @param {Array} segments - 段落数组 [{index, text, segmentId}]
   * @param {string} voiceId - 发音人ID
   * @param {string} taskId - 任务ID
   * @param {string} audioDir - 音频输出目录
   * @param {number} startupDelay - 启动延迟（毫秒）
   */
  async processBatch(cookie, segments, voiceId, taskId, audioDir, startupDelay) {
    const results = []

    // 应用启动延迟（随机抖动，避免同时发起请求）
    if (startupDelay > 0) {
      log('debug', `Cookie ${cookie.name} 启动延迟 ${startupDelay}ms`)
      await new Promise(resolve => setTimeout(resolve, startupDelay))
    }

    // 获取最新的设备参数（不缓存，每次从manager获取）
    let deviceParams = await deviceParamsManager.getOrCreateParams(cookie.id)

    // 预先检查并过滤掉已存在的音频文件，同时检查是否正在被其他Cookie处理
    const segmentsToProcess = []
    for (const segment of segments) {
      const targetPath = path.join(audioDir, `${segment.segmentId}.mp3`)
      
      // 首先检查文件是否已存在
      try {
        const stats = await fs.stat(targetPath)
        if (stats.size > 0) {
          // 文件已存在，直接记录结果，不加入处理队列
          results.push({
            index: segment.index,
            segmentId: segment.segmentId,
            success: true,
            audioPath: targetPath,
            fileSize: stats.size
          })
          continue
        }
      } catch (error) {
        // 文件不存在，继续检查是否正在被处理
      }
      
      // 检查是否正在被其他Cookie处理（使用锁保护）
      await this.acquireLock(this.processingLock)
      const isProcessing = this.processingSegments.has(segment.segmentId)
      if (!isProcessing) {
        // 标记为正在处理
        this.processingSegments.add(segment.segmentId)
        segmentsToProcess.push(segment)
      } else {
        log('warn', `Cookie ${cookie.name} 跳过正在处理的段落 ${segment.segmentId}`)
      }
      this.processingLock.locked = false
    }

    // 如果全部都已存在或正在处理，直接返回，不进入处理循环
    if (segmentsToProcess.length === 0) {
      log('info', `Cookie ${cookie.name} 所有段落音频已存在或正在处理，跳过处理`, {
        cookieId: cookie.id,
        totalSkipped: segments.length
      })
      return results
    }

    log('info', `Cookie ${cookie.name} 开始处理 ${segmentsToProcess.length} 个段落（已跳过 ${segments.length - segmentsToProcess.length} 个已存在/正在处理的段落）`, {
      cookieId: cookie.id,
      deviceId: deviceParams.deviceId,
      totalSegments: segments.length,
      skipCount: segments.length - segmentsToProcess.length,
      processCount: segmentsToProcess.length
    })

    for (let i = 0; i < segmentsToProcess.length; i++) {
      const segment = segmentsToProcess[i]

      // 检查任务是否已停止
      if (this.taskStopFlag) {
        log('info', `任务已停止，Cookie ${cookie.name} 中断处理`)
        // 清理处理标记
        await this.acquireLock(this.processingLock)
        this.processingSegments.delete(segment.segmentId)
        this.processingLock.locked = false
        break
      }

      // 批次内的句子之间添加6秒延迟（除了第一句），带随机抖动
      if (i > 0) {
        // 计算带抖动的延迟（6秒基础，0.8-1.3倍抖动）
        const baseDelayMs = 6000
        const jitterFactor = 0.8 + (Math.random() * 0.5) // 0.8-1.3倍
        const delayMs = Math.round(baseDelayMs * jitterFactor)

        log('debug', `Cookie ${cookie.name} 段落间延迟 ${delayMs}ms`)

        // 使用可中断的延迟
        const startTime = Date.now()
        while (Date.now() - startTime < delayMs) {
          if (this.taskStopFlag) {
            log('info', `任务已停止，Cookie ${cookie.name} 在延迟中中断`)
            break
          }
          await new Promise(resolve => setTimeout(resolve, 50)) // 每50ms检查一次
        }
        if (this.taskStopFlag) {
          // 清理处理标记
          await this.acquireLock(this.processingLock)
          this.processingSegments.delete(segment.segmentId)
          this.processingLock.locked = false
          break
        }
      }

      const targetPath = path.join(audioDir, `${segment.segmentId}.mp3`)
      
      // 再次检查文件是否已存在（双重检查，防止其他Cookie刚刚完成）
      try {
        const stats = await fs.stat(targetPath)
        if (stats.size > 0) {
          log('info', `Cookie ${cookie.name} 段落 ${segment.segmentId} 已由其他Cookie完成，跳过`)
          results.push({
            index: segment.index,
            segmentId: segment.segmentId,
            success: true,
            audioPath: targetPath,
            fileSize: stats.size
          })
          // 清理处理标记
          await this.acquireLock(this.processingLock)
          this.processingSegments.delete(segment.segmentId)
          this.processingLock.locked = false
          continue
        }
      } catch (error) {
        // 文件不存在，继续处理
      }

      // 检查是否已取消（在TTS调用前）
      if (this.taskStopFlag) {
        log('info', `任务已停止，Cookie ${cookie.name} 中断处理（段落 ${segment.index + 1}）`)
        // 清理处理标记
        await this.acquireLock(this.processingLock)
        this.processingSegments.delete(segment.segmentId)
        this.processingLock.locked = false
        break
      }

      try {
        // 使用此Cookie的固定设备参数调用TTS，传递 abortSignal 以支持取消
        // 所有Cookie共享同一个AbortController，确保取消时能同时中断所有进行中的请求
        const audioResult = await ttsService.generateSpeechWithCookie({
          text: segment.text,
          voiceId,
          rate: 0,
          pitch: 0,
          source: 'prefetch',
          outputPath: targetPath,
          cookieValue: cookie.value,
          cookieId: cookie.id,
          deviceParams,
          requestDelay: 0,
          requestIntervalDelay: 0,
          abortSignal: this.abortController?.signal // 传递取消信号（可能为null）
        })

        results.push({
          index: segment.index,
          segmentId: segment.segmentId,
          success: true,
          audioPath: targetPath,
          fileSize: audioResult.size
        })

        log('debug', `Cookie ${cookie.name} 完成段落 ${segment.index + 1}`, {
          segmentId: segment.segmentId
        })

        // 处理成功，清理处理标记
        await this.acquireLock(this.processingLock)
        this.processingSegments.delete(segment.segmentId)
        this.processingLock.locked = false

      } catch (error) {
        // 如果是取消错误，直接中断整个批次
        if (error.message === '任务已取消') {
          log('info', `Cookie ${cookie.name} 检测到取消信号，中断批次处理`)
          // 清理处理标记
          await this.acquireLock(this.processingLock)
          this.processingSegments.delete(segment.segmentId)
          this.processingLock.locked = false
          break
        }

        // 检查是否是BLOCK错误，如果是则轮换设备参数并重试
        if (error.message === 'BLOCK_ERROR' || error.message?.includes('block')) {
          log('warn', `Cookie ${cookie.name} 遇到BLOCK错误，准备轮换设备参数并重试`, {
            cookieId: cookie.id,
            deviceId: deviceParams.deviceId,
            segmentIndex: segment.index
          })
          
          try {
            // 轮换设备参数
            const newParams = await deviceParamsManager.rotateParams(cookie.id)
            log('info', `Cookie ${cookie.name} 设备参数已轮换，准备重试当前段落`, {
              cookieId: cookie.id,
              oldDeviceId: deviceParams.deviceId,
              newDeviceId: newParams.deviceId,
              segmentIndex: segment.index
            })
            
            // 重新获取最新的设备参数（确保使用新的）
            deviceParams = await deviceParamsManager.getOrCreateParams(cookie.id)
            
            // 重试当前段落（i-- 让循环再次处理同一段落）
            i--
            continue
          } catch (rotateError) {
            logError(rotateError, {
              stage: '预制书模式轮换设备参数',
              cookieId: cookie.id
            })
          }
        }

        logError(error, {
          stage: '并行处理段落',
          cookieId: cookie.id,
          cookieName: cookie.name,
          segmentIndex: segment.index
        })

        results.push({
          index: segment.index,
          segmentId: segment.segmentId,
          success: false,
          error: error.message
        })
        
        // 处理失败，清理处理标记
        await this.acquireLock(this.processingLock)
        this.processingSegments.delete(segment.segmentId)
        this.processingLock.locked = false
      }
    }

    return results
  }

  /**
   * 执行动态并行处理
   *
   * 核心逻辑：
   * - 维护一个全局剩余段落队列
   * - 每个Cookie循环：取1-10句 → 处理 → 延迟 → 检查队列
   * - 所有Cookie真正并行执行
   * - 批次内的句子之间无延迟，只有批次之间有延迟
   *
   * @param {Array<Object>} pendingSegments - 待处理段落数组 [{index, text, segmentId}]
   * @param {Array<Object>} cookies - 可用Cookie数组
   * @param {string} voiceId - 发音人ID
   * @param {string} taskId - 任务ID
   * @param {string} audioDir - 音频输出目录
   * @param {number} requestDelay - 批次完成后的延迟（秒）
   * @returns {Array} 处理结果
   */
  async processDynamic(pendingSegments, cookies, voiceId, taskId, audioDir, requestDelay = 15) {
    if (cookies.length === 0) {
      throw new Error('没有可用的Cookie')
    }

    // 重置停止标志和取消模式，确保可以继续处理
    this.taskStopFlag = false
    this.cancelMode = false

    // 创建新的 AbortController（所有Cookie将共享此实例）
    // 注意：必须在重置标志后创建，确保新的请求使用新的AbortController
    this.abortController = new AbortController()

    // 重置正在处理的段落集合
    await this.acquireLock(this.processingLock)
    this.processingSegments.clear()
    this.processingLock.locked = false

    // 全局剩余段落队列（所有Cookie共享）
    const remainingSegments = [...pendingSegments]
    const allResults = []
    const resultsLock = { locked: false }
    const queueLock = { locked: false } // 用于保护队列操作的锁

    log('info', '开始动态并行处理', {
      totalSegments: pendingSegments.length,
      cookieCount: cookies.length
    })

    // 为每个Cookie获取启动延迟（不缓存设备参数，每次从manager获取最新的）
    const cookieWorkers = cookies.map((cookie, index) => ({
      cookie,
      startupDelay: Math.random() * this.config.maxStartupDelay * (index + 1) / cookies.length // 分散启动
    }))

    // 定义单个Cookie的工作循环
    const cookieWorkLoop = async (worker) => {
      const { cookie, startupDelay } = worker
      const cookieResults = []

      while (true) {
        // 检查停止标志
        if (this.taskStopFlag) {
          log('info', `Cookie ${cookie.name} 收到停止信号，退出工作循环`)
          break
        }

        // 使用锁保护队列操作，防止多个Cookie同时获取同一段落
        // 自旋锁实现，确保原子性
        let acquired = false
        while (!acquired) {
          while (queueLock.locked) {
            await new Promise(resolve => setTimeout(resolve, 1))
          }
          // 再次检查，防止竞争条件
          if (!queueLock.locked) {
            queueLock.locked = true
            acquired = true
          }
        }

        // 从全局队列获取一批段落
        const batchSize = Math.min(
          Math.floor(Math.random() * this.config.maxSegmentsPerCookie) + 1,
          remainingSegments.length
        )

        if (batchSize === 0) {
          queueLock.locked = false
          log('debug', `Cookie ${cookie.name} 没有剩余段落，退出工作循环`)
          break
        }

        const batch = remainingSegments.splice(0, batchSize)
        queueLock.locked = false

        log('info', `Cookie ${cookie.name} 获取 ${batch.length} 句，剩余 ${remainingSegments.length} 句`)

        // 处理这一批
        // 注意：批次内的句子之间无延迟，只有批次之间有延迟
        let batchResults = []
        try {
          batchResults = await this.processBatch(
            cookie,
            batch,
            voiceId,
            taskId,
            audioDir,
            startupDelay // 只有第一次使用启动延迟
          )
        } catch (batchError) {
          // 如果是取消错误，直接退出工作循环
          if (batchError.message === '任务已取消') {
            log('info', `Cookie ${cookie.name} 批次处理被取消`)
            break
          }
          // 其他错误，记录并继续
          logError(batchError, {
            stage: 'processBatch',
            cookieId: cookie.id,
            cookieName: cookie.name
          })
          // 继续处理下一批
          continue
        }

        // 保存结果（需要锁保护，因为多个Cookie同时写入）
        while (resultsLock.locked) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        resultsLock.locked = true
        allResults.push(...batchResults)
        cookieResults.push(...batchResults)
        resultsLock.locked = false

        const successCount = batchResults.filter(r => r.success).length
        log('info', `Cookie ${cookie.name} 完成批次 ${successCount}/${batchResults.length}，剩余全局段落 ${remainingSegments.length}`)

        // 清除启动延迟（只使用一次）
        worker.startupDelay = 0

        // 检查是否应该立即停止（取消模式）
        if (this.shouldStopImmediately()) {
          log('info', `Cookie ${cookie.name} 检测到立即取消信号，跳过延迟`)
          break
        }

        // 如果还有剩余段落，进入延迟后再继续
        if (remainingSegments.length > 0 && requestDelay > 0 && !this.taskStopFlag) {
          const jitteredDelay = this.calculateJitteredDelay(requestDelay * 1000)
          log('info', `Cookie ${cookie.name} 进入批次延迟 ${jitteredDelay}ms`)
          
          // 使用可中断的延迟
          const startTime = Date.now()
          while (Date.now() - startTime < jitteredDelay) {
            if (this.taskStopFlag) {
              log('info', `任务已停止，Cookie ${cookie.name} 在批次延迟中中断`)
              break
            }
            await new Promise(resolve => setTimeout(resolve, 100)) // 每100ms检查一次
          }
        }

        // 再次检查停止标志
        if (this.taskStopFlag) {
          break
        }
      }

      log('info', `Cookie ${cookie.name} 工作循环结束，共处理 ${cookieResults.length} 句`, {
        success: cookieResults.filter(r => r.success).length,
        failed: cookieResults.filter(r => !r.success).length
      })

      return cookieResults
    }

    // 启动所有Cookie的并行工作循环
    const workerPromises = cookieWorkers.map(worker => cookieWorkLoop(worker))

    // 等待所有Cookie完成
    await Promise.allSettled(workerPromises)

    log('info', '动态并行处理完成', {
      totalResults: allResults.length,
      success: allResults.filter(r => r.success).length,
      failed: allResults.filter(r => !r.success).length
    })

    return allResults
  }

  /**
   * 检查是否应该立即停止
   */
  shouldStopImmediately() {
    return this.cancelMode || this.taskStopFlag
  }

  /**
   * 停止所有处理
   * @param {boolean} immediate - 是否立即取消（跳过批次间延迟，中断TTS请求）
   */
  stop(immediate = false) {
    this.taskStopFlag = true
    
    if (immediate) {
      this.cancelMode = true
      
      // 触发 AbortController 取消正在进行的 TTS 请求
      if (this.abortController) {
        log('info', '触发 AbortController 取消正在进行的 TTS 请求')
        this.abortController.abort()
      }
      
      log('info', '已发送立即停止信号（立即取消模式）')
    } else {
      log('info', '已发送停止信号（正常模式）')
    }
  }

  /**
   * 快速取消（不等待当前批次完成）- 别名方法，与 stop(true) 相同
   */
  cancel() {
    this.stop(true)
  }

  /**
   * 重置停止标志，用于恢复任务
   */
  reset() {
    this.taskStopFlag = false
    this.cancelMode = false
    this.abortController = null
    this.processingSegments.clear()
    log('info', '并行处理管理器已重置')
  }

  /**
   * 合并并行处理结果
   */
  mergeResults(results, allSegments) {
    const indexSegments = new Array(allSegments.length)

    // 初始化所有段落
    for (let i = 0; i < allSegments.length; i++) {
      indexSegments[i] = {
        segmentId: `seg_${String(i + 1).padStart(3, '0')}`,
        text: allSegments[i],
        audioFile: null,
        fileSize: 0,
        generatedAt: null,
        error: null
      }
    }

    // 填充处理结果
    for (const result of results) {
      if (result.success) {
        indexSegments[result.index] = {
          segmentId: result.segmentId,
          text: allSegments[result.index],
          audioFile: `audio/${result.segmentId}.mp3`,
          fileSize: result.fileSize,
          generatedAt: new Date().toISOString(),
          error: null
        }
      } else {
        indexSegments[result.index].error = result.error
      }
    }

    const completedCount = indexSegments.filter(s => s.audioFile).length
    const failedCount = indexSegments.length - completedCount

    return {
      segments: indexSegments,
      summary: {
        total: allSegments.length,
        completed: completedCount,
        failed: failedCount
      }
    }
  }

  /**
   * 获取失败的段落
   */
  getFailedSegments(results, pendingSegments) {
    const failedSegments = []

    for (const result of results) {
      if (!result.success) {
        const pendingSeg = pendingSegments.find(s => s.index === result.index)
        if (pendingSeg) {
          failedSegments.push({
            index: result.index,
            text: pendingSeg.text,
            segmentId: result.segmentId,
            error: result.error
          })
        }
      }
    }

    return failedSegments
  }
}

export const parallelPrefetchManager = new ParallelPrefetchManager()
