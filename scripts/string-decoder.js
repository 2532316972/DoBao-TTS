/**
 * 字符串数组解码器
 * 用于解码 javascript-obfuscator 混淆的字符串
 */

import fs from 'fs';

/**
 * Base64 解码（自定义实现，匹配 obfuscator 的编码方式）
 */
function decodeBase64Custom(encoded) {
  const base64Chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  let output = '';
  let chr1, chr2, chr3;
  let enc1, enc2, enc3, enc4;
  let i = 0;
  
  // 移除所有非 base64 字符
  const input = encoded.replace(/[^a-zA-Z0-9+/=]/g, '');
  
  while (i < input.length) {
    enc1 = base64Chars.indexOf(input.charAt(i++));
    enc2 = base64Chars.indexOf(input.charAt(i++));
    enc3 = base64Chars.indexOf(input.charAt(i++));
    enc4 = base64Chars.indexOf(input.charAt(i++));
    
    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;
    
    output += String.fromCharCode(chr1);
    if (enc3 !== 64) output += String.fromCharCode(chr2);
    if (enc4 !== 64) output += String.fromCharCode(chr3);
  }
  
  // URL 解码
  try {
    return decodeURIComponent(escape(output));
  } catch (e) {
    return output;
  }
}

/**
 * 从代码中提取字符串数组
 */
function extractStringArray(code) {
  // 查找函数 _0x313f 中的数组定义
  const funcMatch = code.match(/function\s+_0x[\w]+\(\)\s*\{\s*const\s+_0x[\w]+\s*=\s*(\[[^\]]+\]);/);
  
  if (!funcMatch) {
    console.log('❌ 未找到字符串数组');
    return null;
  }
  
  try {
    // 安全地解析数组
    const arrayStr = funcMatch[1];
    // 使用 Function 构造器安全解析
    const array = new Function('return ' + arrayStr)();
    console.log(`✅ 提取到 ${array.length} 个字符串`);
    return array;
  } catch (error) {
    console.log('❌ 解析失败:', error.message);
    return null;
  }
}

/**
 * 解码字符串数组中的所有字符串
 */
function decodeStringArray(array) {
  const decoded = [];
  
  for (let i = 0; i < array.length; i++) {
    const str = array[i];
    try {
      // 尝试 base64 解码
      const decodedStr = decodeBase64Custom(str);
      decoded.push({
        index: i,
        original: str,
        decoded: decodedStr,
        isBase64: decodedStr !== str
      });
    } catch (e) {
      decoded.push({
        index: i,
        original: str,
        decoded: str,
        isBase64: false
      });
    }
  }
  
  return decoded;
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('用法: node string-decoder.js <混淆后的JS文件>');
    process.exit(1);
  }
  
  const inputFile = args[0];
  
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ 文件不存在: ${inputFile}`);
    process.exit(1);
  }
  
  console.log('========================================');
  console.log('字符串数组解码器');
  console.log('========================================\n');
  
  const code = fs.readFileSync(inputFile, 'utf-8');
  
  // 提取字符串数组
  const stringArray = extractStringArray(code);
  
  if (!stringArray) {
    process.exit(1);
  }
  
  // 解码所有字符串
  console.log('\n=== 解码结果（前30个）===');
  const decoded = decodeStringArray(stringArray);
  
  let decodedCount = 0;
  for (let i = 0; i < Math.min(30, decoded.length); i++) {
    const item = decoded[i];
    if (item.isBase64) {
      console.log(`[${i}] ${item.original.substring(0, 40)}...`);
      console.log(`    → ${item.decoded}`);
      decodedCount++;
    } else {
      console.log(`[${i}] ${item.original}`);
    }
  }
  
  console.log(`\n总计: ${decoded.length} 个字符串`);
  console.log(`成功解码: ${decodedCount} 个`);
  
  // 保存完整解码结果
  const outputFile = inputFile.replace('.js', '-strings.json');
  fs.writeFileSync(outputFile, JSON.stringify(decoded, null, 2));
  console.log(`\n✅ 完整结果已保存: ${outputFile}`);
}

main();
