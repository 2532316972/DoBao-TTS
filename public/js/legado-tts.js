/**
 * 阅读TTS配置页面脚本
 */

// localStorage键名
const STORAGE_KEYS = {
  DELAY: 'legado_tts_delay',
  VOICE_ID: 'legado_tts_voice_id',
  ENGINE_NAME: 'legado_tts_engine_name',
  ENGINE_NAME_CUSTOM: 'legado_tts_engine_name_custom',
  CURRENT_TEMPLATE: 'legado_tts_current_template',
  CURRENT_MODE: 'legado_tts_current_mode',
  PREFAB_SERVER_IP: 'legado_tts_prefab_server_ip',
  PREFAB_SERVER_PORT: 'legado_tts_prefab_server_port',
  PREFAB_DELAY: 'legado_tts_prefab_delay',
  PREFAB_SPEED: 'legado_tts_prefab_speed',
  PREFAB_CONCURRENT: 'legado_tts_prefab_concurrent',
  PREFAB_SELECTED_BOOK: 'legado_tts_prefab_selected_book',
  PREFAB_SELECTED_CHAPTER: 'legado_tts_prefab_selected_chapter',
  PREFAB_SELECTED_CHAPTERS: 'legado_tts_prefab_selected_chapters',
  PREFAB_SELECTED_VOICE: 'legado_tts_prefab_selected_voice',
  BOOK_CACHE_STATUS: 'legado_tts_book_cache_status',
  BOOK_CACHE_DATA: 'legado_tts_book_cache_data',
  CHAPTER_LIST_SCROLL_POSITIONS: 'legado_tts_chapter_scroll_positions',
  CACHED_BOOKS: 'legado_tts_cached_books',
  SCHEDULED_PREFETCH_CONFIG: 'legado_tts_scheduled_prefetch_config'
}

// 书籍缓存状态管理
const bookCacheStatus = new Map()
let availableVoices = []

// Web连接状态
let isWebConnected = false

/**
 * 获取bookId
 * 优先使用后端返回的bookId，如果没有则使用bookUrl
 * @param {Object} book - 书籍对象
 * @returns {string} bookId
 */
function getBookId(book) {
  if (!book) return 'unknown'

  // 优先使用后端返回的bookId
  if (book.bookId && /^[a-f0-9]{16}$/i.test(book.bookId)) {
    return book.bookId.toLowerCase()
  }

  // 如果没有bookId，使用bookUrl作为标识
  // 后端会使用getSafeDirName将bookUrl转换为短哈希
  if (book.bookUrl) {
    return book.bookUrl
  }

  console.warn('[getBookId] 书籍没有有效的bookId和bookUrl:', book.name)
  return 'unknown'
}

/**
 * 从localStorage获取bookId
 * @param {Object} book - 从localStorage解析的书籍对象
 * @returns {string} bookId
 */
function getBookIdFromStorage(book) {
  if (!book) return 'unknown'

  // 优先使用保存的bookId（如果是短哈希格式）
  if (book.bookId && /^[a-f0-9]{16}$/i.test(book.bookId)) {
    return book.bookId.toLowerCase()
  }

  // 如果bookId不是短哈希，但bookUrl存在，使用bookUrl
  // 后端会使用getSafeDirName将bookUrl转换为短哈希
  if (book.bookUrl) {
    return book.bookUrl
  }

  console.warn('[getBookIdFromStorage] 存储的书籍没有有效的bookId和bookUrl:', book.name)
  return 'unknown'
}

function loadBookCacheStatus() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.BOOK_CACHE_STATUS)
    if (saved) {
      const data = JSON.parse(saved)
      Object.entries(data).forEach(([key, value]) => {
        bookCacheStatus.set(key, value)
      })
    }
  } catch (error) {
    console.error('加载书籍缓存状态失败:', error)
  }
}

function saveBookCacheStatus() {
  try {
    const data = Object.fromEntries(bookCacheStatus)
    localStorage.setItem(STORAGE_KEYS.BOOK_CACHE_STATUS, JSON.stringify(data))
  } catch (error) {
    console.error('保存书籍缓存状态失败:', error)
  }
}

function updateBookCacheStatus(bookUrl, status, info = {}) {
  bookCacheStatus.set(bookUrl, {
    status,
    ...info,
    updatedAt: new Date().toISOString()
  })
  saveBookCacheStatus()
}

function getBookCacheStatus(bookUrl) {
  return bookCacheStatus.get(bookUrl) || null
}

/**
 * 加载并显示本地缓存的书籍
 * 在页面加载时调用，不需要Web服务连接
 */
async function loadCachedBooks() {
  try {
    // 只获取book-cache来源的缓存书籍，不包括prefetch
    const response = await fetch('/api/legado/book-cache/list?source=cache')
    const result = await response.json()

    if (result.success && Array.isArray(result.data) && result.data.length > 0) {
      const cachedBooks = result.data
      console.log('[loadCachedBooks] 加载到本地缓存书籍:', cachedBooks.length)

      // 将缓存书籍转换为书架格式
      const books = cachedBooks.map(cb => ({
        bookId: cb.bookId,
        bookUrl: cb.bookUrl,
        name: cb.name,
        author: cb.author,
        totalChapters: cb.totalChapters,
        cachedChapters: cb.cachedChapters,
        coverUrl: cb.coverUrl
      }))

      // 创建当前缓存书籍URL集合
      const cachedBookUrls = new Set(cachedBooks.map(cb => cb.bookUrl))

      // 清理不在当前缓存列表中的旧缓存状态
      for (const [bookUrl, status] of bookCacheStatus.entries()) {
        if (!cachedBookUrls.has(bookUrl)) {
          console.log(`[loadCachedBooks] 清理不在当前缓存列表中的旧状态: ${bookUrl}`)
          bookCacheStatus.delete(bookUrl)
        }
      }

      // 更新本地缓存状态
      cachedBooks.forEach(cb => {
        // 根据后端状态确定前端状态
        // 如果状态是 paused，则显示为 paused
        const isPaused = cb.status === 'paused' || cb.cachedChapters < cb.totalChapters
        const status = isPaused ? 'paused' : 'cached'
        
        updateBookCacheStatus(cb.bookUrl, status, {
          bookName: cb.name,
          chapterCount: cb.totalChapters || 0,
          cachedChapters: cb.cachedChapters || 0,
          totalChapters: cb.totalChapters || 0,
          cachedAt: cb.cachedAt || new Date().toISOString(),
          chapterList: cb.chapterList || [],
          backendStatus: cb.status // 保存后端原始状态
        })
      })

      // 渲染缓存书籍到书架（Web未连接，不显示缓存按钮）
      renderBookshelf(books, new Set())

      // 显示提示
      showToast(`已加载 ${books.length} 本本地缓存书籍`, 'success')
    } else {
      // 后端没有缓存数据，清除 localStorage 中的旧缓存状态
      // 避免显示之前项目留下的"已缓存"标记
      console.log('[loadCachedBooks] 后端无缓存数据，清除本地缓存状态')
      bookCacheStatus.clear()
      saveBookCacheStatus()
      // 清空书架显示
      renderBookshelf([], new Set())
    }
  } catch (error) {
    console.log('[loadCachedBooks] 暂无本地缓存书籍或加载失败:', error.message)
  }
}

const templates = {
  default: { voiceId: 'zh_female_wenroutaozi_uranus_bigtts', delay: 5 },
  fast: { voiceId: 'zh_female_wenroutaozi_uranus_bigtts', delay: 1 },
  quality: { voiceId: 'zh_female_wenroutaozi_uranus_bigtts', delay: 10 }
}

let elements = {}
let currentTemplate = 'custom'
let currentMode = 'realtime'
let prefabSelectedVoice = null
let currentTaskId = null
let progressInterval = null

const UI_STATES = { BOOKSHELF_VIEW: 'bookshelf_view', CHAPTER_VIEW: 'chapter_view' }
let currentUIState = UI_STATES.BOOKSHELF_VIEW

class UIStateManager {
  constructor() { this.currentState = UI_STATES.BOOKSHELF_VIEW }
  showBookshelf() {
    this.currentState = UI_STATES.BOOKSHELF_VIEW
    const bookSelector = document.getElementById('bookSelectorContainer')
    const chapterSelector = document.getElementById('chapterSelectorContainer')
    if (bookSelector && chapterSelector) {
      bookSelector.style.display = 'block'
      chapterSelector.style.display = 'none'
    }
  }
  showChapterList(bookName) {
    this.currentState = UI_STATES.CHAPTER_VIEW
    const bookSelector = document.getElementById('bookSelectorContainer')
    const chapterSelector = document.getElementById('chapterSelectorContainer')
    if (bookSelector && chapterSelector) {
      bookSelector.style.display = 'none'
      chapterSelector.style.display = 'block'
    }
  }
}

const uiStateManager = new UIStateManager()

/**
 * 检测是否为安卓设备
 * @returns {boolean} 是否为安卓设备
 */
function isAndroidDevice() {
  const userAgent = navigator.userAgent.toLowerCase()
  return /android/.test(userAgent)
}

/**
 * 初始化移动端提示显示
 * 如果是安卓设备，隐藏提示
 */
function initMobileTips() {
  if (isAndroidDevice()) {
    const realtimeTip = document.getElementById('mobileTipRealtime')
    const prefabTip = document.getElementById('mobileTipPrefab')
    
    if (realtimeTip) {
      realtimeTip.style.display = 'none'
    }
    if (prefabTip) {
      prefabTip.style.display = 'none'
    }
    
    console.log('[initMobileTips] 检测到安卓设备，已隐藏移动端提示')
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initElements()
  restoreSettings()
  loadBookCacheStatus()
  loadChapterScrollPositions() // 加载章节列表滚动位置记录
  await loadVoices()
  bindEvents()
  bindChapterListScrollEvent() // 绑定章节列表滚动事件
  updatePreview()
  initModeSwitch()
  initTaskManager()
  initMobileTips() // 初始化移动端提示显示
  initPrefabSourceTabs() // 初始化预制书模式切换
  initTxtUpload() // 初始化TXT文件上传
  initScheduledPrefetch() // 初始化定时预制面板

  // 页面加载时自动加载正在处理的任务到处理信息卡片
  // 注意：本地缓存书籍由 initModeSwitch -> switchMode -> loadCachedBooks 加载，不需要重复调用
  if (currentMode === 'prefab') {
    await autoLoadProcessingTask()
  }
})

/**
 * 自动加载正在处理的任务到处理信息卡片
 * 页面加载时调用，只自动加载正在处理（processing）的任务
 */
async function autoLoadProcessingTask() {
  try {
    // 获取所有任务
    const response = await fetch('/api/legado/prefetch/tasks')
    const result = await response.json()

    if (!result.success || !result.data || result.data.length === 0) {
      return
    }

    // 只查找正在处理的任务
    const processingTask = result.data.find(t => t.status === 'processing')

    if (!processingTask) {
      return
    }

    console.log('[autoLoadProcessingTask] 发现正在处理的任务:', {
      taskId: processingTask.taskId,
      status: processingTask.status,
      bookName: processingTask.bookInfo?.bookName
    })

    // 自动加载任务到处理信息卡片
    const bookId = processingTask.bookInfo?.bookId || processingTask.bookInfo?.bookUrl
    const bookName = processingTask.bookInfo?.bookName

    if (bookId && bookName) {
      await loadTaskToProgressCard(processingTask.taskId, bookId, bookName)
      showToast(`已自动加载正在处理的任务：${bookName}`, 'info')
    }
  } catch (error) {
    console.error('[autoLoadProcessingTask] 自动加载任务失败:', error)
  }
}

function initElements() {
  elements = {
    realtimeModeContent: document.getElementById('realtimeModeContent'),
    prefabModeContent: document.getElementById('prefabModeContent'),
    modeTabs: document.querySelectorAll('.mode-tab'),
    voiceSelect: document.getElementById('voiceSelect'),
    delaySlider: document.getElementById('delaySlider'),
    delayValue: document.getElementById('delayValue'),
    summaryVoice: document.getElementById('summaryVoice'),
    summaryDelay: document.getElementById('summaryDelay'),
    validationStatus: document.getElementById('validationStatus'),
    mainImportBtn: document.getElementById('mainImportBtn'),
    copyConfigBtn: document.getElementById('copyConfigBtn'),
    prefabServerIp: document.getElementById('prefabServerIp'),
    prefabServerPort: document.getElementById('prefabServerPort'),
    refreshBooksBtn: document.getElementById('refreshBooksBtn'),
    prefabVoiceSelect: document.getElementById('prefabVoiceSelect'),
    prefabDelaySlider: document.getElementById('prefabDelaySlider'),
    prefabDelayValue: document.getElementById('prefabDelayValue'),
    prefabSpeedSlider: document.getElementById('prefabSpeedSlider'),
    prefabSpeedValue: document.getElementById('prefabSpeedValue'),
    bookshelfGrid: document.getElementById('bookshelfGrid'),
    bookshelfEmpty: document.getElementById('bookshelfEmpty'),
    chapterList: document.getElementById('chapterList'),
    chapterListEmpty: document.getElementById('chapterListEmpty'),
    bookSelectorContainer: document.getElementById('bookSelectorContainer'),
    chapterSelectorContainer: document.getElementById('chapterSelectorContainer'),
    backToBookshelfBtn: document.getElementById('backToBookshelfBtn'),
    viewCacheManagerBtn: document.getElementById('viewCacheManagerBtn'),
    cacheManagerModal: document.getElementById('cacheManagerModal'),
    cacheManagerBody: document.getElementById('cacheManagerBody'),
    closeCacheModal: document.getElementById('closeCacheModal'),
    viewPrefetchManagerBtn: document.getElementById('viewPrefetchManagerBtn'),
    prefetchManagerModal: document.getElementById('prefetchManagerModal'),
    prefetchManagerBody: document.getElementById('prefetchManagerBody'),
    closePrefetchModal: document.getElementById('closePrefetchModal'),
    viewPrefetchedContentBtn: document.getElementById('viewPrefetchedContentBtn'),
    prefetchedContentModal: document.getElementById('prefetchedContentModal'),
    prefetchedContentBody: document.getElementById('prefetchedContentBody'),
    closePrefetchedContentModal: document.getElementById('closePrefetchedContentModal'),
    prefabValidationStatus: document.getElementById('prefabValidationStatus'),
    prefabSummaryVoice: document.getElementById('prefabSummaryVoice'),
    prefabSummaryBookName: document.getElementById('prefabSummaryBookName'),
    prefabSummaryChapter: document.getElementById('prefabSummaryChapter'),
    startProcessingBtn: document.getElementById('startProcessingBtn'),
    processingProgressCard: document.getElementById('processingProgressCard'),
    processingProgressBar: document.getElementById('processingProgressBar'),
    processingProgressText: document.getElementById('processingProgressText'),
    processingProgressCount: document.getElementById('processingProgressCount'),
    processingElapsedTime: document.getElementById('processingElapsedTime'),
    processingRemainingTime: document.getElementById('processingRemainingTime'),
    processingCurrentStatus: document.getElementById('processingCurrentStatus'),
    pauseProcessingBtn: document.getElementById('pauseProcessingBtn'),
    cancelProcessingBtn: document.getElementById('cancelProcessingBtn'),
    fallbackSection: document.getElementById('fallbackSection'),
    fallbackUrlInput: document.getElementById('fallbackUrlInput'),
    fallbackCopyBtn: document.getElementById('fallbackCopyBtn'),
    fallbackCloseBtn: document.getElementById('fallbackCloseBtn'),
    // 预制模式在线朗读引擎相关元素
    prefabImportBtn: document.getElementById('prefabImportBtn'),
    prefabCopyLinkBtn: document.getElementById('prefabCopyLinkBtn'),
    prefabImportFallback: document.getElementById('prefabImportFallback'),
    prefabImportUrlInput: document.getElementById('prefabImportUrlInput'),
    prefabCopyFallbackBtn: document.getElementById('prefabCopyFallbackBtn'),
    // TXT预制书相关元素
    prefabWebContent: document.getElementById('prefabWebContent'),
    prefabTxtContent: document.getElementById('prefabTxtContent'),
    txtUploadArea: document.getElementById('txtUploadArea'),
    txtFileInput: document.getElementById('txtFileInput'),
    txtFileInfo: document.getElementById('txtFileInfo'),
    txtFileName: document.getElementById('txtFileName'),
    txtFileSize: document.getElementById('txtFileSize'),
    txtChapterCount: document.getElementById('txtChapterCount'),
    txtFileRemove: document.getElementById('txtFileRemove'),
    // 定时预制相关元素
    scheduledPrefetchToggle: document.getElementById('scheduledPrefetchToggle'),
    scheduledPrefetchContent: document.getElementById('scheduledPrefetchContent'),
    scheduledPrefetchArrow: document.getElementById('scheduledPrefetchArrow'),
    scheduledPrefetchStatus: document.getElementById('scheduledPrefetchStatus'),
    scheduledIntervalSlider: document.getElementById('scheduledIntervalSlider'),
    scheduledIntervalValue: document.getElementById('scheduledIntervalValue'),
    scheduledChaptersSlider: document.getElementById('scheduledChaptersSlider'),
    scheduledChaptersValue: document.getElementById('scheduledChaptersValue'),
    scheduledEnableToggle: document.getElementById('scheduledEnableToggle'),
    scheduledStatusDisplay: document.getElementById('scheduledStatusDisplay'),
    scheduledNextRun: document.getElementById('scheduledNextRun'),
    scheduledProgress: document.getElementById('scheduledProgress'),
    scheduledLastRun: document.getElementById('scheduledLastRun'),
    scheduledSaveBtn: document.getElementById('scheduledSaveBtn'),
    scheduledDeleteBtn: document.getElementById('scheduledDeleteBtn')
  }
}

function restoreSettings() {
  const savedMode = localStorage.getItem(STORAGE_KEYS.CURRENT_MODE)
  if (savedMode) currentMode = savedMode

  const savedDelay = localStorage.getItem(STORAGE_KEYS.DELAY)
  if (savedDelay) {
    elements.delaySlider.value = savedDelay
    elements.delayValue.textContent = savedDelay
  }

  const savedTemplate = localStorage.getItem(STORAGE_KEYS.CURRENT_TEMPLATE)
  if (savedTemplate) {
    currentTemplate = savedTemplate
    document.querySelectorAll('.template-card').forEach(card => {
      card.classList.toggle('active', card.dataset.template === savedTemplate)
    })
  }

  // 恢复服务器IP设置，如果没有保存的数据则默认为空
  const savedServerIp = localStorage.getItem(STORAGE_KEYS.PREFAB_SERVER_IP)
  if (savedServerIp !== null) {
    elements.prefabServerIp.value = savedServerIp
  }

  // 恢复服务器端口设置，如果没有保存的数据则默认为空
  const savedServerPort = localStorage.getItem(STORAGE_KEYS.PREFAB_SERVER_PORT)
  if (savedServerPort !== null) {
    elements.prefabServerPort.value = savedServerPort
  }

  const savedPrefabDelay = localStorage.getItem(STORAGE_KEYS.PREFAB_DELAY)
  if (savedPrefabDelay && elements.prefabDelaySlider) {
    // 限制在50-100范围内
    let delay = parseInt(savedPrefabDelay)
    delay = Math.max(50, Math.min(100, delay))
    elements.prefabDelaySlider.value = delay
    if (elements.prefabDelayValue) elements.prefabDelayValue.textContent = delay + '秒'
    // 如果值被修正，更新localStorage
    if (delay !== parseInt(savedPrefabDelay)) {
      localStorage.setItem(STORAGE_KEYS.PREFAB_DELAY, delay)
    }
  }

  const savedPrefabSpeed = localStorage.getItem(STORAGE_KEYS.PREFAB_SPEED)
  if (savedPrefabSpeed && elements.prefabSpeedSlider) {
    const speed = parseInt(savedPrefabSpeed)
    elements.prefabSpeedSlider.value = speed
    // 默认值为0时显示"正常"，其他显示数值
    if (elements.prefabSpeedValue) {
      elements.prefabSpeedValue.textContent = speed === 0 ? '正常' : speed
    }
  }

  const savedPrefabVoice = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_VOICE)
  if (savedPrefabVoice) prefabSelectedVoice = savedPrefabVoice
}

/**
 * 获取语速标签
 * @param {number} speed - 语速值
 * @returns {string} 语速标签
 */
function getSpeedLabel(speed) {
  if (speed < -20) return '较慢'
  if (speed < 0) return '稍慢'
  if (speed === 0) return '正常'
  if (speed < 30) return '稍快'
  if (speed < 60) return '较快'
  return '很快'
}

