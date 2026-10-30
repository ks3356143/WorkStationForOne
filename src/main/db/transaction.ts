import type { DatabaseSync } from 'node:sqlite'

let savepointSeq = 0

/**
 * 同一连接上的可嵌套事务：最外层用 BEGIN，内层用 SAVEPOINT。
 * MCP 写入需要在业务事务里追加审计，而仓储自己也会开事务；
 * 没有嵌套支持时内层 BEGIN 会直接报错。
 */
export function runInTransaction<T>(db: DatabaseSync, run: () => T): T {
  if (db.isTransaction) {
    savepointSeq += 1
    const name = `sp_${savepointSeq}`
    db.exec(`SAVEPOINT ${name}`)
    try {
      const result = run()
      db.exec(`RELEASE ${name}`)
      return result
    } catch (error) {
      db.exec(`ROLLBACK TO ${name}`)
      db.exec(`RELEASE ${name}`)
      throw error
    }
  }

  db.exec('BEGIN')
  try {
    const result = run()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
