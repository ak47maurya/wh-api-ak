const ffmpegPath = require('@ffmpeg-installer/ffmpeg')
const { exec } = require('child_process')
const fetch = require('node-fetch')
const QRCode = require('qrcode')
const pino = require('pino')
const logger = pino()
const { promisify } = require('util')
const NodeCache = require('node-cache')
const cache = new NodeCache({ stdTTL: 86400 })
const GroupsCache = new NodeCache({ stdTTL: 20 })
const GroupsMetaDataCache = new NodeCache({ stdTTL: 3600 })
const schedule = require('node-schedule')
const async = require('async')

let intervalStore = []

const {
    makeWASocket,
    DisconnectReason,
    isJidGroup,
    jidDecode,
    jidEncode,
    jid,
    isLid,
    isJidBroadcast,
    proto,
    delay,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    getDevice,
    GroupMetadata,
    MessageUpsertType,
    ParticipantAction,
    generateWAMessageFromContent,
    getUSyncDevices,
    WASocket,
} = require('@whiskeysockets/baileys')

const { unlinkSync } = require('fs')
const { v4: uuidv4 } = require('uuid')
const path = require('path')
const processButton = require('../helper/processbtn')
const generateVC = require('../helper/genVc')
const axios = require('axios')
const config = require('../../config/config')
const downloadMessage = require('../helper/downloadMsg')
const fs = require('fs').promises
const getMIMEType = require('mime-types')
const readFileAsync = promisify(fs.readFile)
const util = require('util')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createInMemoryMessageStore() {
    /** @type {Map<string, Map<string, any>>} */
    const byJid = new Map()

    const getBucket = (remoteJid) => {
        if (!byJid.has(remoteJid)) byJid.set(remoteJid, new Map())
        return byJid.get(remoteJid)
    }

    return {
        bind: (ev) => {
            if (!ev?.on) return

            ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages || []) {
                    const remoteJid = msg?.key?.remoteJid
                    const id = msg?.key?.id
                    if (!remoteJid || !id) continue
                    getBucket(remoteJid).set(id, msg)
                }
            })

            ev.on('messages.update', (updates) => {
                for (const u of updates || []) {
                    const remoteJid = u?.key?.remoteJid
                    const id = u?.key?.id
                    if (!remoteJid || !id) continue
                    const bucket = byJid.get(remoteJid)
                    const existing = bucket?.get(id)
                    if (existing) {
                        bucket.set(id, { ...existing, ...u })
                    }
                }
            })
        },

        loadMessage: (remoteJid, id) => {
            return byJid.get(remoteJid)?.get(id)
        },
    }
}

async function clear() {
    const mainDirectoryPath = 'db/'
    const filesToExclude = ['creds.json', 'contacts.json', 'groups.json']

    let folders
    try {
        folders = await fs.readdir(mainDirectoryPath)
    } catch {
        return
    }
    if (folders.length === 0) return

    for (const folder of folders) {
        const folderPath = path.join(mainDirectoryPath, folder)
        let stats
        try {
            stats = await fs.stat(folderPath)
        } catch {
            continue
        }
        if (!stats.isDirectory()) continue

        let files
        try {
            files = await fs.readdir(folderPath)
        } catch {
            continue
        }

        for (const file of files) {
            if (filesToExclude.includes(file)) continue
            const filePath = path.join(folderPath, file)
            try {
                await fs.unlink(filePath)
            } catch {
                // ignore
            }
        }
    }
}

const job = schedule.scheduleJob('0 3 * * *', clear)

class WhatsAppInstance {
    store = createInMemoryMessageStore()
    inMessageQueueWorker = false
    messageQueueConcurrency =
        parseInt(process.env.MESSAGE_QUEUE_CONCURRENCY || '1', 10) || 1
    messageQueueDelayMs =
        parseInt(process.env.MESSAGE_QUEUE_DELAY_MS || '0', 10) || 0
    messageQueueMax = parseInt(process.env.MESSAGE_QUEUE_MAX || '5000', 10) || 5000
    messageQueue = async.queue((task, done) => {
        const run = async () => {
            this.inMessageQueueWorker = true
            try {
                const res = await task.fn()
                task.resolve(res)
            } catch (e) {
                task.reject(e)
            } finally {
                this.inMessageQueueWorker = false
                const delayMs =
                    typeof task.delayMs === 'number'
                        ? task.delayMs
                        : this.messageQueueDelayMs
                if (delayMs > 0) {
                    await sleep(delayMs)
                }
            }
        }

        run()
            .then(() => done())
            .catch(() => done())
    }, 1)

    runInMessageQueue(fn, opts = {}) {
        // When using Redis-backed queuing (Bull), queuing happens at the API/controller level.
        // In that mode, we keep instance methods "direct" to avoid double-queuing & deadlocks.
        if (process.env.REDIS_URL) {
            return Promise.resolve().then(fn)
        }
        if (this.inMessageQueueWorker) {
            return Promise.resolve().then(fn)
        }
        if (!this.messageQueue) {
            throw new Error('Message queue is not initialized')
        }

        // Keep queue strictly sequential by default
        this.messageQueue.concurrency = this.messageQueueConcurrency

        const queued = this.messageQueue.length()
        if (queued >= this.messageQueueMax) {
            return Promise.reject(
                new Error('Message queue is full, please try again later')
            )
        }

        return new Promise((resolve, reject) => {
            this.messageQueue.push(
                {
                    fn,
                    resolve,
                    reject,
                    delayMs:
                        typeof opts.delayMs === 'number'
                            ? opts.delayMs
                            : undefined,
                },
                () => {}
            )
        })
    }

    socketConfig = {
        defaultQueryTimeoutMs: undefined,
        printQRInTerminal: false,
        logger: pino({
            level: config.log.level,
        }),

        // markOnlineOnConnect: false
        msgRetryCounterCache: cache,
        forceGroupsPrekeys: false,
        getMessage: (key) => {
            return (
                this.store.loadMessage(key.remoteJid, key.id)?.message ||
                undefined
            )
        },
        patchMessageBeforeSending: (msg) => {
            if (
                msg.deviceSentMessage?.message?.listMessage?.listType ==
                proto.Message.ListMessage.ListType.PRODUCT_LIST
            ) {
                msg = JSON.parse(JSON.stringify(msg))
                msg.deviceSentMessage.message.listMessage.listType =
                    proto.Message.ListMessage.ListType.SINGLE_SELECT
            }

            if (
                msg.listMessage?.listType ==
                proto.Message.ListMessage.ListType.PRODUCT_LIST
            ) {
                msg = JSON.parse(JSON.stringify(msg))
                msg.listMessage.listType =
                    proto.Message.ListMessage.ListType.SINGLE_SELECT
            }

            const requiresPatch = !!(
                msg.buttonsMessage ||
                msg.listMessage ||
                msg.templateMessage
            )
            if (requiresPatch) {
                msg = {
                    viewOnceMessageV2: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...msg,
                        },
                    },
                }
            }