async function loadVoices() {
  try {
    const response = await fetch('/api/voices')
    const data = await response.json()
    if (data.code === 0 && data.data) {
      availableVoices = data.data
      elements.voiceSelect.innerHTML = '<option value="">请选择发音人...</option>'
      data.data.forEach(voice => {
        const option = document.createElement('option')
        option.value = voice.style_id
        option.textContent = voice.name
        elements.voiceSelect.appendChild(option)
      })

      const savedVoiceId = localStorage.getItem(STORAGE_KEYS.VOICE_ID)
      const defaultVoiceId = 'zh_female_wenroutaozi_uranus_bigtts'
      const targetVoiceId = savedVoiceId || defaultVoiceId

      const targetOption = Array.from(elements.voiceSelect.options).find(option => option.value === targetVoiceId)
      if (targetOption) {
        elements.voiceSelect.value = targetVoiceId
        if (!savedVoiceId) localStorage.setItem(STORAGE_KEYS.VOICE_ID, defaultVoiceId)
        setTimeout(() => elements.voiceSelect.dispatchEvent(new Event('change', { bubbles: true })), 0)
      }

      renderPrefabVoiceSelector()
      updatePreview()
    } else {
      showToast('加载发音人列表失败', 'error')
    }
  } catch (error) {
    console.error('加载发音人失败:', error)
    showToast('加载发音人列表失败', 'error')
  }
}

function renderPrefabVoiceSelector() {
  if (!elements.prefabVoiceSelect) return
  const select = elements.prefabVoiceSelect
  select.innerHTML = '<option value="">请选择发音人...</option>'

  const savedVoice = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_VOICE)
  const defaultVoice = 'zh_female_wenroutaozi_uranus_bigtts'
  const selectedVoiceId = prefabSelectedVoice || savedVoice || defaultVoice

  availableVoices.forEach(voice => {
    const option = document.createElement('option')
    option.value = voice.style_id
    option.textContent = voice.name
    select.appendChild(option)
  })

  // 设置选中的发音人
  if (selectedVoiceId) {
    select.value = selectedVoiceId
    prefabSelectedVoice = selectedVoiceId
    const selectedVoice = availableVoices.find(v => v.style_id === selectedVoiceId)
    if (selectedVoice) updatePrefabVoiceSummary(selectedVoice.name)
  }

  // 监听选择变化
  select.addEventListener('change', () => {
    prefabSelectedVoice = select.value
    localStorage.setItem(STORAGE_KEYS.PREFAB_SELECTED_VOICE, select.value)
    const selectedVoice = availableVoices.find(v => v.style_id === select.value)
    if (selectedVoice) {
      updatePrefabVoiceSummary(selectedVoice.name)
      showToast(`已选择发音人：${selectedVoice.name}`, 'success')
    }
    updatePrefabValidationStatus()
  })
}

function updatePrefabVoiceSummary(voiceName) {
  const summaryVoice = elements.prefabSummaryVoice
  if (summaryVoice) {
    summaryVoice.textContent = voiceName
    summaryVoice.classList.remove('prefab-status__item-value--empty')
  }
}

function bindEvents() {
  // 模式切换选项卡
  if (elements.modeTabs) {
    elements.modeTabs.forEach(tab => {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode))
    })
  }

  // 预制模式在线朗读引擎导入按钮
  if (elements.prefabImportBtn) {
    elements.prefabImportBtn.addEventListener('click', importPrefabEngineToLegado)
  }
  if (elements.prefabCopyLinkBtn) {
    elements.prefabCopyLinkBtn.addEventListener('click', copyPrefabEngineLink)
  }
  if (elements.prefabCopyFallbackBtn) {
    elements.prefabCopyFallbackBtn.addEventListener('click', copyPrefabFallbackUrl)
  }

  // 实时模式元素
  if (elements.voiceSelect) {
    elements.voiceSelect.addEventListener('change', () => {
      updateSummary()
      onConfigChange()
    })
  }
  if (elements.delaySlider) {
    elements.delaySlider.addEventListener('input', (e) => {
      onDelayChange(e)
      switchToCustomIfNeeded()
    })
  }

  if (elements.mainImportBtn) {
    elements.mainImportBtn.addEventListener('click', importToLegado)
  }

  if (elements.copyConfigBtn) {
    elements.copyConfigBtn.addEventListener('click', copyConfigLink)
  }

  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => applyTemplate(card.dataset.template))
  })


  if (elements.fallbackCopyBtn) {
    elements.fallbackCopyBtn.addEventListener('click', copyFallbackUrl)
  }
  if (elements.fallbackCloseBtn) {
    elements.fallbackCloseBtn.addEventListener('click', hideFallbackSection)
  }

  // 预制书模式元素
  if (elements.prefabServerIp) {
    elements.prefabServerIp.addEventListener('input', () => {
      savePrefabSettings()
      updatePrefabValidationStatus()
    })
  }
  if (elements.prefabServerPort) {
    elements.prefabServerPort.addEventListener('input', () => {
      savePrefabSettings()
      updatePrefabValidationStatus()
    })
  }
  if (elements.refreshBooksBtn) {
    elements.refreshBooksBtn.addEventListener('click', refreshBooksList)
  }

  if (elements.backToBookshelfBtn) {
    elements.backToBookshelfBtn.addEventListener('click', () => {
      // 返回书架时保存当前滚动位置并清空当前书籍
      if (currentBookUrl && elements.chapterList) {
        recordChapterScrollPosition(currentBookUrl, elements.chapterList.scrollTop)
      }
      currentBookUrl = null
      // 返回书架时清空章节选择
      selectedChapters.clear()
      uiStateManager.showBookshelf()
    })
  }

  // 章节多选操作按钮
  const selectToEndBtn = document.getElementById('selectToEndBtn')
  const clearSelectionBtn = document.getElementById('clearSelectionBtn')

  if (selectToEndBtn) {
    selectToEndBtn.addEventListener('click', selectChaptersToEnd)
  }

  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', clearChapterSelection)
  }

  if (elements.viewCacheManagerBtn) {
    elements.viewCacheManagerBtn.addEventListener('click', openCacheManager)
  }
  if (elements.closeCacheModal) {
    elements.closeCacheModal.addEventListener('click', closeCacheManager)
  }

  // 预制管理弹窗事件
  if (elements.viewPrefetchManagerBtn) {
    elements.viewPrefetchManagerBtn.addEventListener('click', openPrefetchManager)
  }
  if (elements.closePrefetchModal) {
    elements.closePrefetchModal.addEventListener('click', closePrefetchManager)
  }

  // 已预制内容管理弹窗事件
  if (elements.viewPrefetchedContentBtn) {
    elements.viewPrefetchedContentBtn.addEventListener('click', openPrefetchedContentManager)
  }
  if (elements.closePrefetchedContentModal) {
    elements.closePrefetchedContentModal.addEventListener('click', closePrefetchedContentManager)
  }
  // 点击遮罩层关闭已预制内容管理弹窗
  if (elements.prefetchedContentModal) {
    elements.prefetchedContentModal.addEventListener('click', (e) => {
      if (e.target === elements.prefetchedContentModal) {
        closePrefetchedContentManager()
      }
    })
  }

  // 预制书模式延迟滑块事件
  if (elements.prefabDelaySlider) {
    elements.prefabDelaySlider.addEventListener('input', (e) => {
      let delay = parseInt(e.target.value)
      // 范围限制在50-100
      delay = Math.max(50, Math.min(100, delay))
      e.target.value = delay
      if (elements.prefabDelayValue) elements.prefabDelayValue.textContent = delay + '秒'
      localStorage.setItem(STORAGE_KEYS.PREFAB_DELAY, delay)
    })
  }

  // 预制书模式语速滑块事件
  if (elements.prefabSpeedSlider) {
    elements.prefabSpeedSlider.addEventListener('input', (e) => {
      let speed = parseInt(e.target.value)
      // 靠近默认值0时吸附
      if (speed >= -3 && speed <= 3) {
        speed = 0
      }
      e.target.value = speed
      // 默认值为0时显示"正常"，其他显示数值
      if (elements.prefabSpeedValue) {
        elements.prefabSpeedValue.textContent = speed === 0 ? '正常' : speed
      }
      localStorage.setItem(STORAGE_KEYS.PREFAB_SPEED, speed)
    })
  }

  if (elements.startProcessingBtn) {
    elements.startProcessingBtn.addEventListener('click', startProcessing)
  }
  if (elements.pauseProcessingBtn) {
    elements.pauseProcessingBtn.addEventListener('click', togglePauseResume)
  }
  if (elements.cancelProcessingBtn) {
    elements.cancelProcessingBtn.addEventListener('click', cancelProcessing)
  }



  if (elements.cacheManagerModal) {
    elements.cacheManagerModal.addEventListener('click', (e) => {
      if (e.target === elements.cacheManagerModal) closeCacheManager()
    })
  }

  // 定时预制面板事件绑定
  bindScheduledPrefetchEvents()
}

function onConfigChangeWithTemplateSwitch() {
  switchToCustomIfNeeded()
  onConfigChange()
}

function switchToCustomIfNeeded() {
  if (currentTemplate !== 'custom') {
    currentTemplate = 'custom'
    document.querySelectorAll('.template-card').forEach(card => {
      card.classList.toggle('active', card.dataset.template === 'custom')
    })
  }
}

// 延迟提示防抖定时器
let delayChangeToastTimer = null

function onDelayChange(e) {
  elements.delayValue.textContent = e.target.value
  onConfigChange()
  // 防抖：清除之前的定时器，重新设置
  if (delayChangeToastTimer) {
    clearTimeout(delayChangeToastTimer)
  }
  // 延迟500ms后显示提示，避免拖动过程中频繁弹出
  delayChangeToastTimer = setTimeout(() => {
    showToast('延迟已修改，请重新导入到阅读APP以生效', 'info')
    delayChangeToastTimer = null
  }, 500)
}

function onConfigChange() {
  saveSettings()
  updatePreview()
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.DELAY, elements.delaySlider.value)
  localStorage.setItem(STORAGE_KEYS.VOICE_ID, elements.voiceSelect.value)
  localStorage.setItem(STORAGE_KEYS.CURRENT_TEMPLATE, currentTemplate)
}

function savePrefabSettings() {
  if (!elements.prefabServerIp || !elements.prefabServerPort) return
  localStorage.setItem(STORAGE_KEYS.PREFAB_SERVER_IP, elements.prefabServerIp.value)
  localStorage.setItem(STORAGE_KEYS.PREFAB_SERVER_PORT, elements.prefabServerPort.value)
}

function updatePreview() {
  updateSummary()
  updateValidationStatus()
}

/**
 * 获取当前选中的发音人名称
 * @returns {string} 发音人名称
 */
function getSelectedVoiceName() {
  const voiceId = elements.voiceSelect.value
  if (!voiceId) return '未选择'
  const selectedVoice = availableVoices.find(v => v.style_id === voiceId)
  return selectedVoice ? selectedVoice.name : elements.voiceSelect.options[elements.voiceSelect.selectedIndex]?.text || '未选择'
}

function generateConfigUrl() {
  const voiceId = elements.voiceSelect.value
  const delay = elements.delaySlider.value
  if (!voiceId) return ''
  const baseUrl = window.location.origin
  const voiceName = getSelectedVoiceName()
  const engineName = `DoBao-${delay}秒-${voiceName}`
  const params = new URLSearchParams({
    voiceId, delay,
    engineName,
    concurrentRate: '1', contentType: 'audio/mpeg', enableCookie: 'true'
  })
  return `${baseUrl}/api/legado/tts-config?${params.toString()}`
}

function generateImportUrl(configUrl) {
  if (!configUrl) return ''
  return `legado://import/httpTTS?src=${encodeURIComponent(configUrl)}`
}

/**
 * 生成阅读APP可直接导入的JSON配置格式
 * 用于手动复制到剪切板后导入
 * @returns {string} JSON格式的配置字符串
 */
function generateLegadoJsonConfig() {
  const voiceId = elements.voiceSelect.value
  const delay = elements.delaySlider.value
  if (!voiceId) return ''

  const baseUrl = window.location.origin
  const voiceName = getSelectedVoiceName()
  const engineName = `DoBao-${delay}秒-${voiceName}`

  // 构建TTS流URL（与后端接口一致）
  const ttsUrl = `${baseUrl}/api/reader/tts/stream?text={{java.encodeURI(speakText)}}&speed={{speakSpeed}}&voice=${voiceId}&usePrefetch=false&delay=${delay}`

  // 构建阅读APP配置对象
  const config = {
    id: Date.now(),
    name: engineName,
    url: ttsUrl,
    contentType: 'audio/mpeg',
    concurrentRate: '1',
    enabledCookieJar: true,
    header: '',
    loginUrl: '',
    loginUi: '',
    loginCheckJs: '',
    lastUpdateTime: Date.now()
  }

  return JSON.stringify(config, null, 2)
}

function applyTemplate(templateName) {
  if (templateName === 'custom') {
    currentTemplate = 'custom'
    document.querySelectorAll('.template-card').forEach(card => {
      card.classList.toggle('active', card.dataset.template === 'custom')
    })
    return
  }
  const template = templates[templateName]
  if (!template) return
  currentTemplate = templateName
  const savedVoiceId = localStorage.getItem(STORAGE_KEYS.VOICE_ID)
  elements.voiceSelect.value = savedVoiceId || template.voiceId
  elements.delaySlider.value = template.delay
  elements.delayValue.textContent = template.delay
  document.querySelectorAll('.template-card').forEach(card => {
    card.classList.toggle('active', card.dataset.template === templateName)
  })
  saveSettings()
  updatePreview()
  const templateNames = { default: '默认', fast: '快速', quality: '安全模式' }
  showToast(`已应用${templateNames[templateName]}配置`, 'success')
}





function updateSummary() {
  const voiceText = elements.voiceSelect.options[elements.voiceSelect.selectedIndex]?.text || '未选择'
  elements.summaryVoice.textContent = voiceText
  elements.summaryDelay.textContent = `${elements.delaySlider.value}秒`
}

function updateValidationStatus() {
  const voiceId = elements.voiceSelect.value
  const statusDiv = elements.validationStatus
  const importBtn = elements.mainImportBtn
  if (voiceId) {
    statusDiv.className = 'validation-status success'
    statusDiv.innerHTML = `
      <div class="status-icon"><i class="fas fa-check-circle"></i></div>
      <div class="status-text"><strong>配置完成</strong><p>可以导入到阅读APP</p></div>
    `
    importBtn.disabled = false
  } else {
    statusDiv.className = 'validation-status error'
    statusDiv.innerHTML = `
      <div class="status-icon"><i class="fas fa-exclamation-circle"></i></div>
      <div class="status-text"><strong>配置未完成</strong><p>请选择发音人</p></div>
    `
    importBtn.disabled = true
  }
}

async function importToLegado() {
  if (!validateConfig()) {
    showToast('请完成必填配置项', 'error')
    return
  }
  const configUrl = generateConfigUrl()
  const importUrl = generateImportUrl(configUrl)
  try {
    window.location.href = importUrl
    showToast('正在唤起阅读APP...', 'success')
    setTimeout(() => showFallbackDialog(importUrl), 2000)
  } catch (error) {
    console.error('导入失败:', error)
    showToast('导入失败，请手动复制链接', 'error')
  }
}

async function copyConfigLink() {
  if (!validateConfig()) {
    showToast('请完成必填配置项', 'error')
    return
  }
  // 复制JSON格式的配置（用于手动导入）
  const jsonConfig = generateLegadoJsonConfig()
  await copyToClipboard(jsonConfig)
}

function validateConfig() {
  const voiceId = elements.voiceSelect.value
  if (!voiceId) {
    elements.voiceSelect.classList.add('field-error')
    elements.voiceSelect.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => elements.voiceSelect.classList.remove('field-error'), 3000)
    return false
  }
  return true
}

function showFallbackDialog(importUrl) {
  // 显示JSON格式的配置（用于手动导入），而不是legado:// URL
  const jsonConfig = generateLegadoJsonConfig()
  elements.fallbackUrlInput.value = jsonConfig
  elements.fallbackSection.style.display = 'block'
  elements.fallbackSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function hideFallbackSection() {
  elements.fallbackSection.style.display = 'none'
}

/**
 * 复制实时模式备用链接
 * 复制JSON格式的配置（用于手动导入到阅读APP）
 */
async function copyFallbackUrl() {
  if (!validateConfig()) {
    showToast('请完成必填配置项', 'error')
    return
  }

  // 生成JSON格式的配置
  const jsonConfig = generateLegadoJsonConfig()

  // 同时更新输入框显示（方便用户查看）
  elements.fallbackUrlInput.value = jsonConfig
  elements.fallbackSection.style.display = 'block'

  await copyToClipboard(jsonConfig)
}

async function copyToClipboard(text) {
  if (!text) {
    showToast('复制内容为空', 'error')
    return
  }
  
  // 优先使用现代剪贴板API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制到剪贴板', 'success')
      return
    } catch (error) {
      console.warn('navigator.clipboard 失败，尝试备用方案:', error)
    }
  }
  
  // 备用方案：使用传统方法创建临时元素进行复制
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '-9999px'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    
    const successful = document.execCommand('copy')
    document.body.removeChild(textarea)
    
    if (successful) {
      showToast('已复制到剪贴板', 'success')
    } else {
      throw new Error('execCommand copy failed')
    }
  } catch (fallbackError) {
    console.error('备用复制方案也失败:', fallbackError)
    showToast('复制失败，请手动复制', 'error')
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer')
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  const iconMap = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' }
  toast.innerHTML = `<i class="fas ${iconMap[type]}"></i><span class="toast-message">${message}</span>`
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}

// ==================== 预制模式在线朗读引擎功能 ====================

/**
 * 生成预制模式在线朗读引擎配置URL
 * 该链接用于阅读APP导入在线朗读引擎，优先使用预制音频，未命中时回退到实时TTS
 * 使用预制模式专用端点 /api/legado/tts-config-prefab，不包含 speed 和 voice 参数
 * 因为预制模式的音频都是提前生成好的，不支持实时调节
 * @returns {string} 配置URL
 */
function generatePrefabEngineConfigUrl() {
  const baseUrl = window.location.origin
  // 使用预制模式专用端点，只传递引擎名称，不传递 voiceId、speed 等参数
  const params = new URLSearchParams({
    engineName: 'DoBao-预制模式'
  })
  return `${baseUrl}/api/legado/tts-config-prefab?${params.toString()}`
}

/**
 * 生成预制模式一键导入URL
 * 使用阅读APP的URL Scheme格式
 * @returns {string} 导入URL
 */
function generatePrefabImportUrl() {
  const configUrl = generatePrefabEngineConfigUrl()
  return `legado://import/httpTTS?src=${encodeURIComponent(configUrl)}`
}

/**
 * 生成预制模式阅读APP可直接导入的JSON配置格式
 * 用于手动复制到剪切板后导入
 * @returns {string} JSON格式的配置字符串
 */
function generatePrefabLegadoJsonConfig() {
  const baseUrl = window.location.origin

  // 预制模式TTS流URL - 使用专用端点，强制使用预制模式
  const ttsUrl = `${baseUrl}/api/reader/tts/stream-prefetch?text={{java.encodeURI(speakText)}}`

  // 构建阅读APP配置对象
  const config = {
    id: Date.now(),
    name: 'DoBao-预制模式',
    url: ttsUrl,
    contentType: 'audio/mpeg',
    concurrentRate: '1',
    enabledCookieJar: false,
    header: '',
    loginUrl: '',
    loginUi: '',
    loginCheckJs: '',
    lastUpdateTime: Date.now()
  }

  return JSON.stringify(config, null, 2)
}

/**
 * 一键导入预制模式引擎到阅读APP
 */
async function importPrefabEngineToLegado() {
  try {
    // TXT模式使用TXT导入
    if (txtPrefabState.currentSource === 'txt') {
      await importTxtPrefabToLegado()
      return
    }

    const importUrl = generatePrefabImportUrl()

    // 尝试唤起阅读APP
    window.location.href = importUrl

    showToast('正在唤起阅读APP...', 'success')

    // 2秒后显示备用方案
    setTimeout(() => {
      showPrefabImportFallback(importUrl)
    }, 2000)
  } catch (error) {
    console.error('导入失败:', error)
    showToast('导入失败，请使用复制链接功能', 'error')
  }
}

/**
 * 复制预制模式引擎导入链接
 * 复制JSON格式的配置（用于手动导入到阅读APP）
 */
async function copyPrefabEngineLink() {
  try {
    const jsonConfig = generatePrefabLegadoJsonConfig()
    await copyToClipboard(jsonConfig)
    showToast('已复制预制模式配置（JSON格式）', 'success')
  } catch (error) {
    console.error('复制失败:', error)
    showToast('复制失败，请手动复制', 'error')
  }
}

