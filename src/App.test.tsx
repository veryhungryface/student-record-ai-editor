// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('App AI revision controls', () => {
  it('labels the toolbar button as all-student AI revision and shows one per-student AI button per row', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '모든 학생 AI 수정' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '모두 AI 수정' })).not.toBeInTheDocument()
    expect(screen.queryByText('목업 학생')).not.toBeInTheDocument()
    expect(screen.queryByText('작성된 결과')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /번 학생만 AI 수정/ })).toHaveLength(10)
  })

  it('lets teachers choose record area independently from subject', () => {
    render(<App />)

    const areaSelect = screen.getByLabelText('기재 영역')
    expect(areaSelect).toHaveValue('교과 특기사항')
    expect(screen.getByText('글의 중심 내용을 정확히 파악하고 자신의 생각을 조리 있게 표현함.')).toBeInTheDocument()

    fireEvent.change(areaSelect, { target: { value: '창체' } })
    expect(areaSelect).toHaveValue('창체')
    expect(screen.getByText('독서 토론에서 의견을 차분히 듣고 자신의 경험을 연결하여 생각을 나눔.')).toBeInTheDocument()

    fireEvent.change(areaSelect, { target: { value: '행동특성 및 종합의견' } })
    expect(screen.getByText('책임감 있게 학습 준비를 하며 친구의 생각을 존중하는 태도가 돋보임.')).toBeInTheDocument()
  })

  it('shows subject buttons only when 교과 특기사항 is selected', () => {
    render(<App />)

    const areaSelect = screen.getByLabelText('기재 영역')
    expect(screen.getByLabelText('과목 선택')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '국어' })).toBeInTheDocument()

    fireEvent.change(areaSelect, { target: { value: '창체' } })
    expect(screen.queryByLabelText('과목 선택')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '국어' })).not.toBeInTheDocument()

    fireEvent.change(areaSelect, { target: { value: '교과 특기사항' } })
    expect(screen.getByLabelText('과목 선택')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '국어' })).toBeInTheDocument()
  })

  it('applies an AI result into the original comment column and keeps restore history', async () => {
    localStorage.setItem('student-record-ai-editor-openai-key', 'sk-test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '수정된 평어 문구가 자연스럽게 반영됨.' }),
    }))

    render(<App />)

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '짧게' } })
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('수정된 평어 문구가 자연스럽게 반영됨.')).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: '반영' })[0])

    expect(screen.getAllByText('수정된 평어 문구가 자연스럽게 반영됨.')).toHaveLength(1)
    expect(screen.queryByText('AI 수정 결과가 여기에 표시됩니다.')).not.toBeInTheDocument()
    const historyButtons = screen.getAllByRole('button', { name: '수정내역' })
    expect(historyButtons[0]).toBeEnabled()

    fireEvent.click(historyButtons[0])
    expect(screen.getByText('1번째 이전 문구')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이 문구로 되돌리기' }))

    expect(screen.getByText('글의 중심 내용을 정확히 파악하고 자신의 생각을 조리 있게 표현함.')).toBeInTheDocument()
  })

  it('pastes spreadsheet cells downward into edit request boxes', () => {
    render(<App />)
    const requests = screen.getAllByRole('textbox')

    fireEvent.paste(requests[1], {
      clipboardData: {
        getData: () => '첫 요청\n둘째 요청\n셋째 요청',
      },
    })

    expect(requests[1]).toHaveValue('첫 요청')
    expect(requests[2]).toHaveValue('둘째 요청')
    expect(requests[3]).toHaveValue('셋째 요청')
  })
})
