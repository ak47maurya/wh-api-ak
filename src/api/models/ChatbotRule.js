const mongoose = require('mongoose')

const ruleSchema = new mongoose.Schema({
  instanceKey: { type: String, required: true, index: true },
  keywords: { type: [String], required: true },
  reply: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
})

ruleSchema.index({ instanceKey: 1, enabled: 1 })

module.exports = mongoose.model('ChatbotRule', ruleSchema)
