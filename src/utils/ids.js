/**
 * 生成类似豆包真实请求的设备ID
 * 真实设备ID格式：7500921500733998644（19位，以750092开头）
 * @returns {string} 19位设备ID字符串
 */
function generateDeviceId() {
  // 使用固定前缀 + 随机后缀，模拟真实设备ID
  const prefix = '750092'
  let suffix = ''
  for (let i = 0; i < 13; i++) {
    suffix += Math.floor(Math.random() * 10)
  }
  return prefix + suffix
}

/**
 * 生成web_id（与device_id格式相同）
 * @returns {string} 19位web_id字符串
 */
function generateWebId() {
  return generateDeviceId()
}

let cached = null

export function getIds() {
  if (cached) return cached
  // 使用类似真实豆包请求的设备ID生成规则
  const webId = generateWebId()
  cached = {
    web_id: webId,
    tea_uuid: webId,
    device_id: generateDeviceId()
  }
  return cached
}

/**
 * 生成随机UUID
 * @returns {string} UUID字符串
 */
export function generateUuid() {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`
}
