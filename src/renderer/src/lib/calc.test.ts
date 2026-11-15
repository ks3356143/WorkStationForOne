import { describe, expect, it } from 'vitest'
import { calcQuery, convertUnits, evaluateExpression, formatNumber } from './calc'

describe('evaluateExpression 算术与优先级', () => {
  it('基础加法', () => {
    expect(evaluateExpression('1+2')).toBe(3)
  })
  it('乘法优先于加法', () => {
    expect(evaluateExpression('2+3*4')).toBe(14)
  })
  it('括号改变优先级', () => {
    expect(evaluateExpression('(2+3)*4')).toBe(20)
  })
  it('除法产生小数', () => {
    expect(evaluateExpression('10/4')).toBe(2.5)
  })
  it('幂运算右结合', () => {
    expect(evaluateExpression('2^10')).toBe(1024)
    expect(evaluateExpression('2^3^2')).toBe(512)
  })
  it('一元负号', () => {
    expect(evaluateExpression('-5+3')).toBe(-2)
    expect(evaluateExpression('3*-2')).toBe(-6)
  })
  it('浮点误差被收敛', () => {
    expect(evaluateExpression('0.1+0.2')).toBeCloseTo(0.3, 10)
  })
  it('忽略首尾与中间空白', () => {
    expect(evaluateExpression('  1 +  2  ')).toBe(3)
  })
})

describe('evaluateExpression 百分号', () => {
  it('二元 % 是取模', () => {
    expect(evaluateExpression('10%3')).toBe(1)
  })
  it('后缀 % 是除以 100', () => {
    expect(evaluateExpression('50%')).toBeCloseTo(0.5, 10)
  })
  it('乘法里的后缀百分数', () => {
    expect(evaluateExpression('200*10%')).toBeCloseTo(20, 10)
  })
  it('X% of Y', () => {
    expect(evaluateExpression('15% of 80')).toBeCloseTo(12, 10)
  })
})

describe('evaluateExpression 函数与常量', () => {
  it('平方根与绝对值', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4)
    expect(evaluateExpression('abs(-7)')).toBe(7)
  })
  it('取整函数', () => {
    expect(evaluateExpression('round(2.6)')).toBe(3)
    expect(evaluateExpression('floor(2.9)')).toBe(2)
    expect(evaluateExpression('ceil(2.1)')).toBe(3)
  })
  it('三角与对数', () => {
    expect(evaluateExpression('sin(0)')).toBe(0)
    expect(evaluateExpression('log(100)')).toBeCloseTo(2, 10)
    expect(evaluateExpression('ln(e)')).toBeCloseTo(1, 10)
  })
  it('常量 pi 与 e', () => {
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI, 10)
    expect(evaluateExpression('2*pi')).toBeCloseTo(2 * Math.PI, 10)
  })
  it('函数嵌套', () => {
    expect(evaluateExpression('sqrt(abs(-16))')).toBe(4)
  })
})

describe('evaluateExpression 安全与非法输入', () => {
  it('空与纯空白返回 null', () => {
    expect(evaluateExpression('')).toBeNull()
    expect(evaluateExpression('   ')).toBeNull()
  })
  it('未知标识符返回 null', () => {
    expect(evaluateExpression('abc')).toBeNull()
    expect(evaluateExpression('foo(2)')).toBeNull()
    expect(evaluateExpression('1+2a')).toBeNull()
  })
  it('不完整表达式返回 null', () => {
    expect(evaluateExpression('1+')).toBeNull()
    expect(evaluateExpression('(1+2')).toBeNull()
    expect(evaluateExpression('sqrt(16')).toBeNull()
  })
  it('除以零与非有限结果返回 null', () => {
    expect(evaluateExpression('1/0')).toBeNull()
    expect(evaluateExpression('ln(0)')).toBeNull()
  })
  it('拒绝代码注入字样', () => {
    expect(evaluateExpression('process.exit()')).toBeNull()
    expect(evaluateExpression('alert(1)')).toBeNull()
    expect(evaluateExpression('constructor')).toBeNull()
  })
  it('超长输入返回 null', () => {
    expect(evaluateExpression('1+'.repeat(200))).toBeNull()
  })
})

describe('formatNumber', () => {
  it('整数不带小数点', () => {
    expect(formatNumber(3)).toBe('3')
    expect(formatNumber(1024)).toBe('1024')
  })
  it('保留有效小数', () => {
    expect(formatNumber(2.5)).toBe('2.5')
  })
  it('收敛浮点噪声', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
  })
  it('负零归零', () => {
    expect(formatNumber(-0)).toBe('0')
  })
  it('循环小数截断到 12 位有效数字', () => {
    expect(formatNumber(1 / 3)).toBe('0.333333333333')
  })
})

describe('convertUnits', () => {
  it('长度 km → mile', () => {
    const result = convertUnits('10 km to mile')
    expect(result?.value).toBeCloseTo(6.21371, 4)
    expect(result?.unit).toBe('mile')
  })
  it('长度 km → m', () => {
    expect(convertUnits('1 km in m')?.value).toBeCloseTo(1000, 6)
  })
  it('长度 cm → m', () => {
    expect(convertUnits('100 cm to m')?.value).toBeCloseTo(1, 6)
  })
  it('质量 kg → lb', () => {
    expect(convertUnits('5 kg to lb')?.value).toBeCloseTo(11.0231, 3)
  })
  it('温度 F → C', () => {
    expect(convertUnits('32 f to c')?.value).toBeCloseTo(0, 6)
  })
  it('温度 C → F', () => {
    expect(convertUnits('100 c to f')?.value).toBeCloseTo(212, 6)
  })
  it('温度 C → K', () => {
    expect(convertUnits('0 c to k')?.value).toBeCloseTo(273.15, 6)
  })
  it('大小写不敏感', () => {
    expect(convertUnits('1 KM to M')?.value).toBeCloseTo(1000, 6)
  })
  it('未知单位返回 null', () => {
    expect(convertUnits('10 xyz to m')).toBeNull()
  })
  it('缺少目标单位返回 null', () => {
    expect(convertUnits('10 km')).toBeNull()
    expect(convertUnits('hello')).toBeNull()
  })
})

describe('calcQuery 面板入口', () => {
  it('算式给出结果与复制文本', () => {
    const result = calcQuery('12*8+3')
    expect(result?.copy).toBe('99')
    expect(result?.label).toContain('99')
  })
  it('单位换算给出结果', () => {
    const result = calcQuery('10 km to mile')
    expect(result?.copy).toContain('6.21')
  })
  it('普通搜索词不触发', () => {
    expect(calcQuery('note 2')).toBeNull()
    expect(calcQuery('会议')).toBeNull()
  })
  it('单个常量不劫持搜索', () => {
    expect(calcQuery('e')).toBeNull()
    expect(calcQuery('pi')).toBeNull()
  })
  it('含数字或函数调用才触发', () => {
    expect(calcQuery('2pi')).not.toBeNull()
    expect(calcQuery('sqrt(16)')).not.toBeNull()
  })
  it('空输入返回 null', () => {
    expect(calcQuery('')).toBeNull()
  })
})
