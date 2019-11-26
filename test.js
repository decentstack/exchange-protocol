const test = require('tape')
const hypercore = require('hypercore')
const Protocol = require('hypercore-protocol')
const ram = require('random-access-memory')
const { defer } = require('deferinfer')
const exchange = require('.')

test('hypercore extension', async t => {
  t.plan(14)
  let pending = 2
  try {
    const feed1 = hypercore(ram)
    const ex1 = exchange(feed1, {
      onrequest (req) {
        t.ok('request received')
        t.equal(req.manifest_id, 1)
        t.equal(req.namespace, 'default')
        t.equal(req.keys.length, 1)
        t.ok(feed1.key.equals(req.keys[0]))
        if (!--pending) t.end(null, 'request was last')
      },
      onerror (err) { t.error(err) }
    })

    await defer(done => feed1.ready(done))
    await defer(done => feed1.append('Hello', done))

    const feed2 = hypercore(ram, feed1.key)
    exchange(feed2, {
      onmanifest (shared, accept) {
        t.ok('manifest received')
        t.equal(shared.namespace, 'default')
        t.equal(shared.feeds.length, 1)
        const f = shared.feeds[0]
        t.ok(feed1.key.equals(f.key))
        t.equal(f.headers.seq, 1)
        t.equal(f.headers.hello, 'world')
        accept(shared.feeds.map(f => f.key))
      },
      onerror (err) { t.error(err) }
    })

    // Start communication
    const stream = feed1.replicate(true, { live: true })
    stream.pipe(feed2.replicate(false, { live: true })).pipe(stream)

    const feeds = [
      { key: feed1.key, headers: { seq: feed1.length, hello: 'world' } }
    ]

    feed1.once('peer-open', peer => {
      try {
        ex1.sendManifest('default', feeds, peer, (err, remoteRequestedKeys) => {
          t.error(err, 'manifest-cb was invoked peacefully')
          // Synonymous with the ex1.onrequest handler
          t.equal(remoteRequestedKeys.length, 1)
          t.ok(feed1.key.equals(remoteRequestedKeys[0]))
          if (!--pending) t.end(null, 'callback was last')
        })
      } catch (e) { t.error(e) }
    })
  } catch (e) { t.error(e) }
})

test('hypercore-protocol extension', async t => {
  t.plan(12)
  let pending = 2
  const key = Buffer.from('deadbeefdeadbeefdeadbeefdeadbeef', 'hex')
  try {
    const stream1 = new Protocol(true)
    const stream2 = new Protocol(false)
    stream1.pipe(stream2).pipe(stream1)

    const ex1 = exchange(stream1, {
      onrequest (req) {
        t.ok('request received')
        t.equal(req.manifest_id, 1)
        t.equal(req.namespace, 'default')
        t.equal(req.keys.length, 1)
        if (!--pending) t.end(null, 'request was last')
      },
      onerror (err) { t.error(err) }
    })

    exchange(stream2, {
      onmanifest (shared, accept) {
        t.ok('manifest received')
        t.equal(shared.namespace, 'default')
        t.equal(shared.feeds.length, 1)
        const f = shared.feeds[0]
        t.equal(f.headers.seq, 1, 'seq header transmitted')
        t.equal(f.headers.hello, 'world', 'hello header transmited')
        accept(shared.feeds.map(f => f.key))
      },
      onerror (err) { t.error(err) }
    })

    // Start communication
    const feeds = [
      { key, headers: { seq: 1, hello: 'world' } }
    ]

    const ch1 = stream1.open(key, {
      onopen () {
        try {
          ex1.sendManifest('default', feeds, ch1, (err, remoteRequestedKeys) => {
            t.error(err, 'manifest-cb was invoked peacefully')
            // Synonymous with the ex1.onrequest handler
            t.equal(remoteRequestedKeys.length, 1)
            t.ok(key.equals(remoteRequestedKeys[0]))
            if (!--pending) t.end(null, 'callback was last')
          })
        } catch (e) { t.error(e) }
      }
    })
    stream2.open(key)
  } catch (e) { t.error(e) }
})
