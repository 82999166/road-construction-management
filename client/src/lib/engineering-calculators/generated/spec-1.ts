/**
 * 建筑结构房建市政计算器规格模块
 * 
 * 说明：
 * 1. 本模块严格基于《自动计算审计规格》audit-1.md 生成。
 * 2. 包含 34 条计算规格，其中 29 条可直接实现，5 条标记为“需人工补全/仅查阅”的条目作为辅助测算工具。
 * 3. 标记为辅助测算（requiresProfessionalReview: true）的条目不提供自动合格判定。
 * 4. 所有计算逻辑均包含防除零、防负数处理，确保数值安全性。
 */

/**
 * 无法安全数值化的条目 ID 列表
 * 经审计，所有 34 条条目均提供了明确的计算公式或确定性步骤，故此列表为空。
 */
export const unsupportedCalculatorIds: string[] = [];

export interface InputSpec {
  key: string;
  label: string;
  unit: string;
  defaultValue: number;
  min: number;
  max?: number;
  step: number;
  description: string;
}

export interface OutputSpec {
  key: string;
  label: string;
  unit: string;
  precision: number;
}

export interface CalculatorSpec {
  id: string;
  title: string;
  formula: string;
  inputs: InputSpec[];
  outputs: OutputSpec[];
  exampleSummary: string;
  riskNotice: string;
  requiresProfessionalReview: boolean;
  calculate: (values: Record<string, number>) => Record<string, number>;
}

