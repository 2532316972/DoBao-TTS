/**
 * 系统设置页面脚本
 * 提供基本的UI交互功能
 */

// DOM加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // 初始化页面
    initPage();
});

/**
 * 初始化页面
 */
function initPage() {
    // 初始化预制书设置
    initPrefabBookSettings();

    // 初始化定时预制任务管理
    initScheduledPrefetchManager();

    // 初始化Toast通知
    initToast();

    // 初始化主题选项
    initThemeOptions();

    // 初始化数据导出功能
    initDataExport();

    // 初始化数据导入功能
    initDataImport();

    // 初始化更新功能
    initUpdateFeature();

    // 初始化服务器端口设置
    initServerPortSettings();

    // 检查URL参数，是否需要自动打开更新弹窗
    checkAutoOpenUpdateModal();
}

/**
 * 检查是否需要自动打开更新弹窗
 * 当用户从版本更新提示点击"前往更新"时会携带 ?openUpdate=1 参数
 */
function checkAutoOpenUpdateModal() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openUpdate') === '1') {
        // 延迟一点打开，确保页面已完全加载
        setTimeout(() => {
            openUpdateModal();
        }, 300);
    }
}

/**
 * 初始化主题选项
 */
function initThemeOptions() {
    // 获取所有主题选项
    const themeOptions = document.querySelectorAll('.theme-option');

    // 从localStorage加载保存的主题
    const savedTheme = localStorage.getItem('theme') || 'light';

    // 先清除所有主题的active状态，避免HTML默认active类导致多个主题同时选中
    themeOptions.forEach(option => {
        option.classList.remove('active');
    });

    // 设置初始选中状态
    themeOptions.forEach(option => {
        if (option.dataset.theme === savedTheme) {
            option.classList.add('active');
        }

        // 为每个主题选项添加事件监听器
        option.addEventListener('click', function() {
            // 获取选中的主题值
            const selectedTheme = this.dataset.theme;

            // 移除所有活动状态
            themeOptions.forEach(opt => opt.classList.remove('active'));

            // 添加当前活动状态
            this.classList.add('active');

            // 应用主题（使用通用主题脚本中的函数）
            applyTheme(selectedTheme);

            // 显示Toast通知
            showToast('主题已切换为：' + getThemeName(selectedTheme), 'success');
        });
    });
}

/**
 * 获取主题名称
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

/**
 * 更新日志缓存统计信息
 */
async function updateCacheStats() {
    try {
        // 调用获取缓存统计的API
        const response = await fetch('/api/console/cache-stats');
        const result = await response.json();

        if (result.code === 0) {
            const data = result.data;

            // 更新日志文件统计
            document.getElementById('cacheFileCount').textContent = data.fileCount;
            document.getElementById('cacheSize').textContent = formatFileSize(data.totalSize);
        } else {
            // 显示错误通知
            showToast('获取日志统计失败：' + result.msg, 'error');

            // 如果获取失败，重置为0
            document.getElementById('cacheFileCount').textContent = 0;
            document.getElementById('cacheSize').textContent = '0 Bytes';
        }
    } catch (error) {
        // 显示错误通知
        showToast('获取日志统计失败：' + error.message, 'error');

        // 如果获取失败，重置为0
        document.getElementById('cacheFileCount').textContent = 0;
        document.getElementById('cacheSize').textContent = '0 Bytes';
    } finally {
        // 从localStorage获取上次清理时间
        const lastCleanTime = localStorage.getItem('lastCleanTime') || '从未清理';
        document.getElementById('lastCleanTime').textContent = lastCleanTime;
    }
}

/**
 * 初始化Toast通知
 */
function initToast() {
    // 创建Toast容器（如果不存在）
    let toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
}

/**
 * 显示Toast通知
 * @param {string} message - 通知消息
 * @param {string} type - 通知类型（success, error, info）
 * @param {number} duration - 显示时长（毫秒）
 */
function showToast(message, type = 'info', duration = 3000) {
    // 获取Toast容器
    const toastContainer = document.getElementById('toastContainer');
    
    // 创建Toast元素
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // 设置Toast内容
    toast.innerHTML = `
        <i class="fas fa-${getToastIcon(type)}"></i>
        <div class="toast-message">${message}</div>
    `;
    
    // 添加到容器
    toastContainer.appendChild(toast);
    
    // 自动移除Toast
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

/**
 * 获取Toast图标
 * @param {string} type - 通知类型
 * @returns {string} 图标名称
 */
function getToastIcon(type) {
    const icons = {
        'success': 'check-circle',
        'error': 'exclamation-circle',
        'info': 'info-circle',
        'warning': 'exclamation-triangle'
    };
    return icons[type] || 'info-circle';
}

/**
 * 显示加载状态
 * @param {HTMLElement} element - 要显示加载状态的元素
 * @param {boolean} isLoading - 是否显示加载状态
 * @param {string} loadingText - 加载状态文本
 * @param {string} originalText - 原始文本
 */
function showLoading(element, isLoading, loadingText = '加载中...', originalText = '') {
    if (isLoading) {
        // 保存原始文本
        element.dataset.originalText = element.innerHTML;
        
        // 显示加载状态
        element.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
        element.disabled = true;
    } else {
        // 恢复原始文本
        element.innerHTML = element.dataset.originalText || originalText;
        element.disabled = false;
    }
}

/**
 * 格式化文件大小
 * @param {number} bytes - 文件大小（字节）
 * @returns {string} 格式化后的文件大小
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 初始化预制书设置
 */
function initPrefabBookSettings() {
    const cacheConcurrentInput = document.getElementById('cacheConcurrentInput');

    // 加载当前配置
    loadPrefabBookSettings();

    // 缓存并发数输入事件 - 限制范围并自动保存
    if (cacheConcurrentInput) {
        // 防抖保存，避免频繁请求
        let saveTimeout = null;

        const autoSave = async () => {
            let value = parseInt(cacheConcurrentInput.value);
            if (isNaN(value) || value < 1) value = 1;
            if (value > 100) value = 100;
            cacheConcurrentInput.value = value;

            try {
                const response = await fetch('/api/settings/item', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        path: 'prefetch.cacheConcurrent',
                        value: value
                    })
                });

                const result = await response.json();

                if (result.code === 0) {
                    showToast('缓存并发数已自动保存', 'success');
                } else {
                    showToast('保存失败：' + result.msg, 'error');
                }
            } catch (error) {
                console.error('自动保存缓存并发数失败:', error);
                showToast('保存失败：' + error.message, 'error');
            }
        };

        // 监听 input 事件（实时输入）
        cacheConcurrentInput.addEventListener('input', function() {
            // 清除之前的定时器
            if (saveTimeout) {
                clearTimeout(saveTimeout);
            }
            // 500ms 后自动保存
            saveTimeout = setTimeout(autoSave, 500);
        });

        // 监听 change 事件（失去焦点或回车）
        cacheConcurrentInput.addEventListener('change', function() {
            // 清除之前的定时器，立即保存
            if (saveTimeout) {
                clearTimeout(saveTimeout);
            }
            autoSave();
        });
    }
}

/**
 * 加载预制书设置
 */
async function loadPrefabBookSettings() {
    const cacheConcurrentInput = document.getElementById('cacheConcurrentInput');

    try {
        // 加载缓存并发数设置
        if (cacheConcurrentInput) {
            const response = await fetch('/api/settings/item?path=prefetch.cacheConcurrent');
            const result = await response.json();
            // 后端返回格式: { code: 0, data: { path, value } }
            if (result.code === 0 && result.data && result.data.value !== undefined) {
                let value = parseInt(result.data.value);
                if (isNaN(value) || value < 1) value = 20;
                if (value > 100) value = 100;
                cacheConcurrentInput.value = value;
            } else {
                // 如果没有设置过，使用默认值20
                cacheConcurrentInput.value = 20;
            }
        }
    } catch (error) {
        console.error('加载预制书设置失败:', error);
    }
}

// ==================== 预制任务管理 ====================

let _prefetchTasksCache = [];
let _scheduledTasksCache = [];
let _currentScheduleTaskId = null;
let _currentScheduleMode = 'create'; // 'create' 或 'edit'

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatIntervalDisplay(minutes) {
    if (!minutes || minutes <= 0) return '6小时';
    if (minutes < 60) return minutes + '分钟';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return hours + '小时';
    return hours + '小时' + mins + '分钟';
}

