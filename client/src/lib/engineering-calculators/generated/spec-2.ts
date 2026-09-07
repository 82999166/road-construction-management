/**
 * 材料标准配比试验 - 计算器规格模块
 * 
 * 本模块包含从审计报告中提取的 24 条自动计算条目。
 * 其中 23 条已转换为可执行的 TypeScript 规格，
 * 1 条因缺乏确定性数值公式而被列为不支持。
 * 
 * 不支持条目说明：
 * - M-027: 沥青针入度试验（仅为仪器刻度直接读取，无数值换算公式）
 */

export interface InputSpec {
  key: string;
  label: string;
  unit: string;
  defaultValue: number;
  min: number;
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

export const unsupportedCalculatorIds = ['M-027'];

export const categoryCalculatorSpecs: CalculatorSpec[] = [
  {
    id: 'M-001',
    title: '混凝土施工配合比换算',
    formula: '水 = 试验室用水量 - 砂用量×砂含水率 - 石用量×石含水率；砂 = 试验室砂用量 × (1 + 砂含水率)；石 = 试验室石用量 × (1 + 石含水率)',
    inputs: [
      { key: 'labWater', label: '试验室用水量', unit: 'kg/m³', defaultValue: 180, min: 0, step: 1, description: '试验室配合比给出的单位用水量' },
      { key: 'labSand', label: '试验室砂用量', unit: 'kg/m³', defaultValue: 700, min: 0, step: 1, description: '试验室配合比给出的单位砂用量' },
      { key: 'labStone', label: '试验室石用量', unit: 'kg/m³', defaultValue: 1200, min: 0, step: 1, description: '试验室配合比给出的单位石用量' },
      { key: 'labCement', label: '试验室水泥用量', unit: 'kg/m³', defaultValue: 300, min: 0, step: 1, description: '试验室配合比给出的单位水泥用量' },
      { key: 'sandWaterRate', label: '砂含水率', unit: '%', defaultValue: 4, min: 0, step: 0.1, description: '现场测得的砂含水率' },
      { key: 'stoneWaterRate', label: '石含水率', unit: '%', defaultValue: 1, min: 0, step: 0.1, description: '现场测得的石含水率' }
    ],
    outputs: [
      { key: 'siteWater', label: '施工用水量', unit: 'kg/m³', precision: 1 },
      { key: 'siteSand', label: '施工砂用量', unit: 'kg/m³', precision: 1 },
      { key: 'siteStone', label: '施工石用量', unit: 'kg/m³', precision: 1 },
      { key: 'siteCement', label: '施工水泥用量', unit: 'kg/m³', precision: 1 }
    ],
    exampleSummary: '试验室配比：水泥300kg，水180kg，砂700kg，石1200kg。砂含水率4%，石含水率1%。计算得：施工砂728kg，施工石1212kg，施工水140kg。',
    riskNotice: '参考配比绝对不能替代试配。雨天施工应增加含水率检测频率。',
    requiresProfessionalReview: true,
    calculate: (v) => {
      const sRate = v.sandWaterRate / 100;
      const stRate = v.stoneWaterRate / 100;
      const siteSand = v.labSand * (1 + sRate);
      const siteStone = v.labStone * (1 + stRate);
      const siteWater = Math.max(0, v.labWater - v.labSand * sRate - v.labStone * stRate);
      return {
        siteWater,
        siteSand,
        siteStone,
        siteCement: v.labCement
      };
    }
  },
  {
    id: 'M-002',
    title: '混凝土立方体抗压强度计算',
    formula: 'f_cu = F / A',
    inputs: [
      { key: 'F', label: '破坏荷载', unit: 'N', defaultValue: 675000, min: 0, step: 100, description: '试验机测得的最大破坏荷载' },
      { key: 'A', label: '受压面积', unit: 'mm²', defaultValue: 22500, min: 1, step: 1, description: '试件受压面积，标准150mm试件为22500' }
    ],
    outputs: [
      { key: 'f_cu', label: '抗压强度', unit: 'MPa', precision: 1 }
    ],
    exampleSummary: '150mm试件，破坏荷载675000N，面积22500mm²，强度30.0MPa。',
    riskNotice: '非标准尺寸试件需乘以尺寸换算系数（100mm取0.95，200mm取1.05）。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ f_cu: v.A > 0 ? v.F / v.A : 0 })
  },
  {
    id: 'M-003',
    title: '混凝土抗折强度计算',
    formula: 'f_f = (F × l) / (b × h²)',
    inputs: [
      { key: 'F', label: '破坏荷载', unit: 'N', defaultValue: 35000, min: 0, step: 100, description: '试件破坏时的最大荷载' },
      { key: 'l', label: '支座间跨度', unit: 'mm', defaultValue: 450, min: 1, step: 1, description: '标准跨度通常为450mm' },
      { key: 'b', label: '试件截面宽度', unit: 'mm', defaultValue: 150, min: 1, step: 1, description: '试件截面宽度' },
      { key: 'h', label: '试件截面高度', unit: 'mm', defaultValue: 150, min: 1, step: 1, description: '试件截面高度' }
    ],
    outputs: [
      { key: 'f_f', label: '抗折强度', unit: 'MPa', precision: 2 }
    ],
    exampleSummary: '标准试件150×150×600mm，跨度450mm，破坏荷载35000N，强度4.67MPa。',
    riskNotice: '若断裂面在三分点之外，该试件结果作废。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ f_f: (v.b * v.h * v.h) > 0 ? (v.F * v.l) / (v.b * v.h * v.h) : 0 })
  },
  {
    id: 'M-004',
    title: '回弹法检测混凝土抗压强度辅助测算',
    formula: 'Rm = 平均(回弹值)；查表得出 f_cu,c',
    inputs: [
      { key: 'Rm', label: '测区平均回弹值', unit: '', defaultValue: 35.2, min: 0, step: 0.1, description: '剔除3个最大和3个最小值后的平均值' },
      { key: 'dm', label: '平均碳化深度', unit: 'mm', defaultValue: 1.5, min: 0, step: 0.5, description: '实测平均碳化深度' },
      { key: 'f_cu_c_manual', label: '查表强度换算值', unit: 'MPa', defaultValue: 32.5, min: 0, step: 0.1, description: '根据Rm和dm查测强曲线表得出的强度值' }
    ],
    outputs: [
      { key: 'f_cu_c', label: '测区强度推定值', unit: 'MPa', precision: 1 }
    ],
    exampleSummary: '测区平均回弹值35.2，碳化深度1.5mm，查表得换算强度约为32.5MPa。',
    riskNotice: '需区分泵送与非泵送、测角修正、浇筑面修正。表层受损或有饰面层的不能直接测。',
    requiresProfessionalReview: true,
    calculate: (v) => ({ f_cu_c: v.f_cu_c_manual })
  },
  {
    id: 'M-005',
    title: '混凝土坍落度试验',
    formula: '坍落度 = 坍落前筒高(300mm) - 坍落后试体高',
    inputs: [
      { key: 'h_after', label: '坍落后试体高', unit: 'mm', defaultValue: 115, min: 0, step: 1, description: '提起坍落度筒后试体最高点的高度' }
    ],
    outputs: [
      { key: 'slump', label: '坍落度', unit: 'mm', precision: 0 }
    ],
    exampleSummary: '坍落前筒高300mm，坍落后试体高115mm，坍落度为185mm。',
    riskNotice: '提筒过程应在5-10s内完成，从开始装料到提筒完成不应超过150s。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ slump: Math.max(0, 300 - v.h_after) })
  },
  {
    id: 'M-008',
    title: '砂浆立方体抗压强度计算',
    formula: 'f_m = (K × F) / A',
    inputs: [
      { key: 'F', label: '破坏荷载', unit: 'N', defaultValue: 30000, min: 0, step: 100, description: '试件破坏时的最大荷载' },
      { key: 'A', label: '受压面积', unit: 'mm²', defaultValue: 5000, min: 1, step: 1, description: '标准试件受压面积为5000mm²' },
      { key: 'K', label: '换算系数', unit: '', defaultValue: 1.35, min: 0, step: 0.01, description: '通常取1.35' }
    ],
    outputs: [
      { key: 'f_m', label: '砂浆抗压强度', unit: 'MPa', precision: 1 }
    ],
    exampleSummary: '破坏荷载30000N，换算系数1.35，面积5000mm²，强度8.1MPa。',
    riskNotice: '注意底模材料（无底模或有底模）会影响水分流失。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ f_m: v.A > 0 ? (v.K * v.F) / v.A : 0 })
  },
  {
    id: 'M-009',
    title: '砂浆保水率计算',
    formula: 'W = [1 - (m4 - m3) / (m2 - m1) × α] × 100%',
    inputs: [
      { key: 'm1', label: '滤纸质量', unit: 'g', defaultValue: 10, min: 0, step: 0.01, description: '干燥滤纸质量' },
      { key: 'm2', label: '吸水后滤纸质量', unit: 'g', defaultValue: 15, min: 0, step: 0.01, description: '吸水后的滤纸质量' },
      { key: 'm3', label: '砂浆质量', unit: 'g', defaultValue: 200, min: 0, step: 0.1, description: '加入的砂浆质量' },
      { key: 'm4', label: '砂浆与滤纸总质量', unit: 'g', defaultValue: 200, min: 0, step: 0.1, description: '试验后的总质量' },
      { key: 'alpha', label: '砂浆含水率', unit: '%', defaultValue: 15, min: 0, step: 0.1, description: '砂浆本身的含水率百分比' }
    ],
    outputs: [
      { key: 'W', label: '保水率', unit: '%', precision: 1 }
    ],
    exampleSummary: 'm1=10g, m2=15g, m3=200g, m4=200g, α=15%，计算得保水率92%。',
    riskNotice: '试验时间需严格控制，滤纸规格需符合标准。',
    requiresProfessionalReview: false,
    calculate: (v) => {
      const denom = v.m2 - v.m1;
      if (denom <= 0) return { W: 0 };
      const W = (1 - ((v.m4 - v.m3) / denom) * (v.alpha / 100)) * 100;
      return { W: Math.min(100, Math.max(0, W)) };
    }
  },
  {
    id: 'M-010',
    title: '砌筑砂浆施工配合比',
    formula: '施工用水量 = 试验室用水量 - 砂用量 × 砂含水率；湿砂称量 = 砂用量 × (1 + 砂含水率)',
    inputs: [
      { key: 'labWater', label: '试验室用水量', unit: 'kg/m³', defaultValue: 280, min: 0, step: 1, description: '试验室配合比给出的单位用水量' },
      { key: 'labSand', label: '试验室砂用量', unit: 'kg/m³', defaultValue: 1450, min: 0, step: 1, description: '试验室配合比给出的单位砂用量' },
      { key: 'sandWaterRate', label: '砂含水率', unit: '%', defaultValue: 3, min: 0, step: 0.1, description: '现场测得的砂含水率' }
    ],
    outputs: [
      { key: 'siteWater', label: '施工用水量', unit: 'kg/m³', precision: 1 },
      { key: 'wetSand', label: '湿砂称量', unit: 'kg/m³', precision: 1 }
    ],
    exampleSummary: '试验室配比：水280kg，砂1450kg。砂含水率3%。计算得：湿砂1493.5kg，施工用水量236.5kg。',
    riskNotice: '含水率变化大时需随时调整，严禁随意加水。参考配比不得替代试验室试配。',
    requiresProfessionalReview: true,
    calculate: (v) => {
      const sRate = v.sandWaterRate / 100;
      const wetSand = v.labSand * (1 + sRate);
      const siteWater = Math.max(0, v.labWater - v.labSand * sRate);
      return { siteWater, wetSand };
    }
  },
  {
    id: 'M-012',
    title: '钢筋屈服强度计算',
    formula: 'R_eL = F_eL / S_0',
    inputs: [
      { key: 'FeL', label: '屈服荷载', unit: 'N', defaultValue: 90000, min: 0, step: 100, description: '钢筋屈服时的荷载值' },
      { key: 'S0', label: '公称截面积', unit: 'mm²', defaultValue: 201.1, min: 1, step: 0.1, description: '钢筋公称截面积，直径16mm为201.1' }
    ],
    outputs: [
      { key: 'ReL', label: '下屈服强度', unit: 'MPa', precision: 1 }
    ],
    exampleSummary: '直径16mm钢筋(S0=201.1mm²)，屈服荷载90000N，强度447.5MPa。',
    riskNotice: '公称截面积按理论值计算，不使用实测截面积。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ ReL: v.S0 > 0 ? v.FeL / v.S0 : 0 })
  },
  {
    id: 'M-013',
    title: '钢筋抗拉强度计算',
    formula: 'R_m = F_m / S_0',
    inputs: [
      { key: 'Fm', label: '最大拉力荷载', unit: 'N', defaultValue: 120000, min: 0, step: 100, description: '钢筋拉断前的最大荷载' },
      { key: 'S0', label: '公称截面积', unit: 'mm²', defaultValue: 201.1, min: 1, step: 0.1, description: '钢筋公称截面积' }
    ],
    outputs: [
      { key: 'Rm', label: '抗拉强度', unit: 'MPa', precision: 1 }
    ],
    exampleSummary: '最大荷载120000N，S0=201.1mm²，强度596.7MPa。',
    riskNotice: '需同时满足强屈比要求（如抗震钢筋Rm/ReL ≥ 1.25）。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ Rm: v.S0 > 0 ? v.Fm / v.S0 : 0 })
  },
  {
    id: 'M-014',
    title: '钢筋断后伸长率计算',
    formula: 'A = (L_u - L_0) / L_0 × 100%',
    inputs: [
      { key: 'Lu', label: '断后标距', unit: 'mm', defaultValue: 95, min: 0, step: 0.5, description: '拉断后拼合测得的标距长度' },
      { key: 'L0', label: '原始标距', unit: 'mm', defaultValue: 80, min: 1, step: 1, description: '试验前的原始标距' }
    ],
    outputs: [
      { key: 'A', label: '断后伸长率', unit: '%', precision: 1 }
    ],
    exampleSummary: '原始标距80mm，断后标距95mm，伸长率18.75%（通常修约至18.5%）。',
    riskNotice: '断裂处距标距端部小于1/3标距时，如结果不合格需复验。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ A: v.L0 > 0 ? ((v.Lu - v.L0) / v.L0) * 100 : 0 })
  },
  {
    id: 'M-015',
    title: '钢筋重量偏差计算',
    formula: 'D = (W_d - W_0) / W_0 × 100%',
    inputs: [
      { key: 'Wd', label: '实际每米重量', unit: 'kg/m', defaultValue: 0.84, min: 0, step: 0.001, description: '实测重量除以总长度' },
      { key: 'W0', label: '理论每米重量', unit: 'kg/m', defaultValue: 0.888, min: 0.001, step: 0.001, description: '规范给出的理论重量' }
    ],
    outputs: [
      { key: 'D', label: '重量偏差', unit: '%', precision: 1 }
    ],
    exampleSummary: '理论重量0.888kg/m，实测0.84kg/m，偏差-5.4%。',
    riskNotice: '试样需端部平齐，长度测量精确至1mm，重量精确至1g。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ D: v.W0 > 0 ? ((v.Wd - v.W0) / v.W0) * 100 : 0 })
  },
  {
    id: 'M-016',
    title: '钢材理论重量计算（圆钢/带肋钢筋）',
    formula: 'W = 0.00617 × d²',
    inputs: [
      { key: 'd', label: '钢筋公称直径', unit: 'mm', defaultValue: 20, min: 1, step: 1, description: '钢筋的标称直径' }
    ],
    outputs: [
      { key: 'W', label: '每米理论重量', unit: 'kg/m', precision: 2 }
    ],
    exampleSummary: '直径20mm钢筋，理论重量为 0.00617 × 20² = 2.47 kg/m。',
    riskNotice: '该公式为近似公式，精确结算应以过磅或规范理论重量表为准。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ W: 0.00617 * v.d * v.d })
  },
  {
    id: 'M-018',
    title: '水泥标准稠度用水量测定',
    formula: 'P = W / M × 100%',
    inputs: [
      { key: 'W', label: '拌和用水量', unit: 'mL', defaultValue: 140, min: 0, step: 1, description: '达到标准稠度时的用水量' },
      { key: 'M', label: '水泥质量', unit: 'g', defaultValue: 500, min: 1, step: 1, description: '水泥试样质量，通常为500g' }
    ],
    outputs: [
      { key: 'P', label: '标准稠度用水量', unit: '%', precision: 1 }
    ],
    exampleSummary: '500g水泥加水140mL，标准稠度用水量为28.0%。',
    riskNotice: '试验室温度需控制在20±2℃，湿度≥50%。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ P: v.M > 0 ? (v.W / v.M) * 100 : 0 })
  },
  {
    id: 'M-019',
    title: '水泥胶砂抗压强度计算',
    formula: 'R_c = F_c / A',
    inputs: [
      { key: 'Fc', label: '破坏荷载', unit: 'N', defaultValue: 72000, min: 0, step: 100, description: '试件破坏时的荷载' },
      { key: 'A', label: '受压面积', unit: 'mm²', defaultValue: 1600, min: 1, step: 1, description: '受压面积，通常为1600mm²' }
    ],
    outputs: [
      { key: 'Rc', label: '抗压强度', unit: 'MPa', precision: 1 }
    ],
    exampleSummary: '破坏荷载72000N，面积1600mm²，强度45.0MPa。',
    riskNotice: '需取6个抗压结果的平均值，若有超出平均值±10%的需剔除。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ Rc: v.A > 0 ? v.Fc / v.A : 0 })
  },
  {
    id: 'M-022',
    title: '砂的含水率计算',
    formula: 'ω = (m_1 - m_2) / m_2 × 100%',
    inputs: [
      { key: 'm1', label: '烘干前砂的质量', unit: 'g', defaultValue: 500, min: 0, step: 0.1, description: '湿砂质量' },
      { key: 'm2', label: '烘干后砂的质量', unit: 'g', defaultValue: 476, min: 0.1, step: 0.1, description: '烘干至恒重后的干砂质量' }
    ],
    outputs: [
      { key: 'w', label: '含水率', unit: '%', precision: 1 }
    ],
    exampleSummary: '湿砂500g，烘干后476g，含水率5.0%。',
    riskNotice: '烘干温度应在105±5℃，至恒重。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ w: v.m2 > 0 ? ((v.m1 - v.m2) / v.m2) * 100 : 0 })
  },
  {
    id: 'M-023',
    title: '碎石压碎值指标计算',
    formula: 'Q_e = m_1 / m_0 × 100%',
    inputs: [
      { key: 'm1', label: '细料质量', unit: 'g', defaultValue: 360, min: 0, step: 1, description: '试验后通过2.36mm筛孔的细料质量' },
      { key: 'm0', label: '试样总质量', unit: 'g', defaultValue: 3000, min: 1, step: 1, description: '试验前试样总质量' }
    ],
    outputs: [
      { key: 'Qe', label: '压碎值指标', unit: '%', precision: 1 }
    ],
    exampleSummary: '总重3000g，细料重360g，压碎值为12.0%。',
    riskNotice: '加荷速度需均匀，达到400kN后稳压5s。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ Qe: v.m0 > 0 ? (v.m1 / v.m0) * 100 : 0 })
  },
  {
    id: 'M-024',
    title: '砂的细度模数计算',
    formula: 'M_x = [(A2 + A3 + A4 + A5 + A6) - 5×A1] / (100 - A1)',
    inputs: [
      { key: 'A1', label: '4.75mm累计筛余', unit: '%', defaultValue: 5, min: 0, step: 0.1, description: '4.75mm筛的累计筛余百分率' },
      { key: 'A2', label: '2.36mm累计筛余', unit: '%', defaultValue: 15, min: 0, step: 0.1, description: '2.36mm筛的累计筛余百分率' },
      { key: 'A3', label: '1.18mm累计筛余', unit: '%', defaultValue: 35, min: 0, step: 0.1, description: '1.18mm筛的累计筛余百分率' },
      { key: 'A4', label: '0.60mm累计筛余', unit: '%', defaultValue: 65, min: 0, step: 0.1, description: '0.60mm筛的累计筛余百分率' },
      { key: 'A5', label: '0.30mm累计筛余', unit: '%', defaultValue: 85, min: 0, step: 0.1, description: '0.30mm筛的累计筛余百分率' },
      { key: 'A6', label: '0.15mm累计筛余', unit: '%', defaultValue: 95, min: 0, step: 0.1, description: '0.15mm筛的累计筛余百分率' }
    ],
    outputs: [
      { key: 'Mx', label: '细度模数', unit: '', precision: 1 }
    ],
    exampleSummary: '累计筛余：A1=5%, A2=15%, A3=35%, A4=65%, A5=85%, A6=95%。计算得Mx=2.8。',
    riskNotice: '当0.15mm筛下有较多泥土时需先水洗，公式计算保留至小数点后一位。',
    requiresProfessionalReview: false,
    calculate: (v) => {
      const denom = 100 - v.A1;
      if (denom === 0) return { Mx: 0 };
      const Mx = (v.A2 + v.A3 + v.A4 + v.A5 + v.A6 - 5 * v.A1) / denom;
      return { Mx: Math.max(0, Mx) };
    }
  },
  {
    id: 'M-025',
    title: '粗骨料针片状颗粒含量计算',
    formula: 'Q_p = m_p / m_0 × 100%',
    inputs: [
      { key: 'mp', label: '针片状颗粒质量', unit: 'g', defaultValue: 85, min: 0, step: 1, description: '挑出的针片状颗粒质量' },
      { key: 'm0', label: '试样总质量', unit: 'g', defaultValue: 1000, min: 1, step: 1, description: '试样总质量' }
    ],
    outputs: [
      { key: 'Qp', label: '针片状颗粒含量', unit: '%', precision: 1 }
    ],
    exampleSummary: '总重1000g，针片状85g，含量8.5%。',
    riskNotice: '必须使用专用的针片状规准仪逐粒鉴定。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ Qp: v.m0 > 0 ? (v.mp / v.m0) * 100 : 0 })
  },
  {
    id: 'M-029',
    title: '沥青混合料马歇尔稳定度辅助测算',
    formula: 'MS = P × K',
    inputs: [
      { key: 'P', label: '破坏荷载', unit: 'kN', defaultValue: 10.5, min: 0, step: 0.1, description: '测力环读数或破坏荷载' },
      { key: 'K', label: '高度修正系数', unit: '', defaultValue: 1, min: 0.1, step: 0.01, description: '试件高度修正系数' }
    ],
    outputs: [
      { key: 'MS', label: '马歇尔稳定度', unit: 'kN', precision: 2 }
    ],
    exampleSummary: '高度63.5mm(K=1.00)，破坏荷载10.5kN，稳定度10.5kN。',
    riskNotice: '试验温度需严格控制在60±1℃，保温时间30-40min。',
    requiresProfessionalReview: true,
    calculate: (v) => ({ MS: v.P * v.K })
  },
  {
    id: 'M-032',
    title: '防水卷材拉伸强度计算',
    formula: 'T = F / (b × d)',
    inputs: [
      { key: 'F', label: '最大拉力', unit: 'N', defaultValue: 1050, min: 0, step: 10, description: '试验测得的最大拉力' },
      { key: 'b', label: '试件宽度', unit: 'mm', defaultValue: 50, min: 1, step: 1, description: '试件宽度' },
      { key: 'd', label: '试件厚度', unit: 'mm', defaultValue: 1.5, min: 0.1, step: 0.1, description: '试件厚度' }
    ],
    outputs: [
      { key: 'T', label: '拉伸强度', unit: 'MPa', precision: 1 }
    ],
    exampleSummary: '宽50mm，厚1.5mm，最大拉力1050N，强度14.0MPa。',
    riskNotice: '夹具间距和拉伸速度需按具体材质的标准设定。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ T: (v.b * v.d) > 0 ? v.F / (v.b * v.d) : 0 })
  },
  {
    id: 'M-033',
    title: '保温材料导热系数测定',
    formula: 'λ = (Φ × d) / (A × ΔT)',
    inputs: [
      { key: 'phi', label: '热流量', unit: 'W', defaultValue: 10, min: 0, step: 0.1, description: '稳态下的热流量' },
      { key: 'd', label: '试件厚度', unit: 'm', defaultValue: 0.05, min: 0.001, step: 0.001, description: '试件厚度' },
      { key: 'A', label: '传热面积', unit: 'm²', defaultValue: 0.6, min: 0.01, step: 0.01, description: '试件的传热面积' },
      { key: 'deltaT', label: '冷热板温差', unit: 'K', defaultValue: 20, min: 0.1, step: 0.1, description: '冷热板之间的温差' }
    ],
    outputs: [
      { key: 'lambda', label: '导热系数', unit: 'W/(m·K)', precision: 4 }
    ],
    exampleSummary: '热流量10W，厚度0.05m，面积0.6m²，温差20K，导热系数0.0417 W/(m·K)。',
    riskNotice: '试件需干燥，水分会大幅增加导热系数。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ lambda: (v.A * v.deltaT) > 0 ? (v.phi * v.d) / (v.A * v.deltaT) : 0 })
  },
  {
    id: 'M-038',
    title: '混凝土抗渗性能试验',
    formula: 'P = 10H - 1',
    inputs: [
      { key: 'H', label: '最大水压', unit: 'MPa', defaultValue: 0.8, min: 0, step: 0.1, description: '6个试件中3个未出现渗水时的最大水压' }
    ],
    outputs: [
      { key: 'P', label: '抗渗等级', unit: '', precision: 0 }
    ],
    exampleSummary: '加压至0.9MPa时有3个渗水，此时H=0.8MPa，P=7，等级为P6。',
    riskNotice: '试件成型后需带模养护24h，表面需用钢丝刷刷毛处理。',
    requiresProfessionalReview: false,
    calculate: (v) => ({ P: Math.max(0, 10 * v.H - 1) })
  }
];
