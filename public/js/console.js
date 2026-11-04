/**
 * DoBao TTS总览脚本
 * 负责系统状态监控、Cookie管理和页面交互
 */

// 全局状态管理
const consoleState = {
    systemStatus: null,
    cookieStats: null,
    refreshInterval: null,
    autoRefreshEnabled: true,
    hasCookiesConfigured: false,
    startTime: Date.now()
};

/**
 * 页面初始化
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('总览页面加载完成');
    
    // 初始化页面
    initializePage();
    
    // 绑定事件监听器
    bindEventListeners();
    
    // 开始自动刷新
    startAutoRefresh();
});

/**
 * 初始化页面数据
 */
async function initializePage() {
    try {
        console.log('开始初始化页面...');
        
        // 加载系统状态
        await loadSystemStatus();
        
        // 加载Cookie统计
        try {
            await loadCookieStats();
        } catch (error) {
            // Cookie统计加载失败时，认为没有配置Cookie
            consoleState.hasCookiesConfigured = false;
            console.log('Cookie统计加载失败，认为未配置Cookie');
        }
        
        console.log('页面初始化完成');
    } catch (error) {
        console.error('页面初始化失败:', error);
        showError('页面初始化失败，请刷新重试');
    }
}

/**
 * 绑定事件监听器
 */
function bindEventListeners() {
    // 刷新按钮
    const refreshBtn = document.getElementById('refreshStatus');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async function() {
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i>';
            
            await loadSystemStatus();
            await loadCookieStats();
            
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-sync-alt"></i>';
        });
    }
    
    // 文档按钮
    const docsButton = document.getElementById('docsButton');
    if (docsButton) {
        docsButton.addEventListener('click', function() {
            alert('文档页面开发中...');
        });
    }
    
    // 移动端菜单按钮（预留）
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', toggleMobileMenu);
    }
}

/**
 * 移动端菜单管理器
 */
const MobileMenuManager = {
    isOpen: false,

    /**
     * 切换移动端菜单
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    /**
     * 打开菜单
     */
    open() {
        // 创建导航菜单遮罩
        let overlay = document.getElementById('mobileNavOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mobileNavOverlay';
            overlay.className = 'mobile-nav-overlay';
            overlay.innerHTML = `
                <div class="mobile-nav-menu">
                    <div class="mobile-nav-header">
                        <span>导航菜单</span>
                        <button class="mobile-nav-close" onclick="MobileMenuManager.close()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <nav class="mobile-nav-links">
                        <a href="/pages/tts.html" class="mobile-nav-link">
                            <i class="fas fa-volume-up"></i>
                            <span>语音合成</span>
                        </a>
                        <a href="/pages/legado-tts.html" class="mobile-nav-link">
                            <i class="fas fa-book-reader"></i>
                            <span>阅读TTS</span>
                        </a>
                        <a href="/pages/cookies.html" class="mobile-nav-link">
                            <i class="fas fa-cookie-bite"></i>
                            <span>Cookie管理</span>
                        </a>
                        <a href="/pages/settings.html" class="mobile-nav-link">
                            <i class="fas fa-cog"></i>
                            <span>系统设置</span>
                        </a>
                    </nav>
                </div>
            `;
            document.body.appendChild(overlay);

            // 点击遮罩关闭
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.close();
                }
            });

            // ESC键关闭
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            });
        }

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        this.isOpen = true;
    },

    /**
     * 关闭菜单
     */
    close() {
        const overlay = document.getElementById('mobileNavOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
        document.body.style.overflow = '';
        this.isOpen = false;
    }
};

/**
 * 切换移动端菜单（兼容旧代码）
 */
function toggleMobileMenu() {
    MobileMenuManager.toggle();
}

/**
 * 加载系统状态
 */
