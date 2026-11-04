import { Router } from 'express'
import { voiceService } from '../services/voiceService.js'
import { log } from '../utils/logger.js'
import { sendSuccess } from '../utils/apiResponse.js'

export const voicesRouter = Router()

/**
 * 获取所有发音人列表
 * GET /voices 或 GET /
 */
voicesRouter.get(['/voices', '/'], (req, res) => {
  const voices = voiceService.getAllVoices()
  // 保持与原有格式兼容，只返回name和style_id
  const list = voices.map(v => ({ name: v.name, style_id: v.style_id }))
  log('info', '获取发音人列表', { count: list.length })
  return sendSuccess(res, list)
})

/**
 * 搜索发音人
 * GET /voices/search?q=关键词&language=中文&gender=女
 */
voicesRouter.get('/voices/search', (req, res) => {
  const { q, language, gender } = req.query
  const results = voiceService.searchVoices({
    query: q,
    language,
    gender
  })
  log('info', '搜索发音人', { query: q, language, gender, count: results.length })
  return sendSuccess(res, results)
})
