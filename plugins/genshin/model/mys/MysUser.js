/*
* MysUser 米游社用户类
* 主键ltuid
*
* 一个MysUser对应一个有效CK
* 一个MysUser可能有多个MysUid关联记录
*
* */
import DailyCache from './DailyCache.js'
import BaseModel from './BaseModel.js'
import User from './User.js'
import lodash from 'lodash'

const tables = {
  // ltuid-uid 查询表
  // 表结构：Key-List (key:ltuid，list-item: uid)
  detail: 'query-detail',

  // ltuid-uid 关系表，用于存储ltuid对应uid列表，一个uid仅属于一个ltuid
  // 表结构：Key-List (key:ltuid， value:uid/qq)
  uid: 'ltuid-uid',

  // ltuid-ck 关系表，用于存储ltuid对应ck信息
  // 表结构：Key-Value (key:ltuid， value:ck)
  ck: 'ltuid-ck',

  // ltuid-qq 关系表，用于存储ltuid对应qq，一个ltuid可被多个qq绑定
  // 表结构：Key-Value (key:ltuid， value:[qq])
  // 因为一个qq可以绑定多个ltuid，所以不适宜用Key-List
  qq: 'ltuid-qq',

  // ltuid 已删除的uid查询，供解绑ltuid后重新绑回的查询记录恢复
  // 表结构：Key-Value (key:ltuid，value：序列化uid数组）
  del: 'del-detail'
}

export default class MysUser extends BaseModel {
  constructor (data) {
    super()
    let ltuid = data.ltuid
    if (!ltuid) {
      return false
    }
    console.log('[ltuid]', ltuid)
    // 检查实例缓存
    let self = this._getThis('mys', ltuid)
    if (!self) {
      self = this
    }
    // 单日有效缓存，使用uid区分不同服务器
    self.cache = self.cache || DailyCache.create(data.uid || 'mys')
    // 单日有效缓存，不区分服务器
    self.sysCache = self.sysCache || DailyCache.create('sys')
    self.uids = self.uids || {}
    self.ltuid = data.ltuid
    self.ck = self.ck || data.ck
    self.qq = self.qq || data.qq || 'pub'
    if (data.uid) {
      self.uids[data.uid] = data.uid
      self.ckData = data
    }
    return self._cacheThis()
  }

  // 可传入ltuid、cookie、ck对象来创建MysUser实例
  // 在仅传入ltuid时，必须是之前传入过的才能被识别
  static async create (data) {
    if (!data) {
      return false
    }
    if (lodash.isPlainObject(data)) {
      return new MysUser(data)
    }
    // 传入cookiue
    let testRet = /ltuid=(\w{0,9})/g.exec(data)
    if (testRet && testRet[1]) {
      let ltuid = testRet[1]
      console.log(ltuid, data, /ltuid=(\w{0,9})/g.exec(data))
      // 尝试使用ltuid创建
      let ckUser = await MysUser.create(ltuid)
      if (ckUser) {
        return ckUser
      }
      return new MysUser({
        ltuid,
        ck: data,
        type: 'ck'
      })
    }
    // 传入ltuid
    if (/\d{9}/.test(data)) {
      // 查找ck记录
      let sysCache = DailyCache.create('sys')
      let ckData = await sysCache.kGet(tables.ck, data, true)
      if (ckData && ckData.ltuid) {
        return new MysUser(ckData)
      }
    }
    return false
  }