/**
 * 显示预制模式导入备用方案
 * @param {string} importUrl - 导入URL（未使用，仅保留参数兼容性）
 */
function showPrefabImportFallback(importUrl) {
  if (elements.prefabImportFallback && elements.prefabImportUrlInput) {
    // 显示JSON格式的配置（用于手动导入），而不是legado:// URL
    const jsonConfig = generatePrefabLegadoJsonConfig()
    elements.prefabImportUrlInput.value = jsonConfig
    elements.prefabImportFallback.style.display = 'block'
  }
}

/**
 * 复制预制模式备用链接
 * 复制JSON格式的配置（用于手动导入到阅读APP）
 */
async function copyPrefabFallbackUrl() {
  if (!elements.prefabImportUrlInput) return

  // 生成JSON格式的配置
  const jsonConfig = generatePrefabLegadoJsonConfig()

  // 同时更新输入框显示（方便用户查看）
  elements.prefabImportUrlInput.value = jsonConfig
  elements.prefabImportFallback.style.display = 'block'

  await copyToClipboard(jsonConfig)
}

// ==================== 预制模式在线朗读引擎功能结束 ====================

function initModeSwitch() {
  switchMode(currentMode)
}

function switchMode(mode) {
  currentMode = mode
  if (elements.modeTabs) {
    elements.modeTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode)
    })
  }
  if (elements.realtimeModeContent) {
    elements.realtimeModeContent.style.display = mode === 'realtime' ? 'grid' : 'none'
  }
  if (elements.prefabModeContent) {
    // prefab-v2 使用 flex 布局，不是 grid
    elements.prefabModeContent.style.display = mode === 'prefab' ? 'flex' : 'none'
  }
  localStorage.setItem(STORAGE_KEYS.CURRENT_MODE, mode)
  if (mode === 'realtime') {
    updatePreview()
  } else {
    updatePrefabValidationStatus()
    // 切换到预制书模式时，加载本地缓存书籍
    loadCachedBooks()
  }
}

function updatePrefabValidationStatus() {
  const statusDiv = elements.prefabValidationStatus
  const startBtn = elements.startProcessingBtn
  const hasVoice = !!prefabSelectedVoice

  // TXT模式验证
  if (txtPrefabState.currentSource === 'txt') {
    const savedBook = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_BOOK)
    const savedChapters = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTERS)
    const hasBook = !!savedBook
    let hasChapter = false
    try {
      const chapters = JSON.parse(savedChapters)
      if (Array.isArray(chapters) && chapters.length > 0) {
        hasChapter = true
      }
    } catch (e) {
      hasChapter = false
    }

    console.log('[updatePrefabValidationStatus] TXT模式检查:', {
      hasVoice,
      hasBook,
      hasChapter,
      selectedChapters: selectedChapters.size
    })

    if (hasVoice && hasBook && hasChapter) {
      statusDiv.textContent = '配置完成，可以开始处理'
      statusDiv.style.color = 'var(--success-color)'
      startBtn.disabled = false
    } else {
      let msg = []
      if (!hasVoice) msg.push('请选择发音人')
      if (!hasBook) msg.push('请上传TXT文件')
      if (!hasChapter) msg.push('请选择章节')
      statusDiv.textContent = msg.join('、')
      statusDiv.style.color = 'var(--warning-color)'
      startBtn.disabled = true
    }
    return
  }

  // Web模式验证
  const serverIp = elements.prefabServerIp?.value?.trim()
  const serverPort = elements.prefabServerPort?.value?.trim()
  const savedBook = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_BOOK)
  const savedChapters = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTERS)
  const savedChapter = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTER)

  const hasServer = !!(serverIp && serverPort)
  const hasBook = !!savedBook

  // 检查是否有选中的章节（优先检查多选列表）
  let hasChapter = false
  let chapterCheckDebug = ''
  try {
    const chapters = JSON.parse(savedChapters)
    if (Array.isArray(chapters) && chapters.length > 0) {
      hasChapter = true
      chapterCheckDebug = 'multi:' + chapters.length
    } else {
      chapterCheckDebug = 'multi:empty'
    }
  } catch (e) {
    // 检查单选
    hasChapter = !!savedChapter
    chapterCheckDebug = 'single:' + !!savedChapter
  }

  console.log('[updatePrefabValidationStatus] Web模式检查:', {
    hasVoice,
    hasServer,
    hasBook,
    hasChapter,
    chapterCheckDebug,
    savedChapters: savedChapters?.substring(0, 50),
    savedChapter: savedChapter?.substring(0, 50)
  })

  if (hasVoice && hasServer && hasBook && hasChapter) {
    statusDiv.textContent = '配置完成，可以开始处理'
    statusDiv.style.color = 'var(--success-color)'
    startBtn.disabled = false
  } else {
    let msg = []
    if (!hasVoice) msg.push('请选择发音人')
    if (!hasServer) msg.push('请配置服务器')
    if (!hasBook) msg.push('请选择书籍')
    if (!hasChapter) msg.push('请选择章节')
    statusDiv.textContent = msg.join('、')
    statusDiv.style.color = 'var(--warning-color)'
    startBtn.disabled = true
  }
}

async function refreshBooksList() {
  const serverIp = elements.prefabServerIp?.value
  const serverPort = elements.prefabServerPort?.value
  if (!serverIp || !serverPort) {
    showToast('请先填写完整的服务器配置', 'error')
    return
  }
  const btn = elements.refreshBooksBtn
  const originalText = btn.innerHTML
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 连接中...'
  btn.disabled = true

  let localBooks = []
  try {
    const localResponse = await fetch('/api/legado/book-cache/list?source=cache')
    const localResult = await localResponse.json()
    localBooks = (localResult.success && Array.isArray(localResult.data)) ? localResult.data : []
    console.log('[refreshBooksList] 本地缓存书籍:', localBooks.length)
  } catch (localError) {
    console.warn('[refreshBooksList] 加载本地缓存失败（跳过）:', localError.message)
  }

  try {
    const webResponse = await fetch('/api/legado/proxy/bookshelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverIp, serverPort })
    })
    const webResult = await webResponse.json()
    if (!webResult.success) throw new Error(webResult.message || '获取书架列表失败')
    const webBooks = Array.isArray(webResult.data) ? webResult.data : []
    console.log('[refreshBooksList] Web书架书籍:', webBooks.length)

    const mergedBooks = []
    const webBookUrls = new Set()

    for (const book of webBooks) {
      mergedBooks.push(book)
      webBookUrls.add(book.bookUrl)
    }

    for (const book of localBooks) {
      if (!webBookUrls.has(book.bookUrl)) {
        mergedBooks.push(book)
      }
    }

    console.log('[refreshBooksList] 合并后书籍:', mergedBooks.length)

    await syncBookCacheStatus(mergedBooks)

    isWebConnected = true

    renderBookshelf(mergedBooks, webBookUrls)
    showToast(`成功加载 ${mergedBooks.length} 本书籍（Web:${webBooks.length} + 本地:${localBooks.length}）`, 'success')
  } catch (error) {
    console.error('刷新书籍列表失败:', error)
    let errorMsg = error.message
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      errorMsg = `无法连接到服务器（${serverIp}:${serverPort}），请检查服务是否运行`
    }
    showToast(`连接失败：${errorMsg}`, 'error')
  } finally {
    btn.innerHTML = originalText
    btn.disabled = false
  }
}

/**
 * 同步书籍缓存状态
 * 从后端获取缓存状态并更新本地状态
 * @param {Array} books - 书籍列表
 */
async function syncBookCacheStatus(books) {
  try {
    // 获取所有已缓存的书籍列表
    const response = await fetch('/api/legado/book-cache/list')
    const result = await response.json()

    if (result.success && Array.isArray(result.data)) {
      const cachedBooks = result.data
      console.log('[syncBookCacheStatus] 后端返回的缓存书籍:', cachedBooks.map(b => ({ name: b.name, bookUrl: b.bookUrl })))
      console.log('[syncBookCacheStatus] 当前书架书籍:', books.map(b => ({ name: b.name, bookUrl: b.bookUrl })))

      // 如果后端没有缓存数据，清除所有本地缓存状态
      if (cachedBooks.length === 0) {
        console.log('[syncBookCacheStatus] 后端无缓存数据，清除本地缓存状态')
        bookCacheStatus.clear()
        saveBookCacheStatus()
        return
      }

      // 创建当前书架URL集合，用于清理不在当前书架上的旧缓存状态
      const currentBookUrls = new Set(books.map(b => b.bookUrl))

      // 清理不在当前书架上的缓存状态（避免显示旧项目的缓存标记）
      for (const [bookUrl, status] of bookCacheStatus.entries()) {
        if (!currentBookUrls.has(bookUrl)) {
          console.log(`[syncBookCacheStatus] 清理不在当前书架上的缓存状态: ${bookUrl}`)
          bookCacheStatus.delete(bookUrl)
        }
      }

      let matchedCount = 0
      // 为每本书检查缓存状态
      for (const book of books) {
        const cachedBook = cachedBooks.find(cb => cb.bookUrl === book.bookUrl)
        console.log(`[syncBookCacheStatus] 检查书籍: ${book.name}, bookUrl: ${book.bookUrl}, 是否匹配: ${!!cachedBook}`)
        if (cachedBook) {
          // 书籍已缓存，更新本地状态
          // 使用缓存书籍的bookId（短哈希格式）
          const bookId = cachedBook.bookId || getBookId(book)
          updateBookCacheStatus(book.bookUrl, 'cached', {
            bookId,
            bookName: book.name,
            chapterCount: cachedBook.totalChapters || book.totalChapters || 0,
            cachedChapters: cachedBook.cachedChapters || 0,
            totalChapters: cachedBook.totalChapters || 0,
            cachedAt: cachedBook.cachedAt || new Date().toISOString()
          })
          matchedCount++
        }
      }

      // 保存清理后的缓存状态
      saveBookCacheStatus()

      console.log(`[syncBookCacheStatus] 同步了 ${matchedCount}/${cachedBooks.length} 个缓存书籍状态`)
    } else {
      console.log('[syncBookCacheStatus] 后端返回数据无效:', result)
    }
  } catch (error) {
    console.error('同步缓存状态失败:', error)
  }
}

/**
 * 获取书籍封面的显示URL
 * @param {Object} book - 书籍对象
 * @param {boolean} isWebBook - 是否是Web书架上的书
 * @returns {string|null} 封面URL，如果没有封面返回null
 */
function getBookCoverUrl(book, isWebBook = false) {
  const rawCoverUrl = book.coverUrl || book.cover
  const cacheStatus = getBookCacheStatus(book.bookUrl)
  const isCached = cacheStatus?.status === 'cached'

  // 如果书籍已缓存，优先尝试使用本地缓存的封面
  if (isCached) {
    // 使用缓存状态中的bookId（短哈希格式），如果没有则使用getBookId
    const bookId = cacheStatus.bookId || getBookId(book)
    return `/api/legado/book-cache/cover/${bookId}`
  }

  if (!rawCoverUrl || rawCoverUrl.trim() === '') {
    return null
  }

  // 如果已经是本地缓存封面URL，直接使用
  if (rawCoverUrl.startsWith('/api/legado/book-cache/cover/')) {
    return rawCoverUrl
  }

  // 如果是网络图片URL（http/https），直接使用
  if (rawCoverUrl.startsWith('http')) {
    return rawCoverUrl
  }

  // 如果是相对路径（以/开头），需要通过代理接口获取
  // 只有在用户点击"连接"按钮后(isWebConnected=true)才尝试获取Web封面
  if (rawCoverUrl.startsWith('/')) {
    const serverIp = elements.prefabServerIp?.value
    const serverPort = elements.prefabServerPort?.value
    // 只有在已连接Web的情况下才尝试通过代理获取封面
    if (isWebConnected && serverIp && serverPort) {
      return `/api/legado/proxy/cover?serverIp=${encodeURIComponent(serverIp)}&serverPort=${encodeURIComponent(serverPort)}&coverPath=${encodeURIComponent(rawCoverUrl)}`
    }
    // 未连接Web，无法获取封面
    return null
  }

  // 其他未知格式，尝试直接使用
  return rawCoverUrl
}

