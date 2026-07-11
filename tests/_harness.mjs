// ── 초경량 테스트 하니스 (의존성 0, node:assert만 사용) ─────────────
// 순수 엔진(src/lib/*.js)의 회귀 방지용. 각 실행 로그의 "자체 검증 통과"를
// 커밋된 영구 테스트로 고정해, 이후 무인 실행이 엔진을 건드려도 퇴행을 즉시 잡는다.
import assert from 'node:assert/strict'

const TESTS = []

// 테스트 등록 (import 시 부수효과로 쌓임)
export function test(name, fn) {
  TESTS.push({ name, fn })
}

export { assert }

// 등록된 모든 테스트 실행 → 실패 개수 반환
export async function run() {
  let passed = 0
  const failures = []
  for (const { name, fn } of TESTS) {
    try {
      await fn()
      passed += 1
    } catch (err) {
      failures.push({ name, err })
    }
  }
  const total = TESTS.length
  if (failures.length) {
    console.error(`\n✗ ${failures.length}/${total} 테스트 실패:\n`)
    for (const { name, err } of failures) {
      console.error(`  ✗ ${name}`)
      console.error(`    ${(err && err.message ? err.message : String(err)).split('\n').join('\n    ')}`)
    }
  }
  console.log(`\n${failures.length ? '✗' : '✓'} 엔진 테스트: ${passed}/${total} 통과`)
  return failures.length
}
