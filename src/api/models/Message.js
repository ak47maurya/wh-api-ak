const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema({
  _logId: { type: String, required: true, index: true },
  instanceKey: { type: String, required: true, index: true },
  direction: { type: String, enum: ['incoming', 'outgoing'], required: true },
  type: { type: String, default: '' },
  to: { type: String, default: '' },
  text: { type: String, default: '' },
  status: { type: String, default: 'received' },
  method: { type: String, default: '' },
  response: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now, index: true },
}, { strict: false })

messageSchema.index({ instanceKey: 1, timestamp: -1 })

module.exports = mongoose.model('Message', messageSchema)
