/**
 * 公路路线桥涵隧道专业计算器规格模块
 *
 * 包含路线工程、路基基层、路面工程、桥涵隧道及交通工程等27项自动计算规格。
 * 所有计算逻辑严格依据《公路路线桥涵隧道分卷 - 自动计算审计报告》提取。
 */

export const unsupportedCalculatorIds: string[] = [];

export const categoryCalculatorSpecs = [
  {
    id: "HW-RT-001",
    title: "平曲线内侧加宽值计算",
    formula: "E = N * (L^2 / 2R) + Δ",
    inputs: [
      {
        key: "L",
        label: "货车轴距",
        unit: "m",
        defaultValue: 10,
        min: 0,
        step: 0.1,
        description: "汽车前后轴距",
      },
      {
        key: "R",
        label: "圆曲线半径",
        unit: "m",
        defaultValue: 200,
        min: 0,
        step: 1,
        description: "圆曲线半径",
      },
      {
        key: "N",
        label: "车道数",
        unit: "",
        defaultValue: 2,
        min: 1,
        step: 1,
        description: "车道数",
      },
      {
        key: "delta",
        label: "附加加宽值",
        unit: "m",
        defaultValue: 0.2,
        min: 0,
        step: 0.01,
        description: "考虑摆动等因素的附加加宽",
      },
    ],
    outputs: [
      {
        key: "E",
        label: "加宽值",
        unit: "m",
        precision: 2,
      },
    ],
    exampleSummary: "当轴距L=10m, 半径R=200m, 2车道, 附加加宽0.2m时，计算得到加宽值E=0.7m。",
    riskNotice: "平曲线加宽在值小于0.25m时可不设；需结合具体车型及规范要求确定。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { L, R, N, delta } = values; if (R === 0) return { E: 0 }; const E = N * (Math.pow(L, 2) / (2 * R)) + delta; return { E };
    },
  },
  {
    id: "HW-RT-002",
    title: "缓和曲线最小长度计算",
    formula: "Ls = 0.036 * V^3 / (R * α)",
    inputs: [
      {
        key: "V",
        label: "设计速度",
        unit: "km/h",
        defaultValue: 80,
        min: 0,
        step: 1,
        description: "公路设计速度",
      },
      {
        key: "R",
        label: "圆曲线半径",
        unit: "m",
        defaultValue: 400,
        min: 0,
        step: 1,
        description: "圆曲线半径",
      },
      {
        key: "alpha",
        label: "离心加速度变化率",
        unit: "m/s³",
        defaultValue: 0.6,
        min: 0.1,
        step: 0.1,
        description: "通常取0.5-0.6",
      },
    ],
    outputs: [
      {
        key: "Ls",
        label: "缓和曲线最小长度",
        unit: "m",
        precision: 2,
      },
    ],
    exampleSummary: "设计速度80km/h, 半径400m, α=0.6时，最小长度Ls=76.8m。",
    riskNotice: "缓和曲线需同时满足超高渐变率要求，并符合规范对最短长度的限制。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { V, R, alpha } = values; if (R === 0 || alpha === 0) return { Ls: 0 }; const Ls = 0.036 * Math.pow(V, 3) / (R * alpha); return { Ls };
    },
  },
  {
    id: "HW-RT-003",
    title: "竖曲线任一点高程计算",
    formula: "H = HBVC ± i1 * x ± x^2 / 2R",
    inputs: [
      {
        key: "HBVC",
        label: "竖曲线起点高程",
        unit: "m",
        defaultValue: 100,
        min: -1000,
        step: 0.001,
      },
      {
        key: "i1",
        label: "进坡坡度",
        unit: "%",
        defaultValue: 3,
        min: -20,
        step: 0.01,
      },
      {
        key: "R",
        label: "竖曲线半径",
        unit: "m",
        defaultValue: 5000,
        min: 0,
        step: 1,
      },
      {
        key: "x",
        label: "距起点水平距离",
        unit: "m",
        defaultValue: 50,
        min: 0,
        step: 0.1,
      },
      {
        key: "isConvex",
        label: "是否为凸曲线",
        unit: "布尔",
        defaultValue: 1,
        min: 0,
        step: 1,
        description: "1为凸曲线，0为凹曲线",
      },
    ],
    outputs: [
      {
        key: "H",
        label: "计算点高程",
        unit: "m",
        precision: 3,
      },
    ],
    exampleSummary: "凸曲线, HBVC=100m, i1=3%, R=5000m, x=50m时，高程H=101.25m。",
    riskNotice: "需根据凸凹性质正确选择偏移距符号；注意坡度正负号的定义。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { HBVC, i1, R, x, isConvex } = values; if (R === 0) return { H: HBVC }; const y = Math.pow(x, 2) / (2 * R); const H = HBVC + (i1 / 100) * x + (isConvex ? -y : y); return { H };
    },
  },
  {
    id: "HW-SG-001",
    title: "现场压实度(灌砂法)计算",
    formula: "K = [ρ / (1 + 0.01w)] / ρdmax",
    inputs: [
      {
        key: "rho",
        label: "湿密度",
        unit: "g/cm³",
        defaultValue: 2.15,
        min: 0,
        step: 0.01,
      },
      {
        key: "w",
        label: "含水率",
        unit: "%",
        defaultValue: 12.5,
        min: 0,
        step: 0.1,
      },
      {
        key: "rho_dmax",
        label: "最大干密度",
        unit: "g/cm³",
        defaultValue: 1.98,
        min: 0.1,
        step: 0.01,
      },
    ],
    outputs: [
      {
        key: "K",
        label: "压实度",
        unit: "%",
        precision: 1,
      },
    ],
    exampleSummary: "湿密度2.15g/cm³, 含水率12.5%, 最大干密度1.98g/cm³时，压实度K=96.5%。",
    riskNotice: "压实度计算依赖于含水率的准确性；需确保灌砂筒标定准确。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { rho, w, rho_dmax } = values; if (rho_dmax === 0) return { K: 0 }; const rho_d = rho / (1 + 0.01 * w); const K = (rho_d / rho_dmax) * 100; return { K };
    },
  },
  {
    id: "HW-SG-002",
    title: "土石方体积换算系数计算",
    formula: "Vc = Vn * Kc",
    inputs: [
      {
        key: "Vn",
        label: "天然状态体积",
        unit: "m³",
        defaultValue: 1000,
        min: 0,
        step: 1,
      },
      {
        key: "Kc",
        label: "换算系数",
        unit: "",
        defaultValue: 0.92,
        min: 0,
        step: 0.01,
        description: "如压实系数等",
      },
    ],
    outputs: [
      {
        key: "Vc",
        label: "换算后体积",
        unit: "m³",
        precision: 2,
      },
    ],
    exampleSummary: "天然体积1000m³, 系数0.92时，换算体积为920m³。",
    riskNotice: "换算系数需根据土石类别及压实要求严格选取。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { Vn, Kc } = values; const Vc = Vn * Kc; return { Vc };
    },
  },
  {
    id: "HW-SG-003",
    title: "加州承载比(CBR)计算",
    formula: "CBR = p / ps * 100%",
    inputs: [
      {
        key: "p",
        label: "单位压力",
        unit: "MPa",
        defaultValue: 0.56,
        min: 0,
        step: 0.01,
      },
      {
        key: "ps",
        label: "标准压力",
        unit: "MPa",
        defaultValue: 7.0,
        min: 0.1,
        step: 0.1,
        description: "2.5mm贯入量时通常为7.0MPa",
      },
    ],
    outputs: [
      {
        key: "CBR",
        label: "CBR值",
        unit: "%",
        precision: 1,
      },
    ],
    exampleSummary: "单位压力0.56MPa, 标准压力7.0MPa时，CBR=8.0%。",
    riskNotice: "CBR值需对比2.5mm与5.0mm贯入量的结果，通常取最大值。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { p, ps } = values; if (ps === 0) return { CBR: 0 }; const CBR = (p / ps) * 100; return { CBR };
    },
  },
  {
    id: "HW-BS-001",
    title: "水稳碎石施工配合比换算",
    formula: "Mwi = Mdi * (1 + wi)",
    inputs: [
      {
        key: "Mdi",
        label: "材料干重",
        unit: "kg",
        defaultValue: 874,
        min: 0,
        step: 0.1,
      },
      {
        key: "wi",
        label: "材料含水率",
        unit: "%",
        defaultValue: 1,
        min: 0,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "Mwi",
        label: "材料湿重",
        unit: "kg",
        precision: 2,
      },
    ],
    exampleSummary: "干重874kg, 含水1%时，湿重为882.74kg。",
    riskNotice: "配合比换算必须以试验室试配为准，系统仅提供辅助计算。",
    requiresProfessionalReview: true,
    calculate: (values: any) => {
      const { Mdi, wi } = values; const Mwi = Mdi * (1 + 0.01 * wi); return { Mwi };
    },
  },
  {
    id: "HW-BS-002",
    title: "7d无侧限抗压强度代表值",
    formula: "Rd = R_bar - Za * S",
    inputs: [
      {
        key: "R_bar",
        label: "强度平均值",
        unit: "MPa",
        defaultValue: 4.5,
        min: 0,
        step: 0.01,
      },
      {
        key: "Za",
        label: "保证率系数",
        unit: "",
        defaultValue: 1.645,
        min: 0,
        step: 0.001,
        description: "95%保证率通常取1.645",
      },
      {
        key: "S",
        label: "标准差",
        unit: "MPa",
        defaultValue: 0.4,
        min: 0,
        step: 0.01,
      },
    ],
    outputs: [
      {
        key: "Rd",
        label: "强度代表值",
        unit: "MPa",
        precision: 2,
      },
    ],
    exampleSummary: "平均值4.5MPa, 标准差0.4, Za=1.645时，代表值Rd=3.84MPa。",
    riskNotice: "代表值计算需满足样本数量要求；Za选取需符合等级规范。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { R_bar, Za, S } = values; const Rd = R_bar - Za * S; return { Rd };
    },
  },
  {
    id: "HW-BS-003",
    title: "松铺厚度计算",
    formula: "Hs = Hc * K",
    inputs: [
      {
        key: "Hc",
        label: "设计压实厚度",
        unit: "cm",
        defaultValue: 20,
        min: 0,
        step: 0.1,
      },
      {
        key: "K",
        label: "松铺系数",
        unit: "",
        defaultValue: 1.25,
        min: 1,
        step: 0.01,
      },
    ],
    outputs: [
      {
        key: "Hs",
        label: "松铺厚度",
        unit: "cm",
        precision: 1,
      },
    ],
    exampleSummary: "设计厚度20cm, 松铺系数1.25时，松铺厚度为25cm。",
    riskNotice: "松铺系数应通过试验段实测确定。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { Hc, K } = values; const Hs = Hc * K; return { Hs };
    },
  },
  {
    id: "HW-AM-001",
    title: "沥青含量与油石比换算",
    formula: "Pb = Pa / (100 + Pa) * 100",
    inputs: [
      {
        key: "Pa",
        label: "油石比",
        unit: "%",
        defaultValue: 5.0,
        min: 0,
        step: 0.1,
        description: "沥青质量与矿料质量之比",
      },
    ],
    outputs: [
      {
        key: "Pb",
        label: "沥青含量",
        unit: "%",
        precision: 2,
      },
    ],
    exampleSummary: "油石比Pa=5.0%时，沥青含量Pb=4.76%。",
    riskNotice: "沥青含量与油石比的混淆是常见的质量风险，计算时请核对定义。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { Pa } = values; const Pb = (Pa / (100 + Pa)) * 100; return { Pb };
    },
  },
  {
    id: "HW-AM-002",
    title: "马歇尔模数计算",
    formula: "T = MS / FL",
    inputs: [
      {
        key: "MS",
        label: "马歇尔稳定度",
        unit: "kN",
        defaultValue: 12.5,
        min: 0,
        step: 0.1,
      },
      {
        key: "FL",
        label: "流值",
        unit: "mm",
        defaultValue: 3.2,
        min: 0.1,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "T",
        label: "马歇尔模数",
        unit: "kN/mm",
        precision: 2,
      },
    ],
    exampleSummary: "稳定度12.5kN, 流值3.2mm时，马歇尔模数T=3.91kN/mm。",
    riskNotice: "模数反映混合料抗永久变形能力，需符合规范限值。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { MS, FL } = values; if (FL === 0) return { T: 0 }; const T = MS / FL; return { T };
    },
  },
  {
    id: "HW-AM-003",
    title: "沥青混合料空隙率计算",
    formula: "VV = (1 - γf / γt) * 100%",
    inputs: [
      {
        key: "gamma_f",
        label: "毛体积相对密度",
        unit: "",
        defaultValue: 2.385,
        min: 0,
        step: 0.001,
      },
      {
        key: "gamma_t",
        label: "理论最大相对密度",
        unit: "",
        defaultValue: 2.49,
        min: 0.1,
        step: 0.001,
      },
    ],
    outputs: [
      {
        key: "VV",
        label: "空隙率",
        unit: "%",
        precision: 1,
      },
    ],
    exampleSummary: "毛体积密度2.385, 理论密度2.490时，空隙率VV=4.2%。",
    riskNotice: "空隙率计算不适用于OGFC等大空隙混合料；密度测定方法需统一。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { gamma_f, gamma_t } = values; if (gamma_t === 0) return { VV: 0 }; const VV = (1 - gamma_f / gamma_t) * 100; return { VV };
    },
  },
  {
    id: "HW-CC-001",
    title: "混凝土抗弯拉强度计算",
    formula: "fc = P * L / (b * h^2)",
    inputs: [
      {
        key: "P",
        label: "破坏荷载",
        unit: "N",
        defaultValue: 35000,
        min: 0,
        step: 10,
      },
      {
        key: "L",
        label: "支点间距",
        unit: "mm",
        defaultValue: 450,
        min: 0,
        step: 1,
      },
      {
        key: "b",
        label: "试件宽度",
        unit: "mm",
        defaultValue: 150,
        min: 0,
        step: 1,
      },
      {
        key: "h",
        label: "试件高度",
        unit: "mm",
        defaultValue: 150,
        min: 0,
        step: 1,
      },
    ],
    outputs: [
      {
        key: "fc",
        label: "抗弯拉强度",
        unit: "MPa",
        precision: 2,
      },
    ],
    exampleSummary: "荷载35000N, 间距450mm, 宽度150mm, 高度150mm时，强度fc=4.67MPa。",
    riskNotice: "混凝土弯拉强度的有效性取决于断裂面位置是否在三分点内。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { P, L, b, h } = values; if (b === 0 || h === 0) return { fc: 0 }; const fc = (P * L) / (b * Math.pow(h, 2)); return { fc };
    },
  },
  {
    id: "HW-CC-002",
    title: "水泥混凝土施工配合比调整",
    formula: "W' = W - S * a - G * b",
    inputs: [
      {
        key: "W",
        label: "设计用水量",
        unit: "kg",
        defaultValue: 160,
        min: 0,
        step: 1,
      },
      {
        key: "S",
        label: "砂用量",
        unit: "kg",
        defaultValue: 650,
        min: 0,
        step: 1,
      },
      {
        key: "G",
        label: "石用量",
        unit: "kg",
        defaultValue: 1200,
        min: 0,
        step: 1,
      },
      {
        key: "a",
        label: "砂含水率",
        unit: "%",
        defaultValue: 4,
        min: 0,
        step: 0.1,
      },
      {
        key: "b",
        label: "石含水率",
        unit: "%",
        defaultValue: 1,
        min: 0,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "W_prime",
        label: "施工用水量",
        unit: "kg",
        precision: 1,
      },
    ],
    exampleSummary: "设计水160kg, 砂650kg(含水4%), 石1200kg(含水1%)时，施工用水量为122kg。",
    riskNotice: "调整需根据现场砂石实时含水率进行；注意保持水胶比不变。",
    requiresProfessionalReview: true,
    calculate: (values: any) => {
      const { W, S, G, a, b } = values; const W_prime = W - S * (a / 100) - G * (b / 100); return { W_prime };
    },
  },
  {
    id: "HW-CC-003",
    title: "缩缝传力杆根数计算",
    formula: "N = (B - 2c) / d + 1",
    inputs: [
      {
        key: "B",
        label: "板宽",
        unit: "mm",
        defaultValue: 3750,
        min: 0,
        step: 1,
      },
      {
        key: "c",
        label: "端部距离",
        unit: "mm",
        defaultValue: 150,
        min: 0,
        step: 1,
      },
      {
        key: "d",
        label: "间距",
        unit: "mm",
        defaultValue: 300,
        min: 1,
        step: 1,
      },
    ],
    outputs: [
      {
        key: "N",
        label: "传力杆根数",
        unit: "根",
        precision: 0,
      },
    ],
    exampleSummary: "板宽3750mm, 端距150mm, 间距300mm时，需12根传力杆。",
    riskNotice: "计算结果需向上取整或根据布设习惯调整；需满足规范最小间距要求。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { B, c, d } = values; if (d === 0) return { N: 0 }; const N = (B - 2 * c) / d + 1; return { N: Math.ceil(N) };
    },
  },
  {
    id: "HW-BR-001",
    title: "桩基泥浆比重调配计算",
    formula: "Wb = [(γm - γw) / (γb - γm)] * γb * V",
    inputs: [
      {
        key: "gamma_m",
        label: "目标泥浆比重",
        unit: "t/m³",
        defaultValue: 1.15,
        min: 1,
        step: 0.01,
      },
      {
        key: "gamma_w",
        label: "水比重",
        unit: "t/m³",
        defaultValue: 1.0,
        min: 0.9,
        step: 0.01,
      },
      {
        key: "gamma_b",
        label: "膨润土比重",
        unit: "t/m³",
        defaultValue: 2.5,
        min: 2,
        step: 0.1,
      },
      {
        key: "V",
        label: "水体积",
        unit: "m³",
        defaultValue: 10,
        min: 0,
        step: 1,
      },
    ],
    outputs: [
      {
        key: "Wb",
        label: "需加入膨润土重量",
        unit: "t",
        precision: 2,
      },
    ],
    exampleSummary: "水10m³, 目标比重1.15, 水比重1.0, 膨润土比重2.5时，需膨润土2.78t。",
    riskNotice: "泥浆性能除比重外还需关注粘度、含砂率等指标。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { gamma_m, gamma_w, gamma_b, V } = values; if (gamma_b === gamma_m) return { Wb: 0 }; const Wb = ((gamma_m - gamma_w) / (gamma_b - gamma_m)) * gamma_b * V; return { Wb };
    },
  },
  {
    id: "HW-BR-002",
    title: "钢绞线理论伸长量计算",
    formula: "ΔL = Pp * L / (Ap * Ep)",
    inputs: [
      {
        key: "Pp",
        label: "平均张拉力",
        unit: "N",
        defaultValue: 195300,
        min: 0,
        step: 100,
      },
      {
        key: "L",
        label: "钢绞线长度",
        unit: "mm",
        defaultValue: 20000,
        min: 0,
        step: 1,
      },
      {
        key: "Ap",
        label: "截面积",
        unit: "mm²",
        defaultValue: 140,
        min: 1,
        step: 1,
      },
      {
        key: "Ep",
        label: "弹性模量",
        unit: "MPa",
        defaultValue: 195000,
        min: 100000,
        step: 1000,
      },
    ],
    outputs: [
      {
        key: "delta_L",
        label: "理论伸长量",
        unit: "mm",
        precision: 2,
      },
    ],
    exampleSummary: "张拉力195300N, 长度20000mm, 面积140mm²时(弹模取195000)，伸长量143.08mm。",
    riskNotice: "钢绞线计算必须使用实际进场弹模；需考虑锚夹具变形及孔道摩阻。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { Pp, L, Ap, Ep } = values; if (Ap === 0 || Ep === 0) return { delta_L: 0 }; const delta_L = (Pp * L) / (Ap * Ep); return { delta_L };
    },
  },
  {
    id: "HW-BR-003",
    title: "橡胶支座安装温度偏置量",
    formula: "Δx = α * L * (Ti - T0)",
    inputs: [
      {
        key: "alpha",
        label: "线膨胀系数",
        unit: "/℃",
        defaultValue: 1.2e-05,
        min: 0,
        step: 1e-06,
      },
      {
        key: "L",
        label: "联长",
        unit: "mm",
        defaultValue: 30000,
        min: 0,
        step: 1,
      },
      {
        key: "Ti",
        label: "安装温度",
        unit: "℃",
        defaultValue: 30,
        min: -50,
        step: 1,
      },
      {
        key: "T0",
        label: "设计平均温度",
        unit: "℃",
        defaultValue: 15,
        min: -50,
        step: 1,
      },
    ],
    outputs: [
      {
        key: "delta_x",
        label: "偏置量",
        unit: "mm",
        precision: 2,
      },
    ],
    exampleSummary: "联长30000mm, 安装30℃, 设计15℃时，偏置量4.5mm。",
    riskNotice: "偏置方向需根据升降温情况确定；支座剪切变形需在允许范围内。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { alpha, L, Ti, T0 } = values; const delta_x = alpha * L * (Ti - T0); return { delta_x };
    },
  },
  {
    id: "HW-TN-001",
    title: "隧道爆破炮眼数量估算",
    formula: "N = 3.3 * f^(1/3) * S",
    inputs: [
      {
        key: "f",
        label: "普氏岩石硬度系数",
        unit: "",
        defaultValue: 8,
        min: 0.1,
        step: 0.1,
      },
      {
        key: "S",
        label: "开挖断面积",
        unit: "m²",
        defaultValue: 60,
        min: 0,
        step: 1,
      },
    ],
    outputs: [
      {
        key: "N",
        label: "炮眼数量",
        unit: "个",
        precision: 0,
      },
    ],
    exampleSummary: "岩石硬度f=8, 断面60m²时，估算炮眼数为396个。",
    riskNotice: "隧道炮眼估算仅供参考，需以光面爆破设计及现场围岩情况为准。",
    requiresProfessionalReview: true,
    calculate: (values: any) => {
      const { f, S } = values; const N = 3.3 * Math.pow(f, 1/3) * S; return { N: Math.round(N) };
    },
  },
  {
    id: "HW-TN-002",
    title: "单根小导管注浆量计算",
    formula: "Q = π * R^2 * L * n * α * β",
    inputs: [
      {
        key: "R",
        label: "扩散半径",
        unit: "m",
        defaultValue: 0.3,
        min: 0,
        step: 0.01,
      },
      {
        key: "L",
        label: "导管长度",
        unit: "m",
        defaultValue: 4,
        min: 0,
        step: 0.1,
      },
      {
        key: "n",
        label: "地层孔隙率",
        unit: "%",
        defaultValue: 5,
        min: 0,
        step: 0.1,
      },
      {
        key: "alpha",
        label: "填充系数",
        unit: "%",
        defaultValue: 80,
        min: 0,
        step: 1,
      },
      {
        key: "beta",
        label: "损耗系数",
        unit: "",
        defaultValue: 1.2,
        min: 1,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "Q",
        label: "注浆量",
        unit: "m³",
        precision: 3,
      },
    ],
    exampleSummary: "半径0.3m, 长度4m, 孔隙率5%, 填充80%, 损耗1.2时，注浆量0.054m³。",
    riskNotice: "注浆量受压力、地层变化影响较大；需结合注浆压力和终注标准控制。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { R, L, n, alpha, beta } = values; const Q = Math.PI * Math.pow(R, 2) * L * (n / 100) * (alpha / 100) * beta; return { Q };
    },
  },
  {
    id: "HW-TN-003",
    title: "拱顶下沉速率报警判断",
    formula: "v = (Si - Si_prev) / (ti - ti_prev)",
    inputs: [
      {
        key: "Si",
        label: "本次实测下沉量",
        unit: "mm",
        defaultValue: 21.5,
        min: 0,
        step: 0.1,
      },
      {
        key: "Si_prev",
        label: "上次实测下沉量",
        unit: "mm",
        defaultValue: 15.0,
        min: 0,
        step: 0.1,
      },
      {
        key: "delta_t",
        label: "时间间隔",
        unit: "d",
        defaultValue: 1,
        min: 0.01,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "v",
        label: "下沉速率",
        unit: "mm/d",
        precision: 2,
      },
    ],
    exampleSummary: "上次15.0mm, 本次21.5mm, 间隔1天，下沉速率6.5mm/d。",
    riskNotice: "下沉速率报警需结合围岩级别及规范设定阈值；注意观测频率要求。",
    requiresProfessionalReview: true,
    calculate: (values: any) => {
      const { Si, Si_prev, delta_t } = values; if (delta_t === 0) return { v: 0 }; const v = (Si - Si_prev) / delta_t; return { v };
    },
  },
  {
    id: "HW-TE-001",
    title: "标线涂料用量计算",
    formula: "W = A * h * ρ",
    inputs: [
      {
        key: "A",
        label: "标线面积",
        unit: "m²",
        defaultValue: 150,
        min: 0,
        step: 1,
      },
      {
        key: "h",
        label: "涂膜厚度",
        unit: "mm",
        defaultValue: 1.8,
        min: 0,
        step: 0.1,
      },
      {
        key: "rho",
        label: "涂料密度",
        unit: "g/cm³",
        defaultValue: 2.0,
        min: 0,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "W",
        label: "涂料用量",
        unit: "kg",
        precision: 1,
      },
    ],
    exampleSummary: "面积150m², 厚度1.8mm, 密度2.0时，用量540kg。",
    riskNotice: "用量不含玻璃珠及施工损耗；需根据涂料种类核实密度。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { A, h, rho } = values; const W = A * h * rho; return { W };
    },
  },
  {
    id: "HW-TE-002",
    title: "护栏立柱间距匹配计算",
    formula: "N = L / d + 1",
    inputs: [
      {
        key: "L",
        label: "护栏总长",
        unit: "m",
        defaultValue: 400,
        min: 0,
        step: 1,
      },
      {
        key: "d",
        label: "立柱间距",
        unit: "m",
        defaultValue: 4,
        min: 0.1,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "N",
        label: "立柱根数",
        unit: "根",
        precision: 0,
      },
    ],
    exampleSummary: "总长400m, 间距4m时，需101根立柱。",
    riskNotice: "计算未考虑端部处理及特殊位置加密；需核对设计图纸布设要求。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { L, d } = values; if (d === 0) return { N: 0 }; const N = L / d + 1; return { N: Math.ceil(N) };
    },
  },
  {
    id: "HW-TE-003",
    title: "标志牌抗风载计算",
    formula: "Wk = βz * μs * μz * W0",
    inputs: [
      {
        key: "beta_z",
        label: "风振系数",
        unit: "",
        defaultValue: 1.5,
        min: 1,
        step: 0.01,
      },
      {
        key: "mu_s",
        label: "风荷载体型系数",
        unit: "",
        defaultValue: 1.2,
        min: 0,
        step: 0.01,
      },
      {
        key: "mu_z",
        label: "高度变化系数",
        unit: "",
        defaultValue: 1.14,
        min: 0,
        step: 0.01,
      },
      {
        key: "W0",
        label: "基本风压",
        unit: "kN/m²",
        defaultValue: 0.5,
        min: 0,
        step: 0.01,
      },
    ],
    outputs: [
      {
        key: "Wk",
        label: "风荷载标准值",
        unit: "kN/m²",
        precision: 3,
      },
    ],
    exampleSummary: "基本风压0.5, 体型系数1.2, 高度系数1.14, 风振1.5时，标准值1.026。",
    riskNotice: "标志牌风载计算需引用当地50年一遇气象数据；结构设计需同时验算强度和稳定性。",
    requiresProfessionalReview: true,
    calculate: (values: any) => {
      const { beta_z, mu_s, mu_z, W0 } = values; const Wk = beta_z * mu_s * mu_z * W0; return { Wk };
    },
  },
  {
    id: "HW-MT-001",
    title: "钢筋理论重量计算模板",
    formula: "W = 0.00617 * d^2",
    inputs: [
      {
        key: "d",
        label: "钢筋直径",
        unit: "mm",
        defaultValue: 20,
        min: 0,
        step: 1,
      },
    ],
    outputs: [
      {
        key: "W",
        label: "单位长度重量",
        unit: "kg/m",
        precision: 3,
      },
    ],
    exampleSummary: "直径20mm时，单位重量为2.468kg/m。",
    riskNotice: "钢筋理论重量不含搭接损耗及施工余量。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { d } = values; const W = 0.00617 * Math.pow(d, 2); return { W };
    },
  },
  {
    id: "HW-MT-002",
    title: "沥青面层计量扣减模板",
    formula: "Apay = Atotal - ΣAhole",
    inputs: [
      {
        key: "A_total",
        label: "总铺装面积",
        unit: "m²",
        defaultValue: 5000,
        min: 0,
        step: 1,
      },
      {
        key: "hole_count",
        label: "井盖数量",
        unit: "个",
        defaultValue: 10,
        min: 0,
        step: 1,
      },
      {
        key: "A_hole_single",
        label: "单个井盖面积",
        unit: "m²",
        defaultValue: 0.5024,
        min: 0,
        step: 0.0001,
      },
      {
        key: "threshold",
        label: "扣减阈值",
        unit: "m²",
        defaultValue: 0.1,
        min: 0,
        step: 0.01,
      },
    ],
    outputs: [
      {
        key: "A_pay",
        label: "应付计量面积",
        unit: "m²",
        precision: 3,
      },
    ],
    exampleSummary: "总面积5000m², 10个井盖(单面积0.5024), 阈值0.1时，计量面积4994.976m²。",
    riskNotice: "计量扣减需严格遵循合同约定的阈值；注意区分不同类型的井盖。",
    requiresProfessionalReview: true,
    calculate: (values: any) => {
      const { A_total, hole_count, A_hole_single, threshold } = values; const deduct = A_hole_single > threshold ? hole_count * A_hole_single : 0; const A_pay = A_total - deduct; return { A_pay };
    },
  },
  {
    id: "HW-MT-003",
    title: "土石方断面法算量",
    formula: "V = [(A1 + A2) / 2] * L",
    inputs: [
      {
        key: "A1",
        label: "断面1面积",
        unit: "m²",
        defaultValue: 50,
        min: 0,
        step: 0.1,
      },
      {
        key: "A2",
        label: "断面2面积",
        unit: "m²",
        defaultValue: 70,
        min: 0,
        step: 0.1,
      },
      {
        key: "L",
        label: "断面间距",
        unit: "m",
        defaultValue: 20,
        min: 0,
        step: 0.1,
      },
    ],
    outputs: [
      {
        key: "V",
        label: "土石方体积",
        unit: "m³",
        precision: 2,
      },
    ],
    exampleSummary: "断面面积50m²和70m², 间距20m时，体积为1200m³。",
    riskNotice: "断面法适用于地形起伏平缓段；对于地形复杂段建议使用棱台法计算。",
    requiresProfessionalReview: false,
    calculate: (values: any) => {
      const { A1, A2, L } = values; const V = ((A1 + A2) / 2) * L; return { V };
    },
  }
];