function renderBookshelf(books, webBookUrls = null) {
  const grid = elements.bookshelfGrid
  const empty = elements.bookshelfEmpty
  grid.innerHTML = ''
  if (books.length === 0) {
    empty.style.display = 'flex'
    grid.style.display = 'none'
    return
  }
  empty.style.display = 'none'
  grid.style.display = 'flex'

  // 获取服务器配置（用于封面代理）
  const serverIp = elements.prefabServerIp?.value
  const serverPort = elements.prefabServerPort?.value

  books.forEach(book => {
    const card = document.createElement('div')
    card.className = 'prefab-book'
    card.dataset.bookUrl = book.bookUrl
    card.dataset.bookName = book.name
    const cacheStatus = getBookCacheStatus(book.bookUrl)
    const isCached = cacheStatus?.status === 'cached' || book.cachedChapters > 0
    const isCaching = cacheStatus?.status === 'caching'
    // 显示已缓存章节数/总章节数
    // 优先使用后端返回的 cachedChapters，其次使用 localStorage 中的缓存状态
    const cachedCount = book.cachedChapters || cacheStatus?.cachedChapters || 0
    const totalCount = book.totalChapters || book.chapterCount || cacheStatus?.totalChapters || 0
    const displayCount = cachedCount > 0 ? `${cachedCount}/${totalCount}` : `${totalCount}`

    // 判断是否在Web书架上（如果传入了webBookUrls）
    // webBookUrls 为 null 表示离线状态（未连接Web），此时不显示缓存按钮
    const isInWebBookshelf = webBookUrls ? webBookUrls.has(book.bookUrl) : false

    // 处理封面图片 - 使用代理接口获取封面
    const coverUrl = getBookCoverUrl(book, isInWebBookshelf)
    const hasCover = !!coverUrl

    // 判断是否需要更新缓存（Web章节数 > 缓存章节数）
    const webChapterCount = book.totalChapters || book.chapterCount || 0
    const needsUpdate = isCached && webChapterCount > cachedCount

    // 缓存按钮HTML - 只有Web书架上的书才显示按钮
    let cacheBtnHtml = ''
    // 获取封面URL用于缓存
    const bookCoverUrl = book.coverUrl || book.cover || ''
    if (isInWebBookshelf) {
      if (isCaching) {
        // 正在缓存中 - 显示旋转图标
        cacheBtnHtml = `
          <button class="prefab-book__cache-btn caching"
                  onclick="event.stopPropagation(); handleCacheBook('${book.bookUrl}', '${book.name}', ${totalCount}, '${bookCoverUrl}')"
                  title="正在缓存中...">
            <i class="fas fa-spinner fa-spin"></i>
          </button>
        `
      } else if (isCached && !needsUpdate) {
        // 已缓存且不需要更新 - 显示绿色勾选（常驻）
        cacheBtnHtml = `
          <button class="prefab-book__cache-btn cached"
                  onclick="event.stopPropagation(); handleCacheBook('${book.bookUrl}', '${book.name}', ${totalCount}, '${bookCoverUrl}')"
                  title="已缓存，点击重新缓存">
            <i class="fas fa-check"></i>
          </button>
        `
      } else {
        // 未缓存或需要更新 - 显示下载图标
        cacheBtnHtml = `
          <button class="prefab-book__cache-btn"
                  onclick="event.stopPropagation(); handleCacheBook('${book.bookUrl}', '${book.name}', ${totalCount}, '${bookCoverUrl}')"
                  title="${needsUpdate ? '有新章节，点击更新缓存' : '点击缓存书籍'}">
            <i class="fas fa-download"></i>
          </button>
        `
      }
    }

    card.innerHTML = `
      <div class="prefab-book__cover">
        ${hasCover ? `<img src="${coverUrl}" alt="${book.name}" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=\\'fas fa-book\\'></i>';">` : '<i class="fas fa-book"></i>'}
      </div>
      <div class="prefab-book__title">${book.name}</div>
      <div class="prefab-book__meta">${displayCount} 章</div>
      ${cacheBtnHtml}
    `
    card.addEventListener('click', () => selectBookAndShowChapters(book))
    grid.appendChild(card)
  })
}

// 全局缓存状态管理
const cachingBooks = new Map() // 正在缓存的书籍
const bookCacheProgressMap = new Map() // 缓存进度存储
let currentCachingBookUrl = null // 当前正在缓存的书籍URL
let isCancellingCache = false // 是否正在取消缓存

async function handleCacheBook(bookUrl, bookName, chapterCount, coverUrl = '') {
  // 检查是否正在缓存中
  if (cachingBooks.has(bookUrl)) {
    // 如果已经在缓存中，重新打开进度弹窗
    const cachingInfo = cachingBooks.get(bookUrl)
    showBookCacheProgressModal(bookName)
    showToast('正在缓存中，已打开进度窗口', 'info')
    return
  }

  // 直接开始缓存（不询问是否重新缓存）
  await startCacheBook(bookUrl, bookName, chapterCount, coverUrl)
}

/**
 * 显示书籍缓存进度弹窗
 * @param {string} bookName - 书籍名称
 */
function showBookCacheProgressModal(bookName) {
  const modal = document.getElementById('bookCacheProgressModal')
  const title = document.getElementById('bookCacheProgressTitle')
  const progressBar = document.getElementById('bookCacheProgressBar')
  const progressText = document.getElementById('bookCacheProgressText')
  const progressCount = document.getElementById('bookCacheProgressCount')
  const progressDetail = document.getElementById('bookCacheProgressDetail')
  const progressSkipped = document.getElementById('bookCacheProgressSkipped')
  const cancelContainer = document.getElementById('bookCacheCancelContainer')
  const cancellingMsg = document.getElementById('bookCacheCancellingMsg')

  if (modal) {
    title.textContent = `正在缓存《${bookName}》...`
    if (progressBar) progressBar.style.width = '0%'
    if (progressText) progressText.textContent = '0%'
    if (progressCount) progressCount.textContent = '0/0'
    if (progressDetail) progressDetail.textContent = '准备中...'
    if (progressSkipped) {
      progressSkipped.style.display = 'none'
      progressSkipped.textContent = ''
    }
    // 重置取消按钮和取消提示的显示状态
    if (cancelContainer) cancelContainer.style.display = 'block'
    if (cancellingMsg) cancellingMsg.style.display = 'none'
    // 使用 active 类来显示弹窗，与 CSS 样式匹配
    modal.classList.add('active')
  }
}

/**
 * 更新书籍缓存进度
 * @param {Object} progress - 进度信息
 */
function updateBookCacheProgress(progress) {
  const progressBar = document.getElementById('bookCacheProgressBar')
  const progressText = document.getElementById('bookCacheProgressText')
  const progressCount = document.getElementById('bookCacheProgressCount')
  const progressDetail = document.getElementById('bookCacheProgressDetail')
  const progressSkipped = document.getElementById('bookCacheProgressSkipped')
  const cancellingMsg = document.getElementById('bookCacheCancellingMsg')

  // 如果用户已经点击取消，且收到完成状态，保持显示取消状态
  if (isCancellingCache && progress.status === 'completed') {
    console.log('[updateBookCacheProgress] 用户已取消，忽略完成状态')
    return
  }

  if (progressBar) {
    progressBar.style.width = `${progress.percent || 0}%`
  }
  if (progressText) {
    progressText.textContent = `${progress.percent || 0}%`
  }
  if (progressCount) {
    progressCount.textContent = `${progress.current || 0}/${progress.total || 0}`
  }
  if (progressDetail) {
    const concurrentInfo = progress.concurrent > 1 ? ` [并发:${progress.concurrent}]` : ''
    if (progress.status === 'starting') {
      progressDetail.textContent = `检测到 ${progress.skipped || 0} 个已缓存章节，将跳过${concurrentInfo}`
    } else if (progress.status === 'processing') {
      const processingInfo = progress.processing > 0 ? ` [处理中:${progress.processing}]` : ''
      progressDetail.textContent = `正在缓存: ${progress.chapter || ''}${processingInfo}${concurrentInfo}`
    } else if (progress.status === 'completed') {
      progressDetail.textContent = `缓存完成！${concurrentInfo}`
      // 缓存完成，隐藏取消提示
      if (cancellingMsg) cancellingMsg.style.display = 'none'
    } else if (progress.status === 'paused') {
      progressDetail.textContent = '缓存已暂停，已缓存的内容已保留'
      // 暂停完成，重置取消标志
      isCancellingCache = false
    } else if (progress.status === 'error') {
      progressDetail.textContent = `缓存出错: ${progress.error || ''}`
      // 出错，重置取消标志
      isCancellingCache = false
    }
  }
  if (progressSkipped && progress.skipped > 0) {
    progressSkipped.style.display = 'block'
    progressSkipped.textContent = `已跳过 ${progress.skipped} 个已缓存章节`
  }
}

/**
 * 隐藏书籍缓存进度弹窗
 */
function hideBookCacheProgressModal() {
  const modal = document.getElementById('bookCacheProgressModal')
  if (modal) {
    // 使用 active 类来隐藏弹窗，与 CSS 样式匹配
    modal.classList.remove('active')
  }
}

// 绑定关闭按钮事件
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('closeBookCacheProgressModal')
  if (closeBtn) {
    closeBtn.addEventListener('click', hideBookCacheProgressModal)
  }

  // 绑定取消缓存按钮事件 - 使用事件委托确保能绑定到动态元素
  const modal = document.getElementById('bookCacheProgressModal')
  if (modal) {
    modal.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('#bookCacheCancelBtn')
      if (cancelBtn) {
        e.preventDefault()
        e.stopPropagation()
        console.log('[取消按钮] 点击事件触发')
        cancelBookCache()
      }
    })
  }
})

/**
 * 取消书籍缓存
 */
async function cancelBookCache() {
  console.log('[cancelBookCache] 取消按钮被点击')

  if (!currentCachingBookUrl) {
    console.log('[cancelBookCache] 当前没有正在缓存的书籍')
    showToast('当前没有正在缓存的书籍', 'warning')
    return
  }

  console.log('[cancelBookCache] 当前缓存的书籍URL:', currentCachingBookUrl)

  const bookUrl = currentCachingBookUrl

  try {
    // 设置取消标志
    isCancellingCache = true

    // 显示取消中状态
    const cancelContainer = document.getElementById('bookCacheCancelContainer')
    const cancellingMsg = document.getElementById('bookCacheCancellingMsg')
    if (cancelContainer) cancelContainer.style.display = 'none'
    if (cancellingMsg) cancellingMsg.style.display = 'block'

    const response = await fetch('/api/legado/book-cache/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookUrl })
    })

    const result = await response.json()

    if (result.success) {
      if (result.data?.alreadyFinished) {
        showToast(`缓存已经${result.data.status === 'completed' ? '完成' : result.data.status === 'paused' ? '暂停' : '结束'}`, 'info')
        // 隐藏取消中提示
        if (cancellingMsg) cancellingMsg.style.display = 'none'
        isCancellingCache = false
      } else {
        showToast('已发送取消请求，当前章节缓存完成后将停止', 'success')
        // 注意：这里不隐藏取消中提示，等待实际取消完成
      }
    } else {
      showToast(`取消失败：${result.message}`, 'error')
      // 恢复取消按钮显示
      if (cancelContainer) cancelContainer.style.display = 'block'
      if (cancellingMsg) cancellingMsg.style.display = 'none'
      isCancellingCache = false
    }
  } catch (error) {
    console.error('取消缓存失败:', error)
    showToast('取消请求失败，请稍后重试', 'error')
    // 恢复取消按钮显示
    const cancelContainer = document.getElementById('bookCacheCancelContainer')
    const cancellingMsg = document.getElementById('bookCacheCancellingMsg')
    if (cancelContainer) cancelContainer.style.display = 'block'
    if (cancellingMsg) cancellingMsg.style.display = 'none'
    isCancellingCache = false
  }
}

async function startCacheBook(bookUrl, bookName, chapterCount, coverUrl = '') {
  // 标记为正在缓存
  cachingBooks.set(bookUrl, { bookName, chapterCount, coverUrl, startTime: Date.now() })
  currentCachingBookUrl = bookUrl // 记录当前正在缓存的书籍URL
  isCancellingCache = false // 重置取消标志
  updateBookCacheStatus(bookUrl, 'caching', { bookName, chapterCount })
  refreshBookshelfCacheStatus()

  // 清除上一次的进度数据，避免显示旧数据
  bookCacheProgressMap.delete(bookUrl)

  // 清除后端进度数据
  try {
    await fetch('/api/legado/book-cache/clear-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookUrl })
    })
  } catch (error) {
    console.warn('清除后端进度数据失败:', error)
  }

  showBookCacheProgressModal(bookName)

  // 建立SSE连接接收实时进度
  const eventSource = new EventSource(`/api/legado/book-cache/progress?bookUrl=${encodeURIComponent(bookUrl)}`)

  // 标记是否已取消
  let isCancelled = false

  eventSource.onmessage = (event) => {
    try {
      const progress = JSON.parse(event.data)
      // 存储进度到全局 Map
      bookCacheProgressMap.set(bookUrl, progress)
      updateBookCacheProgress(progress)

      // 如果完成、出错或暂停，关闭连接
      if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'paused') {
        if (progress.status === 'paused') {
          isCancelled = true
        }
        eventSource.close()
      }
    } catch (error) {
      console.error('解析进度数据失败:', error)
    }
  }

  eventSource.onerror = (error) => {
    console.error('SSE连接错误:', error)
    eventSource.close()
  }

  try {
    // 调用后端API开始缓存书籍
    const serverIp = elements.prefabServerIp.value
    const serverPort = elements.prefabServerPort.value
    // 优先从系统设置API获取缓存并发数，其次使用本地存储，最后使用默认值
    let concurrentLimit = 20
    try {
      const settingsResponse = await fetch('/api/settings/item?path=prefetch.cacheConcurrent')
      const settingsResult = await settingsResponse.json()
      // 后端返回格式: { code: 0, data: { path, value } }
      if (settingsResult.code === 0 && settingsResult.data && settingsResult.data.value !== undefined) {
        concurrentLimit = parseInt(settingsResult.data.value)
      } else {
        // 如果系统设置中没有，尝试从本地存储获取
        const localValue = localStorage.getItem(STORAGE_KEYS.PREFAB_CONCURRENT)
        if (localValue) {
          concurrentLimit = parseInt(localValue)
        }
      }
    } catch (e) {
      // 如果获取系统设置失败，使用本地存储或默认值
      concurrentLimit = parseInt(localStorage.getItem(STORAGE_KEYS.PREFAB_CONCURRENT) || '20')
    }
    // 确保值在有效范围内
    if (isNaN(concurrentLimit) || concurrentLimit < 1) concurrentLimit = 1
    if (concurrentLimit > 100) concurrentLimit = 100

    const response = await fetch('/api/legado/book-cache/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookInfo: { bookUrl, name: bookName, coverUrl },
        serverIp,
        serverPort,
        concurrentLimit
      })
    })

    const result = await response.json()

    if (result.success) {
      const data = result.data || {}

      // 检查是否已暂停（通过SSE提前知道）或从返回数据中判断
      const wasPaused = isCancelled || data.status === 'paused'

      if (wasPaused) {
        // 缓存被暂停
        updateBookCacheProgress({
          current: data.cachedChapters || 0,
          total: data.totalChapters || chapterCount,
          percent: Math.round(((data.cachedChapters || 0) / (data.totalChapters || chapterCount)) * 100),
          skipped: data.skippedChapters || 0,
          status: 'paused'
        })

        // 延迟隐藏弹窗，让用户看到取消状态
        setTimeout(() => {
          hideBookCacheProgressModal()
        }, 3000)

        updateBookCacheStatus(bookUrl, 'partial', {
          bookName,
          chapterCount,
          cachedChapters: data.cachedChapters || 0,
          totalChapters: data.totalChapters || chapterCount,
          skippedChapters: data.skippedChapters || 0,
          newCachedChapters: data.newCachedChapters || 0,
          cachedAt: new Date().toISOString()
        })

        showToast(`《${bookName}》缓存已取消，已缓存 ${data.cachedChapters || 0} 个章节`, 'warning')
      } else {
        // 缓存完成
        updateBookCacheProgress({
          current: data.totalChapters || chapterCount,
          total: data.totalChapters || chapterCount,
          percent: 100,
          skipped: data.skippedChapters || 0,
          status: 'completed'
        })

        // 延迟隐藏弹窗，让用户看到完成状态
        setTimeout(() => {
          hideBookCacheProgressModal()
        }, 1500)

        updateBookCacheStatus(bookUrl, 'cached', {
          bookName,
          chapterCount,
          cachedChapters: data.cachedChapters || chapterCount,
          totalChapters: data.totalChapters || chapterCount,
          skippedChapters: data.skippedChapters || 0,
          newCachedChapters: data.newCachedChapters || 0,
          cachedAt: new Date().toISOString()
        })

        const message = data.skippedChapters > 0
          ? `《${bookName}》缓存完成，跳过 ${data.skippedChapters} 个已缓存章节，新缓存 ${data.newCachedChapters || 0} 个章节`
          : `《${bookName}》缓存完成，共缓存 ${data.cachedChapters || chapterCount} 个章节`
        showToast(message, 'success')
      }
    } else {
      hideBookCacheProgressModal()
      throw new Error(result.message)
    }
  } catch (error) {
    hideBookCacheProgressModal()
    console.error('缓存书籍失败:', error)
    updateBookCacheStatus(bookUrl, 'error', { bookName, chapterCount, error: error.message })
    showToast(`缓存失败：${error.message}`, 'error')
  } finally {
    // 关闭SSE连接
    eventSource.close()
    // 从正在缓存列表中移除
    cachingBooks.delete(bookUrl)
    currentCachingBookUrl = null // 清除当前缓存的书籍URL
    refreshBookshelfCacheStatus()
  }
}

function refreshBookshelfCacheStatus() {
  document.querySelectorAll('.prefab-book').forEach(card => {
    const bookUrl = card.dataset.bookUrl
    const cacheBtn = card.querySelector('.prefab-book__cache-btn')
    const cacheStatus = getBookCacheStatus(bookUrl)
    if (!cacheBtn) return
    cacheBtn.classList.remove('cached', 'caching', 'partial')
    const icon = cacheBtn.querySelector('i')
    if (cacheStatus?.status === 'cached') {
      cacheBtn.classList.add('cached')
      icon.className = 'fas fa-check'
      cacheBtn.title = '已缓存'
    } else if (cacheStatus?.status === 'caching') {
      cacheBtn.classList.add('caching')
      icon.className = 'fas fa-spinner fa-spin'
      cacheBtn.title = '缓存中...'
    } else if (cacheStatus?.status === 'partial') {
      cacheBtn.classList.add('partial')
      icon.className = 'fas fa-pause-circle'
      cacheBtn.title = `部分缓存 (${cacheStatus?.cachedChapters || 0}/${cacheStatus?.totalChapters || 0})`
    } else {
      icon.className = 'fas fa-download'
      cacheBtn.title = '点击缓存书籍'
    }
  })
}

async function selectBookAndShowChapters(book) {
  const serverIp = elements.prefabServerIp?.value
  const serverPort = elements.prefabServerPort?.value
  const cacheStatus = getBookCacheStatus(book.bookUrl)
  const isCached = cacheStatus?.status === 'cached'

  // 设置当前书籍URL（用于滚动位置记忆）
  currentBookUrl = book.bookUrl

  // 保存选中的书籍（包含bookId，优先使用后端返回的bookId）
  const bookId = getBookId(book)
  localStorage.setItem(STORAGE_KEYS.PREFAB_SELECTED_BOOK, JSON.stringify({
    bookId: bookId,
    bookUrl: book.bookUrl,
    name: book.name
  }))
  if (elements.prefabSummaryBookName) {
    elements.prefabSummaryBookName.textContent = book.name
    elements.prefabSummaryBookName.classList.remove('prefab-status__item-value--empty')
  }

  try {
    let chapters = []

    // 检查是否是TXT书籍
    const isTxtBook = book.bookUrl?.startsWith('txt://')

    if (isTxtBook) {
      // TXT书籍：从后端获取章节列表
      console.log('[selectBookAndShowChapters] TXT书籍，从后端获取章节列表:', book.bookUrl)
      const txtBookId = book.bookUrl.replace('txt://', '')
      const response = await fetch(`/api/legado/txt-prefab/book/${txtBookId}`)
      const result = await response.json()
      if (result.success && result.data) {
        // 将TXT章节格式转换为通用格式（与renderChapterList期望的字段一致）
        chapters = result.data.chapters.map((ch, index) => ({
          index: index,
          title: ch.title,
          url: `txt://${txtBookId}/${index}`
        }))
        console.log('[selectBookAndShowChapters] 从TXT后端获取到', chapters.length, '个章节')
      } else {
        showToast('获取TXT章节列表失败', 'error')
        return
      }
    } else if (isWebConnected && serverIp && serverPort) {
      // Web书籍：优先从Web获取
      console.log('[selectBookAndShowChapters] 已连接Web，从Web获取章节列表:', book.bookUrl)
      try {
        const response = await fetch('/api/legado/proxy/chapters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverIp, serverPort, bookUrl: book.bookUrl })
        })
        const result = await response.json()
        // 即使HTTP成功，也要检查返回的code是否为0
        if (result.code !== 0) {
          throw new Error(result.msg || result.message || '获取章节列表失败')
        }
        chapters = Array.isArray(result.data) ? result.data : []
        console.log('[selectBookAndShowChapters] 从Web获取到', chapters.length, '个章节')
      } catch (webError) {
        console.error('[selectBookAndShowChapters] 从Web获取失败:', webError.message)
        // Web获取失败（包括Web服务返回错误），尝试使用本地缓存
        console.log('[selectBookAndShowChapters] Web获取失败，尝试使用本地缓存:', book.bookUrl)
        try {
          const cacheResponse = await fetch(`/api/legado/book-cache/chapters?bookUrl=${encodeURIComponent(book.bookUrl)}`)
          const cacheResult = await cacheResponse.json()
          if (cacheResult.success && Array.isArray(cacheResult.data) && cacheResult.data.length > 0) {
            chapters = cacheResult.data
            console.log('[selectBookAndShowChapters] 从本地缓存获取到', chapters.length, '个章节')
            showToast('从本地缓存加载章节（Web获取失败）', 'info')
          } else {
            // 本地缓存也没有，抛出错误
            throw new Error('本地缓存中也没有这本书的章节数据')
          }
        } catch (cacheError) {
          console.error('[selectBookAndShowChapters] 本地缓存也没有:', cacheError.message)
          showToast('无法获取章节：Web和本地缓存都没有数据', 'error')
          return
        }
      }
    } else {
      // 未连接Web，优先尝试使用本地缓存
      console.log('[selectBookAndShowChapters] 未连接Web，尝试使用本地缓存:', book.bookUrl)
      const response = await fetch(`/api/legado/book-cache/chapters?bookUrl=${encodeURIComponent(book.bookUrl)}`)
      const result = await response.json()
      if (result.success && Array.isArray(result.data) && result.data.length > 0) {
        chapters = result.data
        console.log('[selectBookAndShowChapters] 从本地缓存获取到', chapters.length, '个章节')
      } else if (!serverIp || !serverPort) {
        // 没有服务器配置且没有缓存
        showToast('请先配置服务器或缓存书籍', 'error')
        return
      } else {
        // 已配置服务器但未连接Web且没有本地缓存
        if (!isWebConnected) {
          showToast('请点击"连接"按钮获取Web书籍，或先缓存书籍后再试', 'error')
        } else {
          showToast('获取章节列表失败，请重试', 'error')
        }
        return
      }
    }

    renderChapterList(chapters)
    uiStateManager.showChapterList(book.name)
    showToast(`成功加载 ${chapters.length} 个章节`, 'success')
    updatePrefabValidationStatus()
  } catch (error) {
    console.error('获取章节列表失败:', error)
    showToast(`获取章节列表失败：${error.message}`, 'error')
  }
}

// 多选章节状态管理
let selectedChapters = new Set()
let currentChapters = []

// 当前书籍的URL（用于滚动位置记忆）
let currentBookUrl = null

// 章节列表滚动位置管理
const chapterScrollPositions = new Map()

/**
 * 加载章节列表滚动位置记录
 */
function loadChapterScrollPositions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.CHAPTER_LIST_SCROLL_POSITIONS)
    if (saved) {
      const data = JSON.parse(saved)
      Object.entries(data).forEach(([key, value]) => {
        chapterScrollPositions.set(key, value)
      })
    }
  } catch (error) {
    console.error('[loadChapterScrollPositions] 加载滚动位置失败:', error)
  }
}

/**
 * 保存章节列表滚动位置记录
 */
function saveChapterScrollPositions() {
  try {
    const data = Object.fromEntries(chapterScrollPositions)
    localStorage.setItem(STORAGE_KEYS.CHAPTER_LIST_SCROLL_POSITIONS, JSON.stringify(data))
  } catch (error) {
    console.error('[saveChapterScrollPositions] 保存滚动位置失败:', error)
  }
}

/**
 * 记录指定书籍的章节列表滚动位置
 * @param {string} bookUrl - 书籍URL
 * @param {number} scrollTop - 滚动位置
 */
function recordChapterScrollPosition(bookUrl, scrollTop) {
  if (!bookUrl) return
  chapterScrollPositions.set(bookUrl, scrollTop)
  saveChapterScrollPositions()
}

/**
 * 获取指定书籍的章节列表滚动位置
 * @param {string} bookUrl - 书籍URL
 * @returns {number} 滚动位置，如果没有记录返回0
 */
function getChapterScrollPosition(bookUrl) {
  return chapterScrollPositions.get(bookUrl) || 0
}

/**
 * 清除指定书籍的章节列表滚动位置记录
 * @param {string} bookUrl - 书籍URL
 */
function clearChapterScrollPosition(bookUrl) {
  if (chapterScrollPositions.has(bookUrl)) {
    chapterScrollPositions.delete(bookUrl)
    saveChapterScrollPositions()
  }
}

/**
 * 绑定章节列表滚动事件
 */
function bindChapterListScrollEvent() {
  const chapterList = elements.chapterList
  if (!chapterList) return

  // 使用防抖函数避免频繁保存
  let scrollTimeout = null
  chapterList.addEventListener('scroll', () => {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout)
    }
    scrollTimeout = setTimeout(() => {
      if (currentBookUrl) {
        recordChapterScrollPosition(currentBookUrl, chapterList.scrollTop)
      }
    }, 200) // 200ms防抖
  })
}

/**
 * 恢复章节列表的滚动位置
 */
function restoreChapterListScrollPosition() {
  const chapterList = elements.chapterList
  if (!chapterList || !currentBookUrl) return

  const savedPosition = getChapterScrollPosition(currentBookUrl)
  if (savedPosition > 0) {
    // 使用requestAnimationFrame确保DOM已渲染完成
    requestAnimationFrame(() => {
      chapterList.scrollTop = savedPosition
      console.log(`[restoreChapterListScrollPosition] 恢复书籍 ${currentBookUrl} 的滚动位置: ${savedPosition}px`)
    })
  }
}

/**
 * 渲染章节列表
 * @param {Array} chapters - 章节数组
 */
function renderChapterList(chapters) {
  const list = elements.chapterList
  const empty = elements.chapterListEmpty
  const toolbar = document.getElementById('chapterToolbar')

  list.innerHTML = ''
  currentChapters = chapters

  if (chapters.length === 0) {
    empty.style.display = 'flex'
    list.style.display = 'none'
    if (toolbar) toolbar.style.display = 'none'
    return
  }

  empty.style.display = 'none'
  list.style.display = 'flex'
  if (toolbar) toolbar.style.display = 'flex'

  chapters.forEach((chapter, index) => {
    const item = document.createElement('div')
    item.className = 'prefab-chapter'
    item.dataset.chapterIndex = chapter.index

    // 检查是否已选中
    if (selectedChapters.has(chapter.index)) {
      item.classList.add('active')
    }

    item.innerHTML = `
      <div class="prefab-chapter__checkbox">
        <i class="fas fa-check"></i>
      </div>
      <div class="prefab-chapter__number" data-chapter-index="${chapter.index}" data-chapter-url="${chapter.url || ''}">${index + 1}</div>
      <div class="prefab-chapter__title">${chapter.title}</div>
      <div class="prefab-chapter__check">
        <i class="fas fa-check"></i>
      </div>
    `

    // 获取序号元素
    const numberEl = item.querySelector('.prefab-chapter__number')

    // 为序号元素添加点击事件（用于删除预制音频）
    numberEl.addEventListener('click', async (e) => {
      e.stopPropagation() // 阻止冒泡，避免触发章节选中

      // 检查是否已完成预制
      if (!numberEl.classList.contains('prefetched')) {
        return
      }

      // 判断是否有选中的章节（多选状态）
      const hasSelectedChapters = selectedChapters.size > 0

      if (hasSelectedChapters) {
        // 多选状态：删除所有选中的章节
        await deleteSelectedChapters()
      } else {
        // 单选状态：只删除当前点击的章节
        await deleteSingleChapter(numberEl)
      }
    })

    item.addEventListener('click', (e) => {
      // 如果点击的是序号元素，不处理选中状态
      if (e.target.classList.contains('prefab-chapter__number')) {
        return
      }

      // 切换选中状态
      if (selectedChapters.has(chapter.index)) {
        selectedChapters.delete(chapter.index)
        item.classList.remove('active')
      } else {
        selectedChapters.add(chapter.index)
        item.classList.add('active')
      }

      // 更新选中计数
      updateSelectedChapterCount()

      // 保存选中的章节信息（取第一个选中的作为主要选择）
      saveSelectedChapters()
    })

    list.appendChild(item)
  })

  updateSelectedChapterCount()

  // 恢复该书籍的滚动位置
  restoreChapterListScrollPosition()

  // 异步查询章节预制状态
  checkChaptersPrefetchStatus(chapters)
}