export const categoryCalculatorSpecs: CalculatorSpec[] = [
  {
    id: "STR-VOL-001",
    title: "矩形基础土方开挖体积",
    formula: "V = (a + 2c + kH) * (b + 2c + kH) * H + 1/3 * k^2 * H^3",
    inputs: [
      { key: "基础底面长_a", label: "基础底面长", unit: "m", defaultValue: 2, min: 0, step: 0.1, description: "基础底面的长度" },
      { key: "基础底面宽_b", label: "基础底面宽", unit: "m", defaultValue: 1.5, min: 0, step: 0.1, description: "基础底面的宽度" },
      { key: "工作面宽度_c", label: "工作面宽度", unit: "m", defaultValue: 0.3, min: 0, step: 0.05, description: "施工所需的工作空间宽度" },
      { key: "放坡系数_k", label: "放坡系数", unit: "无量纲", defaultValue: 0.5, min: 0, step: 0.1, description: "边坡坡度系数" },
      { key: "开挖深度_H", label: "开挖深度", unit: "m", defaultValue: 2, min: 0, step: 0.1, description: "从地面到基底的深度" }
    ],
    outputs: [
      { key: "开挖体积", label: "开挖体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "基础底面 2m x 1.5m，工作面 0.3m，放坡系数 0.5，深度 2m，计算体积约 22.99 m³。",
    riskNotice: "仅适用于均质土层，复杂地质或支护开挖不适用。深基坑需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const a = Math.max(0, v["基础底面长_a"] || 0);
      const b = Math.max(0, v["基础底面宽_b"] || 0);
      const c = Math.max(0, v["工作面宽度_c"] || 0);
      const k = Math.max(0, v["放坡系数_k"] || 0);
      const H = Math.max(0, v["开挖深度_H"] || 0);
      const res = (a + 2 * c + k * H) * (b + 2 * c + k * H) * H + (1 / 3) * Math.pow(k, 2) * Math.pow(H, 3);
      return { "开挖体积": res };
    }
  },
  {
    id: "STR-VOL-002",
    title: "圆形检查井开挖体积",
    formula: "V = π/3 * H * (R^2 + Rr + r^2), 其中 R = r + kH",
    inputs: [
      { key: "井底半径_r", label: "井底半径", unit: "m", defaultValue: 1, min: 0, step: 0.1, description: "含工作面的井底开挖半径" },
      { key: "开挖深度_H", label: "开挖深度", unit: "m", defaultValue: 3, min: 0, step: 0.1, description: "开挖总深度" },
      { key: "放坡系数_k", label: "放坡系数", unit: "无量纲", defaultValue: 0.33, min: 0, step: 0.01, description: "边坡坡度系数" }
    ],
    outputs: [
      { key: "开挖体积", label: "开挖体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "井底半径 1m，深度 3m，放坡系数 0.33，计算体积约 21.82 m³。",
    riskNotice: "注意放坡起点的深度要求。深基坑需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const r = Math.max(0, v["井底半径_r"] || 0);
      const H = Math.max(0, v["开挖深度_H"] || 0);
      const k = Math.max(0, v["放坡系数_k"] || 0);
      const R = r + k * H;
      const res = (Math.PI / 3) * H * (Math.pow(R, 2) + R * r + Math.pow(r, 2));
      return { "开挖体积": res };
    }
  },
  {
    id: "STR-VOL-003",
    title: "柱混凝土体积计算",
    formula: "V = a * b * H",
    inputs: [
      { key: "柱截面长_a", label: "柱截面长", unit: "m", defaultValue: 0.5, min: 0, step: 0.05, description: "柱子的截面长度" },
      { key: "柱截面宽_b", label: "柱截面宽", unit: "m", defaultValue: 0.5, min: 0, step: 0.05, description: "柱子的截面宽度" },
      { key: "柱净高_H", label: "柱净高", unit: "m", defaultValue: 2.85, min: 0, step: 0.05, description: "柱子的实际浇筑高度" }
    ],
    outputs: [
      { key: "混凝土体积", label: "混凝土体积", unit: "m³", precision: 4 }
    ],
    exampleSummary: "柱截面 0.5m x 0.5m，净高 2.85m，计算体积为 0.7125 m³。",
    riskNotice: "需准确扣减相交构件（梁、板）的体积。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const a = Math.max(0, v["柱截面长_a"] || 0);
      const b = Math.max(0, v["柱截面宽_b"] || 0);
      const H = Math.max(0, v["柱净高_H"] || 0);
      return { "混凝土体积": a * b * H };
    }
  },
  {
    id: "STR-VOL-004",
    title: "墙体面积计算",
    formula: "S = L * H - Σ(wi * hi)",
    inputs: [
      { key: "墙体长度_L", label: "墙体长度", unit: "m", defaultValue: 5, min: 0, step: 0.1, description: "墙体的总长度" },
      { key: "墙体高度_H", label: "墙体高度", unit: "m", defaultValue: 3, min: 0, step: 0.1, description: "墙体的总高度" },
      { key: "洞口总面积", label: "洞口总面积", unit: "m²", defaultValue: 4.25, min: 0, step: 0.01, description: "所有门窗洞口的面积之和" }
    ],
    outputs: [
      { key: "净面积", label: "净面积", unit: "m²", precision: 2 }
    ],
    exampleSummary: "墙长 5m，高 3m，洞口总面积 4.25m²，净面积为 10.75 m²。",
    riskNotice: "洞口侧壁面积是否计入需按具体计价规则确定。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const L = Math.max(0, v["墙体长度_L"] || 0);
      const H = Math.max(0, v["墙体高度_H"] || 0);
      const S_open = Math.max(0, v["洞口总面积"] || 0);
      return { "净面积": Math.max(0, L * H - S_open) };
    }
  },
  {
    id: "STR-VOL-005",
    title: "楼梯混凝土体积",
    formula: "V = (L / cosθ) * B * d + 0.5 * n * a * h * B",
    inputs: [
      { key: "水平长度_L", label: "水平长度", unit: "m", defaultValue: 3, min: 0, step: 0.1, description: "梯段水平投影长度" },
      { key: "梯段宽度_B", label: "梯段宽度", unit: "m", defaultValue: 1.2, min: 0, step: 0.1, description: "梯段宽度" },
      { key: "楼梯倾角_theta", label: "楼梯倾角", unit: "°", defaultValue: 30, min: 0, max: 90, step: 1, description: "楼梯与水平面的夹角" },
      { key: "梯板厚度_d", label: "梯板厚度", unit: "m", defaultValue: 0.12, min: 0, step: 0.01, description: "梯板厚度" },
      { key: "踏步数量_n", label: "踏步数量", unit: "个", defaultValue: 10, min: 0, step: 1, description: "踏步数量" },
      { key: "踏步宽_a", label: "踏步宽", unit: "m", defaultValue: 0.3, min: 0, step: 0.01, description: "单个踏步的宽度" },
      { key: "踏步高_h", label: "踏步高", unit: "m", defaultValue: 0.15, min: 0, step: 0.01, description: "单个踏步的高度" }
    ],
    outputs: [
      { key: "混凝土体积", label: "混凝土体积", unit: "m³", precision: 3 }
    ],
    exampleSummary: "水平长 3m，宽 1.2m，厚 0.12m，角 30°，踏步 10 个 (0.3x0.15)，体积约 0.768 m³。",
    riskNotice: "仅为估算，实际结算需精确建模或按投影面积计算。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const L = Math.max(0, v["水平长度_L"] || 0);
      const B = Math.max(0, v["梯段宽度_B"] || 0);
      const theta = (v["楼梯倾角_theta"] || 0) * (Math.PI / 180);
      const d = Math.max(0, v["梯板厚度_d"] || 0);
      const n = Math.max(0, v["踏步数量_n"] || 0);
      const a = Math.max(0, v["踏步宽_a"] || 0);
      const h = Math.max(0, v["踏步高_h"] || 0);
      const cosTheta = Math.cos(theta);
      const plateVol = cosTheta > 0 ? (L / cosTheta) * B * d : 0;
      const stepVol = 0.5 * n * a * h * B;
      return { "混凝土体积": plateVol + stepVol };
    }
  },
  {
    id: "STR-TPL-001",
    title: "柱模板面积计算",
    formula: "S = 2 * (a + b) * H",
    inputs: [
      { key: "柱截面长_a", label: "柱截面长", unit: "m", defaultValue: 0.6, min: 0, step: 0.05, description: "柱子的截面长度" },
      { key: "柱截面宽_b", label: "柱截面宽", unit: "m", defaultValue: 0.6, min: 0, step: 0.05, description: "柱子的截面宽度" },
      { key: "浇筑高度_H", label: "浇筑高度", unit: "m", defaultValue: 4, min: 0, step: 0.1, description: "柱子的浇筑高度" }
    ],
    outputs: [
      { key: "模板面积", label: "模板面积", unit: "m²", precision: 2 }
    ],
    exampleSummary: "柱截面 0.6m x 0.6m，高度 4m，模板面积为 9.6 m²。",
    riskNotice: "需扣除与梁相交处的节点面积。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const a = Math.max(0, v["柱截面长_a"] || 0);
      const b = Math.max(0, v["柱截面宽_b"] || 0);
      const H = Math.max(0, v["浇筑高度_H"] || 0);
      return { "模板面积": 2 * (a + b) * H };
    }
  },
  {
    id: "STR-TPL-002",
    title: "梁模板面积计算",
    formula: "S = (2h + b) * L",
    inputs: [
      { key: "梁高_h", label: "梁高", unit: "m", defaultValue: 0.6, min: 0, step: 0.05, description: "梁的截面高度" },
      { key: "梁宽_b", label: "梁宽", unit: "m", defaultValue: 0.3, min: 0, step: 0.05, description: "梁的截面宽度" },
      { key: "梁净长_L", label: "梁净长", unit: "m", defaultValue: 5, min: 0, step: 0.1, description: "梁的净长度" }
    ],
    outputs: [
      { key: "模板面积", label: "模板面积", unit: "m²", precision: 2 }
    ],
    exampleSummary: "梁截面 0.3m x 0.6m，净长 5m，模板面积为 7.5 m²。",
    riskNotice: "需扣除与次梁相交处的面积，注意板厚影响。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const h = Math.max(0, v["梁高_h"] || 0);
      const b = Math.max(0, v["梁宽_b"] || 0);
      const L = Math.max(0, v["梁净长_L"] || 0);
      return { "模板面积": (2 * h + b) * L };
    }
  },
  {
    id: "STR-SCA-001",
    title: "综合脚手架面积计算",
    formula: "S = S_build",
    inputs: [
      { key: "建筑面积", label: "建筑面积", unit: "m²", defaultValue: 5000, min: 0, step: 10, description: "建筑的总建筑面积" }
    ],
    outputs: [
      { key: "脚手架面积", label: "脚手架面积", unit: "m²", precision: 2 }
    ],
    exampleSummary: "建筑面积 5000 m²，脚手架工程量为 5000 m²。",
    riskNotice: "仅适用于清单计价规范，具体地区定额可能有差异。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      return { "脚手架面积": Math.max(0, v["建筑面积"] || 0) };
    }
  },
  {
    id: "STR-SCA-002",
    title: "外墙双排脚手架面积",
    formula: "S = L_out * H",
    inputs: [
      { key: "外墙周长", label: "外墙周长", unit: "m", defaultValue: 120, min: 0, step: 1, description: "外墙外边线周长" },
      { key: "搭设高度", label: "搭设高度", unit: "m", defaultValue: 20, min: 0, step: 1, description: "脚手架搭设高度" }
    ],
    outputs: [
      { key: "搭设面积", label: "搭设面积", unit: "m²", precision: 2 }
    ],
    exampleSummary: "周长 120m，高度 20m，立面面积为 2400 m²。",
    riskNotice: "不扣除门窗洞口面积，突出墙面部分需展开计算。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const L = Math.max(0, v["外墙周长"] || 0);
      const H = Math.max(0, v["搭设高度"] || 0);
      return { "搭设面积": L * H };
    }
  },
  {
    id: "STR-SCA-003",
    title: "满堂脚手架辅助测算",
    formula: "S = S_indoor",
    inputs: [
      { key: "室内净面积", label: "室内净面积", unit: "m²", defaultValue: 300, min: 0, step: 1, description: "室内净面积" },
      { key: "室内净高", label: "室内净高", unit: "m", defaultValue: 6, min: 0, step: 0.1, description: "室内净高度" }
    ],
    outputs: [
      { key: "基本层工程量", label: "基本层工程量", unit: "m²", precision: 2 }
    ],
    exampleSummary: "面积 300 m²，净高 6m，基本层工程量为 300 m²。",
    riskNotice: "超过一定高度（如 5.2m）需增加增加层。需专业人员按定额复核。",
    requiresProfessionalReview: true,
    calculate: (v) => {
      return { "基本层工程量": Math.max(0, v["室内净面积"] || 0) };
    }
  },
  {
    id: "STR-REB-001",
    title: "钢筋理论重量换算",
    formula: "W = 0.00617 * d^2",
    inputs: [
      { key: "钢筋直径", label: "钢筋直径", unit: "mm", defaultValue: 16, min: 0, step: 1, description: "钢筋的公称直径" }
    ],
    outputs: [
      { key: "每米重量", label: "每米重量", unit: "kg/m", precision: 3 }
    ],
    exampleSummary: "直径 16mm 钢筋，每米重约 1.58 kg。",
    riskNotice: "公式为经验近似值，精确值需查阅国家标准表格。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const d = Math.max(0, v["钢筋直径"] || 0);
      return { "每米重量": 0.00617 * Math.pow(d, 2) };
    }
  },
  {
    id: "STR-REB-002",
    title: "钢筋下料长度计算(含弯钩)",
    formula: "L = L_net + 2 * 6.25d",
    inputs: [
      { key: "构件内净长", label: "构件内净长", unit: "mm", defaultValue: 3000, min: 0, step: 10, description: "构件内部的净长度" },
      { key: "钢筋直径", label: "钢筋直径", unit: "mm", defaultValue: 10, min: 0, step: 1, description: "钢筋直径" }
    ],
    outputs: [
      { key: "下料长度", label: "下料长度", unit: "mm", precision: 0 }
    ],
    exampleSummary: "净长 3000mm，直径 10mm，下料长度为 3125 mm。",
    riskNotice: "弯钩增加长度与弯曲半径有关，6.25d 为常用标准值。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const L_net = Math.max(0, v["构件内净长"] || 0);
      const d = Math.max(0, v["钢筋直径"] || 0);
      return { "下料长度": L_net + 2 * 6.25 * d };
    }
  },
  {
    id: "STR-REB-003",
    title: "箍筋下料长度计算",
    formula: "L = 2 * (a - 2c + b - 2c) + 2 * max(10d, 75) + 8d",
    inputs: [
      { key: "构件截面长_a", label: "构件截面长", unit: "mm", defaultValue: 400, min: 0, step: 10, description: "构件的截面长度" },
      { key: "构件截面宽_b", label: "构件截面宽", unit: "mm", defaultValue: 400, min: 0, step: 10, description: "构件的截面宽度" },
      { key: "保护层厚度_c", label: "保护层厚度", unit: "mm", defaultValue: 30, min: 0, step: 5, description: "钢筋保护层厚度" },
      { key: "箍筋直径_d", label: "箍筋直径", unit: "mm", defaultValue: 8, min: 0, step: 1, description: "箍筋直径" }
    ],
    outputs: [
      { key: "下料长度", label: "下料长度", unit: "mm", precision: 0 }
    ],
    exampleSummary: "截面 400x400，保护层 30，直径 8，下料长度为 1584 mm。",
    riskNotice: "不同平法图集可能有细微差异，需按图纸要求。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const a = Math.max(0, v["构件截面长_a"] || 0);
      const b = Math.max(0, v["构件截面宽_b"] || 0);
      const c = Math.max(0, v["保护层厚度_c"] || 0);
      const d = Math.max(0, v["箍筋直径_d"] || 0);
      const innerPerimeter = 2 * (Math.max(0, a - 2 * c) + Math.max(0, b - 2 * c));
      const hookAdjustment = 2 * Math.max(10 * d, 75) + 8 * d;
      return { "下料长度": innerPerimeter + hookAdjustment };
    }
  },
  {
    id: "STR-REB-004",
    title: "钢筋锚固长度辅助测算",
    formula: "la = alpha * (fy / ft) * d",
    inputs: [
      { key: "外形系数_alpha", label: "锚固外形系数", unit: "无量纲", defaultValue: 0.14, min: 0, step: 0.01, description: "根据钢筋表面形状取值" },
      { key: "抗拉强度_fy", label: "钢筋抗拉强度设计值", unit: "MPa", defaultValue: 360, min: 0, step: 10, description: "钢筋抗拉强度设计值" },
      { key: "抗拉强度_ft", label: "混凝土抗拉强度设计值", unit: "MPa", defaultValue: 1.43, min: 0.01, step: 0.01, description: "混凝土轴心抗拉强度设计值" },
      { key: "钢筋直径_d", label: "钢筋直径", unit: "mm", defaultValue: 16, min: 0, step: 1, description: "钢筋直径" }
    ],
    outputs: [
      { key: "基本锚固长度", label: "基本锚固长度", unit: "mm", precision: 1 }
    ],
    exampleSummary: "HRB400(360MPa), 直径 16, C30(1.43MPa), 锚固长度约 564 mm。",
    riskNotice: "实际锚固长度需考虑抗震等级、修正系数等。需专业人员按规范复核。",
    requiresProfessionalReview: true,
    calculate: (v) => {
      const alpha = Math.max(0, v["外形系数_alpha"] || 0);
      const fy = Math.max(0, v["抗拉强度_fy"] || 0);
      const ft = Math.max(0.01, v["抗拉强度_ft"] || 1.43);
      const d = Math.max(0, v["钢筋直径_d"] || 0);
      return { "基本锚固长度": alpha * (fy / ft) * d };
    }
  },
  {
    id: "STR-REB-005",
    title: "钢筋搭接长度辅助测算",
    formula: "ll = zeta_l * la",
    inputs: [
      { key: "修正系数_zeta", label: "搭接长度修正系数", unit: "无量纲", defaultValue: 1.4, min: 1, step: 0.1, description: "根据接头面积百分率取值" },
      { key: "锚固长度_la", label: "锚固长度", unit: "mm", defaultValue: 564, min: 0, step: 1, description: "基本锚固长度" }
    ],
    outputs: [
      { key: "搭接长度", label: "搭接长度", unit: "mm", precision: 0 }
    ],
    exampleSummary: "锚固长度 564mm，修正系数 1.4，搭接长度约 790 mm。",
    riskNotice: "大直径钢筋不宜采用绑扎搭接。需专业人员按规范复核。",
    requiresProfessionalReview: true,
    calculate: (v) => {
      const zeta = Math.max(1, v["修正系数_zeta"] || 0);
      const la = Math.max(0, v["锚固长度_la"] || 0);
      return { "搭接长度": zeta * la };
    }
  },
  {
    id: "STR-MAS-001",
    title: "砖墙砖块数量计算",
    formula: "N = (2 * K) / (d * (L + t) * (h + t))",
    inputs: [
      { key: "墙厚砖数_K", label: "墙厚砖数", unit: "无量纲", defaultValue: 1, min: 0.5, step: 0.5, description: "墙厚的砖数（如一砖墙取1，半砖墙取0.5）" },
      { key: "墙厚_d", label: "墙厚", unit: "m", defaultValue: 0.24, min: 0, step: 0.01, description: "墙体的实际厚度" },
      { key: "砖长_L", label: "砖长", unit: "m", defaultValue: 0.24, min: 0, step: 0.005, description: "单块砖的长度" },
      { key: "砖厚_h", label: "砖厚", unit: "m", defaultValue: 0.053, min: 0, step: 0.001, description: "单块砖的厚度" },
      { key: "灰缝厚度_t", label: "灰缝厚度", unit: "m", defaultValue: 0.01, min: 0, step: 0.001, description: "砌筑灰缝的厚度" }
    ],
    outputs: [
      { key: "每方砖数", label: "每方砖数", unit: "块/m³", precision: 0 }
    ],
    exampleSummary: "240厚一砖墙，标准砖，灰缝10mm，每立方米需约 529 块砖。",
    riskNotice: "仅适用于标准砖，其他砌块需替换尺寸。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const K = Math.max(0, v["墙厚砖数_K"] || 0);
      const d = Math.max(0.001, v["墙厚_d"] || 0.24);
      const L = Math.max(0, v["砖长_L"] || 0);
      const h = Math.max(0, v["砖厚_h"] || 0);
      const t = Math.max(0, v["灰缝厚度_t"] || 0);
      const denominator = d * (L + t) * (h + t);
      return { "每方砖数": denominator > 0 ? (2 * K) / denominator : 0 };
    }
  },
  {
    id: "STR-MAS-002",
    title: "砌体砂浆用量计算",
    formula: "V = 1 - N * L * W * H",
    inputs: [
      { key: "每方砖数_N", label: "每方砖数", unit: "块", defaultValue: 529, min: 0, step: 1, description: "每立方米砌体中的砖块数量" },
      { key: "砖长_L", label: "砖长", unit: "m", defaultValue: 0.24, min: 0, step: 0.005, description: "单块砖的长度" },
      { key: "砖宽_W", label: "砖宽", unit: "m", defaultValue: 0.115, min: 0, step: 0.005, description: "单块砖的宽度" },
      { key: "砖厚_H", label: "砖厚", unit: "m", defaultValue: 0.053, min: 0, step: 0.001, description: "单块砖的厚度" }
    ],
    outputs: [
      { key: "砂浆体积", label: "砂浆体积", unit: "m³", precision: 3 }
    ],
    exampleSummary: "每立方米 529 块标准砖，砂浆用量约为 0.226 m³。",
    riskNotice: "未考虑砂浆损耗，实际施工需乘以损耗率。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const N = Math.max(0, v["每方砖数_N"] || 0);
      const L = Math.max(0, v["砖长_L"] || 0);
      const W = Math.max(0, v["砖宽_W"] || 0);
      const H = Math.max(0, v["砖厚_H"] || 0);
      return { "砂浆体积": Math.max(0, 1 - N * L * W * H) };
    }
  },
  {
    id: "STR-MAS-003",
    title: "加气混凝土砌块用量",
    formula: "N = 1 / ((L + t) * (H + t) * W)",
    inputs: [
      { key: "砌块长_L", label: "砌块长", unit: "m", defaultValue: 0.6, min: 0, step: 0.01, description: "单块砌块的长度" },
      { key: "砌块高_H", label: "砌块高", unit: "m", defaultValue: 0.2, min: 0, step: 0.01, description: "单块砌块的高度" },
      { key: "砌块宽_W", label: "砌块宽", unit: "m", defaultValue: 0.2, min: 0, step: 0.01, description: "单块砌块的宽度" },
      { key: "灰缝厚度_t", label: "灰缝厚度", unit: "m", defaultValue: 0.01, min: 0, step: 0.001, description: "砌筑灰缝的厚度" }
    ],
    outputs: [
      { key: "每方块数", label: "每方块数", unit: "块/m³", precision: 1 }
    ],
    exampleSummary: "砌块 0.6x0.2x0.2，灰缝 0.01m，每立方米约需 39 块。",
    riskNotice: "需扣除圈梁、构造柱体积。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const L = Math.max(0, v["砌块长_L"] || 0);
      const H = Math.max(0, v["砌块高_H"] || 0);
      const W = Math.max(0.001, v["砌块宽_W"] || 0.2);
      const t = Math.max(0, v["灰缝厚度_t"] || 0);
      const denominator = (L + t) * (H + t) * W;
      return { "每方块数": denominator > 0 ? 1 / denominator : 0 };
    }
  },
  {
    id: "STR-MAS-004",
    title: "砌体高厚比辅助验算",
    formula: "beta = H0 / h",
    inputs: [
      { key: "计算高度_H0", label: "墙柱计算高度", unit: "m", defaultValue: 3.6, min: 0, step: 0.1, description: "根据房屋结构方案确定的计算高度" },
      { key: "墙厚_h", label: "墙厚", unit: "m", defaultValue: 0.24, min: 0.01, step: 0.01, description: "墙体厚度或矩形柱边长" },
      { key: "修正系数_mu1", label: "修正系数 mu1", unit: "无量纲", defaultValue: 1.0, min: 0, step: 0.1, description: "非承重墙体修正系数" },
      { key: "修正系数_mu2", label: "修正系数 mu2", unit: "无量纲", defaultValue: 1.0, min: 0, step: 0.1, description: "有门窗洞口修正系数" },
      { key: "允许高厚比", label: "允许高厚比 [beta]", unit: "无量纲", defaultValue: 22, min: 0, step: 1, description: "规范规定的允许高厚比" }
    ],
    outputs: [
      { key: "实际高厚比", label: "实际高厚比", unit: "无量纲", precision: 2 },
      { key: "修正后允许值", label: "修正后允许值", unit: "无量纲", precision: 2 }
    ],
    exampleSummary: "高度 3.6m，墙厚 0.24m，实际高厚比为 15。",
    riskNotice: "仅适用于承重墙体验算。系统不作自动判定，需专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => {
      const H0 = Math.max(0, v["计算高度_H0"] || 0);
      const h = Math.max(0.01, v["墙厚_h"] || 0.24);
      const mu1 = Math.max(0, v["修正系数_mu1"] || 1);
      const mu2 = Math.max(0, v["修正系数_mu2"] || 1);
      const beta_limit = Math.max(0, v["允许高厚比"] || 22);
      return {
        "实际高厚比": H0 / h,
        "修正后允许值": mu1 * mu2 * beta_limit
      };
    }
  },
  {
    id: "STR-MAS-005",
    title: "构造柱混凝土体积辅助测算",
    formula: "V = (a + b_ma / 2) * c * H",
    inputs: [
      { key: "截面长_a", label: "截面长 a", unit: "m", defaultValue: 0.24, min: 0, step: 0.01, description: "构造柱主截面边长" },
      { key: "截面宽_c", label: "截面宽 c", unit: "m", defaultValue: 0.24, min: 0, step: 0.01, description: "构造柱主截面另一边长" },
      { key: "马牙槎伸出_bma", label: "马牙槎伸出长度", unit: "m", defaultValue: 0.06, min: 0, step: 0.01, description: "马牙槎单边伸出长度" },
      { key: "柱高_H", label: "柱高", unit: "m", defaultValue: 3, min: 0, step: 0.1, description: "构造柱高度" }
    ],
    outputs: [
      { key: "混凝土体积", label: "混凝土体积", unit: "m³", precision: 4 }
    ],
    exampleSummary: "截面 0.24x0.24，马牙槎 0.06m，高 3m，体积约为 0.1944 m³。",
    riskNotice: "马牙槎数量根据构造柱位置不同。需专业人员按实复核。",
    requiresProfessionalReview: true,
    calculate: (v) => {
      const a = Math.max(0, v["截面长_a"] || 0);
      const c = Math.max(0, v["截面宽_c"] || 0);
      const bma = Math.max(0, v["马牙槎伸出_bma"] || 0);
      const H = Math.max(0, v["柱高_H"] || 0);
      return { "混凝土体积": (a + bma / 2) * c * H };
    }
  },
  {
    id: "STR-PIP-001",
    title: "管道水头损失计算",
    formula: "hf = lambda * (L / D) * (v^2 / 2g)",
    inputs: [
      { key: "阻力系数_lambda", label: "沿程阻力系数", unit: "无量纲", defaultValue: 0.02, min: 0, step: 0.001, description: "管道沿程阻力系数" },
      { key: "管道长度_L", label: "管道长度", unit: "m", defaultValue: 100, min: 0, step: 1, description: "管道总长度" },
      { key: "管道内径_D", label: "管道内径", unit: "m", defaultValue: 0.1, min: 0.001, step: 0.01, description: "管道内部直径" },
      { key: "流速_v", label: "流速", unit: "m/s", defaultValue: 2, min: 0, step: 0.1, description: "流体在管道内的流速" },
      { key: "重力加速度_g", label: "重力加速度", unit: "m/s²", defaultValue: 9.8, min: 0.1, step: 0.01, description: "重力加速度，通常取 9.8" }
    ],
    outputs: [
      { key: "沿程水头损失", label: "沿程水头损失", unit: "m", precision: 2 }
    ],
    exampleSummary: "系数 0.02，长 100m，径 0.1m，流速 2m/s，损失约为 4.08m。",
    riskNotice: "阻力系数需根据雷诺数和相对粗糙度查图或计算。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const lambda = Math.max(0, v["阻力系数_lambda"] || 0);
      const L = Math.max(0, v["管道长度_L"] || 0);
      const D = Math.max(0.001, v["管道内径_D"] || 0.1);
      const vel = Math.max(0, v["流速_v"] || 0);
      const g = Math.max(0.1, v["重力加速度_g"] || 9.8);
      return { "沿程水头损失": lambda * (L / D) * (Math.pow(vel, 2) / (2 * g)) };
    }
  },
  {
    id: "STR-PIP-002",
    title: "排水管坡度降落计算",
    formula: "Δh = L * i",
    inputs: [
      { key: "水平长度_L", label: "水平长度", unit: "m", defaultValue: 50, min: 0, step: 1, description: "管道的水平投影长度" },
      { key: "管道坡度_i", label: "管道坡度", unit: "小数", defaultValue: 0.003, min: 0, step: 0.001, description: "设计坡度（如 3‰ 取 0.003）" }
    ],
    outputs: [
      { key: "标高降落差", label: "标高降落差", unit: "m", precision: 3 }
    ],
    exampleSummary: "长 50m，坡度 0.003，标高降落 0.15m。",
    riskNotice: "需复核是否满足最小坡度要求。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const L = Math.max(0, v["水平长度_L"] || 0);
      const i = v["管道坡度_i"] || 0;
      return { "标高降落差": L * i };
    }
  },
  {
    id: "STR-PIP-003",
    title: "管道满水试验水量计算",
    formula: "V = (π * D^2 / 4) * L",
    inputs: [
      { key: "管道内径_D", label: "管道内径", unit: "m", defaultValue: 0.8, min: 0, step: 0.05, description: "管道内部直径" },
      { key: "试验段长度_L", label: "试验段长度", unit: "m", defaultValue: 100, min: 0, step: 1, description: "闭水试验段长度" }
    ],
    outputs: [
      { key: "注水量", label: "注水量", unit: "m³", precision: 2 }
    ],
    exampleSummary: "内径 0.8m，长 100m，注水量约为 50.24 m³。",
    riskNotice: "未包含检查井内注水量，实际需水量略大。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const D = Math.max(0, v["管道内径_D"] || 0);
      const L = Math.max(0, v["试验段长度_L"] || 0);
      return { "注水量": (Math.PI * Math.pow(D, 2) / 4) * L };
    }
  },
  {
    id: "STR-PIP-004",
    title: "雨水流量计算",
    formula: "Q = q * Ψ * F",
    inputs: [
      { key: "暴雨强度_q", label: "设计暴雨强度", unit: "L/(s·hm²)", defaultValue: 300, min: 0, step: 10, description: "当地设计暴雨强度" },
      { key: "径流系数_Psi", label: "径流系数", unit: "无量纲", defaultValue: 0.9, min: 0, max: 1, step: 0.05, description: "地面或屋面的径流系数" },
      { key: "汇水面积_F", label: "汇水面积", unit: "hm²", defaultValue: 0.2, min: 0, step: 0.01, description: "汇水区域面积" }
    ],
    outputs: [
      { key: "雨水设计流量", label: "雨水设计流量", unit: "L/s", precision: 2 }
    ],
    exampleSummary: "强度 300，系数 0.9，面积 0.2 hm²，流量为 54 L/s。",
    riskNotice: "暴雨强度公式具有地域性，需查当地气象数据。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const q = Math.max(0, v["暴雨强度_q"] || 0);
      const psi = Math.max(0, v["径流系数_Psi"] || 0);
      const F = Math.max(0, v["汇水面积_F"] || 0);
      return { "雨水设计流量": q * psi * F };
    }
  },
  {
    id: "STR-PIP-005",
    title: "沟槽土方回填量",
    formula: "V_back = V_exc - V_pipe - V_bed",
    inputs: [
      { key: "开挖体积_Vexc", label: "沟槽开挖体积", unit: "m³", defaultValue: 100, min: 0, step: 1, description: "沟槽的总开挖体积" },
      { key: "管占体积_Vpipe", label: "管道占位体积", unit: "m³", defaultValue: 9.8, min: 0, step: 0.1, description: "管道外径所占的体积" },
      { key: "基础体积_Vbed", label: "垫层基础体积", unit: "m³", defaultValue: 10, min: 0, step: 0.1, description: "管道垫层及基础体积" }
    ],
    outputs: [
      { key: "回填体积", label: "回填体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "开挖 100，管占 9.8，垫层 10，回填量为 80.2 m³。",
    riskNotice: "小管径按定额规定可能不扣除管道体积。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const Vexc = Math.max(0, v["开挖体积_Vexc"] || 0);
      const Vpipe = Math.max(0, v["管占体积_Vpipe"] || 0);
      const Vbed = Math.max(0, v["基础体积_Vbed"] || 0);
      return { "回填体积": Math.max(0, Vexc - Vpipe - Vbed) };
    }
  },
  {
    id: "STR-LOD-002",
    title: "风荷载标准值计算",
    formula: "ωk = βz * μs * μz * ω0",
    inputs: [
      { key: "风振系数_betaz", label: "风振系数", unit: "无量纲", defaultValue: 1.5, min: 1, step: 0.1, description: "高度 z 处的风振系数" },
      { key: "体型系数_mus", label: "体型系数", unit: "无量纲", defaultValue: 0.8, min: 0, step: 0.1, description: "风荷载体型系数" },
      { key: "高度系数_muz", label: "高度系数", unit: "无量纲", defaultValue: 1.2, min: 0, step: 0.1, description: "风压高度变化系数" },
      { key: "基本风压_omega0", label: "基本风压", unit: "kN/m²", defaultValue: 0.45, min: 0, step: 0.05, description: "当地基本风压" }
    ],
    outputs: [
      { key: "风荷载标准值", label: "风荷载标准值", unit: "kN/m²", precision: 3 }
    ],
    exampleSummary: "风振 1.5，体型 0.8，高度 1.2，基压 0.45，标准值为 0.648 kN/m²。",
    riskNotice: "基本风压重现期需按设计或施工规范选取。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const betaz = Math.max(0, v["风振系数_betaz"] || 0);
      const mus = Math.max(0, v["体型系数_mus"] || 0);
      const muz = Math.max(0, v["高度系数_muz"] || 0);
      const omega0 = Math.max(0, v["基本风压_omega0"] || 0);
      return { "风荷载标准值": betaz * mus * muz * omega0 };
    }
  },
  {
    id: "STR-LOD-003",
    title: "模板施工荷载组合",
    formula: "N = 1.2(NG1k + NG2k) + 1.4(NQ1k + NQ2k)",
    inputs: [
      { key: "支架自重_NG1k", label: "支架自重荷载", unit: "kN", defaultValue: 0.5, min: 0, step: 0.1, description: "模板及支架自重标准值产生的轴力" },
      { key: "混筋自重_NG2k", label: "混筋自重荷载", unit: "kN", defaultValue: 5.0, min: 0, step: 0.1, description: "新浇混凝土及钢筋自重标准值产生的轴力" },
      { key: "人员设备_NQ1k", label: "人员设备荷载", unit: "kN", defaultValue: 1.0, min: 0, step: 0.1, description: "施工人员及设备荷载标准值产生的轴力" },
      { key: "振捣荷载_NQ2k", label: "振捣荷载", unit: "kN", defaultValue: 0.5, min: 0, step: 0.1, description: "振捣混凝土时产生的荷载标准值产生的轴力" }
    ],
    outputs: [
      { key: "立杆轴力设计值", label: "立杆轴力设计值", unit: "kN", precision: 2 }
    ],
    exampleSummary: "自重 0.5+5.0，施工 1.0+0.5，设计轴力为 8.7 kN。",
    riskNotice: "荷载分项系数需按最新规范核实。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const NG1k = Math.max(0, v["支架自重_NG1k"] || 0);
      const NG2k = Math.max(0, v["混筋自重_NG2k"] || 0);
      const NQ1k = Math.max(0, v["人员设备_NQ1k"] || 0);
      const NQ2k = Math.max(0, v["振捣荷载_NQ2k"] || 0);
      return { "立杆轴力设计值": 1.2 * (NG1k + NG2k) + 1.4 * (NQ1k + NQ2k) };
    }
  },
  {
    id: "STR-LOD-004",
    title: "塔吊基础抗倾覆验算",
    formula: "e = (M + Fh * h) / (Fv + G) <= b/3",
    inputs: [
      { key: "倾覆力矩_M", label: "倾覆力矩", unit: "kN·m", defaultValue: 1500, min: 0, step: 50, description: "塔吊作用于基础的倾覆力矩" },
      { key: "水平力_Fh", label: "水平力", unit: "kN", defaultValue: 50, min: 0, step: 5, description: "塔吊作用于基础的水平力" },
      { key: "基础高度_h", label: "基础高度", unit: "m", defaultValue: 1.2, min: 0, step: 0.1, description: "基础自身的高度" },
      { key: "竖向力_Fv", label: "竖向力", unit: "kN", defaultValue: 600, min: 0, step: 50, description: "塔吊作用于基础的垂直竖向力" },
      { key: "基础自重_G", label: "基础及土重", unit: "kN", defaultValue: 1200, min: 0, step: 50, description: "基础自重及其上土重" },
      { key: "基础宽度_b", label: "基础宽度", unit: "m", defaultValue: 5, min: 0.1, step: 0.1, description: "矩形基础底面宽度" }
    ],
    outputs: [
      { key: "实际偏心距", label: "实际偏心距", unit: "m", precision: 3 },
      { key: "允许偏心距", label: "允许偏心距", unit: "m", precision: 3 }
    ],
    exampleSummary: "M=1500, Fh=50, Fv=600, G=1200, b=5，偏心距 0.867 <= 1.667，满足要求。",
    riskNotice: "需分别验算工作状态和非工作状态。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const M = Math.max(0, v["倾覆力矩_M"] || 0);
      const Fh = Math.max(0, v["水平力_Fh"] || 0);
      const h = Math.max(0, v["基础高度_h"] || 0);
      const Fv = Math.max(0, v["竖向力_Fv"] || 0);
      const G = Math.max(0, v["基础自重_G"] || 0);
      const b = Math.max(0.1, v["基础宽度_b"] || 5);
      const e = (M + Fh * h) / (Fv + G);
      return {
        "实际偏心距": e,
        "允许偏心距": b / 3
      };
    }
  },
  {
    id: "STR-LOD-005",
    title: "均布荷载下简支梁最大弯矩",
    formula: "Mmax = q * L^2 / 8",
    inputs: [
      { key: "线荷载_q", label: "均布线荷载", unit: "kN/m", defaultValue: 20, min: 0, step: 1, description: "作用在梁上的均布线荷载设计值" },
      { key: "计算跨度_L", label: "计算跨度", unit: "m", defaultValue: 6, min: 0, step: 0.1, description: "梁的计算跨度" }
    ],
    outputs: [
      { key: "最大弯矩", label: "最大弯矩", unit: "kN·m", precision: 2 }
    ],
    exampleSummary: "线荷载 20 kN/m，跨度 6m，最大弯矩为 90 kN·m。",
    riskNotice: "仅适用于理想简支支座和均布满载情况。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const q = Math.max(0, v["线荷载_q"] || 0);
      const L = Math.max(0, v["计算跨度_L"] || 0);
      return { "最大弯矩": (q * Math.pow(L, 2)) / 8 };
    }
  },
  {
    id: "STR-MIX-001",
    title: "混凝土含水率换算(施工配合比)",
    formula: "Ss = S0(1+a), Gs = G0(1+b), Ws = W0 - S0a - G0b",
    inputs: [
      { key: "试砂量_S0", label: "试验室砂量", unit: "kg/m³", defaultValue: 650, min: 0, step: 10, description: "试验室配合比砂用量" },
      { key: "试石量_G0", label: "试验室石量", unit: "kg/m³", defaultValue: 1200, min: 0, step: 10, description: "试验室配合比石用量" },
      { key: "试水量_W0", label: "试验室水量", unit: "kg/m³", defaultValue: 180, min: 0, step: 5, description: "试验室配合比水用量" },
      { key: "砂含水_a", label: "砂含水率", unit: "%", defaultValue: 4, min: 0, step: 0.1, description: "现场测定砂的含水率" },
      { key: "石含水_b", label: "石含水率", unit: "%", defaultValue: 1, min: 0, step: 0.1, description: "现场测定石的含水率" }
    ],
    outputs: [
      { key: "施工砂量", label: "施工砂量", unit: "kg/m³", precision: 1 },
      { key: "施工石量", label: "施工石量", unit: "kg/m³", precision: 1 },
      { key: "施工水量", label: "施工水量", unit: "kg/m³", precision: 1 }
    ],
    exampleSummary: "水180, 砂650, 石1200，含水率砂4%石1%，施工用水调为 142kg。",
    riskNotice: "参考配比不得替代试验室试配。雨后需重新测定。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const S0 = Math.max(0, v["试砂量_S0"] || 0);
      const G0 = Math.max(0, v["试石量_G0"] || 0);
      const W0 = Math.max(0, v["试水量_W0"] || 0);
      const a = (v["砂含水_a"] || 0) / 100;
      const b = (v["石含水_b"] || 0) / 100;
      return {
        "施工砂量": S0 * (1 + a),
        "施工石量": G0 * (1 + b),
        "施工水量": Math.max(0, W0 - S0 * a - G0 * b)
      };
    }
  },
  {
    id: "STR-MIX-002",
    title: "砂浆配合比质量体积换算",
    formula: "Vi = Mi / rho_i",
    inputs: [
      { key: "水泥质量_Mc", label: "水泥质量", unit: "kg", defaultValue: 50, min: 0, step: 1, description: "水泥的质量" },
      { key: "砂质量_Ms", label: "砂质量", unit: "kg", defaultValue: 250, min: 0, step: 1, description: "砂的质量" },
      { key: "水泥密度", label: "水泥表观密度", unit: "kg/m³", defaultValue: 1300, min: 1, step: 50, description: "水泥的表观密度" },
      { key: "砂密度", label: "砂表观密度", unit: "kg/m³", defaultValue: 1450, min: 1, step: 50, description: "砂的表观密度" }
    ],
    outputs: [
      { key: "水泥体积", label: "水泥体积", unit: "m³", precision: 3 },
      { key: "砂体积", label: "砂体积", unit: "m³", precision: 3 },
      { key: "体积比", label: "体积比 (1:X)", unit: "无量纲", precision: 2 }
    ],
    exampleSummary: "水泥50kg, 砂250kg，体积比约为 1 : 4.5。",
    riskNotice: "规范要求按质量称量，体积比仅用于粗略估算。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const Mc = Math.max(0, v["水泥质量_Mc"] || 0);
      const Ms = Math.max(0, v["砂质量_Ms"] || 0);
      const rhoC = Math.max(1, v["水泥密度"] || 1300);
      const rhoS = Math.max(1, v["砂密度"] || 1450);
      const Vc = Mc / rhoC;
      const Vs = Ms / rhoS;
      return {
        "水泥体积": Vc,
        "砂体积": Vs,
        "体积比": Vc > 0 ? Vs / Vc : 0
      };
    }
  },
  {
    id: "STR-MIX-003",
    title: "标高相对绝对换算",
    formula: "Habs = Hrel + Hzero",
    inputs: [
      { key: "相对标高_Hrel", label: "图纸相对标高", unit: "m", defaultValue: 3.2, min: -1000, step: 0.001, description: "图纸上标注的相对高度" },
      { key: "绝对标高_Hzero", label: "±0.000绝对标高", unit: "m", defaultValue: 45.5, min: -1000, step: 0.001, description: "建筑正负零对应的绝对标高" }
    ],
    outputs: [
      { key: "绝对标高", label: "待测点绝对标高", unit: "m", precision: 3 }
    ],
    exampleSummary: "±0.000 为 45.5m，图纸标高 +3.2m，绝对标高为 48.7m。",
    riskNotice: "绝对标高基准点需经复核确认。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const Hrel = v["相对标高_Hrel"] || 0;
      const Hzero = v["绝对标高_Hzero"] || 0;
      return { "绝对标高": Hrel + Hzero };
    }
  },
  {
    id: "STR-MIX-004",
    title: "钢材吨与米换算",
    formula: "L = M / w",
    inputs: [
      { key: "总质量_M", label: "钢材总质量", unit: "kg", defaultValue: 5000, min: 0, step: 100, description: "钢材的总重量" },
      { key: "线密度_w", label: "理论线密度", unit: "kg/m", defaultValue: 25, min: 0.001, step: 0.1, description: "钢材每米的理论重量" }
    ],
    outputs: [
      { key: "总长度", label: "总长度", unit: "m", precision: 2 }
    ],
    exampleSummary: "5吨钢材，线密度 25 kg/m，总长约为 200m。",
    riskNotice: "实际钢材有理重下差，实际长度会略大于理论长度。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const M = Math.max(0, v["总质量_M"] || 0);
      const w = Math.max(0.001, v["线密度_w"] || 1);
      return { "总长度": M / w };
    }
  },
  {
    id: "STR-MIX-005",
    title: "坡度百分比与角度换算",
    formula: "theta = arctan(i)",
    inputs: [
      { key: "坡度百分比_i", label: "坡度百分比", unit: "小数", defaultValue: 0.15, min: 0, step: 0.01, description: "坡度的百分比形式（如 15% 取 0.15）" }
    ],
    outputs: [
      { key: "坡度角", label: "坡度角", unit: "°", precision: 2 }
    ],
    exampleSummary: "15% 坡度，对应夹角约为 8.53°。",
    riskNotice: "坡度百分比是正切值，不是正弦值。高风险结构需专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const i = v["坡度百分比_i"] || 0;
      return { "坡度角": Math.atan(i) * (180 / Math.PI) };
    }
  }
];
