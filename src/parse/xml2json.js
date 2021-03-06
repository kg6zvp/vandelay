import { parseString } from 'xml2js'
import through2 from 'through2'
import camelcase from 'camelcase'
import autoParse from './autoParse'

export default (opt) => {
  const valueProcessors = opt.autoParse ? [ autoParse ] : null
  const nameProcessors = opt.camelcase ? [ camelcase ] : null
  const xmlOpt = {
    explicitArray: false,
    valueProcessors,
    attrValueProcessors: valueProcessors,
    tagNameProcessors: nameProcessors,
    attrNameProcessors: nameProcessors
  }
  const xml2JsonStream = through2.obj((row, _, cb) => {
    parseString(row.toString(), xmlOpt, (err, js) => {
      cb(err, JSON.stringify(js))
    })
  })
  return xml2JsonStream
}
