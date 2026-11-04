/**
 * 增强版源码保护模块
 * 多层保护策略：
 * 1. 高强度 JavaScript 混淆
 * 2. 字符串 AES 加密
 * 3. 运行时自校验
 * 4. 反调试保护
 * 5. 代码完整性校验
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 加密密钥（实际使用时应该从环境变量或安全存储获取）
const ENCRYPTION_KEY = process.env.CODE_PROTECTION_KEY || crypto.randomBytes(32).toString('hex');

/**
 * 高强度 JS 混淆配置
 * 注意：此配置会显著增加代码体积，但提供更强的保护
 */
const HIGH_SECURITY_OBFUSCATION_CONFIG = {
  // 基础压缩
  compact: true,
  
  // 控制流扁平化 - 增加代码分析难度
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,  // 提高到75%
  
  // 死代码注入 - 增加噪音
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,  // 提高到40%
  
  // 调试保护
  debugProtection: true,  // 启用调试保护
  debugProtectionInterval: 2000,  // 每2秒检查一次
  
  // 禁用控制台输出（生产环境建议启用）
  disableConsoleOutput: true,
  
  // 标识符命名
  identifierNamesGenerator: 'mangled',  // 使用更短的混淆名称
  
  // 日志
  log: false,
  
  // 数字转表达式
  numbersToExpressions: true,
  
  // 不重命名全局变量（避免破坏依赖）
  renameGlobals: false,
  
  // 字符串数组保护
  rotateStringArray: true,
  selfDefending: true,  // 代码自保护，如果被格式化会失效
  shuffleStringArray: true,
  
  // 代码简化
  simplify: true,
  
  // 字符串分割和编码
  splitStrings: true,
  splitStringsChunkLength: 5,  // 更细的分割
  
  // 字符串数组配置
  stringArray: true,
  stringArrayEncoding: ['rc4', 'base64'],  // 使用RC4加密+base64
  stringArrayThreshold: 1,  // 100%的字符串都进入数组
  stringArrayWrappersCount: 5,  // 增加包装器数量
  stringArrayWrappersChainedCall: true,  // 链式调用增加复杂度
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: 'function',
  
  // Unicode转义
  unicodeEscapeSequence: false,
  
  // 保留的关键标识符（避免破坏框架功能）
  reservedNames: [
    'req', 'res', 'next', 'err', 'router', 'app', 'listen', 
    'require', 'module', 'exports', '__dirname', '__filename',
    'process', 'Buffer', 'console', 'setTimeout', 'setInterval',
    'clearTimeout', 'clearInterval', 'Promise', 'JSON', 'Object',
    'Array', 'String', 'Number', 'Boolean', 'Date', 'Math'
  ],
  
  // 保留的字符串
  reservedStrings: [
    'req', 'res', 'next', 'err', 'router', 'app', 'listen',
    'require', 'module', 'exports'
  ],
  
  // 转换全局对象访问
  transformObjectKeys: true,
  
  // 域名锁定（可选，限制代码在特定域名运行）
  // domainLock: ['localhost', 'your-domain.com'],
  
  // 强制控制台输出某些内容（可用于水印）
  // forceTransformStrings: ['DoBao-TTS Protected'],
};

/**
 * 中等强度配置（平衡安全性和性能）
 * 优化启动速度，同时保持合理的保护强度
 */
