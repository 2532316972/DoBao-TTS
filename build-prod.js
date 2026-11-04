/**
 * 生产环境打包脚本
 * 支持多平台打包：Windows、Android (Termux)
 * 支持源码保护（JavaScript 混淆）
 *
 * 使用方式：
 *   npm run build              显示交互菜单
 *   npm run build:win          Windows 打包
 *   npm run build:android      Android 打包
 *   npm run build:all          全部打包
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE_VERSION = '18.20.5';

// ==================== 手动配置区域 ====================
// 源码保护开关：0 = 禁用，1 = 启用
const ENABLE_CODE_PROTECTION = 0;
// ZIP打包开关：0 = 禁用，1 = 启用
const ENABLE_CREATE_ZIP = 1;
// 源码保护级别：'low' = 低强度, 'medium' = 中强度, 'high' = 高强度
// 注意：high 级别会显著增加启动时间，建议使用 medium
const CODE_PROTECTION_LEVEL = 'medium';
// 使用增强版保护器：true = 使用增强版, false = 使用基础版
const USE_ENHANCED_PROTECTOR = true;

// =====================================================

// 版本号配置（启用源码保护时自动从 settings.html 读取）
let APP_VERSION = null;

// 构建相关文件统一放在 build 目录下
const BUILD_DIR = 'build';
const CACHE_DIR = path.join(BUILD_DIR, '.cache');
const PROTECTED_SRC_DIR = path.join(BUILD_DIR, 'protected-src');
const PROTECTED_PUBLIC_DIR = path.join(BUILD_DIR, 'protected-public');
const PROTECTED_SCRIPTS_DIR = path.join(BUILD_DIR, 'protected-scripts');

// 平台配置
const PLATFORMS = {
  win: {
    name: 'Windows',
    dir: 'DoBao-TTS-Win',
    nodeBinary: 'node.exe',
    nodeUrl: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
    launcher: 'start.bat'
  },
  android: {
    name: 'Android (Termux)',
    dir: 'DoBao-TTS-Android',
    nodeBinary: null,
    nodeUrl: null,
    launcher: 'start.sh'
  }
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
 * 从 package.json 中读取版本号
 * @returns {string|null} 版本号或 null
 */
function getVersionFromPackageJson() {
  try {
    const packageJsonPath = path.join(__dirname, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      console.warn('   ⚠ 未找到 package.json，无法读取版本号');
      return null;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    let version = packageJson.version;
    if (version) {
      // 确保版本号统一格式（带v前缀）
      version = version.startsWith('v') ? version : `v${version}`;
      console.log(`   ✓ 从 package.json 读取到版本号: ${version}`);
      return version;
    }

    console.warn('   ⚠ 未在 package.json 中找到版本号');
    return null;
  } catch (error) {
    console.warn('   ⚠ 读取版本号失败:', error.message);
    return null;
  }
}

/**
 * 更新打包目录中 settings.html 的版本号
 * @param {string} prodDir - 打包目录
 * @param {string} version - 版本号
 */
function updateSettingsVersion(prodDir, version) {
  try {
    const settingsPath = path.join(prodDir, 'public', 'pages', 'settings.html');
    if (!fs.existsSync(settingsPath)) {
      console.warn('   ⚠ 未找到打包目录中的 settings.html');
      return false;
    }

    let content = fs.readFileSync(settingsPath, 'utf8');
    // 替换 id="appVersion">xxx 或 id=appVersion>xxx 或 appVersion>xxx 格式（匹配任何内容）
    // 确保版本号前面只有一个 v
    const versionWithV = version.startsWith('v') ? version : `v${version}`;
    const updatedContent = content.replace(
      /(?:id="?appVersion"?|appVersion)>[^<]+/,
      `id="appVersion">${versionWithV}`
    );

    if (content !== updatedContent) {
      fs.writeFileSync(settingsPath, updatedContent, 'utf8');
      console.log(`   ✓ 已更新 settings.html 版本号为: ${versionWithV}`);
      return true;
    } else {
      console.log(`   ℹ settings.html 版本号已是: ${versionWithV}`);
      return true;
    }
  } catch (error) {
    console.warn('   ⚠ 更新 settings.html 版本号失败:', error.message);
    return false;
  }
}

/**
 * 安全删除文件或目录
 */
function safeRemove(target) {
  try {
    if (fs.existsSync(target)) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.unlinkSync(target);
      }
      return true;
    }
  } catch (error) {
    console.warn(`   ⚠ 删除失败: ${target}`);
    return false;
  }
  return false;
}

/**
 * 创建平台标识文件
 * @param {string} prodDir - 生产目录
 * @param {string} platformKey - 平台键 (win/android)
 */
