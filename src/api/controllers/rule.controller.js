const ChatbotRule = require('../models/ChatbotRule')
const { invalidateCache } = require('../helper/chatbot')

exports.list = async (req, res) => {
  const { instanceKey } = req.query
  if (!instanceKey) return res.json({ error: true, message: 'instanceKey required' })
  try {
    const rules = await ChatbotRule.find({ instanceKey }).sort({ createdAt: -1 }).lean()
    res.json({ error: false, rules })
  } catch (e) {
    res.json({ error: true, message: e.message })
  }
}

exports.create = async (req, res) => {
  const { instanceKey, keywords, reply } = req.body
  if (!instanceKey || !keywords || !reply) {
    return res.json({ error: true, message: 'instanceKey, keywords, reply required' })
  }
  try {
    const kwArray = Array.isArray(keywords) ? keywords : keywords.split(',').map(s => s.trim()).filter(Boolean)
    const rule = await ChatbotRule.create({ instanceKey, keywords: kwArray, reply })
    invalidateCache(instanceKey)
    res.json({ error: false, rule })
  } catch (e) {
    res.json({ error: true, message: e.message })
  }
}

exports.update = async (req, res) => {
  const { id, keywords, reply, enabled } = req.body
  if (!id) return res.json({ error: true, message: 'id required' })
  try {
    const update = {}
    if (keywords) {
      update.keywords = Array.isArray(keywords) ? keywords : keywords.split(',').map(s => s.trim()).filter(Boolean)
    }
    if (reply !== undefined) update.reply = reply
    if (enabled !== undefined) update.enabled = enabled
    const rule = await ChatbotRule.findByIdAndUpdate(id, { $set: update }, { new: true })
    if (rule) invalidateCache(rule.instanceKey)
    res.json({ error: !rule, rule })
  } catch (e) {
    res.json({ error: true, message: e.message })
  }
}

exports.remove = async (req, res) => {
  const { id } = req.body
  if (!id) return res.json({ error: true, message: 'id required' })
  try {
    const rule = await ChatbotRule.findByIdAndDelete(id)
    if (rule) invalidateCache(rule.instanceKey)
    res.json({ error: false, deleted: !!rule })
  } catch (e) {
    res.json({ error: true, message: e.message })
  }
}
