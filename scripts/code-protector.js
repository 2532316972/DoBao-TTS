/**
 * 源码保护模块
 * 使用 javascript-obfuscator 对 JavaScript 代码进行混淆保护
 * 使用 html-minifier 和 clean-css 压缩 HTML/CSS
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * JS 混淆配置 - 中度保护
 * 注意：disableConsoleOutput 设置为 false，保留控制台输出功能
 */
const OBFUSCATION_CONFIG = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,  // 保留控制台输出，不影响日志显示
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: true,
  shuffleStringArray: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  unicodeEscapeSequence: false,
  // 保留的标识符
  reservedNames: ['req', 'res', 'next', 'err', 'router', 'app', 'listen', 'require', 'module', 'exports'],
  reservedStrings: ['req', 'res', 'next', 'err', 'router', 'app', 'listen', 'require', 'module', 'exports']
};

/**
 * HTML 压缩配置
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
  minifyJS: true,
  minifyCSS: true
};

/**
 * CSS 压缩配置
 */
const CSS_MINIFIER_CONFIG = {
  level: 2
};

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
      // 只复制不会被处理的文件
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 检查文件是否应该被处理（JS/HTML/CSS）
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
 * 混淆单个 JS 文件
 */
async function obfuscateFile(inputFile, outputFile) {
  try {
    const { default: JavaScriptObfuscator } = await import('javascript-obfuscator');
    const code = fs.readFileSync(inputFile, 'utf-8');
    const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATION_CONFIG);
    fs.writeFileSync(outputFile, result.getObfuscatedCode(), 'utf-8');
    return true;
  } catch (error) {
    console.warn(`     ⚠ JS 混淆失败: ${path.basename(inputFile)}，使用原始文件`);
    fs.copyFileSync(inputFile, outputFile);
    return true;
  }
}

/**
 * 压缩单个 HTML 文件
 */
async function minifyHtmlFile(inputFile, outputFile) {
  try {
    const { minify } = await import('html-minifier');
    const code = fs.readFileSync(inputFile, 'utf-8');
    const result = minify(code, HTML_MINIFIER_CONFIG);
    fs.writeFileSync(outputFile, result, 'utf-8');
    return true;
  } catch (error) {
    console.warn(`     ⚠ HTML 压缩失败: ${path.basename(inputFile)}，使用原始文件`);
    fs.copyFileSync(inputFile, outputFile);
    return true;
  }
}

/**
 * 压缩单个 CSS 文件
 */
async function minifyCssFile(inputFile, outputFile) {
  try {
    const { default: CleanCSS } = await import('clean-css');
    const code = fs.readFileSync(inputFile, 'utf-8');
    const result = new CleanCSS(CSS_MINIFIER_CONFIG).minify(code);
    if (result.errors.length > 0) {
      throw new Error(result.errors.join(', '));
    }
    fs.writeFileSync(outputFile, result.styles, 'utf-8');
    return true;
  } catch (error) {
    console.warn(`     ⚠ CSS 压缩失败: ${path.basename(inputFile)}，使用原始文件`);
    fs.copyFileSync(inputFile, outputFile);
    return true;
  }
}

/**
 * 保护源码主函数
 */
async function protectSourceCode(options = {}) {
  const {
    srcDir = path.join(PROJECT_ROOT, 'src'),
    outputDir = path.join(PROJECT_ROOT, 'build', 'protected-src')
  } = options;

  console.log('\n========================================');
  console.log('源码保护处理');
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

  // 复制非处理文件
  console.log('复制资源文件...');
  copyDir(srcDir, outputDir);

  // 处理 JS 文件
  console.log('混淆 JavaScript 文件...');
  const jsFiles = getFilesToProcess(srcDir, ['.js']);
  console.log(`   发现 ${jsFiles.length} 个 JS 文件`);

  let jsSuccess = 0;
  for (const file of jsFiles) {
    const relativePath = path.relative(srcDir, file);
    const outputFile = path.join(outputDir, relativePath);
    ensureDir(path.dirname(outputFile));

    if (await obfuscateFile(file, outputFile)) {
      jsSuccess++;
      process.stdout.write(`   JS 进度: ${jsSuccess}/${jsFiles.length}\r`);
    }
  }
  console.log('');

  // 处理 HTML 文件
  console.log('压缩 HTML 文件...');
  const htmlFiles = getFilesToProcess(srcDir, ['.html']);
  console.log(`   发现 ${htmlFiles.length} 个 HTML 文件`);

  let htmlSuccess = 0;
  for (const file of htmlFiles) {
    const relativePath = path.relative(srcDir, file);
    const outputFile = path.join(outputDir, relativePath);
    ensureDir(path.dirname(outputFile));

    if (await minifyHtmlFile(file, outputFile)) {
      htmlSuccess++;
      process.stdout.write(`   HTML 进度: ${htmlSuccess}/${htmlFiles.length}\r`);
    }
  }
  console.log('');

  // 处理 CSS 文件
  console.log('压缩 CSS 文件...');
  const cssFiles = getFilesToProcess(srcDir, ['.css']);
  console.log(`   发现 ${cssFiles.length} 个 CSS 文件`);

  let cssSuccess = 0;
  for (const file of cssFiles) {
    const relativePath = path.relative(srcDir, file);
    const outputFile = path.join(outputDir, relativePath);
    ensureDir(path.dirname(outputFile));

    if (await minifyCssFile(file, outputFile)) {
      cssSuccess++;
      process.stdout.write(`   CSS 进度: ${cssSuccess}/${cssFiles.length}\r`);
    }
  }
  console.log('');

  console.log('\n----------------------------------------');
  console.log(`处理完成:`);
  console.log(`  JS:   ${jsSuccess}/${jsFiles.length} 个文件`);
  console.log(`  HTML: ${htmlSuccess}/${htmlFiles.length} 个文件`);
  console.log(`  CSS:  ${cssSuccess}/${cssFiles.length} 个文件`);
  console.log('----------------------------------------');
  console.log(`\n✓ 源码保护完成: ${outputDir}`);

  return (jsSuccess + htmlSuccess + cssSuccess) > 0;
}

export { protectSourceCode };

// 直接运行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  protectSourceCode().then(success => process.exit(success ? 0 : 1));
}
