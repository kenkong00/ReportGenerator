/** 跨模块复用的错误类型。 */

/** 用户点击「暂停」：从任意 LLM 调用点抛出，由 runner 捕获并落 paused 状态。 */
export class PauseError extends Error {
  constructor(msg = '用户暂停') {
    super(msg)
    this.name = 'PauseError'
    this.code = 'paused'
    this.__pause = true
  }
}

export function isPause(e) {
  return !!(e && (e.__pause || e.name === 'PauseError' || e.code === 'paused'))
}
