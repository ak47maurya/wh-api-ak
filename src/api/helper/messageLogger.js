const fs = require('fs')
const path = require('path')

const LOG_DIR = 'logs'
const LOG_FILE = path.join(LOG_DIR, 'messages.json')

function ensureLogFile() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, '[]', 'utf-8')
    }
  } catch (e) {
    // ignore
  }
}

function readLogs() {
  ensureLogFile()
  try {
    const data = fs.readFileSync(LOG_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

function appendLog(entry) {
  ensureLogFile()
  try {
    const logs = readLogs()
    entry.timestamp = new Date().toISOString()
    logs.push(entry)
    const max = parseInt(process.env.MESSAGE_LOG_MAX || '5000', 10) || 5000
    const trimmed = logs.length > max ? logs.slice(logs.length - max) : logs
    fs.writeFileSync(LOG_FILE, JSON.stringify(trimmed, null, 2), 'utf-8')
  } catch (e) {
    // ignore
  }
}

function deleteLogsByInstance(instanceKey) {
  try {
    const logs = readLogs()
    const filtered = logs.filter((e) => e.instanceKey !== instanceKey)
    fs.writeFileSync(LOG_FILE, JSON.stringify(filtered, null, 2), 'utf-8')
    return logs.length - filtered.length
  } catch (e) {
    return 0
  }
}

function getLogsByInstance(instanceKey, limit = 100) {
  const logs = readLogs()
  return logs
    .filter((e) => e.instanceKey === instanceKey)
    .reverse()
    .slice(0, limit)
}

function getInstanceStats(instanceKey) {
  const logs = readLogs()
  const filtered = logs.filter((e) => e.instanceKey === instanceKey)
  return {
    total: filtered.length,
    sent: filtered.filter((e) => e.status === 'sent').length,
    failed: filtered.filter((e) => e.status === 'failed').length,
    queued: filtered.filter((e) => e.status === 'queued').length,
    lastSent: filtered.length > 0 ? filtered[filtered.length - 1].timestamp : null,
  }
}

function getRecentLogs(limit = 200) {
  const logs = readLogs()
  return logs.reverse().slice(0, limit)
}

function updateLogEntry(logId, updates) {
  try {
    const logs = readLogs()
    const idx = logs.findIndex((e) => e._logId === logId)
    if (idx === -1) return false
    Object.assign(logs[idx], updates)
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8')
    return true
  } catch (e) {
    return false
  }
}

function deleteLogEntry(logId) {
  try {
    const logs = readLogs()
    const filtered = logs.filter((e) => e._logId !== logId)
    if (filtered.length === logs.length) return false
    fs.writeFileSync(LOG_FILE, JSON.stringify(filtered, null, 2), 'utf-8')
    return true
  } catch (e) {
    return false
  }
}

module.exports = { appendLog, deleteLogsByInstance, deleteLogEntry, getLogsByInstance, getInstanceStats, getRecentLogs, readLogs, updateLogEntry }
