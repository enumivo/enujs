/* eslint-env mocha */
const assert = require('assert')
const fs = require('fs')

const Enu = require('.')
const {ecc} = Enu.modules
const {Keystore} = require('enujs-keygen')

const wif = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'

describe('version', () => {
  it('exposes a version number', () => {
    assert.ok(Enu.version)
  })
})

describe('offline', () => {
  const headers = {
    expiration: new Date().toISOString().split('.')[0], // Don't use `new Date` in production
    ref_block_num: 1,
    ref_block_prefix: 452435776,
    max_net_usage_words: 0,
    max_cpu_usage_ms: 0,
    delay_sec: 0,
    context_free_actions: [],
    transaction_extensions: []
  }


  it('multi-signature', async function() {
    const transactionHeaders = (expireInSeconds, callback) => {
      callback(null/*error*/, headers)
    }
    const enu = Enu({
      keyProvider: [
        ecc.seedPrivate('key1'),
        ecc.seedPrivate('key2')
      ],
      httpEndpoint: null,
      transactionHeaders
    })

    const trx = await enu.nonce(1, {authorization: 'inita'})
    assert.equal(trx.transaction.signatures.length, 2, 'signature count')
  })

  describe('custom transactions', function () {
    const nonce = {
      account: 'enumivo.null',
      name: 'nonce',
      data: '010f'
    }

    const authorization = [{
      actor: 'inita',
      permission: 'active'
    }]

    const enu = Enu({
      keyProvider: wif
    })

    it('context_free_actions', async function() {
      await enu.transaction({
        context_free_actions: [nonce],// can't have authorization
        actions: [
          // only action, needs an authorization
          Object.assign({}, nonce, {authorization})
        ]
      })
    })

    it('nonce', async function() {
      const trx = await enu.transaction({
        actions: [ Object.assign({}, nonce, {authorization}) ],
      })
    })
  })

  describe('transaction headers', async function() {
    const headerOverrides = {
      max_net_usage_words: 333,
      max_cpu_usage_ms: 222,
      delay_sec: 369
    }

    const transactionHeaders = Object.assign({}, headers, headerOverrides)
    const xfer = ['few', 'many', '100.0000 SYS', ''/*memo*/]

    it('global', async function() {
      const enu = Enu({
        keyProvider: wif,
        httpEndpoint: null,
        transactionHeaders
      })

      const trx = await enu.transfer(...xfer)

      assert.deepEqual({
        expiration: trx.transaction.transaction.expiration,
        ref_block_num: trx.transaction.transaction.ref_block_num,
        ref_block_prefix: trx.transaction.transaction.ref_block_prefix,
        max_net_usage_words: trx.transaction.transaction.max_net_usage_words,
        max_cpu_usage_ms: trx.transaction.transaction.max_cpu_usage_ms,
        delay_sec: trx.transaction.transaction.delay_sec,
        context_free_actions: [],
        transaction_extensions: []
      }, transactionHeaders)

      assert.equal(trx.transaction.signatures.length, 1, 'signature count')
    })

    const enu = Enu({
      sign: false,
      broadcast: false,
      keyProvider: wif,
      httpEndpoint: null,
      transactionHeaders: headers
    })

    it('object', async function() {
      const trx = await enu.transaction({
        delay_sec: 369,
        actions: [{
          account: 'enumivo.null',
          name: 'nonce',
          data: '010f',
          authorization: [{actor: 'inita', permission: 'owner'}]
        }]
      })
      assert.equal(trx.transaction.transaction.delay_sec, 369, 'delay_sec')
    })

    it('action', async function() {
      const trx = await enu.transfer(...xfer, {delay_sec: 369})
      assert.equal(trx.transaction.transaction.delay_sec, 369, 'delay_sec')
    })

    it('callback', async function() {
      const trx = await enu.transaction(tr => {tr.transfer(...xfer)}, {delay_sec: 369})
      assert.equal(trx.transaction.transaction.delay_sec, 369, 'delay_sec')
    })

    it('contract', async function() {
      const trx = await enu.transaction('enu.token',
        enu_token => { enu_token.transfer(...xfer) },
        {delay_sec: 369}
      )
      assert.equal(trx.transaction.transaction.delay_sec, 369, 'delay_sec')
    })

  })

  it('load abi', async function() {
    const enu = Enu({httpEndpoint: null})

    const abiBuffer = fs.readFileSync(`contracts/enu.bios/enu.bios.abi`)
    const abiObject = JSON.parse(abiBuffer)

    assert.deepEqual(abiObject, enu.fc.abiCache.abi('enu.bios', abiBuffer).abi)
    assert.deepEqual(abiObject, enu.fc.abiCache.abi('enu.bios', abiObject).abi)

    const bios = await enu.contract('enu.bios')
    assert(typeof bios.newaccount === 'function', 'unrecognized contract')
  })

})

