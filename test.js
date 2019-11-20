const test = require('tape')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const { defer } = require('deferinfer')
const Exchange = require('.')

test('hypercore extension', async t => {
  t.plan(12)
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
      }
    })

    await defer(done => feed1.ready(done))
    await defer(done => feed1.append('Hello', done))

    const feed2 = hypercore(ram, feed1.key)
    // TODO: this lint error will go away when extensions are self-contained.
    new Exchange(feed2, {
      onmanifest (shared, accept) {
        t.ok('manifest received')
        t.equal(shared.namespace, 'default')
        t.equal(shared.keys[0], feed1.key.toString('hex')) // TODO: deprecate hexkeys
        t.equal(shared.headers[0].seq, 1)
        accept(shared.keys)
      }
    })

    // Start communication
    const stream = feed1.replicate(true, { live: true })
    stream.pipe(feed2.replicate(false, { live: true })).pipe(stream)

    const snapshot = {
      keys: [
        feed1.key
      ],
      headers: [
        { seq: feed1.length }
      ]
    }

    feed1.once('peer-open', () => {
      ex1.sendManifest('default', snapshot, (err, remoteRequestedKeys) => {
        t.error(err, 'manifest-cb was invoked peacefully')
        // Synonymous with the ex1.onrequest handler
        t.equal(remoteRequestedKeys.length, 1)
        t.ok(feed1.key.equals(remoteRequestedKeys[0]))
        if (!--pending) t.end(null, 'callback was last')
      })
    })
  } catch (e) { t.error(e) }
})
