const express = require('express')
const controller = require('../controllers/rule.controller')
const tokenCheck = require('../middlewares/tokenCheck')
const { protectRoutes } = require('../../config/config')

const router = express.Router()
if (protectRoutes) {
  router.use(tokenCheck)
}

router.get('/list', controller.list)
router.post('/create', controller.create)
router.post('/update', controller.update)
router.post('/delete', controller.remove)

module.exports = router
