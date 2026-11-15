/**
 * 命令面板的安全计算器：手写递归下降解析，绝不使用 eval / Function。
 * 支持四则、幂、取模、百分数、常用函数与常量，以及小集合单位换算。
 */

const MAX_LENGTH = 200

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

const FUNCTIONS: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp
}

type TokenType = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'percent'
interface Token {
  type: TokenType
  value: string
}

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i
      let dot = false
      while (j < input.length && (/[0-9]/.test(input[j]) || (input[j] === '.' && !dot))) {
        if (input[j] === '.') dot = true
        j += 1
      }
      const text = input.slice(i, j)
      if (!Number.isFinite(Number(text))) return null
      tokens.push({ type: 'num', value: text })
      i = j
      continue
    }
    if (/[a-zA-Z]/.test(ch)) {
      let j = i
      while (j < input.length && /[a-zA-Z]/.test(input[j])) j += 1
      tokens.push({ type: 'ident', value: input.slice(i, j).toLowerCase() })
      i = j
      continue
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch })
      i += 1
      continue
    }
    if (ch === '%') {
      tokens.push({ type: 'percent', value: ch })
      i += 1
      continue
    }
    return null
  }
  return tokens
}

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++]
  }

  /** 当前 % 是否二元取模：后随操作数（数字 / 左括号 / 函数常量）才是取模，否则是后缀百分数。 */
  private moduloHere(): boolean {
    if (this.peek()?.type !== 'percent') return false
    const after = this.tokens[this.pos + 1]
    if (!after) return false
    if (after.type === 'num' || after.type === 'lparen') return true
    if (after.type === 'ident' && after.value !== 'of') {
      return after.value in CONSTANTS || after.value in FUNCTIONS
    }
    return false
  }

  parse(): number {
    const value = this.additive()
    if (this.pos !== this.tokens.length) throw new Error('trailing')
    return value
  }

  private additive(): number {
    let left = this.multiplicative()
    for (;;) {
      const token = this.peek()
      if (token?.type === 'op' && (token.value === '+' || token.value === '-')) {
        this.next()
        const right = this.multiplicative()
        left = token.value === '+' ? left + right : left - right
      } else break
    }
    return left
  }

  private multiplicative(): number {
    let left = this.power()
    for (;;) {
      const token = this.peek()
      if (token?.type === 'op' && (token.value === '*' || token.value === '/')) {
        this.next()
        const right = this.power()
        left = token.value === '*' ? left * right : left / right
      } else if (token?.type === 'ident' && token.value === 'of') {
        this.next()
        left *= this.power()
      } else if (token?.type === 'percent' && this.moduloHere()) {
        this.next()
        left %= this.power()
      } else if (token?.type === 'lparen' || (token?.type === 'ident' && token.value !== 'of')) {
        // 隐式乘法：2pi、2(3+4)、2sqrt(9)；未知标识符会在 primary 里抛错。
        left *= this.power()
      } else break
    }
    return left
  }

  private power(): number {
    const base = this.unary()
    const token = this.peek()
    if (token?.type === 'op' && token.value === '^') {
      this.next()
      return base ** this.power()
    }
    return base
  }

  private unary(): number {
    const token = this.peek()
    if (token?.type === 'op' && token.value === '-') {
      this.next()
      return -this.unary()
    }
    if (token?.type === 'op' && token.value === '+') {
      this.next()
      return this.unary()
    }
    return this.postfix()
  }

  private postfix(): number {
    let value = this.primary()
    if (this.peek()?.type === 'percent' && !this.moduloHere()) {
      this.next()
      value /= 100
    }
    return value
  }

  private primary(): number {
    const token = this.next()
    if (!token) throw new Error('empty')
    if (token.type === 'num') return Number(token.value)
    if (token.type === 'lparen') {
      const value = this.additive()
      if (this.next()?.type !== 'rparen') throw new Error('paren')
      return value
    }
    if (token.type === 'ident') {
      if (token.value in CONSTANTS) return CONSTANTS[token.value]
      const fn = FUNCTIONS[token.value]
      if (fn) {
        if (this.next()?.type !== 'lparen') throw new Error('call')
        const arg = this.additive()
        if (this.next()?.type !== 'rparen') throw new Error('call')
        return fn(arg)
      }
    }
    throw new Error('unknown')
  }
}

