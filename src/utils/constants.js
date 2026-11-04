/**
 * 全局常量配置
 * 集中管理所有硬编码的魔法数字和配置项
 */

export const CONFIG = {
  /**
   * TTS服务配置
   */
  TTS: {
    // 默认请求延迟（秒）
    DEFAULT_REQUEST_DELAY: 5,
    // 最小音频文件大小（字节），小于此值视为无效文件
    MIN_AUDIO_FILE_SIZE: 1024,
    // 最大转码重试次数
    MAX_TRANSCODE_RETRIES: 2,
    // 重试退避基数（毫秒）
    RETRY_BACKOFF_BASE: 1000,
    // 默认语速
    DEFAULT_SPEECH_RATE: 0,
    // 默认音调
    DEFAULT_PITCH: 0,
    // 默认音频格式
    DEFAULT_FORMAT: 'mp3',
    // 音频输出目录
    AUDIO_OUTPUT_DIR: 'audio'
  },

  /**
   * Cookie管理配置
   */
  COOKIE: {
    // Cookie验证超时时间（毫秒）
    VALIDATION_TIMEOUT: 5000,
    // Cookie选择器缓存持续时间（毫秒）
    CACHE_DURATION: 60000,
    // Cookie数据文件路径
    COOKIE_FILE_PATH: 'data/cookies.json'
  },

  /**
   * 缓存服务配置
   */
  CACHE: {
    // 缓存索引过期时间（毫秒）
    INDEX_CACHE_EXPIRY: 60000,
    // 文本匹配分数阈值
    MATCH_SCORE_THRESHOLD: 0.7,
    // 高度匹配阈值
    HIGH_MATCH_THRESHOLD: 0.95,
    // 中度匹配阈值
    MEDIUM_MATCH_THRESHOLD: 0.85,
    // 缓存文件扩展名
    CACHE_FILE_EXTENSION: '.mp3',
    // 预取音频存储目录
    PREFETCH_DIR: 'data/prefetch/books'
  },

  /**
   * API客户端配置
   */
  API: {
    // 默认请求超时时间（毫秒）
    DEFAULT_TIMEOUT: 30000,
    // 最大重试次数
    MAX_RETRIES: 3,
    // 重试延迟基数（毫秒）
    RETRY_DELAY_BASE: 1000
  },

  /**
   * 任务管理配置
   */
  TASK: {
    // 任务状态
    STATUS: {
      PENDING: 'pending',
      PROCESSING: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled'
    },
    // 任务数据文件路径
    TASK_FILE_PATH: 'data/tasks/tasks.json',
    // 最大并发任务数
    MAX_CONCURRENT: 3
  },

  /**
   * WebSocket配置
   */
  WS: {
    // WebSocket基础URL
    BASE_URL: 'wss://ws-samantha.doubao.com/samantha/audio/tts',
    // 连接超时时间（毫秒）
    CONNECTION_TIMEOUT: 10000,
    // 消息超时时间（毫秒）
    MESSAGE_TIMEOUT: 30000
  },

  /**
   * 文件路径配置
   */
  PATHS: {
    // 配置目录
    CONFIG_DIR: 'config',
    // 数据目录
    DATA_DIR: 'data',
    // 日志目录
    LOGS_DIR: 'logs',
    // 音频输出目录
    AUDIO_DIR: 'audio',
    // 静态资源目录
    PUBLIC_DIR: 'public'
  },

  /**
   * 服务器配置
   */
  SERVER: {
    // 默认端口
    DEFAULT_PORT: 3000,
    // 默认主机
    DEFAULT_HOST: '0.0.0.0'
  }
}

/**
 * 默认发音人配置
 */
export const DEFAULT_SPEAKER = {
  ID: 'zh_female_wenroutaozi_uranus_bigtts',
  NAME: '温柔桃子（升级版）',
  LANGUAGE: 'zh'
}

/**
 * HTTP状态码
 */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
}

/**
 * 音频文件类型
 */
export const AUDIO_TYPES = {
  MP3: {
    EXTENSION: '.mp3',
    MIME_TYPE: 'audio/mpeg',
    // MP3文件魔数（ID3标签或MPEG帧头）
    MAGIC_NUMBERS: [
      Buffer.from([0x49, 0x44, 0x33]), // ID3
      Buffer.from([0xFF, 0xFB]), // MPEG-1 Layer 3
      Buffer.from([0xFF, 0xF3]), // MPEG-1 Layer 3 (protected)
      Buffer.from([0xFF, 0xF2])  // MPEG-2 Layer 3
    ]
  },
  AAC: {
    EXTENSION: '.aac',
    MIME_TYPE: 'audio/aac',
    // AAC文件魔数
    MAGIC_NUMBERS: [
      Buffer.from([0xFF, 0xF1]), // ADTS
      Buffer.from([0xFF, 0xF9])  // ADTS (protected)
    ]
  }
}

export default CONFIG
