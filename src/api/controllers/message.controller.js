const { enqueue, getOrCreateInstanceQueue } = require('../queue/redisMessageQueue')
const { appendLog, updateLogEntry } = require('../helper/messageLogger')

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function genLogId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9)
}

function logSend(instanceKey, method, body, result, status, logId) {
    try {
        appendLog({
            _logId: logId || genLogId(),
            instanceKey,
            method,
            to: body?.id || body?.message?.id || 'unknown',
            text: body?.message || body?.text || '[media]',
            status: status || 'sent',
            response: result?.key?.id || result?.id || null,
        })
    } catch (e) {
        // ignore log errors
    }
}

async function enqueueOrRun(req, res, method, args) {
    const instanceKey = req.query.key
    const instance = WhatsAppInstances?.[instanceKey]

    const logId = genLogId()

    if (!process.env.REDIS_URL) {
        try {
            const data = await instance[method](...args)
            logSend(instanceKey, method, args[0] || {}, data, data ? 'sent' : 'failed', logId)
            return res.status(201).json({ error: false, data })
        } catch (e) {
            logSend(instanceKey, method, args[0] || {}, e, 'failed', logId)
            return res.status(400).json({ error: true, message: e.message || 'Failed' })
        }
    }

    const job = await enqueue(instanceKey, method, args, { logId })

    const shouldWait =
        req.query.wait === '1' ||
        req.query.wait === 'true' ||
        req.body?.wait === true

    if (!shouldWait) {
        logSend(instanceKey, method, args[0] || {}, { jobId: job.id }, 'queued', logId)
        return res.status(202).json({
            error: false,
            job: { id: job.id, queue: `wa:${instanceKey}:outbox` },
        })
    }

    const timeoutMs =
        parseInt(process.env.MESSAGE_QUEUE_WAIT_TIMEOUT_MS || '30000', 10) || 30000

    const result = await Promise.race([
        job.finished(),
        waitMs(timeoutMs).then(() => {
            throw new Error('Timed out waiting for queued job')
        }),
    ])

    logSend(instanceKey, method, args[0] || {}, result, result ? 'sent' : 'failed', logId)
    return res.status(201).json({ error: false, data: result, job: { id: job.id } })
}

exports.Text = async (req, res) => {
    return enqueueOrRun(req, res, 'sendTextMessage', [req.body])
}
exports.TextManager = async (instanceKey, message) => {
    const data = await WhatsAppInstances[instanceKey].sendTextMessage(
        message
    )
    logSend(instanceKey, 'TextManager', message, data, data ? 'sent' : 'failed')
    return { error: false, data: data }
}

exports.Image = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMedia', [
        req.body.id,
        req.body.userType || req.body.typeId,
        req.file,
        'image',
        req.body?.caption,
        req.body?.replyFrom,
        req.body?.delay,
    ])
}
exports.sendurlfile = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMediaFile', [req.body, 'url'])
}
exports.sendbase64file = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMediaFile', [req.body, 'base64'])
}
exports.imageFile = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMedia', [
        req.body.id,
        req.body.userType || req.body.typeId,
        req.file,
        'image',
        req.body?.caption,
        req.body?.replyFrom,
        req.body?.delay,
    ])
}
exports.audioFile = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMedia', [
        req.body.id,
        req.body.userType || req.body.typeId,
        req.file,
        'audio',
        req.body?.caption,
        req.body?.replyFrom,
        req.body?.delay,
    ])
}

exports.Video = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMedia', [
        req.body.id,
        req.body.userType || req.body.typeId,
        req.file,
        'video',
        req.body?.caption,
        req.body?.replyFrom,
        req.body?.delay,
    ])
}


exports.Audio = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMedia', [
        req.body.id,
        req.body.userType || req.body.typeId,
        req.file,
        'audio',
        req.body?.caption,
        req.body?.replyFrom,
        req.body?.delay,
    ])
}