function createPlatformFile(prodDir, platformKey) {
  // 读取 package.json 获取版本号
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

  // 获取平台配置
  const config = PLATFORMS[platformKey];
  if (!config) {
    console.warn(`   ⚠ 未知的平台键: ${platformKey}，跳过创建平台标识文件`);
    return;
  }

  // platform 字段使用 process.platform 兼容的值
  const platformValue = platformKey === 'win' ? 'win32' : platformKey;

  const platformInfo = {
    platform: platformValue,
    name: config.name,
    buildTime: new Date().toISOString(),
    version: packageJson.version
  };

  const platformFile = path.join(prodDir, '.platform');
  fs.writeFileSync(platformFile, JSON.stringify(platformInfo, null, 2));
  console.log(`   ✓ 平台标识文件已创建: ${platformKey} (${platformValue})`);
}

/**
 * 清理指定平台的旧构建文件
 * @param {string} platform - 平台键 (win/android)
 * @param {string} [dirName] - 带版本号的目录名（可选）
 */
function cleanPlatformBuild(platform, dirName = null) {
  const config = PLATFORMS[platform];
  console.log(`   清理 ${config.name} 旧构建...`);

  let cleaned = 0;

  // 如果提供了带版本号的目录名，优先清理它
  if (dirName) {
    const versionedDir = path.join(BUILD_DIR, dirName);
    const versionedZip = path.join(BUILD_DIR, `${dirName}.zip`);

    if (safeRemove(versionedDir)) {
      console.log(`   ✓ 已删除: ${dirName}/`);
      cleaned++;
    }
    if (safeRemove(versionedZip)) {
      console.log(`   ✓ 已删除: ${dirName}.zip`);
      cleaned++;
    }
  }

  // 同时清理旧版无版本号的目录（兼容性）
  const platformDir = path.join(BUILD_DIR, config.dir);
  const zipFile = path.join(BUILD_DIR, `${config.dir}.zip`);

  if (safeRemove(platformDir)) {
    console.log(`   ✓ 已删除: ${config.dir}/`);
    cleaned++;
  }
  if (safeRemove(zipFile)) {
    console.log(`   ✓ 已删除: ${config.dir}.zip`);
    cleaned++;
  }

  // 清理该平台的其他版本构建（匹配 DoBao-TTS-Win-* 或 DoBao-TTS-Android-*）
  if (fs.existsSync(BUILD_DIR)) {
    const entries = fs.readdirSync(BUILD_DIR, { withFileTypes: true });
    const pattern = new RegExp(`^${config.dir}-v[\\d.]+-?\\w*`);

    for (const entry of entries) {
      const entryName = entry.name;
      // 跳过当前要构建的版本（已经清理过了）
      if (dirName && entryName.startsWith(dirName)) {
        continue;
      }
      // 匹配该平台的其他版本
      if (pattern.test(entryName)) {
        const entryPath = path.join(BUILD_DIR, entryName);
        if (safeRemove(entryPath)) {
          console.log(`   ✓ 已删除旧版本: ${entryName}`);
          cleaned++;
        }
      }
    }
  }

  if (cleaned === 0) {
    console.log(`   未发现 ${config.name} 旧构建文件`);
  }
}

/**
 * 复制目录
 */
function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 复制服务端源码
 */
function copyServerCode(appDir, useProtected) {
  console.log('   正在复制服务端源码...');
  try {
    const sourceDir = useProtected && fs.existsSync(PROTECTED_SRC_DIR)
      ? PROTECTED_SRC_DIR
      : 'src';

    if (useProtected && sourceDir === PROTECTED_SRC_DIR) {
      console.log('   ℹ 使用混淆保护后的源码');
    }

    copyDir(sourceDir, path.join(appDir, 'src'));
    fs.copyFileSync('package.json', path.join(appDir, 'package.json'));
    console.log('   ✓ 服务端源码复制完成');
    return true;
  } catch (error) {
    console.error('   ✗ 复制失败:', error.message);
    return false;
  }
}

/**
 * 复制 node_modules（排除开发依赖和无用文件以减小体积）
 */
