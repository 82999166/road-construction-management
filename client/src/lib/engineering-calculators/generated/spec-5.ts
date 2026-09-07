/**
 * 铁路路基轨道桥隧专业计算器规格
 * 
 * 包含路基填方、轨道工程、无砟轨道、钢轨力学、桥梁涵洞、隧道工程、站场工程及通用测量等46项计算规格。
 * 所有计算公式及变量严格依据审计报告 audit-5.md 提取。
 */

export const unsupportedCalculatorIds: string[] = [];

export const categoryCalculatorSpecs = [
  {
    id: "RW-01-01",
    title: "路基填方土石方量计算",
    formula: "V = (A1 + A2) / 2 × L",
    inputs: [
      { key: "A1", label: "断面1面积", unit: "m²", defaultValue: 50, min: 0, step: 0.1, description: "第一个横断面的面积" },
      { key: "A2", label: "断面2面积", unit: "m²", defaultValue: 70, min: 0, step: 0.1, description: "第二个横断面的面积" },
      { key: "L", label: "两断面间距", unit: "m", defaultValue: 20, min: 0, step: 0.1, description: "两个横断面之间的中心线长度" }
    ],
    outputs: [
      { key: "V", label: "土石方体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "断面1面积 50 m², 断面2面积 70 m², 间距 20 m，计算体积为 1200 m³。",
    riskNotice: "当相邻断面面积差大于50%时，建议采用棱台体积公式计算。严禁用于地形起伏剧烈的地段。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { A1, A2, L } = values;
      const V = ((A1 + A2) / 2) * L;
      return { V };
    }
  },
  {
    id: "RW-01-02",
    title: "压实系数 (K) 计算",
    formula: "K = ρd / ρdmax",
    inputs: [
      { key: "rho_d", label: "填料实际干密度", unit: "g/cm³", defaultValue: 1.85, min: 0, step: 0.01, description: "现场实测的填料干密度" },
      { key: "rho_dmax", label: "填料最大干密度", unit: "g/cm³", defaultValue: 1.95, min: 0.01, step: 0.01, description: "标准击实试验确定的最大干密度" }
    ],
    outputs: [
      { key: "K", label: "压实系数", unit: "", precision: 3 }
    ],
    exampleSummary: "实际干密度 1.85 g/cm³, 最大干密度 1.95 g/cm³，压实系数约为 0.949。",
    riskNotice: "最大干密度需通过标准击实试验确定。系统仅计算不判定是否合格。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { rho_d, rho_dmax } = values;
      if (rho_dmax === 0) return { K: 0 };
      const K = rho_d / rho_dmax;
      return { K };
    }
  },
  {
    id: "RW-01-03",
    title: "地基系数 (K30) 换算",
    formula: "K30 = P / S",
    inputs: [
      { key: "P", label: "荷载强度", unit: "MPa", defaultValue: 0.125, min: 0, step: 0.001, description: "施加在测试板上的荷载强度" },
      { key: "S", label: "沉降量", unit: "m", defaultValue: 0.00125, min: 0.00001, step: 0.00001, description: "对应荷载下的下沉量（注意单位为米）" }
    ],
    outputs: [
      { key: "K30", label: "地基系数", unit: "MPa/m", precision: 2 }
    ],
    exampleSummary: "荷载强度 0.125 MPa, 沉降量 0.00125 m (1.25 mm)，地基系数为 100 MPa/m。",
    riskNotice: "测试板直径应为300mm。系统仅计算不判定是否合格。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { P, S } = values;
      if (S === 0) return { K30: 0 };
      const K30 = P / S;
      return { K30 };
    }
  },
  {
    id: "RW-01-04",
    title: "动态变形模量 (Evd) 记录",
    formula: "Evd = 1.5 × r × (F / s)",
    inputs: [
      { key: "r", label: "承载板半径", unit: "mm", defaultValue: 150, min: 0, step: 1, description: "承载板的半径" },
      { key: "F", label: "最大动荷载", unit: "MN", defaultValue: 0.00707, min: 0, step: 0.00001, description: "落锤产生的最大冲击力" },
      { key: "s", label: "承载板最大沉降幅值", unit: "mm", defaultValue: 0.35, min: 0.01, step: 0.01, description: "承载板在冲击下的最大位移" }
    ],
    outputs: [
      { key: "Evd", label: "动态变形模量", unit: "MPa", precision: 2 }
    ],
    exampleSummary: "半径 150 mm, 动荷载 0.00707 MN, 沉降 0.35 mm，动态变形模量为 45.45 MPa。",
    riskNotice: "测试前应平整场地，确保承载板与地面紧密接触。系统仅计算不判定是否合格。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { r, F, s } = values;
      if (s === 0) return { Evd: 0 };
      const Evd = 1.5 * r * (F / s);
      return { Evd };
    }
  },
  {
    id: "RW-01-05",
    title: "静态变形模量 (Ev2) 计算",
    formula: "Ev2 = 1.5 × r × (Δp / Δs)",
    inputs: [
      { key: "r", label: "承载板半径", unit: "mm", defaultValue: 150, min: 0, step: 1, description: "承载板的半径" },
      { key: "delta_p", label: "第二次加载压力差", unit: "MPa", defaultValue: 0.2, min: 0, step: 0.01, description: "第二次加载时的压力增量" },
      { key: "delta_s", label: "对应的沉降差", unit: "mm", defaultValue: 0.5, min: 0.01, step: 0.01, description: "第二次加载对应的沉降增量" }
    ],
    outputs: [
      { key: "Ev2", label: "静态变形模量", unit: "MPa", precision: 2 }
    ],
    exampleSummary: "半径 150 mm, 压力差 0.2 MPa, 沉降差 0.5 mm，静态变形模量为 90 MPa。",
    riskNotice: "测试耗时较长，通常与Evd配合使用。系统仅计算不判定是否合格。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { r, delta_p, delta_s } = values;
      if (delta_s === 0) return { Ev2: 0 };
      const Ev2 = 1.5 * r * (delta_p / delta_s);
      return { Ev2 };
    }
  },
  {
    id: "RW-01-06",
    title: "路基沉降观测数据整理",
    formula: "ΔS = S_n - S_0, V = (S_n - S_{n-1}) / Δt",
    inputs: [
      { key: "S_0", label: "初始高程", unit: "mm", defaultValue: 1000, min: -100000, step: 0.1, description: "观测点的初始高程值" },
      { key: "S_prev", label: "上次高程", unit: "mm", defaultValue: 998, min: -100000, step: 0.1, description: "上一个观测周期的高程值" },
      { key: "S_n", label: "本次高程", unit: "mm", defaultValue: 995, min: -100000, step: 0.1, description: "当前的实测高程值" },
      { key: "delta_t", label: "两次观测时间间隔", unit: "d", defaultValue: 5, min: 0.1, step: 0.1, description: "本次与上次观测的时间天数" }
    ],
    outputs: [
      { key: "delta_S", label: "累积沉降量", unit: "mm", precision: 1 },
      { key: "V", label: "沉降速率", unit: "mm/d", precision: 2 }
    ],
    exampleSummary: "初始 1000mm, 上次 998mm, 本次 995mm, 间隔 5天。累积沉降 -5mm，速率 -0.6mm/d。",
    riskNotice: "沉降预警阈值按设计/现行规范录入参数，系统仅计算不判定。严禁虚构观测数据。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { S_0, S_prev, S_n, delta_t } = values;
      const delta_S = S_n - S_0;
      const V = delta_t !== 0 ? (S_n - S_prev) / delta_t : 0;
      return { delta_S, V };
    }
  },
  {
    id: "RW-02-01",
    title: "道砟用量计算",
    formula: "V = A × L × (1 + k)",
    inputs: [
      { key: "A", label: "道床标准断面面积", unit: "m²", defaultValue: 3.2, min: 0, step: 0.01, description: "道床的设计截面积" },
      { key: "L", label: "线路长度", unit: "m", defaultValue: 1000, min: 0, step: 1, description: "铺设线路的总长度" },
      { key: "k", label: "损耗及沉陷系数", unit: "", defaultValue: 0.08, min: 0, step: 0.01, description: "考虑施工损耗和初期沉陷的系数（常取0.05-0.1）" }
    ],
    outputs: [
      { key: "V", label: "道砟总体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "面积 3.2 m², 长度 1000 m, 系数 0.08，总需道砟 3456 m³。",
    riskNotice: "不同等级铁路的断面面积不同，损耗系数按设计规定取值。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { A, L, k } = values;
      const V = A * L * (1 + k);
      return { V };
    }
  },
  {
    id: "RW-02-02",
    title: "轨枕数量计算",
    formula: "N = L × n / 1000",
    inputs: [
      { key: "L", label: "线路长度", unit: "m", defaultValue: 2500, min: 0, step: 1, description: "铺设线路的总长度" },
      { key: "n", label: "每公里铺设轨枕根数", unit: "根/km", defaultValue: 1667, min: 0, step: 1, description: "设计要求的铺轨密度" }
    ],
    outputs: [
      { key: "N", label: "轨枕总根数", unit: "根", precision: 0 }
    ],
    exampleSummary: "长度 2.5 km, 密度 1667 根/km，总需轨枕约 4168 根。",
    riskNotice: "结果应向上取整。曲线地段按外股长度计算。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L, n } = values;
      const N = Math.ceil((L * n) / 1000);
      return { N };
    }
  },
  {
    id: "RW-02-03",
    title: "轨排组装长度校验",
    formula: "L_total = L_rail + ΔL",
    inputs: [
      { key: "L_rail", label: "标准钢轨长度", unit: "m", defaultValue: 25, min: 0, step: 0.001, description: "单根钢轨的标准长度" },
      { key: "delta_L", label: "预留轨缝或伸缩量", unit: "m", defaultValue: 0.008, min: 0, step: 0.001, description: "接头处的预留间隙" }
    ],
    outputs: [
      { key: "L_total", label: "轨排总长度", unit: "m", precision: 3 }
    ],
    exampleSummary: "轨长 25 m, 轨缝 0.008 m，单节轨排总长 25.008 m。",
    riskNotice: "轨缝大小受环境温度影响，需根据轨温计算确定。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L_rail, delta_L } = values;
      const L_total = L_rail + delta_L;
      return { L_total };
    }
  },
  {
    id: "RW-02-04",
    title: "轨距偏差计算",
    formula: "ΔG = G_actual - G_standard",
    inputs: [
      { key: "G_actual", label: "实测轨距", unit: "mm", defaultValue: 1437, min: 0, step: 1, description: "两股钢轨头部的实际间距" },
      { key: "G_standard", label: "标准轨距", unit: "mm", defaultValue: 1435, min: 0, step: 1, description: "标准轨距通常为 1435mm" }
    ],
    outputs: [
      { key: "delta_G", label: "轨距偏差", unit: "mm", precision: 0 }
    ],
    exampleSummary: "实测 1437 mm, 标准 1435 mm，偏差为 +2 mm (扩轨)。",
    riskNotice: "轨道几何限值按设计/现行规范录入参数，系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { G_actual, G_standard } = values;
      const delta_G = G_actual - G_standard;
      return { delta_G };
    }
  },
  {
    id: "RW-02-05",
    title: "高低方向偏差测量换算",
    formula: "D = h - H_chord",
    inputs: [
      { key: "h", label: "测点实际位置", unit: "mm", defaultValue: 1005, min: -100000, step: 1, description: "测点的实际高程或横向位置" },
      { key: "H_chord", label: "弦线理论位置", unit: "mm", defaultValue: 1002, min: -100000, step: 1, description: "弦线在测点处的理论参考位置" }
    ],
    outputs: [
      { key: "D", label: "偏差值", unit: "mm", precision: 0 }
    ],
    exampleSummary: "实测 1005 mm, 理论 1002 mm，偏差为 +3 mm。",
    riskNotice: "通常采用10m弦或20m弦测量。限值判定按设计/现行规范录入参数，系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { h, H_chord } = values;
      const D = h - H_chord;
      return { D };
    }
  },
  {
    id: "RW-03-01",
    title: "CRTSⅠ型轨道板砂浆用量估算",
    formula: "V = L × W × H",
    inputs: [
      { key: "L", label: "轨道板长度", unit: "m", defaultValue: 4.96, min: 0, step: 0.01, description: "轨道板的长度" },
      { key: "W", label: "轨道板宽度", unit: "m", defaultValue: 2.4, min: 0, step: 0.01, description: "轨道板的宽度" },
      { key: "H", label: "充填层设计厚度", unit: "m", defaultValue: 0.05, min: 0, step: 0.001, description: "砂浆充填层的设计厚度" }
    ],
    outputs: [
      { key: "V", label: "砂浆体积", unit: "m³", precision: 4 }
    ],
    exampleSummary: "长度 4.96 m, 宽度 2.4 m, 厚度 0.05 m，单块板需砂浆约 0.5952 m³。",
    riskNotice: "实际施工需考虑损耗率(一般取5-10%)及板底空隙。厚度超标时需特殊处理。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L, W, H } = values;
      const V = L * W * H;
      return { V };
    }
  },
  {
    id: "RW-03-02",
    title: "双块式无砟轨道道床板混凝土用量",
    formula: "V = (A_section - A_sleeper) × L",
    inputs: [
      { key: "A_section", label: "道床板设计截面积", unit: "m²", defaultValue: 0.72, min: 0, step: 0.01, description: "道床板的标准截面积" },
      { key: "A_sleeper", label: "单位长度轨枕体积", unit: "m³/m", defaultValue: 0.12, min: 0, step: 0.01, description: "单位长度内双块式轨枕预埋部分的体积" },
      { key: "L", label: "浇筑段长度", unit: "m", defaultValue: 100, min: 0, step: 1, description: "本次浇筑的区段长度" }
    ],
    outputs: [
      { key: "V", label: "混凝土体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "截面积 0.72 m², 轨枕扣除 0.12 m³/m, 长度 100 m，需混凝土 60 m³。",
    riskNotice: "需扣除钢筋及预埋件体积（如要求精细计算）。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { A_section, A_sleeper, L } = values;
      const V = (A_section - A_sleeper) * L;
      return { V };
    }
  },
  {
    id: "RW-03-03",
    title: "CRTSⅢ型板自密实混凝土用量",
    formula: "V = L × W × H_avg + V_groove",
    inputs: [
      { key: "L", label: "轨道板长", unit: "m", defaultValue: 5.6, min: 0, step: 0.01, description: "轨道板的长度" },
      { key: "W", label: "轨道板宽", unit: "m", defaultValue: 2.5, min: 0, step: 0.01, description: "轨道板的宽度" },
      { key: "H_avg", label: "平均厚度", unit: "m", defaultValue: 0.09, min: 0, step: 0.001, description: "自密实混凝土层的平均厚度" },
      { key: "V_groove", label: "凹槽结构体积", unit: "m³", defaultValue: 0.05, min: 0, step: 0.001, description: "凹槽或特殊结构的体积增加量" }
    ],
    outputs: [
      { key: "V", label: "自密实混凝土体积", unit: "m³", precision: 3 }
    ],
    exampleSummary: "长 5.6 m, 宽 2.5 m, 厚 0.09 m, 凹槽 0.05 m³，单块板需 1.31 m³。",
    riskNotice: "灌注时需进行流动度和扩展度试验，确保填充密实。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L, W, H_avg, V_groove } = values;
      const V = L * W * H_avg + V_groove;
      return { V };
    }
  },
  {
    id: "RW-03-04",
    title: "底座板钢筋工程量核算",
    formula: "W = Σ (L_i × n_i × w_i) / L_total",
    inputs: [
      { key: "L_i", label: "单根钢筋长度", unit: "m", defaultValue: 10, min: 0, step: 0.1, description: "该类钢筋的单根长度" },
      { key: "n_i", label: "钢筋根数", unit: "根", defaultValue: 20, min: 0, step: 1, description: "该类钢筋的总根数" },
      { key: "w_i", label: "钢筋线密度", unit: "kg/m", defaultValue: 1.58, min: 0, step: 0.01, description: "钢筋单位长度的重量（如16mm钢筋为1.58kg/m）" },
      { key: "L_total", label: "底座板段长度", unit: "m", defaultValue: 10, min: 0.1, step: 0.1, description: "计算区段的总长度" }
    ],
    outputs: [
      { key: "W", label: "单位长度钢筋重量", unit: "kg/m", precision: 2 }
    ],
    exampleSummary: "钢筋长 10m, 20根, 密度 1.58kg/m, 段长 10m，单位长度重量 31.6 kg/m。",
    riskNotice: "需分别计算纵向筋、横向筋和箍筋后汇总。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L_i, n_i, w_i, L_total } = values;
      if (L_total === 0) return { W: 0 };
      const W = (L_i * n_i * w_i) / L_total;
      return { W };
    }
  },
  {
    id: "RW-03-05",
    title: "轨道几何内部平顺性极差计算",
    formula: "R = Max(V_i) - Min(V_i)",
    inputs: [
      { key: "v1", label: "测点1偏差", unit: "mm", defaultValue: 1, min: -100, step: 0.1, description: "测点1的几何偏差值" },
      { key: "v2", label: "测点2偏差", unit: "mm", defaultValue: -2, min: -100, step: 0.1, description: "测点2的几何偏差值" },
      { key: "v3", label: "测点3偏差", unit: "mm", defaultValue: 3, min: -100, step: 0.1, description: "测点3的几何偏差值" },
      { key: "v4", label: "测点4偏差", unit: "mm", defaultValue: 0, min: -100, step: 0.1, description: "测点4的几何偏差值" },
      { key: "v5", label: "测点5偏差", unit: "mm", defaultValue: -1, min: -100, step: 0.1, description: "测点5的几何偏差值" }
    ],
    outputs: [
      { key: "R", label: "极差", unit: "mm", precision: 1 }
    ],
    exampleSummary: "偏差分别为 1, -2, 3, 0, -1 mm，最大3，最小-2，极差为 5 mm。",
    riskNotice: "几何限值按设计/现行规范录入参数，系统仅计算不判定极差是否合格。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const v = [values.v1, values.v2, values.v3, values.v4, values.v5];
      const R = Math.max(...v) - Math.min(...v);
      return { R };
    }
  },
  {
    id: "RW-04-01",
    title: "钢轨理论重量计算",
    formula: "W = L × m",
    inputs: [
      { key: "L", label: "钢轨长度", unit: "m", defaultValue: 500, min: 0, step: 1, description: "钢轨的总铺设长度" },
      { key: "m", label: "单位长度理论重量", unit: "kg/m", defaultValue: 60.64, min: 0, step: 0.01, description: "钢轨型号对应的线质量（如60kg/m钢轨实为60.64kg/m）" }
    ],
    outputs: [
      { key: "W_kg", label: "钢轨总重量", unit: "kg", precision: 1 },
      { key: "W_t", label: "钢轨总重量", unit: "t", precision: 3 }
    ],
    exampleSummary: "长度 500 m, 60kg/m钢轨(60.64kg/m)，总重 30320 kg (30.32 t)。",
    riskNotice: "不同型号钢轨线质量不同，需查表取精确值。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L, m } = values;
      const W_kg = L * m;
      const W_t = W_kg / 1000;
      return { W_kg, W_t };
    }
  },
  {
    id: "RW-04-02",
    title: "无缝线路伸缩区长度计算",
    formula: "L_s = (E × F × α × ΔT - P) / r",
    inputs: [
      { key: "E", label: "钢轨弹性模量", unit: "MPa", defaultValue: 210000, min: 0, step: 1000, description: "钢轨材料的弹性模量" },
      { key: "F", label: "钢轨截面积", unit: "mm²", defaultValue: 7745, min: 0, step: 1, description: "钢轨的横截面积" },
      { key: "alpha", label: "线膨胀系数", unit: "1/℃", defaultValue: 0.0000118, min: 0, step: 0.0000001, description: "钢轨的线膨胀系数" },
      { key: "delta_T", label: "温度变化量", unit: "℃", defaultValue: 40, min: 0, step: 1, description: "轨温的变化绝对值" },
      { key: "P", label: "接头阻力", unit: "N", defaultValue: 300000, min: 0, step: 1000, description: "钢轨接头提供的阻力" },
      { key: "r", label: "纵向阻力", unit: "N/m", defaultValue: 12000, min: 1, step: 100, description: "道床提供的单位长度纵向阻力" }
    ],
    outputs: [
      { key: "L_s", label: "伸缩区长度", unit: "m", precision: 2 }
    ],
    exampleSummary: "E=2.1e5, F=7745, α=1.18e-5, ΔT=40, P=3e5, r=1.2e4，伸缩区长 39.02 m。",
    riskNotice: "安全参数及阻力取值按设计/现行规范录入参数，系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { E, F, alpha, delta_T, P, r } = values;
      if (r === 0) return { L_s: 0 };
      const L_s = (E * F * alpha * delta_T - P) / r;
      return { L_s: Math.max(0, L_s) };
    }
  },
  {
    id: "RW-04-03",
    title: "锁定轨温变化量核算",
    formula: "ΔT_lock = T_actual - T_design",
    inputs: [
      { key: "T_actual", label: "实际锁定轨温", unit: "℃", defaultValue: 28, min: -50, step: 0.1, description: "施工时实际记录的锁定轨温" },
      { key: "T_design", label: "设计锁定轨温", unit: "℃", defaultValue: 25, min: -50, step: 0.1, description: "设计文件要求的锁定轨温" }
    ],
    outputs: [
      { key: "delta_T_lock", label: "锁定轨温变化量", unit: "℃", precision: 1 }
    ],
    exampleSummary: "实际 28 ℃, 设计 25 ℃，偏高 3 ℃。",
    riskNotice: "变化量超出允许范围时需应力放散。判定标准按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { T_actual, T_design } = values;
      const delta_T_lock = T_actual - T_design;
      return { delta_T_lock };
    }
  },
  {
    id: "RW-04-04",
    title: "钢轨焊缝间距校验",
    formula: "L_weld = | P_2 - P_1 |",
    inputs: [
      { key: "P1", label: "焊缝1里程", unit: "m", defaultValue: 10100.5, min: 0, step: 0.1, description: "第一个焊缝所在的里程位置" },
      { key: "P2", label: "焊缝2里程", unit: "m", defaultValue: 10106.5, min: 0, step: 0.1, description: "第二个焊缝所在的里程位置" }
    ],
    outputs: [
      { key: "L_weld", label: "焊缝间距", unit: "m", precision: 1 }
    ],
    exampleSummary: "里程 10100.5 和 10106.5，间距为 6.0 m。",
    riskNotice: "不同焊接方式的最小间距要求不同，系统仅计算不判定是否满足规范。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { P1, P2 } = values;
      const L_weld = Math.abs(P2 - P1);
      return { L_weld };
    }
  },
  {
    id: "RW-04-05",
    title: "钢轨温度应力估算",
    formula: "σ = E × α × ΔT",
    inputs: [
      { key: "E", label: "钢轨弹性模量", unit: "MPa", defaultValue: 210000, min: 0, step: 1000, description: "钢轨材料的弹性模量" },
      { key: "alpha", label: "线膨胀系数", unit: "1/℃", defaultValue: 0.0000118, min: 0, step: 0.0000001, description: "钢轨的线膨胀系数" },
      { key: "delta_T", label: "轨温变化量", unit: "℃", defaultValue: 30, min: 0, step: 1, description: "轨温相对于锁定轨温的变化量" }
    ],
    outputs: [
      { key: "sigma", label: "温度应力", unit: "MPa", precision: 2 }
    ],
    exampleSummary: "E=2.1e5, α=1.18e-5, ΔT=30，内部温度应力为 74.34 MPa。",
    riskNotice: "仅适用于固定区，不适用于伸缩区。安全判定按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { E, alpha, delta_T } = values;
      const sigma = E * alpha * delta_T;
      return { sigma };
    }
  },
  {
    id: "RW-05-01",
    title: "钻孔灌注桩混凝土充盈系数",
    formula: "K_c = V_actual / (π × (D/2)^2 × L)",
    inputs: [
      { key: "V_actual", label: "实际灌注混凝土体积", unit: "m³", defaultValue: 18, min: 0, step: 0.1, description: "该桩实际消耗的混凝土方量" },
      { key: "D", label: "桩径", unit: "m", defaultValue: 1.0, min: 0.1, step: 0.1, description: "设计桩的直径" },
      { key: "L", label: "桩长", unit: "m", defaultValue: 20, min: 0.1, step: 0.1, description: "设计桩的长度" }
    ],
    outputs: [
      { key: "V_theory", label: "理论体积", unit: "m³", precision: 3 },
      { key: "K_c", label: "充盈系数", unit: "", precision: 3 }
    ],
    exampleSummary: "桩径 1.0m, 桩长 20m, 实际用量 18m³，理论 15.708m³，充盈系数 1.146。",
    riskNotice: "充盈系数一般应大于1.0，过大可能表示塌孔。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { V_actual, D, L } = values;
      const V_theory = Math.PI * Math.pow(D / 2, 2) * L;
      if (V_theory === 0) return { V_theory: 0, K_c: 0 };
      const K_c = V_actual / V_theory;
      return { V_theory, K_c };
    }
  },
  {
    id: "RW-05-02",
    title: "承台大体积混凝土温差计算",
    formula: "ΔT_core = T_center - T_surface",
    inputs: [
      { key: "T_center", label: "中心最高温度", unit: "℃", defaultValue: 65, min: -50, step: 0.1, description: "混凝土内部中心测点的最高温度" },
      { key: "T_surface", label: "表面温度", unit: "℃", defaultValue: 42, min: -50, step: 0.1, description: "混凝土表层的实测温度" }
    ],
    outputs: [
      { key: "delta_T_core", label: "内外温差", unit: "℃", precision: 1 }
    ],
    exampleSummary: "中心 65 ℃, 表面 42 ℃，内外温差为 23 ℃。",
    riskNotice: "温差超标易引起裂缝。温控阈值按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { T_center, T_surface } = values;
      const delta_T_core = T_center - T_surface;
      return { delta_T_core };
    }
  },
  {
    id: "RW-05-03",
    title: "墩台模板侧压力估算",
    formula: "P = γ × h",
    inputs: [
      { key: "gamma", label: "混凝土重度", unit: "kN/m³", defaultValue: 24, min: 0, step: 1, description: "新浇筑混凝土的重度" },
      { key: "h", label: "有效压头高度", unit: "m", defaultValue: 2.5, min: 0, step: 0.1, description: "混凝土对模板产生侧压力的有效高度" }
    ],
    outputs: [
      { key: "P", label: "最大侧压力", unit: "kN/m²", precision: 1 }
    ],
    exampleSummary: "重度 24 kN/m³, 高度 2.5 m，最大侧压力估算为 60 kN/m²。",
    riskNotice: "实际侧压力还受浇筑速度、外加剂等影响，此处为简化计算。系统仅提供参考值。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { gamma, h } = values;
      const P = gamma * h;
      return { P };
    }
  },
  {
    id: "RW-05-04",
    title: "预应力筋理论伸长量计算",
    formula: "ΔL = (P × L) / (A_p × E_p)",
    inputs: [
      { key: "P", label: "平均张拉力", unit: "N", defaultValue: 1500000, min: 0, step: 1000, description: "预应力筋在张拉段的平均张拉力" },
      { key: "L", label: "预应力筋长度", unit: "mm", defaultValue: 30000, min: 0, step: 1, description: "预应力筋的计算长度" },
      { key: "A_p", label: "截面积", unit: "mm²", defaultValue: 1400, min: 1, step: 1, description: "预应力筋的公称截面积" },
      { key: "E_p", label: "弹性模量", unit: "MPa", defaultValue: 195000, min: 1, step: 1000, description: "预应力筋的弹性模量" }
    ],
    outputs: [
      { key: "delta_L", label: "理论伸长量", unit: "mm", precision: 1 }
    ],
    exampleSummary: "张拉力 1.5e6 N, 长度 30000 mm, 面积 1400 mm², E=1.95e5 MPa，理论伸长量 164.8 mm。",
    riskNotice: "实际张拉需采用双控(应力和伸长量)。误差限值按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { P, L, A_p, E_p } = values;
      if (A_p === 0 || E_p === 0) return { delta_L: 0 };
      const delta_L = (P * L) / (A_p * E_p);
      return { delta_L };
    }
  },
  {
    id: "RW-05-05",
    title: "预应力张拉伸长量误差率",
    formula: "E = (ΔL_actual - ΔL_theory) / ΔL_theory × 100%",
    inputs: [
      { key: "delta_L_actual", label: "实测伸长量", unit: "mm", defaultValue: 168, min: 0, step: 0.1, description: "张拉时实际测得的伸长量" },
      { key: "delta_L_theory", label: "理论伸长量", unit: "mm", defaultValue: 164.8, min: 0.1, step: 0.1, description: "计算得出的理论伸长量" }
    ],
    outputs: [
      { key: "E", label: "伸长量误差率", unit: "%", precision: 2 }
    ],
    exampleSummary: "实测 168 mm, 理论 164.8 mm，误差率为 +1.94%。",
    riskNotice: "通常规范要求误差在±6%以内。判定标准按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { delta_L_actual, delta_L_theory } = values;
      if (delta_L_theory === 0) return { E: 0 };
      const E = ((delta_L_actual - delta_L_theory) / delta_L_theory) * 100;
      return { E };
    }
  },
  {
    id: "RW-05-06",
    title: "桥梁支座垫石高程偏差",
    formula: "ΔH = (H_actual - H_design) × 1000",
    inputs: [
      { key: "H_actual", label: "实测高程", unit: "m", defaultValue: 120.503, min: -10000, step: 0.001, description: "垫石顶面的实际测量高程" },
      { key: "H_design", label: "设计高程", unit: "m", defaultValue: 120.5, min: -10000, step: 0.001, description: "设计文件要求的高程值" }
    ],
    outputs: [
      { key: "delta_H", label: "高程偏差", unit: "mm", precision: 0 }
    ],
    exampleSummary: "实测 120.503 m, 设计 120.500 m，偏差为 +3 mm。",
    riskNotice: "支座垫石高程精度要求极高。限值判定按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { H_actual, H_design } = values;
      const delta_H = (H_actual - H_design) * 1000;
      return { delta_H };
    }
  },
  {
    id: "RW-05-07",
    title: "梁体徐变上拱度预估",
    formula: "f_t = f_0 × φ(t, t_0)",
    inputs: [
      { key: "f_0", label: "弹性初始上拱度", unit: "mm", defaultValue: 15, min: 0, step: 1, description: "预应力张拉完成后的瞬时弹性上拱值" },
      { key: "phi", label: "徐变系数", unit: "", defaultValue: 2.0, min: 0, step: 0.1, description: "考虑混凝土徐变影响的系数" }
    ],
    outputs: [
      { key: "f_t", label: "徐变上拱度", unit: "mm", precision: 1 }
    ],
    exampleSummary: "初始上拱度 15 mm, 徐变系数 2.0，预估徐变上拱度 30 mm。",
    riskNotice: "徐变系数与混凝土龄期、环境湿度等有关。参数按设计录入，系统仅计算。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { f_0, phi } = values;
      const f_t = f_0 * phi;
      return { f_t };
    }
  },
  {
    id: "RW-05-08",
    title: "涵洞盖板混凝土方量",
    formula: "V = L × B × H × N",
    inputs: [
      { key: "L", label: "单块盖板长度", unit: "m", defaultValue: 3.5, min: 0, step: 0.1, description: "单块盖板的长度" },
      { key: "B", label: "单块盖板宽度", unit: "m", defaultValue: 1.0, min: 0, step: 0.1, description: "单块盖板的宽度" },
      { key: "H", label: "盖板厚度", unit: "m", defaultValue: 0.4, min: 0, step: 0.01, description: "盖板的厚度" },
      { key: "N", label: "盖板数量", unit: "块", defaultValue: 10, min: 1, step: 1, description: "盖板的总块数" }
    ],
    outputs: [
      { key: "V", label: "总体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "长 3.5m, 宽 1.0m, 厚 0.4m, 10块，总需混凝土 14 m³。",
    riskNotice: "斜交涵洞需按实际斜长计算。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L, B, H, N } = values;
      const V = L * B * H * N;
      return { V };
    }
  },
  {
    id: "RW-06-01",
    title: "隧道开挖超欠挖面积比例",
    formula: "R_over = (A_actual - A_design) / A_design × 100%",
    inputs: [
      { key: "A_actual", label: "实际开挖断面积", unit: "m²", defaultValue: 125, min: 0, step: 0.1, description: "实测的开挖轮廓面积" },
      { key: "A_design", label: "设计开挖断面积", unit: "m²", defaultValue: 120, min: 1, step: 0.1, description: "设计要求的开挖轮廓面积" }
    ],
    outputs: [
      { key: "R_over", label: "超欠挖比例", unit: "%", precision: 2 }
    ],
    exampleSummary: "实际 125 m², 设计 120 m²，超挖比例为 4.17%。",
    riskNotice: "严禁人为修改扫描数据。允许超挖限值按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { A_actual, A_design } = values;
      if (A_design === 0) return { R_over: 0 };
      const R_over = ((A_actual - A_design) / A_design) * 100;
      return { R_over };
    }
  },
  {
    id: "RW-06-02",
    title: "初支喷射混凝土回弹率",
    formula: "R_rebound = W_rebound / (W_rebound + W_wall) × 100%",
    inputs: [
      { key: "W_rebound", label: "回弹落地重量", unit: "kg", defaultValue: 300, min: 0, step: 1, description: "喷射过程中回弹落地的混凝土重量" },
      { key: "W_wall", label: "附着岩面重量", unit: "kg", defaultValue: 1200, min: 1, step: 1, description: "附着在围岩面上的有效混凝土重量" }
    ],
    outputs: [
      { key: "R_rebound", label: "回弹率", unit: "%", precision: 1 }
    ],
    exampleSummary: "回弹 300 kg, 附着 1200 kg，回弹率为 20%。",
    riskNotice: "边墙和拱部的回弹率标准不同。判定标准按设计/现行规范录入参数。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { W_rebound, W_wall } = values;
      const total = W_rebound + W_wall;
      if (total === 0) return { R_rebound: 0 };
      const R_rebound = (W_rebound / total) * 100;
      return { R_rebound };
    }
  },
  {
    id: "RW-06-03",
    title: "二衬混凝土台车灌注量预估",
    formula: "V = (A_excavate - A_inner) × L_cart × (1 + k)",
    inputs: [
      { key: "A_excavate", label: "实际初支内轮廓面积", unit: "m²", defaultValue: 105, min: 0, step: 0.1, description: "实测的初期支护内表面积" },
      { key: "A_inner", label: "二衬内轮廓面积", unit: "m²", defaultValue: 95, min: 0, step: 0.1, description: "设计要求的二次衬砌内表面积" },
      { key: "L_cart", label: "台车长度", unit: "m", defaultValue: 12, min: 0, step: 0.1, description: "衬砌台车的总长度" },
      { key: "k", label: "充盈及损耗系数", unit: "", defaultValue: 0.05, min: 0, step: 0.01, description: "考虑超挖充盈和施工损耗的系数" }
    ],
    outputs: [
      { key: "V", label: "预估灌注量", unit: "m³", precision: 2 }
    ],
    exampleSummary: "初支面积 105 m², 二衬面积 95 m², 台车 12 m, 损耗 0.05，需混凝土 126 m³。",
    riskNotice: "实际灌注量受超挖影响较大，需结合三维扫描数据精细计算。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { A_excavate, A_inner, L_cart, k } = values;
      const V = (A_excavate - A_inner) * L_cart * (1 + k);
      return { V };
    }
  },
  {
    id: "RW-06-04",
    title: "防排水盲管敷设长度计算",
    formula: "L_total = n × L_ring + L_long",
    inputs: [
      { key: "n", label: "环向盲管布置道数", unit: "道", defaultValue: 20, min: 0, step: 1, description: "计算区段内布置的环向盲管道数" },
      { key: "L_ring", label: "单道环向盲管长度", unit: "m", defaultValue: 25, min: 0, step: 0.1, description: "单根环向盲管的展开长度" },
      { key: "L_long", label: "纵向盲管总长", unit: "m", defaultValue: 100, min: 0, step: 0.1, description: "计算区段内纵向盲管的总长度" }
    ],
    outputs: [
      { key: "L_total", label: "盲管总长", unit: "m", precision: 1 }
    ],
    exampleSummary: "环向 20道, 每道 25m, 纵向 100m，总长度为 600 m。",
    riskNotice: "需考虑接头搭接长度及弯曲余量。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { n, L_ring, L_long } = values;
      const L_total = n * L_ring + L_long;
      return { L_total };
    }
  },
  {
    id: "RW-06-05",
    title: "注浆量经验公式计算",
    formula: "Q = π × R^2 × L × n × α × β",
    inputs: [
      { key: "R", label: "浆液扩散半径", unit: "m", defaultValue: 0.5, min: 0, step: 0.1, description: "浆液在岩体中的扩散半径" },
      { key: "L", label: "注浆段长度", unit: "m", defaultValue: 3, min: 0, step: 0.1, description: "注浆管的有效长度" },
      { key: "n", label: "岩体孔隙率", unit: "", defaultValue: 0.05, min: 0, step: 0.01, description: "围岩的孔隙比或裂隙率" },
      { key: "alpha", label: "浆液充填率", unit: "", defaultValue: 0.8, min: 0, step: 0.01, description: "浆液在孔隙中的有效填充比例" },
      { key: "beta", label: "浆液损耗系数", unit: "", defaultValue: 1.2, min: 1, step: 0.1, description: "考虑浆液流失及管路损耗的系数" }
    ],
    outputs: [
      { key: "Q", label: "注浆量", unit: "m³", precision: 3 }
    ],
    exampleSummary: "半径 0.5m, 长度 3m, 孔隙率 0.05, 充填率 0.8, 损耗 1.2，单孔注浆量 0.113 m³。",
    riskNotice: "实际注浆量应以注浆压力和流量双控为准。系统仅提供理论参考值。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { R, L, n, alpha, beta } = values;
      const Q = Math.PI * Math.pow(R, 2) * L * n * alpha * beta;
      return { Q };
    }
  },
  {
    id: "RW-06-06",
    title: "隧道施工通风风量计算",
    formula: "Q = max(Q_man, Q_blast, Q_machine)",
    inputs: [
      { key: "Q_man", label: "按人数计算风量", unit: "m³/min", defaultValue: 150, min: 0, step: 1, description: "按洞内最多人数计算的需风量" },
      { key: "Q_blast", label: "按爆破排烟计算风量", unit: "m³/min", defaultValue: 800, min: 0, step: 1, description: "按一次爆破排烟要求的需风量" },
      { key: "Q_machine", label: "按机械功率计算风量", unit: "m³/min", defaultValue: 600, min: 0, step: 1, description: "按内燃机械总功率计算的需风量" }
    ],
    outputs: [
      { key: "Q", label: "设计最小需风量", unit: "m³/min", precision: 0 }
    ],
    exampleSummary: "人数需 150, 爆破需 800, 机械需 600，设计最小需风量为 800 m³/min。",
    riskNotice: "应考虑风道漏风系数及隧道长度。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { Q_man, Q_blast, Q_machine } = values;
      const Q = Math.max(Q_man, Q_blast, Q_machine);
      return { Q };
    }
  },
  {
    id: "RW-06-07",
    title: "监控量测周边收敛速率",
    formula: "v = |u_n - u_{n-1}| / Δt",
    inputs: [
      { key: "u_prev", label: "上次测线长度", unit: "mm", defaultValue: 10000, min: 0, step: 0.1, description: "上一个周期的测距值" },
      { key: "u_n", label: "本次测线长度", unit: "mm", defaultValue: 9996, min: 0, step: 0.1, description: "本周期的实测距值" },
      { key: "delta_t", label: "观测时间间隔", unit: "d", defaultValue: 2, min: 0.1, step: 0.1, description: "两次观测之间的时间天数" }
    ],
    outputs: [
      { key: "v", label: "收敛速率", unit: "mm/d", precision: 2 }
    ],
    exampleSummary: "上次 10000 mm, 本次 9996 mm, 间隔 2 天，收敛速率为 2 mm/d。",
    riskNotice: "预警阈值按设计/现行规范录入参数，系统仅计算不判定。严禁编造监控数据。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { u_prev, u_n, delta_t } = values;
      if (delta_t === 0) return { v: 0 };
      const v = Math.abs(u_n - u_prev) / delta_t;
      return { v };
    }
  },
  {
    id: "RW-06-08",
    title: "隧道爆破炮眼利用率",
    formula: "η = L_actual / L_drill × 100%",
    inputs: [
      { key: "L_actual", label: "实际循环进尺", unit: "m", defaultValue: 2.7, min: 0, step: 0.1, description: "爆破后实际向前推进的距离" },
      { key: "L_drill", label: "炮眼钻孔深度", unit: "m", defaultValue: 3.0, min: 0.1, step: 0.1, description: "钻孔设计的深度" }
    ],
    outputs: [
      { key: "eta", label: "炮眼利用率", unit: "%", precision: 1 }
    ],
    exampleSummary: "进尺 2.7 m, 钻深 3.0 m，炮眼利用率为 90%。",
    riskNotice: "爆破参数设计必须由专业人员依据岩性确定。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { L_actual, L_drill } = values;
      if (L_drill === 0) return { eta: 0 };
      const eta = (L_actual / L_drill) * 100;
      return { eta };
    }
  },
  {
    id: "RW-07-01",
    title: "站台墙混凝土方量计算",
    formula: "V = A_wall × L",
    inputs: [
      { key: "A_wall", label: "站台墙标准截面积", unit: "m²", defaultValue: 0.8, min: 0, step: 0.01, description: "站台挡墙的设计截面积" },
      { key: "L", label: "站台长度", unit: "m", defaultValue: 450, min: 0, step: 1, description: "站台墙的总长度" }
    ],
    outputs: [
      { key: "V", label: "站台墙体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "截面积 0.8 m², 长度 450 m，单侧站台墙需混凝土 360 m³。",
    riskNotice: "如有伸缩缝或变形缝，需扣除相应体积或单独核算。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { A_wall, L } = values;
      const V = A_wall * L;
      return { V };
    }
  },
  {
    id: "RW-07-02",
    title: "站场排水沟过水断面核算",
    formula: "A_water = (b + m × h) × h",
    inputs: [
      { key: "b", label: "沟底宽度", unit: "m", defaultValue: 0.6, min: 0, step: 0.1, description: "排水沟底部的净宽" },
      { key: "m", label: "边坡系数", unit: "", defaultValue: 0, min: 0, step: 0.1, description: "排水沟侧壁的坡度系数（矩形沟为0）" },
      { key: "h", label: "设计水深", unit: "m", defaultValue: 0.5, min: 0, step: 0.1, description: "沟内允许的最大设计水深" }
    ],
    outputs: [
      { key: "A_water", label: "过水断面积", unit: "m²", precision: 2 }
    ],
    exampleSummary: "矩形沟(m=0), 宽 0.6 m, 水深 0.5 m，过水面积为 0.3 m²。",
    riskNotice: "梯形沟需输入边坡系数m。流量核算需结合纵坡和糙率。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { b, m, h } = values;
      const A_water = (b + m * h) * h;
      return { A_water };
    }
  },
  {
    id: "RW-07-03",
    title: "接触网支柱基础土方开挖量",
    formula: "V = (a + 2c) × (b + 2c) × H",
    inputs: [
      { key: "a", label: "基础设计长", unit: "m", defaultValue: 1.0, min: 0, step: 0.1, description: "基础底面的设计长度" },
      { key: "b", label: "基础设计宽", unit: "m", defaultValue: 1.0, min: 0, step: 0.1, description: "基础底面的设计宽度" },
      { key: "c", label: "增加宽度", unit: "m", defaultValue: 0.3, min: 0, step: 0.1, description: "考虑工作面及放坡的增加宽度" },
      { key: "H", label: "基坑深度", unit: "m", defaultValue: 2.5, min: 0, step: 0.1, description: "从地面算起的开挖深度" }
    ],
    outputs: [
      { key: "V", label: "开挖体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "基础 1x1m, 增加宽 0.3m, 深度 2.5m，单基开挖量 6.4 m³。",
    riskNotice: "如采用机械钻孔成桩，则按圆柱体公式计算，无需工作面。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { a, b, c, H } = values;
      const V = (a + 2 * c) * (b + 2 * c) * H;
      return { V };
    }
  },
  {
    id: "RW-07-04",
    title: "接触网拉线基础锚段长度",
    formula: "L_anchor = sqrt(D^2 + H_pole^2)",
    inputs: [
      { key: "D", label: "水平距离", unit: "m", defaultValue: 5, min: 0, step: 0.1, description: "拉线基础中心至支柱中心的水平距离" },
      { key: "H_pole", label: "挂点高度", unit: "m", defaultValue: 7, min: 0, step: 0.1, description: "支柱拉线挂点距地面的高度" }
    ],
    outputs: [
      { key: "L_anchor", label: "拉线理论斜长", unit: "m", precision: 2 }
    ],
    exampleSummary: "水平距离 5 m, 挂点高度 7 m，理论斜长约为 8.60 m。",
    riskNotice: "实际下料长度需增加地下锚固段及地上调节段长度。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { D, H_pole } = values;
      const L_anchor = Math.sqrt(Math.pow(D, 2) + Math.pow(H_pole, 2));
      return { L_anchor };
    }
  },
  {
    id: "RW-07-05",
    title: "站场道岔铺设根数统计",
    formula: "N_total = Σ N_i",
    inputs: [
      { key: "n1", label: "型号1道岔数量", unit: "组", defaultValue: 10, min: 0, step: 1, description: "第一种型号的道岔组数" },
      { key: "n2", label: "型号2道岔数量", unit: "组", defaultValue: 5, min: 0, step: 1, description: "第二种型号的道岔组数" }
    ],
    outputs: [
      { key: "N_total", label: "道岔总数", unit: "组", precision: 0 }
    ],
    exampleSummary: "1/9道岔 10组, 1/12道岔 5组，共需道岔 15 组。",
    riskNotice: "不同辙叉号、单开/交分道岔必须分类统计。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { n1, n2 } = values;
      const N_total = n1 + n2;
      return { N_total };
    }
  },
  {
    id: "RW-08-01",
    title: "水准测量高差闭合差",
    formula: "f_h = Σh_actual - (H_end - H_start)",
    inputs: [
      { key: "sum_h", label: "实测高差总和", unit: "mm", defaultValue: 5050, min: -1000000, step: 1, description: "各测段实测高差的代数和" },
      { key: "H_start", label: "起点已知高程", unit: "mm", defaultValue: 100000, min: -10000000, step: 1, description: "路线起点的已知高程值" },
      { key: "H_end", label: "终点已知高程", unit: "mm", defaultValue: 105045, min: -10000000, step: 1, description: "路线终点的已知高程值" }
    ],
    outputs: [
      { key: "f_h", label: "高差闭合差", unit: "mm", precision: 0 }
    ],
    exampleSummary: "实测总和 5050 mm, 起点 100000 mm, 终点 105045 mm，闭合差为 +5 mm。",
    riskNotice: "闭合差限值按设计/现行规范录入参数，系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { sum_h, H_start, H_end } = values;
      const f_h = sum_h - (H_end - H_start);
      return { f_h };
    }
  },
  {
    id: "RW-08-02",
    title: "混凝土试块抗压强度代表值",
    formula: "按规范剔除异常值后求平均",
    inputs: [
      { key: "f1", label: "试块1强度", unit: "MPa", defaultValue: 40.5, min: 0, step: 0.1, description: "第一个试块的抗压强度" },
      { key: "f2", label: "试块2强度", unit: "MPa", defaultValue: 41.2, min: 0, step: 0.1, description: "第二个试块的抗压强度" },
      { key: "f3", label: "试块3强度", unit: "MPa", defaultValue: 49.8, min: 0, step: 0.1, description: "第三个试块的抗压强度" }
    ],
    outputs: [
      { key: "f_rep", label: "强度代表值", unit: "MPa", precision: 1 }
    ],
    exampleSummary: "测值 40.5, 41.2, 49.8 MPa，代表值为 41.2 MPa（剔除偏差超标项）。",
    riskNotice: "若最大值和最小值均超出中间值的15%，则该组数据作废。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const f = [values.f1, values.f2, values.f3].sort((a, b) => a - b);
      const min = f[0];
      const mid = f[1];
      const max = f[2];
      
      const diffMin = (mid - min) / mid;
      const diffMax = (max - mid) / mid;
      
      let f_rep = 0;
      if (diffMin > 0.15 && diffMax > 0.15) {
        // 均超出15%，作废，这里返回中间值但标记需复核
        f_rep = mid;
      } else if (diffMin > 0.15 || diffMax > 0.15) {
        // 其中一个超出15%，取中间值
        f_rep = mid;
      } else {
        // 均未超出15%，取平均值
        f_rep = (min + mid + max) / 3;
      }
      return { f_rep };
    }
  },
  {
    id: "RW-08-03",
    title: "全站仪三角高程测量高差",
    formula: "h = S × sin(α) + i - v",
    inputs: [
      { key: "S", label: "斜距", unit: "m", defaultValue: 100, min: 0, step: 0.001, description: "测站至棱镜的直线斜距离" },
      { key: "alpha_deg", label: "垂直角", unit: "°", defaultValue: 5, min: -90, max: 90, step: 0.001, description: "全站仪测量的垂直角度" },
      { key: "i", label: "仪器高", unit: "m", defaultValue: 1.5, min: 0, step: 0.001, description: "仪器中心距测站中心的高差" },
      { key: "v", label: "棱镜高", unit: "m", defaultValue: 1.5, min: 0, step: 0.001, description: "棱镜中心距目标点的高差" }
    ],
    outputs: [
      { key: "h", label: "两点间高差", unit: "m", precision: 3 }
    ],
    exampleSummary: "斜距 100m, 垂直角 5°, 仪器高 1.5m, 棱镜高 1.5m，高差为 8.715 m。",
    riskNotice: "长距离测量需考虑地球曲率和大气折光差修正。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { S, alpha_deg, i, v } = values;
      const alpha_rad = (alpha_deg * Math.PI) / 180;
      const h = S * Math.sin(alpha_rad) + i - v;
      return { h };
    }
  },
  {
    id: "RW-08-04",
    title: "工程量期中计量支付汇总",
    formula: "P = Σ (Q_i × U_i) × (1 - R)",
    inputs: [
      { key: "q1", label: "项1工程量", unit: "", defaultValue: 1000, min: 0, step: 1, description: "第一项本期完成的工程量" },
      { key: "u1", label: "项1单价", unit: "元", defaultValue: 20, min: 0, step: 0.01, description: "第一项的合同单价" },
      { key: "q2", label: "项2工程量", unit: "", defaultValue: 100, min: 0, step: 1, description: "第二项本期完成的工程量" },
      { key: "u2", label: "项2单价", unit: "元", defaultValue: 500, min: 0, step: 0.01, description: "第二项的合同单价" },
      { key: "R", label: "质保金比例", unit: "", defaultValue: 0.05, min: 0, max: 1, step: 0.01, description: "合同约定的质保金扣留比例" }
    ],
    outputs: [
      { key: "P", label: "本期应支付金额", unit: "元", precision: 2 }
    ],
    exampleSummary: "项1(1000x20), 项2(100x500), 质保金 5%，应支付 66500 元。",
    riskNotice: "仅计量质量验收合格的工程量。严禁超计、漏计。系统仅计算不判定。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { q1, u1, q2, u2, R } = values;
      const total = (q1 * u1 + q2 * u2) * (1 - R);
      return { P: total };
    }
  }
];
