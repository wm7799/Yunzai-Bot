import MysApi from './mysApi.js'
import GsCfg from '../gsCfg.js'
import lodash from 'lodash'
import moment from 'moment'
import User from './User.js'
import MysUser from './MysUser.js'
import DailyCache from './DailyCache.js'

/** 公共ck */
let pubCk = {}
/** 绑定ck */
let bingCkUid = {}
let bingCkQQ = {}
let bingCkLtuid = {}

let tmpCk = {}

export default class MysInfo {
  /** redis key */
  static keyPre = 'Yz:genshin:mys:'
  static key = {
    /** ck使用次数统计 */
    count: `${MysInfo.keyPre}ck:count`,
    /** ck使用详情 */
    detail: `${MysInfo.keyPre}ck:detail`,
    /** 单个ck使用次数 */
    ckNum: `${MysInfo.keyPre}ckNum:`,
    /** 已失效的ck使用详情 */
    delDetail: `${MysInfo.keyPre}ck:delDetail`,
    /** qq-uid */
    qqUid: `${MysInfo.keyPre}qq-uid:`
  }

  static tips = '请先#绑定cookie\n发送【体力帮助】查看配置教程'

  constructor (e) {
    if (e) {
      this.e = e
      this.userId = String(e.user_id)
    }
    /** 当前查询原神uid */
    this.uid = ''
    /** 当前ck信息 */
    this.ckInfo = {
      ck: '',
      uid: '',
      qq: '',
      ltuid: '',
      type: ''
    }
    // ck对应MysUser对象
    this.ckUser = null

    this.auth = ['dailyNote', 'bbs_sign_info', 'bbs_sign_home', 'bbs_sign', 'ys_ledger', 'compute', 'avatarSkill', 'detail']
  }

  static async init (e, api) {
    await MysInfo.initCache()

    let mysInfo = new MysInfo(e)

    if (mysInfo.checkAuth(api)) {
      /** 获取ck绑定uid */
      mysInfo.uid = await MysInfo.getSelfUid(e)
    } else {
      /** 获取uid */
      mysInfo.uid = await MysInfo.getUid(e)
    }

    if (!mysInfo.uid) {
      e.noTips = true
      return false
    }

    if (!['1', '2', '5', '6', '7', '8', '9'].includes(String(mysInfo.uid)[0])) {
      // e.reply('只支持查询国服uid')
      return false
    }

    mysInfo.e.uid = mysInfo.uid

    /** 获取ck */
    await mysInfo.getCookie()

    /** 判断回复 */
    await mysInfo.checkReply()

    return mysInfo
  }

  /** 获取uid */
  static async getUid (e) {
    let user = await User.create(e)
    if (e.uid) {
      /** 没有绑定的自动绑定 */
      return await user.setRegUid(e.uid, false)
    }

    let { msg = '', at = '' } = e
    if (!msg) return false

    let uid = false
    /** at用户 */
    if (at) {
      let atUser = await User.create(at)
      uid = atUser.uid
      if (uid) return String(uid)
      if (e.noTips !== true) e.reply('尚未绑定uid', false, { at })
      return false
    }

    let matchUid = (msg = '') => {
      let ret = /[1|2|5][0-9]{8}/g.exec(msg)
      if (!ret) return false
      return ret[0]
    }

    // 消息携带UID、当前用户UID、群名片携带UID 依次获取
    uid = matchUid(msg) || user.uid || matchUid(e.sender.card)
    if (uid) {
      /** 没有绑定的自动绑定 */
      return await user.setRegUid(uid, false)
    }

    if (e.noTips !== true) e.reply('请先#绑定uid', false, { at })

    return false
  }

  /** 获取ck绑定uid */
  static async getSelfUid (e) {
    let { msg = '', at = '' } = e
    if (!msg) return false

    let user = await User.create(e)
    let selfUser = at ? await User.create(at) : user

    /** at用户 */
    if (!selfUser.hasCk) {
      if (e.noTips !== true) e.reply('尚未绑定cookie', false, { at: selfUser.qq })
      return false
    }

    return selfUser.uid
  }

  /** 判断绑定ck才能查询 */
  checkAuth (api) {
    if (lodash.isObject(api)) {
      for (let i in api) {
        if (this.auth.includes(i)) {
          return true
        }
      }
    } else if (this.auth.includes(api)) {
      return true
    }
    return false
  }