function copyNodeModules(appDir, isAndroid = false) {
  console.log('   正在复制 node_modules...');
  const sourceDir = 'node_modules';
  const destDir = path.join(appDir, 'node_modules');

  if (!fs.existsSync(sourceDir)) {
    console.warn('   ⚠ 未找到 node_modules，请先运行 npm install');
    return false;
  }

  // 需要排除的目录和文件模式（减小体积）
  const excludePatterns = [
    /^\./,                    // 隐藏文件
    /test/,                   // 测试文件
    /tests/,
    /__tests__/,
    /\.md$/,                 // markdown 文档
    /\.ts$/i,                // TypeScript 源文件
    /\.map$/,                // Source map
    /docs?/i,                 // 文档目录
    /examples?/i,             // 示例目录
    /\.github/,
    /\.git/,
    /\.vscode/,
    /LICENSE/i,
    /CHANGELOG/i,
    /CONTRIBUTING/i,
    /\.eslintrc/,
    /\.prettierrc/,
    /tsconfig/,
    /jest/,
    /mocha/,
    /\.editorconfig/,
  ];

  // Android 平台额外排除的依赖（Windows 专用）
  const androidExcludePackages = isAndroid ? [
    'ffmpeg-static',         // Windows 专用 FFmpeg 二进制文件
  ] : [];

  function shouldExclude(name) {
    // 检查是否在排除模式列表中
    if (excludePatterns.some(pattern => pattern.test(name))) {
      return true;
    }
    // Android 平台排除 Windows 专用包
    if (isAndroid && androidExcludePackages.includes(name)) {
      console.log(`   ℹ 跳过 Windows 专用包: ${name}`);
      return true;
    }
    return false;
  }

  function copyDirFiltered(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      if (shouldExclude(entry.name)) {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        copyDirFiltered(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  try {
    copyDirFiltered(sourceDir, destDir);
    console.log('   ✓ node_modules 复制完成');
    return true;
  } catch (error) {
    console.error('   ✗ 复制失败:', error.message);
    return false;
  }
}

/**
 * 将 node_modules 打包为 tar.gz（用于 Android/Termux）
 * @param {string} appDir - 应用目录
 * @returns {boolean} 是否成功
 */
function createNodeModulesTarGz(appDir) {
  console.log('   正在打包 node_modules...');
  const sourceDir = 'node_modules';
  const outputFile = path.join(appDir, 'node_modules.tar.gz');

  if (!fs.existsSync(sourceDir)) {
    console.warn('   ⚠ 未找到 node_modules，请先运行 npm install');
    return false;
  }

  // Android 平台需要排除的依赖（Windows 专用）
  const androidExcludePackages = ['ffmpeg-static'];

  try {
    // 创建临时目录，复制需要打包的文件
    const tempDir = path.join(BUILD_DIR, '.temp-node_modules');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    ensureDir(tempDir);

    // 读取 node_modules 目录
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    let copiedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const entry of entries) {
      // 跳过 Windows 专用包
      if (androidExcludePackages.includes(entry.name)) {
        console.log(`   ℹ 跳过 Windows 专用包: ${entry.name}`);
        skippedCount++;
        continue;
      }

      const srcPath = path.join(sourceDir, entry.name);
      const destPath = path.join(tempDir, entry.name);

      try {
        if (entry.isDirectory()) {
          copyDirSafe(srcPath, destPath);
          copiedCount++;
        } else {
          fs.copyFileSync(srcPath, destPath);
          copiedCount++;
        }
      } catch (copyError) {
        // 跳过无法复制的文件（如符号链接）
        console.warn(`   ⚠ 跳过无法复制的文件: ${entry.name}`);
        errorCount++;
      }
    }

    console.log(`   已复制 ${copiedCount} 个包，跳过 ${skippedCount} 个 Windows 专用包，${errorCount} 个错误`);

    // 使用 tar 命令打包（Windows 10 1803+ 内置 tar 命令）
    console.log('   正在创建 tar.gz 压缩包...');
    let tarSuccess = false;

    // 方法1: 使用 PowerShell 直接调用 tar（Windows 10 1803+ 内置）
    try {
      const psCommand = `tar -czf '${outputFile.replace(/\\/g, '/')}' -C '${tempDir.replace(/\\/g, '/')}' .`;
      execSync(
        `powershell -Command "${psCommand}"`,
        { stdio: 'pipe', shell: 'powershell.exe' }
      );
      tarSuccess = true;
    } catch (psError) {
      console.warn('   ⚠ PowerShell tar 失败:', psError.message);
    }

    // 方法2: 直接使用 cmd 调用 tar
    if (!tarSuccess) {
      try {
        execSync(
          `cmd /c tar -czf "${outputFile}" -C "${tempDir}" .`,
          { stdio: 'pipe' }
        );
        tarSuccess = true;
      } catch (cmdError) {
        console.warn('   ⚠ CMD tar 失败:', cmdError.message);
      }
    }

    // 方法3: 使用 7z 创建 tar.gz（如果安装了）
    if (!tarSuccess) {
      try {
        // 先创建 tar，再 gzip
        const tarFile = outputFile.replace('.gz', '');
        execSync(
          `7z a -ttar "${tarFile}" "${tempDir}\\*"`,
          { stdio: 'pipe' }
        );
        execSync(
          `7z a -tgzip "${outputFile}" "${tarFile}"`,
          { stdio: 'pipe' }
        );
        fs.unlinkSync(tarFile);
        tarSuccess = true;
      } catch (sevenZipError) {
        console.warn('   ⚠ 7z 失败:', sevenZipError.message);
      }
    }

    // 清理临时目录
    fs.rmSync(tempDir, { recursive: true, force: true });

    if (!tarSuccess) {
      console.error('   ✗ 所有 tar 方法都失败，无法创建 node_modules.tar.gz');
      return false;
    }

    // 验证文件是否创建成功
    if (!fs.existsSync(outputFile)) {
      console.error('   ✗ tar.gz 文件未创建');
      return false;
    }

    // 获取文件大小
    const stats = fs.statSync(outputFile);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`   ✓ node_modules.tar.gz 创建完成 (${sizeMB} MB)`);

    return true;
  } catch (error) {
    console.error('   ✗ 打包失败:', error.message);
    return false;
  }
}

/**
 * 安全复制目录（跳过无法复制的文件）
 * @param {string} src - 源目录
 * @param {string} dest - 目标目录
 */
function copyDirSafe(src, dest) {
  ensureDir(dest);

  try {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      try {
        if (entry.isDirectory()) {
          copyDirSafe(srcPath, destPath);
        } else if (entry.isFile()) {
          fs.copyFileSync(srcPath, destPath);
        }
        // 跳过符号链接等其他类型
      } catch (copyError) {
        // 忽略单个文件复制错误
      }
    }
  } catch (readError) {
    // 忽略目录读取错误
  }
}

