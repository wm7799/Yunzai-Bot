import plugin from '../../../lib/plugins/plugin.js'
import fetch from 'node-fetch'
import lodash from 'lodash'

export class exchange extends plugin {
  constructor (e) {
    super({
      name: '兑换码',
      dsc: '兑换码',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '^#*(直播)*兑换码$',
          fnc: 'getCode'
        }
      ]
    })

    this.actId = '20220916ys3267'
  }

  async getCode () {
    this.now = parseInt(Date.now() / 1000)

    /** index info */
    let index = await this.getData('index')
    if (!index) return

    this.mi18n = index.data.mi18n
    let mi18n = await this.getData('mi18n')

    if (index.data.remain > 0) {
      return await this.reply(`暂无直播兑换码\n${mi18n['empty-code-text']}`)
    }

    let code = await this.getData('code')
    if (!code || code.length <= 0) return

    code = lodash.map(code, 'code')
    let msg = ''
    if (this.e.msg.includes('#')) {
      msg += code.join('\n')
    } else {
      msg = `${mi18n['act-title']}-直播兑换码\n\n`
      msg += code.join('\n')
      msg += `\n\n${mi18n['exchange-tips']}`
    }

    await this.reply(msg)
  }

  async getData (type) {
    let url = {
      index: `https://api-takumi.mihoyo.com/event/bbslive/index?act_id=${this.actId}`,
      mi18n: `https://webstatic.mihoyo.com/admin/mi18n/bbs_cn/${this.mi18n}/${this.mi18n}-zh-cn.json`,
      code: `https://webstatic.mihoyo.com/bbslive/code/${this.actId}.json?version=1&time=${this.now}`
    }

    let response
    try {
      response = await fetch(url[type], { method: 'get' })
    } catch (error) {
      logger.error(error.toString())
      return false
    }

    if (!response.ok) {
      logger.error(`[兑换码接口错误][${type}] ${response.status} ${response.statusText}`)
      return false
    }
    const res = await response.json()
    return res
  }
}
