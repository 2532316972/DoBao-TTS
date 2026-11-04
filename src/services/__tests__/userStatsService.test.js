import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { generateUserHash, normalizeIp, recordAccess, setNow, getDailyStats, generateSyncData } from '../userStatsService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..', '..')
const dataDir = path.join(projectRoot, 'data')
const dataFile = path.join(dataDir, 'user-access-log.json')
const dailyFile = path.join(dataDir, 'daily-user-stats.json')

function cleanupDataFiles() {
  try { fs.unlinkSync(dataFile) } catch {}
  try { fs.unlinkSync(dailyFile) } catch {}
}

describe('generateUserHash', () => {
  it('相同输入生成相同hash', () => {
    const ip = '192.168.1.100'
    const ua = 'Mozilla/5.0 Chrome/120'
    const hash1 = generateUserHash(ip, ua)
    const hash2 = generateUserHash(ip, ua)
    assert.strictEqual(hash1, hash2)
  })

  it('不同UA生成不同hash', () => {
    const ip = '192.168.1.100'
    const hash1 = generateUserHash(ip, 'Chrome')
    const hash2 = generateUserHash(ip, 'Firefox')
    assert.notStrictEqual(hash1, hash2)
  })

  it('返回32位十六进制字符串', () => {
    const hash = generateUserHash('127.0.0.1', 'test')
    assert.match(hash, /^[a-f0-9]{32}$/)
  })
})

describe('normalizeIp', () => {
  it('127.0.0.1 归一化为 local', () => {
    assert.strictEqual(normalizeIp('127.0.0.1'), 'local')
  })

  it('::1 归一化为 local', () => {
    assert.strictEqual(normalizeIp('::1'), 'local')
  })

  it('192.168.x.x 归一化为 local', () => {
    assert.strictEqual(normalizeIp('192.168.1.100'), 'local')
  })

  it('10.x.x.x 归一化为 local', () => {
    assert.strictEqual(normalizeIp('10.0.0.1'), 'local')
  })

  it('公网IP保持不变', () => {
    assert.strictEqual(normalizeIp('8.8.8.8'), '8.8.8.8')
  })

  it('null 返回 unknown', () => {
    assert.strictEqual(normalizeIp(null), 'unknown')
  })
})

describe('recordAccess', () => {
  afterEach(() => {
    cleanupDataFiles()
  })

  it('记录访问并返回成功', async () => {
    setNow(() => new Date('2026-06-08T10:00:00Z'))
    const result = await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    assert.strictEqual(result.success, true)
    assert.ok(result.userHash)
  })

  it('写入JSON文件', async () => {
    setNow(() => new Date('2026-06-08T10:00:00Z'))
    await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    assert.ok(fs.existsSync(dataFile))
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    assert.ok(Array.isArray(data.records))
    assert.strictEqual(data.records.length, 1)
    assert.strictEqual(data.records[0].ip, '1.2.3.4')
  })

  it('同一用户多次访问记录多条', async () => {
    setNow(() => new Date('2026-06-08T10:00:00Z'))
    await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    assert.strictEqual(data.records.length, 3)
    const hashes = data.records.map(r => r.userHash)
    assert.ok(hashes.every(h => h === hashes[0]))
  })
})

describe('getDailyStats (本地去重)', () => {
  afterEach(() => {
    cleanupDataFiles()
  })

  it('无本地数据时本地计数为0', async () => {
    setNow(() => new Date('2026-06-08T10:00:00Z'))
    const stats = await getDailyStats()
    assert.strictEqual(stats.date, '2026-06-08')
    assert.ok(stats.todayCount >= 0)
  })

  it('同一用户多次访问只计1人', async () => {
    setNow(() => new Date('2026-06-08T10:00:00Z'))
    await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    await recordAccess({ ip: '1.2.3.4', userAgent: 'TestBot/1.0' })
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    const uniqueHashes = new Set(data.records.map(r => r.userHash))
    assert.strictEqual(uniqueHashes.size, 1)
  })

  it('不同UA算不同用户', async () => {
    setNow(() => new Date('2026-06-08T10:00:00Z'))
    await recordAccess({ ip: '1.2.3.4', userAgent: 'Chrome' })
    await recordAccess({ ip: '1.2.3.4', userAgent: 'Firefox' })
    await recordAccess({ ip: '5.6.7.8', userAgent: 'Chrome' })
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    const uniqueHashes = new Set(data.records.map(r => r.userHash))
    assert.strictEqual(uniqueHashes.size, 3)
  })
})

describe('generateSyncData', () => {
  afterEach(() => {
    cleanupDataFiles()
  })

  it('生成正确格式', async () => {
    setNow(() => new Date('2026-06-08T10:00:00Z'))
    const syncData = await generateSyncData()
    assert.strictEqual(syncData.version, '1.0.0')
    assert.ok(Array.isArray(syncData.instanceFingerprints))
    assert.strictEqual(syncData.instanceFingerprints.length, 1)
    assert.match(syncData.instanceFingerprints[0], /^[A-F0-9]{8}$/)
    assert.ok(syncData.lastUpdated)
    assert.ok(syncData.today)
    assert.strictEqual(syncData.today.date, '2026-06-08')
    assert.ok(typeof syncData.today.userCount === 'number')
    assert.ok(Array.isArray(syncData.dailyStats))
  })
})