let _scheduledPrefetchRefreshInterval = null;

function initScheduledPrefetchManager() {
    loadAllTasks();

    // 启动定时刷新，每5秒刷新一次进度
    startScheduledPrefetchAutoRefresh();

    const refreshBtn = document.getElementById('refreshTaskListBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            const icon = this.querySelector('i');
            if (icon) icon.classList.add('fa-spin');
            loadAllTasks().finally(() => {
                if (icon) icon.classList.remove('fa-spin');
            });
        });
    }

    const scheduleModal = document.getElementById('scheduleModal');
    const closeScheduleModal = document.getElementById('closeScheduleModal');
    const cancelScheduleBtn = document.getElementById('cancelScheduleBtn');
    const confirmScheduleBtn = document.getElementById('confirmScheduleBtn');

    if (closeScheduleModal) {
        closeScheduleModal.addEventListener('click', closeScheduleModalFn);
    }
    if (cancelScheduleBtn) {
        cancelScheduleBtn.addEventListener('click', closeScheduleModalFn);
    }
    if (scheduleModal) {
        scheduleModal.addEventListener('click', function(e) {
            if (e.target === scheduleModal) closeScheduleModalFn();
        });
    }
    if (confirmScheduleBtn) {
        confirmScheduleBtn.addEventListener('click', confirmCreateSchedule);
    }
}

function startScheduledPrefetchAutoRefresh() {
    // 清除已有的定时器
    if (_scheduledPrefetchRefreshInterval) {
        clearInterval(_scheduledPrefetchRefreshInterval);
    }

    // 每5秒刷新一次
    _scheduledPrefetchRefreshInterval = setInterval(() => {
        // 只有当页面可见时才刷新
        if (document.visibilityState === 'visible') {
            loadAllTasks();
        }
    }, 5000);

    console.log('[定时预制] 已启动自动刷新，每5秒刷新一次');
}

function stopScheduledPrefetchAutoRefresh() {
    if (_scheduledPrefetchRefreshInterval) {
        clearInterval(_scheduledPrefetchRefreshInterval);
        _scheduledPrefetchRefreshInterval = null;
        console.log('[定时预制] 已停止自动刷新');
    }
}

// 监听页面可见性变化，优化性能
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        // 页面可见时立即刷新一次，并启动定时刷新
        loadAllTasks();
        startScheduledPrefetchAutoRefresh();
    } else {
        // 页面不可见时停止定时刷新
        stopScheduledPrefetchAutoRefresh();
    }
});

async function loadAllTasks() {
    const taskList = document.getElementById('prefetchTaskList');
    const emptyState = document.getElementById('prefetchTaskEmpty');
    if (!taskList) return;

    try {
        const [prefetchRes, scheduledRes] = await Promise.all([
            fetch('/api/legado/prefetch/tasks').catch(() => null),
            fetch('/api/legado/scheduled-prefetch/list').catch(() => null)
        ]);

        _prefetchTasksCache = [];
        _scheduledTasksCache = [];

        if (prefetchRes && prefetchRes.ok) {
            const prefetchResult = await prefetchRes.json();
            if (prefetchResult.success && prefetchResult.data) {
                _prefetchTasksCache = prefetchResult.data;
            }
        }

        if (scheduledRes && scheduledRes.ok) {
            const scheduledResult = await scheduledRes.json();
            if ((scheduledResult.success || scheduledResult.code === 0) && scheduledResult.data) {
                _scheduledTasksCache = scheduledResult.data;
            }
        }

        const merged = mergeTasks(_prefetchTasksCache, _scheduledTasksCache);

        if (merged.length === 0) {
            taskList.style.display = 'none';
            if (emptyState) emptyState.style.display = 'flex';
        } else {
            taskList.style.display = 'flex';
            if (emptyState) emptyState.style.display = 'none';
            renderTaskList(merged);
        }
    } catch (error) {
        console.error('加载任务列表失败:', error);
        taskList.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
    }
}

function mergeTasks(prefetchTasks, scheduledTasks) {
    console.log('[mergeTasks] 输入:', { prefetchCount: prefetchTasks.length, scheduledCount: scheduledTasks.length });
    console.log('[mergeTasks] scheduledTasks详情:', scheduledTasks.map(st => ({ bookId: st.bookId, taskId: st.taskId, enabled: st.enabled })));

    const scheduledMap = {};
    scheduledTasks.forEach(st => {
        const key = st.bookId || st.taskId;
        console.log('[mergeTasks] 构建scheduledMap:', { key, bookId: st.bookId, enabled: st.enabled });
        scheduledMap[key] = st;
    });

    // 显示所有预制任务（包括已完成的），不再过滤
    const items = [];
    const seenBookIds = new Set();

    prefetchTasks.forEach(pt => {
        const key = (pt.bookInfo && pt.bookInfo.bookId) || pt.taskId;
        console.log('[mergeTasks] 处理prefetchTask:', { key, bookId: pt.bookInfo && pt.bookInfo.bookId, taskId: pt.taskId });
        const scheduled = scheduledMap[key] || null;
        console.log('[mergeTasks] 匹配scheduled:', { key, found: !!scheduled, scheduledEnabled: scheduled ? scheduled.enabled : null });
        if (seenBookIds.has(key)) {
            const existing = items.find(i =>
                (i.prefetch && (i.prefetch.bookInfo && i.prefetch.bookInfo.bookId || i.prefetch.taskId) === key) ||
                (i.scheduled && (i.scheduled.bookId || i.scheduled.taskId) === key)
            );
            if (existing && existing.type === 'prefetch') {
                existing.subTasks = existing.subTasks || [existing.prefetch];
                existing.subTasks.push(pt);
            }
            return;
        }
        seenBookIds.add(key);
        items.push({ type: 'prefetch', prefetch: pt, scheduled: scheduled, subTasks: null });
    });

    scheduledTasks.forEach(st => {
        const key = st.bookId || st.taskId;
        if (!seenBookIds.has(key)) {
            seenBookIds.add(key);
            items.push({ type: 'scheduled', prefetch: null, scheduled: st, subTasks: null });
        }
    });

    console.log('[mergeTasks] 输出:', { itemCount: items.length, items: items.map(i => ({ type: i.type, bookId: i.prefetch ? (i.prefetch.bookInfo && i.prefetch.bookInfo.bookId) : (i.scheduled && i.scheduled.bookId), hasScheduled: !!i.scheduled, scheduledEnabled: i.scheduled ? i.scheduled.enabled : null })) });
    return items;
}

function renderTaskList(items) {
    const taskList = document.getElementById('prefetchTaskList');
    if (!taskList) return;

    taskList.innerHTML = items.map(item => {
        if (item.type === 'prefetch') {
            return renderPrefetchCard(item.prefetch, item.scheduled, item.subTasks);
        } else {
            return renderScheduledOnlyCard(item.scheduled);
        }
    }).join('');
}

