// ── C1 로컬 브라우저 알림 판정 회귀 테스트 (localnotify.js) ─────────────
// shouldShowLocalNotification 이 OS 알림을 띄울지 결정하는 단일 소스다.
// 여기 불변식이 깨지면 (a) 포커스 중인데 OS 알림까지 떠 중복 알림이 되거나
// (b) 백그라운드인데 안 떠 호출을 놓쳐 부전승 위험이 된다.
import { test, assert } from './_harness.mjs'
import { shouldShowLocalNotification } from '../src/lib/localnotify.js'

test('localnotify: 백그라운드(hidden)+granted+지원 → 띄운다', () => {
  assert.equal(shouldShowLocalNotification({ supported: true, permission: 'granted', hidden: true }), true)
})

test('localnotify: 포커스 중(hidden=false)이면 안 띄운다(배너로 충분·중복 방지)', () => {
  assert.equal(shouldShowLocalNotification({ supported: true, permission: 'granted', hidden: false }), false)
})

test('localnotify: 권한 미허용이면 안 띄운다', () => {
  assert.equal(shouldShowLocalNotification({ supported: true, permission: 'default', hidden: true }), false)
  assert.equal(shouldShowLocalNotification({ supported: true, permission: 'denied', hidden: true }), false)
})

test('localnotify: 브라우저 미지원이면 안 띄운다', () => {
  assert.equal(shouldShowLocalNotification({ supported: false, permission: 'granted', hidden: true }), false)
  assert.equal(shouldShowLocalNotification({ supported: true, permission: 'unsupported', hidden: true }), false)
})

test('localnotify: 인자 누락도 안전하게 false', () => {
  assert.equal(shouldShowLocalNotification({}), false)
})
