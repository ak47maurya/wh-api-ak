const express = require('express');
const router = express.Router();
const instanceRoutes = require('./instance.route');
const messageRoutes = require('./message.route');
const miscRoutes = require('./misc.route');
const groupRoutes = require('./group.route');
const dashboardRoutes = require('./dashboard.route');

router.get('/status', (req, res) => res.send('OK'));

const landingPage = (req, res) => {
  res.render('landing');
};
router.get('/', landingPage);

router.use('/dashboard', dashboardRoutes);
router.use('/instance', instanceRoutes);
router.use('/message', messageRoutes);
router.use('/group', groupRoutes);
router.use('/misc', miscRoutes);

module.exports = router;