async function loadSystemStatus() {
    try {
        console.log('加载系统状态...', new Date().toLocaleTimeString());
        const response = await fetch('/api/console/status');
        
        if (!response.ok) {
            throw new Error('获取系统状态失败');
        }
        
        const result = await response.json();
        console.log('系统状态数据:', result);
        
        if (result.code === 0) {
            consoleState.systemStatus = result.data;
            updateSystemStatusUI(result.data);
        } else {
            throw new Error(result.msg || '获取系统状态失败');
        }
    } catch (error) {
        console.error('加载系统状态失败:', error);
        updateSystemStatusUI(null, error.message);
    }
}

/**
 * 更新系统状态UI
 * @param {Object|null} data - 系统状态数据
 * @param {string|null} errorMsg - 错误消息
 */
function updateSystemStatusUI(data, errorMsg = null) {
    if (errorMsg) {
        // 显示错误状态
        document.getElementById('serviceStatus').innerHTML = 
            '<span style="color: var(--error-color);">错误</span>';
        document.getElementById('cookieStatusValue').innerHTML = 
            '<span style="color: var(--error-color);">未知</span>';
        document.getElementById('queueStatus').innerHTML = 
            '<span style="color: var(--error-color);">-</span>';
        document.getElementById('uptime').innerHTML = 
            '<span style="color: var(--error-color);">-</span>';
        return;
    }
    
    if (!data) {
        return;
    }
    
    // 服务状态
    const serviceStatusEl = document.getElementById('serviceStatus');
    if (serviceStatusEl) {
        const isHealthy = data.service?.status === 'running';
        serviceStatusEl.innerHTML = isHealthy 
            ? '<span style="color: var(--success-color);">运行中</span>'
            : '<span style="color: var(--error-color);">异常</span>';
    }
    
    // Cookie状态
    const cookieStatusEl = document.getElementById('cookieStatusValue');
    if (cookieStatusEl && data.cookies) {
        const validCount = data.cookies.valid || 0;
        const totalCount = data.cookies.total || 0;
        const statusText = validCount > 0 
            ? `${validCount}/${totalCount}` 
            : `<span style="color: var(--error-color);">0/${totalCount}</span>`;
        cookieStatusEl.innerHTML = statusText;
    }
    
    // 请求队列
    const queueStatusEl = document.getElementById('queueStatus');
    if (queueStatusEl && data.queue !== undefined) {
        const queueSize = data.queue.size || 0;
        queueStatusEl.textContent = queueSize;
    }
    
    // 运行时长
    const uptimeEl = document.getElementById('uptime');
    if (uptimeEl && data.service?.uptimeMs !== undefined) {
        console.log('更新运行时长显示:', data.service.uptimeMs);
        uptimeEl.textContent = formatUptime(data.service.uptimeMs);
    }
}

/**
 * 加载Cookie统计信息
 */
async function loadCookieStats() {
    try {
        const response = await fetch('/api/console/cookies');
        
        if (!response.ok) {
            throw new Error('获取Cookie统计失败');
        }
        
        const result = await response.json();
        
        if (result.code === 0) {
            consoleState.cookieStats = result.data;
            consoleState.hasCookiesConfigured = result.data.total > 0;
            updateCookieStatsUI(result.data);
        } else {
            throw new Error(result.msg || '获取Cookie统计失败');
        }
    } catch (error) {
        console.error('加载Cookie统计失败:', error);
        consoleState.hasCookiesConfigured = false;
        updateCookieStatsUI(null, error.message);
    }
}

/**
 * 更新Cookie统计UI
 * @param {Object|null} data - Cookie统计数据
 * @param {string|null} errorMsg - 错误消息
 */
