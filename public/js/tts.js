/**
 * TTS页面JavaScript模块
 * 模块化设计，处理所有UI交互和API调用
 */

// ==================== Toast通知管理器 ====================
const ToastManager = {
  container: null,

  init() {
    this.container = document.getElementById('toastContainer');
  },

  show(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 
                 type === 'error' ? 'fa-exclamation-circle' : 
                 'fa-info-circle';
    
    toast.innerHTML = `
      <i class="fas ${icon}"></i>
      <span class="toast-message">${message}</span>
    `;
    
    this.container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease-out reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

// ==================== 侧边栏管理器 ====================
const SidebarManager = {
  sidebar: null,
  overlay: null,
  menuBtn: null,
  storageKey: 'tts_sidebar_state',

  init() {
    this.sidebar = document.getElementById('ttsSidebar');
    this.overlay = document.getElementById('sidebarOverlay');
    this.menuBtn = document.getElementById('mobileMenuBtn');
    this.bindEvents();
    this.restoreState();
  },

  bindEvents() {
    // 移动端菜单按钮
    if (this.menuBtn) {
      this.menuBtn.addEventListener('click', () => this.toggle());
    }

    // 遮罩点击关闭
    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.close());
    }

    // ESC键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });

    // 折叠功能
    document.querySelectorAll('.sidebar-section-header.collapsible').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.dataset.section;
        this.toggleSection(section);
      });
    });
  },

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    this.sidebar?.classList.add('active');
    this.overlay?.classList.add('active');
    document.body.style.overflow = 'hidden';
  },

  close() {
    this.sidebar?.classList.remove('active');
    this.overlay?.classList.remove('active');
    document.body.style.overflow = '';
  },

  isOpen() {
    return this.sidebar?.classList.contains('active');
  },

  toggleSection(section) {
    const header = document.querySelector(`[data-section="${section}"]`);
    const body = document.querySelector(`[data-section-body="${section}"]`);
    
    if (!header || !body) return;

    const isCollapsed = body.classList.contains('collapsed');
    
    if (isCollapsed) {
      body.classList.remove('collapsed');
      header.classList.remove('collapsed');
    } else {
      body.classList.add('collapsed');
      header.classList.add('collapsed');
    }

    this.saveState(section, !isCollapsed);
  },

  saveState(section, collapsed) {
    try {
      const state = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
      state[section] = collapsed;
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (error) {
      console.error('保存折叠状态失败:', e);
    }
  },

  restoreState() {
    try {
      const state = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
      Object.keys(state).forEach(section => {
        if (state[section]) {
          const header = document.querySelector(`[data-section="${section}"]`);
          const body = document.querySelector(`[data-section-body="${section}"]`);
          if (header && body) {
            body.classList.add('collapsed');
            header.classList.add('collapsed');
          }
        }
      });
    } catch (e) {
      console.error('恢复折叠状态失败:', e);
    }
  }
};

// ==================== 发音人管理器 ====================
const VoiceManager = {
  voices: [],
  selectedVoice: null,
  
  async init() {
    await this.loadVoices();
    this.bindEvents();
  },

  async loadVoices() {
    const voiceList = document.getElementById('voiceList');
    try {
      const response = await fetch('/api/voices');
      const data = await response.json();
      
      if (data.code === 0) {
        this.voices = data.data || [];
        this.renderVoices(this.voices);
        // 设置默认发音人为"温柔桃子（升级版）"
        this.selectVoice('zh_female_wenroutaozi_uranus_bigtts');
      } else {
        throw new Error(data.msg || '加载失败');
      }
    } catch (error) {
      console.error('加载发音人失败:', error);
      voiceList.innerHTML = `
        <div class="voice-empty">
          <i class="fas fa-exclamation-triangle"></i>
          <p>加载发音人失败...</p>
        </div>
      `;
      ToastManager.show('加载发音人失败...', 'error');
    }
  },

  renderVoices(voices) {
    const voiceList = document.getElementById('voiceList');
    
    if (voices.length === 0) {
      voiceList.innerHTML = `
        <div class="voice-empty">
          <i class="fas fa-inbox"></i>
          <p>未找到匹配的发音人...</p>
        </div>
      `;
      return;
    }

    voiceList.innerHTML = voices.map(voice => `
      <div class="voice-item" data-voice-id="${voice.style_id}" role="option" aria-selected="false">
        <div class="voice-avatar">${voice.name.charAt(0)}</div>
        <div class="voice-info">
          <div class="voice-name">${voice.name}</div>
          <div class="voice-meta">${voice.style_id}</div>
        </div>
      </div>
    `).join('');

    // 绑定点击事件
    voiceList.querySelectorAll('.voice-item').forEach(item => {
      item.addEventListener('click', () => {
        const voiceId = item.dataset.voiceId;
        this.selectVoice(voiceId);
      });
    });
  },

  selectVoice(voiceId) {
    this.selectedVoice = voiceId;
    
    // 更新UI选中状态
    document.querySelectorAll('.voice-item').forEach(item => {
      const isSelected = item.dataset.voiceId === voiceId;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', isSelected);
    });
  },

  async searchVoices(query, language, gender) {
    try {
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (language) params.append('language', language);
      if (gender) params.append('gender', gender);

      const response = await fetch(`/api/voices/search?${params}`);
      const data = await response.json();
      
      if (data.code === 0) {
        this.renderVoices(data.data || []);
      }
    } catch (error) {
      console.error('搜索发音人失败:', error);
    }
  },

  bindEvents() {
    const searchInput = document.getElementById('voiceSearch');
    const languageFilter = document.getElementById('languageFilter');
    const genderFilter = document.getElementById('genderFilter');

    // 搜索防抖
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.searchVoices(
          e.target.value,
          languageFilter.value,
          genderFilter.value
        );
      }, 300);
    });

    // 筛选器
    languageFilter.addEventListener('change', () => {
      this.searchVoices(
        searchInput.value,
        languageFilter.value,
        genderFilter.value
      );
    });

    genderFilter.addEventListener('change', () => {
      this.searchVoices(
        searchInput.value,
        languageFilter.value,
        genderFilter.value
      );
    });
  }
};