function renderPrefetchCard(task, scheduled, subTasks) {
    const bookInfo = task.bookInfo || {};
    const bookName = bookInfo.bookName || '未知书籍';

    let allChapters = [];
    let allCompleted = 0;

    if (subTasks && subTasks.length > 0) {
        subTasks.forEach(st => {
            const chs = st.chapters || [];
            allChapters = allChapters.concat(chs);
        });
    } else {
        allChapters = task.chapters || [];
    }

    const totalChapters = allChapters.length;
    const completedChapters = allChapters.filter(c => c.status === 'completed').length;
    const percent = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0;

    let statusBadge = '';
    if (scheduled && scheduled.enabled) {
        statusBadge = '<span class="ptm-badge ptm-badge--running"><i class="fas fa-circle-notch fa-spin"></i> 定时运行中</span>';
    } else if (task.status === 'processing') {
        statusBadge = '<span class="ptm-badge ptm-badge--running"><i class="fas fa-circle-notch fa-spin"></i> 进行中</span>';
    } else if (task.status === 'paused') {
        statusBadge = '<span class="ptm-badge ptm-badge--paused"><i class="fas fa-pause"></i> 已暂停</span>';
    } else {
        statusBadge = '<span class="ptm-badge ptm-badge--pending"><i class="fas fa-clock"></i> 待处理</span>';
    }

    const progressFillClass = percent >= 100 ? 'ptm-progress-fill ptm-progress-fill--done' : 'ptm-progress-fill';

    let scheduleSection = '';
    if (scheduled) {
        const sEnabled = scheduled.enabled;
        const sProgress = scheduled.progress || {};
        const sTotal = sProgress.totalChapters || 0;
        const sDone = sProgress.totalPrefetched || 0;
        const sPercent = sTotal > 0 ? Math.round((sDone / sTotal) * 100) : 0;
        const sStatus = sEnabled ? '运行中' : '已暂停';
        const toggleIcon = sEnabled ? 'fa-pause' : 'fa-play';
        const toggleClass = sEnabled ? 'ptm-action-btn ptm-action-btn--pause' : 'ptm-action-btn ptm-action-btn--toggle';
        const toggleAction = sEnabled ? 'false' : 'true';
        const intervalMinutes = Math.round((scheduled.intervalHours || 6) * 60);
        const intervalDisplay = formatIntervalDisplay(intervalMinutes);

        scheduleSection = `
            <div class="ptm-card-schedule">
                <div class="ptm-schedule-info">
                    <i class="fas fa-clock"></i>
                    <span>每${intervalDisplay}</span>
                    <span class="ptm-schedule-detail">${sStatus} ${sDone}/${sTotal}章 ${sPercent}%</span>
                </div>
                <div class="ptm-schedule-actions">
                    <button class="${toggleClass}" onclick="toggleScheduledTask('${scheduled.taskId}', ${toggleAction})" title="${sEnabled ? '暂停' : '启用'}">
                        <i class="fas ${toggleIcon}"></i>
                    </button>
                    <button class="ptm-action-btn ptm-action-btn--delete" onclick="deleteScheduledTask('${scheduled.taskId}')" title="删除定时">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    }

    const scheduleBtn = !scheduled
        ? `<button class="ptm-action-btn ptm-action-btn--schedule" onclick="openScheduleModal('${task.taskId}')" title="设为定时预制"><i class="fas fa-clock"></i></button>`
        : '';

    return `
        <div class="ptm-card" data-task-id="${task.taskId}">
            <div class="ptm-card-main">
                <div class="ptm-card-icon">
                    <i class="fas fa-book"></i>
                </div>
                <div class="ptm-card-body">
                    <div class="ptm-card-top">
                        <span class="ptm-card-name">${escapeHtml(bookName)}</span>
                        <div class="ptm-card-badges">
                            ${statusBadge}
                            ${scheduled ? '<span class="ptm-badge ptm-badge--scheduled"><i class="fas fa-clock"></i> 已定时</span>' : ''}
                        </div>
                    </div>
                    <div class="ptm-card-progress">
                        <div class="ptm-progress-bar">
                            <div class="${progressFillClass}" style="width: ${percent}%"></div>
                        </div>
                    </div>
                    <div class="ptm-card-meta">
                        <span><i class="fas fa-layer-group"></i> ${completedChapters}/${totalChapters}章</span>
                        <span><i class="fas fa-percentage"></i> ${percent}%</span>
                    </div>
                </div>
                <div class="ptm-card-actions">
                    ${scheduleBtn}
                    ${scheduled
                        ? `<button class="ptm-action-btn ptm-action-btn--edit" onclick="openEditScheduleModal('${scheduled.taskId}')" title="修改定时设置"><i class="fas fa-edit"></i></button>`
                        : `<button class="ptm-action-btn ptm-action-btn--delete" onclick="deletePrefetchTask('${task.taskId}')" title="删除任务"><i class="fas fa-trash"></i></button>`
                    }
                </div>
            </div>
            ${scheduleSection}
        </div>
    `;
}

function renderScheduledOnlyCard(task) {
    const progress = task.progress || {};
    const totalChapters = progress.totalChapters || 0;
    const totalPrefetched = progress.totalPrefetched || 0;
    const percent = totalChapters > 0 ? Math.round((totalPrefetched / totalChapters) * 100) : 0;
    const isCompleted = progress.status === 'completed';
    const isEnabled = task.enabled && !isCompleted;

    let statusBadge = '';
    if (isCompleted) {
        statusBadge = '<span class="ptm-badge ptm-badge--completed"><i class="fas fa-check"></i> 已完成</span>';
    } else if (isEnabled) {
        statusBadge = '<span class="ptm-badge ptm-badge--running"><i class="fas fa-circle-notch fa-spin"></i> 运行中</span>';
    } else {
        statusBadge = '<span class="ptm-badge ptm-badge--paused"><i class="fas fa-pause"></i> 已暂停</span>';
    }

    const progressFillClass = isCompleted ? 'ptm-progress-fill ptm-progress-fill--done' : 'ptm-progress-fill';
    const toggleIcon = isEnabled ? 'fa-pause' : 'fa-play';
    const toggleClass = isEnabled ? 'ptm-action-btn ptm-action-btn--pause' : 'ptm-action-btn ptm-action-btn--toggle';
    const toggleAction = isEnabled ? 'false' : 'true';
    const intervalMinutes = Math.round((task.intervalHours || 6) * 60);
    const intervalDisplay = formatIntervalDisplay(intervalMinutes);

    return `
        <div class="ptm-card" data-task-id="${task.taskId}">
            <div class="ptm-card-main">
                <div class="ptm-card-icon" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(139, 92, 246, 0.04) 100%); color: #8b5cf6;">
                    <i class="fas fa-clock"></i>
                </div>
                <div class="ptm-card-body">
                    <div class="ptm-card-top">
                        <span class="ptm-card-name">${escapeHtml(task.bookName || '未知书籍')}</span>
                        <div class="ptm-card-badges">
                            ${statusBadge}
                            <span class="ptm-badge ptm-badge--scheduled"><i class="fas fa-clock"></i> 定时任务</span>
                        </div>
                    </div>
                    <div class="ptm-card-progress">
                        <div class="ptm-progress-bar">
                            <div class="${progressFillClass}" style="width: ${percent}%"></div>
                        </div>
                    </div>
                    <div class="ptm-card-meta">
                        <span><i class="fas fa-layer-group"></i> ${totalPrefetched}/${totalChapters}章</span>
                        <span><i class="fas fa-hourglass-half"></i> 每${intervalDisplay}</span>
                    </div>
                </div>
                <div class="ptm-card-actions">
                    ${!isCompleted ? `
                        <button class="${toggleClass}" onclick="toggleScheduledTask('${task.taskId}', ${toggleAction})" title="${isEnabled ? '暂停' : '启用'}">
                            <i class="fas ${toggleIcon}"></i>
                        </button>
                    ` : ''}
                    <button class="ptm-action-btn ptm-action-btn--edit" onclick="openEditScheduleModal('${task.taskId}')" title="修改设置">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="ptm-action-btn ptm-action-btn--delete" onclick="deleteScheduledTask('${task.taskId}')" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function initTimePicker() {
    // 默认使用6小时（360分钟）
    initTimePickerWithValue(360);
}

function initTimePickerWithValue(totalMinutes) {
    const hourContainer = document.getElementById('scheduleHourOptions');
    const minuteContainer = document.getElementById('scheduleMinuteOptions');
    if (!hourContainer || !minuteContainer) return;

    // 计算小时和分钟
    const defaultHours = Math.min(Math.floor(totalMinutes / 60), 24);
    const defaultMinutes = totalMinutes % 60;

    // 找到最接近的分钟步进值
    const minuteSteps = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    let closestMinute = minuteSteps[0];
    let minDiff = Math.abs(defaultMinutes - minuteSteps[0]);
    for (let i = 1; i < minuteSteps.length; i++) {
        const diff = Math.abs(defaultMinutes - minuteSteps[i]);
        if (diff < minDiff) {
            minDiff = diff;
            closestMinute = minuteSteps[i];
        }
    }

    hourContainer.innerHTML = '';
    for (let h = 0; h <= 24; h++) {
        const btn = document.createElement('div');
        btn.className = 'ptm-time-option' + (h === defaultHours ? ' active' : '');
        btn.textContent = h.toString().padStart(2, '0');
        btn.dataset.value = h;
        btn.addEventListener('click', function() {
            hourContainer.querySelectorAll('.ptm-time-option').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            enforceTimeBounds();
            validateTimePicker();
        });
        hourContainer.appendChild(btn);
    }

    minuteContainer.innerHTML = '';
    minuteSteps.forEach(m => {
        const btn = document.createElement('div');
        btn.className = 'ptm-time-option' + (m === closestMinute ? ' active' : '');
        btn.textContent = m.toString().padStart(2, '0');
        btn.dataset.value = m;
        btn.addEventListener('click', function() {
            minuteContainer.querySelectorAll('.ptm-time-option').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            enforceTimeBounds();
            validateTimePicker();
        });
        minuteContainer.appendChild(btn);
    });
}

function enforceTimeBounds() {
    const hourContainer = document.getElementById('scheduleHourOptions');
    const minuteContainer = document.getElementById('scheduleMinuteOptions');
    if (!hourContainer || !minuteContainer) return;

    const activeHour = hourContainer.querySelector('.ptm-time-option.active');
    const activeMinute = minuteContainer.querySelector('.ptm-time-option.active');
    const hours = activeHour ? parseInt(activeHour.dataset.value) : 6;
    const minutes = activeMinute ? parseInt(activeMinute.dataset.value) : 0;

    if (hours === 24 && minutes > 0) {
        minuteContainer.querySelectorAll('.ptm-time-option').forEach(el => el.classList.remove('active'));
        const zeroBtn = minuteContainer.querySelector('.ptm-time-option[data-value="0"]');
        if (zeroBtn) zeroBtn.classList.add('active');
    }

    if (hours === 0 && minutes === 0) {
        const fiveBtn = minuteContainer.querySelector('.ptm-time-option[data-value="5"]');
        if (fiveBtn) {
            minuteContainer.querySelectorAll('.ptm-time-option').forEach(el => el.classList.remove('active'));
            fiveBtn.classList.add('active');
        }
    }
}

function getTimePickerValue() {
    const hourContainer = document.getElementById('scheduleHourOptions');
    const minuteContainer = document.getElementById('scheduleMinuteOptions');
    if (!hourContainer || !minuteContainer) return 360;

    const activeHour = hourContainer.querySelector('.ptm-time-option.active');
    const activeMinute = minuteContainer.querySelector('.ptm-time-option.active');

    const hours = activeHour ? parseInt(activeHour.dataset.value) : 6;
    const minutes = activeMinute ? parseInt(activeMinute.dataset.value) : 0;

    return hours * 60 + minutes;
}

function validateTimePicker() {
    const totalMinutes = getTimePickerValue();
    const confirmBtn = document.getElementById('confirmScheduleBtn');
    if (confirmBtn) {
        confirmBtn.disabled = totalMinutes < 1 || totalMinutes > 1440;
    }
}

function openScheduleModal(taskId) {
    const task = _prefetchTasksCache.find(t => t.taskId === taskId);
    if (!task) {
        showToast('任务不存在', 'error');
        return;
    }

    _currentScheduleTaskId = taskId;
    _currentScheduleMode = 'create';

    // 设置弹窗标题和按钮文字为创建模式
    const modalTitle = document.getElementById('scheduleModalTitle');
    const confirmBtnText = document.getElementById('confirmScheduleBtnText');
    if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-clock"></i> 设置定时预制';
    if (confirmBtnText) confirmBtnText.textContent = '确认创建';

    const bookInfo = task.bookInfo || {};
    const bookNameEl = document.getElementById('scheduleBookName');
    if (bookNameEl) bookNameEl.textContent = bookInfo.bookName || '未知书籍';

    // 从 localStorage 读取上次保存的设置
    const savedIntervalMinutes = parseInt(localStorage.getItem('scheduledPrefetch_lastIntervalMinutes') || '360');
    const savedChaptersPerRun = parseInt(localStorage.getItem('scheduledPrefetch_lastChaptersPerRun') || '10');
    console.log('[定时预制] 读取保存的设置: 间隔=' + savedIntervalMinutes + '分钟, 章节数=' + savedChaptersPerRun);

    initTimePickerWithValue(savedIntervalMinutes);
    validateTimePicker();

    // 设置章节数输入框的值
    const chaptersInput = document.getElementById('scheduleChapters');
    if (chaptersInput) {
        chaptersInput.value = savedChaptersPerRun;
    }

    const modal = document.getElementById('scheduleModal');
    if (modal) modal.classList.add('active');
}

function openEditScheduleModal(scheduledTaskId) {
    const scheduledTask = _scheduledTasksCache.find(t => t.taskId === scheduledTaskId);
    if (!scheduledTask) {
        showToast('定时任务不存在', 'error');
        return;
    }

    _currentScheduleTaskId = scheduledTaskId;
    _currentScheduleMode = 'edit';

    // 设置弹窗标题和按钮文字为编辑模式
    const modalTitle = document.getElementById('scheduleModalTitle');
    const confirmBtnText = document.getElementById('confirmScheduleBtnText');
    if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit"></i> 修改定时设置';
    if (confirmBtnText) confirmBtnText.textContent = '确认修改';

    const bookNameEl = document.getElementById('scheduleBookName');
    if (bookNameEl) bookNameEl.textContent = scheduledTask.bookName || '未知书籍';

    // 使用任务当前的设置
    const currentIntervalMinutes = Math.round((scheduledTask.intervalHours || 6) * 60);
    const currentChaptersPerRun = scheduledTask.chaptersPerRun || 10;
    console.log('[定时预制] 编辑模式 - 当前设置: 间隔=' + currentIntervalMinutes + '分钟, 章节数=' + currentChaptersPerRun);

    initTimePickerWithValue(currentIntervalMinutes);
    validateTimePicker();

    // 设置章节数输入框的值
    const chaptersInput = document.getElementById('scheduleChapters');
    if (chaptersInput) {
        chaptersInput.value = currentChaptersPerRun;
    }

    const modal = document.getElementById('scheduleModal');
    if (modal) modal.classList.add('active');
}

function closeScheduleModalFn() {
    const modal = document.getElementById('scheduleModal');
    if (modal) modal.classList.remove('active');
    _currentScheduleTaskId = null;
}

async function confirmCreateSchedule() {
    if (!_currentScheduleTaskId) return;

    const confirmBtn = document.getElementById('confirmScheduleBtn');
    const intervalMinutes = getTimePickerValue();
    const chaptersInput = document.getElementById('scheduleChapters');
    const chaptersPerRun = chaptersInput ? parseInt(chaptersInput.value) : 10;

    if (intervalMinutes < 1 || intervalMinutes > 1440) {
        showToast('间隔时间必须在1分钟到24小时之间', 'error');
        return;
    }

    if (isNaN(chaptersPerRun) || chaptersPerRun < 1) {
        showToast('每次预制章节数必须大于等于1', 'error');
        if (chaptersInput) chaptersInput.focus();
        return;
    }

    const isEditMode = _currentScheduleMode === 'edit';
    const buttonText = isEditMode ? '修改中...' : '创建中...';
    const successText = isEditMode ? '定时设置已修改' : '定时预制任务已创建';
    const errorText = isEditMode ? '修改失败' : '创建失败';

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + buttonText;
    }

    try {
        let response, result;

        if (isEditMode) {
            // 编辑模式：调用更新API
            const payload = {
                intervalMinutes: intervalMinutes,
                chaptersPerRun: chaptersPerRun
            };

            console.log('[定时预制] 编辑模式 - 发送请求 payload:', JSON.stringify(payload));

            response = await fetch(`/api/legado/scheduled-prefetch/${_currentScheduleTaskId}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            // 创建模式
            const task = _prefetchTasksCache.find(t => t.taskId === _currentScheduleTaskId);
            if (!task) {
                showToast('任务不存在', 'error');
                closeScheduleModalFn();
                return;
            }

            const bookInfo = task.bookInfo || {};
            const options = task.options || {};

            const payload = {
                bookId: bookInfo.bookId || _currentScheduleTaskId,
                bookUrl: bookInfo.bookUrl || '',
                bookName: bookInfo.bookName || '未知书籍',
                voiceId: options.voiceId || '',
                speed: options.speed || 0,
                intervalMinutes: intervalMinutes,
                chaptersPerRun: chaptersPerRun
            };

            console.log('[定时预制] 创建模式 - 发送请求 payload:', JSON.stringify(payload));

            response = await fetch('/api/legado/scheduled-prefetch/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        console.log('[定时预制] 响应状态:', response.status, response.statusText);

        try {
            result = await response.json();
            console.log('[定时预制] 响应数据:', JSON.stringify(result));
        } catch (parseError) {
            const text = await response.text();
            console.error('[定时预制] API响应解析失败:', parseError, '原始响应:', text);
            showToast(errorText + '：服务器返回异常', 'error');
            return;
        }

        if (result.code === 0 || result.success) {
            // 保存用户设置到 localStorage
            localStorage.setItem('scheduledPrefetch_lastIntervalMinutes', intervalMinutes.toString());
            localStorage.setItem('scheduledPrefetch_lastChaptersPerRun', chaptersPerRun.toString());
            console.log('[定时预制] 已保存用户设置: 间隔=' + intervalMinutes + '分钟, 章节数=' + chaptersPerRun);

            showToast(successText, 'success');
            closeScheduleModalFn();
            await loadAllTasks();
        } else {
            showToast(errorText + '：' + (result.msg || result.message || '未知错误'), 'error');
        }
    } catch (error) {
        console.error('[定时预制] 操作失败:', error);
        showToast(errorText, 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            const btnText = isEditMode ? '确认修改' : '确认创建';
            confirmBtn.innerHTML = '<i class="fas fa-check"></i> ' + btnText;
        }
    }
}

async function toggleScheduledTask(taskId, enabled) {
    try {
        const response = await fetch(`/api/legado/scheduled-prefetch/${taskId}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });

        let result;
        try {
            result = await response.json();
        } catch (parseError) {
            const text = await response.text();
            console.error('[切换任务状态] API响应解析失败:', parseError, '原始响应:', text);
            showToast('操作失败：服务器返回异常', 'error');
            return;
        }

        if (result.success || result.code === 0) {
            showToast(enabled ? '定时任务已启用' : '定时任务已暂停', 'success');
            await loadAllTasks();
        } else {
            showToast('操作失败：' + (result.msg || result.message || '未知错误'), 'error');
        }
    } catch (error) {
        console.error('[切换任务状态] 切换失败:', error);
        showToast('操作失败', 'error');
    }
}

