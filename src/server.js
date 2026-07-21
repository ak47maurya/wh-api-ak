const dotenv = require('dotenv')
const logger = require('pino')()
dotenv.config()

const REQUIRED_ENV_VARS = ['TOKEN', 'SESSION_SECRET', 'COOKIE_SECRET']
for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar] || process.env[envVar] === 'YOUR_TOKEN') {
        logger.error(`Missing required environment variable: ${envVar}`)
        process.exit(1)
    }
}

if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set — using in-memory message queue. Set REDIS_URL for production.')
}

const app = require('./config/express')
const config = require('./config/config')
const { connectDB } = require('./config/database')

const { Session } = require('./api/class/session')


let server


;(async () => {
  await connectDB()

server = app.listen(config.port, async () => {
    logger.info(`Listening on port ${config.port}`)
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`)
    logger.info(`Route protection: ${config.protectRoutes ? 'enabled' : 'disabled'}`)

    if (config.restoreSessionsOnStartup) {
        logger.info('Restoring sessions')
        const session = new Session()
        let restoreSessions = await session.restoreSessions()
        logger.info(`Sessions restored: ${restoreSessions.length}`)
    }
  })
})()

const exitHandler = () => {
    // close all WhatsApp socket connections gracefully
    if (global.WhatsAppInstances) {
        for (const key of Object.keys(global.WhatsAppInstances)) {
            try {
                global.WhatsAppInstances[key].instance?.sock?.end()
            } catch (_) {}
        }
    }
    if (server) {
        server.close(() => {
            logger.info('Server closed')
            process.exit(1)
        })
    } else {
        process.exit(1)
    }
}

const unexpectedErrorHandler = (error) => {
    logger.error(error)
    exitHandler()
}

process.on('uncaughtException', unexpectedErrorHandler)
process.on('unhandledRejection', unexpectedErrorHandler)

process.on('SIGTERM', () => {
    logger.info('SIGTERM received')
    if (server) {
        server.close()
    }
})

module.exports = server
