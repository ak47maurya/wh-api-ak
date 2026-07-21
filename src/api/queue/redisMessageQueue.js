const Queue = require('bull')
const { updateLogEntry } = require('../helper/messageLogger')

const queues = new Map()

function getRedisUrl() {
    const url = process.env.REDIS_URL
    if (!url) {
        throw new Error('REDIS_URL is not set')
    }
    return url
}

function getQueueName(instanceKey) {
    return `wa:${instanceKey}:outbox`
}

function getOrCreateInstanceQueue(instanceKey) {
    const name = getQueueName(instanceKey)
    if (queues.has(name)) return queues.get(name)

    const queue = new Queue(name, getRedisUrl(), {
        defaultJobOptions: {
            removeOnComplete: 1000,
            removeOnFail: 1000,
        },
    })

    queues.set(name, queue)
    return queue
}

function ensureProcessor(instanceKey) {
    const queue = getOrCreateInstanceQueue(instanceKey)
    if (queue.__processorAttached) return queue

    // Per-instance strict order by default.
    const concurrency = parseInt(process.env.MESSAGE_QUEUE_CONCURRENCY || '1', 10) || 1

    queue.process(concurrency, async (job) => {
        const { method, args, logId } = job.data || {}
        const instance = global.WhatsAppInstances?.[instanceKey]

        if (!instance) {
            throw new Error(`Instance not found for key: ${instanceKey}`)
        }

        if (typeof instance[method] !== 'function') {
            throw new Error(`Unsupported method: ${method}`)
        }

        const result = await instance[method](...args)

        if (logId) {
            updateLogEntry(logId, {
                status: result ? 'sent' : 'failed',
                response: result?.key?.id || result?.id || null,
            })
        }

        return result
    })

    queue.on('failed', (job, err) => {
        const { logId } = job.data || {}
        if (logId) {
            updateLogEntry(logId, {
                status: 'failed',
                response: err.message,
            })
        }
    })

    queue.__processorAttached = true
    return queue
}

async function enqueue(instanceKey, method, args, opts = {}) {
    const queue = ensureProcessor(instanceKey)

    const delayMs = parseInt(process.env.MESSAGE_QUEUE_DELAY_MS || '0', 10) || 0
    const jobOpts = {
        attempts: opts.attempts ?? 1,
        backoff: opts.backoff,
        delay: opts.delay ?? delayMs,
    }

    const { logId } = opts
    const job = await queue.add({ method, args, logId }, jobOpts)
    return job
}

module.exports = {
    getOrCreateInstanceQueue,
    enqueue,
}