async function deleteScheduledTask(taskId) {
    if (!confirm('确定要删除这个定时预制任务吗？')) return;

    try {
        const response = await fetch(`/api/legado/scheduled-prefetch/${taskId}`, {
            method: 'DELETE'
        });

        let result;
        try {
            result = await response.json();
        } catch (parseError) {
            const text = await response.text();
            console.error('[删除定时任务] API响应解析失败:', parseError, '原始响应:', text);
            showToast('删除失败：服务器返回异常', 'error');
            return;
        }

        if (result.success || result.code === 0) {
            showToast('定时任务已删除', 'success');
            await loadAllTasks();
        } else {
            showToast('删除失败：' + (result.msg || result.message || '未知错误'), 'error');
        }
    } catch (error) {
        console.error('[删除定时任务] 删除失败:', error);
        showToast('删除失败', 'error');
    }
}

async function deletePrefetchTask(taskId) {
    if (!confirm('确定要删除这个预制任务吗？')) return;

    try {
        const response = await fetch(`/api/legado/prefetch/tasks/${taskId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast('任务已删除', 'success');
            await loadAllTasks();
        } else {
            showToast('删除失败：' + result.message, 'error');
        }
    } catch (error) {
        console.error('删除预制任务失败:', error);
        showToast('删除失败', 'error');
    }
}

// ==================== 系统更新功能 ====================

/**
 * 当前选中的更新文件
 */
let selectedUpdateFile = null;

/**
 * 检测是否为触摸设备
 * @returns {boolean}
 */
function isTouchDevice() {
    return (('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (navigator.msMaxTouchPoints > 0));
}

/**
 * 检测是否为Android设备
 * @returns {boolean}
 */
function isAndroid() {
    return /Android/i.test(navigator.userAgent);
}

/**
 * 检测是否为iOS设备
 * @returns {boolean}
 */
function isIOS() {
    return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

/**
 * 检测是否为移动设备
 * @returns {boolean}
 */
function isMobile() {
    return isAndroid() || isIOS() || isTouchDevice();
}

/**
 * 初始化更新功能
 */
function initUpdateFeature() {
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    const updateModal = document.getElementById('updateModal');
    const closeUpdateModal = document.getElementById('closeUpdateModal');
    const cancelUpdateBtn = document.getElementById('cancelUpdateBtn');
    const updateDropzone = document.getElementById('updateDropzone');
    const updateFileInput = document.getElementById('updateFileInput');
    const confirmUpdateBtn = document.getElementById('confirmUpdateBtn');

    if (!checkUpdateBtn) return;

    // 根据设备类型调整提示文字
    updateDropzoneText();

    // 打开更新弹窗
    checkUpdateBtn.addEventListener('click', () => {
        openUpdateModal();
    });

    // 关闭更新弹窗
    closeUpdateModal.addEventListener('click', closeUpdateModalFunc);
    cancelUpdateBtn.addEventListener('click', closeUpdateModalFunc);

    // 点击遮罩层关闭
    updateModal.addEventListener('click', (e) => {
        if (e.target === updateModal) {
            closeUpdateModalFunc();
        }
    });

    // 点击拖放区域选择文件
    updateDropzone.addEventListener('click', (e) => {
        // 防止重复触发
        if (e.target !== updateFileInput) {
            updateFileInput.click();
        }
    });

    // 文件选择事件 - 兼容各种浏览器和平台
    updateFileInput.addEventListener('change', async (e) => {
        // 防止事件冒泡导致的重复处理
        e.stopPropagation();

        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            // 验证文件类型（兼容各种MIME类型）
            if (isValidZipFile(file)) {
                await handleUpdateFileSelect(file);
            } else {
                showUpdateStatus('请选择 .zip 格式的更新包', 'error');
                // 清空输入，允许重新选择同一文件
                e.target.value = '';
            }
        }
    });

    // 拖放事件 - 只在非触摸设备上启用
    if (!isTouchDevice()) {
        // 阻止默认拖放行为
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            updateDropzone.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });

        updateDropzone.addEventListener('dragenter', (e) => {
            preventDefaults(e);
            updateDropzone.classList.add('dragover');
        });

        updateDropzone.addEventListener('dragover', (e) => {
            preventDefaults(e);
            updateDropzone.classList.add('dragover');
        });

        updateDropzone.addEventListener('dragleave', (e) => {
            preventDefaults(e);
            // 检查是否真的离开了元素
            if (e.relatedTarget && !updateDropzone.contains(e.relatedTarget)) {
                updateDropzone.classList.remove('dragover');
            }
        });

        updateDropzone.addEventListener('drop', async (e) => {
            preventDefaults(e);
            updateDropzone.classList.remove('dragover');

            const dt = e.dataTransfer;
            const files = dt.files;

            if (files && files.length > 0) {
                const file = files[0];
                if (isValidZipFile(file)) {
                    await handleUpdateFileSelect(file);
                } else {
                    showUpdateStatus('请选择 .zip 格式的更新包', 'error');
                }
            }
        });
    }

    // 开始更新按钮
    confirmUpdateBtn.addEventListener('click', startUpdate);
}

/**
 * 阻止默认事件
 * @param {Event} e
 */
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

/**
 * 验证是否为有效的zip文件
 * @param {File} file
 * @returns {boolean}
 */
function isValidZipFile(file) {
  if (!file) return false;

  // 检查文件名后缀
  if (file.name.toLowerCase().endsWith('.zip')) {
    return true;
  }

  // 检查MIME类型
  const validTypes = [
    'application/zip',
    'application/x-zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'multipart/x-zip'
  ];

  return validTypes.includes(file.type);
}

/**
 * 验证 ZIP 文件完整性（通过读取文件末尾的 ZIP 标记）
 * @param {File} file
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateZipIntegrity(file) {
  return new Promise((resolve) => {
    // 读取文件末尾 64KB（足够包含 ZIP 结束标记和注释）
    const chunkSize = Math.min(file.size, 65536);
    const start = file.size - chunkSize;

    const reader = new FileReader();

    reader.onload = (e) => {
      const buffer = e.target.result;
      const view = new DataView(buffer);

      // ZIP 文件结束标记：PK\x05\x06 (0x504b0506)
      // 在文件末尾向前搜索这个标记
      for (let i = buffer.byteLength - 22; i >= 0; i--) {
        if (view.getUint32(i, false) === 0x504b0506) {
          resolve({ valid: true });
          return;
        }
      }

      resolve({
        valid: false,
        error: 'ZIP 文件不完整或已损坏，请检查文件是否完整下载'
      });
    };

    reader.onerror = () => {
      resolve({
        valid: false,
        error: '无法读取文件内容进行验证'
      });
    };

    // 读取文件末尾数据
    const blob = file.slice(start, file.size);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * 根据设备类型更新拖放区域文字
 */
function updateDropzoneText() {
    const dropzoneText = document.querySelector('.update-dropzone-text');
    if (!dropzoneText) return;

    if (isMobile()) {
        dropzoneText.textContent = '点击选择更新包文件';
    } else {
        dropzoneText.textContent = '拖放更新包到此处，或点击选择文件';
    }
}

/**
 * 打开更新弹窗
 */
function openUpdateModal() {
    const updateModal = document.getElementById('updateModal');

    updateModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // 重置状态
    resetUpdateModal();
}

/**
 * 关闭更新弹窗
 */
function closeUpdateModalFunc() {
    const updateModal = document.getElementById('updateModal');
    updateModal.classList.remove('active');
    document.body.style.overflow = '';

    // 重置状态
    setTimeout(resetUpdateModal, 300);
}

/**
 * 重置更新弹窗状态
 */
function resetUpdateModal() {
    selectedUpdateFile = null;

    const updateFileInput = document.getElementById('updateFileInput');
    const updateFileInfo = document.getElementById('updateFileInfo');
    const updateProgress = document.getElementById('updateProgress');
    const updateStatus = document.getElementById('updateStatus');
    const confirmUpdateBtn = document.getElementById('confirmUpdateBtn');

    if (updateFileInput) updateFileInput.value = '';
    if (updateFileInfo) updateFileInfo.classList.remove('show');
    if (updateProgress) updateProgress.classList.remove('show');
    if (updateStatus) {
        updateStatus.classList.remove('show', 'success', 'error', 'info');
        updateStatus.textContent = '';
    }
    if (confirmUpdateBtn) confirmUpdateBtn.disabled = true;

    // 重置进度条
    const updateProgressFill = document.getElementById('updateProgressFill');
    const updateProgressText = document.getElementById('updateProgressText');
    if (updateProgressFill) updateProgressFill.style.width = '0%';
    if (updateProgressText) updateProgressText.textContent = '准备上传...';
}

/**
 * 处理更新文件选择
 * @param {File} file - 选中的文件
 */
async function handleUpdateFileSelect(file) {
  // 再次验证文件类型
  if (!isValidZipFile(file)) {
    showUpdateStatus('请选择 .zip 格式的更新包', 'error');
    return;
  }

  // 验证文件大小（最大500MB）
  const maxSize = 500 * 1024 * 1024; // 500MB
  if (file.size > maxSize) {
    showUpdateStatus('更新包大小超过限制（最大500MB）', 'error');
    return;
  }

  // 验证文件是否为空
  if (file.size === 0) {
    showUpdateStatus('更新包文件不能为空', 'error');
    return;
  }

  // 显示验证中状态
  showUpdateStatus('正在验证文件完整性...', 'info');

  // 验证 ZIP 文件完整性
  const validation = await validateZipIntegrity(file);
  if (!validation.valid) {
    showUpdateStatus('文件验证失败: ' + validation.error, 'error');
    return;
  }

  selectedUpdateFile = file;

  // 显示文件信息
  const updateFileInfo = document.getElementById('updateFileInfo');
  const updateFileName = document.getElementById('updateFileName');
  const updateFileSize = document.getElementById('updateFileSize');
  const confirmUpdateBtn = document.getElementById('confirmUpdateBtn');

  updateFileName.textContent = file.name;
  updateFileSize.textContent = formatFileSize(file.size);
  updateFileInfo.classList.add('show');
  confirmUpdateBtn.disabled = false;

  // 显示验证成功状态
  showUpdateStatus('文件验证通过，可以开始更新', 'success');
}

/**
 * 显示更新状态
 * @param {string} message - 状态消息
 * @param {string} type - 状态类型 (success, error, info)
 */
function showUpdateStatus(message, type) {
    const updateStatus = document.getElementById('updateStatus');
    updateStatus.textContent = message;
    updateStatus.className = 'update-status show ' + type;
}

/**
 * 开始更新
 */
async function startUpdate() {
    if (!selectedUpdateFile) {
        showUpdateStatus('请先选择更新包', 'error');
        return;
    }

    const confirmUpdateBtn = document.getElementById('confirmUpdateBtn');
    const cancelUpdateBtn = document.getElementById('cancelUpdateBtn');
    const updateProgress = document.getElementById('updateProgress');
    const updateProgressFill = document.getElementById('updateProgressFill');
    const updateProgressText = document.getElementById('updateProgressText');

    // 禁用按钮
    confirmUpdateBtn.disabled = true;
    cancelUpdateBtn.disabled = true;
    confirmUpdateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 更新中...';

    // 显示进度条
    updateProgress.classList.add('show');

    try {
        // 创建FormData
        const formData = new FormData();
        formData.append('updatePackage', selectedUpdateFile);

        // 模拟上传进度
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 90) progress = 90;
            updateProgressFill.style.width = progress + '%';
            updateProgressText.textContent = `正在上传... ${Math.round(progress)}%`;
        }, 200);

        // 上传更新包
        const response = await fetch('/api/settings/update', {
            method: 'POST',
            body: formData
        });

        clearInterval(progressInterval);

        const result = await response.json();
        console.log('更新响应:', result); // 调试信息

        if (result.code === 0 || result.success) {
            updateProgressFill.style.width = '100%';
            updateProgressText.textContent = '上传完成，正在启动更新...';
            showUpdateStatus('更新已启动，请等待几秒后手动重启项目', 'success');

            // 显示重启提示
            showToast('系统更新已启动，请稍候...', 'success');

            // 恢复按钮状态，允许用户关闭弹窗
            setTimeout(() => {
                confirmUpdateBtn.disabled = false;
                cancelUpdateBtn.disabled = false;
                confirmUpdateBtn.innerHTML = '<i class="fas fa-check"></i> 我知道了';
                confirmUpdateBtn.onclick = () => {
                    closeUpdateModalFunc();
                };
            }, 1000);
        } else {
            console.error('更新失败:', result); // 调试信息
            throw new Error(result.msg || result.message || '更新失败');
        }
    } catch (error) {
        updateProgressFill.style.width = '0%';
        updateProgressText.textContent = '上传失败';
        showUpdateStatus('更新失败：' + error.message, 'error');

        // 恢复按钮
        confirmUpdateBtn.disabled = false;
        cancelUpdateBtn.disabled = false;
        confirmUpdateBtn.innerHTML = '<i class="fas fa-upload"></i> 开始更新';

        showToast('更新失败：' + error.message, 'error');
    }
}

// ==================== Cookie使用次数限制功能 ====================

// ==================== 服务器端口设置功能 ====================

/**
 * 初始化服务器端口设置
 */
function initServerPortSettings() {
    const serverPortInput = document.getElementById('serverPortInput');
    const saveServerPortBtn = document.getElementById('saveServerPortBtn');

    if (!saveServerPortBtn) return;

    // 加载当前配置
    loadServerPortSettings();

    // 端口输入事件 - 限制范围
    if (serverPortInput) {
        serverPortInput.addEventListener('change', function() {
            let value = parseInt(this.value);
            if (isNaN(value) || value < 1024) value = 1024;
            if (value > 65535) value = 65535;
            this.value = value;
        });
    }

    // 保存按钮点击事件
    saveServerPortBtn.addEventListener('click', async function() {
        const originalText = this.innerHTML;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
        this.disabled = true;

        try {
            let portValue = parseInt(serverPortInput.value);
            if (isNaN(portValue) || portValue < 1024) portValue = 3000;
            if (portValue > 65535) portValue = 65535;

            // 保存端口配置
            const response = await fetch('/api/settings/item', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: 'server.port',
                    value: portValue
                })
            });

            const result = await response.json();

            if (result.code === 0) {
                showToast(`端口设置已保存为 ${portValue}，下次启动时生效`, 'success');
                updateServerInfo(portValue);
            } else {
                showToast('保存失败：' + result.msg, 'error');
            }
        } catch (error) {
            showToast('保存失败：' + error.message, 'error');
        } finally {
            this.innerHTML = originalText;
            this.disabled = false;
        }
    });
}

/**
 * 加载服务器端口设置
 */
async function loadServerPortSettings() {
    const serverPortInput = document.getElementById('serverPortInput');

    try {
        // 加载端口设置
        if (serverPortInput) {
            const response = await fetch('/api/settings/item?path=server.port');
            const result = await response.json();

            if (result.code === 0 && result.data && result.data.value !== undefined) {
                let value = parseInt(result.data.value);
                if (isNaN(value) || value < 1024) value = 3000;
                if (value > 65535) value = 65535;
                serverPortInput.value = value;
                updateServerInfo(value);
            } else {
                // 如果没有设置过，使用默认值3000
                serverPortInput.value = 3000;
                updateServerInfo(3000);
            }
        }
    } catch (error) {
        console.error('加载服务器端口设置失败:', error);
        if (serverPortInput) {
            serverPortInput.value = 3000;
        }
        updateServerInfo(3000);
    }
}

/**
 * 更新服务器信息显示
 * @param {number} configuredPort - 配置的端口号
 */
function updateServerInfo(configuredPort) {
    const currentServerAddress = document.getElementById('currentServerAddress');
    const portConfigStatus = document.getElementById('portConfigStatus');

    if (currentServerAddress) {
        // 获取当前访问的IP地址
        const currentHost = window.location.hostname;
        const currentPort = window.location.port;
        currentServerAddress.textContent = `http://${currentHost}:${currentPort}`;
    }

    if (portConfigStatus) {
        const currentPort = parseInt(window.location.port);
        if (currentPort === configuredPort) {
            portConfigStatus.textContent = '配置已生效';
            portConfigStatus.style.color = '#22c55e';
        } else {
            portConfigStatus.textContent = `已配置为 ${configuredPort}，重启后生效`;
            portConfigStatus.style.color = '#f59e0b';
        }
    }
}

// ==================== 系统更新功能 ====================

/**
 * 检查服务器是否已重启
 */
async function checkServerRestart() {
    const updateProgressText = document.getElementById('updateProgressText');
    const confirmUpdateBtn = document.getElementById('confirmUpdateBtn');
    const cancelUpdateBtn = document.getElementById('cancelUpdateBtn');

    let attempts = 0;
    const maxAttempts = 30;

    const checkInterval = setInterval(async () => {
        attempts++;

        try {
            const response = await fetch('/api/settings', {
                method: 'HEAD'
            });

            if (response.ok) {
                clearInterval(checkInterval);

                if (updateProgressText) {
                    updateProgressText.textContent = '更新完成！';
                }

                showUpdateStatus('更新成功！页面将在3秒后刷新', 'success');
                showToast('系统更新成功！', 'success');

                // 3秒后刷新页面
                setTimeout(() => {
                    window.location.reload();
                }, 3000);

                return;
            }
        } catch (error) {
            // 服务器还在重启中
        }

        if (attempts >= maxAttempts) {
            clearInterval(checkInterval);

            if (updateProgressText) {
                updateProgressText.textContent = '等待超时';
            }

            showUpdateStatus('等待服务器重启超时，请手动刷新页面', 'error');

            // 恢复按钮
            if (confirmUpdateBtn) {
                confirmUpdateBtn.disabled = false;
                confirmUpdateBtn.innerHTML = '<i class="fas fa-upload"></i> 开始更新';
            }
            if (cancelUpdateBtn) {
                cancelUpdateBtn.disabled = false;
            }
        } else {
            if (updateProgressText) {
                updateProgressText.textContent = `等待服务重启... (${attempts}/${maxAttempts})`;
            }
        }
    }, 2000);
}

// ==================== 数据导出功能 ====================

/**
 * 初始化数据导出功能
 */
function initDataExport() {
    const exportDataBtn = document.getElementById('exportDataBtn');
    const refreshExportStatsBtn = document.getElementById('refreshExportStatsBtn');

    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', exportUserData);
    }

    if (refreshExportStatsBtn) {
        refreshExportStatsBtn.addEventListener('click', async function() {
            const originalText = this.innerHTML;
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 刷新中...';
            this.disabled = true;

            try {
                await updateExportStats();
                showToast('统计数据已刷新', 'success');
            } catch (error) {
                showToast('刷新统计失败：' + error.message, 'error');
            } finally {
                this.innerHTML = originalText;
                this.disabled = false;
            }
        });
    }

    // 初始化导出统计
    updateExportStats();

    // 初始化预制书数据联动控制
    initPrefetchDataToggle();
}

