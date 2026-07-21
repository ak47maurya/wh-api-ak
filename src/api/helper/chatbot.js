const ChatbotRule = require('../models/ChatbotRule')

const rulesCache = {}

async function getReply(instanceKey, text) {
  if (!instanceKey || !text) return null

  if (!rulesCache[instanceKey]) {
    const rules = await ChatbotRule.find({ instanceKey, enabled: true }).lean()
    rulesCache[instanceKey] = rules
    setTimeout(() => delete rulesCache[instanceKey], 30000)
  }

  const lower = text.toLowerCase()
  for (const rule of rulesCache[instanceKey]) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) return rule.reply
    }
  }
  return null
}

function invalidateCache(instanceKey) {
  delete rulesCache[instanceKey]
}

module.exports = { getReply, invalidateCache }
