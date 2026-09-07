/**
 * 工程测量专业计算器规格模块
 * 
 * 包含 45 条可执行计算规格，1 条不可安全数值化条目。
 * 
 * 不可安全数值化条目说明：
 * 1. 06 高斯投影换带计算：审计报告中缺少具体换带计算公式（正反算公式略），无法建立计算逻辑。
 */

export const unsupportedCalculatorIds = ["06"];

export const categoryCalculatorSpecs = [
  {
    id: "01",
    title: "坐标正算",
    formula: "X_B = X_A + D * cos(α); Y_B = Y_A + D * sin(α)",
    inputs: [
      { key: "XA", label: "起点坐标X_A", unit: "m", defaultValue: 100, min: -9999999, step: 0.001, description: "起点北向坐标" },
      { key: "YA", label: "起点坐标Y_A", unit: "m", defaultValue: 100, min: -9999999, step: 0.001, description: "起点东向坐标" },
      { key: "D", label: "平距D", unit: "m", defaultValue: 50, min: 0, step: 0.001, description: "起点至终点的水平距离" },
      { key: "alpha", label: "方位角α", unit: "°", defaultValue: 45, min: 0, step: 0.001, description: "起点至终点的坐标方位角" }
    ],
    outputs: [
      { key: "XB", label: "终点坐标X_B", unit: "m", precision: 3 },
      { key: "YB", label: "终点坐标Y_B", unit: "m", precision: 3 }
    ],
    exampleSummary: "起点(100, 100), D=50m, α=45°，计算得 X_B = 135.355m, Y_B = 135.355m",
    riskNotice: "注意测量坐标系中X为北向，Y为东向；需按设计和现行规范由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const rad = (values.alpha * Math.PI) / 180;
      return {
        XB: values.XA + values.D * Math.cos(rad),
        YB: values.YA + values.D * Math.sin(rad)
      };
    }
  },
  {
    id: "02",
    title: "坐标反算",
    formula: "D = sqrt((X_B - X_A)^2 + (Y_B - Y_A)^2); α = arctan((Y_B - Y_A) / (X_B - X_A))",
    inputs: [
      { key: "XA", label: "起点坐标X_A", unit: "m", defaultValue: 100, min: -9999999, step: 0.001, description: "起点北向坐标" },
      { key: "YA", label: "起点坐标Y_A", unit: "m", defaultValue: 100, min: -9999999, step: 0.001, description: "起点东向坐标" },
      { key: "XB", label: "终点坐标X_B", unit: "m", defaultValue: 135.355, min: -9999999, step: 0.001, description: "终点北向坐标" },
      { key: "YB", label: "终点坐标Y_B", unit: "m", defaultValue: 135.355, min: -9999999, step: 0.001, description: "终点东向坐标" }
    ],
    outputs: [
      { key: "D", label: "平距D", unit: "m", precision: 3 },
      { key: "alpha", label: "方位角α", unit: "°", precision: 3 }
    ],
    exampleSummary: "起点(100,100), 终点(135.355, 135.355)，计算得 D = 50m, α = 45°",
    riskNotice: "需根据象限调整arctan计算出的方位角；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const dx = values.XB - values.XA;
      const dy = values.YB - values.YA;
      const D = Math.sqrt(dx * dx + dy * dy);
      let alpha = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (alpha < 0) alpha += 360;
      return { D, alpha };
    }
  },
  {
    id: "03",
    title: "方位角推算",
    formula: "α_n = α_{n-1} + β ± 180° (左角取+, 右角取-)",
    inputs: [
      { key: "alphaPrev", label: "前一边方位角α_{n-1}", unit: "°", defaultValue: 120, min: 0, step: 0.001, description: "已知的前一边坐标方位角" },
      { key: "beta", label: "转折角β", unit: "°", defaultValue: 100, min: 0, step: 0.001, description: "观测的转折角" },
      { key: "type", label: "转折方向", unit: "1=左角, 2=右角", defaultValue: 1, min: 1, step: 1, description: "1代表左角，2代表右角" }
    ],
    outputs: [
      { key: "alphaN", label: "推算方位角α_n", unit: "°", precision: 3 }
    ],
    exampleSummary: "前边方位角120°, 左转角100°，计算得 α_n = 40°",
    riskNotice: "结果若大于360°需减360°，小于0°需加360°；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      let alphaN = values.alphaPrev + (values.type === 1 ? values.beta : -values.beta);
      alphaN += 180;
      while (alphaN >= 360) alphaN -= 360;
      while (alphaN < 0) alphaN += 360;
      return { alphaN };
    }
  },
  {
    id: "04",
    title: "两点间空间距离计算",
    formula: "S = sqrt((X_B - X_A)^2 + (Y_B - Y_A)^2 + (Z_B - Z_A)^2)",
    inputs: [
      { key: "XA", label: "点A坐标X", unit: "m", defaultValue: 0, min: -9999999, step: 0.001 },
      { key: "YA", label: "点A坐标Y", unit: "m", defaultValue: 0, min: -9999999, step: 0.001 },
      { key: "ZA", label: "点A坐标Z", unit: "m", defaultValue: 0, min: -9999999, step: 0.001 },
      { key: "XB", label: "点B坐标X", unit: "m", defaultValue: 3, min: -9999999, step: 0.001 },
      { key: "YB", label: "点B坐标Y", unit: "m", defaultValue: 4, min: -9999999, step: 0.001 },
      { key: "ZB", label: "点B坐标Z", unit: "m", defaultValue: 12, min: -9999999, step: 0.001 }
    ],
    outputs: [
      { key: "S", label: "空间距离S", unit: "m", precision: 3 }
    ],
    exampleSummary: "点A(0,0,0), 点B(3,4,12)，计算得 S = 13m",
    riskNotice: "长距离需考虑地球曲率影响；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const dx = values.XB - values.XA;
      const dy = values.YB - values.YA;
      const dz = values.ZB - values.ZA;
      return { S: Math.sqrt(dx * dx + dy * dy + dz * dz) };
    }
  },
  {
    id: "05",
    title: "坐标转换(四参数)",
    formula: "X = ΔX + (1+m)(x*cosθ - y*sinθ); Y = ΔY + (1+m)(x*sinθ + y*cosθ)",
    inputs: [
      { key: "x", label: "原坐标x", unit: "m", defaultValue: 5, min: -9999999, step: 0.001 },
      { key: "y", label: "原坐标y", unit: "m", defaultValue: 5, min: -9999999, step: 0.001 },
      { key: "dX", label: "平移ΔX", unit: "m", defaultValue: 10, min: -9999999, step: 0.001 },
      { key: "dY", label: "平移ΔY", unit: "m", defaultValue: 10, min: -9999999, step: 0.001 },
      { key: "m", label: "尺度比m", unit: "", defaultValue: 0, min: -1, step: 0.000001 },
      { key: "theta", label: "旋转角θ", unit: "rad", defaultValue: 0, min: -6.28, step: 0.000001 }
    ],
    outputs: [
      { key: "X", label: "转换坐标X", unit: "m", precision: 3 },
      { key: "Y", label: "转换坐标Y", unit: "m", precision: 3 }
    ],
    exampleSummary: "平移(10,10), 旋转0°, 缩放0, 点(5,5)，计算得 (15, 15)",
    riskNotice: "需至少2个公共点求取参数；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const scale = 1 + values.m;
      const cosT = Math.cos(values.theta);
      const sinT = Math.sin(values.theta);
      return {
        X: values.dX + scale * (values.x * cosT - values.y * sinT),
        Y: values.dY + scale * (values.x * sinT + values.y * cosT)
      };
    }
  },
  {
    id: "07",
    title: "水准高程计算",
    formula: "H_B = H_A + a - b",
    inputs: [
      { key: "HA", label: "后视高程H_A", unit: "m", defaultValue: 100, min: -9999, step: 0.001 },
      { key: "a", label: "后视读数a", unit: "m", defaultValue: 1.5, min: 0, step: 0.001 },
      { key: "b", label: "前视读数b", unit: "m", defaultValue: 1.2, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "HB", label: "前视高程H_B", unit: "m", precision: 3 }
    ],
    exampleSummary: "H_A=100m, 后视a=1.5m, 前视b=1.2m，计算得 H_B = 100.3m",
    riskNotice: "仪器视线高程应控制在标尺范围内；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { HB: values.HA + values.a - values.b };
    }
  },
  {
    id: "08",
    title: "水准路线闭合差计算",
    formula: "f_h = Σh_测 - Σh_理",
    inputs: [
      { key: "hMeasured", label: "实测高差之和Σh_测", unit: "mm", defaultValue: 15, min: -999999, step: 1 },
      { key: "hTheory", label: "理论高差之和Σh_理", unit: "mm", defaultValue: 0, min: -999999, step: 1 }
    ],
    outputs: [
      { key: "fh", label: "高程闭合差f_h", unit: "mm", precision: 0 }
    ],
    exampleSummary: "实测高差之和+15mm, 理论高差之和0mm，计算得 f_h = +15mm",
    riskNotice: "必须与容许闭合差比较，超限则重测；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { fh: values.hMeasured - values.hTheory };
    }
  },
  {
    id: "09",
    title: "水准闭合差平差(按距离)",
    formula: "v_i = -f_h * (L_i / ΣL)",
    inputs: [
      { key: "fh", label: "闭合差f_h", unit: "mm", defaultValue: 10, min: -999, step: 1 },
      { key: "Li", label: "测段距离L_i", unit: "km", defaultValue: 2, min: 0, step: 0.001 },
      { key: "LTotal", label: "总长ΣL", unit: "km", defaultValue: 10, min: 0.001, step: 0.001 }
    ],
    outputs: [
      { key: "vi", label: "改正数v_i", unit: "mm", precision: 1 }
    ],
    exampleSummary: "闭合差+10mm, 总长10km, 某段长2km，计算得 v = -2mm",
    riskNotice: "改正数之和必须等于闭合差反号；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      if (values.LTotal === 0) return { vi: 0 };
      return { vi: -values.fh * (values.Li / values.LTotal) };
    }
  },
  {
    id: "10",
    title: "水准闭合差平差(按测站数)",
    formula: "v_i = -f_h * (n_i / Σn)",
    inputs: [
      { key: "fh", label: "闭合差f_h", unit: "mm", defaultValue: 12, min: -999, step: 1 },
      { key: "ni", label: "测段站数n_i", unit: "站", defaultValue: 3, min: 0, step: 1 },
      { key: "nTotal", label: "总站数Σn", unit: "站", defaultValue: 12, min: 1, step: 1 }
    ],
    outputs: [
      { key: "vi", label: "改正数v_i", unit: "mm", precision: 1 }
    ],
    exampleSummary: "闭合差+12mm, 总站数12站, 某段3站，计算得 v = -3mm",
    riskNotice: "适用于山区或各站距离相近的情况；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      if (values.nTotal === 0) return { vi: 0 };
      return { vi: -values.fh * (values.ni / values.nTotal) };
    }
  },
  {
    id: "11",
    title: "三角高程测量",
    formula: "h = D * tan(α) + i - v + f",
    inputs: [
      { key: "D", label: "平距D", unit: "m", defaultValue: 100, min: 0, step: 0.001 },
      { key: "alpha", label: "垂直角α", unit: "°", defaultValue: 5, min: -90, step: 0.001 },
      { key: "i", label: "仪器高i", unit: "m", defaultValue: 1.5, min: 0, step: 0.001 },
      { key: "v", label: "目标高v", unit: "m", defaultValue: 1.6, min: 0, step: 0.001 },
      { key: "f", label: "球气差改正f", unit: "m", defaultValue: 0, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "h", label: "高差h", unit: "m", precision: 3 }
    ],
    exampleSummary: "D=100m, α=5°, i=1.5m, v=1.6m, f忽略，计算得 h = 8.649m",
    riskNotice: "长距离需考虑地球曲率和大气折光差(f)；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const rad = (values.alpha * Math.PI) / 180;
      return { h: values.D * Math.tan(rad) + values.i - values.v + values.f };
    }
  },
  {
    id: "12",
    title: "跨河水准测量计算",
    formula: "h = (h_正 + h_反) / 2",
    inputs: [
      { key: "hPos", label: "正向观测高差h_正", unit: "m", defaultValue: 1.234, min: -999, step: 0.001 },
      { key: "hNeg", label: "反向观测高差h_反", unit: "m", defaultValue: 1.236, min: -999, step: 0.001 }
    ],
    outputs: [
      { key: "h", label: "平均高差h", unit: "m", precision: 3 }
    ],
    exampleSummary: "正测高差1.234m，反测高差1.236m，计算得 h = 1.235m",
    riskNotice: "必须采用双向同步或交替观测消除折光影响；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { h: (values.hPos + values.hNeg) / 2 };
    }
  },
  {
    id: "13",
    title: "导线角度闭合差计算",
    formula: "f_β = Σβ_测 - (n-2)*180°",
    inputs: [
      { key: "sumBeta", label: "实测内角和Σβ_测", unit: "°", defaultValue: 720.016667, min: 0, step: 0.000001, description: "输入度分秒转换后的十进制度数" },
      { key: "n", label: "边数n", unit: "", defaultValue: 4, min: 3, step: 1 }
    ],
    outputs: [
      { key: "fBeta", label: "角度闭合差f_β", unit: "°", precision: 4 }
    ],
    exampleSummary: "4边形内角和实测720°01'00\"，计算得 f_β = +01'00\"",
    riskNotice: "超限则说明角度观测存在粗差；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { fBeta: values.sumBeta - (values.n - 2) * 180 };
    }
  },
  {
    id: "14",
    title: "导线坐标增量闭合差",
    formula: "f_x = ΣΔx, f_y = ΣΔy",
    inputs: [
      { key: "sumDx", label: "坐标增量和ΣΔx", unit: "m", defaultValue: 0.05, min: -999, step: 0.001 },
      { key: "sumDy", label: "坐标增量和ΣΔy", unit: "m", defaultValue: -0.04, min: -999, step: 0.001 }
    ],
    outputs: [
      { key: "fx", label: "X方向闭合差f_x", unit: "m", precision: 3 },
      { key: "fy", label: "Y方向闭合差f_y", unit: "m", precision: 3 }
    ],
    exampleSummary: "闭合导线ΣΔx = 0.05m, ΣΔy = -0.04m，计算得 f_x = 0.05m, f_y = -0.04m",
    riskNotice: "坐标增量闭合差用于计算全长闭合差；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { fx: values.sumDx, fy: values.sumDy };
    }
  },
  {
    id: "15",
    title: "导线全长相对闭合差",
    formula: "K = 1 / (ΣD / sqrt(f_x^2 + f_y^2))",
    inputs: [
      { key: "sumD", label: "导线全长ΣD", unit: "m", defaultValue: 1000, min: 0.001, step: 0.001 },
      { key: "fx", label: "X增量闭合差f_x", unit: "m", defaultValue: 0.03, min: -999, step: 0.001 },
      { key: "fy", label: "Y增量闭合差f_y", unit: "m", defaultValue: 0.04, min: -999, step: 0.001 }
    ],
    outputs: [
      { key: "K_denom", label: "相对闭合差分母", unit: "", precision: 0 }
    ],
    exampleSummary: "全长1000m, f_x=0.03m, f_y=0.04m，计算得 K = 1/20000",
    riskNotice: "应满足相应等级导线的精度要求；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const f = Math.sqrt(values.fx * values.fx + values.fy * values.fy);
      if (f === 0) return { K_denom: 0 };
      return { K_denom: values.sumD / f };
    }
  },
  {
    id: "16",
    title: "坐标增量平差",
    formula: "v_x = -f_x * (D_i / ΣD); v_y = -f_y * (D_i / ΣD)",
    inputs: [
      { key: "fx", label: "X闭合差f_x", unit: "m", defaultValue: 0.1, min: -999, step: 0.001 },
      { key: "fy", label: "Y闭合差f_y", unit: "m", defaultValue: 0, min: -999, step: 0.001 },
      { key: "Di", label: "段长D_i", unit: "m", defaultValue: 10, min: 0, step: 0.001 },
      { key: "sumD", label: "全长ΣD", unit: "m", defaultValue: 100, min: 0.001, step: 0.001 }
    ],
    outputs: [
      { key: "vx", label: "X改正数v_x", unit: "m", precision: 3 },
      { key: "vy", label: "Y改正数v_y", unit: "m", precision: 3 }
    ],
    exampleSummary: "f_x=0.1m, 总长100m, 段长10m，计算得 v_x = -0.01m",
    riskNotice: "平差后增量之和必须为0（闭合导线）；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const ratio = values.Di / values.sumD;
      return {
        vx: -values.fx * ratio,
        vy: -values.fy * ratio
      };
    }
  },
  {
    id: "17",
    title: "交会定点(前方交会)辅助测算",
    formula: "X_P = (X_A*cotβ + X_B*cotα + Y_B - Y_A) / (cotα + cotβ)",
    inputs: [
      { key: "XA", label: "点A坐标X_A", unit: "m", defaultValue: 0, min: -9999999, step: 0.001 },
      { key: "YA", label: "点A坐标Y_A", unit: "m", defaultValue: 0, min: -9999999, step: 0.001 },
      { key: "XB", label: "点B坐标X_B", unit: "m", defaultValue: 100, min: -9999999, step: 0.001 },
      { key: "YB", label: "点B坐标Y_B", unit: "m", defaultValue: 0, min: -9999999, step: 0.001 },
      { key: "alpha", label: "观测角α", unit: "°", defaultValue: 45, min: 0.001, step: 0.001 },
      { key: "beta", label: "观测角β", unit: "°", defaultValue: 45, min: 0.001, step: 0.001 }
    ],
    outputs: [
      { key: "XP", label: "未知点坐标X_P", unit: "m", precision: 3 }
    ],
    exampleSummary: "A(0,0), B(100,0), α=45°, β=45°，计算得 X_P = 50m (注：由于原审计文件缺失 Y_P 公式，本工具仅提供 X_P 辅助计算)",
    riskNotice: "本条目为辅助测算，仅提供 X_P 计算；交会角宜在30°至150°之间；需由专业人员复核。",
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const cot = (deg: number) => 1 / Math.tan((deg * Math.PI) / 180);
      const cA = cot(values.alpha);
      const cB = cot(values.beta);
      if (Math.abs(cA + cB) < 1e-10) return { XP: 0 };
      return {
        XP: (values.XA * cB + values.XB * cA + values.YB - values.YA) / (cA + cB)
      };
    }
  },
  {
    id: "18",
    title: "圆曲线切线长计算",
    formula: "T = R * tan(α / 2)",
    inputs: [
      { key: "R", label: "半径R", unit: "m", defaultValue: 1000, min: 0.001, step: 0.001 },
      { key: "alpha", label: "转向角α", unit: "°", defaultValue: 60, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "T", label: "切线长T", unit: "m", precision: 3 }
    ],
    exampleSummary: "R=1000m, 转向角α=60°，计算得 T = 577.35m",
    riskNotice: "适用于单一圆曲线；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const radHalf = (values.alpha * Math.PI) / 360;
      return { T: values.R * Math.tan(radHalf) };
    }
  },
  {
    id: "19",
    title: "圆曲线曲线长计算",
    formula: "L = R * α * (π / 180)",
    inputs: [
      { key: "R", label: "半径R", unit: "m", defaultValue: 1000, min: 0.001, step: 0.001 },
      { key: "alpha", label: "转向角α", unit: "°", defaultValue: 60, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "L", label: "曲线长L", unit: "m", precision: 3 }
    ],
    exampleSummary: "R=1000m, α=60°，计算得 L = 1047.20m",
    riskNotice: "α必须使用度数，或直接用弧度L=R*α；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { L: values.R * values.alpha * (Math.PI / 180) };
    }
  },
  {
    id: "20",
    title: "圆曲线外距计算",
    formula: "E = R * (sec(α / 2) - 1)",
    inputs: [
      { key: "R", label: "半径R", unit: "m", defaultValue: 1000, min: 0.001, step: 0.001 },
      { key: "alpha", label: "转向角α", unit: "°", defaultValue: 60, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "E", label: "外距E", unit: "m", precision: 3 }
    ],
    exampleSummary: "R=1000m, α=60°，计算得 E = 154.70m",
    riskNotice: "用于核对曲线是否侵入障碍物；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const cosHalf = Math.cos((values.alpha * Math.PI) / 360);
      if (cosHalf === 0) return { E: 0 };
      return { E: values.R * (1 / cosHalf - 1) };
    }
  },
  {
    id: "21",
    title: "缓和曲线切线角计算",
    formula: "β = l^2 / (2 * R * L_s)",
    inputs: [
      { key: "l", label: "距起点弧长l", unit: "m", defaultValue: 50, min: 0, step: 0.001 },
      { key: "R", label: "圆曲线半径R", unit: "m", defaultValue: 1000, min: 0.001, step: 0.001 },
      { key: "Ls", label: "缓和曲线总长L_s", unit: "m", defaultValue: 100, min: 0.001, step: 0.001 }
    ],
    outputs: [
      { key: "beta", label: "切线角β", unit: "rad", precision: 5 }
    ],
    exampleSummary: "l=50m, R=1000m, L_s=100m，计算得 β = 0.0125 rad",
    riskNotice: "l为距离缓和曲线起点的弧长；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { beta: (values.l * values.l) / (2 * values.R * values.Ls) };
    }
  },
  {
    id: "22",
    title: "竖曲线切线长计算",
    formula: "T = L / 2",
    inputs: [
      { key: "L", label: "竖曲线总长L", unit: "m", defaultValue: 120, min: 0.001, step: 0.001 }
    ],
    outputs: [
      { key: "T", label: "切线长T", unit: "m", precision: 3 }
    ],
    exampleSummary: "竖曲线总长L=120m，计算得 T = 60m",
    riskNotice: "工程上近似认为切线长等于水平投影长的一半；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { T: values.L / 2 };
    }
  },
  {
    id: "23",
    title: "竖曲线高程计算",
    formula: "H = H_0 + i*x ± x^2 / (2*R)",
    inputs: [
      { key: "H0", label: "切线高程H_0", unit: "m", defaultValue: 100, min: -999, step: 0.001 },
      { key: "i", label: "坡度i", unit: "", defaultValue: 0.02, min: -1, step: 0.0001 },
      { key: "x", label: "水平距离x", unit: "m", defaultValue: 50, min: 0, step: 0.001 },
      { key: "R", label: "曲线半径R", unit: "m", defaultValue: 5000, min: 0.001, step: 0.001 },
      { key: "type", label: "曲线类型", unit: "1=凸, 2=凹", defaultValue: 1, min: 1, step: 1 }
    ],
    outputs: [
      { key: "H", label: "设计高程H", unit: "m", precision: 3 }
    ],
    exampleSummary: "切线高程100m, 坡度0.02, x=50m, R=5000m, 凸曲线(-)，计算得 H = 100.75m",
    riskNotice: "凸曲线取减号，凹曲线取加号；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const correction = (values.x * values.x) / (2 * values.R);
      return { H: values.H0 + values.i * values.x + (values.type === 1 ? -correction : correction) };
    }
  },
  {
    id: "24",
    title: "超高渐变率计算",
    formula: "p = Δi / L_c",
    inputs: [
      { key: "deltaI", label: "横坡变化量Δi", unit: "", defaultValue: 0.04, min: 0, step: 0.0001, description: "如从2%到6%，变化量为0.04" },
      { key: "Lc", label: "渐变段长L_c", unit: "m", defaultValue: 80, min: 0.001, step: 0.001 }
    ],
    outputs: [
      { key: "p", label: "超高渐变率p", unit: "/m", precision: 6 }
    ],
    exampleSummary: "超高从2%渐变到6%, 渐变段长80m，计算得 p = 0.0005 /m (0.05%)",
    riskNotice: "渐变率不应大于规范规定的最大值；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { p: values.deltaI / values.Lc };
    }
  },
  {
    id: "25",
    title: "平均断面法土石方计算",
    formula: "V = (A_1 + A_2) / 2 * L",
    inputs: [
      { key: "A1", label: "断面1面积A_1", unit: "m²", defaultValue: 10, min: 0, step: 0.01 },
      { key: "A2", label: "断面2面积A_2", unit: "m²", defaultValue: 20, min: 0, step: 0.01 },
      { key: "L", label: "断面间距L", unit: "m", defaultValue: 20, min: 0, step: 0.01 }
    ],
    outputs: [
      { key: "V", label: "体积V", unit: "m³", precision: 2 }
    ],
    exampleSummary: "断面1面积10m², 断面2面积20m², 间距20m，计算得 V = 300m³",
    riskNotice: "当A_1与A_2相差较大时应采用棱台法；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { V: ((values.A1 + values.A2) / 2) * values.L };
    }
  },
  {
    id: "26",
    title: "棱台法土石方计算",
    formula: "V = (A_1 + A_2 + sqrt(A_1 * A_2)) * L / 3",
    inputs: [
      { key: "A1", label: "断面1面积A_1", unit: "m²", defaultValue: 10, min: 0, step: 0.01 },
      { key: "A2", label: "断面2面积A_2", unit: "m²", defaultValue: 40, min: 0, step: 0.01 },
      { key: "L", label: "断面间距L", unit: "m", defaultValue: 30, min: 0, step: 0.01 }
    ],
    outputs: [
      { key: "V", label: "体积V", unit: "m³", precision: 2 }
    ],
    exampleSummary: "A_1=10m², A_2=40m², L=30m，计算得 V = 700m³",
    riskNotice: "适用于面积差异悬殊的相邻断面；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { V: (values.A1 + values.A2 + Math.sqrt(values.A1 * values.A2)) * (values.L / 3) };
    }
  },
  {
    id: "27",
    title: "方格网法角点填挖高差",
    formula: "h = H_设 - H_原",
    inputs: [
      { key: "HS", label: "设计高程H_设", unit: "m", defaultValue: 100.5, min: -999, step: 0.001 },
      { key: "HY", label: "原地面高程H_原", unit: "m", defaultValue: 101.2, min: -999, step: 0.001 }
    ],
    outputs: [
      { key: "h", label: "填挖高差h", unit: "m", precision: 3 }
    ],
    exampleSummary: "设计高程100.5m, 原地面高程101.2m，计算得 h = -0.7m (挖方)",
    riskNotice: "正值为填方，负值为挖方；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { h: values.HS - values.HY };
    }
  },
  {
    id: "28",
    title: "方格网全填/全挖体积计算",
    formula: "V = a^2 * (h_1 + h_2 + h_3 + h_4) / 4",
    inputs: [
      { key: "a", label: "方格边长a", unit: "m", defaultValue: 10, min: 0.001, step: 0.1 },
      { key: "h1", label: "角点1高差h_1", unit: "m", defaultValue: 1, min: -99, step: 0.001 },
      { key: "h2", label: "角点2高差h_2", unit: "m", defaultValue: 1.2, min: -99, step: 0.001 },
      { key: "h3", label: "角点3高差h_3", unit: "m", defaultValue: 0.8, min: -99, step: 0.001 },
      { key: "h4", label: "角点4高差h_4", unit: "m", defaultValue: 1, min: -99, step: 0.001 }
    ],
    outputs: [
      { key: "V", label: "体积V", unit: "m³", precision: 2 }
    ],
    exampleSummary: "边长a=10m, 角点高差1, 1.2, 0.8, 1m，计算得 V = 100m³",
    riskNotice: "仅适用于四个角点同号的情况；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { V: (values.a * values.a * (values.h1 + values.h2 + values.h3 + values.h4)) / 4 };
    }
  },
  {
    id: "29",
    title: "零线位置计算",
    formula: "x = a * |h_挖| / (|h_挖| + |h_填|)",
    inputs: [
      { key: "a", label: "方格边长a", unit: "m", defaultValue: 10, min: 0.001, step: 0.1 },
      { key: "hW", label: "挖深h_挖", unit: "m", defaultValue: 0.5, min: 0, step: 0.001 },
      { key: "hT", label: "填高h_填", unit: "m", defaultValue: 1.5, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "x", label: "零点距离x", unit: "m", precision: 3 }
    ],
    exampleSummary: "边长10m, 挖深0.5m, 填高1.5m，计算得 x = 2.5m",
    riskNotice: "用于绘制零线和分别计算填挖体积；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const sum = Math.abs(values.hW) + Math.abs(values.hT);
      if (sum === 0) return { x: 0 };
      return { x: (values.a * Math.abs(values.hW)) / sum };
    }
  },
  {
    id: "30",
    title: "横断面面积计算(坐标法)",
    formula: "A = 0.5 * Σ(X_i * Y_{i+1} - X_{i+1} * Y_i)",
    inputs: [
      { key: "x1", label: "顶点1 X", unit: "m", defaultValue: 0, min: -999, step: 0.001 },
      { key: "y1", label: "顶点1 Y", unit: "m", defaultValue: 0, min: -999, step: 0.001 },
      { key: "x2", label: "顶点2 X", unit: "m", defaultValue: 2, min: -999, step: 0.001 },
      { key: "y2", label: "顶点2 Y", unit: "m", defaultValue: 0, min: -999, step: 0.001 },
      { key: "x3", label: "顶点3 X", unit: "m", defaultValue: 2, min: -999, step: 0.001 },
      { key: "y3", label: "顶点3 Y", unit: "m", defaultValue: 3, min: -999, step: 0.001 },
      { key: "x4", label: "顶点4 X", unit: "m", defaultValue: 0, min: -999, step: 0.001 },
      { key: "y4", label: "顶点4 Y", unit: "m", defaultValue: 3, min: -999, step: 0.001 }
    ],
    outputs: [
      { key: "A", label: "面积A", unit: "m²", precision: 3 }
    ],
    exampleSummary: "矩形(0,0),(2,0),(2,3),(0,3)，计算得 A = 3m²",
    riskNotice: "顶点必须按顺时针或逆时针顺序排列；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const x = [values.x1, values.x2, values.x3, values.x4];
      const y = [values.y1, values.y2, values.y3, values.y4];
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        area += x[i] * y[next] - x[next] * y[i];
      }
      return { A: Math.abs(area) * 0.5 };
    }
  },
  {
    id: "31",
    title: "单次沉降量计算",
    formula: "ΔH_i = H_i - H_{i-1}",
    inputs: [
      { key: "Hi", label: "本次高程H_i", unit: "m", defaultValue: 10.005, min: -999, step: 0.0001 },
      { key: "HiPrev", label: "上次高程H_{i-1}", unit: "m", defaultValue: 10.010, min: -999, step: 0.0001 }
    ],
    outputs: [
      { key: "deltaH", label: "单次沉降量ΔH", unit: "mm", precision: 1 }
    ],
    exampleSummary: "本次高程10.005m，上次高程10.010m，计算得 ΔH = -5mm",
    riskNotice: "下沉为负，隆起为正；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { deltaH: (values.Hi - values.HiPrev) * 1000 };
    }
  },
  {
    id: "32",
    title: "累计沉降量计算",
    formula: "ΣΔH = H_i - H_0",
    inputs: [
      { key: "Hi", label: "当前高程H_i", unit: "m", defaultValue: 10.005, min: -999, step: 0.0001 },
      { key: "H0", label: "初始高程H_0", unit: "m", defaultValue: 10.025, min: -999, step: 0.0001 }
    ],
    outputs: [
      { key: "sumDeltaH", label: "累计沉降量ΣΔH", unit: "mm", precision: 1 }
    ],
    exampleSummary: "当前高程10.005m，初始高程10.025m，计算得 ΣΔH = -20mm",
    riskNotice: "需与设计允许最大沉降量对比；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { sumDeltaH: (values.Hi - values.H0) * 1000 };
    }
  },
  {
    id: "33",
    title: "沉降速率计算",
    formula: "v = ΔH / Δt",
    inputs: [
      { key: "deltaH", label: "沉降量ΔH", unit: "mm", defaultValue: 5, min: -999, step: 0.1 },
      { key: "deltaT", label: "时间间隔Δt", unit: "d", defaultValue: 10, min: 0.01, step: 1 }
    ],
    outputs: [
      { key: "v", label: "沉降速率v", unit: "mm/d", precision: 2 }
    ],
    exampleSummary: "10天内沉降了5mm，计算得 v = 0.5 mm/d",
    riskNotice: "用于判断沉降是否趋于稳定；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { v: values.deltaH / values.deltaT };
    }
  },
  {
    id: "34",
    title: "建筑物倾斜度计算",
    formula: "i = ΔD / H",
    inputs: [
      { key: "deltaD", label: "水平位移ΔD", unit: "m", defaultValue: 0.05, min: 0, step: 0.001 },
      { key: "H", label: "高度H", unit: "m", defaultValue: 50, min: 0.001, step: 0.1 }
    ],
    outputs: [
      { key: "i", label: "倾斜度i", unit: "", precision: 5 }
    ],
    exampleSummary: "顶部偏移0.05m，高度50m，计算得 i = 0.001 (1‰)",
    riskNotice: "必须符合规范对不同高度建筑的倾斜限值；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { i: values.deltaD / values.H };
    }
  },
  {
    id: "35",
    title: "裂缝展开宽度变化率",
    formula: "v_w = (W_i - W_{i-1}) / Δt",
    inputs: [
      { key: "Wi", label: "本次宽度W_i", unit: "mm", defaultValue: 2.5, min: 0, step: 0.1 },
      { key: "WiPrev", label: "上次宽度W_{i-1}", unit: "mm", defaultValue: 2, min: 0, step: 0.1 },
      { key: "deltaT", label: "时间间隔Δt", unit: "d", defaultValue: 5, min: 0.01, step: 1 }
    ],
    outputs: [
      { key: "vw", label: "变化率v_w", unit: "mm/d", precision: 2 }
    ],
    exampleSummary: "5天内裂缝从2.0mm增加到2.5mm，计算得 v_w = 0.1 mm/d",
    riskNotice: "扩展速率突然增大需报警；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { vw: (values.Wi - values.WiPrev) / values.deltaT };
    }
  },
  {
    id: "36",
    title: "极坐标法放样要素计算",
    formula: "D = sqrt((X_P - X_S)^2 + (Y_P - Y_S)^2); β = α_SP - α_S0",
    inputs: [
      { key: "alphaSP", label: "目标方位角α_SP", unit: "°", defaultValue: 120, min: 0, step: 0.001 },
      { key: "alphaS0", label: "后视方位角α_S0", unit: "°", defaultValue: 30, min: 0, step: 0.001 },
      { key: "D", label: "距离D", unit: "m", defaultValue: 50, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "beta", label: "放样角β", unit: "°", precision: 3 },
      { key: "D_out", label: "放样距离D", unit: "m", precision: 3 }
    ],
    exampleSummary: "目标方位角120°, 后视方位角30°, 距离50m，计算得 β = 90°, D = 50m",
    riskNotice: "全站仪放样最常用方法；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      let beta = values.alphaSP - values.alphaS0;
      if (beta < 0) beta += 360;
      return { beta, D_out: values.D };
    }
  },
  {
    id: "37",
    title: "高程放样计算",
    formula: "b = H_视 - H_设",
    inputs: [
      { key: "H_view", label: "视线高程H_视", unit: "m", defaultValue: 102.5, min: -999, step: 0.001 },
      { key: "H_design", label: "设计高程H_设", unit: "m", defaultValue: 101, min: -999, step: 0.001 }
    ],
    outputs: [
      { key: "b", label: "标尺读数b", unit: "m", precision: 3 }
    ],
    exampleSummary: "视线高程102.5m, 设计高程101.0m，计算得 b = 1.5m",
    riskNotice: "标尺读数必须在标尺量程内；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { b: values.H_view - values.H_design };
    }
  },
  {
    id: "38",
    title: "坡度放样计算",
    formula: "H_n = H_0 + n * ΔD * i",
    inputs: [
      { key: "H0", label: "起点高程H_0", unit: "m", defaultValue: 10, min: -999, step: 0.001 },
      { key: "n", label: "点序号n", unit: "", defaultValue: 2, min: 0, step: 1 },
      { key: "deltaD", label: "点间距ΔD", unit: "m", defaultValue: 20, min: 0, step: 0.001 },
      { key: "i", label: "坡度i", unit: "", defaultValue: -0.02, min: -1, step: 0.0001 }
    ],
    outputs: [
      { key: "Hn", label: "点高程H_n", unit: "m", precision: 3 }
    ],
    exampleSummary: "起点高程10m, 间距20m, 坡度-2%, 第2点(n=2)，计算得 H_2 = 9.2m",
    riskNotice: "上坡i为正，下坡i为负；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { Hn: values.H0 + values.n * values.deltaD * values.i };
    }
  },
  {
    id: "39",
    title: "GNSS RTK坐标转换残差",
    formula: "v = sqrt(v_x^2 + v_y^2 + v_z^2)",
    inputs: [
      { key: "vx", label: "X残差v_x", unit: "m", defaultValue: 0.01, min: 0, step: 0.001 },
      { key: "vy", label: "Y残差v_y", unit: "m", defaultValue: 0.02, min: 0, step: 0.001 },
      { key: "vz", label: "Z残差v_z", unit: "m", defaultValue: 0.02, min: 0, step: 0.001 }
    ],
    outputs: [
      { key: "v", label: "总残差v", unit: "m", precision: 3 }
    ],
    exampleSummary: "X残差0.01m, Y残差0.02m, Z残差0.02m，计算得 v = 0.03m",
    riskNotice: "残差一般要求平面<2cm，高程<3cm；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { v: Math.sqrt(values.vx * values.vx + values.vy * values.vy + values.vz * values.vz) };
    }
  },
  {
    id: "40",
    title: "全站仪自由设站(后方交会)精度",
    formula: "M = sqrt(m_x^2 + m_y^2)",
    inputs: [
      { key: "mx", label: "X中误差m_x", unit: "mm", defaultValue: 2, min: 0, step: 0.1 },
      { key: "my", label: "Y中误差m_y", unit: "mm", defaultValue: 3, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: "M", label: "点位中误差M", unit: "mm", precision: 2 }
    ],
    exampleSummary: "X中误差2mm，Y中误差3mm，计算得 M = 3.6mm",
    riskNotice: "设站精度需高于放样点精度要求；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { M: Math.sqrt(values.mx * values.mx + values.my * values.my) };
    }
  },
  {
    id: "41",
    title: "基坑土方开挖量(棱台法)",
    formula: "V = H/6 * (A_1 + 4*A_0 + A_2)",
    inputs: [
      { key: "H", label: "深度H", unit: "m", defaultValue: 3, min: 0, step: 0.1 },
      { key: "A1", label: "顶面积A_1", unit: "m²", defaultValue: 20, min: 0, step: 0.1 },
      { key: "A2", label: "底面积A_2", unit: "m²", defaultValue: 10, min: 0, step: 0.1 },
      { key: "A0", label: "中截面面积A_0", unit: "m²", defaultValue: 14.5, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: "V", label: "体积V", unit: "m³", precision: 2 }
    ],
    exampleSummary: "底面积10m², 顶面积20m², 中面积14.5m², 深3m，计算得 V = 44m³",
    riskNotice: "适用于底面和顶面均为矩形的放坡基坑；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { V: (values.H / 6) * (values.A1 + 4 * values.A0 + values.A2) };
    }
  },
  {
    id: "42",
    title: "管沟土方量计算",
    formula: "V = (B + m*H) * H * L",
    inputs: [
      { key: "B", label: "底宽B", unit: "m", defaultValue: 1, min: 0, step: 0.1 },
      { key: "H", label: "深度H", unit: "m", defaultValue: 2, min: 0, step: 0.1 },
      { key: "L", label: "长度L", unit: "m", defaultValue: 100, min: 0, step: 1 },
      { key: "m", label: "放坡系数m", unit: "", defaultValue: 0.5, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: "V", label: "体积V", unit: "m³", precision: 2 }
    ],
    exampleSummary: "底宽1m, 深2m, 放坡0.5, 长100m，计算得 V = 400m³",
    riskNotice: "工作面宽度需加在底宽B中计算；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { V: (values.B + values.m * values.H) * values.H * values.L };
    }
  },
  {
    id: "43",
    title: "钻孔灌注桩混凝土充盈系数",
    formula: "K = V_实 / ( π * R^2 * L )",
    inputs: [
      { key: "V_real", label: "实际灌注体积V_实", unit: "m³", defaultValue: 18, min: 0, step: 0.1 },
      { key: "R", label: "桩半径R", unit: "m", defaultValue: 0.5, min: 0, step: 0.01 },
      { key: "L", label: "桩长L", unit: "m", defaultValue: 20, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: "K", label: "充盈系数K", unit: "", precision: 3 }
    ],
    exampleSummary: "桩径1m, 桩长20m, 实际灌注18m³，计算得 K = 1.146",
    riskNotice: "一般要求充盈系数>1.0，过大说明可能扩孔或塌孔；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const vTheory = Math.PI * values.R * values.R * values.L;
      if (vTheory === 0) return { K: 0 };
      return { K: values.V_real / vTheory };
    }
  },
  {
    id: "44",
    title: "桥墩实体体积计算",
    formula: "V = A * H - V_扣减",
    inputs: [
      { key: "A", label: "截面积A", unit: "m²", defaultValue: 10, min: 0, step: 0.1 },
      { key: "H", label: "高度H", unit: "m", defaultValue: 15, min: 0, step: 0.1 },
      { key: "V_sub", label: "扣减体积V_扣减", unit: "m³", defaultValue: 0.5, min: 0, step: 0.01 }
    ],
    outputs: [
      { key: "V", label: "体积V", unit: "m³", precision: 2 }
    ],
    exampleSummary: "截面积10m², 高度15m, 扣减预埋管0.5m³，计算得 V = 149.5m³",
    riskNotice: "必须扣除体积大于0.3m³的孔洞；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { V: values.A * values.H - values.V_sub };
    }
  },
  {
    id: "45",
    title: "隧道超挖量计算",
    formula: "V_超 = Σ(A_实 - A_设) * L_i",
    inputs: [
      { key: "A_real", label: "实际面积A_实", unit: "m²", defaultValue: 52, min: 0, step: 0.1 },
      { key: "A_design", label: "设计面积A_设", unit: "m²", defaultValue: 50, min: 0, step: 0.1 },
      { key: "L", label: "进尺长度L_i", unit: "m", defaultValue: 3, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: "V_over", label: "超挖体积V_超", unit: "m³", precision: 2 }
    ],
    exampleSummary: "设计面积50m², 实际面积52m², 进尺3m，计算得 V_超 = 6m³",
    riskNotice: "超挖部分通常需用同标号混凝土回填；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { V_over: (values.A_real - values.A_design) * values.L };
    }
  },
  {
    id: "46",
    title: "钢筋工程量(理论重量)",
    formula: "W = 0.00617 * d^2 * L",
    inputs: [
      { key: "d", label: "直径d", unit: "mm", defaultValue: 20, min: 0, step: 1 },
      { key: "L", label: "长度L", unit: "m", defaultValue: 10, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: "W", label: "重量W", unit: "kg", precision: 2 }
    ],
    exampleSummary: "直径20mm，长度10m，计算得 W = 24.68kg",
    riskNotice: "0.00617为密度推导系数，适用于常规建筑钢筋；需由专业人员复核。",
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { W: 0.00617 * values.d * values.d * values.L };
    }
  }
];
