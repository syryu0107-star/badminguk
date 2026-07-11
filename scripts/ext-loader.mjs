// ── 테스트용 ESM 로더 훅 (의존성 0) ────────────────────────────────
// 엔진 파일들은 Vite 관례대로 확장자 없는 상대 임포트(`import x from './grades'`)를
// 쓴다. Node 순정 ESM은 확장자를 자동 보완하지 않으므로, 확장자 없는 상대 경로가
// 해석에 실패하면 `.js`를 붙여 한 번 더 시도한다. (Vite/빌드 동작은 그대로 두고
// 테스트 실행에서만 해석을 보완 — 소스 코드는 전혀 건드리지 않는다.)
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    const hasExt = /\.[cm]?js$|\.json$/.test(specifier)
    if (relative && !hasExt) {
      return await nextResolve(specifier + '.js', context)
    }
    throw err
  }
}
