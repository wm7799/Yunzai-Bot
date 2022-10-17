import plugin from '../../../lib/plugins/plugin.js'
import UserAdmin from '../model/userAdmin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import fs from "fs";

export class user extends plugin {
  constructor (e) {
    super({
      name: '用户管理',
      dsc: 'CK用户管理',
      event: 'message',
      priority: 300,
      rule: [{
        reg: '^#用户统计$',
        fnc: 'userAdmin'
      }, {
        reg: '^#重置用户(缓存|统计)$',
        fnc: 'resetCache'
      }]
    })
    this.User = new UserAdmin(e)
  }

  checkAuth () {
    if (!this.e.isMaster) {
      this.e.reply('只有管理员可用...')
      return false
    }
    return true
  }

  /** #原石札记 */
  async userAdmin () {
    if (!this.checkAuth()) {
      return true
    }
    let data = await new UserAdmin(this.e).userAdmin()
    if (!data) return true

    // 临时增加用于view调试
    if (process.argv.includes('web-debug')) {
      let saveDir = process.cwd() + '/data/ViewData/'
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir)
      }
      let file = saveDir + 'userAdmin.json'
      data._app = 'userAdmin'
      fs.writeFileSync(file, JSON.stringify(data))
    }

    /** 生成图片 */
    let img = await puppeteer.screenshot('userAdmin', data)
    if (img) await this.reply(img)
  }

  async resetCache () {
    if (!this.checkAuth()) {
      return true
    }
    await new UserAdmin(this.e).resetCache()
    this.e.reply('用户缓存已重置...')
  }
}
