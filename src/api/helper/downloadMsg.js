const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid')
const logger = require('pino')()

module.exports = async function downloadMessage(msg, msgType) {
    let buffer = Buffer.from([])
    try {
        const stream = await downloadContentFromMessage(msg, msgType)
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
    } catch {
        logger.error('error downloading file-message')
        return ''
    }
	
    return buffer.toString('base64')
	}