/**
 * 检查章节的预制状态
 * @param {Array} chapters - 章节数组
 */
async function checkChaptersPrefetchStatus(chapters) {
  // 获取当前书籍信息
  const savedBook = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_BOOK)
  if (!savedBook) return

  try {
    const book = JSON.parse(savedBook)
    if (!book || !book.bookUrl) return

    // 使用保存的bookId
    const bookId = getBookIdFromStorage(book)

    // 构建章节信息数组，包含索引和URL
    const chaptersInfo = chapters.map(c => ({
      index: c.index,
      url: c.url // 使用章节URL作为查询标识
    }))

    // 调用API查询预制状态
    const response = await fetch(`/api/legado/prefetch/chapters-status/${encodeURIComponent(bookId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapters: chaptersInfo })
    })

    const result = await response.json()

    if (result.success && result.data && result.data.chapterStatus) {
      const statusMap = result.data.chapterStatus

      console.log('[checkChaptersPrefetchStatus] 收到预制状态:', statusMap)

      // 更新UI显示已完成预制的章节
      Object.entries(statusMap).forEach(([chapterIndex, isPrefetched]) => {
        if (isPrefetched) {
          const numberEl = document.querySelector(`.prefab-chapter__number[data-chapter-index="${chapterIndex}"]`)
          if (numberEl) {
            console.log(`[checkChaptersPrefetchStatus] 标记章节 ${chapterIndex} 为已预制`)
            numberEl.classList.add('prefetched')
          } else {
            console.warn(`[checkChaptersPrefetchStatus] 找不到章节 ${chapterIndex} 的序号元素`)
          }
        }
      })

      // 如果有已完成的章节，显示提示
      const completedCount = result.data.completedCount
      console.log(`[checkChaptersPrefetchStatus] 检测到 ${completedCount}/${chapters.length} 个章节已完成预制`)
    } else {
      console.log('[checkChaptersPrefetchStatus] API返回数据异常:', result)
    }
  } catch (error) {
    console.error('[checkChaptersPrefetchStatus] 查询章节预制状态失败:', error)
  }
}

/**
 * 删除章节的预制音频
 * @param {string} chapterUrl - 章节URL
 * @param {string} chapterIndex - 章节索引
 * @returns {Promise<boolean>} 是否删除成功
 */
async function deletePrefetchedChapter(chapterUrl, chapterIndex) {
  // 获取当前书籍信息
  const savedBook = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_BOOK)
  if (!savedBook) return false

  try {
    const book = JSON.parse(savedBook)
    if (!book || !book.bookUrl) return false

    // 使用保存的bookId
    const bookId = getBookIdFromStorage(book)

    // 从章节URL中提取chapterId（路径部分）
    let chapterId = String(chapterIndex)
    if (chapterUrl) {
      // 处理TXT书籍的章节URL格式：txt://bookId/chapterIndex
      if (chapterUrl.startsWith('txt://')) {
        chapterId = `txt_chapter_${chapterIndex}`
      } else {
        try {
          const urlObj = new URL(chapterUrl)
          chapterId = urlObj.pathname // 提取路径部分，如 /read/208941/69872402.html
        } catch (e) {
          // 如果URL解析失败，直接使用原始url
          chapterId = chapterUrl
        }
      }
    }

    console.log('[deletePrefetchedChapter] 删除章节预制音频', { bookId, chapterId })

    // 调用API删除预制音频
    const response = await fetch(`/api/legado/prefetch/chapter/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}`, {
      method: 'DELETE'
    })

    const result = await response.json()

    if (result.success) {
      console.log('[deletePrefetchedChapter] 删除成功', { bookId, chapterId })
      return true
    } else {
      console.error('[deletePrefetchedChapter] 删除失败', result.message)
      return false
    }
  } catch (error) {
    console.error('[deletePrefetchedChapter] 删除章节预制音频失败:', error)
    return false
  }
}

/**
 * 删除单个章节的预制音频
 * @param {HTMLElement} numberEl - 序号元素
 */
async function deleteSingleChapter(numberEl) {
  // 二次确认
  if (!confirm('确定要删除此章节的预制音频吗？\n\n删除后将需要重新生成。')) {
    return
  }

  // 获取章节URL并提取chapterId
  const chapterUrl = numberEl.dataset.chapterUrl
  const chapterIndex = numberEl.dataset.chapterIndex

  // 执行删除
  const success = await deletePrefetchedChapter(chapterUrl, chapterIndex)

  if (success) {
    // 删除成功，移除绿色背景
    numberEl.classList.remove('prefetched')
    showToast('章节预制音频已删除', 'success')
  } else {
    showToast('删除失败，请重试', 'error')
  }
}

/**
 * 删除所有选中的章节的预制音频（批量删除）
 */
async function deleteSelectedChapters() {
  // 获取所有选中的章节
  const selectedChapterIndices = Array.from(selectedChapters)

  // 过滤出已完成预制的章节
  const chaptersToDelete = []
  for (const chapterIndex of selectedChapterIndices) {
    const numberEl = document.querySelector(`.prefab-chapter__number[data-chapter-index="${chapterIndex}"]`)
    if (numberEl && numberEl.classList.contains('prefetched')) {
      const chapter = currentChapters.find(c => c.index === parseInt(chapterIndex))
      if (chapter) {
        chaptersToDelete.push({
          index: chapterIndex,
          url: chapter.url,
          element: numberEl
        })
      }
    }
  }

  if (chaptersToDelete.length === 0) {
    showToast('选中的章节中没有已完成预制的音频', 'warning')
    return
  }

  // 二次确认
  const confirmMessage = chaptersToDelete.length === selectedChapterIndices.length
    ? `确定要删除选中的 ${chaptersToDelete.length} 个章节的预制音频吗？\n\n删除后将需要重新生成。`
    : `确定要删除 ${chaptersToDelete.length} 个已完成预制的章节音频吗？\n（共选中 ${selectedChapterIndices.length} 个章节，其中 ${selectedChapterIndices.length - chaptersToDelete.length} 个未完成预制）\n\n删除后将需要重新生成。`

  if (!confirm(confirmMessage)) {
    return
  }

  // 显示删除进度
  showToast(`开始删除 ${chaptersToDelete.length} 个章节的预制音频...`, 'info')

  // 批量删除
  let successCount = 0
  let failCount = 0

  for (const chapter of chaptersToDelete) {
    const success = await deletePrefetchedChapter(chapter.url, chapter.index)
    if (success) {
      successCount++
      // 删除成功，移除绿色背景
      chapter.element.classList.remove('prefetched')
    } else {
      failCount++
    }
  }

  // 显示删除结果
  if (successCount === chaptersToDelete.length) {
    showToast(`成功删除 ${successCount} 个章节的预制音频`, 'success')
  } else {
    showToast(`删除完成：成功 ${successCount} 个，失败 ${failCount} 个`, failCount > 0 ? 'error' : 'success')
  }
}

/**
 * 更新已选章节计数显示
 */
function updateSelectedChapterCount() {
  const countEl = document.getElementById('selectedChapterCount')
  if (countEl) {
    countEl.textContent = selectedChapters.size
  }
  
  // 更新摘要显示
  if (elements.prefabSummaryChapter) {
    if (selectedChapters.size === 0) {
      elements.prefabSummaryChapter.textContent = '未选择'
      elements.prefabSummaryChapter.classList.add('prefab-status__item-value--empty')
    } else if (selectedChapters.size === 1) {
      const chapterIndex = Array.from(selectedChapters)[0]
      const chapter = currentChapters.find(c => c.index === chapterIndex)
      elements.prefabSummaryChapter.textContent = chapter ? chapter.title : `第${chapterIndex + 1}章`
      elements.prefabSummaryChapter.classList.remove('prefab-status__item-value--empty')
    } else {
      elements.prefabSummaryChapter.textContent = `已选 ${selectedChapters.size} 章`
      elements.prefabSummaryChapter.classList.remove('prefab-status__item-value--empty')
    }
  }
  
  updatePrefabValidationStatus()
}

/**
 * 保存选中的章节到localStorage
 */
function saveSelectedChapters() {
  const selectedChapterArray = Array.from(selectedChapters)
  const selectedChapterData = selectedChapterArray.map(index => {
    const chapter = currentChapters.find(c => c.index === index)
    // chapterId 使用章节 URL，chapterIndex 使用索引
    const chapterUrl = chapter ? (chapter.url || '') : ''
    return {
      chapterId: chapterUrl || `chapter_${index}`,
      chapterIndex: index,
      chapterTitle: chapter ? chapter.title : `第${index + 1}章`,
      chapterUrl: chapterUrl
    }
  })
  
  // 保存所有选中的章节
  localStorage.setItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTERS, JSON.stringify(selectedChapterData))
  
  // 兼容旧版本：保存第一个选中的作为主要选择
  if (selectedChapterData.length > 0) {
    localStorage.setItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTER, JSON.stringify(selectedChapterData[0]))
  } else {
    localStorage.removeItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTER)
  }
}

/**
 * 从当前选中章节勾选至章底
 */
function selectChaptersToEnd() {
  if (selectedChapters.size === 0) {
    showToast('请先选择起始章节', 'warning')
    return
  }
  
  // 找到最小选中的索引（最早的章节）
  const minSelectedIndex = Math.min(...Array.from(selectedChapters))
  
  // 选中从该索引到末尾的所有章节
  currentChapters.forEach(chapter => {
    if (chapter.index >= minSelectedIndex) {
      selectedChapters.add(chapter.index)
    }
  })
  
  // 重新渲染以更新UI
  renderChapterList(currentChapters)
  saveSelectedChapters()
  
  showToast(`已选中从第${minSelectedIndex + 1}章至章底共 ${selectedChapters.size} 章`, 'success')
}

/**
 * 清空所有选择
 */
function clearChapterSelection() {
  selectedChapters.clear()
  renderChapterList(currentChapters)
  saveSelectedChapters()
  showToast('已清空选择', 'info')
}

async function openCacheManager() {
  if (!elements.cacheManagerModal) return
  await renderCacheManagerList()
  elements.cacheManagerModal.classList.add('active')
}

function closeCacheManager() {
  if (!elements.cacheManagerModal) return
  elements.cacheManagerModal.classList.remove('active')
}

// 预制管理弹窗函数
async function openPrefetchManager() {
  console.log('[openPrefetchManager] 开始打开弹窗')
  if (!elements.prefetchManagerModal) {
    console.log('[openPrefetchManager] 弹窗元素不存在')
    return
  }
  console.log('[openPrefetchManager] 调用 renderPrefetchManagerList')
  await renderPrefetchManagerList()
  console.log('[openPrefetchManager] 显示弹窗')
  elements.prefetchManagerModal.classList.add('active')
}

function closePrefetchManager() {
  if (!elements.prefetchManagerModal) return
  elements.prefetchManagerModal.classList.remove('active')
}

// 当前选中的书籍数据（用于二级页面）
let currentPrefetchBookData = null

/**
 * 渲染预制任务管理列表（一级页面：总任务列表）
 * 一本书对应一个总任务，点击后进入二级页面查看子任务
 */
async function renderPrefetchManagerList() {
  if (!elements.prefetchManagerBody) return
  const body = elements.prefetchManagerBody

  // 显示加载中
  body.innerHTML = `
    <div class="prefab-empty">
      <div class="prefab-empty__icon"><i class="fas fa-spinner fa-spin"></i></div>
      <div class="prefab-empty__title">加载中...</div>
    </div>
  `

  try {
    // 获取所有任务
    const tasksResponse = await fetch('/api/legado/prefetch/tasks').catch(() => ({ json: () => ({ success: false, data: [] }) }))
    const tasksResult = await tasksResponse.json()
    const allTasks = tasksResult.success ? (tasksResult.data || []) : []

    // 按书籍分组 - 一本书对应一个总任务，包含多个子任务
    const bookGroups = new Map()
    console.log('[renderPrefetchManagerList] API返回的任务数量:', allTasks.length, allTasks.map(t => t.taskId))

    allTasks.forEach(task => {
      const bookId = task.bookInfo?.bookId || task.bookInfo?.bookUrl || 'unknown'
      const bookName = task.bookInfo?.bookName || '未知书籍'

      if (!bookGroups.has(bookId)) {
        bookGroups.set(bookId, {
          bookId,
          bookName,
          bookUrl: task.bookInfo?.bookUrl || '',
          tasks: [], // 子任务列表
          totalSubTasks: 0,
          completedSubTasks: 0,
          status: 'pending'
        })
      }

      const group = bookGroups.get(bookId)
      group.tasks.push(task)
      group.totalSubTasks++

      // 判断子任务是否完成：根据实际章节完成情况，而不是仅仅依赖 task.status
      const chapters = task.chapters || []
      const chaptersInfo = task.chaptersInfo || []
      const totalChapters = chaptersInfo.length || chapters.length || 0
      const completedChapters = chapters.filter(c => c.status === 'completed').length
      const isTaskActuallyCompleted = totalChapters > 0 && completedChapters === totalChapters

      if (task.status === 'completed' || isTaskActuallyCompleted) {
        group.completedSubTasks++
      }

      // 更新状态优先级（数值越高优先级越高）
      // 如果任务实际已完成，使用 completed 状态
      const effectiveStatus = isTaskActuallyCompleted ? 'completed' : task.status
      const statusPriority = { processing: 4, paused: 3, pending: 2, completed: 1, failed: 0 }
      if (statusPriority[effectiveStatus] > statusPriority[group.status]) {
        group.status = effectiveStatus
      }
    })

    // 如果所有子任务都完成了，父任务状态应该是 completed
    bookGroups.forEach(group => {
      if (group.totalSubTasks > 0 && group.completedSubTasks === group.totalSubTasks) {
        group.status = 'completed'
      }
    })

    // 注意：不再合并已完成的缓存书籍到任务管理列表
    // 已完成的预制内容将在单独的"已预制内容管理"功能中显示

    const hasContent = bookGroups.size > 0

    if (!hasContent) {
      body.innerHTML = `
        <div class="prefab-empty">
          <div class="prefab-empty__icon"><i class="fas fa-inbox"></i></div>
          <div class="prefab-empty__title">暂无预制任务</div>
          <div class="prefab-empty__desc">在预制书模式下选择章节并开始预制</div>
        </div>
      `
      return
    }

    let html = '<div class="prefetch-books-list">'

    // 按书籍显示 - 点击后进入二级页面
    bookGroups.forEach((group, bookId) => {
      const statusConfig = getTaskStatusConfig(group.status)
      const progressPercent = group.totalSubTasks > 0
        ? Math.round((group.completedSubTasks / group.totalSubTasks) * 100)
        : 100

      html += `
        <div class="prefetch-book-card" data-book-id="${bookId}" onclick="enterPrefetchLevel2('${bookId}', '${group.bookName.replace(/'/g, "\\'")}')">
          <div class="prefetch-book-main">
            <div class="prefetch-book-title-row">
              <h4 class="prefetch-book-name" title="${group.bookName}">${group.bookName}</h4>
              <span class="prefetch-book-status ${statusConfig.class}">
                <i class="fas fa-circle"></i>${statusConfig.text}
              </span>
            </div>
            <div class="prefetch-book-meta">
              <span class="prefetch-book-tasks-count">
                <i class="fas fa-tasks"></i>${group.completedSubTasks}/${group.totalSubTasks} 个子任务
              </span>
              <span class="prefetch-book-percent">${progressPercent}%</span>
            </div>
            <div class="prefetch-book-progress-bar">
              <div class="prefetch-progress-track">
                <div class="prefetch-progress-fill ${statusConfig.class}" style="width: ${progressPercent}%;"></div>
              </div>
            </div>
          </div>
          <div class="prefetch-book-actions" onclick="event.stopPropagation();">
            <button class="prefetch-btn-delete" onclick="deletePrefetchBook('${bookId}', '${group.bookName.replace(/'/g, "\\'")}')" title="删除预制">
              <i class="fas fa-trash"></i>
            </button>
            <i class="fas fa-chevron-right prefetch-enter-icon"></i>
          </div>
        </div>
      `
    })

    html += '</div>'

    // 底部统计
    const totalBooks = bookGroups.size
    const totalSubTasks = Array.from(bookGroups.values()).reduce((sum, g) => sum + g.totalSubTasks, 0)
    const completedSubTasks = Array.from(bookGroups.values()).reduce((sum, g) => sum + g.completedSubTasks, 0)

    html += `
      <div class="prefetch-footer-stats">
        <div class="prefetch-stats-row">
          <span class="prefetch-stat-item">
            <i class="fas fa-books"></i>共 ${totalBooks} 本书
          </span>
          <span class="prefetch-stat-item">
            <i class="fas fa-tasks"></i>${completedSubTasks}/${totalSubTasks} 个子任务
          </span>
        </div>
        <button class="prefetch-btn-clear-all" onclick="clearAllPrefetchTasks()">
          <i class="fas fa-trash-alt"></i> 清空所有任务
        </button>
      </div>
    `

    // 保存书籍数据供二级页面使用
    window.prefetchBookGroups = bookGroups

    body.innerHTML = html
  } catch (error) {
    console.error('获取预制列表失败:', error)
    body.innerHTML = `
      <div class="prefab-empty">
        <div class="prefab-empty__icon"><i class="fas fa-exclamation-circle"></i></div>
        <div class="prefab-empty__title">获取预制列表失败</div>
        <div class="prefab-empty__desc">${error.message}</div>
      </div>
    `
  }
}

/**
 * 获取任务状态配置
 * @param {string} status - 状态码
 * @returns {Object} 状态配置对象
 */
function getTaskStatusConfig(status) {
  const config = {
    pending: { text: '等待中', class: 'status-pending', color: 'var(--warning-color)' },
    processing: { text: '处理中', class: 'status-processing', color: 'var(--accent-color)' },
    paused: { text: '已暂停', class: 'status-paused', color: 'var(--warning-color)' },
    completed: { text: '已完成', class: 'status-completed', color: 'var(--success-color)' },
    failed: { text: '失败', class: 'status-failed', color: 'var(--error-color)' }
  }
  return config[status] || config.pending
}

/**
 * 进入二级页面 - 显示子任务列表
 * @param {string} bookId - 书籍ID
 * @param {string} bookName - 书籍名称
 */
function enterPrefetchLevel2(bookId, bookName) {
  const bookGroups = window.prefetchBookGroups
  if (!bookGroups || !bookGroups.has(bookId)) {
    showToast('未找到该书籍的任务数据', 'error')
    return
  }

  const group = bookGroups.get(bookId)
  currentPrefetchBookData = group

  // 更新二级页面标题
  const titleEl = document.getElementById('prefetchLevel2Title')
  if (titleEl) {
    titleEl.innerHTML = `<i class="fas fa-tasks"></i> ${bookName}`
  }

  // 渲染子任务列表
  const subTaskBody = document.getElementById('prefetchSubTaskBody')
  if (subTaskBody) {
    subTaskBody.innerHTML = renderSubTaskListSimple(group.tasks)
  }

  // 切换页面显示
  document.getElementById('prefetchLevel1').style.display = 'none'
  document.getElementById('prefetchLevel2').style.display = 'block'
}

/**
 * 返回一级页面
 */
function backToPrefetchLevel1() {
  document.getElementById('prefetchLevel2').style.display = 'none'
  document.getElementById('prefetchLevel1').style.display = 'block'
  currentPrefetchBookData = null
  // 刷新一级页面数据
  renderPrefetchManagerList()
}

/**
 * 关闭预制任务管理弹窗
 */
function closePrefetchModal() {
  const modal = document.getElementById('prefetchManagerModal')
  if (modal) {
    modal.classList.remove('active')
  }
  // 重置到一级页面
  backToPrefetchLevel1()
}

/**
 * 渲染子任务列表（简化版）
 * 只显示：进度、范围、完成条数、状态
 * @param {Array} tasks - 子任务数组
 * @returns {string} HTML字符串
 */
function renderSubTaskListSimple(tasks) {
  console.log('[renderSubTaskListSimple] 接收到的任务数量:', tasks?.length || 0, tasks)
  if (!tasks || tasks.length === 0) {
    return `
      <div class="prefab-empty">
        <div class="prefab-empty__icon"><i class="fas fa-inbox"></i></div>
        <div class="prefab-empty__title">暂无子任务</div>
        <div class="prefab-empty__desc">该书籍没有活跃的预制任务</div>
      </div>
    `
  }

  let html = '<div class="prefetch-subtasks-simple-list">'

  tasks.forEach((task, index) => {
    // 获取章节信息
    const chaptersInfo = task.chaptersInfo || []
    const chapters = task.chapters || []
    const totalChapters = chaptersInfo.length || chapters.length || 0
    const completedChapters = chapters.filter(c => c.status === 'completed').length
    const progressPercent = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0
    
    // 如果进度为100%，强制状态为已完成
    let displayStatus = task.status
    if (progressPercent === 100 && completedChapters === totalChapters && totalChapters > 0) {
      displayStatus = 'completed'
    }
    
    const statusConfig = getTaskStatusConfig(displayStatus)
    const progress = task.progress || { completed: 0, total: 0 }
    
    // 获取子任务处理的章节范围
    let chapterRange = ''
    
    if (chaptersInfo.length > 0) {
      // 过滤掉没有有效 chapterIndex 的章节
      const validChapters = chaptersInfo.filter(c => typeof c.chapterIndex === 'number' && !isNaN(c.chapterIndex))
      if (validChapters.length > 0) {
        const sortedChapters = [...validChapters].sort((a, b) => a.chapterIndex - b.chapterIndex)
        const firstChapter = sortedChapters[0]
        const lastChapter = sortedChapters[sortedChapters.length - 1]
        const firstIndex = firstChapter.chapterIndex + 1
        const lastIndex = lastChapter.chapterIndex + 1
        chapterRange = `第${firstIndex}章 ~ 第${lastIndex}章`
      } else {
        chapterRange = `${chaptersInfo.length} 章`
      }
    } else if (chapters.length > 0) {
      const validChapters = chapters.filter(c => typeof c.chapterIndex === 'number' && !isNaN(c.chapterIndex))
      if (validChapters.length > 0) {
        const sortedChapters = [...validChapters].sort((a, b) => a.chapterIndex - b.chapterIndex)
        const firstChapter = sortedChapters[0]
        const lastChapter = sortedChapters[sortedChapters.length - 1]
        const firstIndex = firstChapter.chapterIndex + 1
        const lastIndex = lastChapter.chapterIndex + 1
        chapterRange = `第${firstIndex}章 ~ 第${lastIndex}章`
      } else {
        chapterRange = `${chapters.length} 章`
      }
    } else {
      chapterRange = `${totalChapters} 章`
    }
    
    // 获取语速和发音人信息
    const options = task.options || {}
    const voiceId = options.voiceId || ''
    const speed = options.speed !== undefined ? options.speed : 0
    const speedText = speed > 0 ? `+${speed}%` : speed < 0 ? `${speed}%` : '正常'
    
    // 查找发音人名称
    let voiceName = '默认'
    if (voiceId && availableVoices && availableVoices.length > 0) {
      const voice = availableVoices.find(v => v.style_id === voiceId || v.id === voiceId)
      if (voice) {
        voiceName = voice.name
      } else {
        voiceName = voiceId
      }
    }

    // 判断是否可以点击继续（未完成的子任务）
    const taskStatus = (displayStatus || '').toString().trim()
    const canResume = taskStatus === 'paused' || taskStatus === 'pending' || taskStatus === 'failed'
    // 点击卡片只加载任务，不自动恢复（恢复需要点击按钮）
    const clickAction = canResume
      ? `onclick="loadTaskToProgressCard('${task.taskId}', '${task.bookInfo?.bookId || ''}', '${task.bookInfo?.bookName || ''}')"`
      : ''

    html += `
      <div class="prefetch-subtask-simple-item ${canResume ? 'subtask-resumable' : ''}" data-task-id="${task.taskId}" ${clickAction}>
        <div class="subtask-simple-main">
          <div class="subtask-simple-header">
            <span class="subtask-simple-index">子任务 ${index + 1}</span>
            <span class="subtask-simple-status ${statusConfig.class}">${statusConfig.text}</span>
          </div>
          <div class="subtask-simple-range">
            <i class="fas fa-layer-group"></i>${chapterRange}
          </div>
          <div class="subtask-simple-meta">
            <span class="subtask-simple-voice" title="发音人: ${voiceId}"><i class="fas fa-microphone"></i> ${voiceName}</span>
            <span class="subtask-simple-speed" title="语速"><i class="fas fa-tachometer-alt"></i> ${speedText}</span>
          </div>
          <div class="subtask-simple-progress">
            <div class="subtask-simple-bar">
              <div class="subtask-simple-track">
                <div class="subtask-simple-fill ${statusConfig.class}" style="width: ${progressPercent}%"></div>
              </div>
              <span class="subtask-simple-percent">${progressPercent}%</span>
            </div>
            <div class="subtask-simple-count">${completedChapters}/${totalChapters} 章</div>
          </div>
        </div>
        <div class="subtask-simple-actions" onclick="event.stopPropagation();">
          ${canResume ? `
            <button class="subtask-simple-btn resume" onclick="resumeSubTask('${task.taskId}', '${task.bookInfo?.bookId || ''}', '${task.bookInfo?.bookName || ''}')" title="继续任务">
              <i class="fas fa-play"></i>
            </button>
          ` : ''}
          ${taskStatus === 'processing' ? `
            <button class="subtask-simple-btn pause" onclick="pauseSubTask('${task.taskId}')" title="暂停任务">
              <i class="fas fa-pause"></i>
            </button>
          ` : ''}
          <button class="subtask-simple-btn delete" onclick="deleteSubTask('${task.taskId}')" title="删除任务">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `
  })

  html += '</div>'
  return html
}

/**
 * 继续子任务 - 加载任务到进度卡片并恢复
 * @param {string} taskId - 子任务ID
 * @param {string} bookId - 书籍ID
 * @param {string} bookName - 书籍名称
 */
async function resumeSubTask(taskId, bookId, bookName) {
  try {
    // 先加载任务到进度卡片
    await loadTaskToProgressCard(taskId, bookId, bookName)

    // 如果任务是暂停或待处理状态，则恢复它
    const response = await fetch(`/api/legado/prefetch/resume/${taskId}`, {
      method: 'POST'
    })
    const result = await response.json()

    if (result.success) {
      showToast('任务已恢复', 'success')
      // 刷新列表
      setTimeout(() => renderPrefetchManagerList(), 500)
    } else {
      showToast(`恢复失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('恢复子任务失败:', error)
    showToast(`恢复失败：${error.message}`, 'error')
  }
}

