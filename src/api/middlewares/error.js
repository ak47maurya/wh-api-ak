/* eslint-disable no-unused-vars */
const APIError = require('../../api/errors/api.error')

const handler = (err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500

    res.setHeader('Content-Type', 'application/json')
    res.status(statusCode)
    const body = {
        error: true,
        code: statusCode,
        message: err.isPublic ? err.message : 'Internal server error',
    }
    if (process.env.NODE_ENV !== 'production' && err.stack) {
        body.stack = err.stack.split('\n').map(s => s.trim())
    }
    res.json(body)
}

exports.handler = handler

exports.notFound = (req, res, next) => {
    const err = new APIError({
        message: 'Not found',
        status: 404,
    })
    return handler(err, req, res)
}
