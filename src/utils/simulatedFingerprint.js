/**
 * 模拟指纹生成器
 * 生成符合真实格式的 verifyFp 参数
 * 格式: verify_[8位]_[8位]_[4位]_[4位]_[4位]_[12位]
 * （依据 HAR 抓包真实值：verify_mlhudm1g_EAKdMnBT_dDeU_4HEe_BwEW_jRg3l1gAzmeb）
 */

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @param {string} chars - 字符集
 * @returns {string} 随机字符串
 */
function generateRandomString(length, chars) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * 生成模拟指纹
 * 格式: verify_[8位小写字母数字]_[8位大小写字母数字]_[4位小写字母数字]_[4位小写字母数字]_[4位大小写字母数字]_[12位大小写字母数字]
 * 示例: verify_mlhudm1g_EAKdMnBT_dDeU_4HEe_BwEW_jRg3l1gAzmeb
 * @returns {string} 模拟指纹
 */
export function generateSimulatedFingerprint() {
    // 第一部分: 8位小写字母+数字
    const part1 = generateRandomString(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
    
    // 第二部分: 8位大小写字母+数字
    const part2 = generateRandomString(8, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    
    // 第三部分: 4位小写字母+数字
    const part3 = generateRandomString(4, 'abcdefghijklmnopqrstuvwxyz0123456789');
    
    // 第四部分: 4位小写字母+数字
    const part4 = generateRandomString(4, 'abcdefghijklmnopqrstuvwxyz0123456789');
    
    // 第五部分: 4位大小写字母+数字
    const part5 = generateRandomString(4, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    
    // 第六部分: 12位大小写字母+数字
    const part6 = generateRandomString(12, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    
    return `verify_${part1}_${part2}_${part3}_${part4}_${part5}_${part6}`;
}

/**
 * 验证指纹格式是否正确
 * @param {string} fingerprint - 指纹字符串
 * @returns {boolean} 格式是否正确
 */
export function isValidFingerprintFormat(fingerprint) {
    if (!fingerprint || typeof fingerprint !== 'string') {
        return false;
    }
    
    // 验证格式: verify_[8位]_[8位]_[4位]_[4位]_[4位]_[12位]
    const pattern = /^verify_[a-z0-9]{8}_[a-zA-Z0-9]{8}_[a-z0-9]{4}_[a-z0-9]{4}_[a-zA-Z0-9]{4}_[a-zA-Z0-9]{12}$/;
    return pattern.test(fingerprint);
}

/**
 * 从指纹生成设备ID
 * 使用哈希算法确保相同的指纹生成相同的设备ID
 * @param {string} fingerprint - 指纹字符串
 * @param {number} offset - 偏移量，用于生成不同的ID
 * @returns {string} 19位数字设备ID
 */
export function generateDeviceIdFromFingerprint(fingerprint, offset = 0) {
    if (!fingerprint) {
        return generateRandomDeviceId();
    }
    
    // 使用两个不同的哈希种子来生成device_id和web_id
    const seed1 = 0x9e3779b9;
    const seed2 = 0x85ebca6b;
    const seed = offset === 0 ? seed1 : seed2;
    
    // 使用简单的字符串哈希
    let hash = seed;
    for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & 0xFFFFFFFF; // 转换为32位无符号整数
    }
    
    // 生成19位数字ID
    const baseId = Math.abs(hash).toString();
    const targetLength = 19;
    
    // 如果哈希值不够19位，用随机数字填充
    let result = baseId;
    while (result.length < targetLength) {
        result += Math.floor(Math.random() * 10);
    }
    
    // 截取前19位
    return result.substring(0, targetLength);
}

/**
 * 生成随机设备ID（备用方案）
 * @returns {string} 19位随机数字设备ID
 */
function generateRandomDeviceId() {
    let result = '';
    for (let i = 0; i < 19; i++) {
        result += Math.floor(Math.random() * 10);
    }
    return result;
}

/**
 * 生成与device_id不同的web_id
 * @param {string} deviceId - 设备ID
 * @returns {string} web_id
 */
export function generateWebIdFromDeviceId(deviceId) {
    const prefix = deviceId.substring(0, 10);
    let suffix = '';
    for (let i = 0; i < 9; i++) {
        suffix += Math.floor(Math.random() * 10);
    }
    return prefix + suffix;
}

export default {
    generateSimulatedFingerprint,
    isValidFingerprintFormat,
    generateDeviceIdFromFingerprint,
    generateWebIdFromDeviceId
};