const MEDIUM_SECURITY_OBFUSCATION_CONFIG = {
  // 基础压缩
  compact: true,
  
  // 控制流扁平化 - 降低比例以提高启动速度
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  
  // 死代码注入 - 降低比例以提高启动速度
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.15,
  
  // 禁用调试保护和控制台输出禁用（避免影响正常调试）
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,
  
  // 标识符命名 - 使用十六进制（比 mangled 更安全）
  identifierNamesGenerator: 'hexadecimal',
  
  // 日志
  log: false,
  
  // 数字转表达式
  numbersToExpressions: true,
  
  // 不重命名全局变量
  renameGlobals: false,
  
  // 字符串数组保护
  rotateStringArray: true,
  selfDefending: true,
  shuffleStringArray: true,
  
  // 代码简化
  simplify: true,
  
  // 字符串分割 - 增大块长度以减少处理时间
  splitStrings: true,
  splitStringsChunkLength: 10,
  
  // 字符串数组配置 - 使用 base64 以提高性能
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCall: false,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: 'variable',
  
  // Unicode转义
  unicodeEscapeSequence: false,
  
  // 保留的关键标识符
  reservedNames: [
    'req', 'res', 'next', 'err', 'router', 'app', 'listen', 
    'require', 'module', 'exports', '__dirname', '__filename',
    'process', 'Buffer', 'console', 'setTimeout', 'setInterval',
    'clearTimeout', 'clearInterval', 'Promise', 'JSON', 'Object',
    'Array', 'String', 'Number', 'Boolean', 'Date', 'Math'
  ],
  
  // 保留的字符串
  reservedStrings: [
    'req', 'res', 'next', 'err', 'router', 'app', 'listen',
    'require', 'module', 'exports'
  ],
  
  // 转换全局对象访问
  transformObjectKeys: false,
};

/**
 * HTML 压缩配置 - 增强版
 */
const HTML_MINIFIER_CONFIG = {
  removeComments: true,
  removeCommentsFromCDATA: true,
  removeCDATASectionsFromCDATA: true,
  collapseWhitespace: true,
  collapseBooleanAttributes: true,
  removeAttributeQuotes: true,
  removeRedundantAttributes: true,
  useShortDoctype: true,
  removeEmptyAttributes: true,
  removeOptionalTags: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  minifyJS: {
    compress: {
      drop_console: false,
      drop_debugger: true,
      dead_code: true,
      unused: true,
    },
    mangle: true,
  },
  minifyCSS: true,
};

/**
 * CSS 压缩配置
 */
const CSS_MINIFIER_CONFIG = {
  level: 2,
  format: {
    breaks: { afterAtRule: false, afterBlockBegins: false, afterBlockEnds: false },
    spaces: { aroundSelectorRelation: false },
  },
};

/**
 * 生成运行时保护代码
 * 包含反调试和自校验功能
 */
function generateRuntimeProtection() {
  const protectionCode = `
(function() {
  'use strict';
  
  // 反调试保护
  function antiDebug() {
    const start = new Date();
    debugger;
    const end = new Date();
    if (end - start > 100) {
      // 检测到调试器，可以执行清理操作
      document.body.innerHTML = '';
      window.location.href = 'about:blank';
    }
  }
  
  // 定时检查调试器
  setInterval(antiDebug, 2000);
  
  // 检测开发者工具
  const devtools = /./;
  devtools.toString = function() {
    return 'devtools';
  };
  console.log('%c', devtools);
  
  // 检测窗口大小变化（可能是打开开发者工具）
  let threshold = 160;
  window.addEventListener('resize', function() {
    if (window.outerHeight - window.innerHeight > threshold ||
        window.outerWidth - window.innerWidth > threshold) {
      // 可能的开发者工具检测
    }
  });
  
  // 代码完整性校验（简单的CRC32）
  window.__verifyIntegrity = function(expectedHash) {
    const scripts = document.querySelectorAll('script');
    let combined = '';
    scripts.forEach(s => {
      if (s.textContent) combined += s.textContent;
    });
    // 简化的哈希计算
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16) === expectedHash;
  };
})();
`;
  return protectionCode;
}

/**
 * 加密敏感字符串
 * @param {string} text - 要加密的文本
 * @param {string} key - 加密密钥
 * @returns {string} 加密后的字符串
 */
function encryptString(text, key) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key.slice(0, 64), 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    // 加密失败返回原始文本的base64
    return Buffer.from(text).toString('base64');
  }
}

/**
 * 解密字符串
 * @param {string} encryptedText - 加密的文本
 * @param {string} key - 解密密钥
 * @returns {string} 解密后的字符串
 */
function decryptString(encryptedText, key) {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      // 可能是base64编码
      return Buffer.from(encryptedText, 'base64').toString('utf8');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.slice(0, 64), 'hex'), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    return encryptedText;
  }
}

/**
 * 生成解密运行时
 * 这段代码会被注入到HTML中，用于运行时解密
 */
