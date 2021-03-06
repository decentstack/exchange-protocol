// SPDX-License-Identifier: GPL-3.0-or-later
const { Exchange } = require('./messages')
const NAME = 'exchange'

const VALUE_ENCODING_BUFFER = 0
const VALUE_ENCODING_JSON = 1
const VALUE_ENCODING_UTF8 = 2

class ExchangeExtension {
  constructor (handlers, opts = {}) {
    this.name = NAME
    this.encoding = Exchange
    this.requestTimeout = opts.requestTimeout || 15000
    this.handlers = {
      onmanifest (snapshot) {
        throw new Error('Unhandeled Manifest message')
      },
      onrequest (keys) {
        throw new Error('Unhandeled ReplicationRequest message')
      },
      onerror (e) { throw e /* Warning: error handler was not supplied! */ },
      ...handlers
    }

    // Manifest id counter
    this.__mctr = 0

    // namespaced arrays
    this.offeredKeys = {}
    this.requestedKeys = {}
    this.remoteOfferedKeys = {}

    this.pendingRequests = {}
  }

  onmessage (msg, peer) {
    try {
      if (msg.manifest) {
        const { manifest } = msg

        // Lazy init remote offer namespace
        this.remoteOfferedKeys[manifest.namespace] = this.remoteOfferedKeys[manifest.namespace] || {}

        manifest.feeds.forEach(feed => {
          // Register what remote offered.
          this.remoteOfferedKeys[manifest.namespace][feed.key.toString('hex')] = true

          feed.headers = feed.headers.reduce((lut, header) => {
            switch (header.valueEncoding) {
              case VALUE_ENCODING_UTF8:
                lut[header.key] = header.value.toString('utf8')
                break
              case VALUE_ENCODING_JSON:
                lut[header.key] = JSON.parse(header.value.toString('utf8'))
                break
              default:
              case VALUE_ENCODING_BUFFER:
                lut[header.key] = header.value
                break
            }
            return lut
          }, {})
        })

        const accept = keys => {
          return this.sendRequest(manifest.namespace, keys, manifest.id, peer)
        }
        process.nextTick(() => this.handlers.onmanifest(manifest, accept, peer))
      } else if (msg.req) {
        const req = msg.req

        // Fullfill any internal promises
        if (this.pendingRequests[req.manifest_id]) {
          this.pendingRequests[req.manifest_id](null, req.keys)
        }
        process.nextTick(() => this.handlers.onrequest(req, peer))
      } else {
        throw new Error(`Unhandled Exchange message: ${Object.keys(msg).join(',')}`)
      }
    } catch (err) {
      this.handlers.onerror(err)
    }
  }

  sendManifest (namespace, manifest, peer, cb) {
    if (typeof peer === 'function') return this.sendManifest(namespace, manifest, undefined, peer)
    const mid = ++this.__mctr
    // Save which keys were offered on this connection
    this.offeredKeys[namespace] = this.offeredKeys[namespace] || {}

    const message = {
      manifest: {
        namespace,
        id: mid,
        feeds: manifest.map(feed => {
          const out = { key: feed.key }
          if (typeof out.key === 'string') out.key = Buffer.from(out.key, 'hex')
          const strKey = out.key.toString('hex')
          this.offeredKeys[namespace][strKey] = 1

          const arrayHeaders = []
          Object.keys(feed.headers).forEach(key => {
            const h = { key }
            const v = feed.headers[key]

            if (Buffer.isBuffer(v)) {
              h.valueEncoding = VALUE_ENCODING_BUFFER
              h.value = v
            } else if (typeof v === 'string') {
              h.valueEncoding = VALUE_ENCODING_UTF8
              h.value = Buffer.from(v, 'utf8')
            } else {
              h.valueEncoding = VALUE_ENCODING_JSON
              h.value = Buffer.from(JSON.stringify(v), 'utf8')
            }
            arrayHeaders.push(h)
          })
          out.headers = arrayHeaders
          return out
        })
      }
    }

    if (typeof cb === 'function') {
      let triggered = false
      let timerId = null
      const race = (err, f) => {
        if (!triggered) {
          triggered = true
          delete this.pendingRequests[mid]
          clearTimeout(timerId) // cleanup pending timer
          cb(err, f)
        }
      }

      this.pendingRequests[mid] = race

      timerId = setTimeout(() => {
        race(new ManifestResponseTimedOutError())
      }, this.requestTimeout)
    }

    if (peer) this.send(message, peer)
    else this.broadcast(message)
    return mid
  }

  sendRequest (namespace, keys, manifestId, peer) {
    // TODO: I don't know if keys are normalized to either hexstring or buffers at this stage.
    this.requestedKeys[namespace] = this.requestedKeys[namespace] || {}
    keys.forEach(k => {
      if (Buffer.isBuffer(k)) k = k.toString('hex')
      this.requestedKeys[namespace][k] = 1
    })

    const message = {
      req: {
        namespace,
        manifest_id: manifestId,
        keys: keys.map(k => Buffer.isBuffer(k) ? k : Buffer.from(k, 'hex'))
      }
    }
    if (peer) this.send(message, peer)
    else this.broadcast(message)
  }

  /* Reverse looks up the negotiated keys and tries to determine
   * what namespace the key was either offered or requested
   * returns undefined if provided key was neither offererd nor requested
   */
  namespaceFor (key) {
    if (Buffer.isBuffer(key)) key = key.toString('hex')
    for (const ns of Object.keys(this.offeredKeys)) {
      if (this.offeredKeys[ns][key]) return ns
    }

    for (const ns of Object.keys(this.requestedKeys)) {
      if (this.requestedKeys[ns][key]) return ns
    }
  }
}

class ManifestResponseTimedOutError extends Error {
  constructor (msg = 'timeout while waiting for request after manifest', ...params) {
    super(msg, ...params)
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) Error.captureStackTrace(this, ManifestResponseTimedOutError)

    this.name = this.type = 'ManifestResponseTimedOutError'
  }
}

module.exports = function HostAdapter (extensionHost, ...a) {
  const inst = new ExchangeExtension(...a)
  const ext = extensionHost.registerExtension(NAME, inst)
  // This might be exclusive for hypercore/hypercore-protocol hosts
  // we're already injecting send/broadcast in decentstack
  inst.send = (...a) => ext.send(...a)
  inst.broadcast = (...a) => {
    if (typeof ext.broadcast === 'function') {
      ext.broadcast(...a)
    } else {
      ext.send(...a)
    }
  }

  return inst
}

module.exports.ExchangeExtension = ExchangeExtension
