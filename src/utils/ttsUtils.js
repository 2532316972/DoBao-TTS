import fs from 'fs'
import path from 'path'
import { getConfigPath } from './pathUtils.js'
import { deviceParamsManager } from '../services/deviceParamsManager.js'

let cachedConfig = null
let cacheTimestamp = null
const CACHE_TTL = 60000 // 1分钟缓存有效期

/**
 * 加载TTS配置
 * @returns {Object} TTS配置对象
 */
export function loadTtsConfig() {
  // 检查缓存是否有效
  if (cachedConfig && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return cachedConfig
  }

  const cfgPath = getConfigPath('tts.json')
  const raw = fs.readFileSync(cfgPath, 'utf-8')
  cachedConfig = JSON.parse(raw)
  cacheTimestamp = Date.now()
  return cachedConfig
}

/**
 * 生成标准UUID格式
 * @returns {string} UUID字符串
 */
function generateUuid() {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`
}

// web_tab_id 会话级缓存：真实浏览器中该值在单个标签页生命周期内保持不变，
// 每个请求重新生成会暴露非真实行为特征
let cachedWebTabId = null

/**
 * 获取web_tab_id（会话级缓存）
 * @returns {string} web_tab_id
 */
function getWebTabId() {
  if (!cachedWebTabId) {
    cachedWebTabId = generateUuid()
  }
  return cachedWebTabId
}

/**
 * 构建WebSocket URL
 * 根据HAR文件分析，TTS WebSocket请求不需要 fp、msToken 和 a_bogus 参数
 * 这些参数只用于 /chat/completion 接口
 * 参数顺序按照HAR文件中的顺序排列
 * @param {Object} opts - 选项
 * @param {string} opts.speaker - 发音人ID
 * @param {number} [opts.speech_rate=0] - 语速
 * @param {number} [opts.pitch=0] - 音调
 * @param {string} [opts.cookieId] - Cookie ID，用于获取设备参数
 * @param {Object} opts.deviceParams - 设备参数 {deviceId, webId}（可选，优先使用）
 * @param {Object} cfg - TTS配置对象（可选，如果不提供会自动加载）
 * @returns {Promise<string>} WebSocket URL
 */
export async function buildWsUrl(opts, cfg = null) {
  const config = cfg || loadTtsConfig()

  let deviceId, webId

  // 如果提供了设备参数，直接使用
  if (opts.deviceParams && opts.deviceParams.deviceId && opts.deviceParams.webId) {
    deviceId = opts.deviceParams.deviceId
    webId = opts.deviceParams.webId
  } else if (opts.cookieId) {
    // 使用设备参数管理器获取参数
    const params = await deviceParamsManager.getOrCreateParams(opts.cookieId)
    deviceId = params.deviceId
    webId = params.webId
  } else {
    throw new Error('必须提供 cookieId 或 deviceParams')
  }

  // 按照HAR文件中的参数顺序构建URL
  const params = new URLSearchParams()
  params.append('speaker', opts.speaker)
  params.append('format', 'aac')
  params.append('speech_rate', String(opts.speech_rate ?? 0))
  params.append('pitch', String(opts.pitch ?? 0))
  params.append('version_code', '20800')
  params.append('language', config.language)
  params.append('device_platform', config.device_platform)
  params.append('aid', String(config.aid))
  params.append('real_aid', String(config.aid))
  params.append('pkg_type', config.pkg_type)
  params.append('device_id', deviceId)
  params.append('pc_version', config.pc_version)
  params.append('web_id', webId)
  params.append('tea_uuid', webId)
  params.append('region', config.region)
  params.append('sys_region', config.sys_region)
  params.append('samantha_web', '1')
  params.append('use-olympus-account', String(config.use_olympus_account))
  params.append('web_tab_id', getWebTabId())

  return `wss://ws-samantha.doubao.com/samantha/audio/tts?${params.toString()}`
}

/**
 * 清除TTS配置缓存
 * 用于配置更新后重新加载
 */
export function clearTtsConfigCache() {
  cachedConfig = null
  cacheTimestamp = null
}
