import TopBar from '../../components/TopBar'

const EFFECTIVE_DATE = '2026-07-09'
const OPERATOR = '유승연'
const CONTACT = 'ninepremium@naver.com'

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-bold text-gray-800 mb-2">{title}</h2>
      <div className="text-sm text-gray-600 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {head.map(h => (
              <th key={h} className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="border border-gray-200 px-2 py-1.5 text-gray-600">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Privacy() {
  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-white">
      <TopBar title="개인정보처리방침" />
      <div className="px-5 py-6 pb-16">
        <p className="text-xs text-gray-400 mb-6">시행일: {EFFECTIVE_DATE}</p>

        <Section title="1. 수집하는 개인정보와 목적">
          <Table
            head={['항목', '목적', '보유 기간']}
            rows={[
              ['휴대전화번호', '본인 확인·로그인·대회 알림', '탈퇴 시까지'],
              ['이름·생년월일 (선택)', '대회 당일 대리출전 방지 신원 확인', '탈퇴 시까지'],
              ['닉네임·급수·활동지역', '랭킹·대진표 표시', '탈퇴 시까지'],
              ['경기 기록·MMR', '랭킹 산정·급수 관리', '아래 5항 참조'],
              ['접속 로그', '서비스 안정성·부정 이용 방지', '3개월'],
            ]}
          />
          <p className="font-semibold text-gray-700">주민등록번호는 수집하지 않습니다.</p>
        </Section>

        <Section title="2. 처리 위탁">
          <Table
            head={['수탁자', '위탁 업무']}
            rows={[
              ['Supabase Inc.', '데이터 보관·인증 처리'],
              ['Vercel Inc.', '웹 서비스 호스팅'],
              ['문자 발송사(도입 시 고지)', '인증번호·알림 문자 발송'],
            ]}
          />
        </Section>

        <Section title="3. 개인정보의 국외 이전">
          <p>
            클라우드 인프라 이용을 위해 1항의 정보가 Supabase Inc.·Vercel Inc.(미국 등 해외 리전)에
            보관됩니다. 국외 이전을 거부할 수 있으나 이 경우 서비스 이용이 불가능합니다.
          </p>
        </Section>

        <Section title="4. 만 14세 미만 아동">
          <p>만 14세 미만은 가입할 수 없습니다.</p>
        </Section>

        <Section title="5. 파기와 기록의 처리">
          <p>탈퇴 시 식별정보(전화번호·이름·생년월일)는 지체 없이 파기합니다.</p>
          <p>
            단, 대회 기록(대진표·경기 결과·순위)은 다른 참가자의 기록과 분리할 수 없는 공적 기록이므로
            식별정보를 제거하고 가명 처리("탈퇴한 선수")하여 보존합니다.
          </p>
        </Section>

        <Section title="6. 이용자의 권리">
          <p>
            언제든지 개인정보의 열람·정정·삭제·처리정지를 요구할 수 있습니다.
            앱 내 프로필 화면 또는 아래 연락처로 요청하면 지체 없이 처리합니다.
          </p>
        </Section>

        <Section title="7. 안전성 확보 조치">
          <p>데이터베이스 행 수준 접근 제어, 전송 구간 암호화(HTTPS), 운영 화면에서의 실명·생년월일 마스킹을 적용합니다.</p>
        </Section>

        <Section title="8. 개인정보 보호책임자">
          <p>성명: {OPERATOR}</p>
          <p>연락처: {CONTACT}</p>
        </Section>

        <Section title="9. 방침의 변경">
          <p>변경 시 시행 7일 전부터 앱 내 공지로 알립니다.</p>
        </Section>
      </div>
    </div>
  )
}
