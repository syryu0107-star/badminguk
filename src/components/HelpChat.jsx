import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Sparkles } from 'lucide-react'
import { askBot, suggestedQuestions } from '../lib/chatbot'

// C9 문의 챗봇 UI — 규정 FAQ + 대회 데이터(context) 개인화 응답.
// 외부 키 없이 규칙 기반으로 완결 동작한다(대회 단톡방 문의 응대를 대체).
//
// props:
//   context : { tournament, categories, myEntries } (chatbot.js ctx 형태)
//   title   : 헤더 문구(기본 '대회 도우미')

export default function HelpChat({ context = {}, title = '대회 도우미' }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)
  const chips = suggestedQuestions(context)

  // 처음 열 때 인사말 1회
  useEffect(() => {
    if (open && msgs.length === 0) {
      setMsgs([{
        role: 'bot',
        text: '안녕하세요! 대회 도우미예요. 일정·장소·참가비·규칙 등 궁금한 걸 물어보세요. 아래 버튼을 눌러도 돼요.',
      }])
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, open])

  function send(text) {
    const q = (text ?? input).trim()
    if (!q) return
    const res = askBot(q, context)
    setMsgs(m => [...m, { role: 'user', text: q }, { role: 'bot', text: res.answer, kind: res.kind }])
    setInput('')
  }

  return (
    <>
      {/* 떠 있는 문의 버튼 (480px 프레임 안 우하단, 하단 네비 위) */}
      {!open && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-[55] pointer-events-none">
          <button
            onClick={() => setOpen(true)}
            aria-label="대회 도우미에게 문의하기"
            className="pointer-events-auto absolute right-4 bottom-20 flex items-center gap-1.5
                       px-4 py-3 rounded-full text-white font-bold text-sm shadow-lg
                       active:scale-95 transition"
            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)', marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <MessageCircle size={18} /> 문의
          </button>
        </div>
      )}

      {/* 채팅 시트 */}
      {open && (
        <div className="fixed inset-0 z-[60] flex justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[480px] mt-auto bg-white rounded-t-3xl shadow-2xl flex flex-col"
               style={{ height: '78vh', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                     style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}>
                  <Sparkles size={16} />
                </div>
                <div>
                  <p className="font-bold text-sm leading-tight">{title}</p>
                  <p className="text-[11px] text-gray-400 leading-tight">규정·일정 자동 안내</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="닫기" className="text-gray-400 active:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>

            {/* 메시지 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-line leading-relaxed
                    ${m.role === 'user'
                      ? 'bg-[#003478] text-white rounded-br-sm'
                      : 'bg-white border border-gray-200 text-gray-700 rounded-bl-sm'}`}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            {/* 추천 질문 칩 */}
            {chips.length > 0 && (
              <div className="px-3 pt-2 pb-1 flex gap-2 overflow-x-auto border-t border-gray-100">
                {chips.map(c => (
                  <button key={c} onClick={() => send(c)}
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-blue-50 text-[#003478] active:opacity-80">
                    {c}
                  </button>
                ))}
              </div>
            )}

            {/* 입력창 */}
            <div className="flex items-center gap-2 px-3 py-3 border-t border-gray-100">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
                placeholder="궁금한 걸 입력하세요"
                className="flex-1 border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:border-[#C60C30]"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim()}
                aria-label="보내기"
                className="shrink-0 w-10 h-10 rounded-full text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition"
                style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
              >
                <Send size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