/**
 * 执行源码保护（混淆）
 * 支持基础版和增强版保护器
 */
async function protectSourceCode() {
  console.log('\n========================================');
  console.log('源码保护处理');
  console.log('========================================');

  if (USE_ENHANCED_PROTECTOR) {
    console.log(`使用增强版保护器 [${CODE_PROTECTION_LEVEL} 强度]`);
  }

  try {
    let protect;

    if (USE_ENHANCED_PROTECTOR) {
      // 使用增强版保护器
      const { protectSourceCodeEnhanced } = await import('./scripts/code-protector-enhanced.js');
      protect = protectSourceCodeEnhanced;
    } else {
      // 使用基础版保护器
      const { protectSourceCode: protectFn } = await import('./scripts/code-protector.js');
      protect = protectFn;
    }

    // 保护服务端源码
    console.log('\n1. 保护服务端源码 (src/)...');
    const srcOptions = USE_ENHANCED_PROTECTOR
      ? { srcDir: path.join(__dirname, 'src'), outputDir: PROTECTED_SRC_DIR, securityLevel: CODE_PROTECTION_LEVEL }
      : { srcDir: path.join(__dirname, 'src'), outputDir: PROTECTED_SRC_DIR };
    const srcSuccess = await protect(srcOptions);

    if (!srcSuccess) {
      console.error('✗ 服务端源码保护失败');
      return false;
    }

    // 保护前端静态资源
    console.log('\n2. 保护前端静态资源 (public/)...');
    const publicOptions = USE_ENHANCED_PROTECTOR
      ? { srcDir: path.join(__dirname, 'public'), outputDir: PROTECTED_PUBLIC_DIR, securityLevel: CODE_PROTECTION_LEVEL }
      : { srcDir: path.join(__dirname, 'public'), outputDir: PROTECTED_PUBLIC_DIR };
    const publicSuccess = await protect(publicOptions);

    if (!publicSuccess) {
      console.error('✗ 前端静态资源保护失败');
      return false;
    }

    // 保护 updater.js
    console.log('\n3. 保护 updater.js...');
    // 创建临时目录只包含 updater.js
    const tempScriptsDir = path.join(BUILD_DIR, '.temp-scripts');
    ensureDir(tempScriptsDir);
    fs.copyFileSync(path.join(__dirname, 'scripts', 'updater.js'), path.join(tempScriptsDir, 'updater.js'));

    const scriptsOptions = USE_ENHANCED_PROTECTOR
      ? { srcDir: tempScriptsDir, outputDir: PROTECTED_SCRIPTS_DIR, securityLevel: CODE_PROTECTION_LEVEL }
      : { srcDir: tempScriptsDir, outputDir: PROTECTED_SCRIPTS_DIR };
    const scriptsSuccess = await protect(scriptsOptions);

    // 清理临时目录
    fs.rmSync(tempScriptsDir, { recursive: true, force: true });

    if (!scriptsSuccess) {
      console.error('✗ updater.js 保护失败');
      return false;
    }

    console.log('\n✓ 源码保护完成');
    return true;
  } catch (error) {
    console.error('\n✗ 源码保护失败:', error.message);
    return false;
  }
}

/**
 * 清理源码保护临时文件
 */
function cleanProtectedSource() {
  let cleaned = 0;

  if (fs.existsSync(PROTECTED_SRC_DIR)) {
    try {
      fs.rmSync(PROTECTED_SRC_DIR, { recursive: true, force: true });
      cleaned++;
    } catch (error) {
      console.warn('   ⚠ 清理服务端临时文件失败:', error.message);
    }
  }

  if (fs.existsSync(PROTECTED_PUBLIC_DIR)) {
    try {
      fs.rmSync(PROTECTED_PUBLIC_DIR, { recursive: true, force: true });
      cleaned++;
    } catch (error) {
      console.warn('   ⚠ 清理前端临时文件失败:', error.message);
    }
  }

  if (fs.existsSync(PROTECTED_SCRIPTS_DIR)) {
    try {
      fs.rmSync(PROTECTED_SCRIPTS_DIR, { recursive: true, force: true });
      cleaned++;
    } catch (error) {
      console.warn('   ⚠ 清理脚本临时文件失败:', error.message);
    }
  }

  if (cleaned > 0) {
    console.log('   ✓ 已清理临时保护文件');
  }
}

/**
 * 创建 Windows 启动脚本
 */