function updateCookieStatsUI(data, errorMsg = null) {
    const cookieCountEl = document.getElementById('cookieCount');
    const cookieStatusEl = document.getElementById('cookieStatus');
    const noCookieAlertEl = document.getElementById('noCookieAlert');
    let cookieActionsEl = document.getElementById('cookieActions');
    
    if (errorMsg) {
        if (cookieCountEl) {
            cookieCountEl.textContent = '错误';
            cookieCountEl.className = 'badge badge-danger';
        }
        if (cookieStatusEl) {
            cookieStatusEl.innerHTML = `
                <div class="cookie-info">
                    <div class="cookie-name">
                        <span class="status-indicator error"></span>
                        加载失败
                    </div>
                    <div class="cookie-meta">${errorMsg}</div>
                </div>
            `;
        }
        if (noCookieAlertEl) {
            noCookieAlertEl.style.display = 'none';
        }
        return;
    }
    
    if (!data) {
        return;
    }
    
    const total = data.total || 0;
    const valid = data.valid || 0;
    const hasCookies = valid > 0;
    
    // 更新Cookie计数
    if (cookieCountEl) {
        cookieCountEl.textContent = `${valid}/${total} 可用`;
        cookieCountEl.className = hasCookies 
            ? 'badge badge-success' 
            : 'badge badge-danger';
    }
    
    // 更新Cookie状态显示
    if (cookieStatusEl) {
        const statusIndicator = hasCookies ? 'active' : 'error';
        const statusText = hasCookies 
            ? `当前有 ${valid} 个Cookie可用` 
            : '当前无可用Cookie...';
        
        const usageText = data.currentCookie 
            ? `当前使用: ${data.currentCookie.name || '未命名'}`
            : '暂无使用记录';
        
        cookieStatusEl.innerHTML = `
            <div class="cookie-info">
                <div class="cookie-name">
                    <span class="status-indicator ${statusIndicator}"></span>
                    ${statusText}
                </div>
                <div class="cookie-meta">${usageText}</div>
            </div>
            <div class="cookie-actions" id="cookieActions">
                <a href="/pages/cookies.html" class="btn btn-primary btn-sm">管理</a>
            </div>
        `;
        cookieActionsEl = document.getElementById('cookieActions');
    }
    
    // 根据Cookie状态显示/隐藏警告提示
    if (noCookieAlertEl && cookieActionsEl && cookieStatusEl) {
        if (!hasCookies) {
            noCookieAlertEl.style.display = 'block';
            cookieStatusEl.style.display = 'none';
        } else {
            noCookieAlertEl.style.display = 'none';
            cookieStatusEl.style.display = 'flex';
            cookieActionsEl.style.display = 'flex';
        }
    }
}

/**
 * 格式化运行时长
 * @param {number} milliseconds - 毫秒数
 * @returns {string} 格式化后的时长
 */
function formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days}天${hours % 24}时`;
    } else if (hours > 0) {
        return `${hours}时${minutes % 60}分`;
    } else if (minutes > 0) {
        return `${minutes}分${seconds % 60}秒`;
    } else {
        return `${seconds}秒`;
    }
}

/**
 * 开始自动刷新
 */
function startAutoRefresh() {
    // 清除现有定时器
    if (consoleState.refreshInterval) {
        clearInterval(consoleState.refreshInterval);
    }
    
    // 移除自动刷新功能，避免产生过多调试日志
    // consoleState.refreshInterval = setInterval(async () => {
    //     if (consoleState.autoRefreshEnabled) {
    //         console.log('自动刷新系统状态...', new Date().toLocaleTimeString());
    //         await loadSystemStatus();
    //         
    //         // 只在有Cookie配置时才刷新Cookie统计信息
    //         if (consoleState.hasCookiesConfigured) {
    //             await loadCookieStats();
    //         }
    //     }
    // }, 30000);
    
    console.log('自动刷新功能已禁用');
}

/**
 * 停止自动刷新
 */
function stopAutoRefresh() {
    if (consoleState.refreshInterval) {
        clearInterval(consoleState.refreshInterval);
        consoleState.refreshInterval = null;
        console.log('自动刷新已停止');
    }
}

/**
 * 显示错误消息
 * @param {string} message - 错误消息
 */
function showError(message) {
    console.error(message);
    // 可以在这里添加UI错误提示
}

/**
 * 显示成功消息
 * @param {string} message - 成功消息
 */
function showSuccess(message) {
    console.log(message);
    // 可以在这里添加UI成功提示
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    stopAutoRefresh();
});

// 导出API供外部使用
window.ConsoleAPI = {
    loadSystemStatus,
    loadCookieStats,
    startAutoRefresh,
    stopAutoRefresh,
    getState: () => consoleState
};