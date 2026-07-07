import { useNavigate } from 'react-router-dom'

export default function RoleLanding() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 헤더 로고 */}
      <div className="pt-16 pb-8 text-center px-6">
        <div
          className="w-20 h-20 rounded-3xl mx-auto mb-4 flex items-center justify-center text-4xl shadow-lg"
          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
        >
          🏸
        </div>
        <h1 className="text-2xl font-black tracking-tight">배드민국</h1>
        <p className="text-sm text-gray-400 mt-1">대한민국 배드민턴 공인 MMR</p>
      </div>

      {/* 역할 선택 */}
      <div className="flex-1 px-6 pb-10">
        <h2 className="text-lg font-black text-center mb-2">어떤 역할로 입장할까요?</h2>
        <p className="text-sm text-gray-400 text-center mb-8">
          한 계정으로 두 역할 모두 이용 가능합니다.
        </p>

        <div className="space-y-4">
          {/* 선수 */}
          <button
            onClick={() => navigate('/home')}
            className="w-full rounded-3xl p-6 text-left text-white active:scale-[.98]
                       transition-transform shadow-lg"
            style={{ background: 'linear-gradient(135deg, #C60C30, #a00a28)' }}
          >
            <div className="flex items-center gap-4">
              <span className="text-5xl">🏸</span>
              <div>
                <p className="text-xl font-black">선수</p>
                <p className="text-white/70 text-sm mt-0.5">
                  내 MMR 확인 · 대회 참가 · 전국 랭킹
                </p>
              </div>
            </div>
          </button>

          {/* 주최자 */}
          <button
            onClick={() => navigate('/organizer')}
            className="w-full rounded-3xl p-6 text-left text-white active:scale-[.98]
                       transition-transform shadow-lg"
            style={{ background: 'linear-gradient(135deg, #003478, #001f4d)' }}
          >
            <div className="flex items-center gap-4">
              <span className="text-5xl">🏟️</span>
              <div>
                <p className="text-xl font-black">대회 주최자</p>
                <p className="text-white/70 text-sm mt-0.5">
                  AI 대진표 · 실시간 스코어 · 참가자 관리
                </p>
              </div>
            </div>
          </button>
        </div>

        <p className="text-xs text-gray-300 text-center mt-8">
          전화번호로 본인 확인 후 서비스를 이용할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