function createWinLauncher(prodDir) {
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'title DoBao-TTS',
    'echo.',
    'echo ==========================================',
    'echo    DoBao-TTS',
    'echo ==========================================',
    'echo.',
    'echo Starting server...',
    'echo.',
    'echo Press Ctrl+C to stop',
    'echo.',
    '',
    'cd /d "%~dp0"',
    '',
    'rem 设置环境变量，让程序使用打包的 FFmpeg',
    'set FFMPEG_PATH=%~dp0runtime\\ffmpeg.exe',
    'set PATH=%~dp0runtime;%PATH%',
    '',
    'runtime\\node.exe app\\src\\server.js',
    '',
    'if errorlevel 1 (',
    '  echo.',
    '  echo Failed to start server',
    '  echo Press any key to exit...',
    '  pause >nul',
    '  exit /b 1',
    ')'
  ];

  fs.writeFileSync(path.join(prodDir, 'start.bat'), lines.join('\r\n'));
}

/**
 * 创建 Android/Termux 启动脚本
 */
function createAndroidLauncher(prodDir) {
  const launcherContent = `#!/data/data/com.termux/files/usr/bin/sh
# DoBao-TTS 启动脚本 (Termux)
# npm 依赖已打包为 node_modules.tar.gz，首次启动自动解压

echo "=========================================="
echo "    DoBao-TTS"
echo "=========================================="
echo ""

# 检查并安装 Node.js
check_nodejs() {
  if ! command -v node > /dev/null 2>&1; then
    echo -e "\x1b[1;33m未检测到 Node.js，正在安装...\x1b[0m"
    pkg update -y
    pkg install -y nodejs
    if [ $? -eq 0 ]; then
      echo -e "\x1b[0;32mNode.js 安装成功\x1b[0m"
    else
      echo -e "\x1b[0;31mNode.js 安装失败，请手动运行: pkg install nodejs\x1b[0m"
      exit 1
    fi
  else
    NODE_VERSION=$(node --version)
    echo -e "\x1b[0;32mNode.js 已安装: $NODE_VERSION\x1b[0m"
  fi
}

# 检查并安装 FFmpeg
check_ffmpeg() {
  if ! command -v ffmpeg > /dev/null 2>&1; then
    echo -e "\x1b[1;33m未检测到 FFmpeg，正在安装...\x1b[0m"
    pkg update -y
    pkg install -y ffmpeg
    if [ $? -eq 0 ]; then
      echo -e "\x1b[0;32mFFmpeg 安装成功\x1b[0m"
    else
      echo -e "\x1b[0;31mFFmpeg 安装失败，请手动运行: pkg install ffmpeg\x1b[0m"
      exit 1
    fi
  else
    FFMPEG_VERSION=$(ffmpeg -version | head -n 1 | cut -d ' ' -f 3)
    echo -e "\x1b[0;32mFFmpeg 已安装: $FFMPEG_VERSION\x1b[0m"
  fi
}

# 解压 node_modules（首次启动）
extract_node_modules() {
  local app_dir="$1"
  local tar_file="$app_dir/node_modules.tar.gz"

  if [ -d "$app_dir/node_modules" ]; then
    echo -e "\x1b[0;32mnpm 依赖已解压\x1b[0m"
    return 0
  fi

  if [ ! -f "$tar_file" ]; then
    echo -e "\x1b[0;31m未找到 node_modules.tar.gz，请重新下载安装包\x1b[0m"
    return 1
  fi

  echo -e "\x1b[1;33m首次启动，正在解压 npm 依赖...\x1b[0m"
  echo "这可能需要一些时间，请耐心等待..."

  # 检查 tar 文件是否有效
  echo "检查压缩包..."
  tar -tzf "$tar_file" > /dev/null 2>&1
  if [ $? -ne 0 ]; then
    echo -e "\x1b[0;31m压缩包损坏或格式不正确\x1b[0m"
    return 1
  fi

  # 创建 node_modules 目录并解压到其中
  echo "创建 node_modules 目录..."
  mkdir -p "$app_dir/node_modules"

  # 使用 -C 切换到 node_modules 目录解压，避免修改当前目录权限
  echo "开始解压..."
  tar -xzf "$tar_file" -C "$app_dir/node_modules" --no-same-permissions --no-same-owner 2>&1 | grep -v "Cannot utime\|Cannot change mode" || true
  local tar_exit_code=$?

  # 即使 tar 返回非零，也检查是否成功解压了文件
  if [ -d "$app_dir/node_modules" ] && [ "$(ls -A "$app_dir/node_modules" 2>/dev/null)" ]; then
    echo -e "\x1b[0;32mnpm 依赖解压完成\x1b[0m"
    # 解压完成后删除 tar.gz 文件以节省空间
    rm -f "$tar_file"
    echo -e "\x1b[0;32m已清理压缩包，释放存储空间\x1b[0m"
    return 0
  else
    echo -e "\x1b[0;31mnpm 依赖解压失败 (退出码: $tar_exit_code)\x1b[0m"
    return 1
  fi
}

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"

# 检查依赖
echo "检查依赖环境..."
check_nodejs
check_ffmpeg
echo ""

# 解压 npm 依赖
extract_node_modules "$APP_DIR"
if [ $? -ne 0 ]; then
  exit 1
fi
echo ""

# 启动服务
echo "正在启动服务..."
echo "提示: 按 Ctrl+C 可以停止服务"
echo ""

cd "$SCRIPT_DIR"
echo "工作目录: $(pwd)"
echo "检查 app/src/server.js: $(ls -la app/src/server.js 2>/dev/null || echo '文件不存在')"
echo "检查 public 目录: $(ls -la public 2>/dev/null | head -5 || echo '目录不存在')"
echo ""

node "app/src/server.js" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  # 退出码 143 表示 SIGTERM (128 + 15)，通常是系统更新时终止服务
  if [ $EXIT_CODE -eq 143 ]; then
    echo -e "\x1b[1;33m服务已停止 (退出码: $EXIT_CODE)\x1b[0m"
    echo ""
    echo -e "\x1b[0;36m提示: 服务已停止，请手动重启项目\x1b[0m"
  else
    echo -e "\x1b[0;31m服务启动失败 (退出码: $EXIT_CODE)\x1b[0m"
    echo ""
    echo "调试信息:"
    echo "  Node版本: $(node --version)"
    echo "  工作目录: $(pwd)"
    echo "  app目录: $(ls -la app 2>/dev/null | head -3 || echo '不存在')"
  fi
  read -p "按回车键继续..."
fi
`;

  fs.writeFileSync(path.join(prodDir, 'start.sh'), launcherContent);
}

