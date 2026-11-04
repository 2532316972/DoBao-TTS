/**
 * 新手引导模块
 * 提供交互式步骤引导，帮助新用户快速了解系统功能
 * @module OnboardingManager
 */

const OnboardingManager = {
    /** @type {string} localStorage键名 - 引导完成标记 */
    STORAGE_KEY: 'dobao_tts_onboarding_completed',
    /** @type {string} localStorage键名 - 引导版本号 */
    VERSION_KEY: 'dobao_tts_onboarding_version',
    /** @type {string} 当前引导版本号 */
    CURRENT_VERSION: '1.0.0',
    /** @type {boolean} 是否正在显示引导 */
    isActive: false,
    /** @type {number} 当前步骤索引 */
    currentStep: 0,
    /** @type {Array<Object>} 引导步骤配置 */
    steps: [],
    /** @type {HTMLElement|null} 引导遮罩元素 */
    overlay: null,
    /** @type {HTMLElement|null} 引导弹窗元素 */
    tooltip: null,
    /** @type {HTMLElement|null} 高亮框元素 */
    highlight: null,
    /** @type {number|null} 帮助按钮自动隐藏定时器 */
    helpBtnAutoHideTimer: null,
    /** @type {boolean} 帮助按钮是否已最小化 */
    isHelpBtnMinimized: false,
    /** @type {HTMLElement|null} 最小化的帮助按钮 */
    minimizedHelpBtn: null,
    /** @type {number} 帮助按钮自动隐藏延迟（毫秒） */
    HELP_BTN_AUTO_HIDE_DELAY: 3000,

    /**
     * 初始化新手引导
     * 检查是否需要显示引导，并绑定相关事件
     */
    init() {
        // 检查是否需要显示引导
        if (this.shouldShow()) {
            // 延迟显示，等待页面完全加载
            setTimeout(() => {
                this.start();
            }, 1500);
        } else {
            // 如果已完成引导，显示帮助按钮
            this.showHelpButton();
        }

        console.log('[Onboarding] 新手引导模块已初始化');
    },

    /**
     * 检查是否应该显示引导
     * @returns {boolean} 是否显示引导
     */
    shouldShow() {
        // 检查是否已完成当前版本的引导
        const completedVersion = localStorage.getItem(this.VERSION_KEY);
        if (completedVersion === this.CURRENT_VERSION) {
            return false;
        }
        return true;
    },

    /**
     * 显示帮助按钮
     */
    showHelpButton() {
        // 如果引导正在进行，不显示帮助按钮
        if (this.isActive) {
            return;
        }

        // 清除之前的状态
        this.clearHelpBtnAutoHideTimer();
        this.removeMinimizedHelpBtn();
        this.isHelpBtnMinimized = false;

        // 查找或创建帮助按钮
        let helpBtn = document.getElementById('onboardingHelpBtn');
        if (!helpBtn) {
            helpBtn = document.createElement('button');
            helpBtn.id = 'onboardingHelpBtn';
            helpBtn.className = 'onboarding-help-btn';
            helpBtn.innerHTML = '<i class="fas fa-question-circle"></i><span>新手引导</span>';
            helpBtn.title = '重新查看新手引导';
            document.body.appendChild(helpBtn);
        }

        // 显示按钮
        helpBtn.style.display = 'flex';
        helpBtn.classList.remove('minimized');

        // 绑定点击事件
        helpBtn.addEventListener('click', () => {
            this.clearHelpBtnAutoHideTimer();
            this.start();
        });

        // 鼠标悬停时清除定时器
        helpBtn.addEventListener('mouseenter', () => {
            this.clearHelpBtnAutoHideTimer();
        });

        // 鼠标离开时重新启动定时器
        helpBtn.addEventListener('mouseleave', () => {
            if (!this.isHelpBtnMinimized) {
                this.startHelpBtnAutoHideTimer();
            }
        });

        // 启动自动隐藏定时器
        this.startHelpBtnAutoHideTimer();
    },

    /**
     * 启动帮助按钮自动隐藏定时器
     */
    startHelpBtnAutoHideTimer() {
        this.clearHelpBtnAutoHideTimer();
        this.helpBtnAutoHideTimer = setTimeout(() => {
            if (!this.isHelpBtnMinimized) {
                this.minimizeHelpBtn();
            }
        }, this.HELP_BTN_AUTO_HIDE_DELAY);
    },

    /**
     * 清除帮助按钮自动隐藏定时器
     */
    clearHelpBtnAutoHideTimer() {
        if (this.helpBtnAutoHideTimer) {
            clearTimeout(this.helpBtnAutoHideTimer);
            this.helpBtnAutoHideTimer = null;
        }
    },

    /**
     * 最小化帮助按钮到左侧
     */
    minimizeHelpBtn() {
        // 如果引导正在进行，不最小化
        if (this.isActive) {
            return;
        }

        if (this.isHelpBtnMinimized) return;

        this.isHelpBtnMinimized = true;
        this.clearHelpBtnAutoHideTimer();

        // 隐藏原按钮
        const helpBtn = document.getElementById('onboardingHelpBtn');
        if (helpBtn) {
            helpBtn.style.display = 'none';
        }

        // 创建最小化按钮
        this.createMinimizedHelpBtn();

        console.log('[Onboarding] 帮助按钮已最小化到左侧');
    },

    /**
     * 创建最小化的帮助按钮
     */
    createMinimizedHelpBtn() {
        // 移除已存在的按钮
        this.removeMinimizedHelpBtn();

        const btn = document.createElement('button');
        btn.id = 'onboardingMinimizedHelpBtn';
        btn.className = 'onboarding-minimized-help-btn';
        btn.innerHTML = '<i class="fas fa-question"></i>';
        btn.title = '新手引导';

        btn.addEventListener('click', () => {
            this.restoreHelpBtn();
        });

        // 鼠标悬停时恢复
        btn.addEventListener('mouseenter', () => {
            this.restoreHelpBtn();
        });

        document.body.appendChild(btn);
        this.minimizedHelpBtn = btn;
    },

    /**
     * 移除最小化的帮助按钮
     */
    removeMinimizedHelpBtn() {
        if (this.minimizedHelpBtn) {
            this.minimizedHelpBtn.remove();
            this.minimizedHelpBtn = null;
        }
    },

    /**
     * 恢复帮助按钮显示
     */
    restoreHelpBtn() {
        if (!this.isHelpBtnMinimized) return;

        this.isHelpBtnMinimized = false;

        // 移除最小化按钮
        this.removeMinimizedHelpBtn();

        // 显示原按钮
        const helpBtn = document.getElementById('onboardingHelpBtn');
        if (helpBtn) {
            helpBtn.style.display = 'flex';
        }

        // 重新启动自动隐藏定时器
        this.startHelpBtnAutoHideTimer();

        console.log('[Onboarding] 帮助按钮已恢复显示');
    },

    /**
     * 隐藏帮助按钮（引导期间调用）
     */
    hideHelpButton() {
        // 清除定时器
        this.clearHelpBtnAutoHideTimer();

        // 移除最小化按钮
        const minimizedBtn = document.getElementById('onboardingMinimizedHelpBtn');
        if (minimizedBtn) {
            minimizedBtn.remove();
        }
        this.minimizedHelpBtn = null;
        this.isHelpBtnMinimized = false;

        // 隐藏原按钮
        const helpBtn = document.getElementById('onboardingHelpBtn');
        if (helpBtn) {
            helpBtn.style.display = 'none';
        }

        console.log('[Onboarding] 帮助按钮已隐藏（引导期间）');
    },

    /**
     * 开始新手引导
     */
    start() {
        if (this.isActive) return;

        // 先彻底清理帮助按钮相关元素
        this.clearHelpBtnAutoHideTimer();
        const minimizedBtn = document.getElementById('onboardingMinimizedHelpBtn');
        if (minimizedBtn) {
            minimizedBtn.remove();
        }
        this.minimizedHelpBtn = null;
        this.isHelpBtnMinimized = false;
        const helpBtn = document.getElementById('onboardingHelpBtn');
        if (helpBtn) {
            helpBtn.style.display = 'none';
        }

        // 根据当前页面设置引导步骤
        this.steps = this.getStepsForCurrentPage();
        if (this.steps.length === 0) return;

        this.isActive = true;
        this.currentStep = 0;

        // 创建引导元素
        this.createElements();

        // 显示第一步
        this.showStep(0);

        console.log('[Onboarding] 开始新手引导，共', this.steps.length, '步');
    },

    /**
     * 获取当前页面的引导步骤
     * @returns {Array<Object>} 引导步骤配置数组
     */
    getStepsForCurrentPage() {
        const path = window.location.pathname;
        const pageName = path.split('/').pop() || 'index.html';

        // 根据页面返回对应的引导步骤
        switch (pageName) {
            case '':
            case 'index.html':
                return this.getOverviewSteps();
            case 'tts.html':
                return this.getTTSSteps();
            case 'cookies.html':
                return this.getCookieSteps();
            case 'settings.html':
                return this.getSettingsSteps();
            case 'legado-tts.html':
                // 根据当前模式返回对应的引导步骤
                return this.getCurrentLegadoModeSteps();
            default:
                return [];
        }
    },

    /**
     * 获取当前阅读TTS模式的引导步骤
     * @returns {Array<Object>} 引导步骤配置数组
     */
    getCurrentLegadoModeSteps() {
        // 检查当前是实时模式还是预制书模式
        const prefabContent = document.getElementById('prefabModeContent');
        const realtimeContent = document.getElementById('realtimeModeContent');

        // 如果预制书模式内容可见，返回预制书模式引导
        if (prefabContent && prefabContent.style.display !== 'none') {
            // 检查当前是Web模式还是TXT模式
            const webContent = document.getElementById('prefabWebContent');
            if (webContent && webContent.style.display !== 'none') {
                console.log('[Onboarding] 当前处于预制书-Web模式，显示Web模式引导');
                return this.getLegadoPrefabSteps();
            } else {
                console.log('[Onboarding] 当前处于预制书-TXT模式，显示TXT模式引导');
                return this.getLegadoTxtSteps();
            }
        }

        // 默认返回实时模式引导
        console.log('[Onboarding] 当前处于实时模式，显示实时模式引导');
        return this.getLegadoRealtimeSteps();
    },

    /**
     * 获取总览页面引导步骤
     * @returns {Array<Object>} 引导步骤配置
     */
    getOverviewSteps() {
        return [
            {
                target: '.app-title',
                title: '欢迎使用 DoBao TTS',
                content: '这是豆包TTS服务的统一管理与监控中心，帮助您快速进行语音合成。',
                position: 'bottom'
            },
            {
                target: '#cookieStatus',
                title: 'Cookie管理',
                content: '这里显示当前Cookie的状态。Cookie是访问豆包TTS服务的必要凭证，请先添加Cookie才能使用语音合成功能。',
                position: 'bottom'
            },
            {
                target: '.feature-grid',
                title: '功能模块',
                content: '这里提供了系统的核心功能入口：语音合成、阅读TTS服务和系统设置。',
                position: 'top'
            },
            {
                target: '.feature-item[href="/pages/tts.html"]',
                title: '语音合成',
                content: '点击进入语音合成页面，可以将文本转换为语音，支持多种发音人和参数调节。',
                position: 'right'
            },
            {
                target: '#refreshStatus',
                title: '刷新状态',
                content: '点击这里可以手动刷新系统状态，查看最新的服务运行情况。',
                position: 'left'
            }
        ];
    },

    /**
     * 获取语音合成页面引导步骤
     * @returns {Array<Object>} 引导步骤配置
     */
    getTTSSteps() {
        return [
            {
                target: '.sidebar-section[aria-label="发音人选择"]',
                title: '发音人选择',
                content: '在这里选择您喜欢的发音人。支持搜索、按语言和性别筛选。点击发音人即可选中。',
                position: 'right'
            },
            {
                target: '#textInput',
                title: '文本输入',
                content: '在这里输入要转换为语音的文本内容。支持最多5000个字符，可以使用Ctrl+Enter快捷键快速生成。',
                position: 'bottom'
            },
            {
                target: '.params-grid',
                title: '参数调节',
                content: '调节语速和音调参数，让语音更符合您的需求。语速范围-50到100，音调范围-12到12。',
                position: 'top'
            },
            {
                target: '#generateBtn',
                title: '生成语音',
                content: '设置完成后，点击此按钮生成语音。生成的音频会自动播放并保存到历史记录中。',
                position: 'top'
            },
            {
                target: '.sidebar-section[aria-label="历史记录"]',
                title: '历史记录',
                content: '这里显示您最近生成的语音记录。可以点击播放、重新使用或删除历史记录。',
                position: 'right'
            }
        ];
    },
    /**
     * 获取Cookie管理页面引导步骤
     * @returns {Array<Object>} 引导步骤配置
     */
    getCookieSteps() {
        return [
            {
                target: '.stats-grid',
                title: 'Cookie统计',
                content: '这里显示您的Cookie统计信息，包括总数、有效数、无效数和当前使用的Cookie。',
                position: 'bottom'
            },
            {
                target: '#qrLoginBtn',
                title: '二维码获取',
                content: '推荐使用二维码方式获取Cookie。点击后使用豆包APP或抖音APP扫描二维码即可自动获取。',
                position: 'bottom'
            },
            {
                target: '#addCookieBtn',
                title: '手动添加',
                content: '如果您已有Cookie字符串，可以点击这里手动添加。请确保Cookie完整有效。',
                position: 'bottom'
            },
            {
                target: '#cookieList',
                title: 'Cookie列表',
                content: '这里显示所有已添加的Cookie。您可以对Cookie进行测试、启用/禁用、编辑和删除操作。',
                position: 'top'
            },
            {
                target: '.cookie-toolbar',
                title: '工具栏',
                content: '使用搜索框快速查找Cookie，或使用排序功能按名称、使用次数或创建时间排序。',
                position: 'bottom'
            }
        ];
    },

    /**
     * 获取设置页面引导步骤
     * @returns {Array<Object>} 引导步骤配置
     */
    getSettingsSteps() {
        return [
            {
                target: '.settings-sidebar',
                title: '设置导航',
                content: '左侧导航栏可以快速切换到不同的设置分类，点击可以切换到对应的设置页面。',
                position: 'right'
            },
            {
                target: 'a[href="#prefab-book"]',
                title: '预制书设置',
                content: '管理预制书任务和定时预制设置。可以配置缓存并发数、查看任务进度、设置定时自动预制等。',
                position: 'right'
            },
            {
                target: 'a[href="#theme"]',
                title: '主题设置',
                content: '选择您喜欢的界面主题。支持浅色主题、深色主题，或跟随系统自动切换。',
                position: 'right'
            },
            {
                target: 'a[href="#data-import"]',
                title: '数据导入',
                content: '从备份文件导入数据，支持合并（保留现有数据）或替换（覆盖现有数据）两种策略。可以导入Cookie、预制书任务和缓存数据。',
                position: 'right'
            },
            {
                target: 'a[href="#data-export"]',
                title: '数据导出',
                content: '导出您的Cookie数据、预制书任务和书籍缓存。可用于数据备份或迁移到其他设备。注意：导出的Cookie数据包含敏感信息，请妥善保管。',
                position: 'right'
            },
            {
                target: 'a[href="#server"]',
                title: '服务器设置',
                content: '在这里可以自定义服务器监听端口。默认端口为3000，修改后需要重启服务才能生效。',
                position: 'right'
            },
            {
                target: 'a[href="#about"]',
                title: '关于页面',
                content: '在这里查看软件版本信息，进行系统更新，以及联系开发者获取帮助。',
                position: 'right'
            }
        ];
    },

    /**
     * 获取阅读TTS页面引导步骤（实时模式）
     * @returns {Array<Object>} 引导步骤配置
     */
    getLegadoRealtimeSteps() {
        return [
            {
                target: '.mode-tabs',
                title: '模式切换',
                content: '阅读TTS支持两种模式：实时模式（边读边合成）和预制书模式（提前合成整本书）。根据您的需求选择合适的模式。',
                position: 'bottom'
            },
            {
                target: '#realtimeModeContent',
                title: '实时模式',
                content: '实时模式下，阅读APP会在需要时实时请求语音合成。适合零散阅读或不想提前缓存的场景。',
                position: 'right'
            },
            {
                target: '#voiceSelect',
                title: '选择发音人',
                content: '选择您喜欢的发音人。不同的发音人有不同的音色特点，可以根据书籍类型和个人喜好选择。',
                position: 'bottom',
                highlightParent: 2
            },
            {
                target: '#delaySlider',
                title: '请求延迟',
                content: '设置每次TTS请求之间的延迟时间。延迟越长越稳定，但会影响合成速度。建议根据Cookie数量调整。',
                position: 'top',
                highlightParent: 2
            },
            {
                target: '#mainImportBtn',
                title: '一键导入',
                content: '配置完成后，点击此按钮可以自动唤起阅读APP并导入配置。如果无法自动唤起，可以手动复制链接导入。',
                position: 'top'
            }
        ];
    },

    /**
     * 获取阅读TTS页面引导步骤（预制书模式）
     * @returns {Array<Object>} 引导步骤配置
     */
    getLegadoPrefabSteps() {
        return [
            {
                target: '.mode-tabs',
                title: '模式切换',
                content: '阅读TTS支持两种模式：实时模式（边读边合成）和预制书模式（提前合成整本书）。根据您的需求选择合适的模式。',
                position: 'bottom'
            },
            {
                target: '#prefabModeContent',
                title: '预制书模式',
                content: '预制书模式下，您可以提前将整本书的语音合成完成并缓存。制作的主要目的是为了以时间换取稳定，按需使用。',
                position: 'right'
            },
            {
                target: '.prefab-source-tabs-inline',
                title: '数据来源',
                content: '预制书支持两种数据来源：连接阅读APP获取书籍，或上传本地TXT文件进行预制。',
                position: 'bottom'
            },
            {
                target: '#prefabServerIp',
                title: '连接设置',
                content: '首先配置阅读APP的Web服务IP和端口，然后点击连接按钮获取书籍列表。',
                position: 'bottom',
                highlightParent: 3
            },
            {
                target: '#bookSelectorContainer',
                title: '书籍库',
                content: '连接成功后，这里会显示阅读APP中的书籍列表。点击书籍可以查看章节并选择要预制的章节。',
                position: 'right'
            },
            {
                target: '#startProcessingBtn',
                title: '开始预制',
                content: '配置完成后，点击此按钮开始预制书籍语音。预制过程可能需要一些时间，请耐心等待。',
                position: 'top',
                highlightParent: 2
            }
        ];
    },

    /**
     * 获取阅读TTS页面引导步骤（TXT模式）
     * @returns {Array<Object>} 引导步骤配置
     */
    getLegadoTxtSteps() {
        return [
            {
                target: '.mode-tabs',
                title: '模式切换',
                content: '阅读TTS支持两种模式：实时模式（边读边合成）和预制书模式（提前合成整本书）。根据您的需求选择合适的模式。',
                position: 'bottom'
            },
            {
                target: '#prefabModeContent',
                title: '预制书模式',
                content: '预制书模式下，您可以提前将整本书的语音合成完成并缓存。制作的主要目的是为了以时间换取稳定，按需使用。',
                position: 'right'
            },
            {
                target: '.prefab-source-tabs-inline',
                title: '数据来源',
                content: '预制书支持两种数据来源：连接阅读APP获取书籍，或上传本地TXT文件进行预制。点击图标可以切换数据来源。',
                position: 'bottom'
            },
            {
                target: '#txtUploadArea',
                title: '上传TXT文件',
                content: '点击或拖拽上传TXT格式的小说文件。系统会自动识别章节并生成章节列表。',
                position: 'bottom',
                highlightParent: 2
            },
            {
                target: '#txtBookNameInput',
                title: '设置书名',
                content: '上传文件后，可以在这里编辑书名。书名会用于生成音频文件的命名。',
                position: 'bottom',
                highlightParent: 2
            },
            {
                target: '#txtChapterSelectorContainer',
                title: '章节列表',
                content: '系统会自动识别TXT文件中的章节。在这里选择您想要预制的章节，可以多选。',
                position: 'right'
            },
            {
                target: '#startProcessingBtn',
                title: '开始预制',
                content: '配置完成后，点击此按钮开始预制书籍语音。预制过程可能需要一些时间，请耐心等待。',
                position: 'top',
                highlightParent: 2
            }
        ];
    },

    /**
     * 创建引导元素
     */
    createElements() {
        // 创建遮罩层
        this.overlay = document.createElement('div');
        this.overlay.className = 'onboarding-overlay';
        document.body.appendChild(this.overlay);

        // 创建高亮框
        this.highlight = document.createElement('div');
        this.highlight.className = 'onboarding-highlight';
        document.body.appendChild(this.highlight);

        // 创建提示框
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'onboarding-tooltip';
        this.tooltip.innerHTML = `
            <div class="onboarding-tooltip-header">
                <h4 class="onboarding-tooltip-title"></h4>
                <span class="onboarding-step-indicator"></span>
            </div>
            <div class="onboarding-tooltip-content"></div>
            <div class="onboarding-tooltip-footer">
                <button class="onboarding-btn onboarding-btn-skip">跳过</button>
                <div class="onboarding-btn-group">
                    <button class="onboarding-btn onboarding-btn-prev">上一步</button>
                    <button class="onboarding-btn onboarding-btn-next">下一步</button>
                </div>
            </div>
        `;
        document.body.appendChild(this.tooltip);

        // 绑定按钮事件
        this.bindTooltipEvents();
    },

    /**
     * 绑定提示框事件
     */
    bindTooltipEvents() {
        const skipBtn = this.tooltip.querySelector('.onboarding-btn-skip');
        const prevBtn = this.tooltip.querySelector('.onboarding-btn-prev');
        const nextBtn = this.tooltip.querySelector('.onboarding-btn-next');

        skipBtn.addEventListener('click', () => this.skip());
        prevBtn.addEventListener('click', () => this.prev());
        nextBtn.addEventListener('click', () => this.next());

        // 点击遮罩层跳过引导
        this.overlay.addEventListener('click', () => this.skip());

        // 键盘导航
        document.addEventListener('keydown', (e) => {
            if (!this.isActive) return;
            if (e.key === 'Escape') this.skip();
            if (e.key === 'ArrowRight') this.next();
            if (e.key === 'ArrowLeft') this.prev();
        });
    },

    /**
     * 清除最小化状态
     */
    clearMinimized() {
        this.clearAutoHideTimer();
        if (this.minimizedBtn) {
            this.minimizedBtn.remove();
            this.minimizedBtn = null;
        }
        this.isMinimized = false;
    },

    /**
     * 显示指定步骤
     * @param {number} index - 步骤索引
     */
    showStep(index) {
        if (index < 0 || index >= this.steps.length) return;

        this.currentStep = index;
        const step = this.steps[index];

        // 如果需要切换到预制书模式
        if (step.switchToPrefabMode) {
            this.switchToPrefabMode();
            // 切换模式后，给DOM一点时间更新，然后查找元素
            setTimeout(() => {
                const target = document.querySelector(step.target);
                this.continueShowStep(step, target);
            }, 200);
            return;
        }

        // 查找目标元素
        const target = document.querySelector(step.target);
        this.continueShowStep(step, target);
    },

    /**
     * 继续显示步骤（在可能的延迟后）
     * @param {Object} step - 步骤配置
     * @param {HTMLElement|null} target - 目标元素
     */
    continueShowStep(step, target) {
        if (!target) {
            console.warn('[Onboarding] 目标元素未找到:', step.target);
            // 跳过此步骤
            if (this.currentStep < this.steps.length - 1) {
                this.next();
            } else {
                this.complete();
            }
            return;
        }

        // 确定要高亮的元素（如果有highlightParent选项，则高亮父级元素）
        let highlightTarget = target;
        if (step.highlightParent && step.highlightParent > 0) {
            let parent = target;
            for (let i = 0; i < step.highlightParent; i++) {
                if (parent.parentElement) {
                    parent = parent.parentElement;
                }
            }
            highlightTarget = parent;
        }

        // 滚动到目标元素，然后更新位置
        highlightTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 等待滚动完成后更新位置
        setTimeout(() => {
            // 更新高亮框位置
            this.updateHighlight(highlightTarget);

            // 更新提示框内容（提示框仍然基于原始目标元素定位）
            this.updateTooltip(step, highlightTarget);
        }, 350);

        // 更新按钮状态
        this.updateButtonStates();
    },

    /**
     * 切换到预制书模式
     */
    switchToPrefabMode() {
        console.log('[Onboarding] 正在切换到预制书模式...');

        // 获取标签元素
        const prefabTab = document.querySelector('.mode-tab[data-mode="prefab"]');
        const realtimeTab = document.querySelector('.mode-tab[data-mode="realtime"]');

        // 更新标签状态
        if (realtimeTab) {
            realtimeTab.classList.remove('active');
        }
        if (prefabTab) {
            prefabTab.classList.add('active');
        }

        // 显示预制书模式内容
        const prefabContent = document.getElementById('prefabModeContent');
        if (prefabContent) {
            prefabContent.style.display = 'block';
            console.log('[Onboarding] 预制书模式内容已显示');
        }

        // 隐藏实时模式内容
        const realtimeContent = document.getElementById('realtimeModeContent');
        if (realtimeContent) {
            realtimeContent.style.display = 'none';
            console.log('[Onboarding] 实时模式内容已隐藏');
        }

        // 触发点击事件（如果页面有其他逻辑需要）
        if (prefabTab) {
            prefabTab.click();
        }

        console.log('[Onboarding] 已切换到预制书模式');
    },

    /**
     * 更新高亮框位置
     * @param {HTMLElement} target - 目标元素
     */
    updateHighlight(target) {
        const rect = target.getBoundingClientRect();
        const padding = 8;

        // 确保使用视口坐标，不受滚动影响
        this.highlight.style.cssText = `
            position: fixed;
            top: ${rect.top - padding}px;
            left: ${rect.left - padding}px;
            width: ${rect.width + padding * 2}px;
            height: ${rect.height + padding * 2}px;
            border-radius: 8px;
            box-shadow: 
                0 0 0 4px var(--primary-color, #4a6bff),
                0 0 0 9999px rgba(0, 0, 0, 0.6);
            z-index: 9998;
            pointer-events: none;
            transition: all 0.3s ease;
        `;
    },

    /**
     * 更新提示框内容
     * @param {Object} step - 步骤配置
     * @param {HTMLElement} [highlightTarget] - 高亮目标元素（可选）
     */
    updateTooltip(step, highlightTarget) {
        const title = this.tooltip.querySelector('.onboarding-tooltip-title');
        const content = this.tooltip.querySelector('.onboarding-tooltip-content');
        const indicator = this.tooltip.querySelector('.onboarding-step-indicator');

        title.textContent = step.title;
        content.textContent = step.content;
        indicator.textContent = `${this.currentStep + 1} / ${this.steps.length}`;

        // 定位提示框（使用高亮目标元素作为定位参考）
        this.positionTooltip(step, highlightTarget);
    },

    /**
     * 定位提示框
     * @param {Object} step - 步骤配置
     * @param {HTMLElement} [highlightTarget] - 高亮目标元素（可选）
     */
    positionTooltip(step, highlightTarget) {
        // 使用高亮目标元素作为定位参考，如果没有则使用原始目标
        const target = highlightTarget || document.querySelector(step.target);
        if (!target) return;

        // 先让提示框可见以获取正确尺寸
        this.tooltip.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            z-index: 9999;
            opacity: 0;
            visibility: visible;
            max-width: ${window.innerWidth < 768 ? '90vw' : '360px'};
        `;

        // 强制重绘以获取正确尺寸
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const margin = 16;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 移动端优化：小屏幕时强制居中显示
        let top, left;
        const isMobile = viewportWidth < 768;

        if (isMobile) {
            // 移动端：提示框居中显示，避免被遮挡
            top = rect.bottom + margin;
            left = (viewportWidth - tooltipRect.width) / 2;
            
            // 如果下方空间不足，显示在上方
            if (top + tooltipRect.height > viewportHeight - margin) {
                top = rect.top - tooltipRect.height - margin;
            }
            
            // 如果上方空间也不足，强制居中
            if (top < margin) {
                top = (viewportHeight - tooltipRect.height) / 2;
            }
        } else {
            // 桌面端：根据指定位置计算坐标
            switch (step.position) {
                case 'top':
                    top = rect.top - tooltipRect.height - margin;
                    left = rect.left + (rect.width - tooltipRect.width) / 2;
                    break;
                case 'bottom':
                    top = rect.bottom + margin;
                    left = rect.left + (rect.width - tooltipRect.width) / 2;
                    break;
                case 'left':
                    top = rect.top + (rect.height - tooltipRect.height) / 2;
                    left = rect.left - tooltipRect.width - margin;
                    break;
                case 'right':
                    top = rect.top + (rect.height - tooltipRect.height) / 2;
                    left = rect.right + margin;
                    break;
                default:
                    top = rect.bottom + margin;
                    left = rect.left + (rect.width - tooltipRect.width) / 2;
            }
        }

        // 边界检查 - 确保提示框不超出视口
        if (left < margin) {
            left = margin;
        } else if (left + tooltipRect.width > viewportWidth - margin) {
            left = viewportWidth - tooltipRect.width - margin;
        }
        
        if (top < margin) {
            top = margin;
        } else if (top + tooltipRect.height > viewportHeight - margin) {
            top = viewportHeight - tooltipRect.height - margin;
        }

        this.tooltip.style.cssText = `
            position: fixed;
            top: ${top}px;
            left: ${left}px;
            z-index: 9999;
            opacity: 1;
            visibility: visible;
        `;
    },

    /**
     * 更新按钮状态
     */
    updateButtonStates() {
        const prevBtn = this.tooltip.querySelector('.onboarding-btn-prev');
        const nextBtn = this.tooltip.querySelector('.onboarding-btn-next');

        prevBtn.disabled = this.currentStep === 0;
        prevBtn.style.display = this.currentStep === 0 ? 'none' : 'block';

        if (this.currentStep === this.steps.length - 1) {
            nextBtn.textContent = '完成';
            nextBtn.classList.add('onboarding-btn-finish');
        } else {
            nextBtn.textContent = '下一步';
            nextBtn.classList.remove('onboarding-btn-finish');
        }
    },

    /**
     * 下一步
     */
    next() {
        if (this.currentStep < this.steps.length - 1) {
            this.showStep(this.currentStep + 1);
        } else {
            this.complete();
        }
    },

    /**
     * 上一步
     */
    prev() {
        if (this.currentStep > 0) {
            this.showStep(this.currentStep - 1);
        }
    },

    /**
     * 跳过引导
     */
    skip() {
        // 保存跳过状态（与完成状态相同，下次不再自动显示）
        localStorage.setItem(this.STORAGE_KEY, 'true');
        localStorage.setItem(this.VERSION_KEY, this.CURRENT_VERSION);

        this.destroy();
        // 显示帮助按钮
        this.showHelpButton();
        console.log('[Onboarding] 用户跳过了新手引导');
    },

    /**
     * 完成引导
     */
    complete() {
        // 保存完成状态
        localStorage.setItem(this.STORAGE_KEY, 'true');
        localStorage.setItem(this.VERSION_KEY, this.CURRENT_VERSION);

        this.destroy();
        // 显示帮助按钮
        this.showHelpButton();
        console.log('[Onboarding] 新手引导已完成');

        // 显示完成提示
        this.showCompletionToast();
    },

    /**
     * 显示完成提示
     */
    showCompletionToast() {
        const toast = document.createElement('div');
        toast.className = 'onboarding-completion-toast';
        toast.innerHTML = `
            <i class="fas fa-check-circle"></i>
            <span>新手引导已完成！您现在可以开始使用了</span>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    /**
     * 销毁引导元素
     */
    destroy() {
        this.isActive = false;

        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }

        if (this.highlight) {
            this.highlight.remove();
            this.highlight = null;
        }

        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
    },

    /**
     * 重置引导状态（用于测试）
     */
    reset() {
        localStorage.removeItem(this.STORAGE_KEY);
        localStorage.removeItem(this.VERSION_KEY);
        console.log('[Onboarding] 引导状态已重置');
    }
};

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    OnboardingManager.init();
});

// 导出模块（如果支持模块化）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OnboardingManager;
}