/**
 * 初始化预制书数据导出控制
 * 简化版本：勾选预制书数据即导出全部相关内容
 */
function initPrefetchDataToggle() {
    // 子选项已移除，此函数保留用于兼容性
    // 预制书数据开关现在控制是否导出任务、缓存和音频文件
}

/**
 * 更新导出统计数据
 */
async function updateExportStats() {
    try {
        // 获取Cookie数量
        const cookieResponse = await fetch('/api/cookies');
        const cookieResult = await cookieResponse.json();
        const cookieCount = cookieResult.success ? (cookieResult.data?.length || 0) : 0;
        document.getElementById('exportCookieCount').textContent = cookieCount;

        // 获取预制任务数量
        const taskResponse = await fetch('/api/legado/prefetch/tasks');
        const taskResult = await taskResponse.json();
        const taskCount = taskResult.success ? (taskResult.data?.length || 0) : 0;
        document.getElementById('exportTaskCount').textContent = taskCount;

        // 获取缓存书籍数量
        const bookResponse = await fetch('/api/legado/book-cache/list');
        const bookResult = await bookResponse.json();
        const bookCount = bookResult.success ? (bookResult.data?.length || 0) : 0;
        document.getElementById('exportBookCount').textContent = bookCount;
    } catch (error) {
        console.error('更新导出统计失败:', error);
    }
}