/**
 * 下载 Node.js 到缓存
 */
function downloadNodeToCache() {
  const nodeUrl = PLATFORMS.win.nodeUrl;
  const cachedPath = path.join(CACHE_DIR, `node-${NODE_VERSION}.exe`);

  if (fs.existsSync(cachedPath)) {
    console.log(`   ✓ Node.js v${NODE_VERSION} 已缓存`);
    return true;
  }

  console.log(`   正在下载 Node.js v${NODE_VERSION}...`);
  try {
    execSync(
      `powershell -Command "Invoke-WebRequest -Uri '${nodeUrl}' -OutFile '${cachedPath}'"`,
      { stdio: 'ignore' }
    );
    console.log('   ✓ 下载并缓存成功');
    return true;
  } catch (error) {
    console.warn('   ✗ 下载失败');
    return false;
  }
}

/**
 * 打包 Windows 版本
 */
async function buildWin() {
  const protect = ENABLE_CODE_PROTECTION === 1;

  console.log('\n========================================');
  console.log('正在打包 Windows 版本');
  if (protect) {
    console.log('（已启用源码保护）');
  }
  console.log('========================================\n');

  // 读取版本号
  if (!APP_VERSION) {
    console.log('正在读取版本号...');
    APP_VERSION = getVersionFromPackageJson();
  }

  const config = PLATFORMS.win;
  // 文件夹保持原名，压缩包带版本号
  const prodDir = path.join(BUILD_DIR, config.dir);
  const zipName = APP_VERSION ? `${config.dir}-${APP_VERSION}` : config.dir;

  // 清理旧构建
  cleanPlatformBuild('win', zipName);

  // 确保目录存在
  ensureDir(BUILD_DIR);
  ensureDir(CACHE_DIR);
  ensureDir(prodDir);

  // 如果启用源码保护，先执行保护
  if (protect) {
    if (!await protectSourceCode()) {
      console.error('\n✗ 源码保护失败，打包终止！');
      return false;
    }
  }

  // 复制静态资源
  console.log('1. 复制静态资源...');
  const publicSourceDir = protect && fs.existsSync(PROTECTED_PUBLIC_DIR)
    ? PROTECTED_PUBLIC_DIR
    : 'public';
  if (protect && publicSourceDir === PROTECTED_PUBLIC_DIR) {
    console.log('   ℹ 使用混淆保护后的前端资源');
  }
  copyDir(publicSourceDir, path.join(prodDir, 'public'));
  copyDir('config', path.join(prodDir, 'config'));

  // 更新 settings.html 中的版本号
  if (APP_VERSION) {
    console.log('   更新版本号...');
    updateSettingsVersion(prodDir, APP_VERSION);
  }

  // 复制 updater.js（根据是否启用源码保护选择使用保护后的版本）
  console.log('   复制 updater.js...');
  const scriptsSourceDir = protect && fs.existsSync(PROTECTED_SCRIPTS_DIR)
    ? PROTECTED_SCRIPTS_DIR
    : 'scripts';
  if (protect && scriptsSourceDir === PROTECTED_SCRIPTS_DIR) {
    console.log('   ℹ 使用混淆保护后的 updater.js');
  }
  ensureDir(path.join(prodDir, 'scripts'));
  fs.copyFileSync(path.join(scriptsSourceDir, 'updater.js'), path.join(prodDir, 'scripts', 'updater.js'));
  console.log('   ✓ updater.js 复制完成');

  // 复制服务端源码
  console.log('2. 复制服务端源码...');
  const appDir = path.join(prodDir, 'app');
  if (!copyServerCode(appDir, protect)) {
    console.error('\n✗ 打包失败！');
    return false;
  }

  // 同时复制 config 到 app/config，确保服务端代码能找到配置文件
  console.log('   复制配置文件到应用目录...');
  copyDir('config', path.join(appDir, 'config'));

  // 复制 node_modules（比重新安装快得多）
  console.log('3. 复制 node_modules...');
  if (!copyNodeModules(appDir)) {
    console.warn('   将尝试在线安装依赖...');
    try {
      execSync('npm install --production --omit=optional', {
        cwd: appDir,
        stdio: 'ignore'
      });
      console.log('   ✓ npm 依赖安装完成');
    } catch (error) {
      console.warn('   ⚠ npm 依赖安装失败:', error.message);
      console.warn('   请手动运行: cd ' + appDir + ' && npm install');
    }
  }

  // 创建 runtime 目录并下载 Node.js
  console.log('4. 准备 Node.js 运行环境...');
  ensureDir(path.join(prodDir, 'runtime'));
  if (downloadNodeToCache()) {
    const cachedPath = path.join(CACHE_DIR, `node-${NODE_VERSION}.exe`);
    fs.copyFileSync(cachedPath, path.join(prodDir, 'runtime', 'node.exe'));
    console.log('   ✓ Node.js 准备完成');
  } else {
    console.warn('   ⚠ Node.js 下载失败，请手动下载');
  }

  // 创建启动脚本和说明文档
  console.log('5. 创建启动脚本...');
  createWinLauncher(prodDir);
  createPlatformFile(prodDir, 'win');

  // 创建压缩包
  if (ENABLE_CREATE_ZIP === 1) {
    console.log('6. 创建压缩包...');
    try {
      const zipFile = path.join(BUILD_DIR, `${zipName}.zip`);
      execSync(
        `powershell -Command "Compress-Archive -Path '${prodDir}' -DestinationPath '${zipFile}' -Force"`,
        { stdio: 'ignore' }
      );
      console.log(`   ✓ 压缩包创建成功: ${zipFile}`);
    } catch (error) {
      console.warn('   ⚠ 自动创建压缩包失败，请手动压缩');
    }
  } else {
    console.log('6. 跳过压缩包创建（仅生成文件夹）');
    console.log(`   ℹ 输出目录: ${prodDir}`);
  }

  // 清理临时保护文件
  if (protect) {
    cleanProtectedSource();
  }

  console.log('\n✓ Windows 版本打包完成！');
  return true;
}

