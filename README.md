# exchange-protocol

Hypercore-extension that enables two peers to exchange feed keys and
descriptors.

Following extension hosts are supported:

- hypercore
- hypercore-protocol
- decentstack (built-in by default)

Take a look at [exchange-protocol docs page](https://decentstack.org/#/exchange_proto) for a higher level description and sequence diagrams.

## Usage

Given the following manifest:
```js
// Header-values are allowed to contain primitive types or Buffers
// if you want to use a custom encoder/decoder
const myManifest = [
  {
    key: 'deadbeefdeadbeefdeadbeefdeadbeef',
    headers: { seq: 1, hello: 'world' }
  },
  {
    key: otherKey,
    headers: { seq: 55, hello: 'planet', title: 'My awesome feed' }
  }
]

```

And given the following handlers Object:

```js
const exchangeHandlers = {
  onmanifest (shared, accept) {
    shared.namespace    // => String - 'default'
    shared.feeds        // => Array<Object> - offered keys

    for (const feed of feeds) { // Print the manifest contents.
      console.log('Remote Shared feed:', feed.key.toString('hex'))
      console.log('Headers:', feed.headers, '\n')
    }

    // `accept` is a Function that directly responds to a given
    // manifest with `FeedRequest'
    const acceptedKeys = shared.feeds.filter(...).map(f => f.key)
    accept(acceptedKeys) // accept all keys

    // This is a stub, you should let your replication manager
    // take care of joining the other feeds into the feed stream.
    acceptedKeys.forEach(key => {
      coreStorage.get(key).replicate(true, { stream: myPeerStream })
    })
  },

  onrequest (req) {
    req.manifest_id // => Number - increment
    req.namespace   // => String - 'default'
    req.keys        // => Array  - requested keys

    // Another replication manager stub
    req.keys.forEach(key => {
      coreStorage.get(key).replicate(false, { stream: myPeerStream })
    })
  },

  onerror (err) {
    throw err
  }
}
```

Using **hypercore-protocol**

```js
const Protocol = require('protocol')

const stream = new Protocol(true)
const ext = exchange(stream1, exchangeHandlers)

const key = Buffer.from('deadbeefdeadbeefdeadbeefdeadbeef', 'hex')

const channel = stream.open(key, {
  onopen () {
    ext.sendManifest('default', myManifest, ch1, (err, acceptedKeys) => {
      console.log('Remote peer selected', acceptedKeys)
    })
  }
})
```

Or using vanilla **hypercore**

```js
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const exchange = require('exchange-protocol')

const feed = hypercore(ram)

const ext = exchange(feed, exchangeHandlers)

feed.on('peer-open', peer => {
  // Arguments:  namespace, myManifest, target, callback
  ext.sendManifest('default', manifest, peer, (err, acceptedKeys) => {
    // Callback invoked on response from remote peer.
    // The `requestedKeys` are a copy of `req` param in `onrequest`,
    // they should be handeled in onrequest.
  })
})
```

**Result**
In a real world scenario your peer would not be communicating with it self.
But in this example, if we were to send `myManifest` to the `exchangeHandlers` the log lines would produce the following output:

```
> Remote shared feed: deadbeefdeadbeefdeadbeefdeadbeef
> Headers: { seq: 1, hello: 'world' }
>
> Remote shared feed: 1234feed43afdeafa41efeed4124beeb
> Headers: { seq: 55, hello: 'planet', title: 'My awesome feed' }
>
```


## License

GNU GPLv3