/**
 * 导出用户数据
 */
async function exportUserData() {
    const exportDataBtn = document.getElementById('exportDataBtn');
    const exportProgressGroup = document.getElementById('exportProgressGroup');
    const exportProgressBar = document.getElementById('exportProgressBar');
    const exportProgressText = document.getElementById('exportProgressText');
    const exportProgressPercent = document.getElementById('exportProgressPercent');

    // 获取导出选项
    const exportPrefetchData = document.getElementById('exportPrefetchData');
    const isPrefetchDataEnabled = exportPrefetchData?.checked ?? false;

    const exportCookiesEl = document.getElementById('exportCookies');

    const options = {
        cookies: exportCookiesEl?.checked === true,
        // 预制书数据选项已简化：勾选即导出全部相关内容（任务、缓存、音频）
        prefetchTasks: isPrefetchDataEnabled,
        bookCache: isPrefetchDataEnabled,
        audioFiles: isPrefetchDataEnabled
    };

    // 检查是否至少选择了一项
    if (!options.cookies && !isPrefetchDataEnabled) {
        showToast('请至少选择一项要导出的数据', 'warning');
        return;
    }

    // 显示进度条
    exportProgressGroup.style.display = 'block';
    exportProgressBar.style.width = '0%';
    exportProgressText.textContent = '准备导出...';
    exportProgressPercent.textContent = '0%';

    // 禁用导出按钮
    exportDataBtn.disabled = true;
    exportDataBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 导出中...';

    try {
        // 模拟进度更新
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 5;
            if (progress > 90) progress = 90;
            exportProgressBar.style.width = progress + '%';
            exportProgressPercent.textContent = progress + '%';

            if (progress < 30) {
                exportProgressText.textContent = '正在收集数据...';
            } else if (progress < 60) {
                exportProgressText.textContent = '正在打包数据...';
            } else if (progress < 90) {
                exportProgressText.textContent = '正在生成导出文件...';
            }
        }, 200);

        // 调用导出API
        const response = await fetch('/api/export/all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(options)
        });

        clearInterval(progressInterval);

        if (!response.ok) {
            throw new Error('导出失败：' + response.statusText);
        }

        // 获取文件名
        const contentDisposition = response.headers.get('content-disposition');
        let filename = 'dobao-tts-export.zip';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="(.+)"/);
            if (match) {
                filename = match[1];
            }
        }

        // 下载文件
        const blob = await response.blob();
        downloadExportedData(blob, filename);

        // 完成进度
        exportProgressBar.style.width = '100%';
        exportProgressPercent.textContent = '100%';
        exportProgressText.textContent = '导出完成！';

        showToast('数据导出成功！', 'success');

        // 3秒后隐藏进度条
        setTimeout(() => {
            exportProgressGroup.style.display = 'none';
        }, 3000);

    } catch (error) {
        console.error('导出数据失败:', error);
        exportProgressText.textContent = '导出失败';
        showToast('导出失败：' + error.message, 'error');
    } finally {
        exportDataBtn.disabled = false;
        exportDataBtn.innerHTML = '<i class="fas fa-download"></i> 导出数据';
    }
}