// describe('networks', () => {
//   it('testnet', (done) => {
//     const enu = Enu()
//     enu.getBlock(1, (err, block) => {
//       if(err) {
//         throw err
//       }
//       done()
//     })
//   })
// })

describe('Contracts', () => {
  it('Messages do not sort', async function() {
    const local = Enu()
    const opts = {sign: false, broadcast: false}
    const tx = await local.transaction(['currency', 'enu.token'], ({currency, enu_token}) => {
      // make sure {account: 'enu.token', ..} remains first
      enu_token.transfer('inita', 'initd', '1.1000 ENU', '')

      // {account: 'currency', ..} remains second (reverse sort)
      currency.transfer('inita', 'initd', '1.2000 CUR', '')

    }, opts)
    assert.equal(tx.transaction.transaction.actions[0].account, 'enu.token')
    assert.equal(tx.transaction.transaction.actions[1].account, 'currency')
  })
})

describe('Contract', () => {
  function deploy(contract, account = 'inita') {
    it(`deploy ${contract}@${account}`, async function() {
      this.timeout(4000)
      // console.log('todo, skipping deploy ' + `${contract}@${account}`)
      const config = {binaryen: require("binaryen"), keyProvider: wif}
      const enu = Enu(config)

      const wasm = fs.readFileSync(`contracts/${contract}/${contract}.wasm`)
      const abi = fs.readFileSync(`contracts/${contract}/${contract}.abi`)


      await enu.setcode(account, 0, 0, wasm)
      await enu.setabi(account, JSON.parse(abi))

      const code = await enu.getAbi(account)

      const diskAbi = JSON.parse(abi)
      delete diskAbi.____comment
      if(!diskAbi.error_messages) {
        diskAbi.error_messages = []
      }

      assert.deepEqual(diskAbi, code.abi)
    })
  }

  // When ran multiple times, deploying to the same account
  // avoids a same contract version deploy error.
  // TODO: undeploy contract instead (when API allows this)

  deploy('enu.msig')
  deploy('enu.token')
  deploy('enu.bios')
  deploy('enu.system')
})

describe('Contracts Load', () => {
  function load(name) {
    it(name, async function() {
      const enu = Enu()
      const contract = await enu.contract(name)
      assert(contract, 'contract')
    })
  }
  load('enumivo')
  load('enu.token')
})

