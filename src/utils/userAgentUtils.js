/**
 * User-Agent随机生成工具
 * 提供多种真实的浏览器User-Agent，降低被检测为机器人的风险
 */

const CHROME_WINDOWS_UA_TEMPLATES = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36 Edg/{version}.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36 OP/{version}.0.0.0'
]

const CHROME_VERSION_RANGE = { min: 120, max: 144 }

const EDGE_VERSION_RANGE = { min: 120, max: 144 }

const OPERA_VERSION_RANGE = { min: 100, max: 110 }

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * 生成随机的Chrome版本号
 * @returns {string} 随机版本号
 */
function generateChromeVersion() {
  return String(randomInt(CHROME_VERSION_RANGE.min, CHROME_VERSION_RANGE.max))
}

/**
 * 生成随机的Edge版本号
 * @returns {string} 随机版本号
 */
function generateEdgeVersion() {
  return String(randomInt(EDGE_VERSION_RANGE.min, EDGE_VERSION_RANGE.max))
}

/**
 * 生成随机的Opera版本号
 * @returns {string} 随机版本号
 */
function generateOperaVersion() {
  return String(randomInt(OPERA_VERSION_RANGE.min, OPERA_VERSION_RANGE.max))
}

/**
 * 随机选择浏览器类型
 * 权重：Chrome 70%, Edge 20%, Opera 10%
 * @returns {string} 浏览器类型
 */
function randomBrowserType() {
  const rand = Math.random()
  if (rand < 0.7) return 'chrome'
  if (rand < 0.9) return 'edge'
  return 'opera'
}

/**
 * 生成随机的Windows User-Agent
 * @param {boolean} useEdgeAsDefault - 是否使用Edge作为默认（保持与原有逻辑一致）
 * @returns {string} 随机User-Agent字符串
 */
export function generateRandomUserAgent(useEdgeAsDefault = true) {
  if (useEdgeAsDefault) {
    const edgeVersion = generateEdgeVersion()
    const template = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chromeVersion}.0.0.0 Safari/537.36 Edg/{edgeVersion}.0.0.0'
    return template
      .replace('{chromeVersion}', generateChromeVersion())
      .replace('{edgeVersion}', edgeVersion)
  }

  const browserType = randomBrowserType()
  let template
  let version

  switch (browserType) {
    case 'chrome':
      template = randomElement(CHROME_WINDOWS_UA_TEMPLATES.filter(t => !t.includes('Edg')))
      version = generateChromeVersion()
      break
    case 'edge':
      template = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chromeVersion}.0.0.0 Safari/537.36 Edg/{edgeVersion}.0.0.0'
      version = {
        chrome: generateChromeVersion(),
        edge: generateEdgeVersion()
      }
      break
    case 'opera':
      template = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chromeVersion}.0.0.0 Safari/537.36 OP/{operaVersion}.0.0.0'
      version = {
        chrome: generateChromeVersion(),
        opera: generateOperaVersion()
      }
      break
  }

  let ua = template
  if (typeof version === 'string') {
    ua = ua.replace('{version}', version)
  } else {
    Object.entries(version).forEach(([key, val]) => {
      ua = ua.replace(`{${key}}`, val)
    })
  }

  return ua
}

/**
 * 生成随机User-Agent的快捷函数（每次调用生成不同的UA）
 * @returns {string} 随机User-Agent
 */
export function getRandomUserAgent() {
  return generateRandomUserAgent(false)
}

/**
 * 获取固定但真实的Edge浏览器User-Agent
 * 保持与原有逻辑一致，避免行为变化太大
 * @returns {string} Edge User-Agent
 */
export function getFixedEdgeUserAgent() {
  return generateRandomUserAgent(true)
}

let cachedUserAgent = null

/**
 * 获取缓存的随机User-Agent
 * 在同一会话中保持一致，避免同一请求中UA变化
 * @returns {string} User-Agent
 */
export function getCachedUserAgent() {
  if (!cachedUserAgent) {
    cachedUserAgent = generateRandomUserAgent(false)
  }
  return cachedUserAgent
}

/**
 * 清除缓存的User-Agent
 * 用于需要生成新的随机UA时调用
 */
export function clearCachedUserAgent() {
  cachedUserAgent = null
}

export default {
  generateRandomUserAgent,
  getRandomUserAgent,
  getFixedEdgeUserAgent,
  getCachedUserAgent,
  clearCachedUserAgent
}
