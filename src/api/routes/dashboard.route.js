const express = require('express')
const controller = require('../controllers/dashboard.controller')

const router = express.Router()

router.get('/login', controller.loginPage)
router.post('/login', controller.login)
router.get('/logout', controller.logout)
router.post('/delete-log', controller.deleteLog)
router.get('/', controller.dashboard)

module.exports = router