  /**
   * @param api
   * * `index` 米游社原神首页宝箱等数据
   * * `spiralAbyss` 原神深渊
   * * `character` 原神角色详情
   * * `dailyNote` 原神树脂
   * * `bbs_sign` 米游社原神签到
   * * `detail` 详情
   * * `ys_ledger` 札记
   * * `compute` 养成计算器
   * * `avatarSkill` 角色技能
   *
   * @param e.apiSync 多个请求时是否同步请求
   * @param e.noTips  是否回复提示，用于第一次调用才提示，后续不再提示
   *
   * @param option.log 是否显示请求日志
   */
  static async get (e, api, data = {}, option = {}) {
    let mysInfo = await MysInfo.init(e, api)

    if (!mysInfo.uid || !mysInfo.ckInfo.ck) return false
    e.uid = mysInfo.uid

    let mysApi = new MysApi(mysInfo.uid, mysInfo.ckInfo.ck, option)

    let res
    if (lodash.isObject(api)) {
      let all = []
      /** 同步请求 */
      if (e.apiSync == true) {
        res = []
        for (let i in api) {
          res.push(await mysApi.getData(i, api[i]))
        }
      } else {
        lodash.forEach(api, (v, i) => {
          all.push(mysApi.getData(i, v))
        })
        res = await Promise.all(all)
      }

      for (let i in res) {
        res[i] = await mysInfo.checkCode(res[i], res[i].api)

        if (res[i]?.retcode === 0) continue

        break
      }
    } else {
      res = await mysApi.getData(api, data)
      res = await mysInfo.checkCode(res, api)
    }

    return res
  }

  async checkReply () {
    if (this.e.noTips === true) return

    if (!this.uid) {
      this.e.reply('请先#绑定uid')
    }

    if (!this.ckInfo.ck) {
      // 待完善
      this.e.reply('暂无可用CK..')
    }

    this.e.noTips = true
  }

  async getCookie () {
    if (this.ckInfo.ck) return this.ckInfo.ck

    let mysUser = await MysUser.getByQueryUid(this.uid)

    if (mysUser) {
      this.ckInfo = mysUser.ckData
      this.ckUser = mysUser
    }

    return this.ckInfo.ck
  }

  /** 初始化公共CK */
  static async initPubCk () {
    // 初始化公共CK
    let pubCount = 0
    let pubCks = GsCfg.getConfig('mys', 'pubCk') || []
    for (let ck of pubCks) {
      let pubUser = await MysUser.create(ck)
      if (pubUser) {
        let ret = await pubUser.initCache({ qq: 'pub' })
        if (ret) {
          pubCount++
        }
      }
    }
    logger.mark(`加载公共ck：${pubCount}个`)
  }

  /** 初始化用户CK */
  static async initUserCk () {
    // 初始化用户缓存
    let sysConf = GsCfg.getConfig('mys', 'set')
    let userCount = 0
    let res = await GsCfg.getBingCk()
    for (let qq in res.ckQQ) {
      let ck = res.ckQQ[qq]
      // todo: 待使用已有ck
      if (ck.uid && ck.ltuid) {
        console.log(qq, ck.uid, ck.ltuid)
        let data = {}
        data[ck.uid] = ck
        let user = await User.create(qq, data)
        userCount += await user.initCache(true)
      }
    }
    logger.mark(`加载用户UID：${userCount}个，${sysConf.allowUseCookie ? '加入查询池' : '未加入查询池'}`)
  }

  /** 初始化缓存 **/
  static async initCache (force = false) {
    // 检查缓存标记
    let sysCache = DailyCache.create('sys')
    if (!force && await sysCache.get('cache-status')) {
      return true
    }

    // 先初始化用户CK，减少一些公共CK中ltuid无法识别的情况
    await MysInfo.initUserCk()
    // 初始化公共ck
    await MysInfo.initPubCk()

    await sysCache.set('cache-status', new Date() * 1)
    return true
  }

  async initBingCk () {
    if (!lodash.isEmpty(bingCkUid)) return

    let res = await GsCfg.getBingCk()
    bingCkUid = res.ck
    bingCkQQ = res.ckQQ
    bingCkLtuid = lodash.keyBy(bingCkUid, 'ltuid')
  }

  async checkCode (res, type) {
    if (!res) {
      this.e.reply('米游社接口请求失败，暂时无法查询')
      return false
    }

    res.retcode = Number(res.retcode)
    if (type == 'bbs_sign') {
      if ([-5003].includes(res.retcode)) {
        res.retcode = 0
      }
    }
    switch (res.retcode) {
      case 0:
        break
      case -1:
      case -100:
      case 1001:
      case 10001:
      case 10103:
        if (/(登录|login)/i.test(res.message)) {
          if (this.ckInfo.uid) {
            logger.mark(`[ck失效][uid:${this.uid}][qq:${this.userId}]`)
            if (this.ckInfo.type == 'public') {
              this.e.reply('米游社查询失败，请稍后再试')
            } else {
              this.e.reply(`UID:${this.ckInfo.uid}，米游社cookie已失效`)
            }
          } else {
            logger.mark(`[公共ck失效][ltuid:${this.ckInfo.ltuid}]`)
            // this.e.reply(`查询失败，公共ck已失效，ltuid:${this.ckInfo.ltuid}`)
            this.e.reply('米游社查询失败，请稍后再试')
          }
          await this.delCk()
        } else {
          this.e.reply(`米游社接口报错，暂时无法查询：${res.message}`)
        }
        break
      case 1008:
        this.e.reply('\n请先去米游社绑定角色', false, { at: this.userId })
        break
      case 10101:
        this.disableToday()
        this.e.reply('查询已达今日上限')
        break
      case 10102:
        if (res.message == 'Data is not public for the user') {
          this.e.reply(`\nUID:${this.uid}，米游社数据未公开`, false, { at: this.userId })
        } else {
          this.e.reply(`uid:${this.uid}，请先去米游社绑定角色`)
        }
        break
        // 伙伴不存在~
      case -1002:
        if (res.api == 'detail') res.retcode = 0
        break
      default:
        this.e.reply(`米游社接口报错，暂时无法查询：${res.message || 'error'}`)
        break
    }

    if (res.retcode !== 0) {
      logger.mark(`[mys接口报错]${JSON.stringify(res)}，uid：${this.uid}`)
    }

    return res
  }