            return msg
        },
    }

    key = ''
    authState
    allowWebhook = undefined
    webhook = undefined

    instance = {
        key: this.key,
        chats: [],
        contacts: [],
        qr: '',
        messages: [],
        qrRetry: 0,
        customWebhook: '',
        WAPresence: [],
        deleted: false,
    }

    axiosInstance = axios.create({
        baseURL: config.webhookUrl,
    })

    constructor(
        key,
        allowWebhook,
        webhook,
        cacheDuration = 24 * 60 * 60 * 1000
    ) {
        this.key = key ? key : uuidv4()
        this.instance.customWebhook = this.webhook ? this.webhook : webhook
        this.allowWebhook = config.webhookEnabled
            ? config.webhookEnabled
            : allowWebhook
        this.queue = this.createQueue(257)

        if (this.allowWebhook && this.instance.customWebhook !== null) {
            this.allowWebhook = true
            this.instance.customWebhook = webhook
            this.axiosInstance = axios.create({
                baseURL: webhook,
            })
        }
    }

    createQueue() {
        return async.queue(async (task, callback) => {
            try {
                await this.assertSession(task.lid) // Calls the assertSession method with the class context
                //callback(); // Indicates that the task has been completed
            } catch (error) {
                console.error(`Error processing ${task.lid}:`, error)
                //callback(error); // Passes the error to the callback
            }
        }, 1)
    }

    async geraThumb(videoPath) {
        const name = uuidv4()
        const tempDir = 'temp'
        const thumbPath = 'temp/' + name + 'thumb.png'

        const base64Regex =
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
        const base64 = base64Regex.test(videoPath)

        try {
            let videoBuffer
            let videoTempPath

            if (videoPath.startsWith('http')) {
                const response = await axios.get(videoPath, {
                    responseType: 'arraybuffer',
                })
                videoTempPath = path.join(tempDir, name + '.mp4')
                videoBuffer = Buffer.from(response.data)
                await fs.writeFile(videoTempPath, videoBuffer)
            } else if (base64 === true) {
                videoTempPath = path.join(tempDir, 'temp/' + name + '.mp4')
                const buffer = Buffer.from(videoPath, 'base64')
                await fs.writeFile(videoTempPath, buffer)
            } else {
                videoTempPath = videoPath
            }

            const command = `${ffmpegPath.path} -i ${videoTempPath} -ss 00:00:01 -vframes 1 ${thumbPath}`
            await new Promise((resolve, reject) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve()
                    }
                })
            })

            const thumbContent = await fs.readFile(thumbPath, {
                encoding: 'base64',
            })

            await Promise.all([fs.unlink(videoTempPath), fs.unlink(thumbPath)])

            return thumbContent
        } catch (error) {
            logger.error(error)
        }
    }

    async thumbURL(url) {
        const videoUrl = url
        try {
            const thumbContentFromUrl = await this.geraThumb(videoUrl)
            return thumbContentFromUrl
        } catch (error) {
            logger.error(error)
        }
    }

    async thumbBUFFER(buffer) {
        try {
            const thumbContentFromBuffer = await this.geraThumb(buffer)
            return thumbContentFromBuffer
        } catch (error) {
            logger.error(error)
        }
    }

    async thumbBase64(buffer) {
        try {
            const thumbContentFromBuffer = await this.geraThumb(buffer)
            return thumbContentFromBuffer
        } catch (error) {
            logger.error(error)
        }
    }

    async convertMP3(audioSource) {
        try {
            const return_mp3 = await this.mp3(audioSource)
            return return_mp3
        } catch (error) {
            logger.error(error)
        }
    }

    async mp3(audioSource) {
        const name = uuidv4()
        try {
            const mp3_temp = 'temp/' + name + '.mp3'
            const command = `${ffmpegPath.path} -i ${audioSource} -acodec libmp3lame -ab 128k ${mp3_temp}`
            await new Promise((resolve, reject) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve()
                    }
                })
            })

            const audioContent = await fs.readFile(mp3_temp, {
                encoding: 'base64',
            })

            await Promise.all([fs.unlink(mp3_temp), fs.unlink(audioSource)])

            return audioContent
        } catch (error) {
            logger.error(error)
        }
    }

    async convertToMP4(audioSource) {
        const name = uuidv4()
        let audioBuffer
        if (Buffer.isBuffer(audioSource)) {
            audioBuffer = audioSource
        } else if (audioSource.startsWith('http')) {
            const response = await fetch(audioSource)
            audioBuffer = await response.buffer()
        } else if (audioSource.startsWith('data:audio')) {
            const base64DataIndex = audioSource.indexOf(',')
            if (base64DataIndex !== -1) {
                const base64Data = audioSource.slice(base64DataIndex + 1)
                audioBuffer = Buffer.from(base64Data, 'base64')
            }
        } else {
            audioBuffer = audioSource
        }

        const tempOutputFile = `temp/temp_output_${name}.opus`
        const mp3_temp = 'temp/' + name + '.mp3'

        const ffmpegCommand = `${ffmpegPath.path} -i "${mp3_temp}" -c:a libopus -b:a 128k -ac 1 "${tempOutputFile}"`

        await fs.writeFile(mp3_temp, Buffer.from(audioBuffer))

        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error, stdout, stderr) => {
                if (error) {
                    reject(error)
                } else {
                    resolve()
                }
            })
        })

        fs.unlink(mp3_temp)

        return tempOutputFile
    }

    async convertTovideoMP4(videoSource) {
        const name = uuidv4()
        let videoBuffer

        if (Buffer.isBuffer(videoSource)) {
            videoBuffer = videoSource
        } else if (videoSource.startsWith('http')) {
            const response = await fetch(videoSource)
            videoBuffer = await response.buffer()
        } else if (videoSource.startsWith('data:video')) {
            const base64DataIndex = videoSource.indexOf(',')
            if (base64DataIndex !== -1) {
                const base64Data = videoSource.slice(base64DataIndex + 1)
                videoBuffer = Buffer.from(base64Data, 'base64')
            }
        } else {
            videoBuffer = videoSource
        }

        const tempOutputFile = `temp/temp_output_${name}.mp4`
        const mp4 = 'temp/' + name + '.mp4'

        const ffmpegCommand = `${ffmpegPath.path} -i "${mp4}" -c:v libx264 -c:a aac -strict experimental -b:a 192k -movflags faststart -f mp4 "${tempOutputFile}"`

        await fs.writeFile(mp4, Buffer.from(videoBuffer))

        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error, stdout, stderr) => {
                if (error) {
                    reject(error)
                } else {
                    resolve()
                }
            })
        })

        fs.unlink(mp4)

        return tempOutputFile
    }

    async getMimeTypeFromBase64(base64String) {
        return new Promise((resolve, reject) => {
            try {
                const header = base64String.substring(
                    0,
                    base64String.indexOf(',')
                )
                const match = header.match(
                    /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/
                )

                if (match && match[1]) {
                    resolve(match[1])
                } else {
                    reject(new Error('MIME type could not be determined.'))
                }
            } catch (error) {
                reject(error)
            }
        })
    }

    async getBufferFromMP4File(filePath) {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(data)
                }
            })
        })
    }

    async getFileNameFromUrl(url) {
        try {
            const pathArray = new URL(url).pathname.split('/')
            const name = pathArray[pathArray.length - 1]
            if (name && name !== '') return name
        } catch (e) {
            // ignore
        }
        try {
            const file = await axios.head(url)
            if (file.headers['content-disposition']) {
                const match = file.headers['content-disposition'].match(/filename="?([^";\n]+)"?/i)
                if (match) return match[1]
            }
        } catch (e) {
            // ignore
        }
        return 'file_' + Date.now()
    }

    async dataBase() {
        return await useMultiFileAuthState('db/' + this.key)
    }

    async SendWebhook(type, hook, body, key) {
        if (this.instance.webhok === false) {
            return
        } else {
            const webhook_url = this.instance.webhook_url
            const events = this.instance.webhook_events

            const hasMessagesSet = events.includes(hook)

            if (hasMessagesSet === true) {
                this.web = axios.create({
                    baseURL: this.instance.webhook_url,
                })
                this.web
                    .post('', {
                        type,
                        body,
                        instanceKey: key,
                    })
                    .catch((e) => { })
            }
        }
    }

    async instanceFind(key) {
        const filePath = path.join('db/sessions.json')

        const data = await fs.readFile(filePath, 'utf-8')
        if (data) {
            const sessions = JSON.parse(data)
            const existingSession = sessions.find(
                (session) => session.key === this.key
            )
            if (!existingSession) {
                const data = {
                    key: false,
                    browser: false,
                    webhook: false,
                    base64: false,
                    webhookUrl: false,
                    webhookEvents: false,
                    messagesRead: false,
                }
                return data
            } else {
                return existingSession
            }
        } else {
            const data = {
                key: false,
                browser: false,
                webhook: false,
                base64: false,
                webhookUrl: false,
                webhookEvents: false,
                messagesRead: false,
            }
            return data
        }
    }

    async init() {
        const ver = await fetchLatestBaileysVersion()
        // console.log(ver)
        const filePath = path.join('db/sessions.json')

        const data = await fs.readFile(filePath, 'utf-8')
        if (!data) {
            return
        }
        const sessions = JSON.parse(data)

        const existingSession = sessions.find(
            (session) => session.key === this.key
        )
        if (!existingSession) {
            return
        }

        const { state, saveCreds } = await this.dataBase()
        this.authState = {
            state: state,
            saveCreds: saveCreds,
            keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        }

        let b
        let ignoreGroup

        if (existingSession) {
            b = {
                browser: {
                    platform: existingSession.browser,
                    browser: 'Chrome',
                    version: '20.0.04',
                },
            }
            ignoreGroup = existingSession.ignoreGroups
            this.instance.mark = existingSession.messagesRead
            this.instance.webhook = existingSession.webhook
            this.instance.webhook_url = existingSession.webhookUrl
            this.instance.webhook_events = existingSession.webhookEvents
            this.instance.base64 = existingSession.base64
            this.instance.incoming = existingSession.incoming || false
            this.instance.ignoreGroups = ignoreGroup
        } else {
            b = {
                browser: {
                    platform: 'Chrome (Linux)',
                    browser: 'chrome',
                    version: '22.5.0',
                },
            }
            ignoreGroup = false
            this.instance.mark = false
            this.instance.webhook = false
            this.instance.webhook_url = false
            this.instance.webhook_events = false
            this.instance.base64 = false
            this.instance.incoming = false
            this.instance.ignoreGroups = ignoreGroup
        }

        this.socketConfig.auth = {
            ...this.authState.state,
            keys: this.authState.keys,
        }
        if (ignoreGroup === true) {
            this.socketConfig.shouldIgnoreJid = (jid) => {
                const isGroupJid = isJidGroup(jid)
                const isBroadcast = isJidBroadcast(jid)
                const isNewsletter = jid.includes('newsletter')
                return isGroupJid || isBroadcast || isNewsletter
            }
        } else {
            this.socketConfig.shouldIgnoreJid = (jid) => {
                const isNewsletter = jid.includes('newsletter')
                const isBroadcast = isJidBroadcast(jid)
                return isBroadcast || isNewsletter
            }
        }
        this.socketConfig.version = [2, 3000, 1035194821]
        this.socketConfig.browser = Object.values(b.browser)
        this.socketConfig.emitOwnEvents = true
        this.instance.sock = makeWASocket(this.socketConfig)
        this.setHandler()
        this.store.bind(this.instance.sock?.ev)
        return this
    }

    setHandler() {
        const sock = this.instance.sock

        sock?.ev.on('creds.update', this.authState.saveCreds)

        sock?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update
            const status = lastDisconnect?.error?.output?.statusCode

            if (connection === 'connecting') return

            if (connection === 'close') {
                if (this.instance._manualDisconnect) {
                    this.instance._manualDisconnect = false
                    this.instance.sock = null
                    this.instance.online = false
                    this.instance.qr = null
                    try {
                        await fs.unlink(path.join('db', this.key, 'creds.json'))
                    } catch (_) {}
                    try {
                        await fs.unlink(path.join('db', this.key, 'app-state-sync-version.json'))
                    } catch (_) {}
                    return
                }
                if (
                    status === DisconnectReason.loggedOut ||
                    status === 405 ||
                    status === 402 ||
                    status === 403
                ) {
                    try {
                        await fs.unlink(path.join('db', this.key, 'creds.json'))
                    } catch (_) {}
                    try {
                        await fs.unlink(path.join('db', this.key, 'app-state-sync-version.json'))
                    } catch (_) {}
                    this.instance.online = false
                    this.instance.sock = null
                    return
                } else if (status === 440) {
                    return
                } else {
                    await this.init()
                }

                await this.SendWebhook(
                    'connection',
                    'connection.update',
                    {
                        connection: connection,
                        connection_code:
                            lastDisconnect?.error?.output?.statusCode,
                    },
                    this.key
                )
            } else if (connection === 'open') {
                this.instance.online = true
                this.instance.qr = null
                await this.SendWebhook(
                    'connection',
                    'connection.update',
                    {
                        connection: connection,
                    },
                    this.key
                )

            }

            if (qr) {
                QRCode.toDataURL(qr).then((url) => {
                    this.instance.qr = url
                })
                await this.SendWebhook(
                    'qrCode',
                    'qrCode.update',
                    {
                        qr: qr,
                    },
                    this.key
                )
            }
        })

        sock?.ev.on('presence.update', async (json) => {
            await this.SendWebhook(
                'presence',
                'presence.update',
                json,
                this.key
            )
        })

        sock?.ev.on('contacts.upsert', async (contacts) => {
            let folderPath
            let filePath
            try {
                const folderPath = 'db/' + this.key

                const filePath = path.join(folderPath, 'contacts.json')
                await fs.access(folderPath)

                const currentContent = await fs.readFile(filePath, 'utf-8')
                const existingContacts = JSON.parse(currentContent)

                contacts.forEach((contact) => {
                    const existingContactIndex = existingContacts.findIndex(
                        (c) => c.id === contact.id
                    )

                    if (existingContactIndex !== -1) {
                        existingContacts[existingContactIndex] = contact
                    } else {
                        existingContacts.push(contact)
                    }
                })

                await fs.writeFile(
                    filePath,
                    JSON.stringify(existingContacts, null, 2),
                    'utf-8'
                )

                await this.SendWebhook(
                    'contacts',
                    'contacts.upsert',
                    contacts,
                    this.key
                )
            } catch (error) {
                const folderPath = 'db/' + this.key

                const filePath = path.join(folderPath, 'contacts.json')
                await fs.mkdir(folderPath, { recursive: true })
                await fs.writeFile(
                    filePath,
                    JSON.stringify(contacts, null, 2),
                    'utf-8'
                )
            }
        })

        sock?.ev.on('chats.upsert', async (newChat) => {
            try {
                await this.SendWebhook(
                    'chats',
                    'chats.upsert',
                    newChat,
                    this.key
                )
            } catch (e) {
                return
            }
        })

        sock?.ev.on('chats.delete', async (deletedChats) => {
            try {
                await this.SendWebhook(
                    'chats',
                    'chats.delete',
                    deletedChats,
                    this.key
                )
            } catch (e) {
                return
            }
        })

        sock?.ev.on('messages.update', async (m) => {
            try {
                await this.SendWebhook(
                    'updateMessage',
                    'messages.update',
                    m,
                    this.key
                )
            } catch (e) {
                return
            }
        })

        // on new mssage
        sock?.ev.on('messages.upsert', async (m) => {
            if (m.type === 'prepend')
                this.instance.messages.unshift(...m.messages)
            if (m.type !== 'notify') return

            this.instance.messages.unshift(...m.messages)

            m.messages.map(async (msg) => {
                if (!msg.message) return

                if (this.instance.mark === true) {
                    try {
                        await this.readMessageById(
                            msg.key.id,
                            msg.key.remoteJid
                        )
                    } catch (e) {
                        //console.log(e)
                    }
                }

                const messageType = Object.keys(msg.message)[0]
                if (
                    [
                        'protocolMessage',
                        'senderKeyDistributionMessage',
                    ].includes(messageType)
                )
                    return

                if (this.instance.incoming === true) {
                    try {
                        const { appendLog } = require('../helper/messageLogger')
                        const msgText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || JSON.stringify(msg.message)
                        appendLog({
                            _logId: msg.key.id,
                            instanceKey: this.key,
                            direction: 'incoming',
                            type: messageType,
                            to: (msg.key.remoteJid || '').split('@')[0],
                            text: typeof msgText === 'string' ? msgText : messageType,
                            status: 'received',
                            method: 'INCOMING',
                        })
                    } catch (_) {}
                }

                if (this.instance.webhook === true) {
                    try {
                        const webhookData = {
                            key: this.key,
                            ...msg,
                        }

                        if (messageType === 'conversation') {
                            webhookData['text'] = m
                        }

                        if (this.instance.base64 === true) {
                            switch (messageType) {
                                case 'imageMessage':
                                    webhookData['msgContent'] =
                                        await downloadMessage(
                                            msg.message.imageMessage,
                                            'image'
                                        )
                                    break
                                case 'videoMessage':
                                    webhookData['msgContent'] =
                                        await downloadMessage(
                                            msg.message.videoMessage,
                                            'video'
                                        )

                                    //webhookData['msgContent'] = await fs.readFile(arquivo_video, {
                                    //encoding: 'base64',
                                    //});

                                    //webhookData['thumb'] = await this.thumbBase64(arquivo_video);

                                    break
                                case 'audioMessage':
                                    if (
                                        process.env.DEFAULT_AUDIO_OUTPUT &&
                                        process.env.DEFAULT_AUDIO_OUTPUT ===
                                        'MP3'
                                    ) {
                                        const arquivo_audio =
                                            await downloadMessage(
                                                msg.message.audioMessage,
                                                'audio'
                                            )
                                        const buffer = Buffer.from(
                                            arquivo_audio,
                                            'base64'
                                        )
                                        const name = 'temp/' + uuidv4() + '.ogg'
                                        await fs.writeFile(name, buffer)

                                        const convert = await this.mp3(name)

                                        webhookData['msgContent'] = convert
                                    } else {
                                        webhookData['msgContent'] =
                                            await downloadMessage(
                                                msg.message.audioMessage,
                                                'audio'
                                            )
                                    }
                                    break
                                case 'documentMessage':
                                    webhookData['msgContent'] =
                                        await downloadMessage(
                                            msg.message.documentMessage,
                                            'document'
                                        )
                                    break
                                default:
                                    webhookData['msgContent'] = ''
                                    break
                            }
                        }

                        await this.SendWebhook(
                            'message',
                            'messages.upsert',
                            webhookData,
                            this.key
                        )
                    } catch (e) {
                        logger.error('Webhook send failed')
                    }
                }
            })
        })

        sock?.ws.on('CB:call', async (data) => {
            try {
                if (data.content) {
                    if (data.content.find((e) => e.tag === 'offer')) {
                        const content = data.content.find(
                            (e) => e.tag === 'offer'
                        )

                        await this.SendWebhook(
                            'call_offer',
                            'call.events',
                            {
                                id: content.attrs['call-id'],
                                timestamp: parseInt(data.attrs.t),
                                user: {
                                    id: data.attrs.from,
                                    platform: data.attrs.platform,
                                    platform_version: data.attrs.version,
                                },
                            },
                            this.key
                        )
                    } else if (
                        data.content.find((e) => e.tag === 'terminate')
                    ) {
                        const content = data.content.find(
                            (e) => e.tag === 'terminate'
                        )

                        await this.SendWebhook(
                            'call',
                            'call.events',
                            {
                                id: content.attrs['call-id'],
                                user: {
                                    id: data.attrs.from,
                                },
                                timestamp: parseInt(data.attrs.t),
                                reason: data.content[0].attrs.reason,
                            },
                            this.key
                        )
                    }
                }
            } catch (e) {
                return
            }
        })

        sock?.ev.on('groups.upsert', async (groupUpsert) => {
            try {
                await this.SendWebhook(
                    'updateGroups',
                    'groups.upsert',
                    {
                        data: groupUpsert,
                    },
                    this.key
                )
                await this.updateGroupData()
                GroupsMetaDataCache.flushAll()
            } catch (e) {
                return
            }
        })

        sock?.ev.on('groups.update', async (groupUpdate) => {
            try {
                await this.SendWebhook(
                    'updateGroups',
                    'groups.update',
                    {
                        data: groupUpdate,
                    },
                    this.key
                )
                await this.updateGroupData()
                GroupsMetaDataCache.flushAll()
            } catch (e) {
                return
            }
        })

        sock?.ev.on('group-participants.update', async (groupParticipants) => {
            try {
                await this.SendWebhook(
                    'group-participants',
                    'group-participants.update',
                    {
                        data: groupParticipants,
                    },
                    this.key
                )
                await this.updateGroupData()
                GroupsMetaDataCache.flushAll()
            } catch (e) {
                return
            }
        })
    }

    async deleteInstance(key) {
        const filePath = path.join('db/sessions.json')

        let data = await fs.readFile(filePath, 'utf-8')
        let sessions = JSON.parse(data)
        let existingSession = sessions.find((session) => session.key === key)

        if (existingSession) {
            let updatedSessions = sessions.filter(
                (session) => session.key !== key
            )

            try {
                let salvar = await fs.writeFile(
                    filePath,
                    JSON.stringify(updatedSessions, null, 2),
                    'utf-8'
                )
            } catch (error) {
                logger.error('error saving')
            }

            if (this.instance.online == true) {
                this.instance.deleted = true
                await this.instance.sock?.logout()
            } else {
                await this.deleteFolder('db/' + this.key)
            }
        } else {
            return {
                error: true,
                message: 'Session not found',
            }
        }
    }

    async getInstanceDetail(key) {
        let connect = this.instance?.online

        if (connect !== true) {
            connect = false
        }
        const sessionData = await this.instanceFind(key)
        return {
            instance_key: key,
            phone_connected: connect,
            browser: sessionData.browser,
            webhook: sessionData.webhook,
            base64: sessionData.base64,
            webhookUrl: sessionData.webhookUrl,
            webhookEvents: sessionData.webhookEvents,
            messagesRead: sessionData.messagesRead,
            ignoreGroups: sessionData.ignoreGroups,
            incoming: sessionData.incoming,
            user: this.instance?.online ? this.instance.sock?.user : {},
        }
    }
    getWhatsappCode(id) {
        if (id.startsWith('55')) {
            const numberWithoutCountryCode = id.slice(2)
            const areaCode = numberWithoutCountryCode.slice(0, 2)
            let numberPart

            const atIndex = numberWithoutCountryCode.indexOf('@')

            if (atIndex >= 1) {
                numberPart = numberWithoutCountryCode.slice(0, atIndex)
            } else {
                numberPart = numberWithoutCountryCode
            }

            const lengthWithoutAreaCode = numberPart.slice(2).length

            if (lengthWithoutAreaCode < 8) {
                throw new Error('no account exists!')
            } else if (lengthWithoutAreaCode > 9) {
                throw new Error('no account exists.')
            } else if (parseInt(areaCode) <= 27 && lengthWithoutAreaCode < 9) {
                let newNumber = numberPart.substring(0, 2) + '9' + numberPart.substring(2)
                id = '55' + newNumber
            } else if (parseInt(areaCode) > 27 && lengthWithoutAreaCode > 8) {
                let newNumber = numberPart.substring(0, 2) + numberPart.substring(3)
                id = '55' + newNumber
            }

            return id
        } else {
            return id
        }
    }
    getWhatsAppId(id) {
        id = id.replace(/\D/g, '')
        if (id.includes('@g.us') || id.includes('@s.whatsapp.net')) return id
        return id.includes('-') ? `${id}@g.us` : `${id}@s.whatsapp.net`
    }

    getGroupId(id) {
        if (id.includes('@g.us') || id.includes('@g.us')) return id
        return id.includes('-') ? `${id}@g.us` : `${id}@g.us`
    }

    async deleteFolder(folder) {
        try {
            const folderPath = await path.join(folder)

            const folderExists = await fs
                .access(folderPath)
                .then(() => true)
                .catch(() => false)

            if (folderExists) {
                const files = await fs.readdir(folderPath)

                for (const file of files) {
                    const filePath = await path.join(folderPath, file)
                    await fs.unlink(filePath)
                }

                await fs.rmdir(folderPath)
                return
            }
        } catch (e) {
            return
        }
    }

    async readMessageById(idMessage, to) {
        try {
            const msg = await this.getMessage(idMessage, to)
            if (msg) {
                await this.instance.sock?.readMessages([msg.key])
            }
        } catch (e) {
            //logger.error(e)
        }
    }

    async verifyId(id) {
        const cachedResult = await this.verifyCache(id)
        if (cachedResult) {
            return cachedResult.jid
        } else {
            try {
                const sock = this.instance.sock
                if (!sock) throw new Error('Socket not connected')
                const [result] = await sock.onWhatsApp(id)

                if (result.exists) {
                    await this.salvaCache(id, result)
                    return result.jid
                } else {
                    throw new Error(
                        'The number:' + id + ' is not a valid WhatsApp'
                    )
                }
            } catch (error) {
                throw new Error('The number:' + id + ' is not a valid WhatsApp')
            }
        }
    }

    async verifyCache(id) {
        const cachedItem = cache.get(id)

        if (cachedItem) {
            return cachedItem
        } else {
            return null
        }
    }

    async salvaCache(id, result) {
        cache.set(id, result)
    }

    async sendTextMessage(data) {
        return await this.runInMessageQueue(async () => {
            let to = data.id

            if (data.typeId === 'user') {
                to = await this.verifyId(to)
            } else {
                await this.verifyGroup(to)
            }
            if (data.options && data.options.delay && data.options.delay > 0) {
                await this.setStatus(
                    'composing',
                    to,
                    data.typeId,
                    data.options.delay
                )
            }

            let mentions = false

            if (
                data.typeId === 'group' &&
                data.groupOptions &&
                data.groupOptions.markUser
            ) {
                if (data.groupOptions.markUser === 'ghostMention') {
                    const metadata = await this.groupidinfo(to)
                    mentions = metadata.participants.map(
                        (participant) => participant.id
                    )
                } else {
                    mentions = this.parseParticipants(data.groupOptions.markUser)
                }
            }

            let quoted = { quoted: null }
            let cache = { useCachedGroupMetadata: false }
            if (data.typeId === 'group') {
                const metadata = await this.groupidinfo(to)
                const meta = metadata.participants.map(
                    (participant) => participant.id
                )
                cache = { useCachedGroupMetadata: meta }
            }

            if (data.options && data.options.replyFrom) {
                const msg = await this.getMessage(data.options.replyFrom, to)

                if (msg) {
                    quoted = { quoted: msg }
                }
            }

            const send = await this.instance.sock?.sendMessage(
                to,
                {
                    text: data.message,
                    mentions,
                },
                quoted,
                cache
            )
            return send
        })
    }

    async assertSessions(group) {
        logger.info('Group processing ' + group + ' Started')
        if (GroupsMetaDataCache.get('assert' + group + this.key)) {
            return
        } else {
            ////this.queue.push({ group }, (err) => {
            //if (err) {
            // console.error(`Error processing ${group}:`, err);
            //} else {
            //GroupsMetaDataCache.set('assert'+group+this.key, true);
            //}
            //});
            //}
            const metadata = await this.groupidinfo(group)
            const phoneNumbers = metadata.participants.map(
                (participant) => participant.id
            )
            for (let i = phoneNumbers.length - 1; i >= 0; i--) {
                const lid = phoneNumbers[i]
                this.queue.push({ lid }, (err) => {
                    if (err) {
                        //console.error(`Error processing ${lid}:`, err);
                    } else {
                        //console.log(`Processing of ${lid} completed.`);
                    }
                })
                //}
            }
            GroupsMetaDataCache.set('assert' + group + this.key, true)
        }
    }

    async assertAll() {
        try {
            const result = await this.groupFetchAllParticipating()
            for (const key in result) {
                if (result[key].size > 300) {
                    this.assertSessions(result[key].id)
                }
            }
        } catch (e) {
            logger.error(e)
        }
    }

    async assertSession(lid) {
        try {
            //const metadados = await this.groupidinfo(group);
            //const phoneNumbers = metadados.participants.map((participant) => participant.id);

            const devices = []
            const additionalDevices = await this.instance.sock?.getUSyncDevices(
                [lid],
                false,
                false
            )
            devices.push(...additionalDevices)

            const senderKeyJids = []
            for (const { user, device } of devices) {
                const jid = jidEncode(
                    user,
                    isLid ? 'lid' : 's.whatsapp.net',
                    device
                )
                senderKeyJids.push(jid)
            }

            const assert =
                await this.instance.sock?.assertSessions(senderKeyJids)
            //console.log(`Session confirmed for ${lid}`);
        } catch (error) {
            //logger.error(error)
        }
    }

    async getMessage(idMessage, to) {
        try {
            const user_instance = this.instance.sock?.user.id
            const user = this.getWhatsAppId(user_instance.split(':')[0])
            const msg = await this.store.loadMessage(to, idMessage)
            return msg
        } catch (error) {
            return false
        }
    }

    async sendMediaFile(data, origem) {
        return await this.runInMessageQueue(async () => {
            let to = data.id

        if (data.typeId === 'user') {
            to = await this.verifyId(to)
        } else {
            await this.verifyGroup(to)
        }

        let caption = ''
        if (data.options && data.options.caption) {
            caption = data.options.caption
        }

        let mentions = false

        if (
            data.typeId === 'group' &&
            data.groupOptions &&
            data.groupOptions.markUser
        ) {
            if (data.groupOptions.markUser === 'ghostMention') {
                const metadata = await this.groupidinfo(to)
                mentions = metadata.participants.map(
                    (participant) => participant.id
                )
            } else {
                mentions = this.parseParticipants(data.groupOptions.markUser)
            }
        }

        let quoted = { quoted: null }
        let cache = { useCachedGroupMetadata: false }
        if (data.typeId === 'group') {
            const metadata = await this.groupidinfo(to)
            const meta = metadata.participants.map(
                (participant) => participant.id
            )
            cache = { useCachedGroupMetadata: meta }
        }

        if (data.options && data.options.replyFrom) {
            const msg = await this.getMessage(data.options.replyFrom, to)

            if (msg) {
                quoted = { quoted: msg }
            }
        }

        const acepty = ['audio', 'document', 'video', 'image']

        if (!acepty.includes(data.type)) {
            throw new Error('Invalid file')
        }

        const origin = ['url', 'base64', 'file']
        if (!origin.includes(origem)) {
            throw new Error('Invalid sending method')
        }

        let type = false
        let mimetype = false
        let filename = false
        let file = false
        let audio = false
        let document = false
        let video = false
        let image = false
        let thumb = false
        let send

        let myArray
        if (data.type === 'image') {
            myArray = config.imageMimeTypes
        } else if (data.type === 'video') {
            myArray = config.videoMimeTypes
        } else if (data.type === 'audio') {
            myArray = config.audioMimeTypes
        } else {
            myArray = config.documentMimeTypes
        }

        if (origem === 'url') {
            const parsedUrl = new URL(data.url)
            if (
                parsedUrl.protocol === 'http:' ||
                parsedUrl.protocol === 'https:'
            ) {
                mimetype = await this.GetFileMime(data.url)

                if (!myArray.includes(mimetype.trim())) {
                    throw new Error(
                        'File ' +
                        mimetype +
                        ' is not allowed for ' +
                        data.type
                    )
                }

                origem = data.url
            }
        } else if (origem === 'base64') {
            if (!data.filename || data.filename === '') {
                throw new Error('File name is required')
            }

            mimetype = getMIMEType.lookup(data.filename)

            if (!myArray.includes(mimetype.trim())) {
                throw new Error(
                    'File ' + mimetype + ' is not allowed for ' + data.type
                )
            }
        }

        if (data.options && data.options.delay && data.options.delay > 0) {
            const presence = data.type === 'audio' ? 'recording' : 'typing'
            await this.instance.sock?.sendPresenceUpdate(presence, to)
            await delay(data.options.delay * 1000)
        }

        if (data.type === 'audio') {
            if (mimetype === 'audio/ogg') {
                type = {
                    url: data.url,
                }
                mimetype = 'audio/mp4'
                filename = await this.getFileNameFromUrl(data.url)
            } else {
                audio = await this.convertToMP4(origem)
                mimetype = 'audio/mp4'
                type = await fs.readFile(audio)
            }
        } else if (data.type === 'video') {
            if (mimetype === 'video/mp4') {
                type = {
                    url: data.url,
                }
                thumb = await this.thumbURL(data.url)
                filename = await this.getFileNameFromUrl(data.url)
            } else {
                video = await this.convertTovideoMP4(origem)
                mimetype = 'video/mp4'
                type = await fs.readFile(video)
                thumb = await this.thumbBUFFER(video)
            }
        } else {
            if (!data.base64string) {
                type = {
                    url: data.url,
                }

                filename = await this.getFileNameFromUrl(data.url)
            } else {
                const buffer = Buffer.from(data.base64string, 'base64')

                filename = data.filename
                const file = path.join('temp/', filename)

                const join = await fs.writeFile(file, buffer)
                type = await fs.readFile('temp/' + filename)
            }
        }

        send = await this.instance.sock?.sendMessage(
            to,
            {
                mimetype: mimetype,
                [data.type]: type,
                caption: caption,
                ptt: data.type === 'audio' ? true : false,
                fileName: filename ? filename : file.originalname,
                mentions,
            },
            quoted,
            cache
        )

        if (
            data.type === 'audio' ||
            data.type === 'video' ||
            data.type == 'document'
        ) {
            if (data.type === 'video') {
                const ms = JSON.parse(JSON.stringify(send))
                ms.message.videoMessage.thumb = thumb
                send = ms
            }

            try {
                const files = await fs.readdir('temp/')
                await Promise.all(
                    files.map(async (file) => {
                        try {
                            const filePath = path.join('temp/', file)
                            await fs.unlink(filePath)
                        } catch (e) { /* skip locked */ }
                    })
                )
            } catch (e) { /* temp dir may not exist */ }
        }

            return send
        })
    }

    async GetFileMime(arquivo) {
        try {
            const file = await axios.head(arquivo)
            const ct = file.headers['content-type']
            if (ct && ct !== 'application/octet-stream') return ct
            if (file.headers['content-disposition']) {
                const match = file.headers['content-disposition'].match(/filename="?([^";\n]+)"?/i)
                if (match) {
                    const ext = match[1].split('.').pop()
                    if (ext) {
                        const m = getMIMEType.lookup(ext)
                        if (m) return m
                    }
                }
            }
        } catch (e) {
            // fallback to GET if HEAD not allowed
        }
        try {
            const file = await axios.get(arquivo, { responseType: 'stream', maxRedirects: 5 })
            const ct = file.headers['content-type']
            file.data?.destroy?.()
            if (ct && ct !== 'application/octet-stream') return ct
            if (file.headers['content-disposition']) {
                const match = file.headers['content-disposition'].match(/filename="?([^";\n]+)"?/i)
                if (match) {
                    const ext = match[1].split('.').pop()
                    if (ext) {
                        const m = getMIMEType.lookup(ext)
                        if (m) return m
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        try {
            const ext = arquivo.split('?')[0].split('/').pop()?.split('.').pop()
            if (ext) {
                const m = getMIMEType.lookup(ext)
                if (m) return m
            }
        } catch (e) {
            // ignore
        }
        throw new Error('Invalid file - unable to fetch MIME type')
    }

    async sendMedia(
        to,
        userType,
        file,
        type,
        caption = '',
        replyFrom = false,
        d = false
    ) {
        return await this.runInMessageQueue(async () => {
            if (userType === 'user') {
                to = await this.verifyId(to)
            } else {
                await this.verifyGroup(to)
            }

        const acepty = ['audio', 'document', 'video', 'image']

        let myArray
        if (type === 'image') {
            myArray = config.imageMimeTypes
        } else if (type === 'video') {
            myArray = config.videoMimeTypes
        } else if (type === 'audio') {
            myArray = config.audioMimeTypes
        } else {
            myArray = config.documentMimeTypes
        }

        if (!file || !file.mimetype) {
            throw new Error('No file uploaded or file has no MIME type')
        }

        const mime = file.mimetype

        if (!myArray.includes(mime.trim())) {
            throw new Error('File ' + mime + ' is not allowed for ' + type)
        }

        if (!acepty.includes(type)) {
            throw new Error('Type not valid')
        }

        let mimetype = false
        let filename = false
        let buferFile = false
        if (d > 0) {
            const presence = type === 'audio' ? 'recording' : 'typing'
            await this.instance.sock?.sendPresenceUpdate(presence, to)
            await delay(d * 1000)
        }
        if (type === 'audio') {

            if (mime === 'audio/ogg') {
                const filePath = file.originalname
                const extension = path.extname(filePath)

                mimetype = 'audio/mp4'
                filename = file.originalname
                buferFile = file.buffer
            } else {
                filename = uuidv4() + '.mp4'

                const audio = await this.convertToMP4(file.buffer)
                mimetype = 'audio/mp4'
                buferFile = await fs.readFile(audio)
            }
        } else if (type === 'video') {
            if (mime === 'video/mp4') {
                const filePath = file.originalname
                const extension = path.extname(filePath)

                mimetype = 'video/mp4'
                filename = file.originalname
                buferFile = file.buffer
            } else {
                filename = uuidv4() + '.mp4'

                const video = await this.convertTovideoMP4(file.buffer)
                mimetype = 'video/mp4'
                buferFile = await fs.readFile(video)
            }
        } else {
            const filePath = file.originalname
            const extension = path.extname(filePath)

            const mimetype = getMIMEType.lookup(extension)
            filename = file.originalname
            buferFile = file.buffer
        }

        let quoted = { quoted: null }
        if (replyFrom) {
            const msg = await this.getMessage(replyFrom, to)

            if (msg) {
                quoted = { quoted: msg }
            }
        }
        let cache = { useCachedGroupMetadata: false }
        if (userType === 'group') {
            const metadata = await this.groupidinfo(to)
            const meta = metadata.participants.map(
                (participant) => participant.id
            )
            cache = { useCachedGroupMetadata: meta }
        }

        const data = await this.instance.sock?.sendMessage(
            to,
            {
                [type]: buferFile,
                caption: caption,
                mimetype: mimetype,
                ptt: type === 'audio' ? true : false,
                fileName: filename,
            },
            quoted,
            cache
        )

        if (type === 'audio' || type === 'video') {
            try {
                const files = await fs.readdir('temp/')
                await Promise.all(
                    files.map(async (file) => {
                        try {
                            const filePath = path.join('temp/', file)
                            await fs.unlink(filePath)
                        } catch (e) { /* skip locked */ }
                    })
                )
            } catch (e) { /* temp dir may not exist */ }
        }

            return data
        })
    }

    async newbuffer(mp4) {
        try {
            const filePath = path.join('temp', mp4)
            const buffer = await fs.readFile(filePath)
            return buffer
        } catch (error) {
            throw new Error('Failed to read mp4 file')
        }
    }

    async criaFile(tipo, origem) {
        try {
            if (tipo == 'file') {
                const randomName = uuidv4()
                const fileExtension = path.extname(origem.originalname)
                const newFileName = `${randomName}${fileExtension}`

                await fs.writeFile('temp/' + newFileName, origem.buffer)
                return 'temp/' + newFileName
            }
        } catch (error) {
            throw new Error('Failed to convert MP4 file')
        }
    }

    async convertemp4(file, retorno) {
        return new Promise((resolve, reject) => {
            try {
                const tempAudioPath = file
                const output = 'temp/' + retorno
                const ffmpegCommand = `${ffmpegPath.path} -i "${tempAudioPath}" -vn -ab 128k -ar 44100 -f ipod "${output}" -y`

                exec(ffmpegCommand, (error, stdout, stderr) => {
                    if (error) {
                        reject({
                            error: true,
                            message: 'Failed to convert audio.',
                        })
                    } else {
                        resolve(retorno)
                    }
                })
            } catch (error) {
                reject(new Error('Failed to convert MP4 file'))
            }
        })
    }

    async DownloadProfile(of, group = false) {
        try {
            if (!group) {
                of = await this.verifyId(of)
            } else {
                await this.verifyGroup(of)
            }

            const ppUrl = await this.instance.sock?.profilePictureUrl(
                of,
                'image'
            )
            return ppUrl
        } catch (e) {
            return process.env.APP_URL + '/img/noimage.jpg'
        }
    }

    async getUserStatus(of) {
        of = await this.verifyId(of)
        const status = await this.instance.sock?.fetchStatus(of)
        return status
    }

    async contacts() {
        const folderPath = 'db/' + this.key
        const filePath = path.join(folderPath, 'contacts.json')
        try {
            await fs.access(folderPath)

            const currentContent = await fs.readFile(filePath, 'utf-8')
            const existingContacts = JSON.parse(currentContent)
            return {
                error: false,
                contacts: existingContacts,
            }
        } catch (error) {
            return {
                error: true,
                message: 'Contacts have not been loaded yet.',
            }
        }
    }

    async blockUnblock(to, data) {
        try {
            if (!data === 'block') {
                data = 'unblock'
            }

            to = await this.verifyId(to)
            const status = await this.instance.sock?.updateBlockStatus(to, data)
            return status
        } catch (e) {
            return {
                error: true,
                message: 'Failed to block/unblock',
            }
        }
    }

    async sendButtonMessage(to, data) {
        return await this.runInMessageQueue(async () => {
            to = await this.verifyId(to)
            const result = await this.instance.sock?.sendMessage(to, {
                templateButtons: processButton(data.buttons),
                text: data.text ?? '',
                footer: data.footerText ?? '',
                viewOnce: true,
            })
            return result
        })
    }

    async sendContactMessage(to, data) {
        return await this.runInMessageQueue(async () => {
            to = await this.verifyId(to)
            const vcard = generateVC(data)
            const result = await this.instance.sock?.sendMessage(to, {
                contacts: {
                    displayName: data.fullName,
                    contacts: [
                        {
                            displayName: data.fullName,
                            vcard,
                        },
                    ],
                },
            })
            return result
        })
    }

    async sendListMessage(to, type, options, groupOptions, data) {
        return await this.runInMessageQueue(async () => {
            if (type === 'user') {
                to = await this.verifyId(to)
            } else {
                await this.verifyGroup(to)
            }
            if (options && options.delay && options.delay > 0) {
                await this.setStatus('composing', to, type, options.delay)
            }

        let mentions = false

        if (type === 'group' && groupOptions && groupOptions.markUser) {
            if (groupOptions.markUser === 'ghostMention') {
                const metadata = await this.instance.sock?.groupMetadata(
                    this.getGroupId(to)
                )
                mentions = metadata.participants.map(
                    (participant) => participant.id
                )
            } else {
                mentions = this.parseParticipants(groupOptions.markUser)
            }
        }

        let quoted = {
            quoted: null,
        }

        if (options && options.replyFrom) {
            const msg = await this.getMessage(options.replyFrom, to)

            if (msg) {
                quoted = {
                    quoted: msg,
                }
            }
        }

        const msgList = {
            text: data.title,
            title: data.title,
            description: data.description,
            buttonText: data.buttonText,
            footerText: data.footerText,
            sections: data.sections,
            listType: 2,
        }

        let loggedInId = await this.getLoggedInId()
        const msgRes = generateWAMessageFromContent(
            to,
            {
                listMessage: msgList,
                mentions,
            },
            quoted,
            {
                idlogado: loggedInId,
            }
        )

        const result = await this.instance.sock?.relayMessage(
            to,
            msgRes.message,
            msgRes.key.id
        )

            return msgRes
        })
    }

    async sendMediaButtonMessage(to, data) {
        return await this.runInMessageQueue(async () => {
            to = await this.verifyId(to)

            const result = await this.instance.sock?.sendMessage(
                this.getWhatsAppId(to),
                {
                    [data.mediaType]: {
                        url: data.image,
                    },
                    footer: data.footerText ?? '',
                    caption: data.text,
                    templateButtons: processButton(data.buttons),
                    mimetype: data.mimeType,
                    viewOnce: true,
                }
            )
            return result
        })
    }

    async createJid(number) {
        if (!isNaN(number)) {
            const jid = `${number}@s.whatsapp.net`
            return jid
        } else {
            return number
        }
    }

    async setStatus(status, to, type, pause = false) {
        return await this.runInMessageQueue(async () => {
            try {
                if (type === 'user') {
                    to = await this.verifyId(to)
                } else {
                    await this.verifyGroup(to)
                }

                const result = await this.instance.sock?.sendPresenceUpdate(
                    status,
                    to
                )
                if (pause > 0) {
                    await delay(pause * 1000)
                    await this.instance.sock?.sendPresenceUpdate('paused', to)
                }
                return result
            } catch (e) {
                throw new Error(
                    'Failed to send presence, check the id and try again'
                )
            }
        })
    }

    async sendUrlMediaFile(id, mediaUrl, mediaType, mimetype, caption = '') {
        return await this.runInMessageQueue(async () => {
            let to = id
            const looksLikeGroup = typeof to === 'string' && (to.includes('@g.us') || to.includes('-'))
            if (looksLikeGroup) {
                await this.verifyGroup(this.getGroupId(to))
                to = this.getGroupId(to)
            } else {
                to = await this.verifyId(to)
            }

            const allowed = ['image', 'video', 'audio', 'document']
            if (!allowed.includes(mediaType)) {
                throw new Error('Invalid media type')
            }

            const resp = await axios.get(mediaUrl, { responseType: 'arraybuffer' })
            const buffer = Buffer.from(resp.data)
            const resolvedMime =
                mimetype || resp.headers?.['content-type'] || 'application/octet-stream'

            const msg = {}
            if (mediaType === 'document') {
                msg.document = buffer
                msg.mimetype = resolvedMime
                msg.fileName = 'file'
                if (caption) msg.caption = caption
            } else if (mediaType === 'audio') {
                msg.audio = buffer
                msg.mimetype = resolvedMime
            } else if (mediaType === 'video') {
                msg.video = buffer
                msg.mimetype = resolvedMime
                if (caption) msg.caption = caption
            } else if (mediaType === 'image') {
                msg.image = buffer
                msg.mimetype = resolvedMime
                if (caption) msg.caption = caption
            }

            return await this.instance.sock?.sendMessage(to, msg)
        })
    }

    async updateProfilePicture(to, url, type) {
        try {
            if (type === 'user') {
                to = await this.verifyId(this.getWhatsAppId(to))
            } else {
                await this.verifyGroup(to)
            }

            const img = await axios.get(url, {
                responseType: 'arraybuffer',
            })
            const res = await this.instance.sock?.updateProfilePicture(
                to,
                img.data
            )
            return {
                error: false,
                message: 'Photo changed successfully!',
            }
        } catch (e) {
            logger.error(e)
            return {
                error: true,
                message: 'Unable to update profile picture',
            }
        }
    }

    async mystatus(status) {
        try {
            const result = await this.instance.sock?.sendPresenceUpdate(status)
            return {
                error: false,
                message: 'Status changed to ' + status,
            }
        } catch (e) {
            return {
                error: true,
                message: 'Unable to change to status ' + status,
            }
        }
    }

    // get user or group object from db by id
    async getUserOrGroupById(id) {
        try {
            let Chats = await this.getChat()
            const group = Chats.find((c) => c.id === this.getWhatsAppId(id))
            if (!group)
                throw new Error(
                    'unable to get group, check if the group exists'
                )
            return group
        } catch (e) {
            logger.error(e)
            logger.error('Error get group failed')
        }
    }

    // Group Methods
    parseParticipants(users) {
        return users.map((users) => this.getWhatsAppId(users))
    }

    async updateDbGroupsParticipants() {
        try {
            let groups = await this.groupFetchAllParticipating()
            let Chats = await this.getChat()
            if (groups && Chats) {
                for (const [key, value] of Object.entries(groups)) {
                    let group = Chats.find((c) => c.id === value.id)
                    if (group) {
                        let participants = []
                        for (const [
                            key_participant,
                            participant,
                        ] of Object.entries(value.participants)) {
                            participants.push(participant)
                        }
                        group.participant = participants
                        if (value.creation) {
                            group.creation = value.creation
                        }
                        if (value.subjectOwner) {
                            group.subjectOwner = value.subjectOwner
                        }
                        Chats.filter((c) => c.id === value.id)[0] = group
                    }
                }
                await this.updateDb(Chats)
            }
        } catch (e) {
            logger.error(e)
            logger.error('Error updating groups failed')
        }
    }

    async createNewGroup(name, users) {
        try {
            const group = await this.instance.sock?.groupCreate(
                name,
                users.map(this.getWhatsAppId)
            )
            return group
        } catch (e) {
            return {
                error: true,
                message: 'Error creating group',
            }
        }
    }

    async groupFetchAllParticipating() {
        const cacheDir = 'db/' + this.key
        const cacheFile = path.join(cacheDir, 'groups.json')

        try {
            await fs.access(cacheFile)
            const data = await fs.readFile(cacheFile, 'utf-8')
            return JSON.parse(data)
        } catch (e) {
            try {
                await fs.access(cacheDir)
            } catch (e) {
                await fs.mkdir(cacheDir, { recursive: true })
            }
            const checkEvent = await GroupsCache.get(this.key)

            if (!checkEvent) {
                await GroupsCache.set(this.key, true)
            }

            const result =
                await this.instance.sock?.groupFetchAllParticipating()

            if (result && Object.keys(result).length > 0) {
                await fs.writeFile(cacheFile, JSON.stringify(result), 'utf-8')
            }

            return result
        }
    }

    async updateGroupData() {
        await delay(1000)

        if (!this.key) {
            return
        }

        const cacheDir = 'db/' + this.key
        const cacheFile = path.join(cacheDir, 'groups.json')

        let result

        try {
            const checkEvent = GroupsCache.get(this.key)

            if (checkEvent) {
                return false
            }

            result = await this.instance.sock?.groupFetchAllParticipating()

            try {
                await fs.access(cacheDir)
            } catch (e) {
                await fs.mkdir(cacheDir, { recursive: true })
            }

            if (result && Object.keys(result).length > 0) {
                await fs.writeFile(cacheFile, JSON.stringify(result), 'utf-8')
            }
        } catch (e) {
            // ignore
        } finally {
            GroupsCache.set(this.key, true)
        }

        return result
    }

    async verifyGroup(id) {
        try {
            if (GroupsMetaDataCache.get(id + this.key)) {
                return true
            }
            const result = await this.groupFetchAllParticipating()
            if (Object.prototype.hasOwnProperty.call(result, id)) {
                GroupsMetaDataCache.set(id + this.key, true)
                return true
            } else {
                throw new Error('Group does not exist')
            }
        } catch (error) {
            logger.error(error)

            throw new Error('Group does not exist')
        }
    }

    async addNewParticipant(id, users) {
        try {
            await this.verifyGroup(id)

            const res = await this.instance.sock?.groupParticipantsUpdate(
                this.getGroupId(id),
                users.map(this.getWhatsAppId),
                'add'
            )
            return res
        } catch {
            return {
                error: true,
                message:
                    'Unable to add participant, you must be an admin in this group',
            }
        }
    }

    async makeAdmin(id, users) {
        try {
            await this.verifyGroup(id)
            const res = await this.instance.sock?.groupParticipantsUpdate(
                this.getGroupId(id),
                users.map(this.getWhatsAppId),
                'promote'
            )
            return res
        } catch {
            return {
                error: true,
                message:
                    'Unable to add participant, you must be an admin in this group',
            }
        }
    }

    async removeuser(id, users) {
        try {
            await this.verifyGroup(id)

            const res = await this.instance.sock?.groupParticipantsUpdate(
                this.getGroupId(id),
                users.map(this.getWhatsAppId),
                'remove'
            )
            return res
        } catch {
            return {
                error: true,
                message:
                    'Unable to add participant, you must be an admin in this group',
            }
        }
    }

    async demoteAdmin(id, users) {
        try {
            await this.verifyGroup(id)

            const res = await this.instance.sock?.groupParticipantsUpdate(
                this.getGroupId(id),
                users.map(this.getWhatsAppId),
                'demote'
            )
        } catch {
            return {
                error: true,
                message:
                    'Unable to add participant, you must be an admin in this group',
            }
        }
    }

    async getLoggedInId() {
        const user_instance = this.instance.sock?.user.id
        const user = this.getWhatsAppId(user_instance.split(':')[0])
        return user
    }
    async joinURL(url) {
        try {
            const urlParts = url.split('/')
            const groupInviteCode = urlParts[urlParts.length - 1]

            const joinResult =
                await this.instance.sock?.groupAcceptInvite(groupInviteCode)
            await this.updateGroupData()
            GroupsMetaDataCache.flushAll()

            return joinResult
            //returnToGroup
        } catch (e) {
            return {
                error: true,
                message:
                    'Error entering via URL, check if the url is still valid or if the group is an open group.',
            }
        }
    }

    async leaveGroup(id) {
        try {
            await this.verifyGroup(id)
            await this.instance.sock?.groupLeave(id)

            return {
                error: false,
                message: 'Left the group.',
            }
        } catch (e) {
            return {
                error: true,
                message:
                    'Error leaving the group, check if the group still exists.',
            }
        }
    }

    async getInviteCodeGroup(id) {
        try {
            await this.verifyGroup(id)
            const convite = await this.instance.sock?.groupInviteCode(id)
            const url = 'https://chat.whatsapp.com/' + convite
            return url
        } catch (e) {
            return {
                error: true,
                message:
                    'Error verifying the group, check if the group still exists or if you are an administrator.',
            }
        }
    }

    async getInstanceInviteCodeGroup(id) {
        try {
            await this.verifyGroup(id)
            return await this.instance.sock?.groupInviteCode(id)
        } catch (e) {
            logger.error(e)
            logger.error('Error get invite group failed')
        }
    }

    async groupSettingUpdate(id, action) {
        try {
            await this.verifyGroup(id)
            const res = await this.instance.sock?.groupSettingUpdate(id, action)
            return {
                error: false,
                message: 'Change regarding ' + action + ' Completed',
            }
        } catch (e) {
            //console.log(e)
            return {
                error: true,
                message:
                    'Error changing' +
                    action +
                    ' Check if you have permission or if the group exists',
            }
        }
    }

    async groupUpdateSubject(id, subject) {
        try {
            await this.verifyGroup(id)
            const res = await this.instance.sock?.groupUpdateSubject(
                this.getWhatsAppId(id),
                subject
            )
            return {
                error: false,
                message: 'Group name changed to ' + subject,
            }
        } catch (e) {
            //console.log(e)
            return {
                error: true,
                message:
                    'Error changing group, check if you are an admin or if the group exists',
            }
        }
    }

    async groupUpdateDescription(id, description) {
        try {
            await this.verifyGroup(id)
            const res = await this.instance.sock?.groupUpdateDescription(
                id,
                description
            )
            //console.log(res)
            return {
                error: false,
                message: 'Group description changed to ' + description,
            }
        } catch (e) {
            return {
                error: true,
                message:
                    'Failed to change group description, check if you are an admin or if the group exists',
            }
        }
    }

    async groupGetInviteInfo(url) {
        try {
            const codeurl = url.split('/')

            const code = codeurl[codeurl.length - 1]

            const res = await this.instance.sock?.groupGetInviteInfo(code)

            return res
        } catch (e) {
            //console.log(e)
            return {
                error: true,
                message:
                    'Failed to get/verify group. Check the URL code or if the group still exists..',
            }
        }
    }

    async groupidinfo(id) {
        try {
            await this.verifyGroup(id)

            const result = await this.groupFetchAllParticipating()
            if (Object.prototype.hasOwnProperty.call(result, id)) {
                return result[id]
            } else {
                return {
                    error: true,
                    message: 'Group does not exist!',
                }
            }
        } catch (e) {
            return {
                error: true,
                message: 'Group does not exist',
            }
        }
    }

    async groupAcceptInvite(id) {
        try {
            const res = await this.instance.sock?.groupAcceptInvite(id)
            return res
        } catch (e) {
            //console.log(e)
            return {
                error: true,
                message: 'Failed to get/verify group. Check the URL code or if the group still exists..',
            }
        }
    }

    // update db document -> chat
    async updateDb(object) {
        // MongoDB not configured
    }

    async readMessage(msgObj) {
        try {
            const key = {
                remoteJid: msgObj.remoteJid,
                id: msgObj.id,
                participant: msgObj?.participant, // required when reading a msg from group
            }
            const res = await this.instance.sock?.readMessages([key])
            return res
        } catch (e) {
            logger.error('Error read message failed')
        }
    }

    async reactMessage(id, key, emoji) {
        return await this.runInMessageQueue(async () => {
            try {
                const reactionMessage = {
                    react: {
                        text: emoji, // use an empty string to remove the reaction
                        key: key,
                    },
                }
                const res = await this.instance.sock?.sendMessage(
                    this.getWhatsAppId(id),
                    reactionMessage
                )
                return res
            } catch (e) {
                logger.error('Error react message failed')
            }
        })
    }
}

exports.WhatsAppInstance = WhatsAppInstance