/**
 * 暂停子任务
 * @param {string} taskId - 子任务ID
 */
async function pauseSubTask(taskId) {
  try {
    const response = await fetch(`/api/legado/prefetch/pause/${taskId}`, {
      method: 'POST'
    })
    const result = await response.json()

    if (result.success) {
      showToast('任务已暂停', 'success')
      renderPrefetchManagerList()
    } else {
      showToast(`暂停失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('暂停子任务失败:', error)
    showToast(`暂停失败：${error.message}`, 'error')
  }
}

/**
 * 删除子任务
 * @param {string} taskId - 子任务ID
 */
async function deleteSubTask(taskId) {
  if (!confirm('确定要删除这个子任务吗？')) return

  try {
    // 使用 DELETE API 真正删除任务
    const response = await fetch(`/api/legado/prefetch/tasks/${taskId}`, {
      method: 'DELETE'
    })
    const result = await response.json()

    if (result.success) {
      showToast('任务已删除', 'success')
      // 延迟刷新二级页面的子任务列表，等待服务器完成删除
      setTimeout(() => refreshPrefetchSubTaskList(), 500)
    } else {
      showToast(`删除失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('删除子任务失败:', error)
    showToast(`删除失败：${error.message}`, 'error')
  }
}

/**
 * 刷新二级页面的子任务列表
 */
async function refreshPrefetchSubTaskList() {
  if (!currentPrefetchBookData) {
    // 如果没有当前书籍数据，刷新一级页面
    renderPrefetchManagerList()
    return
  }

  try {
    // 重新获取任务列表
    const response = await fetch('/api/legado/prefetch/tasks')
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.message || '获取任务列表失败')
    }

    const allTasks = result.data || []
    const bookId = currentPrefetchBookData.bookId

    // 过滤出当前书籍的子任务
    const bookTasks = allTasks.filter(t => {
      const taskBookId = t.bookInfo?.bookId || t.bookInfo?.bookUrl
      return taskBookId === bookId
    })

    // 更新当前书籍数据
    currentPrefetchBookData.tasks = bookTasks

    // 重新渲染子任务列表
    const subTaskBody = document.getElementById('prefetchSubTaskBody')
    if (subTaskBody) {
      subTaskBody.innerHTML = renderSubTaskListSimple(bookTasks)
    }

    // 如果该书籍没有子任务了，刷新一级页面
    if (bookTasks.length === 0) {
      renderPrefetchManagerList()
    }
  } catch (error) {
    console.error('刷新子任务列表失败:', error)
    showToast(`刷新失败：${error.message}`, 'error')
  }
}

/**
 * 渲染章节状态列表
 * @param {Array} chapters - 章节数组
 * @returns {string} HTML字符串
 */
function renderChapterStatusList(chapters) {
  if (!chapters || chapters.length === 0) return ''

  // 只显示前5个章节，如果更多则显示"..."
  const displayChapters = chapters.slice(0, 5)
  const hasMore = chapters.length > 5

  let html = '<div class="prefetch-chapters-mini">'

  displayChapters.forEach(chapter => {
    const statusIcon = {
      completed: '<i class="fas fa-check-circle status-icon-completed"></i>',
      processing: '<i class="fas fa-spinner fa-spin status-icon-processing"></i>',
      pending: '<i class="fas fa-clock status-icon-pending"></i>',
      failed: '<i class="fas fa-times-circle status-icon-failed"></i>'
    }[chapter.status] || '<i class="fas fa-question-circle"></i>'

    html += `
      <div class="prefetch-chapter-mini-item" title="${chapter.chapterTitle}">
        <span class="chapter-mini-status">${statusIcon}</span>
        <span class="chapter-mini-title">${chapter.chapterTitle}</span>
      </div>
    `
  })

  if (hasMore) {
    html += `<div class="prefetch-chapters-more">...还有 ${chapters.length - 5} 个章节</div>`
  }

  html += '</div>'
  return html
}

/**
 * 切换书籍详情展开/收起
 * @param {string} bookId - 书籍ID
 */
function togglePrefetchBookDetail(bookId) {
  const detailEl = document.getElementById(`detail-${bookId}`)
  const iconEl = document.getElementById(`expand-icon-${bookId}`)

  if (detailEl && iconEl) {
    const isVisible = detailEl.style.display !== 'none'
    detailEl.style.display = isVisible ? 'none' : 'block'
    iconEl.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)'
  }
}

/**
 * 恢复书籍的所有可恢复任务
 * @param {string} bookId - 书籍ID
 * @param {string} bookName - 书籍名称
 */
async function resumeBookTasks(bookId, bookName) {
  try {
    // 获取该书籍的所有任务
    const response = await fetch('/api/legado/prefetch/tasks')
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.message || '获取任务列表失败')
    }

    const tasks = result.data || []
    const bookTasks = tasks.filter(t => {
      const taskBookId = t.bookInfo?.bookId || t.bookInfo?.bookUrl
      return taskBookId === bookId && (t.status === 'paused' || t.status === 'pending')
    })

    if (bookTasks.length === 0) {
      showToast('没有可恢复的任务', 'info')
      return
    }

    // 恢复第一个任务
    const firstTask = bookTasks[0]
    const resumeResponse = await fetch(`/api/legado/prefetch/resume/${firstTask.taskId}`, {
      method: 'POST'
    })
    const resumeResult = await resumeResponse.json()

    if (resumeResult.success) {
      showToast(`《${bookName}》任务已恢复`, 'success')
      // 加载任务到进度卡片
      loadTaskToProgressCard(firstTask.taskId, bookId, bookName)
      // 刷新列表
      setTimeout(() => renderPrefetchManagerList(), 500)
    } else {
      showToast(`恢复失败：${resumeResult.message}`, 'error')
    }
  } catch (error) {
    console.error('恢复任务失败:', error)
    showToast(`恢复失败：${error.message}`, 'error')
  }
}

/**
 * 查看书籍任务进度
 * @param {string} bookId - 书籍ID
 * @param {string} bookName - 书籍名称
 */
async function viewBookTaskProgress(bookId, bookName) {
  try {
    const response = await fetch('/api/legado/prefetch/tasks')
    const result = await response.json()

    if (!result.success) {
      throw new Error(result.message || '获取任务列表失败')
    }

    const tasks = result.data || []
    const processingTask = tasks.find(t => {
      const taskBookId = t.bookInfo?.bookId || t.bookInfo?.bookUrl
      return taskBookId === bookId && t.status === 'processing'
    })

    if (processingTask) {
      loadTaskToProgressCard(processingTask.taskId, bookId, bookName)
    } else {
      showToast('没有找到正在处理的任务', 'info')
    }
  } catch (error) {
    console.error('查看任务进度失败:', error)
    showToast(`查看失败：${error.message}`, 'error')
  }
}

/**
 * 暂停指定任务
 * @param {string} taskId - 任务ID
 */
