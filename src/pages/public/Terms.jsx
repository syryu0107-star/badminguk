import TopBar from '../../components/TopBar'

const EFFECTIVE_DATE = '2026-07-09'
const OPERATOR = '유승연'
const CONTACT = 'ninepremium@naver.com'

function Article({ no, title, children }) {
  return (
    <section className="mb-5">
      <h2 className="text-base font-bold text-gray-800 mb-1.5">제{no}조 ({title})</h2>
      <div className="text-sm text-gray-600 leading-relaxed space-y-1.5">{children}</div>
    </section>
  )
}

export default function Terms() {
  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-white">
      <TopBar title="이용약관" />
      <div className="px-5 py-6 pb-16">
        <p className="text-xs text-gray-400 mb-6">시행일: {EFFECTIVE_DATE} · 운영자: {OPERATOR} ({CONTACT})</p>

        <Article no={1} title="목적">
          <p>이 약관은 배드민국(이하 "서비스")의 이용 조건과 운영자·이용자 간의 권리·의무를 정합니다.</p>
        </Article>

        <Article no={2} title="서비스의 내용">
          <p>
            서비스는 배드민턴 대회의 개설·참가 신청·대진표·경기 진행·기록 관리와,
            경기 결과에 기반한 실력 지표(MMR)·랭킹을 제공합니다.
          </p>
        </Article>

        <Article no={3} title="회원가입">
          <p>1. 휴대전화번호 인증으로 가입합니다. 만 14세 미만은 가입할 수 없습니다.</p>
          <p>2. 타인의 전화번호·명의로 가입하거나 타인 명의로 대회에 출전하는 행위는 금지됩니다.</p>
        </Article>

        <Article no={4} title="경기 기록과 MMR의 공개성">
          <p>
            1. 대회 참가 시 이름(또는 닉네임), 급수, 경기 결과, 순위는 대진표·스코어보드·랭킹에
            공개됩니다. 이는 대회라는 공개 경기의 성격상 필수적인 공개입니다.
          </p>
          <p>
            2. MMR과 랭킹은 경기 결과에 따라 자동 산정되며 임의 수정을 요구할 수 없습니다.
            기록 오류에 대한 이의신청은 제10조에 따릅니다.
          </p>
        </Article>

        <Article no={5} title="대회 참가">
          <p>
            1. 대회의 주최자는 서비스 운영자가 아닌 각 대회 개설자입니다.
            대회 요강(참가 자격, 참가비, 일정, 규정)은 주최자가 정하고 그 이행 책임도 주최자에게 있습니다.
          </p>
          <p>
            2. 참가자는 본인의 실제 급수에 맞게 참가해야 하며, 실력을 속여 하위 급수로 출전하는
            행위는 제재 대상입니다.
          </p>
        </Article>

        <Article no={6} title="대회 당일 신원 확인">
          <p>
            주최자는 대리출전 방지를 위해 체크인 시 이름·생년월일 확인을 요구할 수 있습니다.
            확인을 거부하면 출전이 제한될 수 있습니다.
          </p>
        </Article>

        <Article no={7} title="참가비와 환불">
          <p>참가비의 수납·환불은 대회 요강에 따르며, 1차 책임은 주최자에게 있습니다.</p>
        </Article>

        <Article no={8} title="금지 행위">
          <p>다음 행위 시 경고, 기록 무효화, 이용 정지 등의 조치를 할 수 있습니다.</p>
          <p>1. 대리출전, 급수 사기, 승부 조작(고의 패배 포함)</p>
          <p>2. 점수·기록의 허위 입력</p>
          <p>3. 타인의 개인정보 도용</p>
          <p>4. 대회 운영 방해, 심판·운영진·다른 참가자에 대한 폭언·폭력</p>
        </Article>

        <Article no={9} title="안전과 면책">
          <p>1. 배드민턴은 신체 활동을 수반하며, 참가자는 자신의 건강 상태를 확인하고 참가해야 합니다.</p>
          <p>
            2. 대회 중 발생한 부상·사고에 대해 서비스 운영자는 고의·중과실이 없는 한 책임지지
            않습니다. 대회별 보험 가입 여부는 주최자의 요강을 확인하세요.
          </p>
        </Article>

        <Article no={10} title="이의신청">
          <p>
            경기 결과·기록에 오류가 있는 경우 대회 종료 후 7일 이내에 이의신청할 수 있습니다.
            정정이 확정되면 관련 MMR은 재계산됩니다.
          </p>
        </Article>

        <Article no={11} title="서비스의 변경·중단">
          <p>운영자는 서비스 개선을 위해 기능을 변경할 수 있으며, 중대한 변경은 사전 공지합니다.</p>
        </Article>

        <Article no={12} title="분쟁 해결">
          <p>이 약관은 대한민국 법률에 따르며, 분쟁은 민사소송법상 관할 법원에 제기합니다.</p>
        </Article>
      </div>
    </div>
  )
}