// ==================== 参数控制器 ====================
const ParamController = {
  init() {
    this.bindSliders();
  },

  bindSliders() {
    const sliders = [
      { id: 'rateSlider', valueId: 'rateValue' },
      { id: 'pitchSlider', valueId: 'pitchValue' }
    ];

    sliders.forEach(({ id, valueId }) => {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(valueId);
      
      slider.addEventListener('input', (e) => {
        valueDisplay.textContent = e.target.value;
        slider.setAttribute('aria-valuenow', e.target.value);
      });
    });
  },

  getParams() {
    return {
      rate: parseInt(document.getElementById('rateSlider').value),
      pitch: parseInt(document.getElementById('pitchSlider').value)
    };
  }
};

// ==================== 音频播放器 ====================
const AudioPlayer = {
  currentUrl: null,

  init() {
    // 初始化播放器
  },

  load(url) {
    this.currentUrl = url;
    const playerContainer = document.getElementById('audioPlayer');
    
    playerContainer.innerHTML = `
      <div class="audio-controls">
        <audio controls autoplay aria-label="生成的音频">
          <source src="${url}" type="audio/mpeg">
          您的浏览器不支持音频播放...
        </audio>
        <div class="audio-actions">
          <a href="${url}" download class="btn btn-primary btn-sm">
            <i class="fas fa-download"></i>
            下载音频
          </a>
        </div>
      </div>
    `;
  },

  clear() {
    this.currentUrl = null;
    const playerContainer = document.getElementById('audioPlayer');
    playerContainer.innerHTML = `
      <div class="audio-placeholder">
        <i class="fas fa-headphones"></i>
        <p>暂无音频</p>
      </div>
    `;
  }
};