describe('keyProvider', () => {
  const keyProvider = () => {
    return [wif]
  }

  it('global', async function() {
    const enu = Enu({keyProvider})
    await enu.transfer('inita', 'initb', '1.0001 ENU', '')
  })

  it('per-action', async function() {
    const enu = Enu()

    await enu.transfer('inita', 'initb', '1.0002 ENU', '', {keyProvider})

    await enu.transaction(tr => {
      tr.transfer('inita', 'initb', '1.0003 ENU', '')
    }, {keyProvider})

    const token = await enu.contract('enu.token')
    await token.transfer('inita', 'initb', '1.0004 ENU', '', {keyProvider})
  })

  it('multiple private keys (get_required_keys)', () => {
    // keyProvider should return an array of keys
    const keyProvider = () => {
      return [
        '5K84n2nzRpHMBdJf95mKnPrsqhZq7bhUvrzHyvoGwceBHq8FEPZ',
        wif
      ]
    }

    const enu = Enu({keyProvider})

    return enu.transfer('inita', 'initb', '1.2740 ENU', '', false).then(tr => {
      assert.equal(tr.transaction.signatures.length, 1)
      assert.equal(typeof tr.transaction.signatures[0], 'string')
    })
  })

  // If a keystore is used, the keyProvider should return available
  // public keys first then respond with private keys next.
  it('public keys then private key', () => {
    const pubkey = ecc.privateToPublic(wif)

    // keyProvider should return a string or array of keys.
    const keyProvider = ({transaction, pubkeys}) => {
      if(!pubkeys) {
        assert.equal(transaction.actions[0].name, 'transfer')
        return [pubkey]
      }

      if(pubkeys) {
        assert.deepEqual(pubkeys, [pubkey])
        return [wif]
      }
      assert(false, 'unexpected keyProvider callback')
    }

    const enu = Enu({keyProvider})

    return enu.transfer('inita', 'initb', '9.0000 ENU', '', false).then(tr => {
      assert.equal(tr.transaction.signatures.length, 1)
      assert.equal(typeof tr.transaction.signatures[0], 'string')
    })
  })

  it('from enujs-keygen', () => {
    const keystore = Keystore('uid')
    keystore.deriveKeys({parent: wif})
    const enu = Enu({keyProvider: keystore.keyProvider})
    return enu.transfer('inita', 'initb', '12.0000 ENU', '', true)
  })

  it('return Promise', () => {
    const enu = Enu({keyProvider: new Promise(resolve => {resolve(wif)})})
    return enu.transfer('inita', 'initb', '1.6180 ENU', '', true)
  })
})

describe('signProvider', () => {
  it('custom', function() {
    const customSignProvider = ({buf, sign, transaction}) => {

      // All potential keys (ENU6MRy.. is the pubkey for 'wif')
      const pubkeys = ['ENU6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV']

      return enu.getRequiredKeys(transaction, pubkeys).then(res => {
        // Just the required_keys need to sign
        assert.deepEqual(res.required_keys, pubkeys)
        return sign(buf, wif) // return hex string signature or array of signatures
      })
    }

    const enu = Enu({signProvider: customSignProvider})
    return enu.transfer('inita', 'initb', '2.0000 ENU', '', false)
  })
})

