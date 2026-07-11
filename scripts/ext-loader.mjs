// ── 테스트용 ESM 로더 훅 (의존성 0) ────────────────────────────────
// 엔진 파일들은 Vite 관례대로 확장자 없는 상대 임포트(`import x from './grades'`)를
// 쓰고, 일부(notify.js)는 Vite 전역 `import.meta.env` 와 실 Supabase 싱글턴
// (`./supabase`)에 의존한다. 순정 Node ESM 은 이 셋을 그대로 해석하지 못하므로,
// 테스트 실행에서만(소스·Vite 빌드는 전혀 안 건드림) 아래를 보완한다:
//   (1) resolve: 확장자 없는 상대 임포트가 실패하면 `.js` 를 붙여 재시도.
//   (2) resolve: `./supabase`(실 클라이언트 싱글턴)를 인메모리 스텁으로 대체.
//   (3) load:    `import.meta.env` 참조를 안전한 빈 객체로 치환.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// notify.js 가 끌어오는 실 Supabase 싱글턴 대체 스텁(테스트 전용)
const SUPABASE_STUB = new URL('../tests/_supabase-singleton-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  // (2) 실 Supabase 싱글턴 임포트를 스텁으로 리다이렉트.
  //     확장자 없는 상대 임포트 중 마지막 세그먼트가 `supabase` 인 것만 매칭
  //     (notify.js 의 `./supabase` 가 유일 대상 — 다른 테스트는 이 경로를 안 씀).
  if ((specifier.startsWith('./') || specifier.startsWith('../')) &&
      /(^|\/)supabase$/.test(specifier)) {
    return { url: SUPABASE_STUB, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    // (1) 확장자 없는 상대 경로 해석 실패 시 `.js` 보완.
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    const hasExt = /\.[cm]?js$|\.json$/.test(specifier)
    if (relative && !hasExt) {
      return await nextResolve(specifier + '.js', context)
    }
    throw err
  }
}

export async function load(url, context, nextLoad) {
  // (3) `import.meta.env`(Vite 전용 전역, Node 에 없음) 를 빈 객체로 치환.
  //     이 토큰을 가진 소스 .js 파일에만 적용 → 실제로는 notify.js 하나뿐
  //     (supabase.js 는 (2)에서 스텁으로 대체돼 로드되지 않음). 토큰이 없는
  //     파일은 그대로 기본 로더에 위임 → 기존 엔진 테스트 동작 불변.
  if (url.startsWith('file:') && url.endsWith('.js')) {
    let src
    try { src = await readFile(fileURLToPath(url), 'utf8') } catch { src = null }
    if (src != null && src.includes('import.meta.env')) {
      const shimmed = src.split('import.meta.env').join('(globalThis.__VITE_ENV__ ?? {})')
      return { format: 'module', shortCircuit: true, source: shimmed }
    }
  }
  return nextLoad(url, context)
}