/** 计算算式；非法、未知标识符或非有限结果一律返回 null（不抛错、不执行任何代码）。 */
export function evaluateExpression(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > MAX_LENGTH) return null
  const tokens = tokenize(trimmed)
  if (!tokens || tokens.length === 0) return null
  try {
    const value = new Parser(tokens).parse()
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/** 收敛浮点噪声的展示格式：整数不带小数点，小数取 12 位有效数字。 */
export function formatNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  if (Number.isInteger(normalized)) return String(normalized)
  return String(Number(normalized.toPrecision(12)))
}

interface UnitDef {
  category: 'length' | 'mass'
  factor: number
  canonical: string
}

const UNITS: Record<string, UnitDef> = {
  m: { category: 'length', factor: 1, canonical: 'm' },
  meter: { category: 'length', factor: 1, canonical: 'm' },
  km: { category: 'length', factor: 1000, canonical: 'km' },
  cm: { category: 'length', factor: 0.01, canonical: 'cm' },
  mm: { category: 'length', factor: 0.001, canonical: 'mm' },
  mile: { category: 'length', factor: 1609.344, canonical: 'mile' },
  mi: { category: 'length', factor: 1609.344, canonical: 'mile' },
  ft: { category: 'length', factor: 0.3048, canonical: 'ft' },
  foot: { category: 'length', factor: 0.3048, canonical: 'ft' },
  feet: { category: 'length', factor: 0.3048, canonical: 'ft' },
  in: { category: 'length', factor: 0.0254, canonical: 'in' },
  inch: { category: 'length', factor: 0.0254, canonical: 'in' },
  yd: { category: 'length', factor: 0.9144, canonical: 'yd' },
  yard: { category: 'length', factor: 0.9144, canonical: 'yd' },
  kg: { category: 'mass', factor: 1, canonical: 'kg' },
  g: { category: 'mass', factor: 0.001, canonical: 'g' },
  mg: { category: 'mass', factor: 0.000001, canonical: 'mg' },
  lb: { category: 'mass', factor: 0.45359237, canonical: 'lb' },
  lbs: { category: 'mass', factor: 0.45359237, canonical: 'lb' },
  pound: { category: 'mass', factor: 0.45359237, canonical: 'lb' },
  oz: { category: 'mass', factor: 0.028349523125, canonical: 'oz' },
  ounce: { category: 'mass', factor: 0.028349523125, canonical: 'oz' }
}

const TEMPERATURE: Record<string, 'C' | 'F' | 'K'> = {
  c: 'C',
  celsius: 'C',
  f: 'F',
  fahrenheit: 'F',
  k: 'K',
  kelvin: 'K'
}

function toCelsius(value: number, unit: 'C' | 'F' | 'K'): number {
  if (unit === 'C') return value
  if (unit === 'F') return ((value - 32) * 5) / 9
  return value - 273.15
}

function fromCelsius(value: number, unit: 'C' | 'F' | 'K'): number {
  if (unit === 'C') return value
  if (unit === 'F') return (value * 9) / 5 + 32
  return value + 273.15
}

/** 解析「10 km to mile」式单位换算；不支持的单位或缺目标返回 null。 */
export function convertUnits(input: string): { value: number; unit: string } | null {
  const match = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*(?:to|in|->|→)\s*([a-zA-Z]+)$/i.exec(
    input.trim()
  )
  if (!match) return null
  const value = Number(match[1])
  const from = match[2].toLowerCase()
  const to = match[3].toLowerCase()
  if (from in TEMPERATURE && to in TEMPERATURE) {
    const result = fromCelsius(toCelsius(value, TEMPERATURE[from]), TEMPERATURE[to])
    return Number.isFinite(result) ? { value: result, unit: TEMPERATURE[to] } : null
  }
  const fromDef = UNITS[from]
  const toDef = UNITS[to]
  if (!fromDef || !toDef || fromDef.category !== toDef.category) return null
  const result = (value * fromDef.factor) / toDef.factor
  return Number.isFinite(result) ? { value: result, unit: toDef.canonical } : null
}

export interface CalcResult {
  label: string
  copy: string
}

/** 面板入口：先试单位换算再试算式；普通搜索词与单个常量不触发。 */
export function calcQuery(input: string): CalcResult | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const looksLikeMath =
    /[0-9]/.test(trimmed) || /[+\-*/^%]/.test(trimmed) || /[a-z]+\s*\(/i.test(trimmed)
  if (!looksLikeMath) return null
  const unit = convertUnits(trimmed)
  if (unit) {
    const text = `${formatNumber(unit.value)} ${unit.unit}`
    return { label: text, copy: text }
  }
  const value = evaluateExpression(trimmed)
  if (value === null) return null
  const text = formatNumber(value)
  return { label: text, copy: text }
}