exports.Document = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMedia', [
        req.body.id,
        req.body.userType || req.body.typeId,
        req.file,
        'document',
        req.body?.caption,
        req.body?.replyFrom,
        req.body?.delay,
    ])
}

exports.Mediaurl = async (req, res) => {
    return enqueueOrRun(req, res, 'sendUrlMediaFile', [
        req.body.id,
        req.body.url,
        req.body.type,
        req.body.mimetype,
        req.body.caption,
    ])
}

exports.Button = async (req, res) => {
    // logger.info(res.body)
    return enqueueOrRun(req, res, 'sendButtonMessage', [
        req.body.id,
        req.body.btndata,
    ])
}

exports.Contact = async (req, res) => {
    return enqueueOrRun(req, res, 'sendContactMessage', [
        req.body.id,
        req.body.vcard,
    ])
}

exports.List = async (req, res) => {
    return enqueueOrRun(req, res, 'sendListMessage', [
        req.body.id,
        req.body.type,
        req.body.options,
        req.body.groupOptions,
        req.body.msgdata,
    ])
}

exports.MediaButton = async (req, res) => {
    return enqueueOrRun(req, res, 'sendMediaButtonMessage', [
        req.body.id,
        req.body.btndata,
    ])
}

exports.SetStatus = async (req, res) => {
    const presenceList = [
        'unavailable',
        'available',
        'composing',
        'recording',
        'paused',
    ]
    if (presenceList.indexOf(req.body.status) === -1) {
        return res.status(400).json({
            error: true,
            message:
                'status parameter must be one of ' + presenceList.join(', '),
        })
    }

    return enqueueOrRun(req, res, 'setStatus', [
        req.body.status,
        req.body.id,
        req.body.type,
        req.body.delay,
    ])
}

exports.Read = async (req, res) => {
    const data = await WhatsAppInstances[req.query.key].readMessage(req.body.msg)
    return res.status(201).json({ error: false, data: data })
}

exports.React = async (req, res) => {
    return enqueueOrRun(req, res, 'reactMessage', [
        req.body.id,
        req.body.key,
        req.body.emoji,
    ])
}

exports.QueueStatus = async (req, res) => {
    const instance = WhatsAppInstances[req.query.key]
    if (process.env.REDIS_URL) {
        const q = getOrCreateInstanceQueue(req.query.key)
        const [waiting, active, delayed, failed] = await Promise.all([
            q.getWaitingCount(),
            q.getActiveCount(),
            q.getDelayedCount(),
            q.getFailedCount(),
        ])

        return res.json({
            error: false,
            backend: 'redis',
            queue: {
                name: `wa:${req.query.key}:outbox`,
                waiting,
                active,
                delayed,
                failed,
                concurrency:
                    parseInt(process.env.MESSAGE_QUEUE_CONCURRENCY || '1', 10) ||
                    1,
            },
        })
    }

    const q = instance?.messageQueue
    return res.json({
        error: false,
        backend: 'memory',
        queue: {
            queued: q?.length ? q.length() : 0,
            running: q?.running ? q.running() : 0,
            concurrency: instance?.messageQueueConcurrency || 1,
            delayMs: instance?.messageQueueDelayMs || 0,
            max: instance?.messageQueueMax || 0,
        },
    })
}

exports.JobStatus = async (req, res) => {
    if (!process.env.REDIS_URL) {
        return res.status(400).json({
            error: true,
            message: 'Job status is only available when REDIS_URL is set',
        })
    }

    const instanceKey = req.query.key
    const queue = getOrCreateInstanceQueue(instanceKey)
    const job = await queue.getJob(req.params.id)

    if (!job) {
        return res.status(404).json({ error: true, message: 'Job not found' })
    }

    const state = await job.getState()
    return res.json({
        error: false,
        job: {
            id: job.id,
            state,
            attemptsMade: job.attemptsMade,
            failedReason: job.failedReason || null,
        },
    })
}
