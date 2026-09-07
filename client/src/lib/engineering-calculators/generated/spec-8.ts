/**
 * 计量结算合同专业计算器规格
 * 
 * 审计报告编号：audit-8.md
 * 专业分类：计量结算合同专业术语
 * 
 * 说明：
 * 1. 钢筋强度标准值 (ID: 37) 因涉及复杂的标准查询表（GB/T 1499.2-2018），在无完整数据库支持下无法进行数值化计算，已列入不支持列表。
 * 2. 部分涉及工程判定的条目（如混凝土强度评定）提供数值比对辅助，不作最终法律效力判定。
 */

export const unsupportedCalculatorIds = [
  'msc-37', // 钢筋强度标准值：缺乏完整的牌号与强度对照数据库
];

export const categoryCalculatorSpecs = [
  {
    id: 'msc-01',
    title: '土方开挖体积计算',
    formula: 'V = (A1 + A2) / 2 * L',
    inputs: [
      { key: 'A1', label: '断面1面积', unit: 'm²', defaultValue: 10, min: 0, step: 0.1, description: '起始断面面积' },
      { key: 'A2', label: '断面2面积', unit: 'm²', defaultValue: 15, min: 0, step: 0.1, description: '终止断面面积' },
      { key: 'L', label: '间距', unit: 'm', defaultValue: 20, min: 0, step: 0.1, description: '两断面间的距离' }
    ],
    outputs: [
      { key: 'V', label: '开挖体积', unit: 'm³', precision: 2 }
    ],
    exampleSummary: '输入断面面积10m²和15m²，间距20m，计算得体积250m³。',
    riskNotice: '面积差异过大时需改用棱台公式；地形剧烈起伏段禁用。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { A1, A2, L } = values;
      return { V: ((A1 + A2) / 2) * L };
    }
  },
  {
    id: 'msc-02',
    title: '钢筋工程量计算',
    formula: 'W = L * (d² * 0.00617)',
    inputs: [
      { key: 'L', label: '总长度', unit: 'm', defaultValue: 100, min: 0, step: 0.1, description: '钢筋总长度' },
      { key: 'd', label: '直径', unit: 'mm', defaultValue: 12, min: 0, step: 1, description: '钢筋公称直径' }
    ],
    outputs: [
      { key: 'W', label: '钢筋重量', unit: 'kg', precision: 2 }
    ],
    exampleSummary: '输入长度100m，直径12mm，计算得重量88.85kg（原始示例约88.8kg）。',
    riskNotice: '计算结果不含施工损耗；异形钢材禁用。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { L, d } = values;
      return { W: L * (d * d * 0.00617) };
    }
  },
  {
    id: 'msc-03',
    title: '沥青面层面积计量',
    formula: 'A = W_avg * L',
    inputs: [
      { key: 'W_avg', label: '平均宽度', unit: 'm', defaultValue: 7.5, min: 0, step: 0.01, description: '路面设计平均宽度' },
      { key: 'L', label: '长度', unit: 'm', defaultValue: 1000, min: 0, step: 0.1, description: '计量段长度' }
    ],
    outputs: [
      { key: 'A', label: '面层面积', unit: 'm²', precision: 2 }
    ],
    exampleSummary: '输入均宽7.5m，长度1000m，输出面积7500m²。',
    riskNotice: '实际计量需扣除超标检查井等非铺装面积。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { A: values.W_avg * values.L };
    }
  },
  {
    id: 'msc-04',
    title: '混凝土体积计量',
    formula: 'V = L * W * H - V_deduct',
    inputs: [
      { key: 'L', label: '长度', unit: 'm', defaultValue: 10, min: 0, step: 0.01 },
      { key: 'W', label: '宽度', unit: 'm', defaultValue: 2, min: 0, step: 0.01 },
      { key: 'H', label: '高度/厚度', unit: 'm', defaultValue: 1, min: 0, step: 0.01 },
      { key: 'V_deduct', label: '扣除体积', unit: 'm³', defaultValue: 0.5, min: 0, step: 0.01, description: '需扣除的孔洞或嵌入物体积' }
    ],
    outputs: [
      { key: 'V', label: '混凝土体积', unit: 'm³', precision: 3 }
    ],
    exampleSummary: '长10m、宽2m、高1m，扣除0.5m³，净体积19.5m³。',
    riskNotice: '根据通用规范，钢筋及预埋管件所占体积通常不予扣除。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { L, W, H, V_deduct } = values;
      return { V: Math.max(0, L * W * H - V_deduct) };
    }
  },
  {
    id: 'msc-05',
    title: '桩成孔长度计量',
    formula: 'L = E_top - E_bottom',
    inputs: [
      { key: 'E_top', label: '起算高程', unit: 'm', defaultValue: 100.5, step: 0.001, description: '设计或合同约定的成孔起算面高程' },
      { key: 'E_bottom', label: '孔底高程', unit: 'm', defaultValue: 70.2, step: 0.001, description: '终孔后实测孔底高程' }
    ],
    outputs: [
      { key: 'L', label: '成孔长度', unit: 'm', precision: 3 }
    ],
    exampleSummary: '起算高程100.5m，孔底70.2m，计算得长度30.3m。',
    riskNotice: '起算点需按合同严格界定（如护筒顶、自然地面或设计平台）。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { L: Math.abs(values.E_top - values.E_bottom) };
    }
  },
  {
    id: 'msc-06',
    title: '期中结算金额计算',
    formula: 'P = Σ(Qi * Ui)',
    inputs: [
      { key: 'Q1', label: '工程量1', unit: '', defaultValue: 1000, min: 0, step: 0.01 },
      { key: 'U1', label: '单价1', unit: '元', defaultValue: 20, min: 0, step: 0.01 },
      { key: 'Q2', label: '工程量2', unit: '', defaultValue: 100, min: 0, step: 0.01 },
      { key: 'U2', label: '单价2', unit: '元', defaultValue: 500, min: 0, step: 0.01 }
    ],
    outputs: [
      { key: 'P', label: '结算总额', unit: '元', precision: 2 }
    ],
    exampleSummary: '输入土方1000(单价20)与砼100(单价500)，输出70000元。',
    riskNotice: '仅限已验收合格的工程量计入结算。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { P: (values.Q1 * values.U1) + (values.Q2 * values.U2) };
    }
  },
  {
    id: 'msc-07',
    title: '工程量偏差调价',
    formula: '分段计价逻辑 (偏差 > 15%)',
    inputs: [
      { key: 'Q_pl', label: '清单工程量', unit: '', defaultValue: 100, min: 0.001, step: 0.01 },
      { key: 'Q_act', label: '实际工程量', unit: '', defaultValue: 130, min: 0, step: 0.01 },
      { key: 'U', label: '合同单价', unit: '元', defaultValue: 100, min: 0, step: 0.01 },
      { key: 'U_new', label: '调整后单价', unit: '元', defaultValue: 90, min: 0, step: 0.01, description: '超过15%部分的调后单价' }
    ],
    outputs: [
      { key: 'P', label: '结算金额', unit: '元', precision: 2 }
    ],
    exampleSummary: '清单100，实际130，单价100/90，计算得12850元。',
    riskNotice: '需结合合同具体调价条款（如是否包含85%以下调增）。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { Q_pl, Q_act, U, U_new } = values;
      const threshold = Q_pl * 1.15;
      if (Q_act > threshold) {
        return { P: threshold * U + (Q_act - threshold) * U_new };
      }
      return { P: Q_act * U };
    }
  },
  {
    id: 'msc-08',
    title: '暂估价材料调整',
    formula: 'ΔP = (P_act - P_tmp) * Q * (1 + F)',
    inputs: [
      { key: 'P_tmp', label: '暂估单价', unit: '元', defaultValue: 100, min: 0, step: 0.01 },
      { key: 'P_act', label: '确认单价', unit: '元', defaultValue: 120, min: 0, step: 0.01 },
      { key: 'Q', label: '使用数量', unit: '', defaultValue: 1000, min: 0, step: 0.01 },
      { key: 'F', label: '管理费/利润率', unit: '%', defaultValue: 9, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: 'deltaP', label: '价差调整额', unit: '元', precision: 2 }
    ],
    exampleSummary: '单价从100调至120，数量1000，费率9%，调整额21800元。',
    riskNotice: '实际单价需经发包人或监理签证确认。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { P_act, P_tmp, Q, F } = values;
      return { deltaP: (P_act - P_tmp) * Q * (1 + F / 100) };
    }
  },
  {
    id: 'msc-09',
    title: '计日工结算',
    formula: 'E = Σ(T * U) + 材料费',
    inputs: [
      { key: 'T1', label: '人工数量', unit: '工日', defaultValue: 5, min: 0, step: 0.5 },
      { key: 'U1', label: '人工单价', unit: '元', defaultValue: 200, min: 0, step: 1 },
      { key: 'T2', label: '机械数量', unit: '台班', defaultValue: 2, min: 0, step: 0.5 },
      { key: 'U2', label: '机械单价', unit: '元', defaultValue: 1000, min: 0, step: 1 },
      { key: 'M', label: '材料费', unit: '元', defaultValue: 0, min: 0, step: 0.01 }
    ],
    outputs: [
      { key: 'E', label: '计日工总额', unit: '元', precision: 2 }
    ],
    exampleSummary: '人工5(200), 机械2(1000)，总计3000元。',
    riskNotice: '必须具备经现场监理签字的计日工签证单。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { E: (values.T1 * values.U1) + (values.T2 * values.U2) + values.M };
    }
  },
  {
    id: 'msc-10',
    title: '总价措施费调整',
    formula: 'M_new = M_old * (1 + ΔQ / Q_tot)',
    inputs: [
      { key: 'M_old', label: '原措施费', unit: '元', defaultValue: 100000, min: 0, step: 100 },
      { key: 'ratio', label: '直接费变化率', unit: '%', defaultValue: 10, step: 0.1, description: 'ΔQ / Q_tot' }
    ],
    outputs: [
      { key: 'M_new', label: '调整后措施费', unit: '元', precision: 2 }
    ],
    exampleSummary: '原费10万，工程量变化10%，调整后为11万。',
    riskNotice: '仅限与工程量有直接相关性的总价措施项目。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { M_new: values.M_old * (1 + values.ratio / 100) };
    }
  },
  {
    id: 'msc-12',
    title: '人员窝工费索赔',
    formula: 'C = N * T * U_idle',
    inputs: [
      { key: 'N', label: '人数', unit: '人', defaultValue: 20, min: 0, step: 1 },
      { key: 'T', label: '天数', unit: '天', defaultValue: 5, min: 0, step: 0.5 },
      { key: 'U_idle', label: '窝工补偿单价', unit: '元/天', defaultValue: 100, min: 0, step: 1 }
    ],
    outputs: [
      { key: 'C', label: '索赔金额', unit: '元', precision: 2 }
    ],
    exampleSummary: '20人窝工5天，补偿100元/天，总计10000元。',
    riskNotice: '窝工单价通常仅包含基本工资及必要津贴，不计利润。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { C: values.N * values.T * values.U_idle };
    }
  },
  {
    id: 'msc-13',
    title: '机械闲置费索赔',
    formula: 'C = Σ(T_idle * U_dep)',
    inputs: [
      { key: 'T_idle', label: '闲置台班', unit: '台班', defaultValue: 3, min: 0, step: 0.5 },
      { key: 'U_dep', label: '折旧/租赁费率', unit: '元/台班', defaultValue: 500, min: 0, step: 1 }
    ],
    outputs: [
      { key: 'C', label: '索赔金额', unit: '元', precision: 2 }
    ],
    exampleSummary: '3个台班闲置，单价500，总计1500元。',
    riskNotice: '不含燃料动力费及操作人工费。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { C: values.T_idle * values.U_dep };
    }
  },
  {
    id: 'msc-14',
    title: '总部管理费索赔 (伊柯尔公式)',
    formula: 'Claim = (Ratio * Total_OH / Total_Days) * Delay_Days',
    inputs: [
      { key: 'ratio', label: '本项目金额占比', unit: '%', defaultValue: 10, min: 0, max: 100, step: 0.1 },
      { key: 'total_OH', label: '公司同期总管理费', unit: '元', defaultValue: 1000000, min: 0, step: 1000 },
      { key: 'total_days', label: '合同工期', unit: '天', defaultValue: 100, min: 1, step: 1 },
      { key: 'delay_days', label: '延期天数', unit: '天', defaultValue: 10, min: 0, step: 1 }
    ],
    outputs: [
      { key: 'C', label: '分摊管理费索赔', unit: '元', precision: 2 }
    ],
    exampleSummary: '占比10%，总费100万，工期100天，延期10天，索赔10000元。',
    riskNotice: '需证明因工期延误导致总部管理费实际支出增加。',
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { ratio, total_OH, total_days, delay_days } = values;
      const allocable = (ratio / 100) * total_OH;
      const daily = allocable / total_days;
      return { C: daily * delay_days };
    }
  },
  {
    id: 'msc-15',
    title: '新增工程单价确定',
    formula: 'U_new = C * (1 + Rm) * (1 + Rp)',
    inputs: [
      { key: 'C', label: '直接成本', unit: '元', defaultValue: 100, min: 0, step: 0.01 },
      { key: 'Rm', label: '管理费率', unit: '%', defaultValue: 5, min: 0, step: 0.1 },
      { key: 'Rp', label: '利润率', unit: '%', defaultValue: 7, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: 'U_new', label: '新增单价', unit: '元', precision: 2 }
    ],
    exampleSummary: '成本100，管理费5%，利润7%，单价112.35元。',
    riskNotice: '费率应严格采用合同约定的报价浮动率或定额标准。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { C, Rm, Rp } = values;
      return { U_new: C * (1 + Rm / 100) * (1 + Rp / 100) };
    }
  },
  {
    id: 'msc-16',
    title: '预付款扣回计算',
    formula: 'R = A * (C - Ps) / (Pe - Ps)',
    inputs: [
      { key: 'A', label: '预付款总额', unit: '元', defaultValue: 1000000, min: 0 },
      { key: 'Ps', label: '起扣点(累计金额)', unit: '元', defaultValue: 3000000, min: 0 },
      { key: 'Pe', label: '满扣点(累计金额)', unit: '元', defaultValue: 8000000, min: 0.001 },
      { key: 'C', label: '当前累计完成额', unit: '元', defaultValue: 4000000, min: 0 }
    ],
    outputs: [
      { key: 'R', label: '本次扣回金额', unit: '元', precision: 2 }
    ],
    exampleSummary: '预付100万，300万起扣，800万满扣，累计400万时扣回20万。',
    riskNotice: '累计金额超过满扣点后停止扣回。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { A, Ps, Pe, C } = values;
      if (C <= Ps) return { R: 0 };
      if (C >= Pe) return { R: A };
      const range = Pe - Ps;
      return { R: A * (C - Ps) / (range > 0 ? range : 1) };
    }
  },
  {
    id: 'msc-17',
    title: '质量保证金扣留',
    formula: 'D = P_curr * r',
    inputs: [
      { key: 'P_curr', label: '本期结算款', unit: '元', defaultValue: 1000000, min: 0, step: 100 },
      { key: 'r', label: '扣留比例', unit: '%', defaultValue: 3, min: 0, max: 100, step: 0.1 }
    ],
    outputs: [
      { key: 'D', label: '扣留金额', unit: '元', precision: 2 }
    ],
    exampleSummary: '结算100万，比例3%，扣留3万。',
    riskNotice: '累计扣留总额通常不得超过工程结算总价的3%。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { D: values.P_curr * (values.r / 100) };
    }
  },
  {
    id: 'msc-18',
    title: '物价波动调价 (价格指数法)',
    formula: 'ΔP = P0 * [A + B * (Ft / F0) - 1]',
    inputs: [
      { key: 'P0', label: '结算基数', unit: '元', defaultValue: 1000000, min: 0 },
      { key: 'A', label: '定值权重', unit: '', defaultValue: 0.3, min: 0, max: 1, step: 0.01 },
      { key: 'B', label: '变值权重', unit: '', defaultValue: 0.7, min: 0, max: 1, step: 0.01 },
      { key: 'F0', label: '基准期指数', unit: '', defaultValue: 100, min: 0.001 },
      { key: 'Ft', label: '现行期指数', unit: '', defaultValue: 110, min: 0.001 }
    ],
    outputs: [
      { key: 'deltaP', label: '价格调整额', unit: '元', precision: 2 }
    ],
    exampleSummary: '基数100万，权重0.3/0.7，指数从100升至110，调增7万。',
    riskNotice: '定值权重与各变值权重之和必须等于1。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const { P0, A, B, F0, Ft } = values;
      return { deltaP: P0 * (A + B * (Ft / F0) - 1) };
    }
  },
  {
    id: 'msc-19',
    title: '实际应支付款',
    formula: 'P_net = P_set - Σ扣项',
    inputs: [
      { key: 'P_set', label: '本期结算总额', unit: '元', defaultValue: 1000000, min: 0 },
      { key: 'D1', label: '预付款扣回', unit: '元', defaultValue: 200000, min: 0 },
      { key: 'D2', label: '质保金扣留', unit: '元', defaultValue: 30000, min: 0 },
      { key: 'D3', label: '其他扣款', unit: '元', defaultValue: 10000, min: 0 }
    ],
    outputs: [
      { key: 'P_net', label: '应付净额', unit: '元', precision: 2 }
    ],
    exampleSummary: '结算100万，扣回20万、质保3万、其他1万，净付76万。',
    riskNotice: '支付比例限制需根据合同另行应用。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { P_net: values.P_set - values.D1 - values.D2 - values.D3 };
    }
  },
  {
    id: 'msc-20',
    title: '逾期支付违约金',
    formula: 'I = P_arr * R * D / 365',
    inputs: [
      { key: 'P_arr', label: '欠款金额', unit: '元', defaultValue: 1000000, min: 0 },
      { key: 'R', label: '年利率', unit: '%', defaultValue: 4, min: 0, step: 0.1 },
      { key: 'D', label: '逾期天数', unit: '天', defaultValue: 30, min: 0, step: 1 }
    ],
    outputs: [
      { key: 'I', label: '违约金金额', unit: '元', precision: 2 }
    ],
    exampleSummary: '欠款100万，年利率4%，逾期30天，违约金3287.67元。',
    riskNotice: '利率标准应按合同约定或参照同期LPR。',
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      return { I: values.P_arr * (values.R / 100) * values.D / 365 };
    }
  },
  {
    id: 'msc-21',
    title: '增值税销项税',
    formula: 'Tout = 不含税额 * 9%',
    inputs: [
      { key: 'P', label: '不含税销售额', unit: '元', defaultValue: 1000000, min: 0, step: 1000 }
    ],
    outputs: [
      { key: 'Tout', label: '销项税额', unit: '元', precision: 2 }
    ],
    exampleSummary: '不含税额100万，销项税9万。',
    riskNotice: '适用于一般计税法；简易计税法不适用此税率。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { Tout: values.P * 0.09 };
    }
  },
  {
    id: 'msc-22',
    title: '附加税费计算',
    formula: 'Tsur = Tvat * ΣR',
    inputs: [
      { key: 'Tvat', label: '应交增值税', unit: '元', defaultValue: 100000, min: 0 },
      { key: 'R', label: '综合附加税率', unit: '%', defaultValue: 12, min: 0, step: 0.1, description: '含城建税、教育费附加等' }
    ],
    outputs: [
      { key: 'Tsur', label: '附加税费', unit: '元', precision: 2 }
    ],
    exampleSummary: '增值税10万，附加税率12%，税费1.2万。',
    riskNotice: '税率依企业所在地（市区、县城等）而异。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { Tsur: values.Tvat * (values.R / 100) };
    }
  },
  {
    id: 'msc-23',
    title: '资金现值计算',
    formula: 'PV = FV / (1 + r)^n',
    inputs: [
      { key: 'FV', label: '未来终值', unit: '元', defaultValue: 1000000, min: 0 },
      { key: 'r', label: '年折现率', unit: '%', defaultValue: 5, min: -100, step: 0.1 },
      { key: 'n', label: '年限', unit: '年', defaultValue: 3, min: 0, step: 0.5 }
    ],
    outputs: [
      { key: 'PV', label: '资金现值', unit: '元', precision: 2 }
    ],
    exampleSummary: '3年后100万，折现率5%，现值86.38万。',
    riskNotice: '折现率的微小变化会对计算结果产生显著影响。',
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { FV, r, n } = values;
      return { PV: FV / Math.pow(1 + r / 100, n) };
    }
  },
  {
    id: 'msc-24',
    title: '安全文明施工费',
    formula: 'Csafe = 基价 * 费率',
    inputs: [
      { key: 'base', label: '定额基价', unit: '元', defaultValue: 10000000, min: 0 },
      { key: 'ratio', label: '规定费率', unit: '%', defaultValue: 2, min: 0, step: 0.01 }
    ],
    outputs: [
      { key: 'Csafe', label: '安全文明费', unit: '元', precision: 2 }
    ],
    exampleSummary: '基价1000万，费率2%，金额20万。',
    riskNotice: '该项费用需专款专用，严禁挪作他用。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { Csafe: values.base * (values.ratio / 100) };
    }
  },
  {
    id: 'msc-25',
    title: '农民工工资保证金',
    formula: 'D = 合同总价 * 比例',
    inputs: [
      { key: 'total', label: '合同总价', unit: '元', defaultValue: 50000000, min: 0 },
      { key: 'ratio', label: '缴纳比例', unit: '%', defaultValue: 2, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: 'D', label: '保证金金额', unit: '元', precision: 2 }
    ],
    exampleSummary: '总价5000万，比例2%，保证金100万。',
    riskNotice: '各地政策通常设有封顶限额，需核实当地标准。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      return { D: values.total * (values.ratio / 100) };
    }
  },
  {
    id: 'msc-34',
    title: '施工配合比换算',
    formula: '含水率修正逻辑',
    inputs: [
      { key: 'mw', label: '理论用水量', unit: 'kg', defaultValue: 180, min: 0 },
      { key: 'ms', label: '理论砂用量', unit: 'kg', defaultValue: 700, min: 0 },
      { key: 'mg', label: '理论石用量', unit: 'kg', defaultValue: 1100, min: 0 },
      { key: 'ws', label: '砂含水率', unit: '%', defaultValue: 4, min: 0, step: 0.1 },
      { key: 'wg', label: '石含水率', unit: '%', defaultValue: 1, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: 'mw_a', label: '施工用水量', unit: 'kg', precision: 1 },
      { key: 'ms_a', label: '施工砂用量', unit: 'kg', precision: 1 },
      { key: 'mg_a', label: '施工石用量', unit: 'kg', precision: 1 }
    ],
    exampleSummary: '输入理论配比及砂4%石1%含水率，输出施工配比：水141, 砂728, 石1111。',
    riskNotice: '理论配比换算结果不得替代现场试配强度验证。',
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { mw, ms, mg, ws, wg } = values;
      const ws_r = ws / 100;
      const wg_r = wg / 100;
      return {
        mw_a: mw - (ms * ws_r) - (mg * wg_r),
        ms_a: ms * (1 + ws_r),
        mg_a: mg * (1 + wg_r)
      };
    }
  },
  {
    id: 'msc-35',
    title: '水泥稳定碎石配比',
    formula: 'mc = md * rc; mw = (md + mc) * w',
    inputs: [
      { key: 'md', label: '干集料质量', unit: 'kg', defaultValue: 1000, min: 0 },
      { key: 'rc', label: '水泥剂量', unit: '%', defaultValue: 5, min: 0, step: 0.1 },
      { key: 'w', label: '最佳含水率', unit: '%', defaultValue: 6, min: 0, step: 0.1 }
    ],
    outputs: [
      { key: 'mc', label: '水泥用量', unit: 'kg', precision: 2 },
      { key: 'mw', label: '加水量', unit: 'kg', precision: 2 }
    ],
    exampleSummary: '干料1000，剂量5%，含水率6%，得水泥50，水63。',
    riskNotice: '生产配比必须通过室内试验确定最佳含水率与最大干密度。',
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const mc = values.md * (values.rc / 100);
      const mw = (values.md + mc) * (values.w / 100);
      return { mc, mw };
    }
  },
  {
    id: 'msc-38',
    title: '混凝土强度评定 (辅助测算)',
    formula: '统计法评定逻辑',
    inputs: [
      { key: 'f_k', label: '设计强度等级', unit: 'MPa', defaultValue: 30, min: 0 },
      { key: 'n', label: '试件组数', unit: '组', defaultValue: 15, min: 1 },
      { key: 'f_avg', label: '强度平均值', unit: 'MPa', defaultValue: 35, min: 0 },
      { key: 's', label: '标准差', unit: 'MPa', defaultValue: 2, min: 0 },
      { key: 'l1', label: '合格判定系数λ1', unit: '', defaultValue: 1.7 },
      { key: 'l2', label: '合格判定系数λ2', unit: '', defaultValue: 0.9 }
    ],
    outputs: [
      { key: 'req1', label: '平均值要求值', unit: 'MPa', precision: 2 },
      { key: 'req2', label: '最小值要求值', unit: 'MPa', precision: 2 }
    ],
    exampleSummary: 'C30, 15组, 均值35, 标准差2, 系数1.7/0.9，输出要求值33.4和27。',
    riskNotice: '本工具仅提供数值比对，最终合格判定应由专业人员依据完整检测报告作出。',
    requiresProfessionalReview: true,
    calculate: (values: Record<string, number>) => {
      const { f_k, f_avg, s, l1, l2 } = values;
      return {
        req1: f_k + l1 * s,
        req2: l2 * f_k
      };
    }
  },
  {
    id: 'msc-40',
    title: '缺陷责任期计算',
    formula: '日期累加逻辑',
    inputs: [
      { key: 'start_y', label: '验收年', unit: '年', defaultValue: 2023, min: 1900 },
      { key: 'start_m', label: '验收月', unit: '月', defaultValue: 1, min: 1, max: 12 },
      { key: 'start_d', label: '验收日', unit: '日', defaultValue: 1, min: 1, max: 31 },
      { key: 'duration', label: '期限', unit: '月', defaultValue: 24, min: 0 }
    ],
    outputs: [
      { key: 'end_y', label: '期满年', unit: '年', precision: 0 },
      { key: 'end_m', label: '期满月', unit: '月', precision: 0 },
      { key: 'end_d', label: '期满日', unit: '日', precision: 0 }
    ],
    exampleSummary: '2023-01-01验收，期限24个月，期满日期为2025-01-01。',
    riskNotice: '责任期从工程通过交工验收之日起计算。',
    requiresProfessionalReview: false,
    calculate: (values: Record<string, number>) => {
      const date = new Date(values.start_y, values.start_m - 1, values.start_d);
      date.setMonth(date.getMonth() + values.duration);
      return {
        end_y: date.getFullYear(),
        end_m: date.getMonth() + 1,
        end_d: date.getDate()
      };
    }
  }
];
