/**
 * 通用主题管理脚本
 * 提供主题初始化、应用和切换功能
 */

// DOM加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // 初始化主题
    initTheme();
});

/**
 * 初始化主题
 */
function initTheme() {
    // 从localStorage加载保存的主题
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
}

/**
 * 应用主题
 * @param {string} theme - 主题名称（light, dark, system）
 */
function applyTheme(theme) {
    // 移除所有主题类
    document.body.classList.remove('light-theme', 'dark-theme');
    
    // 根据主题值添加对应的类和属性
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        document.documentElement.setAttribute('data-theme', 'light');
    } else if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'system') {
        // 跟随系统主题
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
            document.body.classList.add('dark-theme');
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.body.classList.add('light-theme');
            document.documentElement.setAttribute('data-theme', 'light');
        }
    }
    
    // 保存主题到localStorage
    localStorage.setItem('theme', theme);
}

/**
 * 获取当前主题
 * @returns {string} 当前主题名称
 */
function getCurrentTheme() {
    return localStorage.getItem('theme') || 'light';
}

/**
 * 获取主题名称的显示文本
 * @param {string} theme - 主题值
 * @returns {string} 主题名称
 */
function getThemeName(theme) {
    const themeNames = {
        'light': '浅色主题',
        'dark': '深色主题',
        'system': '跟随系统'
    };
    return themeNames[theme] || theme;
}

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const currentTheme = getCurrentTheme();
    if (currentTheme === 'system') {
        // 如果当前是跟随系统主题，则重新应用主题
        applyTheme('system');
    }
});
