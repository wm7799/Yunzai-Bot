import plugin from '../../../lib/plugins/plugin.js'
import UserAdmin from '../model/userAdmin.js'

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
      }]
    })
    this.User = new UserAdmin(e)
  }

  async userAdmin (e) {

  }
}
