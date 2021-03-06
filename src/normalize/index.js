import { transform } from 'bluestream'

export default (opt={}) => {
  const concurrent = opt.concurrency != null ? opt.concurrency : 50
  const normalize = async (row) => {
    // strip internal crap back off
    if (row && typeof row === 'object') delete row.___meta
    return row
  }
  return transform({
    concurrent,
    highWaterMark: concurrent
  }, normalize)
}
