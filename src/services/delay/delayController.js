import { log, logError } from '../../utils/logger.js'

/**
 * 延迟策略接口
 */
export class DelayStrategy {
  /**
   * 计算延迟时间
   * @param {Object} context - 延迟上下文
   * @returns {number} 延迟时间（毫秒）
   */
  calculateDelay(context) {
    throw new Error('子类必须实现此方法')
  }
}

/**
 * 固定延迟策略
 */
export class FixedDelayStrategy extends DelayStrategy {
  constructor(delayMs) {
    super()
    this.delayMs = delayMs
  }

  calculateDelay(context) {
    return this.delayMs
  }
}

/**
 * 随机抖动延迟策略
 */
export class JitterDelayStrategy extends DelayStrategy {
  constructor(baseDelayMs, jitterMin = 0.8, jitterMax = 1.3) {
    super()
    this.baseDelayMs = baseDelayMs
    this.jitterMin = jitterMin
    this.jitterMax = jitterMax
  }

  calculateDelay(context) {
    const jitterFactor = this.jitterMin + (Math.random() * (this.jitterMax - this.jitterMin))
    return Math.round(this.baseDelayMs * jitterFactor)
  }
}

/**
 * 指数退避延迟策略
 */
export class ExponentialBackoffStrategy extends DelayStrategy {
  constructor(baseDelayMs, maxRetries) {
    super()
    this.baseDelayMs = baseDelayMs
    this.maxRetries = maxRetries
  }

  calculateDelay(context) {
    const retryCount = context.retryCount || 0
    const delayMs = this.baseDelayMs * Math.pow(2, retryCount)
    return Math.min(delayMs, this.baseDelayMs * Math.pow(2, this.maxRetries))
  }
}

/**
 * 延迟控制器
 */
export class DelayController {
  constructor(options = {}) {
    this.lastRequestTime = 0
    this.delayEndTime = 0

    // 延迟策略
    this.intervalDelayStrategy = new JitterDelayStrategy(
      (options.requestIntervalDelay || 0) * 1000,
      0.8,
      1.3
    )

    this.roundDelayStrategy = new JitterDelayStrategy(
      (options.requestDelay || 10) * 1000,
      1.0,
      1.3
    )

    this.retryDelayStrategy = new ExponentialBackoffStrategy(10000, 3)
  }

  /**
   * 更新延迟配置
   * @param {Object} config - 延迟配置
   */
  updateConfig(config) {
    if (config.requestIntervalDelay !== undefined) {
      this.intervalDelayStrategy = new JitterDelayStrategy(
        config.requestIntervalDelay * 1000,
        0.8,
        1.3
      )
    }

    if (config.requestDelay !== undefined) {
      this.roundDelayStrategy = new JitterDelayStrategy(
        config.requestDelay * 1000,
        1.0,
        1.3
      )
    }
  }

  /**
   * 应用请求间隔延迟
   * @param {Object} context - 延迟上下文
   * @returns {Promise<void>}
   */
  async applyIntervalDelay(context = {}) {
    if (this.lastRequestTime === 0) {
      return
    }

    const delayMs = this.intervalDelayStrategy.calculateDelay(context)

    if (delayMs > 0) {
      log('info', `请求间隔延迟：等待${delayMs}ms`, {
        baseDelayMs: this.intervalDelayStrategy.baseDelayMs,
        delayMs
      })

      await this.sleep(delayMs)
      log('info', '请求间隔延迟结束')
    }
  }

  /**
   * 应用轮询完成延迟
   * @param {Object} context - 延迟上下文
   * @returns {Promise<void>}
   */
  async applyRoundDelay(context = {}) {
    const delayMs = this.roundDelayStrategy.calculateDelay(context)

    this.delayEndTime = Date.now() + delayMs

    log('info', `所有Cookie已轮询一遍，等待${delayMs}ms后开始下一轮请求`, {
      baseDelayMs: this.roundDelayStrategy.baseDelayMs,
      delayMs,
      delayEndTime: this.delayEndTime
    })

    await this.sleep(delayMs)
    this.delayEndTime = 0

    log('info', '延迟等待结束，开始新的请求')
  }

  /**
   * 应用重试延迟
   * @param {Object} context - 延迟上下文
   * @returns {Promise<void>}
   */
  async applyRetryDelay(context = {}) {
    const delayMs = this.retryDelayStrategy.calculateDelay(context)

    log('info', `等待${delayMs}ms后重试...`, {
      retryCount: context.retryCount || 0
    })

    await this.sleep(delayMs)
  }

  /**
   * 检查并恢复延迟计时
   * @returns {Promise<void>}
   */
  async resumeDelay() {
    if (this.delayEndTime > 0) {
      const now = Date.now()
      if (now < this.delayEndTime) {
        const remainingMs = this.delayEndTime - now
        log('info', `延迟计时仍在运行，继续等待${remainingMs}ms`)
        await this.sleep(remainingMs)
        log('info', '延迟等待完成')
      } else {
        log('info', '延迟计时已结束')
      }
      this.delayEndTime = 0
    }
  }

  /**
   * 更新最后请求时间
   */
  updateLastRequestTime() {
    this.lastRequestTime = Date.now()
  }

  /**
   * 睡眠指定时间
   * @param {number} ms - 毫秒数
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
