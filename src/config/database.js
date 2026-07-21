const mongoose = require('mongoose')
const logger = require('pino')()

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/whapi'

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URL)
    logger.info('MongoDB connected: ' + MONGO_URL)
  } catch (err) {
    logger.error('MongoDB connection error: ' + err.message)
    process.exit(1)
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected')
})

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error: ' + err.message)
})

module.exports = { connectDB, MONGO_URL }
