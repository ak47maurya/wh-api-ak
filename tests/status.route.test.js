const request = require('supertest')
const assert = require('assert')
const app = require('../src/server')
const { protectRoutes } = require('../src/config/config')

if (protectRoutes) {
    describe('Token authentication', () => {
        it('/status should return 200 without token (public healthcheck)', (done) => {
            request(app)
                .get('/status')
                .expect(200)
                .then((res) => {
                    assert.strictEqual(res.text, 'OK')
                    done()
                })
                .catch((err) => done(err))
        })

        it('protected route should fail with no bearer token', (done) => {
            request(app)
                .get('/instance/qr?key=test')
                .expect(403)
                .then((res) => {
                    assert(res.body.message, 'no bearer token header was present')
                    done()
                })
                .catch((err) => done(err))
        })

        it('protected route should fail with mismatched bearer token', (done) => {
            request(app)
                .get('/instance/qr?key=test')
                .set('Authorization', `Bearer ${process.env.TOKEN}wrong`)
                .expect(403)
                .then((res) => {
                    assert(res.body.message, 'invalid bearer token supplied')
                    done()
                })
                .catch((err) => done(err))
        })
    })
}
