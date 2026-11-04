import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { ttsService } from '../services/ttsService.js'
import { sendSuccess, sendError } from '../utils/apiResponse.js'
import { log, logError } from '../utils/logger.js'
import { getAudioPath } from '../utils/pathUtils.js'

export const ttsRouter = Router()

/**
 * TTS语音合成端点
 * POST /api/tts 或 POST /
 *
 * 请求参数：
 * - text: 要转换的文本（必需）
 * - speaker/voiceId: 发音人ID（必需，支持两种参数名以兼容旧版）
 * - rate/speech_rate: 语速，范围-50到100（可选，默认0）
 * - pitch: 音调，范围-12到12（可选，默认0）
 */
ttsRouter.post(['/tts', '/'], async (req, res) => {
  try {
    const {
      text,
      speaker,
      voiceId,
      rate,
      speech_rate,
      pitch = 0
    } = req.body || {}

    // 参数验证
    if (!text) {
      return sendError(res, '缺少必需参数：text', 400)
    }

    if (typeof text !== 'string' || text.trim().length === 0) {
      return sendError(res, '文本内容不能为空', 400)
    }

    // 兼容旧版参数名：speaker 或 voiceId
    const finalVoiceId = voiceId || speaker
    if (!finalVoiceId) {
      return sendError(res, '缺少必需参数：speaker 或 voiceId', 400)
    }

    // 兼容旧版参数名：rate 或 speech_rate
    const finalRate = rate !== undefined ? rate : (speech_rate || 0)

    // 参数范围验证
    if (finalRate < -50 || finalRate > 100) {
      return sendError(res, '语速参数超出范围（-50到100）', 400)
    }

    if (pitch < -12 || pitch > 12) {
      return sendError(res, '音调参数超出范围（-12到12）', 400)
    }

    log('info', 'TTS请求接收', {
      voiceId: finalVoiceId,
      textLength: text.length,
      rate: finalRate,
      pitch
    })

    // 调用TTS服务生成语音
    const result = await ttsService.generateSpeech({
      text,
      voiceId: finalVoiceId,
      rate: finalRate,
      pitch,
      source: "tts"
    })

    log('info', 'TTS转换成功', {
      voiceId: finalVoiceId,
      textLength: text.length,
      url: result.url
    })

    return sendSuccess(res, result)
  } catch (err) {
    logError(err, { route: 'tts' })
    
    // 根据错误类型返回不同的状态码
    if (err.message.includes('无效的发音人ID')) {
      return sendError(res, err.message, 400)
    }
    
    return sendError(res, 'TTS生成失败: ' + err.message, 500, 2)
  }
})

/**
 * 删除音频文件端点
 * DELETE /api/audio/:filename
 */
ttsRouter.delete('/audio/:filename', async (req, res) => {
  try {
    const { filename } = req.params
    const audioPath = getAudioPath(filename)
    
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath)
      log('info', '音频文件已删除', { filename })
      return sendSuccess(res, { deleted: true })
    } else {
      return sendError(res, '文件不存在', 404)
    }
  } catch (err) {
    logError(err, { route: 'delete-audio' })
    return sendError(res, '删除文件失败: ' + err.message, 500)
  }
})