/**
 * 打包 Android/Termux 版本
 */
async function buildAndroid() {
  const protect = ENABLE_CODE_PROTECTION === 1;

  console.log('\n========================================');
  console.log('正在打包 Android (Termux) 版本');
  if (protect) {
    console.log('（已启用源码保护）');
  }
  console.log('========================================\n');

  // 读取版本号
  if (!APP_VERSION) {
    console.log('正在读取版本号...');
    APP_VERSION = getVersionFromPackageJson();
  }

  const config = PLATFORMS.android;
  // 文件夹保持原名，压缩包带版本号
  const prodDir = path.join(BUILD_DIR, config.dir);
  const zipName = APP_VERSION ? `${config.dir}-${APP_VERSION}` : config.dir;

  // 清理旧构建
  cleanPlatformBuild('android', zipName);

  // 确保目录存在
  ensureDir(BUILD_DIR);
  ensureDir(prodDir);

  // 如果启用源码保护，先执行保护
  if (protect) {
    if (!await protectSourceCode()) {
      console.error('\n✗ 源码保护失败，打包终止！');
      return false;
    }
  }

  // 复制静态资源
  console.log('1. 复制静态资源...');
  const publicSourceDir = protect && fs.existsSync(PROTECTED_PUBLIC_DIR)
    ? PROTECTED_PUBLIC_DIR
    : 'public';
  if (protect && publicSourceDir === PROTECTED_PUBLIC_DIR) {
    console.log('   ℹ 使用混淆保护后的前端资源');
  }
  copyDir(publicSourceDir, path.join(prodDir, 'public'));
  copyDir('config', path.join(prodDir, 'config'));

  // 更新 settings.html 中的版本号
  if (APP_VERSION) {
    console.log('   更新版本号...');
    updateSettingsVersion(prodDir, APP_VERSION);
  }

  // 复制 updater.js（根据是否启用源码保护选择使用保护后的版本）
  console.log('   复制 updater.js...');
  const scriptsSourceDir = protect && fs.existsSync(PROTECTED_SCRIPTS_DIR)
    ? PROTECTED_SCRIPTS_DIR
    : 'scripts';
  if (protect && scriptsSourceDir === PROTECTED_SCRIPTS_DIR) {
    console.log('   ℹ 使用混淆保护后的 updater.js');
  }
  ensureDir(path.join(prodDir, 'scripts'));
  fs.copyFileSync(path.join(scriptsSourceDir, 'updater.js'), path.join(prodDir, 'scripts', 'updater.js'));
  console.log('   ✓ updater.js 复制完成');

  // 复制服务端源码
  console.log('2. 复制服务端源码...');
  const appDir = path.join(prodDir, 'app');
  if (!copyServerCode(appDir, protect)) {
    console.error('\n✗ 打包失败！');
    return false;
  }

  // 同时复制 config 到 app/config，确保服务端代码能找到配置文件
  console.log('   复制配置文件到应用目录...');
  copyDir('config', path.join(appDir, 'config'));

  // Android 不需要自带 Node.js，Termux 会安装
  console.log('3. 准备 Termux 环境...');
  console.log('   ✓ Termux 将使用系统自带的 Node.js');

  // 将 node_modules 单独打包为 tar.gz（加快主压缩包解压速度）
  console.log('4. 打包 node_modules...');
  if (!createNodeModulesTarGz(appDir)) {
    console.warn('   ⚠ node_modules 打包失败，将在启动时尝试在线安装');
  }

  // 创建启动脚本和说明文档
  console.log('5. 创建启动脚本...');
  createAndroidLauncher(prodDir);
  createPlatformFile(prodDir, 'android');

  // 创建压缩包
  if (ENABLE_CREATE_ZIP === 1) {
    console.log('6. 创建压缩包...');
    try {
      const zipFile = path.join(BUILD_DIR, `${zipName}.zip`);
      execSync(
        `powershell -Command "Compress-Archive -Path '${prodDir}' -DestinationPath '${zipFile}' -Force"`,
        { stdio: 'ignore' }
      );
      console.log(`   ✓ 压缩包创建成功: ${zipFile}`);
    } catch (error) {
      console.warn('   ⚠ 自动创建压缩包失败，请手动压缩');
    }
  } else {
    console.log('6. 跳过压缩包创建（仅生成文件夹）');
    console.log(`   ℹ 输出目录: ${prodDir}`);
  }

  // 清理临时保护文件
  if (protect) {
    cleanProtectedSource();
  }

  console.log('\n✓ Android (Termux) 版本打包完成！');
  return true;
}

