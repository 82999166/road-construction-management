/**
 * 施工机械运输成本分卷 - 自动计算计算器规格
 * 
 * 包含 48 条可执行的 TypeScript 计算规格。
 * 审计文件：/home/ubuntu/road-construction-management/docs/proposals/自动计算审计/audit-7.md
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

export const unsupportedCalculatorIds: string[] = [];

export const categoryCalculatorSpecs: CalculatorSpec[] = [
  {
    id: "MACH-001",
    title: "挖掘机土方开挖产能",
    formula: "Q = 8 * 3600 * q * K_c * K_t / t_c",
    inputs: [
      { key: "q", label: "斗容量", unit: "m³", defaultValue: 1.2, min: 0, step: 0.1, description: "挖掘机斗容量" },
      { key: "K_c", label: "充盈系数", unit: "无量纲", defaultValue: 0.9, min: 0, step: 0.01, description: "斗容量充盈系数" },
      { key: "K_t", label: "时间利用系数", unit: "无量纲", defaultValue: 0.8, min: 0, step: 0.01, description: "工作时间利用系数" },
      { key: "t_c", label: "循环时间", unit: "s", defaultValue: 20, min: 1, step: 1, description: "完成一个工作循环的时间" }
    ],
    outputs: [
      { key: "Q", label: "台班产量", unit: "m³/台班", precision: 2 }
    ],
    exampleSummary: "当斗容量为1.2m³，充盈系数0.9，时间利用系数0.8，循环时间20s时，台班产量为1244.16m³/台班。",
    riskNotice: "需根据土壤级别调整充盈系数。挖掘机作业半径内严禁站人，系统仅计算不自动判定安全距离。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Q: (8 * 3600 * v.q * v.K_c * v.K_t) / (v.t_c || 1)
    })
  },
  {
    id: "MACH-002",
    title: "推土机推土生产率",
    formula: "P = 8 * 60 * V * K_h * K_t / t_c",
    inputs: [
      { key: "V", label: "铲刀容量", unit: "m³", defaultValue: 3.0, min: 0, step: 0.1, description: "推土机铲刀容量" },
      { key: "K_h", label: "坡度系数", unit: "无量纲", defaultValue: 1.0, min: 0, step: 0.01, description: "作业坡度修正系数" },
      { key: "K_t", label: "时间利用系数", unit: "无量纲", defaultValue: 0.85, min: 0, step: 0.01, description: "工作时间利用系数" },
      { key: "t_c", label: "循环时间", unit: "min", defaultValue: 2.5, min: 0.1, step: 0.1, description: "完成一个工作循环的时间" }
    ],
    outputs: [
      { key: "P", label: "台班产量", unit: "m³/台班", precision: 2 }
    ],
    exampleSummary: "当铲刀容量3.0m³，坡度系数1.0，时间利用系数0.85，循环时间2.5min时，台班产量为489.6m³/台班。",
    riskNotice: "推土距离超过经济运距时效率骤降。严禁在大于规范限值的坡度上横向推土，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      P: (8 * 60 * v.V * v.K_h * v.K_t) / (v.t_c || 0.1)
    })
  },
  {
    id: "MACH-003",
    title: "装载机装载产能",
    formula: "Q = 8 * 3600 * q * K_c * K_t / t_c",
    inputs: [
      { key: "q", label: "斗容量", unit: "m³", defaultValue: 3.0, min: 0, step: 0.1, description: "装载机斗容量" },
      { key: "K_c", label: "充盈系数", unit: "无量纲", defaultValue: 0.9, min: 0, step: 0.01, description: "斗容量充盈系数" },
      { key: "K_t", label: "时间利用系数", unit: "无量纲", defaultValue: 0.8, min: 0, step: 0.01, description: "工作时间利用系数" },
      { key: "t_c", label: "循环时间", unit: "s", defaultValue: 35, min: 1, step: 1, description: "完成一个工作循环的时间" }
    ],
    outputs: [
      { key: "Q", label: "台班产量", unit: "m³/台班", precision: 2 }
    ],
    exampleSummary: "当斗容量3.0m³，充盈系数0.9，时间利用系数0.8，循环时间35s时，台班产量为1777.37m³/台班。",
    riskNotice: "充盈系数受物料松散度影响。严禁超载和偏载，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Q: (8 * 3600 * v.q * v.K_c * v.K_t) / (v.t_c || 1)
    })
  },
  {
    id: "MACH-004",
    title: "塔式起重机吊装能力",
    formula: "W = M / R",
    inputs: [
      { key: "M", label: "起重力矩", unit: "t·m", defaultValue: 600, min: 0, step: 10, description: "塔吊额定起重力矩" },
      { key: "R", label: "工作幅度", unit: "m", defaultValue: 30, min: 1, step: 1, description: "吊钩至回转中心水平距离" }
    ],
    outputs: [
      { key: "W", label: "允许起重量", unit: "t", precision: 2 }
    ],
    exampleSummary: "当起重力矩600t·m，工作幅度30m时，允许起重量为20.0t。",
    riskNotice: "起重力矩为固定参数，严禁超载吊装。风速超过规范限值时严禁作业，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      W: v.M / (v.R || 1)
    })
  },
  {
    id: "MACH-005",
    title: "汽车起重机支腿受力",
    formula: "F_max = (G + Q) / 2 + (M_o / L)",
    inputs: [
      { key: "G", label: "起重机自重", unit: "kN", defaultValue: 300, min: 0, step: 10, description: "起重机整机重量" },
      { key: "Q", label: "起重量", unit: "kN", defaultValue: 50, min: 0, step: 5, description: "吊物重量" },
      { key: "M_o", label: "倾覆力矩", unit: "kN·m", defaultValue: 200, min: 0, step: 10, description: "吊装作业产生的倾覆力矩" },
      { key: "L", label: "支腿跨距", unit: "m", defaultValue: 5, min: 0.1, step: 0.1, description: "支腿间的水平距离" }
    ],
    outputs: [
      { key: "F_max", label: "最大支腿反力", unit: "kN", precision: 2 }
    ],
    exampleSummary: "当自重300kN，起重量50kN，倾覆力矩200kN·m，支腿跨距5m时，最大支腿反力为215kN。",
    riskNotice: "地基承载力必须大于最大支腿反力。严禁在松软地面无垫板作业，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      F_max: (v.G + v.Q) / 2 + (v.M_o / (v.L || 1))
    })
  },
  {
    id: "MACH-006",
    title: "混凝土泵车输送量",
    formula: "V_p = 8 * Q_max * K_v * K_t",
    inputs: [
      { key: "Q_max", label: "最大理论输送量", unit: "m³/h", defaultValue: 120, min: 0, step: 10, description: "泵车额定最大输送能力" },
      { key: "K_v", label: "容积效率", unit: "无量纲", defaultValue: 0.85, min: 0, step: 0.01, description: "泵送容积效率系数" },
      { key: "K_t", label: "时间利用系数", unit: "无量纲", defaultValue: 0.75, min: 0, step: 0.01, description: "工作时间利用系数" }
    ],
    outputs: [
      { key: "V_p", label: "台班泵送量", unit: "m³/台班", precision: 2 }
    ],
    exampleSummary: "当最大理论输送量120m³/h，容积效率0.85，时间利用系数0.75时，台班泵送量为612m³/台班。",
    riskNotice: "容积效率受混凝土坍落度影响。严禁泵送不符合要求的混凝土，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      V_p: 8 * v.Q_max * v.K_v * v.K_t
    })
  },
  {
    id: "MACH-007",
    title: "压路机压实生产率",
    formula: "A = 8 * 1000 * V * (B - b) * K_t / n",
    inputs: [
      { key: "V", label: "碾压速度", unit: "km/h", defaultValue: 3, min: 0, step: 0.5, description: "压路机行驶速度" },
      { key: "B", label: "碾轮宽度", unit: "m", defaultValue: 2.1, min: 0, step: 0.1, description: "压路机碾轮宽度" },
      { key: "b", label: "重叠宽度", unit: "m", defaultValue: 0.3, min: 0, step: 0.05, description: "相邻行程的重叠宽度" },
      { key: "K_t", label: "时间利用系数", unit: "无量纲", defaultValue: 0.8, min: 0, step: 0.01, description: "工作时间利用系数" },
      { key: "n", label: "碾压遍数", unit: "遍", defaultValue: 6, min: 1, step: 1, description: "达到规定压实度所需的遍数" }
    ],
    outputs: [
      { key: "A", label: "台班压实面积", unit: "m²/台班", precision: 2 }
    ],
    exampleSummary: "当碾压速度3km/h，碾轮宽度2.1m，重叠宽度0.3m，时间利用系数0.8，碾压遍数6遍时，台班压实面积为5760m²/台班。",
    riskNotice: "碾压速度和遍数必须符合试验段总结要求。严禁超速碾压，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      A: (8 * 1000 * v.V * (v.B - v.b) * v.K_t) / (v.n || 1)
    })
  },
  {
    id: "MACH-008",
    title: "平地机平整面积",
    formula: "S = 8 * 1000 * V * L_e * K_t / n",
    inputs: [
      { key: "V", label: "工作速度", unit: "km/h", defaultValue: 5, min: 0, step: 0.5, description: "平地机工作速度" },
      { key: "L_e", label: "有效工作宽度", unit: "m", defaultValue: 2.5, min: 0, step: 0.1, description: "铲刀有效工作宽度" },
      { key: "K_t", label: "时间系数", unit: "无量纲", defaultValue: 0.75, min: 0, step: 0.01, description: "工作时间利用系数" },
      { key: "n", label: "刮平遍数", unit: "遍", defaultValue: 3, min: 1, step: 1, description: "达到平整度要求的遍数" }
    ],
    outputs: [
      { key: "S", label: "台班平整面积", unit: "m²/台班", precision: 2 }
    ],
    exampleSummary: "当工作速度5km/h，有效工作宽度2.5m，时间系数0.75，刮平遍数3遍时，台班平整面积为25000m²/台班。",
    riskNotice: "有效宽度受铲刀倾角影响。严禁在过大坡度上作业，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      S: (8 * 1000 * v.V * v.L_e * v.K_t) / (v.n || 1)
    })
  },
  {
    id: "MACH-009",
    title: "摊铺机摊铺速度匹配",
    formula: "V_p = Q_m / (60 * B * h * rho)",
    inputs: [
      { key: "Q_m", label: "拌合站实际产量", unit: "t/h", defaultValue: 300, min: 0, step: 10, description: "沥青/水稳拌合站每小时产量" },
      { key: "B", label: "摊铺宽度", unit: "m", defaultValue: 8, min: 0.1, step: 0.1, description: "摊铺机作业宽度" },
      { key: "h", label: "压实厚度", unit: "m", defaultValue: 0.05, min: 0.01, step: 0.01, description: "铺筑层的压实厚度" },
      { key: "rho", label: "压实密度", unit: "t/m³", defaultValue: 2.4, min: 0, step: 0.1, description: "混合料压实后的密度" }
    ],
    outputs: [
      { key: "V_p", label: "摊铺速度", unit: "m/min", precision: 2 }
    ],
    exampleSummary: "当拌合站产量300t/h，摊铺宽度8m，压实厚度0.05m，压实密度2.4t/m³时，摊铺速度为5.21m/min。",
    riskNotice: "摊铺速度应保持恒定。严禁时快时慢导致平整度下降，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      V_p: v.Q_m / (60 * v.B * v.h * v.rho || 1)
    })
  },
  {
    id: "MACH-010",
    title: "旋挖钻机成孔时间",
    formula: "T = H / V_d + t_a",
    inputs: [
      { key: "H", label: "孔深", unit: "m", defaultValue: 30, min: 0, step: 1, description: "设计钻孔深度" },
      { key: "V_d", label: "综合钻进速度", unit: "m/h", defaultValue: 5, min: 0.1, step: 0.1, description: "包含钻进和提升的平均速度" },
      { key: "t_a", label: "辅助时间", unit: "h", defaultValue: 1.5, min: 0, step: 0.1, description: "包括移位、清孔等辅助时间" }
    ],
    outputs: [
      { key: "T", label: "成孔时间", unit: "h", precision: 2 }
    ],
    exampleSummary: "当孔深30m，综合钻进速度5m/h，辅助时间1.5h时，成孔时间为7.5h。",
    riskNotice: "综合钻进速度受地层影响极大。遇溶洞等复杂地质时需调整参数，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      T: v.H / (v.V_d || 1) + v.t_a
    })
  },
  {
    id: "MACH-011",
    title: "挖掘机台班耗油量",
    formula: "F_d = P_e * g_e * K_l * 8 / rho_d",
    inputs: [
      { key: "P_e", label: "发动机额定功率", unit: "kW", defaultValue: 150, min: 0, step: 10, description: "挖掘机额定输出功率" },
      { key: "g_e", label: "比油耗", unit: "kg/(kW·h)", defaultValue: 0.22, min: 0, step: 0.01, description: "发动机燃油消耗率" },
      { key: "K_l", label: "负荷率", unit: "无量纲", defaultValue: 0.65, min: 0, step: 0.01, description: "作业期间平均负荷率" },
      { key: "rho_d", label: "柴油密度", unit: "kg/L", defaultValue: 0.84, min: 0.1, step: 0.01, description: "柴油的密度" }
    ],
    outputs: [
      { key: "F_d", label: "台班耗油量", unit: "L/台班", precision: 2 }
    ],
    exampleSummary: "当功率150kW，比油耗0.22kg/(kW·h)，负荷率0.65，柴油密度0.84kg/L时，台班耗油量为204.29L/台班。",
    riskNotice: "负荷率根据作业强度取值。严禁使用不合格燃油，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      F_d: (v.P_e * v.g_e * v.K_l * 8) / (v.rho_d || 0.84)
    })
  },
  {
    id: "MACH-012",
    title: "发电机组燃油消耗",
    formula: "F_g = P_out * g_e / rho_d",
    inputs: [
      { key: "P_out", label: "实际输出功率", unit: "kW", defaultValue: 200, min: 0, step: 10, description: "发电机组实际负载功率" },
      { key: "g_e", label: "发电机组比油耗", unit: "kg/(kW·h)", defaultValue: 0.25, min: 0, step: 0.01, description: "机组燃油消耗率" },
      { key: "rho_d", label: "柴油密度", unit: "kg/L", defaultValue: 0.84, min: 0.1, step: 0.01, description: "柴油的密度" }
    ],
    outputs: [
      { key: "F_g", label: "小时耗油量", unit: "L/h", precision: 2 }
    ],
    exampleSummary: "当输出功率200kW，比油耗0.25kg/(kW·h)，柴油密度0.84kg/L时，小时耗油量为59.52L/h。",
    riskNotice: "发电机不宜长时间低负载运行。严禁超负荷运行，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      F_g: (v.P_out * v.g_e) / (v.rho_d || 0.84)
    })
  },
  {
    id: "MACH-013",
    title: "施工现场总用电量",
    formula: "S = 1.05 * (K1 * sum(P1)/cos(phi) + K2 * sum(P2) + K3 * sum(P3) + K4 * sum(P4))",
    inputs: [
      { key: "sum_P1", label: "电动机总功率", unit: "kW", defaultValue: 300, min: 0, step: 10, description: "所有电动机额定功率之和" },
      { key: "sum_P2", label: "电焊机总容量", unit: "kVA", defaultValue: 150, min: 0, step: 10, description: "所有电焊机额定容量之和" },
      { key: "sum_P3", label: "室内照明总功率", unit: "kW", defaultValue: 20, min: 0, step: 1, description: "室内照明设备总功率" },
      { key: "sum_P4", label: "室外照明总功率", unit: "kW", defaultValue: 30, min: 0, step: 1, description: "室外照明设备总功率" },
      { key: "K1", label: "电动机需要系数", unit: "无量纲", defaultValue: 0.6, min: 0, step: 0.01, description: "电动机同时使用系数" },
      { key: "K2", label: "电焊机需要系数", unit: "无量纲", defaultValue: 0.6, min: 0, step: 0.01, description: "电焊机同时使用系数" },
      { key: "K3", label: "室内照明需要系数", unit: "无量纲", defaultValue: 0.8, min: 0, step: 0.01, description: "室内照明同时使用系数" },
      { key: "K4", label: "室外照明需要系数", unit: "无量纲", defaultValue: 1.0, min: 0, step: 0.01, description: "室外照明同时使用系数" },
      { key: "cos_phi", label: "功率因数", unit: "无量纲", defaultValue: 0.75, min: 0.1, step: 0.01, description: "电动机平均功率因数" }
    ],
    outputs: [
      { key: "S", label: "总视在功率", unit: "kVA", precision: 2 }
    ],
    exampleSummary: "当P1=300kW, P2=150kVA, P3=20kW, P4=30kW，系数K1=0.6, K2=0.6, K3=0.8, K4=1.0, cos(phi)=0.75时，总视在功率为394.8kVA。",
    riskNotice: "需要系数应根据设备数量和同时使用情况选取。必须按规范进行配电设计，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      S: 1.05 * (v.K1 * v.sum_P1 / (v.cos_phi || 0.75) + v.K2 * v.sum_P2 + v.K3 * v.sum_P3 + v.K4 * v.sum_P4)
    })
  },
  {
    id: "MACH-014",
    title: "电缆截面积选择(按电流)",
    formula: "I_c = (P * 1000) / (sqrt(3) * U * cos(phi))",
    inputs: [
      { key: "P", label: "有功功率", unit: "kW", defaultValue: 100, min: 0, step: 10, description: "负载的有功功率" },
      { key: "U", label: "线电压", unit: "V", defaultValue: 380, min: 1, step: 10, description: "供电系统的线电压" },
      { key: "cos_phi", label: "功率因数", unit: "无量纲", defaultValue: 0.8, min: 0.1, step: 0.01, description: "负载的功率因数" }
    ],
    outputs: [
      { key: "I_c", label: "计算电流", unit: "A", precision: 2 }
    ],
    exampleSummary: "当功率100kW，电压380V，功率因数0.8时，计算电流为189.9A。",
    riskNotice: "必须同时校验电压降和机械强度。严禁超载流量使用电缆，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      I_c: (v.P * 1000) / (Math.sqrt(3) * v.U * v.cos_phi || 1)
    })
  },
  {
    id: "MACH-015",
    title: "线路电压降核算",
    formula: "Delta_U = (P * L) / (C * S)",
    inputs: [
      { key: "P", label: "有功功率", unit: "kW", defaultValue: 80, min: 0, step: 10, description: "负载的有功功率" },
      { key: "L", label: "线路长度", unit: "m", defaultValue: 200, min: 0, step: 10, description: "电缆线路的长度" },
      { key: "C", label: "材质系数", unit: "无量纲", defaultValue: 50, min: 1, step: 1, description: "铜50，铝30" },
      { key: "S", label: "电缆截面积", unit: "mm²", defaultValue: 70, min: 1, step: 1, description: "电缆的标称截面积" }
    ],
    outputs: [
      { key: "Delta_U", label: "电压降", unit: "%", precision: 2 }
    ],
    exampleSummary: "当功率80kW，长度200m，材质系数50，截面积70mm²时，电压降为4.57%。",
    riskNotice: "如果电压降超标需增大截面积。末端电压过低易烧毁电机，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      Delta_U: (v.P * v.L) / (v.C * v.S || 1)
    })
  },
  {
    id: "MACH-016",
    title: "塔吊专用箱变容量匹配",
    formula: "S_t = P_t / (cos(phi) * K_L)",
    inputs: [
      { key: "P_t", label: "塔吊总功率", unit: "kW", defaultValue: 120, min: 0, step: 10, description: "塔吊额定功率之和" },
      { key: "cos_phi", label: "功率因数", unit: "无量纲", defaultValue: 0.7, min: 0.1, step: 0.01, description: "塔吊平均功率因数" },
      { key: "K_L", label: "变压器负载率", unit: "无量纲", defaultValue: 0.8, min: 0.1, step: 0.01, description: "变压器允许的长期负载率" }
    ],
    outputs: [
      { key: "S_t", label: "变压器容量", unit: "kVA", precision: 2 }
    ],
    exampleSummary: "当总功率120kW，功率因数0.7，负载率0.8时，变压器容量为214.28kVA。",
    riskNotice: "塔吊启动电流大，需预留足够余量。系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      S_t: v.P_t / (v.cos_phi * v.K_L || 0.5)
    })
  },
  {
    id: "MACH-017",
    title: "自卸汽车需要数量",
    formula: "N = Q_e / Q_t",
    inputs: [
      { key: "Q_e", label: "挖掘机台班产量", unit: "m³/台班", defaultValue: 1200, min: 1, step: 100, description: "配套挖掘机的日产量" },
      { key: "Q_t", label: "汽车台班产量", unit: "m³/台班", defaultValue: 100, min: 1, step: 10, description: "单台汽车的日产量" }
    ],
    outputs: [
      { key: "N", label: "汽车数量", unit: "辆", precision: 2 }
    ],
    exampleSummary: "当挖掘机产量1200m³/台班，汽车产量100m³/台班时，需要汽车12辆。",
    riskNotice: "必须根据实际产量匹配。严禁超载运输，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      N: v.Q_e / (v.Q_t || 1)
    })
  },
  {
    id: "MACH-018",
    title: "自卸汽车台班产量",
    formula: "Q_t = 8 * 60 * q_t * K_t / t_c",
    inputs: [
      { key: "q_t", label: "汽车载重折合体积", unit: "m³", defaultValue: 10, min: 0, step: 1, description: "单车平均装载量" },
      { key: "K_t", label: "时间利用系数", unit: "无量纲", defaultValue: 0.8, min: 0, step: 0.01, description: "工作时间利用系数" },
      { key: "t_c", label: "循环时间", unit: "min", defaultValue: 40, min: 1, step: 1, description: "单趟循环平均时间" }
    ],
    outputs: [
      { key: "Q_t", label: "台班产量", unit: "m³/台班", precision: 2 }
    ],
    exampleSummary: "当载重体积10m³，时间利用系数0.8，循环时间40min时，台班产量为96m³/台班。",
    riskNotice: "循环时间受运距和路况影响。严禁超载超速，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Q_t: (8 * 60 * v.q_t * v.K_t) / (v.t_c || 1)
    })
  },
  {
    id: "MACH-019",
    title: "混凝土搅拌车配置数量",
    formula: "N = (Q_c * t_c) / (60 * V_t)",
    inputs: [
      { key: "Q_c", label: "混凝土浇筑速度", unit: "m³/h", defaultValue: 60, min: 1, step: 5, description: "现场要求的连续浇筑强度" },
      { key: "t_c", label: "循环时间", unit: "min", defaultValue: 90, min: 1, step: 5, description: "搅拌车往返及装卸总时间" },
      { key: "V_t", label: "有效容积", unit: "m³", defaultValue: 8, min: 1, step: 1, description: "搅拌车实际装载容积" }
    ],
    outputs: [
      { key: "N", label: "搅拌车数量", unit: "辆", precision: 2 }
    ],
    exampleSummary: "当浇筑速度60m³/h，循环时间90min，有效容积8m³时，需要搅拌车11.25辆。",
    riskNotice: "需考虑备用车辆。严禁超时运输导致混凝土初凝，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      N: (v.Q_c * v.t_c) / (60 * v.V_t || 1)
    })
  },
  {
    id: "MACH-020",
    title: "车辆周转时间(循环时间)",
    formula: "t_c = t_l + L/V_h + t_u + L/V_e + t_w",
    inputs: [
      { key: "t_l", label: "装车时间", unit: "min", defaultValue: 5, min: 0, step: 1, description: "装载所消耗的时间" },
      { key: "L", label: "运距", unit: "km", defaultValue: 10, min: 0, step: 1, description: "单程运输距离" },
      { key: "V_h", label: "重车速度", unit: "km/h", defaultValue: 30, min: 1, step: 5, description: "重载行驶平均速度" },
      { key: "t_u", label: "卸车时间", unit: "min", defaultValue: 3, min: 0, step: 1, description: "卸载所消耗的时间" },
      { key: "V_e", label: "空车速度", unit: "km/h", defaultValue: 40, min: 1, step: 5, description: "空载返回平均速度" },
      { key: "t_w", label: "等待时间", unit: "min", defaultValue: 7, min: 0, step: 1, description: "装卸两端的平均等待时间" }
    ],
    outputs: [
      { key: "t_c", label: "循环时间", unit: "min", precision: 2 }
    ],
    exampleSummary: "当装车5min, 运距10km, 重车30km/h, 卸车3min, 空车40km/h, 等待7min时，循环时间为50min。",
    riskNotice: "速度取值需符合道路限速。严禁疲劳驾驶，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      t_c: v.t_l + (v.L * 60 / (v.V_h || 1)) + v.t_u + (v.L * 60 / (v.V_e || 1)) + v.t_w
    })
  },
  {
    id: "MACH-021",
    title: "土方外运总车次测算",
    formula: "C_total = V_earth * K_s / V_truck",
    inputs: [
      { key: "V_earth", label: "天然土方体积", unit: "m³", defaultValue: 10000, min: 0, step: 100, description: "天然密实度状态下的土方体积" },
      { key: "K_s", label: "土方松散系数", unit: "无量纲", defaultValue: 1.2, min: 1, step: 0.05, description: "土方挖开后的松散膨胀系数" },
      { key: "V_truck", label: "单车装载体积", unit: "m³/车", defaultValue: 15, min: 1, step: 1, description: "单台车实际装载的松散体积" }
    ],
    outputs: [
      { key: "C_total", label: "总车次", unit: "车", precision: 0 }
    ],
    exampleSummary: "当天然土方10000m³，松散系数1.2，单车装载15m³时，总车次为800车。",
    riskNotice: "松散系数根据土质确定。严禁超高装载导致遗撒，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_total: Math.ceil((v.V_earth * v.K_s) / (v.V_truck || 1))
    })
  },
  {
    id: "MACH-022",
    title: "机械台班折旧费",
    formula: "C_d = (V_o - V_r) / (N_y * W_y)",
    inputs: [
      { key: "V_o", label: "机械原值", unit: "元", defaultValue: 1000000, min: 0, step: 10000, description: "机械设备的初始购置价格" },
      { key: "V_r", label: "残值", unit: "元", defaultValue: 50000, min: 0, step: 1000, description: "折旧期满后的预计净残值" },
      { key: "N_y", label: "折旧年限", unit: "年", defaultValue: 10, min: 1, step: 1, description: "规定的机械折旧年限" },
      { key: "W_y", label: "年工作台班", unit: "台班/年", defaultValue: 200, min: 1, step: 10, description: "每年计划的工作台班数" }
    ],
    outputs: [
      { key: "C_d", label: "台班折旧费", unit: "元/台班", precision: 2 }
    ],
    exampleSummary: "当原值100万元，残值5万元，折旧10年，年工作200台班时，台班折旧费为475元/台班。",
    riskNotice: "残值率需根据实际情况参数化录入。财务折旧与机械定额折旧可能有差异，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_d: (v.V_o - v.V_r) / (v.N_y * v.W_y || 1)
    })
  },
  {
    id: "MACH-023",
    title: "大修理费台班分摊",
    formula: "C_r = (C_o * N_r) / (N_y * W_y)",
    inputs: [
      { key: "C_o", label: "一次大修理费", unit: "元", defaultValue: 150000, min: 0, step: 1000, description: "平均每次大修理所需的费用" },
      { key: "N_r", label: "大修次数", unit: "次", defaultValue: 3, min: 0, step: 1, description: "折旧寿命期内的大修理次数" },
      { key: "N_y", label: "折旧年限", unit: "年", defaultValue: 10, min: 1, step: 1, description: "规定的机械折旧年限" },
      { key: "W_y", label: "年工作台班", unit: "台班/年", defaultValue: 200, min: 1, step: 10, description: "每年计划的工作台班数" }
    ],
    outputs: [
      { key: "C_r", label: "台班大修费", unit: "元/台班", precision: 2 }
    ],
    exampleSummary: "当一次大修费15万元，大修3次，折旧10年，年工作200台班时，台班大修费为225元/台班。",
    riskNotice: "大修费受设备状况影响。系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_r: (v.C_o * v.N_r) / (v.N_y * v.W_y || 1)
    })
  },
  {
    id: "MACH-024",
    title: "经常修理费",
    formula: "C_m = C_r * K_m",
    inputs: [
      { key: "C_r", label: "台班大修理费", unit: "元/台班", defaultValue: 225, min: 0, step: 10, description: "摊销后的台班大修理费用" },
      { key: "K_m", label: "经常修理费系数", unit: "无量纲", defaultValue: 0.65, min: 0, step: 0.01, description: "经常修理费与大修费的比例系数" }
    ],
    outputs: [
      { key: "C_m", label: "台班经常修理费", unit: "元/台班", precision: 2 }
    ],
    exampleSummary: "当台班大修费225元，系数0.65时，台班经常修理费为146.25元/台班。",
    riskNotice: "不同机械系数不同。严禁设备带病作业，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_m: v.C_r * v.K_m
    })
  },
  {
    id: "MACH-025",
    title: "台班人工费",
    formula: "C_p = N_p * W_d",
    inputs: [
      { key: "N_p", label: "规定定员", unit: "人", defaultValue: 2, min: 1, step: 1, description: "每台机械配备的操作人员数" },
      { key: "W_d", label: "人工工日单价", unit: "元/工日", defaultValue: 150, min: 0, step: 10, description: "机械工人的日工资单价" }
    ],
    outputs: [
      { key: "C_p", label: "台班人工费", unit: "元/台班", precision: 2 }
    ],
    exampleSummary: "当定员2人，单价150元/工日时，台班人工费为300元/台班。",
    riskNotice: "定员按定额规定执行。特种设备必须持证上岗，系统仅计算不自动判定资格。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_p: v.N_p * v.W_d
    })
  },
  {
    id: "MACH-026",
    title: "台班动力燃料费",
    formula: "C_e = Q_e * P_e + Q_f * P_f + Q_w * P_w",
    inputs: [
      { key: "Q_e", label: "台班耗电量", unit: "kWh", defaultValue: 0, min: 0, step: 10, description: "单台班消耗的电能" },
      { key: "P_e", label: "电单价", unit: "元/kWh", defaultValue: 1.0, min: 0, step: 0.1, description: "施工用电单价" },
      { key: "Q_f", label: "台班耗油量", unit: "kg", defaultValue: 100, min: 0, step: 10, description: "单台班消耗的燃料油量" },
      { key: "P_f", label: "油单价", unit: "元/kg", defaultValue: 7.5, min: 0, step: 0.1, description: "柴油/汽油单价" },
      { key: "Q_w", label: "台班耗水量", unit: "t", defaultValue: 0, min: 0, step: 1, description: "单台班消耗的水量" },
      { key: "P_w", label: "水单价", unit: "元/t", defaultValue: 5.0, min: 0, step: 0.1, description: "施工用水单价" }
    ],
    outputs: [
      { key: "C_e", label: "动力燃料费", unit: "元/台班", precision: 2 }
    ],
    exampleSummary: "当耗油100kg，油价7.5元/kg时，台班动力燃料费为750元/台班。",
    riskNotice: "消耗量按定额或实测取值。能源单价随市场波动，系统仅计算不自动判定合理性。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_e: (v.Q_e * v.P_e) + (v.Q_f * v.P_f) + (v.Q_w * v.P_w)
    })
  },
  {
    id: "MACH-027",
    title: "钢管脚手架用量估算",
    formula: "W_s = A_w * q_s",
    inputs: [
      { key: "A_w", label: "搭设面积", unit: "m²", defaultValue: 5000, min: 0, step: 100, description: "脚手架覆盖的立面或水平面积" },
      { key: "q_s", label: "单位面积用量", unit: "t/m²", defaultValue: 0.015, min: 0, step: 0.001, description: "单位面积钢管用量经验指标" }
    ],
    outputs: [
      { key: "W_s", label: "钢管总用量", unit: "t", precision: 2 }
    ],
    exampleSummary: "当搭设面积5000m²，指标0.015t/m²时，钢管总用量为75t。",
    riskNotice: "单位用量受步距、立杆间距影响。超过一定高度必须经过专项论证，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      W_s: v.A_w * v.q_s
    })
  },
  {
    id: "MACH-028",
    title: "扣件数量估算",
    formula: "N_k = W_s * n_k",
    inputs: [
      { key: "W_s", label: "钢管总用量", unit: "t", defaultValue: 75, min: 0, step: 1, description: "脚手架工程所需的钢管总量" },
      { key: "n_k", label: "配套扣件数", unit: "个/t", defaultValue: 220, min: 0, step: 10, description: "每吨钢管平均配套的扣件个数" }
    ],
    outputs: [
      { key: "N_k", label: "扣件总数", unit: "个", precision: 0 }
    ],
    exampleSummary: "当钢管用量75t，配套系数220个/t时，扣件总数为16500个。",
    riskNotice: "直角、旋转、对接扣件比例需按方案细化。严禁使用不合格扣件，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      N_k: Math.round(v.W_s * v.n_k)
    })
  },
  {
    id: "MACH-029",
    title: "模板周转使用费",
    formula: "C_t = (C_p - C_s) / N_t + C_m",
    inputs: [
      { key: "C_p", label: "模板初始单价", unit: "元/m²", defaultValue: 60, min: 0, step: 1, description: "模板的初始购置单价" },
      { key: "C_s", label: "残值", unit: "元/m²", defaultValue: 5, min: 0, step: 1, description: "周转结束后的残余价值单价" },
      { key: "N_t", label: "预计周转次数", unit: "次", defaultValue: 5, min: 1, step: 1, description: "模板预计可循环使用的次数" },
      { key: "C_m", label: "每次维修费", unit: "元/m²", defaultValue: 2, min: 0, step: 0.5, description: "每次周转所需的维修保养费用" }
    ],
    outputs: [
      { key: "C_t", label: "每次周转摊销费", unit: "元/m²", precision: 2 }
    ],
    exampleSummary: "当初始价60元，残值5元，周转5次，维修费2元时，摊销费为13元/m²。",
    riskNotice: "周转次数受模板材质和施工保护影响。废旧模板严禁用于受力承重部位，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      C_t: (v.C_p - v.C_s) / (v.N_t || 1) + v.C_m
    })
  },
  {
    id: "MACH-030",
    title: "临时板房面积计算",
    formula: "A_d = N_w * a_w",
    inputs: [
      { key: "N_w", label: "高峰期人数", unit: "人", defaultValue: 300, min: 1, step: 10, description: "施工现场住宿人数峰值" },
      { key: "a_w", label: "人均面积指标", unit: "m²/人", defaultValue: 2.5, min: 1, step: 0.1, description: "规范要求的最低人均宿舍面积" }
    ],
    outputs: [
      { key: "A_d", label: "宿舍总面积", unit: "m²", precision: 2 }
    ],
    exampleSummary: "当人数300人，人均指标2.5m²/人时，宿舍总面积为750m²。",
    riskNotice: "人均面积要求需根据现行规范参数化录入。板房层数和防火间距必须满足消防要求，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      A_d: v.N_w * v.a_w
    })
  },
  {
    id: "MACH-031",
    title: "施工便道硬化方量",
    formula: "V_r = L_r * W_r * h_r",
    inputs: [
      { key: "L_r", label: "便道长度", unit: "m", defaultValue: 500, min: 0, step: 10, description: "施工便道硬化段长度" },
      { key: "W_r", label: "便道宽度", unit: "m", defaultValue: 6, min: 0, step: 1, description: "施工便道硬化段宽度" },
      { key: "h_r", label: "硬化厚度", unit: "m", defaultValue: 0.2, min: 0, step: 0.05, description: "硬化层的设计厚度" }
    ],
    outputs: [
      { key: "V_r", label: "混凝土用量", unit: "m³", precision: 2 }
    ],
    exampleSummary: "当长度500m，宽度6m，厚度0.2m时，混凝土用量为600m³。",
    riskNotice: "厚度需根据重载车辆重量设计。严禁在软弱下卧层上直接硬化，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      V_r: v.L_r * v.W_r * v.h_r
    })
  },
  {
    id: "MACH-032",
    title: "材料施工损耗率",
    formula: "R_l = (Q_a - Q_n) / Q_n * 100%",
    inputs: [
      { key: "Q_a", label: "实际消耗量", unit: "单位", defaultValue: 105, min: 0, step: 1, description: "工程实际投入的材料总量" },
      { key: "Q_n", label: "图纸净用量", unit: "单位", defaultValue: 100, min: 1, step: 1, description: "设计图纸计算出的净用量" }
    ],
    outputs: [
      { key: "R_l", label: "损耗率", unit: "%", precision: 2 }
    ],
    exampleSummary: "当实际消耗105，净用量100时，损耗率为5%。",
    riskNotice: "损耗率应控制在定额允许范围内。严禁弄虚作假掩盖材料浪费，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      R_l: ((v.Q_a - v.Q_n) / (v.Q_n || 1)) * 100
    })
  },
  {
    id: "MACH-033",
    title: "设备时间利用率",
    formula: "U_t = T_w / T_p * 100%",
    inputs: [
      { key: "T_w", label: "实际工作时间", unit: "h", defaultValue: 200, min: 0, step: 1, description: "设备实际作业的小时数" },
      { key: "T_p", label: "计划工作时间", unit: "h", defaultValue: 240, min: 1, step: 1, description: "设备计划安排的作业小时数" }
    ],
    outputs: [
      { key: "U_t", label: "时间利用率", unit: "%", precision: 2 }
    ],
    exampleSummary: "当实际工作200h，计划240h时，时间利用率为83.33%。",
    riskNotice: "利用率过低说明设备闲置或故障多。系统仅计算不自动判定管理水平。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      U_t: (v.T_w / (v.T_p || 1)) * 100
    })
  },
  {
    id: "MACH-034",
    title: "设备完好率",
    formula: "R_g = N_g / N_t * 100%",
    inputs: [
      { key: "N_g", label: "完好机械台数", unit: "台", defaultValue: 45, min: 0, step: 1, description: "处于完好状态可随时使用的设备数" },
      { key: "N_t", label: "机械总台数", unit: "台", defaultValue: 50, min: 1, step: 1, description: "项目部管理的所有同类机械总数" }
    ],
    outputs: [
      { key: "R_g", label: "设备完好率", unit: "%", precision: 2 }
    ],
    exampleSummary: "当完好台数45台，总台数50台时，设备完好率为90%。",
    riskNotice: "完好率是衡量维保质量的关键指标。带病运行设备严禁计入完好台数，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      R_g: (v.N_g / (v.N_t || 1)) * 100
    })
  },
  {
    id: "MACH-035",
    title: "设备产能利用率",
    formula: "U_c = Q_a / Q_t * 100%",
    inputs: [
      { key: "Q_a", label: "实际产量", unit: "单位", defaultValue: 800, min: 0, step: 10, description: "设备在考核期内的实际产出" },
      { key: "Q_t", label: "理论产量", unit: "单位", defaultValue: 1000, min: 1, step: 10, description: "设备在理想条件下的最大可能产出" }
    ],
    outputs: [
      { key: "U_c", label: "产能利用率", unit: "%", precision: 2 }
    ],
    exampleSummary: "当实际产量800，理论产量1000时，产能利用率为80%。",
    riskNotice: "产能利用率受作业条件和操作手技能影响。系统仅计算不自动判定瓶颈原因。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      U_c: (v.Q_a / (v.Q_t || 1)) * 100
    })
  },
  {
    id: "MACH-036",
    title: "土方单价综合测算",
    formula: "C_u = (C_e + C_t) / V_total",
    inputs: [
      { key: "C_e", label: "挖掘机总费用", unit: "元", defaultValue: 50000, min: 0, step: 1000, description: "包含折旧、人工、油耗等挖掘机费用" },
      { key: "C_t", label: "运输车队总费用", unit: "元", defaultValue: 150000, min: 0, step: 1000, description: "包含折旧、人工、油耗等运输费用" },
      { key: "V_total", label: "总土方量", unit: "m³", defaultValue: 10000, min: 1, step: 100, description: "测算周期内的总作业方量" }
    ],
    outputs: [
      { key: "C_u", label: "综合单价", unit: "元/m³", precision: 2 }
    ],
    exampleSummary: "当挖掘机费5万元，运输费15万元，总方量10000m³时，综合单价为20元/m³。",
    riskNotice: "未包含管理费、利润和税金。实际单价受运距和弃土费影响极大，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_u: (v.C_e + v.C_t) / (v.V_total || 1)
    })
  },
  {
    id: "MACH-037",
    title: "机械租赁费结算",
    formula: "F_r = N_d * P_d + F_in_out",
    inputs: [
      { key: "N_d", label: "租赁天数/台班", unit: "天/台班", defaultValue: 30, min: 0, step: 1, description: "实际计费的时间或台班数" },
      { key: "P_d", label: "租赁单价", unit: "元", defaultValue: 800, min: 0, step: 10, description: "合同约定的单位租赁价格" },
      { key: "F_in_out", label: "进出场费", unit: "元", defaultValue: 2000, min: 0, step: 100, description: "机械调迁及进出场费用" }
    ],
    outputs: [
      { key: "F_r", label: "结算费用", unit: "元", precision: 2 }
    ],
    exampleSummary: "当租赁30天，单价800元，进出场费2000元时，结算费用为26000元。",
    riskNotice: "进出场费通常在首月结算或分摊。停工期间租金按合同约定执行，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      F_r: v.N_d * v.P_d + v.F_in_out
    })
  },
  {
    id: "MACH-038",
    title: "周转材料租赁费结算",
    formula: "F_m = sum(Q_i * T_i * P_i)",
    inputs: [
      { key: "Q_1", label: "材料数量", unit: "单位", defaultValue: 100, min: 0, step: 1, description: "某批次租赁材料的数量" },
      { key: "T_1", label: "使用天数", unit: "天", defaultValue: 30, min: 0, step: 1, description: "该批次材料的实际使用时长" },
      { key: "P_1", label: "日租金单价", unit: "元", defaultValue: 0.015, min: 0, step: 0.001, description: "合同约定的日租赁单价" }
    ],
    outputs: [
      { key: "F_m", label: "租赁费", unit: "元", precision: 2 }
    ],
    exampleSummary: "当数量100，天数30，单价0.015元时，租赁费为45元。",
    riskNotice: "需考虑丢失赔偿和维修费用。结算天数以实际进退场单据为准，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      F_m: v.Q_1 * v.T_1 * v.P_1
    })
  },
  {
    id: "MACH-039",
    title: "临时设施费摊销",
    formula: "C_a = C_total / M_p",
    inputs: [
      { key: "C_total", label: "临建总造价", unit: "元", defaultValue: 300000, min: 0, step: 10000, description: "项目临时设施的总投资额" },
      { key: "M_p", label: "项目总工期", unit: "月", defaultValue: 15, min: 1, step: 1, description: "合同或计划的总工期月份" }
    ],
    outputs: [
      { key: "C_a", label: "月摊销额", unit: "元/月", precision: 2 }
    ],
    exampleSummary: "当总造价30万元，工期15个月时，月摊销额为20000元/月。",
    riskNotice: "提前竣工或延期需调整摊销额。系统仅计算不自动判定财务合规性。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_a: v.C_total / (v.M_p || 1)
    })
  },
  {
    id: "MACH-040",
    title: "打桩机锤击能量",
    formula: "E = W_h * H_d",
    inputs: [
      { key: "W_h", label: "锤体重量", unit: "kN", defaultValue: 40, min: 0, step: 1, description: "打桩锤运动部分的重量" },
      { key: "H_d", label: "落距", unit: "m", defaultValue: 2.5, min: 0, step: 0.1, description: "锤体落下的高度" }
    ],
    outputs: [
      { key: "E", label: "锤击能量", unit: "kJ", precision: 2 }
    ],
    exampleSummary: "当锤重40kN，落距2.5m时，锤击能量为100kJ。",
    riskNotice: "实际能量受系统效率影响。严禁超高落距打桩以免损坏桩头，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      E: v.W_h * v.H_d
    })
  },
  {
    id: "MACH-041",
    title: "混凝土搅拌机生产率",
    formula: "P_m = 8 * 3600 * V_c * K_u / t_c",
    inputs: [
      { key: "V_c", label: "出料容量", unit: "m³", defaultValue: 1.5, min: 0, step: 0.1, description: "搅拌机每盘出料的混凝土体积" },
      { key: "K_u", label: "时间利用系数", unit: "无量纲", defaultValue: 0.8, min: 0, step: 0.01, description: "工作时间利用系数" },
      { key: "t_c", label: "循环时间", unit: "s", defaultValue: 90, min: 1, step: 5, description: "每盘搅拌所需的总时间" }
    ],
    outputs: [
      { key: "P_m", label: "台班生产率", unit: "m³/台班", precision: 2 }
    ],
    exampleSummary: "当出料容量1.5m³，系数0.8，循环时间90s时，台班生产率为384m³/台班。",
    riskNotice: "循环时间包括进料、搅拌、出料时间。严禁随意缩短搅拌时间，系统仅计算不自动判定质量。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      P_m: (8 * 3600 * v.V_c * v.K_u) / (v.t_c || 1)
    })
  },
  {
    id: "MACH-042",
    title: "沥青混合料保温运输温降",
    formula: "Delta_T = k * (T_m - T_a) * t_tr",
    inputs: [
      { key: "k", label: "保温系数", unit: "1/h", defaultValue: 0.05, min: 0, step: 0.01, description: "运输车辆的散热修正系数" },
      { key: "T_m", label: "出料温度", unit: "℃", defaultValue: 160, min: 0, step: 5, description: "拌合站出料时的混合料温度" },
      { key: "T_a", label: "环境温度", unit: "℃", defaultValue: 10, min: -20, step: 1, description: "施工现场的空气温度" },
      { key: "t_tr", label: "运输时间", unit: "h", defaultValue: 2, min: 0, step: 0.5, description: "从拌合站到摊铺现场的时长" }
    ],
    outputs: [
      { key: "Delta_T", label: "温降", unit: "℃", precision: 2 }
    ],
    exampleSummary: "当系数0.05，出料160℃，环境10℃，运输2h时，温降为15℃。",
    riskNotice: "到达现场温度必须满足摊铺要求。严禁摊铺低于规范限值的混合料，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Delta_T: v.k * (v.T_m - v.T_a) * v.t_tr
    })
  },
  {
    id: "MACH-043",
    title: "电焊机暂载率换算",
    formula: "P_e = P_n * sqrt(JC_n / JC_s)",
    inputs: [
      { key: "P_n", label: "铭牌额定功率", unit: "kW", defaultValue: 25, min: 0, step: 1, description: "电焊机铭牌标注的额定功率" },
      { key: "JC_n", label: "铭牌暂载率", unit: "%", defaultValue: 60, min: 1, step: 5, description: "铭牌标注的持续工作时间比例" },
      { key: "JC_s", label: "标准暂载率", unit: "%", defaultValue: 100, min: 1, step: 5, description: "通常取100%进行负荷计算" }
    ],
    outputs: [
      { key: "P_e", label: "换算后功率", unit: "kW", precision: 2 }
    ],
    exampleSummary: "当额定功率25kW，铭牌暂载率60%，标准暂载率100%时，换算功率为19.36kW。",
    riskNotice: "多台焊机同时使用需乘以同时系数。系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      P_e: v.P_n * Math.sqrt(v.JC_n / (v.JC_s || 100))
    })
  },
  {
    id: "MACH-044",
    title: "机械大修基金提取",
    formula: "F_r = V_o * R_r / 12",
    inputs: [
      { key: "V_o", label: "机械原值", unit: "元", defaultValue: 800000, min: 0, step: 10000, description: "机械设备的初始购置价格" },
      { key: "R_r", label: "年提取率", unit: "%", defaultValue: 4, min: 0, step: 0.1, description: "年度大修基金提取比例" }
    ],
    outputs: [
      { key: "F_r", label: "月度提取额", unit: "元", precision: 2 }
    ],
    exampleSummary: "当原值80万元，年提取率4%时，月度提取额为2666.67元。",
    riskNotice: "提取率根据设备类型确定。大修基金必须专款专用，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      F_r: (v.V_o * (v.R_r / 100)) / 12
    })
  },
  {
    id: "MACH-045",
    title: "轮胎消耗定额",
    formula: "C_t = N_t * P_t / L_t",
    inputs: [
      { key: "N_t", label: "轮胎数量", unit: "条", defaultValue: 6, min: 1, step: 1, description: "单台机械的轮胎配置总数" },
      { key: "P_t", label: "单条轮胎价格", unit: "元", defaultValue: 2000, min: 0, step: 100, description: "单条轮胎的平均购置价格" },
      { key: "L_t", label: "使用寿命", unit: "台班", defaultValue: 800, min: 1, step: 10, description: "轮胎预计的使用寿命台班数" }
    ],
    outputs: [
      { key: "C_t", label: "台班轮胎费", unit: "元/台班", precision: 2 }
    ],
    exampleSummary: "当轮胎6条，单价2000元，寿命800台班时，台班轮胎费为15元/台班。",
    riskNotice: "恶劣路况下轮胎寿命大幅缩短。严禁使用磨损超限的轮胎，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      C_t: (v.N_t * v.P_t) / (v.L_t || 1)
    })
  },
  {
    id: "MACH-046",
    title: "临时用水管径选择",
    formula: "d = sqrt((4 * Q) / (pi * v * 1000))",
    inputs: [
      { key: "Q", label: "耗水量", unit: "L/s", defaultValue: 15, min: 0.1, step: 0.5, description: "施工现场计算的总耗水量" },
      { key: "v", label: "水流速度", unit: "m/s", defaultValue: 1.5, min: 0.1, step: 0.1, description: "管网内允许的经济流速" }
    ],
    outputs: [
      { key: "d", label: "管径", unit: "m", precision: 3 }
    ],
    exampleSummary: "当耗水量15L/s，流速1.5m/s时，计算管径为0.113m。",
    riskNotice: "消防用水流速可取大值。严禁管径小于消防规范最低要求，系统仅计算不自动判定。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      d: Math.sqrt((4 * v.Q) / (Math.PI * v.v * 1000))
    })
  },
  {
    id: "MACH-047",
    title: "履带起重机接地比压",
    formula: "P = (G + Q) / (2 * L * B)",
    inputs: [
      { key: "G", label: "起重机自重", unit: "kN", defaultValue: 500, min: 0, step: 10, description: "履带起重机整机自重" },
      { key: "Q", label: "起重量", unit: "kN", defaultValue: 100, min: 0, step: 10, description: "当前吊装作业的载荷" },
      { key: "L", label: "履带接地长度", unit: "m", defaultValue: 4, min: 0.1, step: 0.1, description: "单侧履带与地面的接触长度" },
      { key: "B", label: "履带宽度", unit: "m", defaultValue: 0.8, min: 0.1, step: 0.1, description: "单侧履带的宽度" }
    ],
    outputs: [
      { key: "P", label: "接地比压", unit: "kPa", precision: 2 }
    ],
    exampleSummary: "当自重500kN，起重量100kN，长度4m，宽度0.8m时，接地比压为93.75kPa。",
    riskNotice: "地基承载力必须大于接地比压。严禁在松软地面无垫板作业，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      P: (v.G + v.Q) / (2 * v.L * v.B || 1)
    })
  },
  {
    id: "MACH-048",
    title: "泥浆外运车次测算",
    formula: "N_m = V_pile * K_e / V_tank",
    inputs: [
      { key: "V_pile", label: "桩体积", unit: "m³", defaultValue: 50, min: 0, step: 1, description: "设计桩基几何体积" },
      { key: "K_e", label: "充盈系数", unit: "无量纲", defaultValue: 1.2, min: 1, step: 0.05, description: "考虑扩孔及充盈的修正系数" },
      { key: "V_tank", label: "罐车容量", unit: "m³", defaultValue: 10, min: 1, step: 1, description: "泥浆运输罐车的额定容量" }
    ],
    outputs: [
      { key: "N_m", label: "车次", unit: "车", precision: 0 }
    ],
    exampleSummary: "当桩体积50m³，充盈系数1.2，罐车容量10m³时，外运车次为6车。",
    riskNotice: "泥浆必须外运至指定地点。严禁随意倾倒，系统仅计算/记录，不自动判定，需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (v) => ({
      N_m: Math.ceil((v.V_pile * v.K_e) / (v.V_tank || 1))
    })
  }
];