/**
 * 下载导出的数据文件
 * @param {Blob} blob - 文件blob
 * @param {string} filename - 文件名
 */
function downloadExportedData(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// ==================== 数据导入功能 ====================

/**
 * 初始化数据导入功能
 */
function initDataImport() {
    const selectImportFileBtn = document.getElementById('selectImportFileBtn');
    const importFileInput = document.getElementById('importFileInput');
    const selectedImportFileName = document.getElementById('selectedImportFileName');
    const importDataBtn = document.getElementById('importDataBtn');

    // 选择文件按钮点击事件
    selectImportFileBtn.addEventListener('click', () => {
        importFileInput.click();
    });

    // 文件选择变化事件
    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // 更新文件显示UI
            selectedImportFileName.innerHTML = `<i class="fas fa-file-archive"></i><span>${file.name}</span>`;
            selectedImportFileName.classList.add('has-file');
            importDataBtn.disabled = false;
        } else {
            selectedImportFileName.innerHTML = `<i class="fas fa-file-archive"></i><span>未选择文件</span>`;
            selectedImportFileName.classList.remove('has-file');
            importDataBtn.disabled = true;
        }
    });

    // 导入按钮点击事件
    importDataBtn.addEventListener('click', importUserData);
}

/**
 * 导入用户数据
 */