// ==================== 历史记录管理器 ====================
const HistoryManager = {
  storageKey: 'tts_history',
  maxItems: 50,

  init() {
    this.render();
    this.bindEvents();
  },

  getHistory() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
    } catch {
      return [];
    }
  },

  addItem(item) {
    const history = this.getHistory();
    history.unshift({
      ...item,
      timestamp: Date.now(),
      id: Date.now()
    });
    
    if (history.length > this.maxItems) {
      history.splice(this.maxItems);
    }
    
    localStorage.setItem(this.storageKey, JSON.stringify(history));
    this.render();
  },

  async removeItem(id) {
    const history = this.getHistory();
    const item = history.find(h => h.id === id);
    
    // 删除音频文件
    if (item?.url) {
      try {
        const filename = item.url.split('/').pop();
        await fetch(`/api/audio/${filename}`, { method: 'DELETE' });
      } catch (error) {
      console.error('删除音频文件失败:', error);
    }
    }
    
    // 删除历史记录
    const newHistory = history.filter(h => h.id !== id);
    localStorage.setItem(this.storageKey, JSON.stringify(newHistory));
    this.render();
    ToastManager.show('已删除历史记录', 'success');
  },

  clear() {
    localStorage.removeItem(this.storageKey);
    this.render();
    ToastManager.show('历史记录已清空', 'success');
  },

  useItem(item) {
    // 回填文本
    const textInput = document.getElementById('textInput');
    textInput.value = item.text;
    document.getElementById('textCount').textContent = `${item.text.length} / 5000`;
    
    // 选择发音人
    VoiceManager.selectVoice(item.voiceId);
    
    // 滚动到选中的发音人
    const selectedVoice = document.querySelector('.voice-item.selected');
    if (selectedVoice) {
      selectedVoice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    // 恢复参数
    if (item.params) {
      document.getElementById('rateSlider').value = item.params.rate || 0;
      document.getElementById('rateValue').textContent = item.params.rate || 0;
      document.getElementById('pitchSlider').value = item.params.pitch || 0;
      document.getElementById('pitchValue').textContent = item.params.pitch || 0;
    }
    
    // 关闭移动端侧边栏
    if (window.innerWidth < 768) {
      SidebarManager.close();
    }
    
    // 平滑滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // 高亮效果
    textInput.classList.add('highlight');
    setTimeout(() => textInput.classList.remove('highlight'), 2000);
    
    ToastManager.show('已恢复历史记录参数', 'success');
  },

  render() {
    const history = this.getHistory();
    const historyList = document.getElementById('historyList');
    const historyCount = document.getElementById('historyCount');
    
    historyCount.textContent = history.length;

    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <i class="fas fa-inbox"></i>
          <p>暂无历史记录</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = history.map(item => `
      <div class="history-item" data-id="${item.id}" role="listitem">
        <div class="history-item-header">
          <span class="history-voice">${item.voiceName || '未知发音人'}</span>
          <span class="history-time">${this.formatTime(item.timestamp)}</span>
        </div>
        <div class="history-text">${item.text}</div>
        <div class="history-actions">
          <button class="btn btn-primary btn-sm play-btn" data-url="${item.url}" title="播放" aria-label="播放音频">
            <i class="fas fa-play"></i>
          </button>
          <button class="btn btn-sm use-btn" data-id="${item.id}" title="使用" aria-label="使用此记录">
            <i class="fas fa-redo"></i>
          </button>
          <button class="btn btn-sm delete-btn" data-id="${item.id}" title="删除" aria-label="删除此记录">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');

    // 绑定事件
    historyList.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        AudioPlayer.load(btn.dataset.url);
      });
    });

    historyList.querySelectorAll('.use-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const item = history.find(h => h.id === id);
        if (item) this.useItem(item);
      });
    });

    historyList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.removeItem(parseInt(btn.dataset.id));
      });
    });
  },

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  bindEvents() {
    document.getElementById('clearHistory').addEventListener('click', () => {
      if (confirm('确定要清空所有历史记录吗？')) {
        this.clear();
      }
    });
  }
};

// ==================== TTS生成器 ====================
const TTSGenerator = {
  isGenerating: false,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const generateBtn = document.getElementById('generateBtn');
    const textInput = document.getElementById('textInput');
    const textCount = document.getElementById('textCount');

    // 文本计数
    textInput.addEventListener('input', () => {
      const length = textInput.value.length;
      textCount.textContent = `${length} / 5000`;
    });

    // 生成按钮
    generateBtn.addEventListener('click', () => {
      this.generate();
    });

    // Ctrl+Enter快捷键
    textInput.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        this.generate();
      }
    });
  },

  async generate() {
    if (this.isGenerating) return;

    const text = document.getElementById('textInput').value.trim();
    const voiceId = VoiceManager.selectedVoice;
    const params = ParamController.getParams();
    const generateBtn = document.getElementById('generateBtn');

    // 验证
    if (!text) {
      ToastManager.show('请输入要转换的文本', 'error');
      return;
    }

    if (!voiceId) {
      ToastManager.show('请选择发音人', 'error');
      return;
    }

    // 更新按钮状态
    this.isGenerating = true;
    generateBtn.disabled = true;
    generateBtn.setAttribute('aria-busy', 'true');
    generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>生成中...</span>';

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          speaker: voiceId,
          rate: params.rate,
          pitch: params.pitch
        })
      });

      const data = await response.json();

      if (data.code === 0) {
        const url = data.data?.url || this.extractUrl(data.data?.filePath);
        
        // 加载音频
        AudioPlayer.load(url);
        
        // 添加到历史记录
        const voiceName = VoiceManager.voices.find(v => v.style_id === voiceId)?.name || voiceId;
        HistoryManager.addItem({
          text,
          voiceId,
          voiceName,
          url,
          params
        });

        ToastManager.show('语音生成成功', 'success');
      } else {
        throw new Error(data.msg || '生成失败');
      }
    } catch (error) {
      console.error('生成失败:', error);
      ToastManager.show('生成失败: "' + error.message + '"', 'error');
    } finally {
      this.isGenerating = false;
      generateBtn.disabled = false;
      generateBtn.setAttribute('aria-busy', 'false');
      generateBtn.innerHTML = '<i class="fas fa-play"></i><span>生成语音</span>';
    }
  },

  extractUrl(filePath) {
    if (!filePath) return '';
    const rel = filePath.replace(/^.*\\audio\\/, '/audio/');
    return location.origin + rel.replace(/\\/g, '/');
  }
};

// ==================== 应用初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化所有模块
  ToastManager.init();
  SidebarManager.init();
  await VoiceManager.init();
  ParamController.init();
  AudioPlayer.init();
  HistoryManager.init();
  TTSGenerator.init();

  console.log('TTS页面初始化完成');
});