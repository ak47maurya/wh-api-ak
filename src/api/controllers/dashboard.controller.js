const { getLogsByInstance, getInstanceStats, deleteLogEntry } = require('../helper/messageLogger')
const config = require('../../config/config')

exports.loginPage = (req, res) => {
  res.render('dashboard/login', {
    error: req.flash('error'),
    serverToken: config.token,
    serverAdminToken: config.adminToken,
  })
}

exports.login = (req, res) => {
  const { instanceKey, token } = req.body
  if (!instanceKey || !token) {
    req.flash('error', 'Instance Key aur Token dono daalein')
    return res.redirect('/dashboard/login')
  }
  req.session.dashboardInstanceKey = instanceKey
  req.session.dashboardToken = token
  req.session.dashboardAdminToken = req.body.adminToken || ''
  res.redirect('/dashboard')
}

exports.logout = (req, res) => {
  req.session.destroy()
  res.redirect('/dashboard/login')
}

exports.dashboard = async (req, res) => {
  const instanceKey = req.session.dashboardInstanceKey
  const token = req.session.dashboardToken || ''
  const adminToken = req.session.dashboardAdminToken || ''

  let instanceInfo = null
  let instanceError = null
  let qrCode = null
  let logs = []
  let queueStatus = null
  let stats = null
  let contacts = []
  let groups = {}

  if (!instanceKey) {
    return res.redirect('/dashboard/login')
  }

  const instance = global.WhatsAppInstances?.[instanceKey]
  if (!instance) {
    req.flash('error', 'Instance not found. Contact developer.')
    return res.redirect('/dashboard/login')
  } else {
    try {
      const detail = await instance.getInstanceDetail(instanceKey)
      instanceInfo = {
        error: false,
        instance_data: detail,
      }
      qrCode = instance.instance?.qr || null
      if (detail.phone_connected && detail.user && detail.user.id) {
        try {
          instanceInfo.profilePic = await instance.instance.sock?.profilePictureUrl(detail.user.id, 'image')
        } catch (e) {
          instanceInfo.profilePic = null
        }
      }
    } catch (e) {
      instanceError = e.message || 'Failed to get instance info'
    }
  }

  try {
    logs = getLogsByInstance(instanceKey, 100)
    stats = getInstanceStats(instanceKey)
  } catch (e) {
    // ignore
  }

  if (instance) {
    const q = instance.messageQueue
    if (q) {
      queueStatus = {
        backend: 'memory',
        queue: {
          queued: typeof q.length === 'function' ? q.length() : 0,
          running: typeof q.running === 'function' ? q.running() : 0,
          concurrency: instance.messageQueueConcurrency || 1,
          delayMs: instance.messageQueueDelayMs || 0,
          max: instance.messageQueueMax || 0,
        },
      }
    }
  }

  if (instance) {
    try {
      const c = await instance.contacts()
      if (!c.error) contacts = c.contacts || []
    } catch (e) { /* ignore */ }
    if (instance.instance?.online && instance.instance?.sock) {
      try {
        const result = await Promise.race([
          instance.groupFetchAllParticipating(),
          new Promise(r => setTimeout(() => r(null), 5000))
        ])
        if (result) groups = result
      } catch (e) { /* ignore */ }
    }
  }

  res.render('dashboard/index', {
    instanceKey,
    token,
    adminToken,
    instanceInfo,
    instanceError,
    qrCode,
    logs,
    queueStatus,
    stats,
    contacts,
    groups,
  })
}

exports.deleteLog = (req, res) => {
  const logId = req.body?.logId || req.query?.logId
  if (!logId) return res.status(400).json({ error: true, message: 'logId required' })
  const ok = deleteLogEntry(logId)
  res.json({ error: !ok, message: ok ? 'Deleted' : 'Not found' })
}
