// ── 인메모리 Supabase 스텁 (테스트 전용, 의존성 0) ──────────────────────
// supabase-dependent 엔진(advance.js 등 DB 변이 로직)을 커밋된 회귀 테스트로
// 고정하기 위한 최소 목(mock). 실제 PostgREST 클라이언트의 체이닝 표면 중
// 엔진이 실제로 쓰는 부분만 흉내낸다:
//   from(t).select(cols[, join]).eq/in().order().single()  → { data, error }
//   from(t).update(patch).eq()                              → { error }
//   from(t).insert(rows)                                    → { error }
//   from(t).delete().eq()                                   → { error }
//   rpc(name, args)                                         → { data, error }
//
// select 의 임베디드 조인(`alias:child(*)`)은 child.match_id === row.id 로 접합한다
// (앱에서 조인되는 유일 관계가 match_scores(match_id→id)라 그 FK를 사용).
// 쿼리 빌더는 thenable 이라 `await` 로 종단된다.

function clone(row) {
  const out = {}
  for (const k of Object.keys(row)) {
    const v = row[k]
    out[k] = Array.isArray(v) ? v.map(x => (x && typeof x === 'object' ? { ...x } : x)) : v
  }
  return out
}

class Query {
  constructor(db, table, opts) {
    this.db = db
    this.table = table
    this.opts = opts
    this.op = 'select'
    this.cols = '*'
    this.filters = []
    this.orderCol = null
    this._single = false
    this._payload = null
  }
  select(cols = '*', opts = null) { this.op = 'select'; this.cols = cols; this._selectOpts = opts; return this }
  update(patch) { this.op = 'update'; this._payload = patch; return this }
  insert(rows) { this.op = 'insert'; this._payload = rows; return this }
  delete() { this.op = 'delete'; return this }
  eq(col, val) { this.filters.push(['eq', col, val]); return this }
  in(col, arr) { this.filters.push(['in', col, arr]); return this }
  order(col) { this.orderCol = col; return this }
  single() { this._single = true; return this }

  _match(row) {
    return this.filters.every(([t, col, val]) =>
      t === 'eq' ? row[col] === val : Array.isArray(val) && val.includes(row[col]))
  }

  _rows() {
    return (this.db[this.table] ?? []).filter(r => this._match(r))
  }

  _applyJoins(rows) {
    // cols 안의 `alias:child(*)` 조인 스펙을 찾아 각 행에 부착
    const re = /(\w+):(\w+)\(\*\)/g
    const specs = []
    let m
    while ((m = re.exec(this.cols)) !== null) specs.push({ alias: m[1], child: m[2] })
    if (!specs.length) return rows
    return rows.map(r => {
      const out = clone(r)
      for (const { alias, child } of specs) {
        out[alias] = (this.db[child] ?? []).filter(c => c.match_id === r.id).map(clone)
      }
      return out
    })
  }

  _run() {
    if (this.op === 'select') {
      // count/head 모드: PostgREST 의 `.select('*', { count:'exact', head:true })`
      // (autoDraw.autoGenerateBracket 이 "이미 대진표가 있나" 판정에 사용) → { count, data }.
      if (this._selectOpts && this._selectOpts.count) {
        const n = this._rows().length
        return { data: this._selectOpts.head ? null : this._rows().map(clone), count: n, error: null }
      }
      let rows = this._rows().map(clone)
      rows = this._applyJoins(rows)
      if (this.orderCol) {
        rows.sort((a, b) => {
          const x = a[this.orderCol], y = b[this.orderCol]
          if (x == null && y == null) return 0
          if (x == null) return -1
          if (y == null) return 1
          return x < y ? -1 : x > y ? 1 : 0
        })
      }
      if (this._single) {
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: rows[0] ?? null, error: { message: rows.length ? '복수 행' : '행 없음' } }
      }
      return { data: rows, error: null }
    }
    if (this.op === 'update') {
      for (const r of this._rows()) Object.assign(r, this._payload)
      return { error: null }
    }
    if (this.op === 'insert') {
      const rows = Array.isArray(this._payload) ? this._payload : [this._payload]
      this.db[this.table] = [...(this.db[this.table] ?? []), ...rows.map(clone)]
      return { error: null }
    }
    if (this.op === 'delete') {
      this.db[this.table] = (this.db[this.table] ?? []).filter(r => !this._match(r))
      return { error: null }
    }
    return { data: null, error: null }
  }

  // thenable → await 로 종단
  then(resolve, reject) {
    try { resolve(this._run()) } catch (e) { reject(e) }
  }
}

/**
 * 인메모리 Supabase 스텁 생성.
 * @param {object} seed { [table]: rows[] } — 초기 데이터(클론되어 저장됨)
 * @param {object} [opts] { rpc?: (name,args)=>({data,error}) } — RPC 응답 커스터마이즈
 * @returns supabase 유사 객체 (+ _db 로 상태 확인, _rpcCalls 로 호출 검사)
 */
export function makeSupabase(seed = {}, opts = {}) {
  const db = {}
  for (const k of Object.keys(seed)) db[k] = (seed[k] ?? []).map(clone)
  const rpcCalls = []
  return {
    _db: db,
    _rpcCalls: rpcCalls,
    from(table) { return new Query(db, table, opts) },
    rpc(name, args) {
      rpcCalls.push({ name, args })
      const r = opts.rpc ? opts.rpc(name, args) : { data: [], error: null }
      return Promise.resolve(r)
    },
  }
}
