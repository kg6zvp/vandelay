import url from 'url'
import qs from 'qs'
import continueStream from 'continue-stream'
import through2 from 'through2'
import pumpify from 'pumpify'
import multi from './multi'
import fetchURLPlain from './fetchURL'
import parse from '../parse'
import hardClose from '../hardClose'

// default behavior is to fail on first error
const defaultErrorHandler = ({ error, output }) => {
  output.emit('error', error)
}

const mergeURL = (origUrl, newQuery) => {
  const sourceUrl = url.parse(origUrl)
  const query = qs.stringify({
    ...qs.parse(sourceUrl.query),
    ...newQuery
  })
  return url.format({ ...sourceUrl, search: query })
}

const getQuery = (opt, page) => {
  const out = {}
  if (opt.pageParam) out[opt.pageParam] = page
  if (opt.limitParam && opt.limit) out[opt.limitParam] = opt.limit
  if (opt.offsetParam) out[opt.offsetParam] = page * opt.limit
  return out
}

const fetchStream = (source, opt={}, raw=false) => {
  const concurrent = opt.concurrency != null ? opt.concurrency : 50
  if (Array.isArray(source)) {
    return multi({
      concurrent,
      inputs: source.map((i) => fetchStream.bind(null, i, opt, true)),
      onError: opt.onError || defaultErrorHandler
    })
  }

  const fetchURL = opt.fetchURL || fetchURLPlain

  // validate params
  if (!source) throw new Error('Missing source argument')
  const src = { ...source } // clone
  if (!src.url || typeof src.url !== 'string') throw new Error('Invalid source url')
  if (typeof src.parser === 'string') {
    if (src.parserOptions && typeof src.parserOptions !== 'object') throw new Error('Invalid source parserOptions')
    src.parser = parse(src.parser, src.parserOptions) // JSON shorthand
  }
  if (typeof src.parser !== 'function') throw new Error('Invalid parser function')
  if (src.headers && typeof src.headers !== 'object') throw new Error('Invalid headers object')

  // URL + Parser
  const fetch = (url, opt) => {
    // attaches some meta to the object for the transform fn to use
    let rows = -1
    const map = function (row, _, cb) {
      // create the meta and put it on objects passing through
      if (row && typeof row === 'object') {
        row.___meta = {
          row: ++rows,
          url,
          source
        }

        // json header info from the parser
        if (row.___header) {
          row.___meta.header = row.___header
          delete row.___header
        }
      }
      cb(null, row)
    }

    const TextDecoder = require('util').TextDecoder
    
    let fromReqCount = 0
    let fromParserCount = 0
    let req = fetchURL(url, opt)
    if (opt.onFetch) opt.onFetch(url)
    const out = pumpify.obj(req,
      through2.obj((chunk, encoding, cb) => {
        fromReqCount++
        console.log('from req:', fromReqCount, 'chunk:', new TextDecoder(encoding).decode(chunk))
        cb(null, chunk)
      }), src.parser(),
      through2.obj((chunk, encoding, cb) => {
        fromParserCount++
        console.log('from parser:', fromParserCount)
        cb(null, chunk)
      }), through2.obj(map))
    out.abort = () => {
      req.abort()
      hardClose(out)
    }
    out.on('error', (err) => {
      err.source = source
      err.url = url
    })
    return out
  }

  let outStream
  if (src.pagination) {
    let page = src.pagination.startPage || 0
    let pageDatums // gets reset on each page to 0
    let lastFetch
    let destroyed = false
    outStream = continueStream.obj((cb) => {
      if (destroyed || pageDatums === 0) return cb()
      pageDatums = 0
      const newURL = mergeURL(src.url, getQuery(src.pagination, page))
      lastFetch = fetch(newURL, { headers: src.headers })
      page++
      cb(null, lastFetch)
    }).on('data', () => ++pageDatums)
    outStream.abort = () => {
      destroyed = true
      lastFetch && lastFetch.abort()
      hardClose(outStream)
    }
  } else {
    outStream = fetch(src.url, { headers: src.headers })
  }

  if (raw) return outStream // child of an array of sources, error mgmt handled already
  return multi({
    concurrent,
    inputs: [ outStream ],
    onError: opt.onError || defaultErrorHandler
  })
}

export default fetchStream
