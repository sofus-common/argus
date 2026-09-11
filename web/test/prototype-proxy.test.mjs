import { test } from 'node:test'
import assert from 'node:assert/strict'
import config from '../vite.prototype.config.mjs'

test('prototype proxy translates only its exact local origin and preserves rejection signals', () => {
  const handlers = {}
  config.server.proxy['/api'].configure({ on: (event, handler) => { handlers[event] = handler } })
  for (const event of ['proxyReq', 'proxyReqWs']) {
    for (const origin of ['http://127.0.0.1:5174', 'https://evil.example', 'null', undefined]) {
      const headers = { origin, 'sec-fetch-site': 'cross-site' }
      const forwarded = { ...headers }
      handlers[event]({ setHeader: (key, value) => { forwarded[key] = value } }, { headers })
      assert.equal(forwarded.origin, origin === 'http://127.0.0.1:5174' ? 'http://127.0.0.1:5173' : origin)
      assert.equal(forwarded['sec-fetch-site'], 'cross-site')
    }
  }
})
