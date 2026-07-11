// ── 테스트 러너 ────────────────────────────────────────────────────
// `npm test` 진입점. tests/*.test.mjs 를 모두 로드(테스트 등록)한 뒤 실행하고,
// 실패가 있으면 종료 코드 1 로 빠져 CI/빌드가 퇴행을 잡게 한다.
import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { run } from '../tests/_harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const testsDir = join(here, '..', 'tests')

const files = (await readdir(testsDir))
  .filter(f => f.endsWith('.test.mjs'))
  .sort()

for (const f of files) {
  await import(pathToFileURL(join(testsDir, f)).href)
}

const failures = await run()
process.exit(failures ? 1 : 0)