  static async getByQueryUid (uid) {
    let sysCache = DailyCache.create('sys')
    let cache = DailyCache.create(uid)
    // 查找已经查询过的ltuid || 分配最少查询的ltuid

    // 根据ltuid获取mysUser
    const create = async function (ltuid) {
      if (ltuid) {
        let ckData = await sysCache.kGet(tables.ck, ltuid, true)
        if (ckData && ckData.ltuid) {
          return await MysUser.create(ckData)
        }
      }
      return false
    }

    // 根据uid检索已查询记录。包括公共CK/自己CK/已查询过
    let ret = await create(await cache.zKey(tables.detail, uid))
    if (ret) {
      logger.mark(`[米游社查询][uid：${uid}]${logger.green(`[使用已查询ck：${ret.ltuid}]`)}`)
      return ret
    }

    // 使用CK池内容，分配次数最少的一个ltuid
    ret = await create(await cache.zMinKey(tables.detail))
    if (ret) {
      logger.mark(`[米游社查询][uid：${uid}]${logger.green(`[分配查询ck：${ret.ltuid}]`)}`)
      return ret
    }

    return false
  }

  // 初始化当前MysUser缓存记录
  async initCache (user) {
    if (!this.ltuid || !this.cache) {
      return
    }

    // 为当前MysUser添加uid查询记录
    if (!lodash.isEmpty(this.uids)) {
      for (let uid in this.uids) {
        await this.addQueryUid(uid)
        // 添加ltuid-uid记录，用于判定ltuid绑定个数及自ltuid查询
        await this.sysCache.zAdd(tables.uid, this.ltuid, uid)
      }
    } else {
      // TODO:为了兼容没有UID的情况，使用ltuid插入，待完善
      await this.addQueryUid(this.ltuid)
    }
    // 缓存ckData，供后续缓存使用
    // ltuid关系存储到与server无关的sysCache中，方便后续检索
    await this.sysCache.kSet(tables.ck, this.ltuid, this.ckData)

    // 缓存qq，用于删除ltuid时查找
    if (user && user.qq) {
      let qqArr = await this.sysCache.kGet(tables.qq, this.ltuid, true) || []
      if (!qqArr.includes(user.qq)) {
        qqArr.push(user.qq)
        await this.sysCache.kSet(tables.qq, this.ltuid, qqArr)
      }
    }

    // 从删除记录中查找并恢复查询记录
    let cacheSearchList = await this.cache.get(tables.del, this.ltuid, true)
    // 这里不直接插入，只插入当前查询记录中没有的值
    if (cacheSearchList && cacheSearchList.length > 0) {
      for (let searchedUid of cacheSearchList) {
        // 检查对应uid是否有新的查询记录
        if (!await this.getQueryLtuid(searchedUid)) {
          await this.addQueryUid(searchedUid)
        }
      }
    }

    await this.cache.exTable(tables.detail, true)
    await this.sysCache.exTable(tables.ck)
    await this.sysCache.exTable(tables.uid)
    await this.sysCache.exTable(tables.qq)
  }

  // 删除缓存
  // 供User解绑CK时调用
  async del () {
    // 将查询过的uid缓存起来，以备后续重新绑定时恢复
    let uids = await this.getQueryUids()
    await this.cache.set(tables.del, uids)

    // 标记ltuid为失效
    // 其余缓存无需清除，可忽略
    await this.cache.zDisableKey(tables.detail, this.ltuid)
  }

  // 删除MysUser用户记录，会反向删除User中的记录及绑定关系
  async delWithUser () {
    // 查找用户
    let qqArr = await this.sysCache.kGet(tables.qq, this.ltuid, true)
    if (qqArr && qqArr.length > 0) {
      for (let qq of qqArr) {
        let user = await User.create(qq)
        if (user) {
          // 调用user删除ck
          await user.delCk(this.ltuid, false)
        }
      }
    }

    await this.del()
    // TODO: 实现删除逻辑
  }

  // 为当前用户添加uid查询记录
  async addQueryUid (uid) {
    await this.cache.zAdd(tables.detail, this.ltuid, uid)
  }

  // 获取当前用户已查询uid列表
  async getQueryUids () {
    return await this.cache.zList(tables.detail, this.ltuid)
  }

  // 根据uid获取查询ltuid
  async getQueryLtuid (uid) {
    return await this.cache.zKey(tables.detail, uid)
  }
}
