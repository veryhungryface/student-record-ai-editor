// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
})

function makeRect(rect: Partial<DOMRect>): DOMRect {
  const left = rect.left ?? 0
  const top = rect.top ?? 0
  const width = rect.width ?? 0
  const height = rect.height ?? 0
  const right = rect.right ?? left + width
  const bottom = rect.bottom ?? top + height
  return {
    bottom,
    height,
    left,
    right,
    top,
    width,
    x: rect.x ?? left,
    y: rect.y ?? top,
    toJSON: () => ({}),
  }
}

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

    const areaSelect = screen.getByRole('combobox', { name: /기재 영역/ })
    expect(areaSelect).toHaveTextContent('교과학습발달')
    expect(screen.getByText('글의 중심 내용을 정확히 파악하고 자신의 생각을 조리 있게 표현함.')).toBeInTheDocument()

    fireEvent.click(areaSelect)
    fireEvent.click(screen.getByRole('option', { name: '창체' }))
    expect(areaSelect).toHaveTextContent('창체')
    expect(screen.getByText('독서 토론에서 의견을 차분히 듣고 자신의 경험을 연결하여 생각을 나눔.')).toBeInTheDocument()

    fireEvent.click(areaSelect)
    fireEvent.click(screen.getByRole('option', { name: '행동발달' }))
    expect(screen.getByText('책임감 있게 학습 준비를 하며 친구의 생각을 존중하는 태도가 돋보임.')).toBeInTheDocument()
  })

  it('shows the subject dropdown only when 교과 특기사항 is selected', () => {
    render(<App />)

    const areaSelect = screen.getByRole('combobox', { name: /기재 영역/ })
    const subjectSelect = screen.getByRole('combobox', { name: /과목/ })
    expect(subjectSelect).toHaveTextContent('국어')

    fireEvent.click(subjectSelect)
    expect(screen.getByRole('option', { name: '국어' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '실과' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: '수학' }))
    expect(subjectSelect).toHaveTextContent('수학')
    expect(screen.getByText('수 개념을 정확히 이해하고 계산 과정을 차근차근 설명함.')).toBeInTheDocument()

    fireEvent.click(areaSelect)
    fireEvent.click(screen.getByRole('option', { name: '창체' }))
    expect(screen.queryByRole('combobox', { name: /과목/ })).not.toBeInTheDocument()

    fireEvent.click(areaSelect)
    fireEvent.click(screen.getByRole('option', { name: '교과학습발달' }))
    expect(screen.getByRole('combobox', { name: /과목/ })).toHaveTextContent('수학')
  })

  it('applies an AI result into the original comment column and keeps restore history', async () => {
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

  it('shows an absorb animation before applying a positioned AI result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '수정된 평어 문구가 자연스럽게 반영됨.' }),
    }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getMockRect(this: HTMLElement) {
      if (this.classList.contains('result-cell')) return makeRect({ left: 760, top: 260, width: 280, height: 92 })
      if (this.classList.contains('comment-box')) return makeRect({ left: 180, top: 260, width: 300, height: 92 })
      return makeRect({ left: 0, top: 0, width: 120, height: 40 })
    })

    render(<App />)

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '짧게' } })
    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('수정된 평어 문구가 자연스럽게 반영됨.')).toBeInTheDocument())

    vi.useFakeTimers()
    fireEvent.click(screen.getAllByRole('button', { name: '반영' })[0])

    expect(document.querySelector('.absorb-flyer')).toHaveTextContent('수정된 평어 문구가 자연스럽게 반영됨.')
    expect(screen.getAllByRole('button', { name: '반영' })[0]).toBeDisabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(620)
    })

    expect(document.querySelector('.absorb-flyer')).not.toBeInTheDocument()
    expect(screen.getAllByText('수정된 평어 문구가 자연스럽게 반영됨.')).toHaveLength(1)
  })

  it('shows absorb animations before applying all positioned AI results', async () => {
    let revisionCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      revisionCount += 1
      return {
        ok: true,
        json: async () => ({ text: `${revisionCount}번째 수정 결과가 자연스럽게 반영됨.` }),
      }
    }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getMockRect(this: HTMLElement) {
      if (this.classList.contains('result-cell')) return makeRect({ left: 760, top: 260, width: 280, height: 92 })
      if (this.classList.contains('comment-box')) return makeRect({ left: 180, top: 260, width: 300, height: 92 })
      return makeRect({ left: 0, top: 0, width: 120, height: 40 })
    })

    render(<App />)

    const requests = screen.getAllByRole('textbox')
    fireEvent.change(requests[0], { target: { value: '첫 번째' } })
    fireEvent.keyDown(requests[0], { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('1번째 수정 결과가 자연스럽게 반영됨.')).toBeInTheDocument())

    fireEvent.change(requests[1], { target: { value: '두 번째' } })
    fireEvent.keyDown(requests[1], { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('2번째 수정 결과가 자연스럽게 반영됨.')).toBeInTheDocument())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '모두 반영' }))

    expect(document.querySelectorAll('.absorb-flyer')).toHaveLength(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })

    expect(document.querySelectorAll('.absorb-flyer')).toHaveLength(0)
    expect(screen.getAllByText(/번째 수정 결과가 자연스럽게 반영됨\./)).toHaveLength(2)
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