async function importUserData() {
    const importFileInput = document.getElementById('importFileInput');
    const importDataBtn = document.getElementById('importDataBtn');
    const importProgressGroup = document.getElementById('importProgressGroup');
    const importProgressBar = document.getElementById('importProgressBar');
    const importProgressText = document.getElementById('importProgressText');
    const importProgressPercent = document.getElementById('importProgressPercent');
    const importResultGroup = document.getElementById('importResultGroup');
    const importResultContent = document.getElementById('importResultContent');
    const importMergeStrategy = document.getElementById('importMergeStrategy');

    const file = importFileInput.files[0];
    if (!file) {
        showToast('请先选择导入文件', 'warning');
        return;
    }

    // 检查文件类型
    if (!file.name.endsWith('.zip')) {
        showToast('请选择 .zip 格式的导入文件', 'warning');
        return;
    }

    // 获取合并策略
    const mergeStrategy = importMergeStrategy.value;

    // 显示进度条
    importProgressGroup.style.display = 'block';
    importResultGroup.style.display = 'none';
    importProgressBar.style.width = '0%';
    importProgressText.textContent = '准备导入...';
    importProgressPercent.textContent = '0%';

    // 禁用导入按钮
    importDataBtn.disabled = true;
    importDataBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 导入中...';

    try {
        // 模拟进度更新
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 3;
            if (progress > 90) progress = 90;
            importProgressBar.style.width = progress + '%';
            importProgressPercent.textContent = progress + '%';

            if (progress < 20) {
                importProgressText.textContent = '正在上传文件...';
            } else if (progress < 40) {
                importProgressText.textContent = '正在解压文件...';
            } else if (progress < 60) {
                importProgressText.textContent = '正在解析数据...';
            } else if (progress < 80) {
                importProgressText.textContent = '正在导入数据...';
            } else {
                importProgressText.textContent = '正在处理...';
            }
        }, 300);

        // 创建FormData
        const formData = new FormData();
        formData.append('importFile', file);
        formData.append('mergeStrategy', mergeStrategy);
        formData.append('cookies', 'true');
        formData.append('prefetchTasks', 'true');
        formData.append('bookCache', 'true');
        formData.append('audioFiles', 'true');

        // 调用导入API
        const response = await fetch('/api/import/all', {
            method: 'POST',
            body: formData
        });

        clearInterval(progressInterval);

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || '导入失败');
        }

        // 完成进度
        importProgressBar.style.width = '100%';
        importProgressPercent.textContent = '100%';
        importProgressText.textContent = '导入完成！';

        // 显示导入结果
        displayImportResults(result.data);

        showToast('数据导入成功！', 'success');

        // 刷新导出统计
        await updateExportStats();

        // 3秒后隐藏进度条
        setTimeout(() => {
            importProgressGroup.style.display = 'none';
        }, 3000);

    } catch (error) {
        console.error('导入数据失败:', error);
        importProgressText.textContent = '导入失败';
        showToast('导入失败：' + error.message, 'error');
    } finally {
        importDataBtn.disabled = false;
        importDataBtn.innerHTML = '<i class="fas fa-upload"></i> 开始导入';
    }
}

/**
 * 显示导入结果
 * @param {Object} results - 导入结果数据
 */
function displayImportResults(results) {
    const importResultGroup = document.getElementById('importResultGroup');
    const importResultContent = document.getElementById('importResultContent');

    let html = '';

    // Cookie导入结果
    if (results.cookies) {
        html += `<div style="margin-bottom: 0.5rem;">
            <strong>Cookie数据：</strong>
            <span style="color: var(--success-color);">成功 ${results.cookies.imported} 个</span>
            ${results.cookies.skipped > 0 ? `<span style="color: var(--warning-color);">跳过 ${results.cookies.skipped} 个</span>` : ''}
            ${results.cookies.errors.length > 0 ? `<span style="color: var(--error-color);">失败 ${results.cookies.errors.length} 个</span>` : ''}
        </div>`;
    }

    // 预制书任务导入结果
    if (results.prefetchTasks) {
        html += `<div style="margin-bottom: 0.5rem;">
            <strong>预制书任务：</strong>
            <span style="color: var(--success-color);">成功 ${results.prefetchTasks.imported} 个</span>
            ${results.prefetchTasks.skipped > 0 ? `<span style="color: var(--warning-color);">跳过 ${results.prefetchTasks.skipped} 个</span>` : ''}
            ${results.prefetchTasks.errors.length > 0 ? `<span style="color: var(--error-color);">失败 ${results.prefetchTasks.errors.length} 个</span>` : ''}
        </div>`;
    }

    // 书籍缓存导入结果
    if (results.bookCache) {
        html += `<div style="margin-bottom: 0.5rem;">
            <strong>书籍缓存：</strong>
            <span style="color: var(--success-color);">成功 ${results.bookCache.imported} 个</span>
            ${results.bookCache.skipped > 0 ? `<span style="color: var(--warning-color);">跳过 ${results.bookCache.skipped} 个</span>` : ''}
            ${results.bookCache.errors.length > 0 ? `<span style="color: var(--error-color);">失败 ${results.bookCache.errors.length} 个</span>` : ''}
        </div>`;
    }

    // 音频文件导入结果
    if (results.audioFiles) {
        html += `<div style="margin-bottom: 0.5rem;">
            <strong>音频文件：</strong>
            <span style="color: var(--success-color);">成功 ${results.audioFiles.imported} 个</span>
            ${results.audioFiles.skipped > 0 ? `<span style="color: var(--warning-color);">跳过 ${results.audioFiles.skipped} 个</span>` : ''}
        </div>`;
    }

    // 显示错误详情
    const allErrors = [
        ...(results.cookies?.errors || []),
        ...(results.prefetchTasks?.errors || []),
        ...(results.bookCache?.errors || []),
        ...(results.audioFiles?.errors || [])
    ];

    if (allErrors.length > 0) {
        html += `<div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color);">
            <strong style="color: var(--error-color);">错误详情：</strong>
            <ul style="margin: 0.5rem 0 0 0; padding-left: 1.5rem; color: var(--error-color);">
                ${allErrors.slice(0, 5).map(err => `<li>${err}</li>`).join('')}
                ${allErrors.length > 5 ? `<li>...还有 ${allErrors.length - 5} 个错误</li>` : ''}
            </ul>
        </div>`;
    }

    importResultContent.innerHTML = html;
    importResultGroup.style.display = 'block';
}