describe('transactions', () => {
  const signProvider = ({sign, buf}) => sign(buf, wif)
  const promiseSigner = (args) => Promise.resolve(signProvider(args))

  it('usage', () => {
    const enu = Enu({signProvider})
    enu.setprods()
  })

  it('create asset', async function() {
    const enu = Enu({signProvider})
    const pubkey = 'ENU6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    const auth = {authorization: 'enu.token'}
    await enu.create('enu.token', '10000 ' + randomAsset(), auth)
    await enu.create('enu.token', '10000.00 ' + randomAsset(), auth)
  })

  it('newaccount (broadcast)', () => {
    const enu = Enu({signProvider})
    const pubkey = 'ENU6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    const name = randomName()

    return enu.transaction(tr => {
      tr.newaccount({
        creator: 'enumivo',
        name,
        owner: pubkey,
        active: pubkey
      })

      tr.buyrambytes({
        payer: 'enumivo',
        receiver: name,
        bytes: 8192
      })

      tr.delegatebw({
        from: 'enumivo',
        receiver: name,
        stake_net_quantity: '10.0000 ENU',
        stake_cpu_quantity: '10.0000 ENU',
        transfer: 0
      })
    })
  })

  it('mockTransactions pass', () => {
    const enu = Enu({signProvider, mockTransactions: 'pass'})
    return enu.transfer('inita', 'initb', '1.0000 ENU', '').then(transfer => {
      assert(transfer.mockTransaction, 'transfer.mockTransaction')
    })
  })

  it('mockTransactions fail', () => {
    const enu = Enu({signProvider, mockTransactions: 'fail'})
    return enu.transfer('inita', 'initb', '1.0000 ENU', '').catch(error => {
      assert(error.indexOf('fake error') !== -1, 'expecting: fake error')
    })
  })

  it('transfer (broadcast)', () => {
    const enu = Enu({signProvider})
    return enu.transfer('inita', 'initb', '1.0000 ENU', '')
  })

  it('transfer custom token precision (broadcast)', () => {
    const enu = Enu({signProvider})
    return enu.transfer('inita', 'initb', '1.618 PHI', '')
  })

  it('transfer custom authorization (broadcast)', () => {
    const enu = Enu({signProvider})
    return enu.transfer('inita', 'initb', '1.0000 ENU', '', {authorization: 'inita@owner'})
  })

  it('transfer custom authorization (permission only)', async () => {
    const enu = Enu({signProvider, broadcast: false, authorization: '@posting'})
    const tr = await enu.transfer('inita', 'initb', '1.0000 ENU', '')
    assert.deepEqual(
      tr.transaction.transaction.actions[0].authorization,
      [{actor: 'inita', permission: 'posting'}]
    )
  })

  it('transfer custom global authorization', async () => {
    const authorization = [{actor: 'inita', permission: 'posting'}]
    const enu = Enu({signProvider, authorization, broadcast: false})
    const tr = await enu.transfer('inita', 'initb', '1.0000 ENU', '')
    assert.deepEqual(
      tr.transaction.transaction.actions[0].authorization,
      authorization
    )
  })

  it('transfer custom authorization sorting (no broadcast)', () => {
    const enu = Enu({signProvider})
    return enu.transfer('inita', 'initb', '1.0000 ENU', '',
      {authorization: ['initb@owner', 'inita@owner'], broadcast: false}
    ).then(({transaction}) => {
      const ans = [
        {actor: 'inita', permission: 'owner'},
        {actor: 'initb', permission: 'owner'}
      ]
      assert.deepEqual(transaction.transaction.actions[0].authorization, ans)
    })
  })

  it('transfer (no broadcast)', () => {
    const enu = Enu({signProvider})
    return enu.transfer('inita', 'initb', '1.0000 ENU', '', {broadcast: false})
  })

  it('transfer (no broadcast, no sign)', () => {
    const enu = Enu({signProvider})
    const opts = {broadcast: false, sign: false}
    return enu.transfer('inita', 'initb', '1.0000 ENU', '', opts).then(tr =>
      assert.deepEqual(tr.transaction.signatures, [])
    )
  })

  it('transfer sign promise (no broadcast)', () => {
    const enu = Enu({signProvider: promiseSigner})
    return enu.transfer('inita', 'initb', '1.0000 ENU', '', false)
  })

  it('action to unknown contract', done => {
    Enu({signProvider}).contract('unknown432')
    .then(() => {throw 'expecting error'})
    .catch(error => { // eslint-disable-line handle-callback-err
      done()
    })
  })

  it('action to contract', () => {
    return Enu({signProvider}).contract('enu.token').then(token => {
      return token.transfer('inita', 'initb', '1.0000 ENU', '')
        // transaction sent on each command
        .then(tr => {
          assert.equal(1, tr.transaction.transaction.actions.length)

          return token.transfer('initb', 'inita', '1.0000 ENU', '')
            .then(tr => {assert.equal(1, tr.transaction.transaction.actions.length)})
        })
    }).then(r => {assert(r == undefined)})
  })

  it('action to contract atomic', async function() {
    let amt = 1 // for unique transactions
    const enu = Enu({signProvider})

    const trTest = enu_token => {
      assert(enu_token.transfer('inita', 'initb', amt + '.0000 ENU', '') == null)
      assert(enu_token.transfer('initb', 'inita', (amt++) + '.0000 ENU', '') == null)
    }

    const assertTr = tr =>{
      assert.equal(2, tr.transaction.transaction.actions.length)
    }

    //  contracts can be a string or array
    await assertTr(await enu.transaction(['enu.token'], ({enu_token}) => trTest(enu_token)))
    await assertTr(await enu.transaction('enu.token', enu_token => trTest(enu_token)))
  })

  it('action to contract (contract tr nesting)', function () {
    this.timeout(4000)
    const tn = Enu({signProvider})
    return tn.contract('enu.token').then(enu_token => {
      return enu_token.transaction(tr => {
        tr.transfer('inita', 'initb', '1.0000 ENU', '')
        tr.transfer('inita', 'initc', '2.0000 ENU', '')
      }).then(() => {
        return enu_token.transfer('inita', 'initb', '3.0000 ENU', '')
      })
    })
  })

  it('multi-action transaction (broadcast)', () => {
    const enu = Enu({signProvider})
    return enu.transaction(tr => {
      assert(tr.transfer('inita', 'initb', '1.0000 ENU', '') == null)
      assert(tr.transfer({from: 'inita', to: 'initc', quantity: '1.0000 ENU', memo: ''}) == null)
    }).then(tr => {
      assert.equal(2, tr.transaction.transaction.actions.length)
    })
  })

  it('multi-action transaction no inner callback', () => {
    const enu = Enu({signProvider})
    return enu.transaction(tr => {
      tr.transfer('inita', 'inita', '1.0000 ENU', '', cb => {})
    })
    .then(() => {throw 'expecting rollback'})
    .catch(error => {
      assert(/Callback during a transaction/.test(error), error)
    })
  })

  it('multi-action transaction error rollback', () => {
    const enu = Enu({signProvider})
    return enu.transaction(tr => {throw 'rollback'})
    .then(() => {throw 'expecting rollback'})
    .catch(error => {
      assert(/rollback/.test(error), error)
    })
  })

  it('multi-action transaction Promise.reject rollback', () => {
    const enu = Enu({signProvider})
    return enu.transaction(tr => Promise.reject('rollback'))
    .then(() => {throw 'expecting rollback'})
    .catch(error => {
      assert(/rollback/.test(error), error)
    })
  })

  it('custom transaction', () => {
    const enu = Enu({signProvider})
    return enu.transaction(
      {
        actions: [
          {
            account: 'enu.token',
            name: 'transfer',
            data: {
              from: 'inita',
              to: 'initb',
              quantity: '13.0000 ENU',
              memo: '爱'
            },
            authorization: [{
              actor: 'inita',
              permission: 'active'
            }]
          }
        ]
      },
      {broadcast: false}
    )
  })

  it('custom contract transfer', async function() {
    const enu = Enu({signProvider})
    await enu.contract('currency').then(currency =>
      currency.transfer('currency', 'inita', '1.0000 CUR', '')
    )
  })
})

