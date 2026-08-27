import { useMemo, useState } from "react";
import { Copy, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";

export type FullContractTemplate = {
  id: "auxiliary" | "transport" | "machinery";
  title: string;
  description: string;
  contractType: "transport" | "labor_subcontract" | "machinery_lease";
  pricingMethod: "trip" | "m3" | "month";
  unit: string;
  summary: string;
  body: string;
};

const templates: FullContractTemplate[] = [
  {
    id: "auxiliary", title: "附属工程外包合同", description: "适用于涵洞、边沟、排水、防护、挡墙等按图纸与收方计量的工程。", contractType: "labor_subcontract", pricingMethod: "m3", unit: "方 / 项", summary: "附属工程外包：按设计图纸、变更、清单及经确认收方计量；明确里程、构件、双价、质量安全、结算和保修责任。",
    body: `附属工程外包合同（业务草案）

甲方（发包方）：【填写单位名称】
乙方（承包方）：【填写施工队/公司名称】
项目名称：【填写项目名称】
合同编号：【填写合同编号】
签订地点及日期：【填写】

第一条  工程范围
1. 乙方承包的工程范围为【填写起讫里程、构件名称及工程内容】，包括涵洞、边沟、排水、防护、挡墙及双方书面确认的附属工程。
2. 工程内容以施工图、经批准的设计变更、工程量清单、技术交底和甲方书面通知为准；未经书面确认的新增工程不得作为结算依据。

第二条  计价与计量
1. 计价方式：□固定总价  □综合单价  □按方/按米/按项计量。合同单价及清单详见附件一。
2. 工程量以甲方、监理（如有）及乙方共同确认的收方、隐蔽验收、测量记录为结算依据；构件须注明里程、图纸参数、数量和质量验收状态。
3. 单价口径应明确是否含人工、材料、机械、辅材、运输、税费、安全文明施工、临建、试验检测及其他费用。

第三条  工期与进度
1. 开工日期：【填写】；计划完工日期：【填写】。
2. 乙方应服从甲方总体施工组织、工序衔接和现场调度。因乙方原因影响节点的，按双方确认的处理规则承担责任。

第四条  质量、安全与文明施工
1. 乙方应按设计文件、现行规范、施工方案和技术交底施工，自行完成班组安全教育、劳动保护和作业面管理。
2. 乙方应对材料、工序、隐蔽工程和成品保护负责；不合格工程应按甲方要求无偿返工。
3. 乙方须遵守现场安全、环保、消防、交通和文明施工管理规定；事故责任按法律法规及双方最终签署约定执行。

第五条  结算与付款
1. 乙方按【月/节点】报送经确认的工程量；甲方按合同约定审核、扣除预付款、质量保证金、代扣代缴款项及已确认的违约扣款后支付。
2. 付款条件、付款比例、发票类型、税率、质保金比例和付款期限： 【填写】。
3. 未经确认的工程量、未经验收的工程或无有效资料的项目不纳入当期支付。

第六条  变更、索赔与资料
1. 图纸变更、现场签证、工程量增减和价格调整须经甲方书面确认后执行。
2. 乙方应及时提交收方、验收、试验、影像、人员与机械等资料；逾期或资料不全导致的结算延后由乙方承担相应责任。

第七条  违约、争议与其他
1. 任何一方违约应先书面通知整改；逾期未改的，守约方可按最终签署合同和适用法律处理。
2. 争议先协商；协商不成，按双方约定的管辖法院或仲裁机构解决。
3. 本草案须由项目法务/律师结合项目所在地法律、招标文件、税务和双方真实意思表示审阅后签署生效。

甲方（盖章）：____________  授权代表：____________
乙方（盖章/签字）：________  授权代表：____________
附件一：工程量清单及单价表；附件二：质量安全要求；附件三：结算资料清单。`,
  },
  {
    id: "transport", title: "渣土车运输合同", description: "适用于装卸点、路线、方量、趟次、油款扣减和运输票据结算。", contractType: "transport", pricingMethod: "trip", unit: "趟", summary: "渣土车运输：按确认装卸点、有效路线、车辆核定方量和有效票据计量；明确运价、油款扣减、车辆司机、安全及结算周期。",
    body: `渣土车运输合同（业务草案）

甲方（委托方）：【填写单位名称】
乙方（承运方）：【填写运输公司/车队名称】
项目名称：【填写项目名称】
合同编号：【填写合同编号】

第一条  运输任务
1. 乙方按甲方调度要求，将【填写土石方/材料名称】从【填写装土点】运输至【填写卸土点】；允许路线、预设里程及运价见附件一。
2. 车辆须登记车牌、车型、核定方量、司机姓名和联系电话，持有效证照、保险及现场准入资料进场。

第二条  计量与计价
1. 计价方式：□按趟  □按方  □按吨  □按线路综合单价。单价：【填写】元/【填写单位】。
2. 有效运输量以系统装土/卸土票据、NFC 或车牌识别记录、确认线路、车辆核定方量及异常复核记录为准。
3. 未按指定地点、路线、时间或程序完成装卸确认的趟次，不作为结算依据；异常趟次按双方确认结果处理。

第三条  油料与费用
1. 油料供应方式：□甲方供油并从运费扣除  □乙方自理  □其他【填写】。
2. 甲方供油的，按实际领用升数、当日油价快照和受控领用记录结算扣减；不得以口头记录替代系统或双方确认资料。
3. 过路费、维修、司机工资、保险、罚款及其他费用承担方式：【填写】。

第四条  调度、安全与环保
1. 乙方车辆及司机应服从现场管理员、装卸点负责人和调度安排，严禁超载、超速、酒后驾驶、疲劳驾驶和违规倾倒。
2. 乙方应做好篷布覆盖、车辆冲洗、道路保洁、扬尘控制和交通安全；发生事故应立即报告并依法承担相应责任。

第五条  结算与付款
1. 双方按【日/周/月】核对有效趟次、方量、运费、油款扣减和异常扣款；经确认的对账单作为付款依据。
2. 发票、税率、付款比例、付款期限及保证金约定：【填写】。

第六条  违约、终止与争议
1. 乙方不具备准入条件、严重违反安全调度要求或多次发生虚假票据的，甲方有权暂停调度或解除合同。
2. 争议先协商；协商不成，按双方最终签署约定处理。
3. 本草案须经项目法务/律师审阅并由双方签署后生效。

甲方（盖章）：____________  授权代表：____________
乙方（盖章）：____________  授权代表：____________
附件一：路线及运价表；附件二：车辆司机清单；附件三：对账与结算规则。`,
  },
  {
    id: "machinery", title: "工程机械租赁合同", description: "适用于设备清单、月租/日租/台班、油料、维修、停工和进退场管理。", contractType: "machinery_lease", pricingMethod: "month", unit: "台·月", summary: "工程机械租赁：按设备清单、租期、月租/日租/台班计价，明确油料维修、操作员、进退场、停工、保险安全与结算规则。",
    body: `工程机械租赁合同（业务草案）

甲方（承租方）：【填写单位名称】
乙方（出租方）：【填写设备出租方名称】
项目名称：【填写项目名称】
合同编号：【填写合同编号】

第一条  租赁设备
1. 设备名称、型号、数量、编号、出厂年份、功率/斗容、操作员、进场日期及验收状态详见附件一《设备清单》。
2. 乙方保证设备权属合法、性能完好、证照及保险有效，并满足项目施工和安全管理要求。

第二条  租期与计价
1. 租期自【填写】起至【填写】止；计价方式：□月租  □日租  □台班  □小时  □其他。
2. 租金单价：【填写】元/【填写单位】；不足整月、停工待工、加班台班及跨月计费规则：【填写】。
3. 进退场费、装卸费、运输费、设备保养、故障维修和配件费用承担方式：【填写】。

第三条  油料与操作
1. 油料供应方式：□甲方供油  □乙方自理。甲方供油的，按经确认的领用记录、升数、油价和设备关联台账归集。
2. 操作员由□甲方提供 □乙方提供；操作员须持有效资格并服从项目安全、调度和考勤管理。

第四条  使用、维修与停机
1. 甲方按设备性能合理使用，不得超负荷、违法或擅自转租。
2. 因设备自身故障导致停机的，维修及相应费用按【填写】处理；因甲方调度、场地、材料或不可抗力造成的待工计费规则按【填写】处理。
3. 每日/每月台班、工时、油耗、维修和设备状态应由双方指定人员确认。

第五条  安全、保险与责任
1. 乙方应保证设备保险、年检、操作资质符合要求；甲方负责现场作业条件、交叉作业协调和安全交底。
2. 事故、设备损坏、第三方损失和违章责任按事故原因、适用法律及双方最终签署约定划分。

第六条  结算、违约与争议
1. 双方按【月/节点】核对设备台班、租金、油料、维修、扣款和进退场费用，确认后付款。
2. 发票、税费、保证金、付款期限、违约金及解除条件：【填写】。
3. 本草案经项目法务/律师审阅并由双方签署后生效；争议处理按双方最终签署约定执行。

甲方（盖章）：____________  授权代表：____________
乙方（盖章）：____________  授权代表：____________
附件一：设备清单；附件二：租金及台班确认单；附件三：进退场与维修责任表。`,
  },
];

const standardLegalTails: Record<FullContractTemplate["id"], string> = {
  auxiliary: `第八条  法律适用、合同文件与解释顺序
1. 本合同适用中华人民共和国现行法律。双方确认，合同文件按以下顺序解释：双方签署的补充协议；本合同及专用条款；中标/谈判确认文件；工程量清单及单价表；施工图、经批准的变更和技术标准；双方书面往来资料。前后文件内容不一致的，以较后形成且经双方确认的文件为准。
2. 本合同未尽事项由双方书面补充；任何口头承诺、未经授权人员签字或未按约定程序确认的资料，不当然构成合同变更。

第九条  税费、发票与结算资料
1. 乙方应按约定主体、税率和开票要求提供合法有效发票及结算资料；因乙方资料、资质或发票原因造成付款、抵扣或结算延迟的，由乙方按约定承担相应责任。
2. 甲方付款不视为对未计量、未验收、未提交资料或存在争议事项的最终确认。

第十条  不可抗力、通知与争议解决
1. 因不能预见、不能避免且不能克服的客观情况导致不能履行或需延期履行的，受影响方应及时通知并在合理期限内提供证明；双方应协商减损、顺延、变更或解除事宜。
2. 双方通知应以专人送达、快递、电子邮件或本合同列明的其他书面方式发出；送达地址、联系人及电子邮箱变更时应书面通知对方。
3. 争议先协商，协商不成的，向【合同履行地有管辖权的人民法院/约定仲裁机构】申请解决。

第十一条  生效、文本与审定
1. 本合同经双方有权签字人签字并按约定加盖印章后生效；正本一式【】份，双方各执【】份，具有同等效力。
2. 本文本为业务草案，签署前须由项目法务或执业律师依据项目所在地规定、招标文件、主体资质、税费及真实交易安排审定。`,
  transport: `第七条  法律适用、合同文件与优先顺序
1. 本合同适用中华人民共和国现行法律。合同文件的解释顺序为：补充协议；本合同及专用条款；经确认的路线、运价、车辆司机清单；双方确认的调度、对账和异常处理资料；其他书面资料。
2. 对运价、路线、核定方量、油款扣减、异常票据或运输时段的调整，均须以双方授权人员书面或系统留痕确认，不得仅以口头指令作为结算依据。

第八条  税费、保险、不可抗力与通知
1. 乙方应按约定提供合法有效发票、车辆保险和准入资料；因证照、保险、资质、发票或司机管理不符合约定造成的损失，按法律和双方最终签署约定承担。
2. 因不能预见、不能避免且不能克服的客观情况影响运输任务的，受影响方应及时书面通知并尽力减损；双方协商调整履行、结算或解除安排。
3. 双方通知应按合同约定的送达地址、联系人、电话或电子邮箱发送；信息变更未通知对方的，原信息送达后果由未通知方承担。

第九条  争议解决、生效与审定
1. 争议先协商；协商不成的，向【合同履行地有管辖权的人民法院/约定仲裁机构】申请解决。
2. 本合同经双方有权签字人签字并按约定加盖印章后生效；正本一式【】份，双方各执【】份。
3. 本文本为业务草案，签署前须由项目法务或执业律师结合运输许可、车辆证照、保险、道路通行、项目所在地规定和真实交易安排审定。`,
  machinery: `第七条  合同文件、税费与资料
1. 本合同适用中华人民共和国现行法律。合同文件按补充协议、本合同及专用条款、设备清单、租金台班确认单、进退场与维修责任表、双方书面确认资料的顺序解释。
2. 租金、进退场费、维修费、油料、待工、停机、损坏赔偿和价格调整事项，须经双方授权人员按约定留痕确认；口头安排不当然构成计费或责任调整依据。
3. 乙方应按约定提供合法有效发票、设备权属/保险/年检及操作人员资格资料；因资料或资质瑕疵造成的损失，按法律和双方最终签署约定处理。

第八条  不可抗力、通知与争议
1. 因不能预见、不能避免且不能克服的客观情况影响设备进退场、使用或履行的，受影响方应及时书面通知并提供合理证明；双方应协商减损、顺延、变更或解除事宜。
2. 双方通知应以合同约定的专人送达、快递、电子邮件或其他书面方式发送；送达信息变更应及时书面通知。
3. 争议先协商，协商不成的，向【合同履行地有管辖权的人民法院/约定仲裁机构】申请解决。

第九条  生效、完整协议与审定
1. 本合同经双方有权签字人签字并按约定加盖印章后生效；正本一式【】份，双方各执【】份，具有同等效力。
2. 本合同及双方书面补充文件构成双方就本合同事项的完整约定；未尽事项应书面补充。
3. 本文本为业务草案，签署前须由项目法务或执业律师结合设备权属、保险、许可资质、项目所在地规定、税费与真实交易安排审定。`,
};

for (const template of templates) {
  template.body = template.body.replace("\n甲方（盖章）", `\n${standardLegalTails[template.id]}\n\n甲方（盖章）`);
}

export function buildFullContractTemplatePrintHtml(editableBody: string) {
  const body = escapePrintHtml(editableBody).replace(/\r?\n/g, "<br />");
  return `<h1>合同模板预览</h1><p class="sub">当前编辑正文 · 仅供合同草案核对，不写入合同台账</p><hr class="rule" /><section style="font-size:11px;line-height:1.9;white-space:normal">${body}</section><p class="sub" style="margin-top:18px">请在项目法务或律师审定并补齐主体、价款、期限与附件后使用。</p>`;
}

export default function FullContractTemplates({ onApply }: { onApply: (template: FullContractTemplate) => void }) {
  const [selectedId, setSelectedId] = useState<FullContractTemplate["id"] | null>(null);
  const [previewId, setPreviewId] = useState<FullContractTemplate["id"] | null>(null);
  const selected = useMemo(() => templates.find(template => template.id === selectedId) ?? null, [selectedId]);
  const previewTemplate = useMemo(() => templates.find(template => template.id === previewId) ?? null, [previewId]);
  const [editableBody, setEditableBody] = useState("");
  const open = (template: FullContractTemplate) => { setSelectedId(template.id); setEditableBody(template.body); };
  const copy = async () => { try { await navigator.clipboard.writeText(editableBody); toast.success("合同模板已复制，可粘贴至 Word 或合同正文"); } catch { toast.error("当前浏览器无法自动复制，请手动选中文本复制"); } };
  const print = () => { if (!editableBody.trim()) { toast.error("合同正文为空，无法生成打印文档"); return; } openA4LandscapePrintDocument({ title: "合同模板预览", bodyHtml: buildFullContractTemplatePrintHtml(editableBody) }); };
  return <><Card className="border-[#d8e3e0]"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-[#1f5956]" />完整合同模板库</CardTitle><CardDescription>每份模板均可预览、编辑、复制和打印；“套用至合同草稿”仅带入项目合同台账的关键商务摘要，完整正文请复制保存为双方确认的合同附件。签署前务必由项目法务或律师审阅。</CardDescription></CardHeader><CardContent className="grid gap-3 lg:grid-cols-3">{templates.map(template => <Card key={template.id} className="border-[#e1e8e4]"><CardContent className="p-4"><p className="font-semibold text-[#203c48]">{template.title}</p><p className="mt-2 min-h-12 text-xs leading-5 text-slate-500">{template.description}</p><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPreviewId(template.id)}>完整合同预览</Button><Button size="sm" variant="outline" onClick={() => open(template)}>编辑正文</Button><Button size="sm" onClick={() => onApply(template)}>套用至合同草稿</Button></div></CardContent></Card>)}</CardContent></Card><Dialog open={Boolean(previewTemplate)} onOpenChange={openState => { if (!openState) setPreviewId(null); }}><DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>完整合同预览 · {previewTemplate?.title}</DialogTitle><DialogDescription>以下为标准合同排版业务草案，预览不等同于已签署版本。请在项目法务或律师审定并补齐主体、价款、期限、项目所在地和附件后使用。</DialogDescription></DialogHeader>{previewTemplate ? <article className="mx-auto w-full max-w-[794px] bg-white px-8 py-10 text-[13px] leading-7 text-slate-800 shadow-sm"><header className="border-b-2 border-slate-800 pb-6 text-center"><p className="text-sm tracking-[0.25em] text-slate-500">悦信云智管</p><h2 className="mt-4 text-2xl font-bold tracking-wider">{previewTemplate.title}</h2><p className="mt-5 text-left text-xs text-slate-500">合同编号：【填写】　　项目名称：【填写】　　签订日期：【填写】</p></header><section className="mt-7 whitespace-pre-wrap">{previewTemplate.body}</section><section className="mt-10 border-t pt-6"><h3 className="font-semibold">附件目录</h3><ol className="mt-2 list-decimal space-y-1 pl-5"><li>合同商务条款、计价方式及结算资料清单。</li><li>工程量清单/运输路线运价表/设备清单（按合同类型适用）。</li><li>质量、安全、保险、现场管理及履约资料要求。</li></ol></section><section className="mt-10 grid grid-cols-2 gap-10 border-t pt-8"><div><p>甲方（盖章）：________________</p><p className="mt-8">授权代表：________________</p><p className="mt-8">日期：_______年___月___日</p></div><div><p>乙方（盖章/签字）：____________</p><p className="mt-8">授权代表：________________</p><p className="mt-8">日期：_______年___月___日</p></div></section><p className="mt-10 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">法律审定提示：本预览仅为业务工作草案，不构成针对任何项目的正式法律意见。签署前应由项目法务或执业律师结合《中华人民共和国民法典》、项目所在地规定、招标文件、许可资质、税费及双方真实交易安排审定。</p></article> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => { if (!previewTemplate) return; setPreviewId(null); open(previewTemplate); }}>编辑正文</Button><Button type="button" onClick={() => { if (!previewTemplate) return; setSelectedId(previewTemplate.id); setEditableBody(previewTemplate.body); setPreviewId(null); setTimeout(print, 50); }}><Printer className="mr-1.5 h-4 w-4" />打印合同</Button></DialogFooter></DialogContent></Dialog><Dialog open={Boolean(selected)} onOpenChange={openState => { if (!openState) setSelectedId(null); }}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{selected?.title}</DialogTitle><DialogDescription>可在此编辑合同正文、复制至 Word 或打印。该文本是业务工作草案，不构成正式法律意见。</DialogDescription></DialogHeader><Textarea value={editableBody} onChange={event => setEditableBody(event.target.value)} className="min-h-[60vh] font-mono text-xs leading-6" /><DialogFooter><Button type="button" variant="outline" onClick={copy}><Copy className="mr-1.5 h-4 w-4" />复制正文</Button><Button type="button" variant="outline" onClick={print}><Printer className="mr-1.5 h-4 w-4" />打印</Button>{selected ? <Button type="button" onClick={() => { onApply({ ...selected, body: editableBody }); setSelectedId(null); }}>套用至合同草稿</Button> : null}</DialogFooter></DialogContent></Dialog></>;
}
