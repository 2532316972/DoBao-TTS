import fs from 'fs'
import path from 'path'
import { getLogsPath } from './pathUtils.js'

export const LOG_LEVELS = ['info', 'warn', 'error', 'debug']
const LOG_DIR = getLogsPath()
const LOG_FILE = path.join(LOG_DIR, 'app.log')
let writeToFile = true

function ensureLogFile() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '')
  } catch {
    writeToFile = false
  }
}
ensureLogFile()

/**
 * 写日志到控制台与文件
 */
export function log(level, msg, meta) {
  const ts = new Date().toISOString()
  
  // 将英文级别转换为中文
  const levelMap = {
    'info': '信息',
    'warn': '警告', 
    'error': '错误',
    'debug': '调试'
  }
  const levelText = levelMap[level] || String(level).toUpperCase()
  
  const line = `[${ts}] [${levelText}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`
  switch (level) {
    case 'info': console.log(line); break
    case 'warn': console.warn(line); break
    case 'error': console.error(line); break
    case 'debug': console.debug(line); break
    default: console.log(line); break
  }
  if (writeToFile) {
    try { fs.appendFileSync(LOG_FILE, line + '\n') } catch { writeToFile = false }
  }
}

/**
 * 捕获并记录错误堆栈
 */
export function logError(err, ctx) {
  const stack = err instanceof Error ? err.stack : String(err)
  log('error', stack, ctx)
}