async function pauseTask(taskId) {
  try {
    const response = await fetch(`/api/legado/prefetch/pause/${taskId}`, {
      method: 'POST'
    })
    const result = await response.json()

    if (result.success) {
      showToast('任务已暂停', 'success')
      renderPrefetchManagerList()
    } else {
      showToast(`暂停失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('暂停任务失败:', error)
    showToast(`暂停失败：${error.message}`, 'error')
  }
}

/**
 * 恢复指定任务
 * @param {string} taskId - 任务ID
 */
async function resumeTask(taskId) {
  try {
    const response = await fetch(`/api/legado/prefetch/resume/${taskId}`, {
      method: 'POST'
    })
    const result = await response.json()

    if (result.success) {
      showToast('任务已恢复', 'success')
      renderPrefetchManagerList()
    } else {
      showToast(`恢复失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('恢复任务失败:', error)
    showToast(`恢复失败：${error.message}`, 'error')
  }
}

/**
 * 删除指定任务
 * @param {string} taskId - 任务ID
 */
async function deleteTask(taskId) {
  if (!confirm('确定要删除这个任务吗？')) return

  try {
    const response = await fetch(`/api/legado/prefetch/cancel/${taskId}`, {
      method: 'POST'
    })
    const result = await response.json()

    if (result.success) {
      showToast('任务已删除', 'success')
      renderPrefetchManagerList()
    } else {
      showToast(`删除失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('删除任务失败:', error)
    showToast(`删除失败：${error.message}`, 'error')
  }
}

async function renderCacheManagerList() {
  if (!elements.cacheManagerBody) return
  const body = elements.cacheManagerBody

  // 显示加载中
  body.innerHTML = `
    <div class="prefab-empty">
      <div class="prefab-empty__icon"><i class="fas fa-spinner fa-spin"></i></div>
      <div class="prefab-empty__title">加载中...</div>
    </div>
  `

  try {
    // 从后端获取缓存列表（只获取缓存数据）
    const response = await fetch('/api/legado/book-cache/list?source=cache')
    const result = await response.json()
    console.log('[renderCacheManagerList] API返回:', result)

    if (!result.success) {
      throw new Error(result.message || '获取缓存列表失败')
    }

    const cachedBooks = result.data || []
    console.log('[renderCacheManagerList] 获取到书籍数量:', cachedBooks.length, cachedBooks)
    
    if (cachedBooks.length === 0) {
      body.innerHTML = `
        <div class="prefab-empty">
          <div class="prefab-empty__icon"><i class="fas fa-inbox"></i></div>
          <div class="prefab-empty__title">暂无缓存</div>
          <div class="prefab-empty__desc">点击书籍上的缓存按钮可以缓存整本书</div>
        </div>
      `
      return
    }
    
    body.innerHTML = `
      <div class="prefab-cache-list">
        ${cachedBooks.map(book => {
          const cachedCount = book.cachedChapters || 0
          const totalCount = book.totalChapters || 0
          const progressPercent = totalCount > 0 ? Math.round((cachedCount / totalCount) * 100) : 0
          const status = book.status || 'unknown'
          const isComplete = status === 'completed'
          const isCaching = status === 'caching'
          const isPaused = status === 'paused'

          // 根据状态显示不同的标签
          let statusTag = ''
          if (isComplete) {
            statusTag = '<span style="color: var(--success-color); margin-left: 8px; font-size: 0.75rem;"><i class="fas fa-check-circle"></i> 已完成</span>'
          } else if (isCaching) {
            statusTag = '<span style="color: var(--primary-color); margin-left: 8px; font-size: 0.75rem;"><i class="fas fa-spinner fa-spin"></i> 缓存中</span>'
          } else if (isPaused) {
            statusTag = '<span style="color: var(--warning-color); margin-left: 8px; font-size: 0.75rem;"><i class="fas fa-exclamation-circle"></i> 已暂停</span>'
          }

          // 进度条颜色
          const progressColor = isComplete ? 'var(--success-color)' : isCaching ? 'var(--primary-color)' : 'var(--warning-color)'

          return `
          <div class="prefab-cache-item" style="padding: 16px; border-bottom: 1px solid var(--border-color);">
            <div class="prefab-cache-item__info" style="flex: 1;">
              <div class="prefab-cache-item__name" style="font-weight: 600; font-size: 1rem; margin-bottom: 8px; display: flex; align-items: center;">
                <span style="flex: 1;">${book.name || '未知书籍'}</span>
                ${statusTag}
              </div>
              <div class="prefab-cache-item__meta" style="font-size: 0.8125rem; color: var(--text-secondary);">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 8px; flex-wrap: wrap;">
                  <span title="已缓存章节数"><i class="fas fa-file-alt" style="margin-right: 4px; color: var(--primary-color);"></i>${cachedCount}/${totalCount} 章</span>
                  <span title="缓存进度"><i class="fas fa-percentage" style="margin-right: 4px; color: var(--primary-color);"></i>${progressPercent}%</span>
                  ${book.failedChapters > 0 ? `<span title="失败章节数" style="color: var(--error-color);"><i class="fas fa-times-circle" style="margin-right: 4px;"></i>${book.failedChapters} 章失败</span>` : ''}
                  <span title="缓存时间"><i class="fas fa-calendar" style="margin-right: 4px; color: var(--text-tertiary);"></i>${new Date(book.cachedAt).toLocaleString()}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="flex: 1; height: 8px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
                    <div style="width: ${progressPercent}%; height: 100%; background: ${progressColor}; border-radius: 4px; transition: width 0.3s ease;"></div>
                  </div>
                </div>
              </div>
            </div>
            <button class="prefab-cache-item__delete" onclick="deleteBookCache('${book.bookUrl}')" title="删除缓存" style="margin-left: 12px;">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        `
        }).join('')}
      </div>
      <div class="prefab-cache-actions" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.875rem; color: var(--text-secondary);">
            <i class="fas fa-books" style="margin-right: 4px;"></i>共 ${cachedBooks.length} 本书籍 · 
            <i class="fas fa-file-alt" style="margin-right: 4px;"></i>${cachedBooks.reduce((sum, b) => sum + (b.cachedChapters || 0), 0)} 章已缓存
          </span>
          <button class="prefab-btn prefab-btn--ghost" onclick="clearAllBookCache('cache', renderCacheManagerList)">
            <i class="fas fa-trash-alt"></i> 清空所有缓存
          </button>
        </div>
      </div>
    `
  } catch (error) {
    console.error('获取缓存列表失败:', error)
    body.innerHTML = `
      <div class="prefab-empty">
        <div class="prefab-empty__icon"><i class="fas fa-exclamation-circle"></i></div>
        <div class="prefab-empty__title">获取缓存列表失败</div>
        <div class="prefab-empty__desc">${error.message}</div>
      </div>
    `
  }
}

async function deleteBookCache(bookUrl) {
  if (!confirm('确定要删除这本书的缓存吗？')) return

  try {
    // 调用后端 API 删除缓存
    const response = await fetch(`/api/legado/book-cache/delete?bookUrl=${encodeURIComponent(bookUrl)}`, {
      method: 'DELETE'
    })
    const result = await response.json()

    if (result.success) {
      // 同时删除前端状态
      bookCacheStatus.delete(bookUrl)
      saveBookCacheStatus()
      renderCacheManagerList()
      refreshBookshelfCacheStatus()
      // 重新加载书籍库，移除已删除的书籍
      await loadCachedBooks()
      showToast('缓存已删除', 'success')
    } else {
      const errorMsg = result.message || result.msg || '未知错误'
      showToast(`删除失败：${errorMsg}`, 'error')
    }
  } catch (error) {
    console.error('删除缓存失败:', error)
    showToast(`删除失败：${error.message}`, 'error')
  }
}

/**
 * 删除预制书籍（只删除任务记录，保留已预制内容）
 * @param {string} bookId - 书籍ID
 * @param {string} bookName - 书籍名称
 */
async function deletePrefetchBook(bookId, bookName) {
  if (!confirm(`确定要删除《${bookName}》的所有任务吗？\n\n⚠️ 注意：这将只删除任务记录，已预制的音频内容将保留。`)) return

  try {
    // 使用API删除书籍的所有任务，保留已预制的内容（keepCache=true）
    const response = await fetch(`/api/legado/prefetch/book/${encodeURIComponent(bookId)}?keepCache=true`, {
      method: 'DELETE'
    })
    const result = await response.json()

    if (result.success) {
      console.log(`[deletePrefetchBook] 已删除任务记录（保留预制内容）`, { bookId, deletedTaskCount: result.data?.deletedTaskCount })

      // 同时删除前端状态
      bookCacheStatus.delete(bookId)
      saveBookCacheStatus()
      renderPrefetchManagerList()
      refreshBookshelfCacheStatus()
      showToast('任务记录已删除（已预制内容已保留）', 'success')
    } else {
      showToast(`删除失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('删除预制失败:', error)
    showToast(`删除失败：${error.message}`, 'error')
  }
}

/**
 * 清空书籍缓存
 * @param {string} type - 清理类型：'cache'(仅缓存), 'prefetch'(仅预制), 'all'(全部)，默认'all'
 * @param {Function} renderCallback - 清理完成后重新渲染的回调函数
 */
async function clearAllBookCache(type = 'all', renderCallback = null) {
  console.log('[clearAllBookCache] 开始清空', { type, renderCallback: !!renderCallback })

  const typeLabels = {
    'cache': '缓存',
    'prefetch': '预制',
    'all': '缓存和预制'
  }

  if (!confirm(`确定要清空所有书籍${typeLabels[type]}吗？`)) {
    console.log('[clearAllBookCache] 用户取消')
    return
  }

  try {
    console.log('[clearAllBookCache] 调用API', { type })
    // 调用后端 API 清空指定类型的缓存
    const response = await fetch(`/api/legado/book-cache/clear?type=${type}`, {
      method: 'DELETE'
    })
    console.log('[clearAllBookCache] API响应', { status: response.status })
    const result = await response.json()
    console.log('[clearAllBookCache] API结果', result)

    if (result.success) {
      // 如果清理的是缓存或全部，清空前端状态
      if (type === 'cache' || type === 'all') {
        bookCacheStatus.clear()
        saveBookCacheStatus()
        refreshBookshelfCacheStatus()
      }

      // 执行重新渲染回调
      if (renderCallback) {
        console.log('[clearAllBookCache] 执行重新渲染回调')
        await renderCallback()
      }

      showToast(result.message, 'success')
    } else {
      showToast(`清空失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('[clearAllBookCache] 清空缓存失败:', error)
    showToast(`清空失败：${error.message}`, 'error')
  }
}

/**
 * 清空所有预制任务（只删除任务记录，保留已预制内容）
 */
async function clearAllPrefetchTasks() {
  if (!confirm('确定要清空所有预制任务吗？\n\n⚠️ 注意：这将只删除任务记录，已预制的音频内容将保留。')) {
    return
  }

  try {
    const response = await fetch('/api/legado/prefetch/tasks', {
      method: 'DELETE'
    })
    const result = await response.json()

    if (result.success) {
      showToast(`已清空 ${result.data?.clearedCount || 0} 个任务`, 'success')
      // 刷新任务列表
      renderPrefetchManagerList()
    } else {
      showToast(`清空失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('[clearAllPrefetchTasks] 清空任务失败:', error)
    showToast(`清空失败：${error.message}`, 'error')
  }
}

/**
 * 打开已预制内容管理弹窗
 */
async function openPrefetchedContentManager() {
  console.log('[openPrefetchedContentManager] 打开已预制内容管理')
  const modal = document.getElementById('prefetchedContentModal')
  if (modal) {
    modal.classList.add('active')
    await renderPrefetchedContentList()
  }
}

/**
 * 关闭已预制内容管理弹窗
 */
function closePrefetchedContentManager() {
  const modal = document.getElementById('prefetchedContentModal')
  if (modal) {
    modal.classList.remove('active')
  }
}

/**
 * 渲染已预制内容列表
 */
async function renderPrefetchedContentList() {
  const body = document.getElementById('prefetchedContentBody')
  if (!body) return

  // 显示加载中
  body.innerHTML = `
    <div class="prefab-empty">
      <div class="prefab-empty__icon"><i class="fas fa-spinner fa-spin"></i></div>
      <div class="prefab-empty__title">加载中...</div>
    </div>
  `

  try {
    // 获取已完成的预制内容
    const response = await fetch('/api/legado/book-cache/list?source=prefetch').catch(() => ({ json: () => ({ success: false, data: [] }) }))
    const result = await response.json()
    const prefetchedBooks = result.success ? (result.data || []) : []

    console.log('[renderPrefetchedContentList] 获取到已预制内容:', prefetchedBooks.length, prefetchedBooks.map(b => ({ name: b.name, chapters: b.cachedChapters })))

    if (prefetchedBooks.length === 0) {
      body.innerHTML = `
        <div class="prefab-empty">
          <div class="prefab-empty__icon"><i class="fas fa-archive"></i></div>
          <div class="prefab-empty__title">暂无已预制内容</div>
          <div class="prefab-empty__desc">完成预制任务后，内容将显示在这里</div>
        </div>
      `
      return
    }

    let html = '<div class="prefetch-books-list">'

    prefetchedBooks.forEach(book => {
      const totalSize = formatFileSize(book.totalSize || 0)
      html += `
        <div class="prefetch-book-card">
          <div class="prefetch-book-main">
            <div class="prefetch-book-title-row">
              <h4 class="prefetch-book-name" title="${book.name}">${book.name}</h4>
              <span class="prefetch-book-status completed">
                <i class="fas fa-check-circle"></i>已完成
              </span>
            </div>
            <div class="prefetch-book-meta">
              <span class="prefetch-book-tasks-count">
                <i class="fas fa-file-audio"></i>${book.cachedChapters || 0} 章已预制
              </span>
              <span class="prefetch-book-percent">${totalSize}</span>
            </div>
            <div class="prefetch-book-progress-bar">
              <div class="prefetch-progress-track">
                <div class="prefetch-progress-fill completed" style="width: 100%;"></div>
              </div>
            </div>
          </div>
          <div class="prefetch-book-actions">
            <button class="prefetch-btn-delete" onclick="deletePrefetchedContent('${book.bookUrl}', '${book.name.replace(/'/g, "\\'")}')" title="删除已预制内容">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `
    })

    html += '</div>'

    // 底部统计
    const totalBooks = prefetchedBooks.length
    const totalChapters = prefetchedBooks.reduce((sum, b) => sum + (b.cachedChapters || 0), 0)
    const totalSize = formatFileSize(prefetchedBooks.reduce((sum, b) => sum + (b.totalSize || 0), 0))

    html += `
      <div class="prefetch-footer-stats">
        <div class="prefetch-stats-row">
          <span class="prefetch-stat-item">
            <i class="fas fa-books"></i>共 ${totalBooks} 本书
          </span>
          <span class="prefetch-stat-item">
            <i class="fas fa-file-audio"></i>${totalChapters} 章已预制
          </span>
          <span class="prefetch-stat-item">
            <i class="fas fa-hdd"></i>${totalSize}
          </span>
        </div>
        <button class="prefetch-btn-clear-all" onclick="clearAllPrefetchedContent()">
          <i class="fas fa-trash-alt"></i> 清空所有已预制内容
        </button>
      </div>
    `

    body.innerHTML = html
  } catch (error) {
    console.error('获取已预制内容列表失败:', error)
    body.innerHTML = `
      <div class="prefab-empty">
        <div class="prefab-empty__icon"><i class="fas fa-exclamation-circle"></i></div>
        <div class="prefab-empty__title">获取已预制内容失败</div>
        <div class="prefab-empty__desc">${error.message}</div>
      </div>
    `
  }
}

/**
 * 删除已预制内容（只删除音频文件，保留任务记录）
 * @param {string} bookId - 书籍ID
 * @param {string} bookName - 书籍名称
 */
async function deletePrefetchedContent(bookId, bookName) {
  if (!confirm(`确定要删除《${bookName}》的所有已预制内容吗？\n\n⚠️ 注意：这将只删除音频文件，任务记录将保留。`)) return

  try {
    // 使用新的 API，只删除音频文件，不删除任务记录
    const response = await fetch(`/api/legado/prefetched-content/${encodeURIComponent(bookId)}`, {
      method: 'DELETE'
    })
    const result = await response.json()

    if (result.success) {
      console.log(`[deletePrefetchedContent] 已删除预制内容（保留任务记录）`, { bookId, cacheDeleted: result.data?.cacheDeleted })
      showToast(result.message || '已预制内容已删除', 'success')
      // 刷新列表
      await renderPrefetchedContentList()
    } else {
      showToast(`删除失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('删除已预制内容失败:', error)
    showToast(`删除失败：${error.message}`, 'error')
  }
}

/**
 * 清空所有已预制内容（只删除音频文件，保留任务记录）
 */
async function clearAllPrefetchedContent() {
  if (!confirm('确定要清空所有已预制内容吗？\n\n⚠️ 注意：这将只删除音频文件，任务记录将保留。')) return

  try {
    // 使用新的 API，只删除音频文件，不删除任务记录
    const response = await fetch('/api/legado/prefetched-content/clear', {
      method: 'DELETE'
    })
    const result = await response.json()

    if (result.success) {
      showToast(result.message || '所有已预制内容已清空', 'success')
      await renderPrefetchedContentList()
    } else {
      showToast(`清空失败：${result.message}`, 'error')
    }
  } catch (error) {
    console.error('清空已预制内容失败:', error)
    showToast(`清空失败：${error.message}`, 'error')
  }
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的字符串
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 加载任务到处理信息卡片
 * 点击预制任务管理中的任务项时调用
 * @param {string} taskId - 任务ID
 * @param {string} bookId - 书籍ID
 * @param {string} bookName - 书籍名称
 */
async function loadTaskToProgressCard(taskId, bookId, bookName) {
  console.log('[loadTaskToProgressCard] 加载任务到处理卡片:', { taskId, bookId, bookName })
  
  try {
    // 关闭预制任务管理弹窗
    closePrefetchManager()
    
    // 设置当前任务ID
    currentTaskId = taskId
    
    // 显示提示
    showToast(`正在加载任务《${bookName}》...`, 'info')
    
    // 清空控制台并添加初始日志

    
    // 立即查询一次任务状态
    const response = await fetch(`/api/legado/prefetch/status/${taskId}`)
    const result = await response.json()
    
    if (!result.success) {
      throw new Error(result.message || '获取任务状态失败')
    }
    
    const data = result.data
    const progress = data.progress || { completed: 0, total: 0 }

    // 调试日志
    console.log('[loadTaskToProgressCard] 任务数据:', {
      status: data.status,
      progress: progress,
      taskId: taskId
    })

    // 更新处理信息卡片显示
    const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
    elements.processingProgressBar.style.width = `${percentage}%`
    elements.processingProgressText.textContent = `${percentage}%`
    elements.processingProgressCount.textContent = `${progress.completed}/${progress.total}`
    const statusText = getStatusText(data.status)
    console.log('[loadTaskToProgressCard] 状态文本:', { status: data.status, statusText })
    elements.processingCurrentStatus.textContent = statusText
    
    // 禁用开始按钮，启用暂停/取消按钮
    elements.startProcessingBtn.disabled = true
    
    // 根据状态设置暂停按钮
    if (data.status === 'paused') {
      updatePauseButtonState(true)
    } else {
      updatePauseButtonState(false)
    }

    // 添加日志


    // 如果任务还在进行中，开始轮询进度
    if (data.status === 'processing') {
      // 使用任务开始时间或当前时间作为计时起点
      const startTime = data.startTime ? new Date(data.startTime).getTime() : Date.now()
      startProgressPollingWithStartTime(taskId, bookId, null, startTime)
      showToast('已加载任务，正在监控进度...', 'success')
    } else if (data.status === 'paused') {
      // 任务已暂停，显示提示并等待用户点击继续

      showToast('任务已暂停，点击"继续"按钮恢复处理', 'info')
      // 开始轮询以监控状态变化（但不自动恢复）
      const startTime = data.startTime ? new Date(data.startTime).getTime() : Date.now()
      startProgressPollingWithStartTime(taskId, bookId, null, startTime)
    } else if (data.status === 'pending') {
      // 任务等待中，开始轮询
      const startTime = data.startTime ? new Date(data.startTime).getTime() : Date.now()
      startProgressPollingWithStartTime(taskId, bookId, null, startTime)
      showToast('任务等待中...', 'info')
    } else {
      // 任务已完成/失败/取消，显示最终结果

      elements.startProcessingBtn.disabled = false

      if (data.status === 'completed') {
        showToast('任务已完成！', 'success')
      } else if (data.status === 'failed') {
        showToast('任务处理失败', 'error')
      } else if (data.status === 'paused') {
        showToast('任务已暂停，可点击继续处理', 'warning')
      }
    }
    
  } catch (error) {
    console.error('[loadTaskToProgressCard] 加载任务失败:', error)
    showToast(`加载任务失败：${error.message}`, 'error')

  }
}

/**
 * 开始进度轮询（带指定开始时间）
 * @param {string} taskId - 任务ID
 * @param {string} bookId - 书籍ID
 * @param {string} chapterId - 章节ID
 * @param {number} startTime - 开始时间戳
 */
function startProgressPollingWithStartTime(taskId, bookId, chapterId, startTime) {
  let lastProgressTime = Date.now()
  let lastCompleted = -1  // 用于跟踪上次完成的数量，避免重复日志
  if (progressInterval) clearInterval(progressInterval)
  
  progressInterval = setInterval(async () => {
    try {
      // 构建查询URL，包含 bookId 和 chapterId
      let url = `/api/legado/prefetch/status/${taskId}`
      if (bookId && chapterId) {
        url += `?bookId=${encodeURIComponent(bookId)}&chapterId=${encodeURIComponent(chapterId)}`
      }
      const response = await fetch(url)
      const result = await response.json()
      if (result.success) {
        const data = result.data
        const progress = data.progress || { completed: 0, total: 0 }
        const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
        elements.processingProgressBar.style.width = `${percentage}%`
        elements.processingProgressText.textContent = `${percentage}%`
        
        // 判断是否是批量任务（有 chapters 数组）
        const isBatchTask = data.chapters && Array.isArray(data.chapters) && data.chapters.length > 0
        
        // 批量任务显示章节进度，单章节任务显示段进度
        if (isBatchTask) {
          elements.processingProgressCount.textContent = `${progress.completed}/${progress.total} 章`
        } else {
          elements.processingProgressCount.textContent = `${progress.completed}/${progress.total}`
        }
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        elements.processingElapsedTime.textContent = formatTime(elapsed)
        
        // 只有在非暂停状态下才更新预计剩余时间
        if (data.status !== 'paused' && progress.completed > 0 && progress.completed < progress.total) {
          const avgTime = elapsed / progress.completed
          const remaining = Math.floor(avgTime * (progress.total - progress.completed))
          elements.processingRemainingTime.textContent = formatTime(remaining)
        }
        
        // 批量任务显示更详细的状态
        let currentChapter = null
        if (isBatchTask && data.status === 'processing') {
          currentChapter = data.chapters.find(c => c.status === 'processing')
          if (currentChapter) {
            elements.processingCurrentStatus.textContent = `正在处理: ${currentChapter.chapterTitle}`
          } else {
            elements.processingCurrentStatus.textContent = getStatusText(data.status)
          }
        } else {
          elements.processingCurrentStatus.textContent = getStatusText(data.status)
        }

        // 根据状态更新暂停按钮
        if (data.status === 'paused') {
          updatePauseButtonState(true)
        } else if (data.status === 'processing') {
          updatePauseButtonState(false)
        } else if (data.status === 'pending') {
          // 等待中状态也显示暂停按钮（任务未开始运行）
          updatePauseButtonState(false)
        }
        
        // 任务结束状态处理
        if (['completed', 'failed'].includes(data.status)) {
          stopProgressPolling()
          elements.startProcessingBtn.disabled = false
          updatePauseButtonState(false)
          if (data.status === 'completed') {
            showToast('处理完成！', 'success')
          } else if (data.status === 'failed') {
            showToast('处理失败', 'error')
          }
          // 3秒后重置进度显示
          setTimeout(() => {
            elements.processingProgressBar.style.width = '0%'
            elements.processingProgressText.textContent = '0%'
            elements.processingProgressCount.textContent = '0/0'
            elements.processingElapsedTime.textContent = '00:00:00'
            elements.processingRemainingTime.textContent = '--:--:--'
            elements.processingCurrentStatus.textContent = '准备中'
          }, 3000)
        } else if (data.status === 'paused') {
          // 任务已暂停，停止轮询但保持显示
          stopProgressPolling()
          elements.startProcessingBtn.disabled = false
          updatePauseButtonState(true)
          showToast('处理已暂停，可点击继续处理', 'info')
          // 注意：不重置进度显示，保持当前状态
        }
      }
    } catch (error) {
      console.error('进度查询失败:', error)
    }
  }, 5000)
}

async function startProcessing() {
  const serverIp = elements.prefabServerIp?.value
  const serverPort = elements.prefabServerPort?.value
  const savedBook = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_BOOK)
  const savedChaptersStr = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTERS)
  const savedChapterStr = localStorage.getItem(STORAGE_KEYS.PREFAB_SELECTED_CHAPTER)

  // 解析章节信息（优先使用多选列表）
  let chaptersInfo = []
  try {
    const parsed = JSON.parse(savedChaptersStr)
    if (Array.isArray(parsed) && parsed.length > 0) {
      chaptersInfo = parsed
    }
  } catch (e) {
    // 忽略解析错误
  }

  // 如果没有多选列表，尝试使用单选
  if (chaptersInfo.length === 0 && savedChapterStr) {
    try {
      const singleChapter = JSON.parse(savedChapterStr)
      if (singleChapter) {
        chaptersInfo = [singleChapter]
      }
    } catch (e) {
      // 兼容旧格式
      chaptersInfo = [{
        chapterId: parseInt(savedChapterStr),
        chapterIndex: parseInt(savedChapterStr),
        chapterTitle: '',
        chapterUrl: ''
      }]
    }
  }

  // 详细的配置检查日志
  console.log('[startProcessing] 配置检查:', {
    serverIp: serverIp,
    serverPort: serverPort,
    savedBook: !!savedBook,
    savedChaptersStr: savedChaptersStr,
    savedChapterStr: savedChapterStr,
    chaptersCount: chaptersInfo.length,
    chaptersInfo: chaptersInfo,
    prefabSelectedVoice: !!prefabSelectedVoice
  })

  // 基本检查：书籍、章节、发音人必须存在
  if (!savedBook || chaptersInfo.length === 0 || !prefabSelectedVoice) {
    const missing = []
    if (!savedBook) missing.push('选择的书籍')
    if (chaptersInfo.length === 0) missing.push('选择的章节')
    if (!prefabSelectedVoice) missing.push('发音人')
    showToast(`请完成以下配置: ${missing.join(', ')}`, 'error')
    return
  }

  const book = JSON.parse(savedBook)
  const isTxtBook = book.bookUrl?.startsWith('txt://')

  // 如果不是TXT书籍，检查Web连接
  if (!isTxtBook) {
    const hasWebConnection = !!(serverIp && serverPort)
    if (!hasWebConnection) {
      const cacheStatus = getBookCacheStatus(book.bookUrl)
      if (cacheStatus?.status !== 'cached') {
        showToast('未连接Web且没有本地缓存，请先连接Web或缓存书籍', 'error')
        return
      }
      console.log('[startProcessing] 无Web连接，将使用本地缓存')
    }
  }

  const options = {
    voiceId: prefabSelectedVoice,
    serverIp: serverIp || '',
    serverPort: serverPort || '',
    requestDelay: parseInt(localStorage.getItem(STORAGE_KEYS.PREFAB_DELAY) || '40'),
    speed: parseInt(localStorage.getItem(STORAGE_KEYS.PREFAB_SPEED) || '0'),
    concurrentRate: 1,
    contentType: 'audio/mpeg',
    enableCookie: true
  }

  // 重置进度显示
  elements.processingProgressBar.style.width = '0%'
  elements.processingProgressText.textContent = '0%'
  elements.processingProgressCount.textContent = '0/0'
  elements.processingElapsedTime.textContent = '00:00:00'
  elements.processingRemainingTime.textContent = '--:--:--'
  elements.processingCurrentStatus.textContent = '准备中'
  elements.startProcessingBtn.disabled = true

  // 重置暂停按钮状态为初始状态（未暂停）
  updatePauseButtonState(false)

  try {
    // 如果是TXT书籍，使用TXT预制API
    if (isTxtBook) {
      const txtBookId = book.bookUrl.replace('txt://', '')
      const chapterIndices = chaptersInfo.map(c => c.chapterIndex).sort((a, b) => a - b)

      console.log('[startProcessing] TXT书籍，使用TXT预制API', { txtBookId, chapterCount: chapterIndices.length })

      const response = await fetch('/api/legado/txt-prefab/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: txtBookId,
          chapterIndices,
          options: {
            voiceId: prefabSelectedVoice,
            speed: options.speed,
            delay: options.requestDelay
          }
        })
      })

      const result = await response.json()
      if (!result.success) throw new Error(result.message)

      currentTaskId = result.data.taskId
      startProgressPolling(currentTaskId, txtBookId, null)
      showToast(`TXT预制任务已启动，共 ${chapterIndices.length} 个章节`, 'success')
      return
    }

    // Web书籍：使用原有的批量处理API
    // 如果没有连接Web，强制使用本地缓存
    const useCacheOnly = !isWebConnected
    if (useCacheOnly) {
      console.log('[startProcessing] 未连接Web，强制使用本地缓存模式')
    }
    
    const hasWebConnection = !!(serverIp && serverPort)

    // 使用批量处理API
    const bookId = getBookIdFromStorage(book)

    // 获取章节范围，使用新的轻量级传输模式
    const chapterIndices = chaptersInfo.map(c => c.chapterIndex).sort((a, b) => a - b)
    const startIndex = chapterIndices[0]
    const endIndex = chapterIndices[chapterIndices.length - 1]

    console.log('[startProcessing] 使用章节范围模式', { startIndex, endIndex, totalChapters: chaptersInfo.length })
    console.log('[startProcessing] 发送的 bookInfo:', { bookId, bookName: book.name, bookUrl: book.bookUrl, serverIp, serverPort })

    const response = await fetch('/api/legado/prefetch/batch-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookInfo: {
          bookId: bookId,
          bookName: book.name,
          bookUrl: book.bookUrl,
          serverIp: serverIp || '',
          serverPort: serverPort || ''
        },
        chapterRange: { startIndex, endIndex },
        options: {
          ...options,
          useCacheOnly
        }
      })
    })
    const result = await response.json()
    if (!result.success) throw new Error(result.message)
    currentTaskId = result.data.taskId
    // 使用相同的 bookId 用于状态轮询
    startProgressPolling(currentTaskId, bookId, null)
    showToast(`批量任务已启动，共 ${result.data.progress.total} 个章节`, 'success')
  } catch (error) {
    console.error('启动处理失败:', error)
    showToast(`启动失败：${error.message}`, 'error')
    elements.startProcessingBtn.disabled = false
  }
}

/**
 * 开始进度轮询
 * @param {string} taskId - 任务ID
 * @param {string} bookId - 书籍ID
 * @param {string} chapterId - 章节ID（可选，批量任务时为null）
 */
function startProgressPolling(taskId, bookId, chapterId) {
  // 使用当前时间作为开始时间，调用统一的轮询函数
  startProgressPollingWithStartTime(taskId, bookId, chapterId, Date.now())
}

function stopProgressPolling() {
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
}

/**
 * 获取状态文本
 * @param {string} status - 状态码
 * @returns {string} 状态文本
 */
function getStatusText(status) {
  const statusMap = { 
    pending: '等待中', 
    processing: '处理中',
    completed: '已完成',
    failed: '失败',
    paused: '已暂停'
  }
  return statusMap[status] || status
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 处理暂停/继续按钮点击事件
 * 根据当前按钮状态决定是暂停还是继续
 */
async function togglePauseResume() {
  if (!currentTaskId) return
  
  const btn = elements.pauseProcessingBtn
  const isPaused = btn.dataset.paused === 'true'
  
  if (isPaused) {
    // 当前是暂停状态，执行恢复
    await resumeProcessing()
  } else {
    // 当前是运行状态，执行暂停
    await pauseProcessing()
  }
}

/**
 * 暂停处理
 */
async function pauseProcessing() {
  if (!currentTaskId) return

  // 立即更新按钮状态，提供即时反馈
  updatePauseButtonState(true)

  try {
    const response = await fetch(`/api/legado/prefetch/pause/${currentTaskId}`, { method: 'POST' })
    const result = await response.json()
    if (result.success) {
      showToast('处理已暂停', 'info')
    } else {
      // 如果失败，恢复按钮状态
      updatePauseButtonState(false)
      showToast(`暂停失败：${result.message}`, 'error')
    }
  } catch (error) {
    // 如果失败，恢复按钮状态
    updatePauseButtonState(false)
    console.error('暂停处理失败:', error)
    showToast('暂停处理失败', 'error')
  }
}

/**
 * 恢复处理
 */
async function resumeProcessing() {
  if (!currentTaskId) return

  // 立即更新按钮状态，提供即时反馈
  updatePauseButtonState(false)

  try {
    const response = await fetch(`/api/legado/prefetch/resume/${currentTaskId}`, { method: 'POST' })
    const result = await response.json()
    if (result.success) {
      showToast('处理已恢复', 'info')
    } else {
      // 如果失败，恢复按钮状态
      updatePauseButtonState(true)
      showToast(`恢复失败：${result.message}`, 'error')
    }
  } catch (error) {
    // 如果失败，恢复按钮状态
    updatePauseButtonState(true)
    console.error('恢复处理失败:', error)
    showToast('恢复处理失败', 'error')
  }
}

/**
 * 更新暂停/继续按钮状态
 * @param {boolean} isPaused - 是否已暂停
 */
function updatePauseButtonState(isPaused) {
  const btn = elements.pauseProcessingBtn
  if (!btn) {
    console.warn('暂停按钮元素不存在')
    return
  }
  // 使用 querySelector 获取图标和文本节点，避免替换整个 innerHTML 导致事件监听器丢失
  const icon = btn.querySelector('i')
  if (isPaused) {
    if (icon) icon.className = 'fas fa-play'
    // 只更新文本节点，保留图标
    const textNode = btn.childNodes[btn.childNodes.length - 1]
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = ' 继续'
    } else {
      btn.appendChild(document.createTextNode(' 继续'))
    }
    btn.dataset.paused = 'true'
  } else {
    if (icon) icon.className = 'fas fa-pause'
    const textNode = btn.childNodes[btn.childNodes.length - 1]
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = ' 暂停'
    } else {
      btn.appendChild(document.createTextNode(' 暂停'))
    }
    btn.dataset.paused = 'false'
  }
}

/**
 * 取消处理
 * 优化取消操作的响应速度和用户反馈
 */
async function cancelProcessing() {
  if (!currentTaskId) {
    return
  }

  // 防止重复点击
  if (elements.cancelProcessingBtn.disabled) {
    return
  }

  const taskIdToCancel = currentTaskId

  // 立即给用户反馈：禁用按钮并显示状态
  elements.cancelProcessingBtn.disabled = true
  elements.cancelProcessingBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 取消中...'
  elements.processingCurrentStatus.textContent = '正在取消，请稍候...'
  elements.processingCurrentStatus.style.color = '#f59e0b'
  showToast('正在发送取消请求，请稍候...', 'info')

  try {
    // 使用 AbortController 设置超时
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30秒超时

    const response = await fetch(`/api/legado/prefetch/cancel/${taskIdToCancel}`, {
      method: 'POST',
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    const result = await response.json()

    if (result.success) {
      if (result.data?.alreadyFinished) {
        showToast(`任务已经${result.data.status === 'completed' ? '完成' : result.data.status === 'failed' ? '失败' : '部分完成'}`, 'info')
      } else {
        showToast('取消请求已发送，正在停止处理...', 'success')
        // 显示一个更明显的提示，告知用户可能需要等待当前任务完成
        elements.processingCurrentStatus.textContent = '取消请求已发送，等待当前处理完成...'
      }
    } else {
      showToast(`停止失败：${result.message}`, 'error')
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      showToast('取消请求超时，但已发送停止指令', 'warning')
    } else {
      console.error('停止处理失败:', error)
      showToast('停止请求失败，已清理本地状态', 'warning')
    }
  } finally {
    // 延迟清理前端状态，让用户看到取消过程
    setTimeout(() => {
      // 确保清理前端状态
      stopProgressPolling()
      elements.startProcessingBtn.disabled = false
      updatePauseButtonState(false)
      // 重置进度显示
      elements.processingProgressBar.style.width = '0%'
      elements.processingProgressText.textContent = '0%'
      elements.processingProgressCount.textContent = '0/0'
      elements.processingElapsedTime.textContent = '00:00:00'
      elements.processingRemainingTime.textContent = '--:--:--'
      elements.processingCurrentStatus.textContent = '准备中'
      elements.processingCurrentStatus.style.color = ''
      // 只有当 currentTaskId 还是之前那个任务时才清空
      if (currentTaskId === taskIdToCancel) {
        currentTaskId = null
      }
      // 恢复取消按钮状态
      elements.cancelProcessingBtn.disabled = false
      elements.cancelProcessingBtn.innerHTML = '<i class="fas fa-stop"></i> 取消'
    }, 1500) // 延迟1.5秒，让用户看到取消反馈
  }
}

/**
 * 获取发音人显示名称
 * @param {string} voiceId - 发音人ID
 * @returns {string} 显示名称
 */
function getVoiceDisplayName(voiceId) {
  if (!voiceId) return '未选择'

  // 从voiceSelect中查找对应的选项文本
  const voiceSelect = elements.prefabVoiceSelect
  if (voiceSelect) {
    const option = voiceSelect.querySelector(`option[value="${voiceId}"]`)
    if (option) return option.textContent
  }

  return voiceId
}

// 任务管理器相关
const TASK_STATUS = { PENDING: 'pending', PROCESSING: 'processing', PAUSED: 'paused', COMPLETED: 'completed', FAILED: 'failed' }

class TaskManager {
  constructor() {
    this.tasks = new Map()
    this.loadTasks()
  }
  createTask(taskData) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const task = {
      id: taskId, bookName: taskData.bookName, bookUrl: taskData.bookUrl,
      chapterIndex: taskData.chapterIndex, chapterName: taskData.chapterName,
      status: TASK_STATUS.PENDING, progress: 0, totalSegments: 0, processedSegments: 0,
      startTime: Date.now(), estimatedTime: 0, error: null
    }
    this.tasks.set(taskId, task)
    this.saveTasks()
    return taskId
  }
  updateTaskStatus(taskId, status) {
    const task = this.tasks.get(taskId)
    if (task) { task.status = status; this.saveTasks() }
  }
  updateTaskProgress(taskId, progressData) {
    const task = this.tasks.get(taskId)
    if (task) {
      task.processedSegments = progressData.completed || 0
      task.totalSegments = progressData.total || 0
      task.progress = task.totalSegments > 0 ? Math.round((task.processedSegments / task.totalSegments) * 100) : 0
      if (task.processedSegments > 0 && task.processedSegments < task.totalSegments) {
        const elapsed = (Date.now() - task.startTime) / 1000
        task.estimatedTime = Math.round((elapsed / task.processedSegments) * (task.totalSegments - task.processedSegments))
      }
      this.saveTasks()
    }
  }
  setTaskError(taskId, error) {
    const task = this.tasks.get(taskId)
    if (task) { task.error = error; task.status = TASK_STATUS.FAILED; this.saveTasks() }
  }
  deleteTask(taskId) {
    if (this.tasks.has(taskId)) { this.tasks.delete(taskId); this.saveTasks(); return true }
    return false
  }
  getTask(taskId) { return this.tasks.get(taskId) || null }
  getAllTasks() { return Array.from(this.tasks.values()) }
  getTasksByStatus(status) { return this.getAllTasks().filter(task => task.status === status) }
  clearCompletedTasks() {
    const completed = this.getTasksByStatus(TASK_STATUS.COMPLETED)
    completed.forEach(task => this.tasks.delete(task.id))
    this.saveTasks()
    return completed.length
  }
  saveTasks() {
    try { localStorage.setItem('legado_tts_tasks', JSON.stringify(Array.from(this.tasks.entries()))) }
    catch (error) { console.error('保存任务失败:', error) }
  }
  loadTasks() {
    try {
      const data = localStorage.getItem('legado_tts_tasks')
      if (data) this.tasks = new Map(JSON.parse(data))
    } catch (error) { console.error('加载任务失败:', error) }
  }
}

let taskManager = null
function initTaskManager() {
  taskManager = new TaskManager()
}

// ==================== TXT文件预制书功能 ====================

// TXT预制书状态
let txtPrefabState = {
  currentBook: null,
  selectedChapters: new Set(),
  currentSource: 'web' // 'web' 或 'txt'
}

// 初始化预制书模式切换
function initPrefabSourceTabs() {
  const webContent = document.getElementById('prefabWebContent')
  const txtContent = document.getElementById('prefabTxtContent')

  // 获取所有选项卡按钮（包括两个卡片中的）
  const allTabs = document.querySelectorAll('.prefab-source-tab-inline')

  allTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const source = tab.dataset.source
      txtPrefabState.currentSource = source

      // 更新所有选项卡状态（包括两个卡片中的按钮）
      allTabs.forEach(t => {
        t.classList.remove('active')
        if (t.dataset.source === source) {
          t.classList.add('active')
        }
      })

      // 切换内容显示
      if (source === 'web') {
        webContent.style.display = 'block'
        txtContent.style.display = 'none'
      } else {
        webContent.style.display = 'none'
        txtContent.style.display = 'block'
      }

      // 更新验证状态
      updatePrefabValidationStatus()
    })
  })

  // 初始化书籍库滚轮横向滚动
  initBookshelfWheelScroll()
}

// 书籍库滚轮横向滚动
function initBookshelfWheelScroll() {
  const bookshelfGrid = document.getElementById('bookshelfGrid')
  if (!bookshelfGrid) return

  bookshelfGrid.addEventListener('wheel', (e) => {
    // 只有当内容可以横向滚动时才拦截滚轮事件
    const canScrollLeft = bookshelfGrid.scrollLeft > 0
    const canScrollRight = bookshelfGrid.scrollLeft < (bookshelfGrid.scrollWidth - bookshelfGrid.clientWidth)

    // 如果滚轮是横向的（deltaX不为0），不处理
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return

    // 如果内容无法横向滚动，不拦截
    if (!canScrollLeft && !canScrollRight) return

    // 向上滚动且已经在最左边，不拦截
    if (e.deltaY < 0 && !canScrollLeft) return

    // 向下滚动且已经在最右边，不拦截
    if (e.deltaY > 0 && !canScrollRight) return

    e.preventDefault()
    bookshelfGrid.scrollLeft += e.deltaY
  }, { passive: false })
}

// 初始化TXT文件上传
function initTxtUpload() {
  const uploadArea = document.getElementById('txtUploadArea')
  const fileInput = document.getElementById('txtFileInput')
  const fileInfo = document.getElementById('txtFileInfo')
  const fileRemove = document.getElementById('txtFileRemove')

  if (!uploadArea || !fileInput) return

  // 点击上传
  uploadArea.addEventListener('click', () => fileInput.click())

  // 文件选择
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (file) await handleTxtUpload(file)
  })

  // 拖拽上传
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault()
    uploadArea.classList.add('dragover')
  })

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover')
  })

  uploadArea.addEventListener('drop', async (e) => {
    e.preventDefault()
    uploadArea.classList.remove('dragover')
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.txt')) {
      await handleTxtUpload(file)
    } else {
      showToast('请上传.txt格式的文件', 'error')
    }
  })

  // 移除文件
  if (fileRemove) {
    fileRemove.addEventListener('click', (e) => {
      e.stopPropagation()
      clearTxtUpload()
    })
  }
}

// 处理TXT文件上传
async function handleTxtUpload(file) {
  const uploadArea = document.getElementById('txtUploadArea')
  const fileInfo = document.getElementById('txtFileInfo')
  const fileName = document.getElementById('txtFileName')
  const fileSize = document.getElementById('txtFileSize')
  const chapterCount = document.getElementById('txtChapterCount')

  try {
    showToast('正在解析文件...', 'info')

    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/legado/txt-prefab/upload', {
      method: 'POST',
      body: formData
    })

    const result = await response.json()

    if (!result.success) {
      throw new Error(result.message || '解析失败')
    }

    const data = result.data

    // 保存当前书籍信息
    txtPrefabState.currentBook = data
    txtPrefabState.selectedChapters.clear()

    // 更新UI - 显示文件信息
    if (uploadArea) uploadArea.style.display = 'none'
    if (fileInfo) fileInfo.style.display = 'block'

    if (fileName) fileName.textContent = data.bookName
    if (fileSize) fileSize.textContent = formatFileSize(data.fileSize)
    if (chapterCount) chapterCount.textContent = `${data.totalChapters} 章`

    // 将TXT书籍添加到统一的书籍库
    const txtBook = {
      bookUrl: `txt://${data.bookId}`,
      name: data.bookName,
      totalChapters: data.totalChapters,
      chapterCount: data.totalChapters,
      cachedChapters: data.totalChapters, // TXT书籍默认已缓存所有章节
      coverUrl: '', // TXT书籍没有封面
      source: 'txt' // 标记来源为TXT
    }

    // 保存到localStorage（作为缓存书籍）
    const cachedBooks = JSON.parse(localStorage.getItem(STORAGE_KEYS.CACHED_BOOKS) || '[]')
    // 检查是否已存在
    const existingIndex = cachedBooks.findIndex(b => b.bookUrl === txtBook.bookUrl)
    if (existingIndex >= 0) {
      cachedBooks[existingIndex] = txtBook
    } else {
      cachedBooks.push(txtBook)
    }
    localStorage.setItem(STORAGE_KEYS.CACHED_BOOKS, JSON.stringify(cachedBooks))

    // 刷新书籍库显示
    await loadCachedBooks()

    showToast(`成功解析《${data.bookName}》`, 'success')
    updatePrefabValidationStatus()

  } catch (error) {
    console.error('上传TXT文件失败:', error)
    showToast(`上传失败: ${error.message}`, 'error')
  }
}

// 清除TXT上传
function clearTxtUpload() {
  const uploadArea = document.getElementById('txtUploadArea')
  const fileInfo = document.getElementById('txtFileInfo')
  const fileInput = document.getElementById('txtFileInput')

  txtPrefabState.currentBook = null
  txtPrefabState.selectedChapters.clear()

  if (uploadArea) uploadArea.style.display = 'block'
  if (fileInfo) fileInfo.style.display = 'none'
  if (fileInput) fileInput.value = ''

  updatePrefabValidationStatus()
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ==================== 定时预制功能（已迁移到设置页面） ====================

/**
 * 加载定时任务状态并更新入口显示
 */
async function initScheduledPrefetch() {
  console.log('[initScheduledPrefetch] 初始化定时预制入口')

  try {
    const response = await fetch('/api/legado/scheduled-prefetch/list')
    const result = await response.json()

    if (result.success && result.data && result.data.length > 0) {
      const task = result.data[0]
      updateScheduledPrefetchStatus(task)
    } else {
      updateScheduledPrefetchStatus(null)
    }
  } catch (error) {
    console.error('[initScheduledPrefetch] 获取定时任务失败:', error)
    updateScheduledPrefetchStatus(null)
  }
}

/**
 * 更新定时预制入口状态显示
 */
function updateScheduledPrefetchStatus(task) {
  const statusEl = document.getElementById('scheduledPrefetchStatus')
  if (!statusEl) return

  if (task && task.enabled) {
    statusEl.textContent = '运行中'
    statusEl.style.color = 'var(--success-color)'
  } else if (task) {
    statusEl.textContent = '已暂停'
    statusEl.style.color = 'var(--warning-color)'
  } else {
    statusEl.textContent = '前往设置管理'
    statusEl.style.color = 'var(--text-secondary)'
  }
}

/**
 * 绑定定时预制面板事件
 * 注：定时预制功能已迁移到设置页面，此函数保留用于兼容性
 */
function bindScheduledPrefetchEvents() {
  // 定时预制功能已迁移到设置页面，此函数为空实现
  console.log('[bindScheduledPrefetchEvents] 定时预制功能已迁移到设置页面')
}

// ==================== 定时预制功能结束 ====================
