/**
 * 文档管理路由
 * 从 Gitee 云端仓库的 docs 子文件夹读取文档
 */

import { Router } from 'express'
import { log, logError } from '../utils/logger.js'
import { sendSuccess, sendError } from '../utils/apiResponse.js'

export const docsRouter = Router()

/**
 * Gitee 仓库配置
 * 使用 AnnouncementManager 仓库的 DoBao-TTS/docs 子文件夹
 */
const GITEE_CONFIG = {
  owner: process.env.GITEE_DOCS_OWNER || 'YeYuRaoXinXian',
  repo: process.env.GITEE_DOCS_REPO || 'AnnouncementManager',
  path: 'DoBao-TTS/docs',
  branch: process.env.GITEE_DOCS_BRANCH || 'master'
}

/**
 * 内存缓存
 */
let docsCache = {
  list: [],
  contents: new Map(),
  lastUpdated: null
}

/**
 * 从 Gitee 获取文档列表
 * GET /api/docs
 */
docsRouter.get('/docs', async (req, res) => {
  try {
    log('info', '从云端获取文档列表', { path: GITEE_CONFIG.path })

    // 构建 API URL，指向 docs 子文件夹
    const apiUrl = `https://gitee.com/api/v5/repos/${GITEE_CONFIG.owner}/${GITEE_CONFIG.repo}/contents/${GITEE_CONFIG.path}?ref=${GITEE_CONFIG.branch}`

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'DoBao-TTS-Docs'
      }
    })

    // 如果 404，可能是文件夹不存在，返回空列表
    if (response.status === 404) {
      log('warn', 'docs 文件夹不存在，返回空列表')
      return sendSuccess(res, [], 'docs 文件夹不存在，请先创建')
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const files = await response.json()

    // 过滤 Markdown 文件
    const mdFiles = files.filter(file =>
      file.type === 'file' &&
      file.name.endsWith('.md')
    )

    // 构建文档列表
    const docs = mdFiles.map(file => ({
      id: file.sha,
      filename: file.name,
      name: file.name.replace('.md', ''),
      path: file.path,
      downloadUrl: file.download_url,
      size: file.size,
      modifiedTime: new Date().toISOString()
    })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

    // 更新缓存
    docsCache.list = docs
    docsCache.lastUpdated = new Date().toISOString()

    log('info', '文档列表获取成功', { count: docs.length })
    return sendSuccess(res, docs, '获取文档列表成功')
  } catch (err) {
    logError(err, { route: 'docs' })

    // 如果有缓存，返回缓存数据
    if (docsCache.list.length > 0) {
      log('warn', '使用缓存的文档列表')
      return sendSuccess(res, docsCache.list, '获取文档列表失败，使用缓存数据', { fromCache: true })
    }

    return sendError(res, '获取文档列表失败: ' + err.message, 500)
  }
})

/**
 * 获取文档内容
 * GET /api/docs/:id
 */
docsRouter.get('/docs/:id', async (req, res) => {
  try {
    const { id } = req.params
    log('info', '获取文档内容', { docId: id })

    // 检查缓存
    if (docsCache.contents.has(id)) {
      const cachedDoc = docsCache.contents.get(id)
      log('info', '使用缓存的文档内容', { docId: id })
      return sendSuccess(res, cachedDoc, '获取文档内容成功', { fromCache: true })
    }

    // 先从列表中找到文档信息
    let docInfo = docsCache.list.find(d => d.id === id)

    // 如果缓存中没有，重新获取列表
    if (!docInfo) {
      const apiUrl = `https://gitee.com/api/v5/repos/${GITEE_CONFIG.owner}/${GITEE_CONFIG.repo}/contents/${GITEE_CONFIG.path}?ref=${GITEE_CONFIG.branch}`

      const listResponse = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'DoBao-TTS-Docs'
        }
      })

      if (!listResponse.ok) {
        throw new Error(`获取文档列表失败: HTTP ${listResponse.status}`)
      }

      const files = await listResponse.json()
      const file = files.find(f => f.sha === id)

      if (!file) {
        return sendError(res, '文档不存在', 404)
      }

      docInfo = {
        id: file.sha,
        filename: file.name,
        name: file.name.replace('.md', ''),
        path: file.path,
        downloadUrl: file.download_url,
        size: file.size
      }
    }

    // 从下载链接获取内容
    const contentResponse = await fetch(docInfo.downloadUrl, {
      headers: {
        'User-Agent': 'DoBao-TTS-Docs'
      }
    })

    if (!contentResponse.ok) {
      throw new Error(`获取文档内容失败: HTTP ${contentResponse.status}`)
    }

    const content = await contentResponse.text()

    const docData = {
      id: docInfo.id,
      filename: docInfo.filename,
      name: docInfo.name,
      extension: '.md',
      content,
      size: docInfo.size,
      modifiedTime: new Date().toISOString(),
      createdTime: new Date().toISOString()
    }

    // 缓存文档内容
    docsCache.contents.set(id, docData)

    log('info', '文档内容获取成功', { filename: docInfo.filename, size: content.length })
    return sendSuccess(res, docData, '获取文档内容成功')
  } catch (err) {
    logError(err, { route: 'docs/:id' })
    return sendError(res, '获取文档内容失败: ' + err.message, 500)
  }
})

