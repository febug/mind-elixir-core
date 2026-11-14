import { test, expect } from './mind-elixir-test'
import { plaintextToMindElixir, type NodePlaintextMeta } from '../src/utils/plaintextToMindElixir'
import { mindElixirToPlaintext } from '../src/utils/mindElixirToPlaintext'

test('Parse plaintext with MathJax and styles', () => {
  const plaintext = [
    '- Root Node',
    '  - $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$',
    '  - 勾股定理: $a^2 + b^2 = c^2$',
    '  - Child Node 3-3 [^id5] {"fontFamily": "Arial", "fontWeight": "bold"}',
    '  - Node with ID [^node-1]',
    '  - Node with style {"color": "red"}',
    '  - Edge case {2a} is not style',
  ].join('\n')

  const result = plaintextToMindElixir(plaintext)

  const children = result.nodeData.children!
  expect(children.length).toBe(6)

  // MathJax equation
  expect(children[0].topic).toBe('$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$')
  expect(children[0].style).toBeUndefined()

  // Chinese MathJax equation
  expect(children[1].topic).toBe('勾股定理: $a^2 + b^2 = c^2$')
  expect(children[1].style).toBeUndefined()

  // Node with refId and style
  expect(children[2].topic).toBe('Child Node 3-3')
  expect(children[2].style).toEqual({ fontFamily: 'Arial', fontWeight: 'bold' })
  expect((children[2].metadata as NodePlaintextMeta)?.refId).toBe('id5')

  // Node with ID
  expect(children[3].topic).toBe('Node with ID')
  expect((children[3].metadata as NodePlaintextMeta)?.refId).toBe('node-1')

  // Node with style
  expect(children[4].topic).toBe('Node with style')
  expect(children[4].style).toEqual({ color: 'red' })

  // Edge case
  expect(children[5].topic).toBe('Edge case {2a} is not style')
  expect(children[5].style).toBeUndefined()
})

test('A topic containing a line break survives the round-trip', () => {
  // Shift+Enter keeps line breaks inside a topic, but a newline is also this
  // format's record separator — writing it raw turns the remainder into a
  // top-level line, which then triggers the synthetic-root path and shifts the
  // whole tree down one level.
  const data = {
    nodeData: {
      id: 'root',
      topic: 'root',
      children: [
        { id: 'a', topic: 'first\nsecond' },
        { id: 'b', topic: 'plain' },
      ],
    },
  }

  const plaintext = mindElixirToPlaintext(data as any)
  expect(plaintext).not.toContain('first\nsecond')

  const back = plaintextToMindElixir(plaintext)
  expect(back.nodeData.topic).toBe('root')
  expect(back.nodeData.children?.map(c => c.topic)).toEqual(['first\nsecond', 'plain'])
})

test('Backslashes are not swallowed by the escaping', () => {
  const plaintext = ['- root', '  - path\\\\to\\\\file', '  - tail\\nslash'].join('\n')
  const result = plaintextToMindElixir(plaintext)
  expect(result.nodeData.children?.map(c => c.topic)).toEqual(['path\\to\\file', 'tail\nslash'])
})

test('Reserved topic prefixes survive the round-trip without changing the hierarchy', () => {
  const data = {
    nodeData: {
      id: 'r',
      topic: 'Root',
      children: [
        { id: 'a', topic: '> quoted reply', children: [{ id: 'a1', topic: 'sub' }] },
        { id: 'b', topic: '} closing brace' },
        { id: 'c', topic: 'next' },
      ],
    },
    arrows: [{ id: 'x', label: 'follow-up', from: 'a', to: 'c' }],
  }

  const back = plaintextToMindElixir(mindElixirToPlaintext(data))
  const children = back.nodeData.children!
  expect(children.map(child => child.topic)).toEqual(['> quoted reply', '} closing brace', 'next'])
  expect(children[0].children?.map(child => child.topic)).toEqual(['sub'])
  expect(back.summaries).toBeUndefined()
  expect(back.arrows).toHaveLength(1)
  expect(back.arrows![0]).toMatchObject({ label: 'follow-up', from: children[0].id, to: children[2].id })
})

test('Topic prefix escaping preserves backslashes, line breaks, references and styles', () => {
  const topics = ['> quoted', '} brace', '\\> literal', '\\} literal', 'literal\\n', 'real\n> continuation', 'inline \\> and \\}']
  const data = {
    nodeData: {
      id: 'root',
      topic: '} Root',
      children: topics.map((topic, index) => ({ id: `node-${index}`, topic })),
      metadata: { refId: 'root-ref' },
      style: { color: 'red' },
    },
  }

  const back = plaintextToMindElixir(mindElixirToPlaintext(data))
  expect(back.nodeData.topic).toBe('} Root')
  expect(back.nodeData.children?.map(child => child.topic)).toEqual(topics)
  expect(back.nodeData.metadata).toEqual({ refId: 'root-ref' })
  expect(back.nodeData.style).toEqual({ color: 'red' })

  const raw = plaintextToMindElixir('- inline \\> and \\}')
  expect(raw.nodeData.topic).toBe('inline \\> and \\}')
})

test('Unescaped control lines retain their arrow and summary semantics', () => {
  const plaintext = [
    '- Root',
    '  - A [^a] {"color":"red"}',
    '  - B [^b]',
    '  - }:2 Summary',
    '  - > [^a] (0,-1.5) >-Link-> (-2.5,0) [^b] # see -> [^fake]',
    '  - > not an arrow',
  ].join('\n')
  const back = plaintextToMindElixir(plaintext)
  const [a, b] = back.nodeData.children!
  expect(back.nodeData.children).toHaveLength(2)
  expect(a).toMatchObject({ topic: 'A', style: { color: 'red' }, metadata: { refId: 'a' } })
  expect(back.arrows).toHaveLength(1)
  expect(back.arrows![0]).toMatchObject({ label: 'Link', from: a.id, to: b.id, delta1: { x: 0, y: -1.5 }, delta2: { x: -2.5, y: 0 } })
  expect(back.summaries).toHaveLength(1)
  expect(back.summaries![0]).toMatchObject({ label: 'Summary', parent: back.nodeData.id, start: 0, end: 1 })
})

for (const bidirectional of [false, true]) {
  test(`Arrow labels with hyphens survive the round-trip (${bidirectional ? 'bidirectional' : 'forward'})`, () => {
    for (const label of ['follow-up', 'A->B', 'x-> [^fake] y', '']) {
      const data = {
        nodeData: { id: 'root', topic: 'Root', children: [{ id: 'a', topic: 'A' }, { id: 'b', topic: 'B' }] },
        arrows: [{ id: 'link', label, from: 'a', to: 'b', bidirectional, delta1: { x: 0, y: -1.5 }, delta2: { x: -2.5, y: 0 } }],
      }
      const plaintext = mindElixirToPlaintext(data)
      const back = plaintextToMindElixir(plaintext)
      expect(back.arrows).toHaveLength(1)
      expect(back.arrows![0]).toMatchObject({
        label,
        from: back.nodeData.children![0].id,
        to: back.nodeData.children![1].id,
        delta1: { x: 0, y: -1.5 },
        delta2: { x: -2.5, y: 0 },
      })
      expect(!!back.arrows![0].bidirectional).toBe(bidirectional)
      expect(mindElixirToPlaintext(back)).toBe(plaintext)
    }
  })
}
