import base from './base.js'
import gsCfg from './gsCfg.js'
import lodash from 'lodash'
import fetch from 'node-fetch'
import fs from 'node:fs'
import common from '../../../lib/common/common.js'
import UserModel from './mys/User.js'

export default class UserAdmin extends base {
  constructor (e) {
    super(e)
    this.model = 'bingCk'
    /** 绑定的uid */
    this.uidKey = `Yz:genshin:mys:qq-uid:${this.userId}`

    /** 多角色uid */
    this.allUid = []
  }

  // 获取当前user实例
  async user () {
    return await UserModel.create(this.e)
  }

  async resetCk () {
    let user = await this.user()
    await user.initCache()
  }

  /** 绑定ck */
  async bing () {
    let user = await this.user()
    let set = gsCfg.getConfig('mys', 'set')

    if (!this.e.ck) {
      await this.e.reply(`请【私聊】发送米游社cookie，获取教程：\n${set.cookieDoc}`)
      return
    }

    let ck = this.e.ck.replace(/#|'|"/g, '')
    let param = {}
    ck.split(';').forEach((v) => {
      let tmp = lodash.trim(v).split('=')
      param[tmp[0]] = tmp[1]
    })

    if (!param.cookie_token) {
      await this.e.reply('发送cookie不完整\n请退出米游社【重新登录】，刷新完整cookie')
      return
    }

    /** 拼接ck */
    this.ck = `ltoken=${param.ltoken};ltuid=${param.ltuid};cookie_token=${param.cookie_token}; account_id=${param.account_id};`
    this.ltuid = param.ltuid

    /** 米游币签到字段 */
    this.login_ticket = param.login_ticket ?? ''

    /** 检查ck是否失效 */
    if (!await this.checkCk(param)) {
      logger.mark(`绑定cookie错误：${this.checkMsg || 'cookie错误'}`)
      await this.e.reply(`绑定cookie失败：${this.checkMsg || 'cookie错误'}`)
      return
    }

    logger.mark(`${this.e.logFnc} 检查cookie正常 [uid:${this.uid}]`)

    await user.addCk(this.getCk())

    logger.mark(`${this.e.logFnc} 保存cookie成功 [uid:${this.uid}] [ltuid:${this.ltuid}]`)

    let uidMsg = [`绑定cookie成功\n${this.region_name}：${this.uid}`]
    if (!lodash.isEmpty(this.allUid)) {
      this.allUid.forEach(v => {
        uidMsg.push(`${v.region_name}：${v.uid}`)
      })
    }
    await this.e.reply(uidMsg.join('\n'))

    let msg = '【#体力】查询当前树脂'
    msg += '\n【#签到】米游社原神自动签到'
    msg += '\n【#关闭签到】开启或关闭原神自动签到'
    msg += '\n【#原石】查看原石札记'
    msg += '\n【#原石统计】原石统计数据'
    msg += '\n【#练度统计】技能统计列表'
    msg += '\n【#uid】当前绑定ck uid列表'
    msg += '\n【#我的ck】查看当前绑定ck'
    msg += '\n【#删除ck】删除当前绑定ck'
    msg += '\n【备注】支持绑定多个ck'

    msg = await common.makeForwardMsg(this.e, ['使用命令说明', msg], '绑定成功：使用命令说明')

    await this.e.reply(msg)
  }

  /** 检查ck是否可用 */
  async checkCk (param) {
    let res
    for (let type of ['mys', 'hoyolab']) {
      let roleRes = await this.getrGameRoles(type)
      if (roleRes?.retcode === 0) {
        res = roleRes
        /** 国际服的标记 */
        if (type == 'hoyolab' && typeof (param.mi18nLang) === 'string') {
          this.ck += ` mi18nLang=${param.mi18nLang};`
        }
        break
      }
      if (roleRes.retcode == -100) {
        this.checkMsg = '该ck已失效，请重新登录获取'
      }
      this.checkMsg = roleRes.message || 'error'
    }

    if (!res) return false

    if (!res.data.list || res.data.list.length <= 0) {
      this.checkMsg = '该账号尚未绑定原神角色！'
      return false
    }

    /** 米游社默认展示的角色 */
    for (let val of res.data.list) {
      if (val.is_chosen) {
        this.uid = val.game_uid
        this.region_name = val.region_name
      } else {
        this.allUid.push({
          uid: val.game_uid,
          region_name: val.region_name
        })
      }
    }

    if (!this.uid && res.data?.list?.length > 0) {
      this.uid = res.data.list[0].game_uid
      this.region_name = res.data.list[0].region_name
      if (this.allUid[0].uid == this.uid) delete this.allUid[0]
    }

    return this.uid
  }

  async getrGameRoles (server = 'mys') {
    let url = {
      mys: 'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_cn',
      hoyolab: 'https://api-os-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_global'
    }

    let res = await fetch(url[server], { method: 'get', headers: { Cookie: this.ck } })
    if (!res.ok) return false
    res = await res.json()

    return res
  }

  /** 保存ck */
  getCk () {
    let ck = gsCfg.getBingCkSingle(this.e.user_id)

    lodash.map(ck, o => {
      o.isMain = false
      return o
    })

    ck[this.uid] = {
      uid: this.uid,
      qq: this.e.user_id,
      ck: this.ck,
      ltuid: this.ltuid,
      login_ticket: this.login_ticket,
      device_id: this.getGuid(),
      isMain: true
    }

    this.allUid.forEach((v) => {
      if (!v.uid) return
      ck[v.uid] = {
        uid: v.uid,
        qq: this.e.user_id,
        ck: this.ck,
        ltuid: this.ltuid,
        device_id: this.getGuid(),
        isMain: false
      }
    })
    return ck
  }

  /** 删除绑定ck */
  async delCk (uid = '') {
    let user = await this.user()
    let uids = await user.delCk()
    return `绑定cookie已删除,uid:${uids.join(',')}`
  }

  /** 绑定uid，若有ck的话优先使用ck-uid */
  async bingUid () {
    let uid = this.e.msg.match(/[1|2|5-9][0-9]{8}/g)
    if (!uid) return
    uid = uid[0]
    let user = await this.user()
    await user.setRegUid(uid, true)
    return await this.e.reply(`绑定成功uid:${uid}`, false, { at: true })
  }

  /** #uid */
  async showUid () {
    let user = await this.user()

    if (!user.hasCk) {
      await this.e.reply(`当前绑定uid：${user.uid || '无'}`, false, { at: true })
      return
    }
    let uids = user.ckUids
    let uid = user.uid * 1
    let msg = [`当前uid：${uid}`, '当前绑定cookie Uid列表', '通过【#uid+序号】来切换uid']
    for (let i in uids) {
      let tmp = `${Number(i) + 1}: ${uids[i]}`
      if (uids[i] * 1 === uid) {
        tmp += ' [√]'
      }
      msg.push(tmp)
    }
    await this.e.reply(msg.join('\n'))
  }

  /** 切换uid */
  async toggleUid (index) {
    let user = await this.user()
    let uidList = user.ckUids
    if (index > uidList.length) {
      return await this.e.reply('uid序号输入错误')
    }
    index = Number(index) - 1
    await user.setMainUid(index)
    return await this.e.reply(`切换成功，当前uid：${user.uid}`)
  }

  /** 加载旧ck */
  async loadOldData () {
    let file = [
      './data/MysCookie/NoteCookie.json',
      './data/NoteCookie/NoteCookie.json',
      './data/NoteCookie.json'
    ]
    let json = file.find(v => fs.existsSync(v))
    if (!json) return

    let list = JSON.parse(fs.readFileSync(json, 'utf8'))
    let arr = {}

    logger.mark(logger.green('加载用户ck...'))

    lodash.forEach(list, (ck, qq) => {
      if (ck.qq) qq = ck.qq

      let isMain = false
      if (!arr[qq]) {
        arr[qq] = {}
        isMain = true
      }

      let param = {}
      ck.cookie.split(';').forEach((v) => {
        let tmp = lodash.trim(v).split('=')
        param[tmp[0]] = tmp[1]
      })

      let ltuid = param.ltuid

      if (!param.cookie_token) return

      arr[qq][String(ck.uid)] = {
        uid: ck.uid,
        qq,
        ck: ck.cookie,
        ltuid,
        isMain,
        device_id: this.getGuid()
      }
    })

    lodash.forEach(arr, (ck, qq) => {
      let saveFile = `./data/MysCookie/${qq}.yaml`
      if (fs.existsSync(saveFile)) return
      gsCfg.saveBingCk(qq, ck)
    })

    logger.mark(logger.green(`加载用户ck完成：${lodash.size(arr)}个`))

    fs.unlinkSync(json)
  }

  /** 我的ck */
  async myCk () {
    let user = await this.user()
    if (!user.hasCk) {
      this.e.reply('当前尚未绑定cookie')
    }
    let ck = user.mainCk

    if (!lodash.isEmpty(ck)) {
      await this.e.reply(`当前绑定cookie\nuid：${ck.uid}`)
      await this.e.reply(ck.ck)
    }
  }

  getGuid () {
    function S4 () {
      return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
    }

    return (S4() + S4() + '-' + S4() + '-' + S4() + '-' + S4() + '-' + S4() + S4() + S4())
  }
}