/**
 * 刷新文档列表
 * POST /api/docs/refresh
 */
docsRouter.post('/docs/refresh', async (req, res) => {
  try {
    log('info', '刷新文档列表')

    // 清除缓存
    docsCache.list = []
    docsCache.contents.clear()
    docsCache.lastUpdated = null

    const apiUrl = `https://gitee.com/api/v5/repos/${GITEE_CONFIG.owner}/${GITEE_CONFIG.repo}/contents/${GITEE_CONFIG.path}?ref=${GITEE_CONFIG.branch}`

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'DoBao-TTS-Docs'
      }
    })

    // 如果 404，可能是文件夹不存在
    if (response.status === 404) {
      log('warn', 'docs 文件夹不存在')
      return sendSuccess(res, [], 'docs 文件夹不存在，请先创建')
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const files = await response.json()

    const mdFiles = files.filter(file =>
      file.type === 'file' &&
      file.name.endsWith('.md')
    )

    const docs = mdFiles.map(file => ({
      id: file.sha,
      filename: file.name,
      name: file.name.replace('.md', ''),
      path: file.path,
      downloadUrl: file.download_url,
      size: file.size,
      modifiedTime: new Date().toISOString()
    })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

    docsCache.list = docs
    docsCache.lastUpdated = new Date().toISOString()

    log('info', '文档列表刷新成功', { count: docs.length })
    return sendSuccess(res, docs, '刷新文档列表成功')
  } catch (err) {
    logError(err, { route: 'docs/refresh' })
    return sendError(res, '刷新文档列表失败: ' + err.message, 500)
  }
})

/**
 * 搜索文档
 * GET /api/docs/search?q=关键词
 */
docsRouter.get('/docs/search', async (req, res) => {
  try {
    const { q: keyword } = req.query

    if (!keyword || keyword.trim() === '') {
      return sendError(res, '搜索关键词不能为空', 400)
    }

    console.log('[Docs] ============================================')
    console.log('[Docs] 开始搜索文档')
    console.log('[Docs] 关键词:', keyword)
    
    log('info', '搜索文档', { keyword })

    // 确保列表已加载
    let docs = docsCache.list
    if (docs.length === 0) {
      console.log('[Docs] 缓存为空，重新获取列表')
      const apiUrl = `https://gitee.com/api/v5/repos/${GITEE_CONFIG.owner}/${GITEE_CONFIG.repo}/contents/${GITEE_CONFIG.path}?ref=${GITEE_CONFIG.branch}`

      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'DoBao-TTS-Docs'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const files = await response.json()

      const mdFiles = files.filter(file =>
        file.type === 'file' &&
        file.name.endsWith('.md')
      )

      docs = mdFiles.map(file => ({
        id: file.sha,
        filename: file.name,
        name: file.name.replace('.md', ''),
        path: file.path,
        downloadUrl: file.download_url,
        size: file.size,
        modifiedTime: new Date().toISOString()
      })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

      docsCache.list = docs
    }

    const searchKeyword = keyword.toLowerCase()

    // 搜索文档（在文件名中搜索）
    const results = docs.filter(doc =>
      doc.name.toLowerCase().includes(searchKeyword)
    ).map(doc => ({
      ...doc,
      nameMatch: true,
      contentMatch: false
    }))

    console.log('[Docs] 搜索结果:', results.length)
    console.log('[Docs] ============================================')

    log('info', '文档搜索完成', { keyword, resultCount: results.length })
    return sendSuccess(res, results, `搜索完成，找到 ${results.length} 个结果`)
  } catch (err) {
    console.error('[Docs] 搜索文档失败:', err.message)
    console.error('[Docs] 错误堆栈:', err.stack)
    console.log('[Docs] ============================================')
    
    logError(err, { route: 'docs/search' })
    return sendError(res, '搜索文档失败: ' + err.message, 500)
  }
})