  /** 删除失效ck */
  async delCk () {
    let ltuid = this.ckInfo.ltuid

    if (!this.ckUser) {
      return false
    }
    let ckUser = this.ckUser
    await ckUser.del()

    /** 记录公共ck失效 */
    if (this.ckInfo.type == 'public') {
      if (bingCkLtuid[ltuid]) {
        this.ckInfo = bingCkLtuid[ltuid]
        this.ckInfo.type = 'self'
      } else {
        logger.mark(`[删除失效ck][ltuid:${ltuid}]`)
      }

      await this.redisDel(ltuid)
    }

    if (this.ckInfo.type == 'self' || this.ckInfo.type == 'bing') {
      /** 获取用户绑定ck */
      let ck = GsCfg.getBingCkSingle(this.ckInfo.qq)
      let tmp = ck[this.ckInfo.uid]
      if (tmp) {
        ltuid = tmp.ltuid

        logger.mark(`[删除失效绑定ck][qq:${this.userId}]`)
        /** 删除文件保存ck */
        delete ck[this.ckInfo.uid]
        delete pubCk[ltuid]
        delete bingCkUid[tmp.uid]
        delete bingCkQQ[tmp.qq]
        /** 将下一个ck设为主ck */
        if (tmp.isMain && lodash.size(ck) >= 1) {
          for (let i in ck) {
            if (!ck[i].isMain) {
              ck[i].isMain = true
              bingCkQQ[tmp.qq] = ck[i]
              await redis.setEx(`${MysInfo.key.qqUid}${this.userId}`, 3600 * 24 * 30, String(ck[i].uid))
              break
            }
          }
        }
        GsCfg.saveBingCk(this.ckInfo.qq, ck)

        await this.redisDel(ltuid)
      }
    }

    delete pubCk[ltuid]
  }

  async redisDel (ltuid) {
    /** 统计次数设为超限 */
    await redis.zRem(MysInfo.key.count, String(ltuid))
    // await redis.setEx(`${MysInfo.key.ckNum}${ltuid}`, this.getEnd(), '99')

    /** 将当前查询记录移入回收站 */
    await this.detailDel(ltuid)
  }

  /** 将当前查询记录移入回收站 */
  async detailDel (ltuid) {
    let detail = await redis.zRangeByScore(MysInfo.key.detail, ltuid, ltuid)
    if (!lodash.isEmpty(detail)) {
      let delDetail = []
      detail.forEach((v) => {
        delDetail.push({ score: ltuid, value: String(v) })
      })
      await redis.zAdd(MysInfo.key.delDetail, delDetail)
      this.expire(MysInfo.key.delDetail)
    }
    /** 删除当前ck查询记录 */
    await redis.zRemRangeByScore(MysInfo.key.detail, ltuid, ltuid)
  }

  async disableToday () {
    /** 统计次数设为超限 */
    await redis.zAdd(MysInfo.key.count, { score: 99, value: String(this.ckInfo.ltuid) })
    await redis.setEx(`${MysInfo.key.ckNum}${this.ckInfo.ltuid}`, this.getEnd(), '99')
  }

  async expire (key) {
    return await redis.expire(key, this.getEnd())
  }

  getEnd () {
    let end = moment().endOf('day').format('X')
    return end - moment().format('X')
  }

  async delBingCk (ck) {
    delete bingCkUid[ck.uid]
    delete bingCkQQ[ck.qq]
    delete bingCkLtuid[ck.ltuid]
    delete tmpCk[ck.uid]
    this.detailDel(ck.ltuid)
  }

  async resetCk () {
    await MysInfo.initCache(true)
  }

  static async initCk () {
    if (lodash.isEmpty(bingCkUid)) {
      let mysInfo = new MysInfo()
      await mysInfo.initBingCk()
    }
  }

  static async getBingCkUid () {
    await MysInfo.initCk()

    return { ...bingCkUid }
  }

  /** 切换uid */
  static toggleUid (qq, ck) {
    bingCkQQ[qq] = ck
  }

  static async checkUidBing (uid) {
    await MysInfo.initCk()

    if (bingCkUid[uid]) return bingCkUid[uid]

    return false
  }
}
