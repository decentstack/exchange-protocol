const { Exchange } = require('./messages')
const NAME = 'exchange'

class CoreExchangeExtension {
  constructor (extHost, handlers, opts = {}) {
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
    this._ext = extHost.registerExtension(NAME, this)
  }

  onmessage (msg, peer) {
    try {
      if (msg.manifest) {
        const m = {
          id: msg.manifest.id,
         namespace: msg.manifest.namespace,
          // TODO: Deprecate hexstrings in favour of Map()
          keys: msg.manifest.feeds.map(f => f.key.toString('hex')),
          headers: msg.manifest.feeds.map(f => {
            const meta = {}
            f.headers.forEach(kv => {
              meta[kv.key] = JSON.parse(kv.value)
            })
            return meta
          })
        }

        // Register what remote offered.
        this.remoteOfferedKeys[m.namespace] = this.remoteOfferedKeys[m.namespace] || []

        m.keys.forEach(key => {
          if (this.remoteOfferedKeys[m.namespace].indexOf(key) === -1) {
            this.remoteOfferedKeys[m.namespace].push(key)
          }
        })
        const accept = keys => {
          return this.sendRequest (m.namespace, keys, m.id, peer)
        }
        process.nextTick(() => this.handlers.onmanifest(m, accept, peer))
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

  sendManifest (namespace, manifest, peer = null, cb) {
    if (typeof peer === 'function') return this.sendManifest(namespace, manifest, null, peer)
    const mid = ++this.__mctr
    // Save which keys were offered on this connection
    this.offeredKeys[namespace] = this.offeredKeys[namespace] || []

    manifest.keys.forEach(k => {
      if (this.offeredKeys[namespace].indexOf(k) === -1) {
        this.offeredKeys[namespace].push(k)
      }
    })

    const message = {
      manifest: {
        namespace,
        id: mid,
        feeds: manifest.keys.map((key, n) => {
          const meta = manifest.headers[n]
          if (typeof key === 'string') key = Buffer.from(key, 'hex')
          return {
            key: Buffer.from(key, 'hex'),
            headers: Object.keys(meta).map(k => {
              return {
                key: k,
                value: JSON.stringify(meta[k]) // TODO: turn this into a buffer
              }
            })
          }
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

    // TODO: or _ext.send() if peer provided
    this._ext.broadcast(message)
    return mid
  }

  sendRequest (namespace, keys, manifestId, peer) {
    this.requestedKeys[namespace] = this.requestedKeys[namespace] || []
    keys.forEach(k => {
      if (this.requestedKeys[namespace].indexOf(k) === -1) {
        this.requestedKeys[namespace].push(k)
      }
    })

    const message = {
      req: {
        namespace,
        manifest_id: manifestId,
        keys: keys.map(k => Buffer.from(k, 'hex'))
      }
    }

    if (typeof peer !== 'undefined') this._ext.send(message, peer)
    else this._ext.broadcast(message)
  }

  /*
   * Same as negotiatedKeysNS except returns a flat array of keys
   */
  get negotiatedKeys () {
    return Object.keys(this.negotiatedKeysNS)
  }

  /*
   * Each peer allows offered-keys and requested-keys
   * to be replicated on the stream
   * negotiated = offered - requested for each namespace
   * as key value, { feedKey: namespace, ... }
   */
  get negotiatedKeysNS () {
    const m = {}

    Object.keys(this.offeredKeys).forEach(ns => {
      this.offeredKeys[ns].forEach(k => { m[k] = ns })
    })
    Object.keys(this.requestedKeys).forEach(ns => {
      this.requestedKeys[ns].forEach(k => { m[k] = ns })
    })
    return m
  }
}

module.exports = CoreExchangeExtension

class ManifestResponseTimedOutError extends Error {
  constructor (msg = 'timeout while waiting for request after manifest', ...params) {
    super(msg, ...params)
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) Error.captureStackTrace(this, ManifestResponseTimedOutError)

    this.name = this.type = 'ManifestResponseTimedOutError'
  }
}
