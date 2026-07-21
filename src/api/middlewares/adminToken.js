const config = require('../../config/config')

function adminToken(req, res, next) {
    const token = req.query.admintoken

    if (!token) {
        return res.status(403).send({
            error: true,
            message: 'admintoken was not provided in the query string',
        })
    }

    if (config.adminToken !== token) {
        return res
            .status(403)
            .send({ error: true, message: 'Invalid admin token' })
    }

    next()
}

module.exports = adminToken