/**
 * 显示菜单并获取用户选择
 */
function showMenu() {
  const protectStatus = ENABLE_CODE_PROTECTION === 1 ? '【已启用】' : '【已禁用】';
  const protectLevel = ENABLE_CODE_PROTECTION === 1 ? `[${CODE_PROTECTION_LEVEL.toUpperCase()}]` : '';
  const protectorVersion = USE_ENHANCED_PROTECTOR ? '[增强版]' : '[基础版]';
  const zipStatus = ENABLE_CREATE_ZIP === 1 ? '【已启用】' : '【已禁用】';

  console.log('\n========================================');
  console.log('DoBao-TTS 生产环境打包工具');
  console.log('========================================\n');
  console.log(`源码保护状态: ${protectStatus} ${protectLevel} ${protectorVersion}`);
  console.log('（修改 ENABLE_CODE_PROTECTION 变量：0=禁用, 1=启用）');
  console.log(`保护级别: ${CODE_PROTECTION_LEVEL}（可选: low/medium/high）`);
  console.log(`保护器版本: ${USE_ENHANCED_PROTECTOR ? '增强版' : '基础版'}（修改 USE_ENHANCED_PROTECTOR）`);
  console.log(`制作压缩包: ${zipStatus}`);
  console.log('（修改 ENABLE_CREATE_ZIP 变量：0=禁用, 1=启用）\n');
  console.log('请选择打包平台:');
  console.log('');
  console.log('  1. Windows (带 Node.js 运行环境)');
  console.log('  2. Android (Termux，需自行安装 Node.js)');
  console.log('  3. 全部打包');
  console.log('');
  console.log('  0. 退出');
  console.log('');
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  let choice = args[0];

  // 如果没有命令行参数，显示交互菜单
  if (!choice) {
    showMenu();

    process.stdout.write('请输入选项 (0-3): ');

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    choice = await new Promise((resolve) => {
      stdin.on('data', (key) => {
        console.log(key);
        stdin.pause();
        resolve(key.trim());
      });
    });
  }

  switch (choice) {
    case '1':
    case 'win':
      await buildWin();
      break;
    case '2':
    case 'android':
      await buildAndroid();
      break;
    case '3':
    case 'all':
      await buildWin();
      console.log('');
      await buildAndroid();
      break;
    case '0':
    case 'exit':
      console.log('\n已退出');
      process.exit(0);
    default:
      console.log('\n无效选项');
      process.exit(1);
  }

  console.log('\n========================================');
  console.log('所有打包任务完成！');
  console.log('========================================');
  console.log(`\n输出目录: ${BUILD_DIR}/`);
  console.log('');
}

main().catch(err => {
  console.error('构建失败:', err);
  process.exit(1);
});
