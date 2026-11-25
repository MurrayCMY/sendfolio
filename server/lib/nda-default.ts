// A generic, one-way sample NDA that is installed the first time the platform needs one.
// IT IS A TEMPLATE, NOT LEGAL ADVICE. Replace it in Admin -> Settings -> NDA with text your own counsel has approved.
// Paragraphs are separated by blank lines; **x** marks bold. "{{COMPANY}}" is replaced by COMPANY_NAME.
import { config } from "./config";

export const NDA_DEFAULT_LABEL = "Sample template v1";

const EN = `**NON-DISCLOSURE AGREEMENT**

This Non-Disclosure Agreement (the "Agreement") is made between {{COMPANY}} (the "Company") and the individual accepting it, on his or her own behalf and on behalf of the organisation he or she represents (the "Recipient"), and takes effect when the Recipient accepts it online (the "Effective Date").

The Recipient wishes to evaluate a potential investment in, or business relationship with, the Company (the "Purpose"). For the Purpose the Company may share confidential information and materials, including through its document-sharing platform.

1. **Confidential Information.** "Confidential Information" means all non-public information disclosed by or for the Company to the Recipient in any form in connection with the Purpose, including documents made available through the platform, business plans, financial and technical information, and the existence and terms of any proposed transaction.

2. **Obligations.** The Recipient will (a) keep the Confidential Information strictly confidential using at least reasonable care; (b) use it only for the Purpose; (c) disclose it only to those of its partners, officers, employees and professional advisers who need to know it for the Purpose and are bound by confidentiality duties at least as protective as these (the Recipient is responsible for their compliance); and (d) not copy, download, screenshot, forward or share access links to materials except as this Agreement allows.

3. **Exceptions.** These obligations do not apply to information that (a) is or becomes public through no fault of the Recipient; (b) the Recipient already lawfully knew; (c) the Recipient lawfully receives from a third party free of any duty of confidence; or (d) the Recipient develops independently without using the Confidential Information.

4. **Compelled Disclosure.** The Recipient may disclose Confidential Information to the extent required by law, regulation or court order, provided that, where legally permitted, it gives the Company prompt written notice and discloses only what is required.

5. **Return or Destruction.** On the Company's written request, or when the Purpose ends, the Recipient will promptly return or destroy the Confidential Information and all copies, except copies it must keep by law or in routine backups, which remain subject to this Agreement.

6. **No License; No Warranty.** All Confidential Information remains the Company's property. Nothing in this Agreement grants any licence or right other than the limited right to use it for the Purpose. Confidential Information is provided "as is" without warranty of any kind.

7. **No Obligation.** Neither party is obliged to disclose information, negotiate or enter into any transaction. Nothing here is an offer of securities.

8. **Term.** This Agreement applies to information disclosed in the two (2) years after the Effective Date, and the Recipient's duties continue for two (2) years after the Effective Date (and for as long as any trade secret remains a trade secret under applicable law).

9. **Remedies.** The Recipient acknowledges that a breach may cause the Company irreparable harm for which damages are not an adequate remedy, so the Company may seek injunctive or other equitable relief in addition to any other remedy.

10. **General.** This Agreement is the entire agreement on its subject and may be changed only in writing. If a provision is unenforceable, the rest remains in force. The Recipient may not assign it without the Company's written consent. It is governed by the laws of [GOVERNING LAW - set this before use], and the courts or arbitral tribunal of [JURISDICTION - set this before use] have jurisdiction. The Recipient may accept this Agreement electronically by ticking the box and clicking accept, which has the same effect as a handwritten signature; the platform's record of acceptance (name, email, time, IP address and agreement version) is evidence of acceptance.`;

const ZH = `**保密协议**

本保密协议（"本协议"）由 {{COMPANY}}（"公司"）与同意本协议的个人订立，该个人代表本人及其所代表的机构（"接收方"），自接收方在线同意之日（"生效日"）起生效。

接收方拟评估对公司的潜在投资或业务合作（"目的"）。为此，公司可能通过其文档分享平台或其他方式向接收方提供保密信息和资料。

1. **保密信息。**"保密信息"是指公司或其代表为上述目的以任何形式向接收方披露的全部非公开信息，包括通过平台提供的文件、商业计划、财务和技术信息，以及任何拟议交易的存在及其条款。

2. **义务。**接收方应：(a) 以不低于合理注意的标准对保密信息严格保密；(b) 仅为上述目的使用保密信息；(c) 仅向因上述目的确需知悉、且受不低于本协议保护程度的保密义务约束的合伙人、高级管理人员、员工和专业顾问披露（接收方对其遵守情况负责）；(d) 除本协议允许外，不复制、下载、截屏、转发资料或分享访问链接。

3. **例外。**下列信息不受上述义务约束：(a) 非因接收方过错而已公开或将公开的；(b) 接收方此前已合法知悉的；(c) 接收方从不负保密义务的第三方合法获得的；(d) 接收方未使用保密信息而独立开发的。

4. **依法披露。**接收方可在法律、法规或法院命令要求的范围内披露保密信息，但在法律允许的情况下应及时书面通知公司，并仅披露被要求披露的部分。

5. **返还或销毁。**应公司书面要求或上述目的结束时，接收方应及时返还或销毁全部保密信息及其副本，但依法必须保留的副本或例行备份除外，该等副本仍受本协议约束。

6. **无许可；无保证。**全部保密信息仍为公司财产。除为上述目的使用保密信息的有限权利外，本协议不授予任何许可或权利。保密信息按"现状"提供，不附带任何保证。

7. **无义务。**任何一方均无义务披露信息、进行谈判或达成任何交易。本协议不构成证券要约。

8. **期限。**本协议适用于生效日起两（2）年内披露的信息，接收方的义务在生效日后两（2）年内持续有效（对于依适用法律仍构成商业秘密的信息，只要其仍是商业秘密，义务持续有效）。

9. **救济。**接收方确认，违约可能给公司造成无法弥补的损害，金钱赔偿不足以救济，因此公司除可主张其他救济外，还可寻求禁令或其他衡平救济。

10. **一般条款。**本协议为双方就其标的达成的完整协议，仅可书面修改。任何条款不可执行的，其余条款继续有效。未经公司书面同意，接收方不得转让本协议。本协议适用 [适用法律——使用前请填写]，由 [管辖地——使用前请填写] 的法院或仲裁机构管辖。接收方可通过勾选并点击同意以电子方式接受本协议，其效力等同于手写签名；平台记录的同意信息（姓名、邮箱、时间、IP 地址和协议版本）可作为同意的证据。`;

const fill = (s: string) => s.replace(/\{\{COMPANY\}\}/g, config.companyName);
export const NDA_DEFAULT_EN = () => fill(EN);
export const NDA_DEFAULT_ZH = () => fill(ZH);
