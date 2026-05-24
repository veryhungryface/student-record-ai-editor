import { describe, expect, it } from 'vitest'
import { areas, buildRevisionPrompt, subjectRecords, subjects } from './data'

const studentNames = ['김민준', '이서연', '박도윤', '최하린', '정지후', '강아윤', '조현우', '윤서아', '장민서', '임준호']
const recordEndingPattern = /[가-힣]\.$/

describe('school record mock data', () => {
  it('has three record areas, five subjects, and ten student records each', () => {
    expect(areas).toEqual(['교과 특기사항', '창체', '행동특성 및 종합의견'])
    expect(subjects).toEqual(['국어', '영어', '수학', '과학', '사회'])

    for (const area of areas) {
      for (const subject of subjects) {
        expect(subjectRecords[area][subject]).toHaveLength(10)
        expect(subjectRecords[area][subject][0]).toHaveProperty('studentNo')
        expect(subjectRecords[area][subject][0]).toHaveProperty('name')
        expect(subjectRecords[area][subject][0]).toHaveProperty('comment')
      }
    }
  })

  it('uses school-record style endings and does not mention student names in comments', () => {
    for (const area of areas) {
      for (const subject of subjects) {
        for (const record of subjectRecords[area][subject]) {
          expect(record.comment).toMatch(recordEndingPattern)
          for (const name of studentNames) {
            expect(record.comment).not.toContain(name)
          }
          expect(record.comment).not.toMatch(/합니다|했습니다|입니다|됩니다\./)
        }
      }
    }
  })
})

describe('buildRevisionPrompt', () => {
  it('injects 교과 특기사항 rules from the PDF analysis', () => {
    const prompt = buildRevisionPrompt({
      area: '교과 특기사항',
      subject: '국어',
      name: '김민준',
      originalComment: '글의 중심 내용을 정확히 파악하고 자신의 생각을 조리 있게 표현함.',
      editRequest: '더 따뜻한 표현으로 바꿔줘',
    })

    expect(prompt).toContain('교과 특기사항')
    expect(prompt).toContain('성취기준')
    expect(prompt).toContain('성취수준')
    expect(prompt).toContain('학습활동 참여도')
    expect(prompt).toContain('학생 이름은 출력하지 않음')
    expect(prompt).toContain('~함')
    expect(prompt).toContain('나날이 발전하고 있음')
  })

  it('injects 창체 rules from the PDF analysis', () => {
    const prompt = buildRevisionPrompt({
      area: '창체',
      subject: '국어',
      name: '김민준',
      originalComment: '학급회의에서 친구의 의견을 경청하고 공동의 결정을 존중함.',
      editRequest: '협력도 강조',
    })

    expect(prompt).toContain('창의적 체험활동상황')
    expect(prompt).toContain('활동실적')
    expect(prompt).toContain('참여도')
    expect(prompt).toContain('협력도')
    expect(prompt).toContain('단순한 나열식 입력은 지양')
  })

  it('injects 행동특성 rules from the PDF analysis', () => {
    const prompt = buildRevisionPrompt({
      area: '행동특성 및 종합의견',
      subject: '국어',
      name: '김민준',
      originalComment: '학급 규칙을 잘 지키며 친구와 원만한 관계를 형성함.',
      editRequest: '책임감 강조',
    })

    expect(prompt).toContain('행동특성 및 종합의견')
    expect(prompt).toContain('지속적으로 관찰')
    expect(prompt).toContain('학습, 행동 및 인성')
    expect(prompt).toContain('성장을 지원하는 교육적 관점')
  })
})
