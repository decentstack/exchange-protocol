const test = require('tape')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const { defer } = require('deferinfer')
const Exchange = require('.')

test('hypercore extension', async t => {
  t.plan(14)
  let pending = 2
  try {
    const feed1 = hypercore(ram)
    const ex1 = new Exchange(feed1, {
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
    // TODO: this lint error will go away when extensions are self-contained.
    new Exchange(feed2, {
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

    feed1.once('peer-open', () => {
      try {
        ex1.sendManifest('default', feeds, (err, remoteRequestedKeys) => {
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
