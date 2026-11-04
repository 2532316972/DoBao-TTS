/**
 * Cookie状态管理模块
 * 负责Cookie相关的状态管理和状态变更通知
 */

/**
 * Cookie状态管理器类
 * 实现发布-订阅模式，用于管理Cookie页面状态
 */
export class CookieStateManager {
  constructor() {
    this.state = {
      cookies: [],
      filteredCookies: [],
      currentSort: 'name',
      sortOrder: 'asc',
      searchQuery: '',
      viewMode: 'list',
      editingCookie: null,
      isLoading: false,
      selectedCookies: new Set(),
      selectionMode: 0
    };

    this.listeners = [];
  }

  /**
   * 获取当前状态
   * @returns {Object} 当前状态对象的副本
   */
  getState() {
    return { ...this.state };
  }

  /**
   * 设置状态
   * @param {Object} newState - 新的状态对象
   */
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.notifyListeners();
  }

  /**
   * 订阅状态变更
   * @param {Function} listener - 状态变更监听器函数
   * @returns {Function} 取消订阅的函数
   */
  subscribe(listener) {
    this.listeners.push(listener);

    // 立即通知一次当前状态
    listener(this.state);

    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * 通知所有监听器状态变更
   * @private
   */
  notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('状态监听器执行失败:', error);
      }
    });
  }

  /**
   * 设置Cookie列表
   * @param {Array} cookies - Cookie数组
   */
  setCookies(cookies) {
    this.setState({ cookies });
  }

  /**
   * 设置筛选后的Cookie列表
   * @param {Array} filteredCookies - 筛选后的Cookie数组
   */
  setFilteredCookies(filteredCookies) {
    this.setState({ filteredCookies });
  }

  /**
   * 设置搜索关键词
   * @param {string} searchQuery - 搜索关键词
   */
  setSearchQuery(searchQuery) {
    this.setState({ searchQuery });
  }

  /**
   * 设置排序方式
   * @param {string} sortBy - 排序字段
   * @param {string} sortOrder - 排序顺序 ('asc' 或 'desc')
   */
  setSort(sortBy, sortOrder) {
    this.setState({
      currentSort: sortBy,
      sortOrder: sortOrder
    });
  }

  /**
   * 切换排序顺序
   */
  toggleSortOrder() {
    const newOrder = this.state.sortOrder === 'asc' ? 'desc' : 'asc';
    this.setState({ sortOrder: newOrder });
  }

  /**
   * 设置视图模式
   * @param {string} viewMode - 视图模式 ('list' 或 'grid')
   */
  setViewMode(viewMode) {
    this.setState({ viewMode });
  }

  /**
   * 切换视图模式
   */
  toggleViewMode() {
    const newMode = this.state.viewMode === 'list' ? 'grid' : 'list';
    this.setState({ viewMode: newMode });
  }

  /**
   * 设置正在编辑的Cookie
   * @param {Object|null} cookie - Cookie对象或null
   */
  setEditingCookie(cookie) {
    this.setState({ editingCookie: cookie });
  }

  /**
   * 设置加载状态
   * @param {boolean} isLoading - 是否正在加载
   */
  setLoading(isLoading) {
    this.setState({ isLoading });
  }

  /**
   * 切换Cookie选中状态
   * @param {string} cookieId - Cookie ID
   */
  toggleCookieSelection(cookieId) {
    const newSelectedCookies = new Set(this.state.selectedCookies);

    if (newSelectedCookies.has(cookieId)) {
      newSelectedCookies.delete(cookieId);
    } else {
      newSelectedCookies.add(cookieId);
    }

    this.setState({ selectedCookies: newSelectedCookies });
  }

  /**
   * 设置Cookie选中状态
   * @param {string} cookieId - Cookie ID
   * @param {boolean} selected - 是否选中
   */
  setCookieSelected(cookieId, selected) {
    const newSelectedCookies = new Set(this.state.selectedCookies);

    if (selected) {
      newSelectedCookies.add(cookieId);
    } else {
      newSelectedCookies.delete(cookieId);
    }

    this.setState({ selectedCookies: newSelectedCookies });
  }

  /**
   * 全选所有可用的Cookie
   */
  selectAllCookies() {
    const availableCookies = this.state.filteredCookies.filter(
      cookie => !cookie.status?.isDisabled
    );

    const newSelectedCookies = new Set(
      availableCookies.map(cookie => cookie.id)
    );

    this.setState({ selectedCookies: newSelectedCookies });
  }

  /**
   * 清除所有选中
   */
  clearSelection() {
    this.setState({
      selectedCookies: new Set(),
      selectionMode: 0
    });
  }

  /**
   * 设置多选模式
   * @param {number} mode - 多选模式 (0=未启用, 1=多选状态, 2=全选状态)
   */
  setSelectionMode(mode) {
    this.setState({ selectionMode: mode });
  }

  /**
   * 切换到下一个多选模式
   * 循环: 0 -> 1 -> 2 -> 0
   * @returns {number} 新的多选模式
   */
  cycleSelectionMode() {
    const newMode = (this.state.selectionMode + 1) % 3;

    if (newMode === 0) {
      // 退出多选状态
      this.clearSelection();
    } else if (newMode === 2) {
      // 全选状态
      this.selectAllCookies();
    }

    this.setSelectionMode(newMode);
    return newMode;
  }

  /**
   * 获取选中的Cookie ID列表
   * @returns {Array} 选中的Cookie ID数组
   */
  getSelectedCookieIds() {
    return Array.from(this.state.selectedCookies);
  }

  /**
   * 获取选中数量
   * @returns {number} 选中的Cookie数量
   */
  getSelectedCount() {
    return this.state.selectedCookies.size;
  }

  /**
   * 检查Cookie是否被选中
   * @param {string} cookieId - Cookie ID
   * @returns {boolean} 是否被选中
   */
  isCookieSelected(cookieId) {
    return this.state.selectedCookies.has(cookieId);
  }

  /**
   * 更新单个Cookie的状态
   * @param {string} cookieId - Cookie ID
   * @param {Object} updates - 更新的属性
   */
  updateCookieState(cookieId, updates) {
    const cookies = this.state.cookies.map(cookie => {
      if (cookie.id === cookieId) {
        return { ...cookie, ...updates };
      }
      return cookie;
    });

    const filteredCookies = this.state.filteredCookies.map(cookie => {
      if (cookie.id === cookieId) {
        return { ...cookie, ...updates };
      }
      return cookie;
    });

    this.setState({ cookies, filteredCookies });
  }
}