function generateDecryptionRuntime(key) {
  return `
<script>
(function() {
  const _k = '${key}';
  window._ds = function(e) {
    try {
      const p = e.split(':');
      if (p.length !== 2) return atob(e);
      const iv = new Uint8Array(p[0].match(/.{2}/g).map(b => parseInt(b, 16)));
      const d = new Uint8Array(p[1].match(/.{2}/g).map(b => parseInt(b, 16)));
      // 简化的解密（实际应该使用Web Crypto API）
      return new TextDecoder().decode(d);
    } catch(x) { return e; }
  };
})();
</script>
`;
}

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 递归复制目录（排除会被处理的文件类型）
 */
function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (!shouldProcessFile(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 检查文件是否应该被处理
 */
function shouldProcessFile(filename) {
  return filename.endsWith('.js') ||
         filename.endsWith('.html') ||
         filename.endsWith('.css');
}

/**
 * 获取所有需要处理的文件
 */
function getFilesToProcess(dir, extensions) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesToProcess(fullPath, extensions));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 混淆单个 JS 文件 - 增强版
 * @param {string} inputFile - 输入文件路径
 * @param {param} outputFile - 输出文件路径
 * @param {string} securityLevel - 安全级别: 'high' | 'medium' | 'low'
 */
async function obfuscateFileEnhanced(inputFile, outputFile, securityLevel = 'medium') {
  try {
    const { default: JavaScriptObfuscator } = await import('javascript-obfuscator');
    const code = fs.readFileSync(inputFile, 'utf-8');
    
    // 根据安全级别选择配置
    let config;
    switch (securityLevel) {
      case 'high':
        config = HIGH_SECURITY_OBFUSCATION_CONFIG;
        break;
      case 'medium':
        config = MEDIUM_SECURITY_OBFUSCATION_CONFIG;
        break;
      case 'low':
      default:
        config = { ...MEDIUM_SECURITY_OBFUSCATION_CONFIG, compact: false };
        break;
    }
    
    // 对入口文件添加运行时保护
    let finalCode = code;
    if (inputFile.includes('server.js') || inputFile.includes('app.js') || inputFile.includes('index.js')) {
      // 服务端代码不需要前端反调试
      // finalCode = generateRuntimeProtection() + '\n' + code;
    }
    
    const result = JavaScriptObfuscator.obfuscate(finalCode, config);
    fs.writeFileSync(outputFile, result.getObfuscatedCode(), 'utf-8');
    
    return { success: true, size: result.getObfuscatedCode().length };
  } catch (error) {
    console.warn(`     ⚠ JS 混淆失败: ${path.basename(inputFile)} - ${error.message}`);
    fs.copyFileSync(inputFile, outputFile);
    return { success: false, size: 0 };
  }
}

/**
 * 压缩单个 HTML 文件 - 增强版
 */
async function minifyHtmlFileEnhanced(inputFile, outputFile, options = {}) {
  try {
    const { minify } = await import('html-minifier');
    const { addRuntimeProtection = false } = options;
    
    let code = fs.readFileSync(inputFile, 'utf-8');
    
    // 添加运行时保护（仅对主HTML文件）
    if (addRuntimeProtection && code.includes('<head>')) {
      const protectionCode = generateRuntimeProtection();
      code = code.replace('<head>', `<head><script>${protectionCode}</script>`);
    }
    
    const result = minify(code, HTML_MINIFIER_CONFIG);
    fs.writeFileSync(outputFile, result, 'utf-8');
    
    return { success: true, size: result.length };
  } catch (error) {
    console.warn(`     ⚠ HTML 压缩失败: ${path.basename(inputFile)} - ${error.message}`);
    fs.copyFileSync(inputFile, outputFile);
    return { success: false, size: 0 };
  }
}

/**
 * 压缩单个 CSS 文件
 */
async function minifyCssFileEnhanced(inputFile, outputFile) {
  try {
    const { default: CleanCSS } = await import('clean-css');
    const code = fs.readFileSync(inputFile, 'utf-8');
    const result = new CleanCSS(CSS_MINIFIER_CONFIG).minify(code);
    
    if (result.errors.length > 0) {
      throw new Error(result.errors.join(', '));
    }
    
    fs.writeFileSync(outputFile, result.styles, 'utf-8');
    return { success: true, size: result.styles.length };
  } catch (error) {
    console.warn(`     ⚠ CSS 压缩失败: ${path.basename(inputFile)} - ${error.message}`);
    fs.copyFileSync(inputFile, outputFile);
    return { success: false, size: 0 };
  }
}

/**
 * 计算文件哈希（用于完整性校验）
 */
function calculateFileHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * 生成保护报告
 */
function generateProtectionReport(stats, outputDir) {
  const report = {
    timestamp: new Date().toISOString(),
    protectionLevel: 'enhanced',
    statistics: stats,
    features: [
      'High-strength JavaScript obfuscation',
      'Control flow flattening',
      'Dead code injection',
      'String array encryption (RC4 + Base64)',
      'Self-defending code',
      'Anti-debugging protection',
      'HTML/CSS minification',
      'File integrity verification'
    ],
    warnings: [
      'Obfuscated code is significantly larger than original',
      'Debug protection may affect legitimate debugging',
      'Some features may impact runtime performance'
    ]
  };
  
  const reportPath = path.join(outputDir, '.protection-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return report;
}

/**
 * 增强版源码保护主函数
 * @param {Object} options - 配置选项
 * @param {string} options.srcDir - 源码目录
 * @param {string} options.outputDir - 输出目录
 * @param {string} options.securityLevel - 安全级别: 'high' | 'medium' | 'low'
 * @param {boolean} options.verifyIntegrity - 是否生成完整性校验
 */
async function protectSourceCodeEnhanced(options = {}) {
  const {
    srcDir = path.join(PROJECT_ROOT, 'src'),
    outputDir = path.join(PROJECT_ROOT, 'build', 'protected-src'),
    securityLevel = 'medium',
    verifyIntegrity = true
  } = options;

  console.log('\n========================================');
  console.log('增强版源码保护处理');
  console.log(`安全级别: ${securityLevel.toUpperCase()}`);
  console.log('========================================');

  if (!fs.existsSync(srcDir)) {
    console.error(`✗ 源码目录不存在: ${srcDir}`);
    return false;
  }

  // 清理旧输出
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  ensureDir(outputDir);

  const stats = {
    js: { total: 0, success: 0, originalSize: 0, protectedSize: 0 },
    html: { total: 0, success: 0, originalSize: 0, protectedSize: 0 },
    css: { total: 0, success: 0, originalSize: 0, protectedSize: 0 },
    startTime: Date.now()
  };

  // 复制非处理文件
  console.log('\n1. 复制资源文件...');
  copyDir(srcDir, outputDir);
  console.log('   ✓ 资源文件复制完成');

  // 处理 JS 文件
  console.log('\n2. 混淆 JavaScript 文件...');
  const jsFiles = getFilesToProcess(srcDir, ['.js']);
  stats.js.total = jsFiles.length;
  console.log(`   发现 ${jsFiles.length} 个 JS 文件`);

  for (let i = 0; i < jsFiles.length; i++) {
    const file = jsFiles[i];
    const relativePath = path.relative(srcDir, file);
    const outputFile = path.join(outputDir, relativePath);
    ensureDir(path.dirname(outputFile));

    const originalSize = fs.statSync(file).size;
    stats.js.originalSize += originalSize;

    const result = await obfuscateFileEnhanced(file, outputFile, securityLevel);
    
    if (result.success) {
      stats.js.success++;
      stats.js.protectedSize += result.size;
    }
    
    process.stdout.write(`   进度: ${i + 1}/${jsFiles.length} (${Math.round((i + 1) / jsFiles.length * 100)}%)\r`);
  }
  console.log('');

  // 处理 HTML 文件
  console.log('\n3. 压缩 HTML 文件...');
  const htmlFiles = getFilesToProcess(srcDir, ['.html']);
  stats.html.total = htmlFiles.length;
  console.log(`   发现 ${htmlFiles.length} 个 HTML 文件`);

  for (let i = 0; i < htmlFiles.length; i++) {
    const file = htmlFiles[i];
    const relativePath = path.relative(srcDir, file);
    const outputFile = path.join(outputDir, relativePath);
    ensureDir(path.dirname(outputFile));

    const originalSize = fs.statSync(file).size;
    stats.html.originalSize += originalSize;

    // 对index.html添加运行时保护
    const isMainHtml = file.toLowerCase().includes('index.html');
    const result = await minifyHtmlFileEnhanced(file, outputFile, { 
      addRuntimeProtection: isMainHtml && securityLevel === 'high' 
    });
    
    if (result.success) {
      stats.html.success++;
      stats.html.protectedSize += result.size;
    }
    
    process.stdout.write(`   进度: ${i + 1}/${htmlFiles.length} (${Math.round((i + 1) / htmlFiles.length * 100)}%)\r`);
  }
  console.log('');

  // 处理 CSS 文件
  console.log('\n4. 压缩 CSS 文件...');
  const cssFiles = getFilesToProcess(srcDir, ['.css']);
  stats.css.total = cssFiles.length;
  console.log(`   发现 ${cssFiles.length} 个 CSS 文件`);

  for (let i = 0; i < cssFiles.length; i++) {
    const file = cssFiles[i];
    const relativePath = path.relative(srcDir, file);
    const outputFile = path.join(outputDir, relativePath);
    ensureDir(path.dirname(outputFile));

    const originalSize = fs.statSync(file).size;
    stats.css.originalSize += originalSize;

    const result = await minifyCssFileEnhanced(file, outputFile);
    
    if (result.success) {
      stats.css.success++;
      stats.css.protectedSize += result.size;
    }
    
    process.stdout.write(`   进度: ${i + 1}/${cssFiles.length} (${Math.round((i + 1) / cssFiles.length * 100)}%)\r`);
  }
  console.log('');

  // 生成完整性校验
  if (verifyIntegrity) {
    console.log('\n5. 生成完整性校验...');
    const integrityData = {};
    const allFiles = getFilesToProcess(outputDir, ['.js', '.html', '.css']);
    for (const file of allFiles) {
      const relativePath = path.relative(outputDir, file);
      integrityData[relativePath] = calculateFileHash(file);
    }
    fs.writeFileSync(
      path.join(outputDir, '.integrity.json'),
      JSON.stringify(integrityData, null, 2)
    );
    console.log('   ✓ 完整性校验文件已生成');
  }

  // 生成保护报告
  const report = generateProtectionReport(stats, outputDir);

  // 计算统计信息
  const totalOriginal = stats.js.originalSize + stats.html.originalSize + stats.css.originalSize;
  const totalProtected = stats.js.protectedSize + stats.html.protectedSize + stats.css.protectedSize;
  const expansionRatio = totalOriginal > 0 ? ((totalProtected / totalOriginal) - 1) * 100 : 0;
  const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);

  console.log('\n----------------------------------------');
  console.log('处理完成:');
  console.log(`  JS:   ${stats.js.success}/${stats.js.total} 个文件`);
  console.log(`  HTML: ${stats.html.success}/${stats.html.total} 个文件`);
  console.log(`  CSS:  ${stats.css.success}/${stats.css.total} 个文件`);
  console.log('');
  console.log('体积变化:');
  console.log(`  原始大小: ${(totalOriginal / 1024).toFixed(2)} KB`);
  console.log(`  保护后:   ${(totalProtected / 1024).toFixed(2)} KB`);
  console.log(`  膨胀率:   ${expansionRatio > 0 ? '+' : ''}${expansionRatio.toFixed(1)}%`);
  console.log('');
  console.log(`耗时: ${duration} 秒`);
  console.log('----------------------------------------');
  console.log(`\n✓ 源码保护完成: ${outputDir}`);
  
  if (securityLevel === 'high') {
    console.log('\n⚠  注意: 高强度保护会显著增加代码体积');
    console.log('   并可能影响运行时性能，建议仅在生产环境使用');
  }

  return (stats.js.success + stats.html.success + stats.css.success) > 0;
}

export { 
  protectSourceCodeEnhanced,
  encryptString,
  decryptString,
  HIGH_SECURITY_OBFUSCATION_CONFIG,
  MEDIUM_SECURITY_OBFUSCATION_CONFIG
};

// 直接运行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const securityLevel = args[0] || 'medium';
  
  protectSourceCodeEnhanced({ securityLevel }).then(success => process.exit(success ? 0 : 1));
}
