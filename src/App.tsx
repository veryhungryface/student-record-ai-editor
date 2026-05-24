import { type ClipboardEvent, type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from 'react'
import './App.css'
import { areas, buildRevisionPrompt, subjectRecords, subjects, type RecordArea, type Subject } from './data'

type DraftState = Record<RecordArea, Record<Subject, Record<number, string>>>
type ResultState = Record<RecordArea, Record<Subject, Record<number, string>>>
type CommentState = Record<RecordArea, Record<Subject, Record<number, string>>>
type HistoryState = Record<RecordArea, Record<Subject, Record<number, string[]>>>

type RowStatus = Record<number, 'idle' | 'loading' | 'done' | 'error'>
type RevisionMode = 'normal' | 'expand' | 'shrink'
type ColumnKey = 'number' | 'name' | 'comment' | 'request' | 'aiAction' | 'result' | 'applyAction'
type ColumnWidths = Record<ColumnKey, number>

const areaLabels: Record<RecordArea, string> = {
  '교과 특기사항': '교과학습발달',
  창체: '창체',
  '행동특성 및 종합의견': '행동발달',
}

// 나이스샷(by issamGPT) 확장 프로그램 ID — 하드코딩
const NEISSHOT_EXT_ID = 'mkpejpjgopbnapcdblomgipgncbbncif'
// 확장 설치 페이지 URL (웹스토어 게시 후 입력 — 비어 있으면 안내 모달에 링크 버튼 미표시)
const NEISSHOT_INSTALL_URL: string = 'https://chromewebstore.google.com/detail/%EB%82%98%EC%9D%B4%EC%8A%A4%EC%83%B7-bybae/hbldfcgjepjeggbfhbghigadegmgfgll?hl=ko&gl=UA'

// 사이트 기재 영역 → 확장 카테고리 코드 (사이드패널 미리보기 제목에 사용됨)
const areaToCategory: Record<RecordArea, string> = {
  '교과 특기사항': 'subject',
  창체: 'creative',
  '행동특성 및 종합의견': 'behavior',
}

type NeisshotResponse = { ok?: boolean; count?: number; error?: string }

type ChromeLike = {
  runtime?: {
    sendMessage?: (
      extensionId: string,
      message: unknown,
      callback: (response?: NeisshotResponse) => void,
    ) => void
    lastError?: { message?: string }
  }
}

function getChrome(): ChromeLike | undefined {
  return (window as unknown as { chrome?: ChromeLike }).chrome
}

// NEIS 셀은 단일 텍스트이므로 평어를 한 줄로 정규화
function normalizeComment(text: string): string {
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const initialColumnWidths: ColumnWidths = {
  number: 42,
  name: 74,
  comment: 550,
  request: 420,
  aiAction: 94,
  result: 338,
  applyAction: 86,
}

const resizeMinimums: ColumnWidths = {
  number: 46,
  name: 64,
  comment: 180,
  request: 220,
  aiAction: 94,
  result: 200,
  applyAction: 64,
}

const revisionModeRequests: Record<RevisionMode, string> = {
  normal: '',
  expand: '기존 평어의 핵심 내용과 문체는 유지하되 글자수를 현재보다 약 130% 수준으로 자연스럽게 늘려 주세요. 관찰 사실과 성장 표현을 조금 더 구체화해 주세요.',
  shrink: '기존 평어의 핵심 내용과 문체는 유지하되 글자수를 현재보다 약 70% 수준으로 자연스럽게 줄여 주세요. 중복 표현은 덜고 핵심만 남겨 주세요.',
}

function createEmptyState(): DraftState {
  return areas.reduce((acc, area) => {
    acc[area] = subjects.reduce((subjectAcc, subject) => {
      subjectAcc[subject] = {}
      return subjectAcc
    }, {} as Record<Subject, Record<number, string>>)
    return acc
  }, {} as DraftState)
}

function createEmptyResults(): ResultState {
  return areas.reduce((acc, area) => {
    acc[area] = subjects.reduce((subjectAcc, subject) => {
      subjectAcc[subject] = {}
      return subjectAcc
    }, {} as Record<Subject, Record<number, string>>)
    return acc
  }, {} as ResultState)
}


function createCommentState(): CommentState {
  return areas.reduce((acc, area) => {
    acc[area] = subjects.reduce((subjectAcc, subject) => {
      subjectAcc[subject] = Object.fromEntries(
        subjectRecords[area][subject].map((row) => [row.studentNo, row.comment]),
      )
      return subjectAcc
    }, {} as Record<Subject, Record<number, string>>)
    return acc
  }, {} as CommentState)
}

function createEmptyHistory(): HistoryState {
  return areas.reduce((acc, area) => {
    acc[area] = subjects.reduce((subjectAcc, subject) => {
      subjectAcc[subject] = {}
      return subjectAcc
    }, {} as Record<Subject, Record<number, string[]>>)
    return acc
  }, {} as HistoryState)
}

async function reviseComment(prompt: string) {
  const response = await fetch('/api/revise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `요청 오류: ${response.status}`)
  }
  if (typeof data.text === 'string' && data.text.trim()) {
    return data.text.trim()
  }
  throw new Error(data.error || 'AI 응답에서 수정 문구를 찾지 못했습니다.')
}

function App() {
  const [activeArea, setActiveArea] = useState<RecordArea>('교과 특기사항')
  const [activeSubject, setActiveSubject] = useState<Subject>('국어')
  const [drafts, setDrafts] = useState<DraftState>(() => createEmptyState())
  const [results, setResults] = useState<ResultState>(() => createEmptyResults())
  const [comments, setComments] = useState<CommentState>(() => createCommentState())
  const [history, setHistory] = useState<HistoryState>(() => createEmptyHistory())
  const [historyRow, setHistoryRow] = useState<number | null>(null)
  const [rowStatus, setRowStatus] = useState<RowStatus>({})
  const [isRunning, setIsRunning] = useState(false)
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(initialColumnWidths)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const [installNoticeOpen, setInstallNoticeOpen] = useState(false)
  const [sentNoticeOpen, setSentNoticeOpen] = useState(false)
  const [sentCount, setSentCount] = useState(0)

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }

  const rows = useMemo(() => subjectRecords[activeArea][activeSubject], [activeArea, activeSubject])

  const updateDraft = (studentNo: number, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: {
          ...prev[activeArea][activeSubject],
          [studentNo]: value,
        },
      },
    }))
  }

  const reviseSingleRow = async (studentNo: number, mode: RevisionMode = 'normal') => {
    const row = rows.find((item) => item.studentNo === studentNo)
    if (!row) return
    setRowStatus((prev) => ({ ...prev, [row.studentNo]: 'loading' }))

    try {
      const teacherRequest = drafts[activeArea][activeSubject][row.studentNo] ?? ''
      const editRequest = [teacherRequest, revisionModeRequests[mode]].filter(Boolean).join('\n')
      const prompt = buildRevisionPrompt({
        area: activeArea,
        subject: activeSubject,
        name: row.name,
        originalComment: comments[activeArea][activeSubject][row.studentNo] ?? row.comment,
        editRequest,
      })
      const revised = await reviseComment(prompt)
      setResults((prev) => ({
        ...prev,
        [activeArea]: {
          ...prev[activeArea],
          [activeSubject]: {
            ...prev[activeArea][activeSubject],
            [row.studentNo]: revised,
          },
        },
      }))
      setRowStatus((prev) => ({ ...prev, [row.studentNo]: 'done' }))
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [activeArea]: {
          ...prev[activeArea],
          [activeSubject]: {
            ...prev[activeArea][activeSubject],
            [row.studentNo]: error instanceof Error ? `오류: ${error.message.slice(0, 140)}` : '오류가 발생했습니다.',
          },
        },
      }))
      setRowStatus((prev) => ({ ...prev, [row.studentNo]: 'error' }))
    }
  }

  const runAiRevision = async (mode: RevisionMode = 'normal') => {
    setIsRunning(true)
    setRowStatus(Object.fromEntries(rows.map((row) => [row.studentNo, 'loading'])))

    const nextResults = { ...results[activeArea][activeSubject] }
    const nextStatus: RowStatus = {}

    for (const row of rows) {
      try {
        const teacherRequest = drafts[activeArea][activeSubject][row.studentNo] ?? ''
        const editRequest = [teacherRequest, revisionModeRequests[mode]].filter(Boolean).join('\n')
        const prompt = buildRevisionPrompt({
          area: activeArea,
          subject: activeSubject,
          name: row.name,
          originalComment: comments[activeArea][activeSubject][row.studentNo] ?? row.comment,
          editRequest,
        })
        nextResults[row.studentNo] = await reviseComment(prompt)
        nextStatus[row.studentNo] = 'done'
      } catch (error) {
        nextResults[row.studentNo] = error instanceof Error ? `오류: ${error.message.slice(0, 140)}` : '오류가 발생했습니다.'
        nextStatus[row.studentNo] = 'error'
      }
      setResults((prev) => ({
        ...prev,
        [activeArea]: {
          ...prev[activeArea],
          [activeSubject]: { ...nextResults },
        },
      }))
      setRowStatus((prev) => ({ ...prev, ...nextStatus }))
    }

    setIsRunning(false)
  }

  const fillSampleRequests = () => {
    const samples = [
      '더 구체적이고 따뜻하게',
      '성장 중심 표현 추가',
      '발표 태도 강조',
      '협력 태도 포함',
      '짧고 자연스럽게',
      '학습 습관이 드러나게',
      '긍정적인 어조 강화',
      '교사용 문체로 정돈',
      '관찰 사실 중심으로',
      '노력 과정 강조',
    ]
    setDrafts((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: Object.fromEntries(rows.map((row, index) => [row.studentNo, samples[index]])),
      },
    }))
  }

  const applyResult = (studentNo: number) => {
    const revised = results[activeArea][activeSubject][studentNo]
    if (!revised || revised.startsWith('오류:')) {
      return
    }

    const currentComment = comments[activeArea][activeSubject][studentNo] ?? ''
    setHistory((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: {
          ...prev[activeArea][activeSubject],
          [studentNo]: [...(prev[activeArea][activeSubject][studentNo] ?? []), currentComment],
        },
      },
    }))
    setComments((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: {
          ...prev[activeArea][activeSubject],
          [studentNo]: revised,
        },
      },
    }))
    setResults((prev) => {
      const nextSubjectResults = { ...prev[activeArea][activeSubject] }
      delete nextSubjectResults[studentNo]
      return {
        ...prev,
        [activeArea]: {
          ...prev[activeArea],
          [activeSubject]: nextSubjectResults,
        },
      }
    })
    setRowStatus((prev) => ({ ...prev, [studentNo]: 'idle' }))
  }

  const applyAllResults = () => {
    const applicableRows = rows.filter((row) => {
      const revised = results[activeArea][activeSubject][row.studentNo]
      return revised && !revised.startsWith('오류:')
    })

    if (!applicableRows.length) {
      return
    }

    setHistory((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: {
          ...prev[activeArea][activeSubject],
          ...Object.fromEntries(
            applicableRows.map((row) => [
              row.studentNo,
              [
                ...(prev[activeArea][activeSubject][row.studentNo] ?? []),
                comments[activeArea][activeSubject][row.studentNo] ?? '',
              ],
            ]),
          ),
        },
      },
    }))
    setComments((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: {
          ...prev[activeArea][activeSubject],
          ...Object.fromEntries(applicableRows.map((row) => [row.studentNo, results[activeArea][activeSubject][row.studentNo]])),
        },
      },
    }))
    setResults((prev) => {
      const nextSubjectResults = { ...prev[activeArea][activeSubject] }
      applicableRows.forEach((row) => {
        delete nextSubjectResults[row.studentNo]
      })
      return {
        ...prev,
        [activeArea]: {
          ...prev[activeArea],
          [activeSubject]: nextSubjectResults,
        },
      }
    })
    setRowStatus((prev) => ({
      ...prev,
      ...Object.fromEntries(applicableRows.map((row) => [row.studentNo, 'idle' as const])),
    }))
  }

  const restoreComment = (studentNo: number, historyIndex: number) => {
    const target = history[activeArea][activeSubject][studentNo]?.[historyIndex]
    if (!target) return
    const currentComment = comments[activeArea][activeSubject][studentNo] ?? ''
    setHistory((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: {
          ...prev[activeArea][activeSubject],
          [studentNo]: [...(prev[activeArea][activeSubject][studentNo] ?? []), currentComment],
        },
      },
    }))
    setComments((prev) => ({
      ...prev,
      [activeArea]: {
        ...prev[activeArea],
        [activeSubject]: {
          ...prev[activeArea][activeSubject],
          [studentNo]: target,
        },
      },
    }))
    setHistoryRow(null)
  }

  const handleRequestPaste = (event: ClipboardEvent<HTMLTextAreaElement>, studentNo: number) => {
    const text = event.clipboardData.getData('text')
    if (!text.includes('\t') && !text.includes('\n')) return

    event.preventDefault()
    const values = text
      .split(/\r?\n/)
      .flatMap((line) => line.split('\t'))
      .map((value) => value.trim())
      .filter(Boolean)
    const startIndex = rows.findIndex((row) => row.studentNo === studentNo)
    if (startIndex < 0 || !values.length) return

    setDrafts((prev) => {
      const nextSubjectDrafts = { ...prev[activeArea][activeSubject] }
      values.forEach((value, offset) => {
        const targetRow = rows[startIndex + offset]
        if (targetRow) nextSubjectDrafts[targetRow.studentNo] = value
      })
      return {
        ...prev,
        [activeArea]: {
          ...prev[activeArea],
          [activeSubject]: nextSubjectDrafts,
        },
      }
    })
  }

  const focusRequestCell = (studentNo: number) => {
    document.getElementById(`request-${studentNo}`)?.focus()
  }

  const handleRequestKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, studentNo: number) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      reviseSingleRow(studentNo)
      return
    }

    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const target = event.currentTarget
    const atStart = target.selectionStart === 0 && target.selectionEnd === 0
    const atEnd = target.selectionStart === target.value.length && target.selectionEnd === target.value.length
    if ((event.key === 'ArrowUp' && !atStart) || (event.key === 'ArrowDown' && !atEnd)) return

    event.preventDefault()
    const currentIndex = rows.findIndex((row) => row.studentNo === studentNo)
    const nextRow = rows[currentIndex + (event.key === 'ArrowUp' ? -1 : 1)]
    if (nextRow) focusRequestCell(nextRow.studentNo)
  }

  const handleColumnResizeStart = (key: ColumnKey, event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[key]

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = Math.max(resizeMinimums[key], startWidth + moveEvent.clientX - startX)
      setColumnWidths((prev) => ({ ...prev, [key]: nextWidth }))
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const totalColumnWidth = Object.values(columnWidths).reduce((sum, width) => sum + width, 0)
  const getColumnWidth = (key: ColumnKey) => `${(columnWidths[key] / totalColumnWidth) * 100}%`

  const renderHeader = (label: string, key: ColumnKey, className = '') => (
    <th className={className}>
      <span className="header-content">
        <span className="header-label">{label}</span>
      </span>
      {key === 'request' && <span className="paste-bubble">표를 붙여넣어도 되요!</span>}
      {key !== 'aiAction' && (
        <span
          className="column-resizer"
          role="separator"
          aria-label={`${label || '작업'} 열 너비 조정`}
          onPointerDown={(event) => handleColumnResizeStart(key, event)}
        />
      )}
    </th>
  )

  const sendToAutoInput = () => {
    // 현재 화면(활성 영역/과목)의 평어 문구 열만, 표시 순서대로 추출 + 정규화
    const payload = rows
      .map((row) => normalizeComment(comments[activeArea][activeSubject][row.studentNo] ?? row.comment))
      .filter((text) => text.length > 0)

    if (!payload.length) {
      showToast('전송할 평어 문구가 없습니다.')
      return
    }

    const category = areaToCategory[activeArea]

    // 확장 미설치/비활성/비크롬 → 평어를 클립보드에 백업 복사 후 설치 안내 모달 표시
    const handleNotInstalled = () => {
      navigator.clipboard.writeText(payload.join('\n')).catch(() => {})
      setInstallNoticeOpen(true)
    }

    const runtime = getChrome()?.runtime
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      handleNotInstalled()
      return
    }

    try {
      runtime.sendMessage(
        NEISSHOT_EXT_ID,
        { type: 'NEISSHOT_DATA', category, rows: payload },
        (response) => {
          // 확장 미설치/비활성 → lastError 발생
          if (getChrome()?.runtime?.lastError) {
            handleNotInstalled()
            return
          }
          if (response && response.ok) {
            const count = response.count ?? payload.length
            setSentCount(count)
            setSentNoticeOpen(true)
          } else {
            // 설치는 됐지만 요청이 거부됨(출처/형식 등)
            showToast(`전송이 거부되었습니다${response?.error ? ` (${response.error})` : ''}.`)
          }
        },
      )
    } catch {
      handleNotInstalled()
    }
  }

  return (
    <main className="app-shell">
      <section className="sticky-workbar" aria-label="작업 선택 및 일괄 실행">
        <div className="workbar-field area-field">
          <label htmlFor="area-select">기재 영역</label>
          <select
            id="area-select"
            className="workbar-select"
            value={activeArea}
            onChange={(event) => {
              const nextArea = event.target.value as RecordArea
              setActiveArea(nextArea)
              setRowStatus({})
            }}
          >
            {areas.map((area) => (
              <option key={area} value={area}>{areaLabels[area]}</option>
            ))}
          </select>
        </div>

        {activeArea === '교과 특기사항' && (
          <div className="workbar-field subject-field">
            <span>과목</span>
            <div className="subject-tabs compact-subject-tabs" aria-label="과목 선택">
              {subjects.map((subject) => (
                <button
                  className={subject === activeSubject ? 'subject-tab active' : 'subject-tab'}
                  key={subject}
                  type="button"
                  onClick={() => {
                    setActiveSubject(subject)
                    setRowStatus({})
                  }}
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="workbar-actions">
          <button type="button" className="ghost-button sample-button" onClick={fillSampleRequests}>수정 요청 예시 채우기</button>
          <button type="button" className="bulk-action-button" onClick={() => runAiRevision()} disabled={isRunning}>
            {isRunning ? '전체 수정 중' : '모든 학생 AI 수정'}
          </button>
          <button type="button" className="bulk-action-button subtle-action" onClick={() => runAiRevision('expand')} disabled={isRunning}>모두 글자수 늘리기</button>
          <button type="button" className="bulk-action-button subtle-action" onClick={() => runAiRevision('shrink')} disabled={isRunning}>모두 글자수 줄이기</button>
          <button type="button" className="bulk-action-button" onClick={applyAllResults}>모두 반영</button>
          <button type="button" className="ghost-button auto-send-button" onClick={sendToAutoInput}>자동입력으로 보내기</button>
        </div>
      </section>


      <section className="sheet-card">
        <div className="sheet-scroll">
          <table className="student-sheet">
            <colgroup>
              <col className="col-number" style={{ width: getColumnWidth('number') }} />
              <col className="col-name" style={{ width: getColumnWidth('name') }} />
              <col className="col-comment" style={{ width: getColumnWidth('comment') }} />
              <col className="col-request" style={{ width: getColumnWidth('request') }} />
              <col className="col-ai-action" style={{ width: getColumnWidth('aiAction') }} />
              <col className="col-result" style={{ width: getColumnWidth('result') }} />
              <col className="col-apply-action" style={{ width: getColumnWidth('applyAction') }} />
            </colgroup>
            <thead>
              <tr className="column-title-row">
                {renderHeader('번호', 'number')}
                {renderHeader('이름', 'name')}
                {renderHeader('평어 문구', 'comment')}
                {renderHeader('학생활동 추가 또는 수정요청', 'request', 'request-header')}
                {renderHeader('', 'aiAction', 'ai-action-header')}
                {renderHeader('수정 결과', 'result')}
                {renderHeader('반영', 'applyAction')}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${activeArea}-${activeSubject}-${row.studentNo}`}>
                  <td className="number-cell">{row.studentNo}</td>
                  <td className="name-cell">{row.name}</td>
                  <td className="comment-cell">
                    <div className="comment-box">
                      <p>{comments[activeArea][activeSubject][row.studentNo] ?? row.comment}</p>
                      <button
                        type="button"
                        className="history-button"
                        onClick={() => setHistoryRow(row.studentNo)}
                        disabled={!(history[activeArea][activeSubject][row.studentNo]?.length)}
                      >
                        수정내역
                      </button>
                    </div>
                  </td>
                  <td className="request-cell">
                    <textarea
                      id={`request-${row.studentNo}`}
                      value={drafts[activeArea][activeSubject][row.studentNo] ?? ''}
                      onChange={(event) => updateDraft(row.studentNo, event.target.value)}
                      onPaste={(event) => handleRequestPaste(event, row.studentNo)}
                      onKeyDown={(event) => handleRequestKeyDown(event, row.studentNo)}
                      placeholder="예: 더 따뜻하게, 협력 태도 강조, 100자 내외로..."
                    />
                  </td>
                  <td className="ai-action-cell">
                    <div className="row-ai-actions">
                      <button
                        type="button"
                        className="row-ai-button primary-row-ai"
                        onClick={() => reviseSingleRow(row.studentNo)}
                        disabled={isRunning || rowStatus[row.studentNo] === 'loading'}
                        aria-label={`${row.studentNo}번 학생만 AI 수정`}
                      >
                        {rowStatus[row.studentNo] === 'loading' ? '수정 중' : 'AI 수정'}
                      </button>
                      <div className="row-length-actions">
                        <button
                          type="button"
                          className="row-ai-button mini-ai-button"
                          onClick={() => reviseSingleRow(row.studentNo, 'expand')}
                          disabled={isRunning || rowStatus[row.studentNo] === 'loading'}
                          aria-label={`${row.studentNo}번 학생 글자수 늘리기`}
                        >
                          늘리기
                        </button>
                        <button
                          type="button"
                          className="row-ai-button mini-ai-button"
                          onClick={() => reviseSingleRow(row.studentNo, 'shrink')}
                          disabled={isRunning || rowStatus[row.studentNo] === 'loading'}
                          aria-label={`${row.studentNo}번 학생 글자수 줄이기`}
                        >
                          줄이기
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className={`result-cell ${rowStatus[row.studentNo] ?? 'idle'}`}>
                    <p>{rowStatus[row.studentNo] === 'loading' ? '수정 중...' : results[activeArea][activeSubject][row.studentNo] || ''}</p>
                  </td>
                  <td className="apply-action-cell">
                    <button
                      type="button"
                      className="apply-button"
                      onClick={() => applyResult(row.studentNo)}
                      disabled={!results[activeArea][activeSubject][row.studentNo] || results[activeArea][activeSubject][row.studentNo]?.startsWith('오류:')}
                    >
                      반영
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {historyRow !== null && (
        <div className="modal-backdrop" role="presentation" onClick={() => setHistoryRow(null)}>
          <section className="settings-modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Revision History</p>
                <h2 id="history-title">{historyRow}번 학생 수정내역</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setHistoryRow(null)} aria-label="닫기">×</button>
            </div>
            <div className="history-list">
              {(history[activeArea][activeSubject][historyRow] ?? []).map((item, index) => (
                <article className="history-item" key={`${historyRow}-${index}-${item}`}>
                  <strong>{index + 1}번째 이전 문구</strong>
                  <p>{item}</p>
                  <button type="button" className="ghost-button compact-button" onClick={() => restoreComment(historyRow, index)}>
                    이 문구로 되돌리기
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}


      {sentNoticeOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSentNoticeOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="sent-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id="sent-title">데이터를 보냈어요</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setSentNoticeOpen(false)} aria-label="닫기">×</button>
            </div>
            <p style={{ fontSize: '16px', fontWeight: 700, textAlign: 'center', color: '#15233a', margin: '6px 0' }}>평어 {sentCount}건을 자동입력기로 보냈어요.</p>
            <p style={{ fontSize: '14px', lineHeight: 1.7, textAlign: 'center', color: '#5a6b85', margin: 0 }}>키보드에서 <kbd style={{ display: 'inline-block', padding: '2px 9px', border: '1px solid #c9d4e8', borderBottomWidth: '2px', borderRadius: '7px', background: '#f1f5fc', fontWeight: 700, color: '#15233a', fontFamily: 'inherit' }}>Alt</kbd> + <kbd style={{ display: 'inline-block', padding: '2px 9px', border: '1px solid #c9d4e8', borderBottomWidth: '2px', borderRadius: '7px', background: '#f1f5fc', fontWeight: 700, color: '#15233a', fontFamily: 'inherit' }}>G</kbd> 를 눌러 자동입력기를 열어 보세요.</p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="primary-button" onClick={() => setSentNoticeOpen(false)}>확인</button>
            </div>
          </section>
        </div>
      )}

      {installNoticeOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setInstallNoticeOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id="install-title">확장 프로그램이 필요합니다</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setInstallNoticeOpen(false)} aria-label="닫기">×</button>
            </div>
            <p className="helper-text">아직 확장 프로그램이 설치되지 않았어요. 아래 버튼을 눌러 설치한 뒤 다시 ‘자동입력으로 보내기’를 눌러 주세요.</p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <a className="primary-button" href={NEISSHOT_INSTALL_URL} target="_blank" rel="noreferrer">설치하러 가기</a>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className="app-toast" role="status" aria-live="polite">{toast}</div>
      )}
    </main>
  )
}

export default App
