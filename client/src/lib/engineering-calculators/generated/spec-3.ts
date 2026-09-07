/**
 * 土工路基边坡地基分卷自动计算规格模块
 * 
 * 不可安全数值化条目说明：
 * 1. SUB-02 (2.2 压实度与压实质量控制)：最大干密度的确定。该条目仅描述了“绘制曲线取峰值”的步骤，未提供曲线拟合（如二次多项式）的具体算法公式，无法在前端实现确定性计算。
 * 2. SUB-04 (2.5 边坡稳定性与防护)：Coulomb 土压力。审计说明指出该公式较复杂且未提供 Ka/Kp 的解析表达式，仅为步骤化模板，不足以支持数值化实现。
 */

export const unsupportedCalculatorIds = [
  "2.2-SUB-02",
  "2.5-SUB-04"
];

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
  // 2.1 土工试验与换算
  {
    id: "2.1-SUB-01",
    title: "含水率 (w) 计算",
    formula: "w (%) = (Mwet − Mdry) / Mdry × 100%",
    inputs: [
      { key: "Mwet", label: "湿样质量", unit: "g", defaultValue: 125, min: 0, step: 0.1, description: "含容器的湿土质量或纯湿土质量" },
      { key: "Mdry", label: "干样质量", unit: "g", defaultValue: 100, min: 0.001, step: 0.1, description: "烘干后的土样质量" }
    ],
    outputs: [
      { key: "w", label: "含水率", unit: "%", precision: 1 }
    ],
    exampleSummary: "输入 Mwet=125g, Mdry=100g，得到含水率 25.0%",
    riskNotice: "烘干温度与时间需符合规程，含有机物土样需注意挥发损失。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      w: ((v.Mwet - v.Mdry) / v.Mdry) * 100
    })
  },
  {
    id: "2.1-SUB-02",
    title: "湿密度与干密度换算",
    formula: "ρd = ρ / (1 + w)",
    inputs: [
      { key: "rho", label: "湿密度", unit: "kg/m³", defaultValue: 1980, min: 0, step: 1, description: "土的湿密度" },
      { key: "w", label: "含水率", unit: "小数", defaultValue: 0.10, min: 0, step: 0.01, description: "土的含水率（小数形式，如10%输入0.1）" }
    ],
    outputs: [
      { key: "rho_d", label: "干密度", unit: "kg/m³", precision: 0 }
    ],
    exampleSummary: "输入 ρ=1980kg/m³, w=0.10，得到干密度 1800kg/m³",
    riskNotice: "确保含水率为小数形式；单位必须统一。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      rho_d: v.rho / (1 + v.w)
    })
  },
  {
    id: "2.1-SUB-03",
    title: "孔隙比与孔隙率换算",
    formula: "e = (Gs * ρw) / ρd − 1; n = e / (1 + e)",
    inputs: [
      { key: "Gs", label: "土粒比重", unit: "", defaultValue: 2.70, min: 2.0, step: 0.01, description: "土粒相对密度" },
      { key: "rho_d", label: "干密度", unit: "kg/m³", defaultValue: 1600, min: 1, step: 1, description: "土的干密度" },
      { key: "rho_w", label: "水的密度", unit: "kg/m³", defaultValue: 1000, min: 990, step: 1, description: "常温下水的密度，通常取1000" }
    ],
    outputs: [
      { key: "e", label: "孔隙比", unit: "", precision: 4 },
      { key: "n", label: "孔隙率", unit: "%", precision: 1 }
    ],
    exampleSummary: "输入 Gs=2.70, ρd=1600kg/m³，得到 e=0.6875, n=40.7%",
    riskNotice: "干密度单位需与水密度单位一致。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const e = (v.Gs * v.rho_w) / v.rho_d - 1;
      return {
        e: e,
        n: (e / (1 + e)) * 100
      };
    }
  },
  {
    id: "2.1-SUB-04",
    title: "饱和度 (Sr) 计算",
    formula: "Sr = (w × Gs) / e",
    inputs: [
      { key: "w", label: "含水率", unit: "小数", defaultValue: 0.20, min: 0, step: 0.01, description: "含水率（小数形式）" },
      { key: "Gs", label: "土粒比重", unit: "", defaultValue: 2.70, min: 2.0, step: 0.01, description: "土粒相对密度" },
      { key: "e", label: "孔隙比", unit: "", defaultValue: 0.6875, min: 0.001, step: 0.0001, description: "土的孔隙比" }
    ],
    outputs: [
      { key: "Sr", label: "饱和度", unit: "%", precision: 1 }
    ],
    exampleSummary: "输入 w=0.20, Gs=2.70, e=0.6875，得到饱和度 78.5%",
    riskNotice: "饱和度 Sr > 100% 或 < 0% 时需触发数据异常警告。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Sr: (v.w * v.Gs / v.e) * 100
    })
  },
  {
    id: "2.1-SUB-05",
    title: "饱和密度与单位重换算",
    formula: "ρsat = ρw(Gs+e)/(1+e); γsat = γw(Gs+e)/(1+e)",
    inputs: [
      { key: "Gs", label: "土粒比重", unit: "", defaultValue: 2.70, min: 2.0, step: 0.01, description: "土粒相对密度" },
      { key: "e", label: "孔隙比", unit: "", defaultValue: 0.6875, min: 0.001, step: 0.0001, description: "土的孔隙比" },
      { key: "rho_w", label: "水的密度", unit: "kg/m³", defaultValue: 1000, min: 990, step: 1, description: "通常取1000" },
      { key: "gamma_w", label: "水的重度", unit: "kN/m³", defaultValue: 9.81, min: 9.8, step: 0.01, description: "通常取9.81" }
    ],
    outputs: [
      { key: "rho_sat", label: "饱和密度", unit: "kg/m³", precision: 0 },
      { key: "gamma_sat", label: "饱和重度", unit: "kN/m³", precision: 1 }
    ],
    exampleSummary: "输入 Gs=2.70, e=0.6875，得到 ρsat=2007kg/m³, γsat=19.7kN/m³",
    riskNotice: "确保孔隙比 e 的准确性。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const factor = (v.Gs + v.e) / (1 + v.e);
      return {
        rho_sat: v.rho_w * factor,
        gamma_sat: v.gamma_w * factor
      };
    }
  },
  {
    id: "2.1-SUB-06",
    title: "施工加水量计算",
    formula: "Wadd_v = Md_v × (w_target − w_initial)",
    inputs: [
      { key: "Md_v", label: "单位体积干土质量", unit: "kg/m³", defaultValue: 1800, min: 0, step: 1, description: "每立方米压实后的干土质量" },
      { key: "w_t", label: "目标含水率", unit: "小数", defaultValue: 0.10, min: 0, step: 0.01, description: "设计或最优含水率" },
      { key: "w_i", label: "初始含水率", unit: "小数", defaultValue: 0.08, min: 0, step: 0.01, description: "天然含水率" }
    ],
    outputs: [
      { key: "Wadd", label: "加水量", unit: "kg/m³", precision: 1 }
    ],
    exampleSummary: "输入 Md_v=1800, w_i=0.08, w_t=0.10，得到加水量 36kg/m³ (36L/m³)",
    riskNotice: "注意含水率需为小数；加水量单位 kg/m³ 等价于 L/m³。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Wadd: v.Md_v * (v.w_t - v.w_i)
    })
  },

  // 2.2 压实度与压实质量控制
  {
    id: "2.2-SUB-01",
    title: "压实度 (最大干密度法)",
    formula: "η = (ρd_field / ρd_max) × 100%",
    inputs: [
      { key: "rho_df", label: "现场干密度", unit: "g/cm³", defaultValue: 1.78, min: 0, step: 0.01, description: "实测现场干密度" },
      { key: "rho_dm", label: "最大干密度", unit: "g/cm³", defaultValue: 1.84, min: 0.001, step: 0.01, description: "标准击实试验得出的最大干密度" }
    ],
    outputs: [
      { key: "eta", label: "压实度", unit: "%", precision: 2 }
    ],
    exampleSummary: "输入 ρd_field=1.78, ρd_max=1.84，得到压实度 96.74%",
    riskNotice: "确保现场密度与最大干密度单位一致。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      eta: (v.rho_df / v.rho_dm) * 100
    })
  },
  {
    id: "2.2-SUB-03",
    title: "湿密度与干密度互算 (压实控制)",
    formula: "ρd = ρ / (1 + w)",
    inputs: [
      { key: "rho", label: "湿密度", unit: "t/m³", defaultValue: 2.05, min: 0, step: 0.001, description: "实测湿密度" },
      { key: "w", label: "含水率", unit: "小数", defaultValue: 0.12, min: 0, step: 0.01, description: "实测含水率" }
    ],
    outputs: [
      { key: "rho_d", label: "干密度", unit: "g/cm³", precision: 3 }
    ],
    exampleSummary: "输入 ρ=2.05t/m³, w=0.12，得到干密度 1.830g/cm³",
    riskNotice: "t/m³ 与 g/cm³ 在数值上相等。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      rho_d: v.rho / (1 + v.w)
    })
  },
  {
    id: "2.2-SUB-04",
    title: "压实方与天然方换算",
    formula: "Vc = Vn × (ρd_n / ρd_c)",
    inputs: [
      { key: "Vn", label: "天然方体积", unit: "m³", defaultValue: 1000, min: 0, step: 1, description: "天然状态下的体积" },
      { key: "rho_dn", label: "天然干密度", unit: "t/m³", defaultValue: 1.60, min: 0, step: 0.01, description: "天然状态下的干密度" },
      { key: "rho_dc", label: "压实干密度", unit: "t/m³", defaultValue: 1.75, min: 0.001, step: 0.01, description: "压实后的设计或实测干密度" }
    ],
    outputs: [
      { key: "Vc", label: "压实方体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "输入 Vn=1000, ρd_n=1.60, ρd_c=1.75，得到压实方 914.29m³",
    riskNotice: "密度单位需保持一致。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Vc: v.Vn * (v.rho_dn / v.rho_dc)
    })
  },
  {
    id: "2.2-SUB-05",
    title: "配合比与目标密度换算",
    formula: "ρd_target = η% × ρd_max; ρ_target = ρd_target(1+w)",
    inputs: [
      { key: "eta", label: "设计压实度", unit: "%", defaultValue: 95, min: 0, step: 0.1, description: "设计要求的压实度" },
      { key: "rho_dm", label: "最大干密度", unit: "t/m³", defaultValue: 1.85, min: 0, step: 0.01, description: "标准最大干密度" },
      { key: "w", label: "含水率", unit: "小数", defaultValue: 0.10, min: 0, step: 0.01, description: "施工含水率" }
    ],
    outputs: [
      { key: "rho_dt", label: "目标干密度", unit: "t/m³", precision: 4 },
      { key: "rho_t", label: "目标湿密度", unit: "t/m³", precision: 3 }
    ],
    exampleSummary: "输入 ρd_max=1.85, η=95%, w=0.10，得到目标干密度 1.7575, 目标湿密度 1.933",
    riskNotice: "施工时应以此湿密度作为现场控制参考。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const rdt = (v.eta / 100) * v.rho_dm;
      return {
        rho_dt: rdt,
        rho_t: rdt * (1 + v.w)
      };
    }
  },
  {
    id: "2.2-SUB-06",
    title: "现场干密度 (环刀法)",
    formula: "ρd = m_dry / V_ring; w = (m_wet-m_dry)/m_dry",
    inputs: [
      { key: "V_ring", label: "环刀体积", unit: "cm³", defaultValue: 100, min: 0.001, step: 0.1, description: "环刀的有效容积" },
      { key: "m_wet", label: "湿土质量", unit: "g", defaultValue: 210, min: 0, step: 0.1, description: "环刀内湿土的质量" },
      { key: "m_dry", label: "干土质量", unit: "g", defaultValue: 185, min: 0.001, step: 0.1, description: "烘干后的土质量" }
    ],
    outputs: [
      { key: "w", label: "含水率", unit: "%", precision: 2 },
      { key: "rho_d", label: "干密度", unit: "g/cm³", precision: 2 }
    ],
    exampleSummary: "输入 V_ring=100, m_wet=210, m_dry=185，得到 w=13.51%, ρd=1.85g/cm³",
    riskNotice: "注意扣除环刀自身质量，此处输入应为纯土质量。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      w: ((v.m_wet - v.m_dry) / v.m_dry) * 100,
      rho_d: v.m_dry / v.V_ring
    })
  },

  // 2.3 土石方计算与测量计量
  {
    id: "2.3-SUB-01",
    title: "断面法土方 (梯形)",
    formula: "V_i = (A_i + A_{i+1}) / 2 × L_i",
    inputs: [
      { key: "A1", label: "断面1面积", unit: "m²", defaultValue: 100, min: 0, step: 0.1, description: "起始断面面积" },
      { key: "A2", label: "断面2面积", unit: "m²", defaultValue: 120, min: 0, step: 0.1, description: "终止断面面积" },
      { key: "L", label: "断面间距", unit: "m", defaultValue: 20, min: 0, step: 0.1, description: "两个断面之间的水平距离" }
    ],
    outputs: [
      { key: "V", label: "土方体积", unit: "m³", precision: 0 }
    ],
    exampleSummary: "输入 A1=100, A2=120, L=20，得到体积 2200m³",
    riskNotice: "断面法要求间距足够密，地形剧烈变化时结果偏差较大。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      V: ((v.A1 + v.A2) / 2) * v.L
    })
  },
  {
    id: "2.3-SUB-02",
    title: "辛普森规则体积计算",
    formula: "V = (h/3)[A_0 + A_2 + 4A_1]",
    inputs: [
      { key: "h", label: "断面间距", unit: "m", defaultValue: 10, min: 0, step: 0.1, description: "相邻断面间的距离" },
      { key: "A0", label: "断面0面积", unit: "m²", defaultValue: 80, min: 0, step: 0.1, description: "起始断面面积" },
      { key: "A1", label: "中间断面面积", unit: "m²", defaultValue: 100, min: 0, step: 0.1, description: "中间断面面积" },
      { key: "A2", label: "终止断面面积", unit: "m²", defaultValue: 120, min: 0, step: 0.1, description: "终止断面面积" }
    ],
    outputs: [
      { key: "V", label: "土方体积", unit: "m³", precision: 1 }
    ],
    exampleSummary: "输入 h=10, A0=80, A1=100, A2=120，得到体积 2000.0m³",
    riskNotice: "辛普森法要求区间数必须为偶数且间距相等。此处实现为3个断面的标准形式。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      V: (v.h / 3) * (v.A0 + v.A2 + 4 * v.A1)
    })
  },
  {
    id: "2.3-SUB-04",
    title: "土石方体积转换",
    formula: "V_b = V_c / Kr; V_l = V_b × Fs",
    inputs: [
      { key: "Vc", label: "压实方体积", unit: "m³", defaultValue: 900, min: 0, step: 1, description: "压实状态下的体积" },
      { key: "Kr", label: "压实系数", unit: "", defaultValue: 0.95, min: 0.001, step: 0.01, description: "压实状态与天然状态的比值" },
      { key: "Fs", label: "松散系数", unit: "", defaultValue: 1.20, min: 0.001, step: 0.01, description: "松散状态与天然状态的比值" }
    ],
    outputs: [
      { key: "Vb", label: "天然方体积", unit: "m³", precision: 2 },
      { key: "Vl", label: "松散方体积", unit: "m³", precision: 2 }
    ],
    exampleSummary: "输入 Vc=900, Kr=0.95, Fs=1.20，得到 Vb=947.37, Vl=1136.84",
    riskNotice: "注意不同材料的系数差异较大，需根据实际土质调整。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const vb = v.Vc / v.Kr;
      return {
        Vb: vb,
        Vl: vb * v.Fs
      };
    }
  },
  {
    id: "2.3-SUB-05",
    title: "测量高程计算",
    formula: "HI = BM_elev + BS; E_point = HI - FS",
    inputs: [
      { key: "BM", label: "水准点高程", unit: "m", defaultValue: 100.0, min: -9999, step: 0.001, description: "已知点高程" },
      { key: "BS", label: "后视读数", unit: "m", defaultValue: 1.350, min: 0, step: 0.001, description: "水准仪在已知点上的读数" },
      { key: "FS", label: "前视读数", unit: "m", defaultValue: 2.842, min: 0, step: 0.001, description: "水准仪在待求点上的读数" }
    ],
    outputs: [
      { key: "HI", label: "视线高程", unit: "m", precision: 3 },
      { key: "E", label: "待求点高程", unit: "m", precision: 3 }
    ],
    exampleSummary: "输入 BM=100.0, BS=1.350, FS=2.842，得到 HI=101.350, E=98.508",
    riskNotice: "测量过程中需注意气泡居中，多次测量取均值以减小误差。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const hi = v.BM + v.BS;
      return {
        HI: hi,
        E: hi - v.FS
      };
    }
  },

  // 2.4 路基与地基处理
  {
    id: "2.4-SUB-01",
    title: "CBR 计算",
    formula: "CBR(%) = (P_test / P_ref) × 100%",
    inputs: [
      { key: "Pt", label: "实测压力", unit: "kN", defaultValue: 12.00, min: 0, step: 0.01, description: "试验实测单位压力" },
      { key: "Pr", label: "标准压力值", unit: "kN", defaultValue: 13.24, min: 0.001, step: 0.01, description: "标准碎石在相同贯入度下的压力" }
    ],
    outputs: [
      { key: "CBR", label: "CBR值", unit: "%", precision: 1 }
    ],
    exampleSummary: "输入 P_test=12.00, P_ref=13.24，得到 CBR=90.6%",
    riskNotice: "通常取贯入度为2.5mm时的值，若5mm较大则需重做。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      CBR: (v.Pt / v.Pr) * 100
    })
  },
  {
    id: "2.4-SUB-02",
    title: "CBR与模量换算",
    formula: "Mr ≈ k1 × CBR",
    inputs: [
      { key: "CBR", label: "CBR值", unit: "%", defaultValue: 8, min: 0, step: 0.1, description: "加州承载比" },
      { key: "k1", label: "经验系数", unit: "", defaultValue: 10, min: 0, step: 0.1, description: "换算系数，通常在5-15之间" }
    ],
    outputs: [
      { key: "Mr", label: "回弹模量", unit: "MPa", precision: 1 }
    ],
    exampleSummary: "输入 CBR=8, k1=10，得到 80MPa",
    riskNotice: "该公式为经验公式，仅供参考，重大工程需实测。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Mr: v.k1 * v.CBR
    })
  },
  {
    id: "2.4-SUB-03",
    title: "一维固结沉降",
    formula: "S = (Cc/(1+e0))H log10((σ'0+Δσ)/σ'0)",
    inputs: [
      { key: "H", label: "土层厚度", unit: "m", defaultValue: 2, min: 0, step: 0.1, description: "压缩层厚度" },
      { key: "e0", label: "初始孔隙比", unit: "", defaultValue: 0.8, min: 0.001, step: 0.01, description: "原状土初始孔隙比" },
      { key: "Cc", label: "压缩指数", unit: "", defaultValue: 0.25, min: 0, step: 0.01, description: "土的压缩性指标" },
      { key: "s0", label: "初始有效应力", unit: "kPa", defaultValue: 100, min: 0.001, step: 1, description: "自重有效应力" },
      { key: "ds", label: "附加应力", unit: "kPa", defaultValue: 50, min: 0, step: 1, description: "荷载引起的应力增量" }
    ],
    outputs: [
      { key: "S", label: "最终沉降量", unit: "mm", precision: 1 }
    ],
    exampleSummary: "输入 H=2, e0=0.8, Cc=0.25, σ'=100, Δσ=50，得到沉降 48.9mm",
    riskNotice: "仅适用于正常固结土的一维压缩情形。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      S: (v.Cc / (1 + v.e0)) * v.H * Math.log10((v.s0 + v.ds) / v.s0) * 1000
    })
  },
  {
    id: "2.4-SUB-04",
    title: "即时弹性沉降",
    formula: "Se ≈ q × H_e / E_s × (1 - ν^2)",
    inputs: [
      { key: "q", label: "表面压力", unit: "kPa", defaultValue: 200, min: 0, step: 1, description: "基础底面压力" },
      { key: "He", label: "影响深度", unit: "m", defaultValue: 1.0, min: 0, step: 0.1, description: "弹性变形影响深度" },
      { key: "Es", label: "弹性模量", unit: "MPa", defaultValue: 50, min: 0.001, step: 1, description: "土体的压缩模量或弹性模量" },
      { key: "nu", label: "泊松比", unit: "", defaultValue: 0.3, min: 0, max: 0.5, step: 0.01, description: "土的泊松比" }
    ],
    outputs: [
      { key: "Se", label: "即时沉降", unit: "mm", precision: 2 }
    ],
    exampleSummary: "输入 q=200, H_e=1.0, E_s=50, ν=0.3，得到沉降 3.64mm",
    riskNotice: "注意模量单位 MPa 需换算为 kPa 进行计算。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Se: (v.q * v.He / (v.Es * 1000)) * (1 - v.nu * v.nu) * 1000
    })
  },
  {
    id: "2.4-SUB-05",
    title: "浅基础极限承载力 (辅助测算)",
    formula: "q_ult = cNc + qNq + 0.5γBNγ",
    inputs: [
      { key: "c", label: "黏聚力", unit: "kPa", defaultValue: 25, min: 0, step: 0.1, description: "土的黏聚力" },
      { key: "gamma", label: "土重度", unit: "kN/m³", defaultValue: 18, min: 0, step: 0.1, description: "基础底面以下土的重度" },
      { key: "B", label: "基础宽度", unit: "m", defaultValue: 1.5, min: 0, step: 0.1, description: "基础的最小尺寸" },
      { key: "Df", label: "埋置深度", unit: "m", defaultValue: 1, min: 0, step: 0.1, description: "基础埋深" },
      { key: "q_sur", label: "超载", unit: "kPa", defaultValue: 18, min: 0, step: 0.1, description: "基底水平面处的有效覆盖压力 (通常为 γ*Df)" },
      { key: "Nc", label: "承载力因子 Nc", unit: "", defaultValue: 5.14, min: 0, step: 0.01, description: "由摩擦角 φ 决定的因子" },
      { key: "Nq", label: "承载力因子 Nq", unit: "", defaultValue: 1.0, min: 0, step: 0.01, description: "由摩擦角 φ 决定的因子" },
      { key: "Ng", label: "承载力因子 Nγ", unit: "", defaultValue: 0.0, min: 0, step: 0.01, description: "由摩擦角 φ 决定的因子" },
      { key: "FS", label: "安全系数", unit: "", defaultValue: 3, min: 1, step: 0.1, description: "通常取2-3" }
    ],
    outputs: [
      { key: "q_ult", label: "极限承载力", unit: "kPa", precision: 1 },
      { key: "q_allow", label: "允许承载力", unit: "kPa", precision: 1 }
    ],
    exampleSummary: "输入 c=25, φ=0 (Nc=5.14, Nq=1, Nγ=0), Df=1, γ=18, B=1.5，得到 q_allow=48.8kPa (FS=3)",
    riskNotice: "需专业人员根据内摩擦角 φ 自行查表或计算承载力因子。本工具不提供因子的自动生成。",
    requiresProfessionalReview: true,
    calculate: (v) => {
      const q_ult = v.c * v.Nc + v.q_sur * v.Nq + 0.5 * v.gamma * v.B * v.Ng;
      return {
        q_ult: q_ult,
        q_allow: q_ult / v.FS
      };
    }
  },

  // 2.5 边坡稳定性与防护
  {
    id: "2.5-SUB-01",
    title: "坡率/坡度/坡角换算",
    formula: "坡比=1:m; 坡度=tanα; 坡角=arctan(Δh/L_h)",
    inputs: [
      { key: "dh", label: "垂直高度 (Δh)", unit: "m", defaultValue: 10, min: 0, step: 0.1, description: "坡的垂直落差" },
      { key: "Lh", label: "水平长度 (L_h)", unit: "m", defaultValue: 20, min: 0.001, step: 0.1, description: "坡的水平投影长度" }
    ],
    outputs: [
      { key: "m", label: "坡比 (1:m)", unit: "", precision: 2 },
      { key: "slope", label: "坡度", unit: "%", precision: 1 },
      { key: "angle", label: "坡角", unit: "°", precision: 3 }
    ],
    exampleSummary: "输入 Δh=10, L_h=20，得到 1:2, 50%, 26.565°",
    riskNotice: "坡度定义为垂直高度与水平长度之比。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      m: v.Lh / v.dh,
      slope: (v.dh / v.Lh) * 100,
      angle: Math.atan(v.dh / v.Lh) * 180 / Math.PI
    })
  },
  {
    id: "2.5-SUB-02",
    title: "无限坡安全系数",
    formula: "Fs = [c' + (γz cos²α - u) tanφ'] / (γz sinα cosα)",
    inputs: [
      { key: "c", label: "有效黏聚力 c'", unit: "kPa", defaultValue: 10, min: 0, step: 0.1, description: "土体的有效黏聚力" },
      { key: "phi", label: "有效摩擦角 φ'", unit: "°", defaultValue: 30, min: 0, max: 90, step: 0.1, description: "土体的有效内摩擦角" },
      { key: "gamma", label: "土重度 γ", unit: "kN/m³", defaultValue: 18, min: 0, step: 0.1, description: "土体的天然重度" },
      { key: "z", label: "滑动面深度 z", unit: "m", defaultValue: 2, min: 0.001, step: 0.1, description: "滑动面距离坡面的垂直深度" },
      { key: "alpha", label: "坡角 α", unit: "°", defaultValue: 26.6, min: 0, max: 90, step: 0.1, description: "坡面与水平面的夹角" },
      { key: "u", label: "孔隙水压力 u", unit: "kPa", defaultValue: 4.38, min: 0, step: 0.01, description: "滑动面处的孔隙水压力" }
    ],
    outputs: [
      { key: "Fs", label: "安全系数", unit: "", precision: 2 }
    ],
    exampleSummary: "输入 c'=10, φ'=30°, γ=18, z=2, α=26.6°, u=4.38，得到 Fs=1.53",
    riskNotice: "本公式适用于滑动面与坡面平行的无限长边坡。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const alphaRad = v.alpha * Math.PI / 180;
      const phiRad = v.phi * Math.PI / 180;
      const cosA = Math.cos(alphaRad);
      const sinA = Math.sin(alphaRad);
      const numerator = v.c + (v.gamma * v.z * cosA * cosA - v.u) * Math.tan(phiRad);
      const denominator = v.gamma * v.z * sinA * cosA;
      return { Fs: numerator / denominator };
    }
  },
  {
    id: "2.5-SUB-03",
    title: "Rankine 主动土压力",
    formula: "Ka = tan²(45-φ/2); σ_h = Kaγz - 2c√Ka",
    inputs: [
      { key: "phi", label: "内摩擦角 φ", unit: "°", defaultValue: 30, min: 0, max: 90, step: 0.1, description: "土的内摩擦角" },
      { key: "gamma", label: "土重度 γ", unit: "kN/m³", defaultValue: 18, min: 0, step: 0.1, description: "土的天然重度" },
      { key: "c", label: "黏聚力 c", unit: "kPa", defaultValue: 5, min: 0, step: 0.1, description: "土的黏聚力" },
      { key: "z", label: "计算深度 z", unit: "m", defaultValue: 3, min: 0, step: 0.1, description: "距墙顶的深度" }
    ],
    outputs: [
      { key: "Ka", label: "主动土压力系数", unit: "", precision: 4 },
      { key: "sigma_h", label: "水平主动土压力", unit: "kPa", precision: 2 }
    ],
    exampleSummary: "输入 φ=30°, γ=18, z=3, c'=5，得到 Ka=0.3333, σ_h=12.23kPa",
    riskNotice: "当 σ_h 计算值为负时，表示存在拉应力区，实际计算中通常取为0。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const ka = Math.pow(Math.tan((45 - v.phi / 2) * Math.PI / 180), 2);
      const sh = ka * v.gamma * v.z - 2 * v.c * Math.sqrt(ka);
      return {
        Ka: ka,
        sigma_h: Math.max(0, sh)
      };
    }
  },
  {
    id: "2.5-SUB-05",
    title: "土压力合力 (Rankine)",
    formula: "P = 0.5KaγH² - 2c'√KaH",
    inputs: [
      { key: "H", label: "墙高 H", unit: "m", defaultValue: 4, min: 0, step: 0.1, description: "挡土墙的总高度" },
      { key: "gamma", label: "土重度 γ", unit: "kN/m³", defaultValue: 18, min: 0, step: 0.1, description: "墙后填土重度" },
      { key: "phi", label: "内摩擦角 φ", unit: "°", defaultValue: 30, min: 0, max: 90, step: 0.1, description: "墙后填土内摩擦角" },
      { key: "c", label: "黏聚力 c'", unit: "kPa", defaultValue: 5, min: 0, step: 0.1, description: "墙后填土黏聚力" }
    ],
    outputs: [
      { key: "Ka", label: "主动土压力系数", unit: "", precision: 4 },
      { key: "P", label: "主动土压力合力", unit: "kN/m", precision: 2 }
    ],
    exampleSummary: "输入 H=4, γ=18, φ=30°, c'=5，得到 P=24.91kN/m",
    riskNotice: "未考虑拉应力裂缝对合力作用点的影响。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const ka = Math.pow(Math.tan((45 - v.phi / 2) * Math.PI / 180), 2);
      const p = 0.5 * ka * v.gamma * v.H * v.H - 2 * v.c * Math.sqrt(ka) * v.H;
      return {
        Ka: ka,
        P: Math.max(0, p)
      };
    }
  },

  // 2.6 排水与防渗
  {
    id: "2.6-SUB-01",
    title: "渗透系数 (恒定水头)",
    formula: "k = Q / (A · (h/L))",
    inputs: [
      { key: "Q", label: "流量", unit: "m³/s", defaultValue: 1.96e-6, min: 0, step: 1e-8, description: "单位时间内流出的水量" },
      { key: "A", label: "试样截面积", unit: "m²", defaultValue: 0.00196, min: 0.00001, step: 0.00001, description: "土样的横截面积" },
      { key: "h", label: "水头差", unit: "m", defaultValue: 0.05, min: 0.001, step: 0.001, description: "恒定水头高度差" },
      { key: "L", label: "试样长度", unit: "m", defaultValue: 0.10, min: 0.001, step: 0.001, description: "渗透路径长度" }
    ],
    outputs: [
      { key: "k", label: "渗透系数", unit: "m/s", precision: 6 }
    ],
    exampleSummary: "输入 Q=1.96e-6, A=0.00196, h=0.05, L=0.10，得到 0.0020m/s",
    riskNotice: "适用于渗透性较强的土（如砂土）。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      k: v.Q / (v.A * (v.h / v.L))
    })
  },
  {
    id: "2.6-SUB-02",
    title: "渗透系数 (变水头)",
    formula: "k = (aL / At) ln(h1/h2)",
    inputs: [
      { key: "a", label: "进水管面积", unit: "m²", defaultValue: 0.0000785, min: 1e-7, step: 1e-7, description: "变水头管的内截面积" },
      { key: "A", label: "试样截面积", unit: "m²", defaultValue: 0.00196, min: 1e-6, step: 1e-5, description: "土样的横截面积" },
      { key: "L", label: "试样长度", unit: "m", defaultValue: 0.10, min: 0.001, step: 0.001, description: "渗透路径长度" },
      { key: "t", label: "时间间隔", unit: "s", defaultValue: 1800, min: 1, step: 1, description: "观测水头下降的时间" },
      { key: "h1", label: "初始水头", unit: "m", defaultValue: 0.3, min: 0.001, step: 0.001, description: "起始时刻的水头高度" },
      { key: "h2", label: "终止水头", unit: "m", defaultValue: 0.1, min: 0.001, step: 0.001, description: "结束时刻的水头高度" }
    ],
    outputs: [
      { key: "k", label: "渗透系数", unit: "m/s", precision: 8 }
    ],
    exampleSummary: "输入 a=0.0000785, A=0.00196, L=0.1, t=1800, h1=0.3, h2=0.1，得到 2.44e-6m/s",
    riskNotice: "适用于渗透性较弱的土（如粘性土）。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      k: (v.a * v.L / (v.A * v.t)) * Math.log(v.h1 / v.h2)
    })
  },
  {
    id: "2.6-SUB-03",
    title: "排水沟流量 (曼宁公式)",
    formula: "Q = (1/n) A R^(2/3) S^(1/2)",
    inputs: [
      { key: "n", label: "粗糙系数", unit: "", defaultValue: 0.025, min: 0.001, step: 0.001, description: "渠道表面的粗糙度" },
      { key: "A", label: "过水断面面积", unit: "m²", defaultValue: 0.4, min: 0.001, step: 0.01, description: "水的横截面积" },
      { key: "P", label: "湿周", unit: "m", defaultValue: 1.8, min: 0.001, step: 0.01, description: "水与渠道接触的周长" },
      { key: "S", label: "水力坡度", unit: "", defaultValue: 0.01, min: 0.0001, step: 0.0001, description: "渠道的纵向坡度" }
    ],
    outputs: [
      { key: "R", label: "水力半径", unit: "m", precision: 3 },
      { key: "Q", label: "流量", unit: "m³/s", precision: 3 }
    ],
    exampleSummary: "输入 b=1, y=0.4 (A=0.4, P=1.8), n=0.025, S=0.01，得到 0.587m³/s",
    riskNotice: "曼宁公式适用于明渠均匀流。",
    requiresProfessionalReview: false,
    calculate: (v) => {
      const R = v.A / v.P;
      return {
        R: R,
        Q: (1 / v.n) * v.A * Math.pow(R, 2 / 3) * Math.sqrt(v.S)
      };
    }
  },

  // 2.7 材料配比与含水率调整
  {
    id: "2.7-SUB-01",
    title: "施工加水量 (干密度基)",
    formula: "W_add = ρ_d × (w_t - w_i)",
    inputs: [
      { key: "rho_d", label: "干密度", unit: "kg/m³", defaultValue: 1800, min: 0, step: 1, description: "设计干密度" },
      { key: "wt", label: "目标含水率", unit: "小数", defaultValue: 0.12, min: 0, step: 0.01, description: "最优含水率" },
      { key: "wi", label: "初始含水率", unit: "小数", defaultValue: 0.08, min: 0, step: 0.01, description: "天然含水率" }
    ],
    outputs: [
      { key: "Wadd", label: "加水量", unit: "L/m³", precision: 1 }
    ],
    exampleSummary: "输入 ρ_d=1800, w_t=0.12, w_i=0.08，得到 72L/m³",
    riskNotice: "确保含水率为小数形式。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Wadd: v.rho_d * (v.wt - v.wi)
    })
  },
  {
    id: "2.7-SUB-02",
    title: "试验室转施工配合比",
    formula: "M_c = c_pct × ρ_d; W_add = ρ_d(w_lab-w_i)",
    inputs: [
      { key: "rho_d", label: "干密度", unit: "kg/m³", defaultValue: 1900, min: 0, step: 1, description: "混合料干密度" },
      { key: "cpct", label: "水泥剂量", unit: "小数", defaultValue: 0.06, min: 0, step: 0.01, description: "水泥占干土质量的比例" },
      { key: "wlab", label: "试验室含水率", unit: "小数", defaultValue: 0.12, min: 0, step: 0.01, description: "试验室确定的最优含水率" },
      { key: "wi", label: "原材料含水率", unit: "小数", defaultValue: 0.07, min: 0, step: 0.01, description: "现场原材料含水率" }
    ],
    outputs: [
      { key: "Mc", label: "水泥用量", unit: "kg/m³", precision: 1 },
      { key: "Wadd", label: "施工加水量", unit: "L/m³", precision: 1 }
    ],
    exampleSummary: "输入 ρ_d=1900, c_pct=0.06, w_lab=0.12, w_i=0.07，得到 M_c=114kg, W_add=95L",
    riskNotice: "水泥剂量通常指相对于干土或混合料干质量的百分比。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Mc: v.cpct * v.rho_d,
      Wadd: v.rho_d * (v.wlab - v.wi)
    })
  },
  {
    id: "2.7-SUB-03",
    title: "水泥用量袋数换算",
    formula: "N_bags = (c_pct × ρ_d) / Bag_w",
    inputs: [
      { key: "rho_d", label: "干密度", unit: "kg/m³", defaultValue: 1900, min: 0, step: 1, description: "混合料干密度" },
      { key: "cpct", label: "水泥剂量", unit: "小数", defaultValue: 0.06, min: 0, step: 0.01, description: "水泥占比" },
      { key: "bagw", label: "单袋质量", unit: "kg/袋", defaultValue: 50, min: 1, step: 1, description: "每袋水泥的重量" }
    ],
    outputs: [
      { key: "Nbags", label: "袋数", unit: "袋/m³", precision: 2 }
    ],
    exampleSummary: "输入 ρ_d=1900, c_pct=0.06, Bag_w=50，得到 2.28袋/m³",
    riskNotice: "施工中需考虑损耗系数。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Nbags: (v.cpct * v.rho_d) / v.bagw
    })
  },
  {
    id: "2.7-SUB-04",
    title: "含水率修正 (吸放水)",
    formula: "W_corrected = W_basic − Σ(M_i × α_i)",
    inputs: [
      { key: "Wb", label: "基本加水量", unit: "L/m³", defaultValue: 95, min: 0, step: 1, description: "未修正前的理论加水量" },
      { key: "Mc", label: "添加剂质量", unit: "kg/m³", defaultValue: 114, min: 0, step: 0.1, description: "添加的材料质量（如水泥）" },
      { key: "alpha", label: "影响系数", unit: "", defaultValue: -0.25, min: -10, step: 0.01, description: "材料的吸水或带水系数" }
    ],
    outputs: [
      { key: "Wc", label: "修正后加水量", unit: "L/m³", precision: 1 }
    ],
    exampleSummary: "输入 W_basic=95, M_c=114, α_c=-0.25，得到 125L/m³",
    riskNotice: "负系数表示吸水（需增加加水量），正系数表示带水（需减少加水量）。",
    requiresProfessionalReview: false,
    calculate: (v) => ({
      Wc: v.Wb - (v.Mc * v.alpha)
    })
  }
];
