const Message = require('../models/Message')

async function appendLog(entry) {
  try {
    entry.timestamp = new Date().toISOString()
    const doc = await Message.create(entry)
    return doc
  } catch (e) {
    // ignore
  }
}

async function deleteLogsByInstance(instanceKey) {
  try {
    const result = await Message.deleteMany({ instanceKey })
    return result.deletedCount || 0
  } catch (e) {
    return 0
  }
}

async function getLogsByInstance(instanceKey, limit = 100) {
  try {
    return await Message.find({ instanceKey })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()
  } catch (e) {
    return []
  }
}

async function getInstanceStats(instanceKey) {
  try {
    const [stats] = await Message.aggregate([
      { $match: { instanceKey } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          queued: { $sum: { $cond: [{ $eq: ['$status', 'queued'] }, 1, 0] } },
          lastSent: { $max: '$timestamp' },
        },
      },
    ])
    return stats || { total: 0, sent: 0, failed: 0, queued: 0, lastSent: null }
  } catch (e) {
    return { total: 0, sent: 0, failed: 0, queued: 0, lastSent: null }
  }
}

async function getRecentLogs(limit = 200) {
  try {
    return await Message.find().sort({ timestamp: -1 }).limit(limit).lean()
  } catch (e) {
    return []
  }
}

async function updateLogEntry(logId, updates) {
  try {
    const res = await Message.findOneAndUpdate({ _logId: logId }, { $set: updates }, { new: true })
    return !!res
  } catch (e) {
    return false
  }
}

async function deleteLogEntry(logId) {
  try {
    const res = await Message.deleteOne({ _logId: logId })
    return res.deletedCount > 0
  } catch (e) {
    return false
  }
}

module.exports = { appendLog, deleteLogsByInstance, deleteLogEntry, getLogsByInstance, getInstanceStats, getRecentLogs, updateLogEntry }