it('Transaction ABI cache', async function() {
  const enu = Enu()
  assert.throws(() => enu.fc.abiCache.abi('enu.msig'), /not cached/)
  const abi = await enu.fc.abiCache.abiAsync('enu.msig')
  assert.deepEqual(abi, await enu.fc.abiCache.abiAsync('enu.msig', false/*force*/))
  assert.deepEqual(abi, enu.fc.abiCache.abi('enu.msig'))
})

it('Transaction ABI lookup', async function() {
  const enu = Enu()
  const tx = await enu.transaction(
    {
      actions: [
        {
          account: 'currency',
          name: 'transfer',
          data: {
            from: 'inita',
            to: 'initb',
            quantity: '13.0000 CUR',
            memo: ''
          },
          authorization: [{
            actor: 'inita',
            permission: 'active'
          }]
        }
      ]
    },
    {sign: false, broadcast: false}
  )
  assert.equal(tx.transaction.transaction.actions[0].account, 'currency')
})

const randomName = () => {
  const name = String(Math.round(Math.random() * 1000000000)).replace(/[0,6-9]/g, '')
  return 'a' + name + '111222333444'.substring(0, 11 - name.length) // always 12 in length
}

const randomAsset = () =>
  ecc.sha256(String(Math.random())).toUpperCase().replace(/[^A-Z]/g, '').substring(0, 7)
