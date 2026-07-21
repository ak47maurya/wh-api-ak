const express = require('express')
const path = require('path')
const cookieParser = require('cookie-parser')
const session = require('express-session')
const flash = require('connect-flash')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const exceptionHandler = require('express-exception-handler')
const error = require('../api/middlewares/error')

exceptionHandler.handle()

const app = express()

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://pps.whatsapp.net", "https://mmg.whatsapp.net", "https://web.whatsapp.net"],
    },
  },
}))

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many requests, please try later.' },
  skip: (req) => req.path.startsWith('/dashboard') || req.path === '/status',
})
app.use(limiter)

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser(process.env.COOKIE_SECRET))

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.HTTPS === 'true',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  }
}))

app.use(flash())

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '../api/views'))
app.use(express.static(path.join(__dirname, '../public')))

global.WhatsAppInstances = {}

const routes = require('../api/routes/')
app.use('/', routes)

app.use(error.notFound)
app.use(error.handler)

module.exports = app
