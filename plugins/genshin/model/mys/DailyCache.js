import moment from 'moment'
import BaseModel from './BaseModel.js'

const servs = ['mys', 'hoyo']
const EX = 3600 * 24

export default class DailyCache extends BaseModel {
  constructor (uid) {
    super()
    const storeKey = DailyCache.getStoreKey(uid)
    // 检查实例缓存
    let self = this._getThis('store', storeKey)
    if (self) {
      return self
    }
    this.keyPre = `Yz:genshin:mys:${storeKey}`
    return this._cacheThis()
  }

  // 传入UID或server标示，返回当日存储对象
  static create (uid) {
    if (!uid) return false
    return new DailyCache(uid)
  }

  /** ---- 基础方法 ---- **/
  // 获取redis表key键值
  getTableKey (key, sub = '') {
    if (sub) {
      return `${this.keyPre}:${key}-${sub}`
    } else {
      return `${this.keyPre}:${key}`
    }
  }

  async initTableKey (key) {
    let tableKey = this.getTableKey(key)
    await redis.expire(tableKey, EX)
    return tableKey
  }

  // 获取server key
  static getServKey (uid) {
    // 判断是mys还是hoyolab
    if (uid === 'sys') {
      return 'sys'
    }
    return /^[6-9]|^hoyo|^os/i.test(uid) ? servs[1] : servs[0]
  }

  static getStoreKey (uid) {
    const serv = DailyCache.getServKey(uid)
    const date = moment().format('MM-DD')
    return `${serv}-${date}`
  }

  static async eachCache (fn) {
    for (const serv of servs) {
      let cache = DailyCache.create(serv)
      if (cache) {
        await fn(cache)
      }
    }
  }

  async exTable (table, hasCount = false) {
    await redis.expire(this.getTableKey(table), EX)
    if (hasCount) {
      await redis.expire(this.getTableKey(table, 'count'), EX)
    }
  }

  /**
   * 【基础数据结构】：Key-Value
   *
   * 每个key对应一个Value
   * 使用redis kv存储,所有操作需要指定表名
   *
   * **/
  // 获取指定key内容，decode = true会进行decode
  async kGet (table, key, decode = false) {
    key = '' + key
    let ret = await redis.hGet(this.getTableKey(table), key)
    if (ret && decode) {
      try {
        ret = JSON.parse(ret)
      } catch (e) {
        ret = false
      }
    }
    return ret
  }

  // 设置指定key内容，若value为数组或对象会自动encode
  async kSet (table, key, value) {
    if (typeof (value) === 'object') {
      value = JSON.stringify(value)
    } else {
      value = '' + value
    }
    return await redis.hSet(this.getTableKey(table), key, value)
  }

  async kDel (table, key) {

  }

  // 获取指定key内容，decode = true会进行decode
  async get (table, decode = false) {
    const tableKey = this.getTableKey(table)
    let ret = await redis.get(tableKey)
    if (ret && decode) {
      ret = JSON.parse(ret)
    }
    return ret
  }

  // 设置指定key内容，若value为数组或对象会自动encode
  async set (table, value) {
    if (typeof (value) === 'object') {
      value = JSON.stringify(value)
    } else {
      value = '' + value
    }
    const tableKey = this.getTableKey(table)
    return await redis.set(tableKey, value, { EX })
  }

  async del (table) {

  }

  /**
   * 【基础数据结构】：Key-List
   *
   * 每个key对应一个list，key必须为数字，list间的item不重复
   * 自动统计list长度并排序
   * 使用redis sorted map存储，所有操作需要指定表名
   *
   * **/
  // 为key-list添加item
  async zAdd (table, key, item) {
    const tableKey = this.getTableKey(table)
    await redis.zAdd(tableKey, { score: key, value: item + '' })

    // 同时更新数量，用于数量统计
    let count = await this.zCount(table, key) || 0
    const countKey = this.getTableKey(table, 'count')
    await redis.zAdd(countKey, { score: count, value: key })
  }

  // 根据key获取list
  async zList (table, key) {
    return await redis.zRangeByScore(this.getTableKey(table), key, key)
  }

  // 获取item所在list对应key
  async zKey (table, item) {
    return await redis.zScore(this.getTableKey(table), item + '')
  }

  // 获取key-list的长度
  async zCount (table, key) {
    return await redis.zCount(this.getTableKey(table), key, key)
  }

  // 获取list-item数量最小的Key
  // 内部场景使用，就简单处理有效范围为0-29
  async zMinKey (table) {
    let keys = await redis.zRangeByScore(this.getTableKey(table, 'count'), 0, 29)
    return keys[0]
  }

  // 禁用某个key
  // 清空所有查询关联，同时不再被zMinKey识别并返回
  async zDisableKey (table, key) {
    // 将count标记为99次，记录并防止被后续分配
    const countKey = this.getTableKey(table, 'count')
    await redis.zAdd(countKey, { score: 99, value: key })
  }

  // 删除某个key
  // 清空所有查询关联，同时不再被zMinKey识别并返回
  async zDel (table, key) {
    // 删除key对应list所有记录
    await redis.zRemRangeByScore(this.getTableKey(table), key, key)
    await this.zDisableKey(table, key)
  }
}
