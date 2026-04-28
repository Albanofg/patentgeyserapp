export default function TermsPage() {
  return (
    <>
      <section className="py-16 px-6 border-b border-navy-100 bg-navy-50">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-semibold text-navy-500 uppercase tracking-wider mb-2">
            Geyser Inc.
          </p>
          <h1 className="text-4xl lg:text-5xl font-display text-navy-900 mb-2">
            User Agreement
          </h1>
          <p className="text-navy-600 text-sm font-medium mb-4">
            (Clickwrap Agreement)
          </p>
          <p className="text-navy-500 text-sm">
            Effective Date: March 10, 2026 &nbsp;|&nbsp; Last Updated: March 12,
            2026
          </p>
          <p className="text-navy-500 text-sm mt-4 leading-relaxed">
            251 Little Falls Drive<br />
            Wilmington, DE 19808<br />
            Email: info@patentgeyser.com<br />
            Website: patentgeyser.com
          </p>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto prose-navy">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8 text-sm text-amber-900 leading-relaxed">
            <p className="font-bold mb-2">
              {'IMPORTANT: PLEASE READ THIS AGREEMENT CAREFULLY BEFORE USING GEYSER\u2122 PROVISIONAL PATENT DRAFTING SOFTWARE.'}
            </p>
            <p>
              {'BY CLICKING \u201CI AGREE,\u201D \u201CACCEPT,\u201D OR BY ACCESSING OR USING ANY PART OF THE SERVICE, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY ALL TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT USE THE SERVICE.'}
            </p>
            <p className="mt-2">
              {'THIS AGREEMENT CONTAINS A BINDING ARBITRATION CLAUSE AND CLASS ACTION WAIVER IN SECTION 17, WHICH AFFECT YOUR LEGAL RIGHTS. PLEASE READ THEM CAREFULLY.'}
            </p>
          </div>

          <h2>{'1. Definitions'}</h2>
          <p>
            {'\u201CAgreement\u201D means this User Agreement and Terms of Service, including all exhibits, schedules, and documents incorporated by reference, as may be amended from time to time.'}
          </p>
          <p>
            {'\u201CCompany,\u201D \u201Cwe,\u201D \u201Cus,\u201D or \u201Cour\u201D means Geyser Inc., and its owners, operators, officers, directors, employees, agents, successors, and assigns.'}
          </p>
          <p>
            {'\u201CService\u201D or \u201CPlatform\u201D means the Geyser\u2122 provisional patent drafting software located at patentgeyser.com, including all AI-powered modules, workflows, tools, features, content, and related services made available through the Platform.'}
          </p>
          <p>
            {'\u201CUser,\u201D \u201Cyou,\u201D or \u201Cyour\u201D means any individual or entity that accesses or uses the Service in any capacity.'}
          </p>
          <p>
            {'\u201COutputs\u201D or \u201CDrafts\u201D means all documents, text, claims, specifications, diagrams, analyses, reports, and any other content generated, produced, or compiled by the Service, including but not limited to provisional patent application drafts, claim sets, prior art search results, white space analyses, and technical drawings.'}
          </p>
          <p>
            {'\u201CPatentFit\u2122 Directory\u201D means the free patent practitioner directory offered under the Geyser Inc. brand, which operates as a separate product from the drafting Service.'}
          </p>
          <p>
            {'\u201CSubscription\u201D means the paid plan through which Users access the AI-powered patent drafting modules of the Service.'}
          </p>
          <p>
            {'\u201CUSPTO\u201D means the United States Patent and Trademark Office.'}
          </p>
          <p>
            {'\u201CRegistered Patent Practitioner\u201D means a patent attorney or patent agent registered to practice before the USPTO under 37 C.F.R. \u00A7 11.'}
          </p>
          <p>
            {'\u201CProvisional Patent Application\u201D means a preliminary patent filing under 35 U.S.C. \u00A7 111(b) that establishes a priority date but does not mature into a patent without the subsequent filing of a non-provisional application within twelve (12) months.'}
          </p>

          <h2>{'2. Critical Disclaimer: Geyser Inc. Is Not a Law Firm and Does Not Provide Legal Advice'}</h2>

          <h3>{'2.1 No Attorney-Client Relationship'}</h3>
          <p>
            {'Geyser\u2122 provisional patent drafting software is a software-as-a-service (SaaS) technology platform. Geyser Inc. is NOT a law firm, does NOT employ attorneys for the purpose of providing legal advice to Users, and does NOT practice law in any jurisdiction. Your use of the Service does not create an attorney-client relationship, a solicitor-client relationship, or any fiduciary relationship between you and Geyser Inc., its owners, employees, contractors, or affiliates. No privileged communication exists between you and the Service.'}
          </p>

          <h3>{'2.2 No Unauthorized Practice of Law'}</h3>
          <p>
            {'The Service is a self-help technology tool that assists Users in organizing and structuring their own ideas into a draft document format. All AI-generated content is produced by artificial intelligence models and automated workflows, not by licensed attorneys, patent agents, or any human legal professional. The Service does not and cannot:'}
          </p>
          <p>{'(a) provide legal opinions or legal advice of any kind;'}</p>
          <p>{'(b) represent you before the USPTO or any other governmental body;'}</p>
          <p>{'(c) make legal determinations regarding the patentability, novelty, non-obviousness, or utility of any invention;'}</p>
          <p>{'(d) guarantee or predict the outcome of any patent application or prosecution;'}</p>
          <p>{'(e) substitute for the independent judgment of a Registered Patent Practitioner; or'}</p>
          <p>{'(f) file any documents with the USPTO or any other patent office on your behalf.'}</p>

          <h3>{'2.3 AI Limitations and Accuracy'}</h3>
          <p>{'You expressly acknowledge and agree that:'}</p>
          <p>{'(a) all Outputs are generated by artificial intelligence systems that may produce inaccurate, incomplete, misleading, or legally deficient content;'}</p>
          <p>{`(b) AI models may \u201Challucinate\u201D (generate plausible but incorrect information), including but not limited to fabricated prior art references, non-existent patent numbers, inaccurate legal citations, and erroneous claim constructions;`}</p>
          <p>{'(c) AI-generated patent claims may fail to meet the requirements of 35 U.S.C. \u00A7\u00A7 101, 102, 103, or 112;'}</p>
          <p>{'(d) prior art search results are not exhaustive and should not be relied upon as a complete search of the prior art landscape; and'}</p>
          <p>{'(e) the Service has no duty to update, correct, or supplement Outputs after they are delivered.'}</p>

          <h3>{'2.4 Mandatory Professional Review'}</h3>
          <p className="font-semibold">
            {'YOU ACKNOWLEDGE AND AGREE THAT ALL OUTPUTS GENERATED BY THE SERVICE ARE PRELIMINARY DRAFTS INTENDED SOLELY AS A STARTING POINT, AND THAT YOU ARE STRONGLY AND URGENTLY ADVISED TO RETAIN A REGISTERED PATENT PRACTITIONER TO INDEPENDENTLY REVIEW, EVALUATE, REVISE, AND APPROVE ALL OUTPUTS BEFORE FILING ANY DOCUMENT WITH THE USPTO OR ANY OTHER PATENT OFFICE.'}
          </p>
          <p>{'Filing AI-generated patent documents without professional review may result in:'}</p>
          <p>{'(a) rejection of your application;'}</p>
          <p>{'(b) loss of patent rights;'}</p>
          <p>{'(c) estoppel or prosecution history issues that limit the scope of any resulting patent;'}</p>
          <p>{'(d) unenforceable claims;'}</p>
          <p>{'(e) wasted filing fees;'}</p>
          <p>{'(f) loss of your priority date if the provisional application is deficient; or'}</p>
          <p>{'(g) disclosure of your invention without obtaining meaningful patent protection.'}</p>
          <p>{'Geyser Inc. shall not be liable for any consequences arising from your decision to file Outputs without independent professional review.'}</p>

          <h3>{'2.5 USPTO Guidance on AI-Generated Documents'}</h3>
          <p>
            {'You acknowledge that the USPTO has issued guidance (89 FR 25609, April 11, 2024, and subsequent updates) regarding the use of AI-based tools in patent practice. This guidance imposes duties on practitioners and applicants, including the duty to verify technical accuracy, ensure proper inventorship attribution, disclose material AI involvement, and comply with the duty of candor and good faith under 37 C.F.R. \u00A7 1.56. You are solely responsible for understanding and complying with all applicable USPTO rules, regulations, and guidance when using Outputs from the Service.'}
          </p>

          <h3>{'2.6 No Guarantee of Patentability or Protection'}</h3>
          <p>
            {'Nothing in the Outputs, including any AI-generated analysis, prior art assessment, white space identification, or claim strategy, constitutes a guarantee, warranty, or representation that your invention is patentable, novel, non-obvious, or otherwise entitled to patent protection. The patentability determination is made exclusively by the USPTO and, on appeal, by the courts.'}
          </p>

          <h2>{'3. Nature of the Service'}</h2>

          <h3>{'3.1 Drafting Assistance Tool'}</h3>
          <p>
            {'The Service provides AI-assisted drafting tools organized into modular workflows (Modules 1 through 5) designed to help Users structure, refine, and articulate their inventive concepts into a draft provisional patent application format. The Service is a drafting assistance tool. It is not a filing service, a prosecution service, or a legal representation service. At no point does Geyser Inc. file, transmit, or submit any document to the USPTO or any patent office on your behalf.'}
          </p>

          <h3>{'3.2 User Responsibility'}</h3>
          <p>{'You are solely responsible for:'}</p>
          <p>{'(a) the accuracy, completeness, and truthfulness of all information you provide to the Service;'}</p>
          <p>{'(b) all decisions regarding the content, scope, and strategy of your patent application;'}</p>
          <p>{'(c) determining whether to file a patent application based on the Outputs;'}</p>
          <p>{'(d) filing any patent application with the USPTO or any other patent office;'}</p>
          <p>{'(e) all interactions with the USPTO and any patent practitioner you retain; and'}</p>
          <p>{'(f) meeting all statutory deadlines, including but not limited to the twelve (12) month deadline to convert a provisional application into a non-provisional application under 35 U.S.C. \u00A7 111(b).'}</p>

          <h3>{'3.3 PatentFit\u2122 Directory'}</h3>
          <p>
            {'The PatentFit\u2122 Directory is a separate, free directory service that indexes patent practitioners based on their publicly available USPTO filing history. The PatentFit\u2122 Directory does not endorse, recommend, or guarantee the qualifications, competence, or suitability of any listed practitioner. The Directory\u2019s PatentFit Score is a proprietary metric based on publicly available filing data and does not constitute a rating, endorsement, or evaluation of any practitioner\u2019s legal skills. Inclusion in the Directory does not create any agency, referral, or professional relationship between Geyser Inc. and any practitioner. You are solely responsible for selecting, evaluating, and retaining any practitioner, and any engagement between you and a practitioner is governed exclusively by the terms of your agreement with that practitioner.'}
          </p>

          <h2>{'4. Eligibility and Account Registration'}</h2>
          <p>
            {'4.1 You must be at least eighteen (18) years of age and have the legal capacity to enter into binding agreements to use the Service. By using the Service, you represent and warrant that you meet these requirements.'}
          </p>
          <p>
            {'4.2 You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized access to or use of your account.'}
          </p>
          <p>
            {'4.3 You represent and warrant that any invention information you provide to the Service is either owned by you or that you have the legal right and authorization from all rights holders (including any co-inventors or employers) to use such information in connection with the Service.'}
          </p>

          <h2>{'5. Subscription, Payment, and Cancellation'}</h2>
          <p>
            {'5.1 Access to the AI-powered drafting modules of the Service requires a paid Subscription. Subscription pricing, billing cycles, and trial periods are as described on the Platform at the time of purchase and are processed through our third-party payment processor.'}
          </p>
          <p>
            {'5.2 Subscriptions automatically renew at the end of each billing cycle unless canceled before the renewal date. You may cancel your Subscription at any time through the Platform or by contacting us. Cancellation takes effect at the end of the current billing period.'}
          </p>
          <p>
            {'5.3 All fees are non-refundable except as required by applicable law. We reserve the right to modify pricing at any time, with notice to active subscribers. Continued use after a pricing change constitutes acceptance of the new pricing.'}
          </p>
          <p>
            {'5.4 Upon cancellation or expiration of your Subscription, you retain read-only access to your existing project data but lose the ability to execute new AI processing workflows.'}
          </p>

          <h2>{'6. Intellectual Property Rights'}</h2>

          <h3>{'6.1 Your Inventions'}</h3>
          <p>{'As between you and Geyser Inc., you retain all intellectual property rights in and to:'}</p>
          <p>{`(a) the inventive concepts, technical descriptions, source code, and other materials you provide to the Service (\u201CUser Content\u201D); and`}</p>
          <p>{'(b) the substantive inventive content reflected in the Outputs, to the extent such content originates from your User Content.'}</p>
          <p>{'Geyser Inc. does not claim ownership of your inventions.'}</p>

          <h3>{'6.2 License to Us'}</h3>
          <p>
            {'By submitting User Content to the Service, you grant Geyser Inc. a limited, non-exclusive, non-transferable, revocable license to process, transmit, and analyze your User Content solely for the purpose of providing the Service to you. We will not use your User Content to train AI models, sell to third parties, or share with other Users.'}
          </p>

          <h3>{'6.3 Platform IP'}</h3>
          <p>
            {'Geyser Inc. retains all rights in and to the Platform, including all software, algorithms, workflows, user interfaces, designs, and proprietary methodologies (including the PatentFit\u2122 Score algorithm). Nothing in this Agreement grants you any license to the Platform\u2019s underlying technology.'}
          </p>

          <h3>{'6.4 AI-Generated Content'}</h3>
          <p>
            {'You acknowledge that portions of the Outputs may be generated by AI models and that the legal status of AI-generated content under intellectual property law (including copyright law) is evolving and uncertain. Geyser Inc. makes no representations regarding the copyrightability, ownership, or protectability of AI-generated portions of the Outputs.'}
          </p>

          <h2>{'7. Confidentiality and Data Handling'}</h2>
          <p>
            {'7.1 We understand that invention disclosures contain sensitive information. We will implement commercially reasonable security measures to protect your User Content from unauthorized access, disclosure, or use.'}
          </p>

          <h3>{'7.2 Third-Party AI Providers'}</h3>
          <p>
            {'You acknowledge and consent to the fact that the Service processes User Content through third-party AI model providers (such as Google Gemini, OpenAI, and others) and third-party automation platforms in order to generate Outputs. While we select providers with reasonable data handling practices, we cannot guarantee that third-party providers will not retain, process, or use data in ways beyond our control. You acknowledge the risk that submitting invention details through AI systems may impact the confidentiality of your invention and potentially constitute a public disclosure for patent purposes.'}
          </p>

          <h3>{'7.3 No Attorney-Client Privilege'}</h3>
          <p>
            {'Because Geyser Inc. is not a law firm and no attorney-client relationship exists, communications between you and the Service are NOT protected by attorney-client privilege, work product doctrine, or any similar legal protection. You should consult with a Registered Patent Practitioner before disclosing sensitive invention details if privilege protection is important to you.'}
          </p>

          <h3>{'7.4 Foreign Filing License Considerations'}</h3>
          <p>
            {'If the Service routes your data through servers located outside the United States, this may implicate foreign filing license requirements under 35 U.S.C. \u00A7 184 and 37 C.F.R. \u00A7 5.11. You are solely responsible for understanding and complying with all export control and foreign filing license requirements.'}
          </p>

          <h2>{'8. Assumption of Risk'}</h2>
          <p>{'By using the Service, you expressly assume all risks associated with:'}</p>
          <p>{'(a) Filing a patent application based in whole or in part on AI-generated content;'}</p>
          <p>{'(b) Failing to retain a Registered Patent Practitioner to review Outputs prior to filing;'}</p>
          <p>{'(c) Errors, omissions, inaccuracies, hallucinations, or legal deficiencies in Outputs;'}</p>
          <p>{'(d) Loss of patent rights, priority dates, or trade secret protection resulting from use of the Service;'}</p>
          <p>{'(e) Rejection, invalidity, or unenforceability of any patent claims based on Outputs;'}</p>
          <p>{'(f) Potential public disclosure of your invention through the use of third-party AI systems;'}</p>
          <p>{'(g) Incomplete or misleading prior art search results;'}</p>
          <p>{'(h) Any negative consequences arising from inventorship determination errors;'}</p>
          <p>{'(i) Any reliance on AI-generated legal analysis, patentability assessments, or strategic recommendations; and'}</p>
          <p>{'(j) The evolving nature of AI technology and its interaction with patent law.'}</p>

          <h2>{'9. Disclaimers of Warranties'}</h2>
          <p className="font-semibold">
            {'9.1 THE SERVICE IS PROVIDED \u201CAS IS\u201D AND \u201CAS AVAILABLE\u201D WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, GEYSER INC. EXPRESSLY DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO:'}
          </p>
          <p className="font-semibold">{'(A) IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT;'}</p>
          <p className="font-semibold">{'(B) ANY WARRANTY THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR VIRUS-FREE;'}</p>
          <p className="font-semibold">{'(C) ANY WARRANTY REGARDING THE ACCURACY, COMPLETENESS, RELIABILITY, LEGALITY, OR LEGAL SUFFICIENCY OF ANY OUTPUTS;'}</p>
          <p className="font-semibold">{'(D) ANY WARRANTY THAT OUTPUTS WILL MEET USPTO REQUIREMENTS OR ANY OTHER PATENT OFFICE REQUIREMENTS; AND'}</p>
          <p className="font-semibold">{'(E) ANY WARRANTY THAT THE SERVICE CONSTITUTES OR SUBSTITUTES FOR PROFESSIONAL LEGAL ADVICE.'}</p>
          <p className="font-semibold">
            {'9.2 GEYSER INC. MAKES NO WARRANTY THAT ANY OUTPUT WILL RESULT IN THE GRANT OF A PATENT, THAT ANY CLAIMS WILL SURVIVE EXAMINATION, OR THAT ANY PATENT OBTAINED USING OUTPUTS WILL BE VALID OR ENFORCEABLE.'}
          </p>
          <p className="font-semibold">
            {'9.3 GEYSER INC. MAKES NO WARRANTY REGARDING THE PATENTFIT\u2122 DIRECTORY, INCLUDING THE ACCURACY, COMPLETENESS, OR CURRENTNESS OF PRACTITIONER INFORMATION OR PATENTFIT SCORES.'}
          </p>

          <h2>{'10. Limitation of Liability'}</h2>
          <p className="font-semibold">
            {'10.1 TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL GEYSER INC., ITS OWNERS, OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AFFILIATES, LICENSORS, OR SERVICE PROVIDERS BE LIABLE TO YOU OR ANY THIRD PARTY FOR:'}
          </p>
          <p className="font-semibold">{'(A) ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES;'}</p>
          <p className="font-semibold">{'(B) LOSS OF PROFITS, REVENUE, BUSINESS, GOODWILL, OR DATA;'}</p>
          <p className="font-semibold">{'(C) LOSS OF PATENT RIGHTS, PRIORITY DATES, OR TRADE SECRET PROTECTION;'}</p>
          <p className="font-semibold">{'(D) COSTS OF PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;'}</p>
          <p className="font-semibold">{'(E) DAMAGES ARISING FROM REJECTED, INVALID, OR UNENFORCEABLE PATENT APPLICATIONS OR CLAIMS; OR'}</p>
          <p className="font-semibold">{'(F) DAMAGES ARISING FROM YOUR RELIANCE ON ANY OUTPUT, ANALYSIS, OR RECOMMENDATION GENERATED BY THE SERVICE, REGARDLESS OF THE THEORY OF LIABILITY (WHETHER CONTRACT, TORT, STRICT LIABILITY, OR OTHERWISE) AND EVEN IF GEYSER INC. HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.'}</p>
          <p className="font-semibold">
            {'10.2 TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, GEYSER INC.\u2019S TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THIS AGREEMENT OR THE SERVICE SHALL NOT EXCEED THE GREATER OF:'}
          </p>
          <p className="font-semibold">{'(A) THE AMOUNTS YOU PAID TO GEYSER INC. IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM; OR'}</p>
          <p className="font-semibold">{'(B) ONE HUNDRED UNITED STATES DOLLARS (US $100.00).'}</p>
          <p>
            {'10.3 The limitations in this Section 10 shall apply to the fullest extent permitted by law in the applicable jurisdiction, even if any remedy fails of its essential purpose. Some jurisdictions do not allow the exclusion or limitation of certain damages, so some or all of the above limitations may not apply to you, in which case our liability will be limited to the maximum extent permitted by applicable law.'}
          </p>

          <h2>{'11. Indemnification'}</h2>
          <p>{'You agree to indemnify, defend, and hold harmless Geyser Inc., its owners, officers, directors, employees, agents, affiliates, and licensors from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys\u2019 fees) arising out of or related to:'}</p>
          <p>{'(a) your use of the Service or any Outputs;'}</p>
          <p>{'(b) any patent application you file based in whole or in part on Outputs;'}</p>
          <p>{'(c) your violation of this Agreement;'}</p>
          <p>{'(d) your violation of any applicable law, rule, regulation, or third-party right;'}</p>
          <p>{'(e) any dispute between you and any patent practitioner you contact through the PatentFit\u2122 Directory;'}</p>
          <p>{'(f) any claim by a third party that your User Content or invention infringes any intellectual property or other right; or'}</p>
          <p>{'(g) any misrepresentation by you regarding your right to use or disclose the inventive concepts submitted to the Service.'}</p>

          <h2>{'12. Acceptable Use and Restrictions'}</h2>
          <p>{'You agree not to:'}</p>
          <p>{'(a) use the Service for any illegal purpose;'}</p>
          <p>{'(b) submit User Content that you do not have the right to disclose;'}</p>
          <p>{'(c) attempt to reverse engineer, decompile, or disassemble any portion of the Platform;'}</p>
          <p>{'(d) use automated means (bots, scrapers, etc.) to access the Service;'}</p>
          <p>{'(e) resell, redistribute, or commercially exploit the Service or Outputs to third parties as a competing patent drafting service;'}</p>
          <p>{'(f) misrepresent Outputs as having been prepared or reviewed by a licensed attorney or patent agent when they have not been;'}</p>
          <p>{'(g) file documents with the USPTO that contain known inaccuracies from Outputs without correction; or'}</p>
          <p>{'(h) use the Service in any manner that could damage, disable, or impair the Service.'}</p>

          <h2>{'13. Inventorship Acknowledgment'}</h2>
          <p>
            {'13.1 You acknowledge that under U.S. patent law (35 U.S.C. \u00A7 116 and the USPTO\u2019s Inventorship Guidance for AI-Assisted Inventions, 89 FR 10043), each named inventor on a patent application must have made a significant contribution to the conception of the invention as claimed. AI systems, including those used by the Service, cannot be named as inventors.'}
          </p>
          <p>
            {'13.2 Where the Service introduces alternative embodiments, claim variations, or technical expansions not originally conceived by you, you are solely responsible for evaluating whether such AI-generated content constitutes an inventive contribution and for ensuring proper inventorship attribution under applicable law.'}
          </p>
          <p>
            {'13.3 Failure to properly identify inventors may result in patent invalidity under 35 U.S.C. \u00A7 256 and potential charges of inequitable conduct. Geyser Inc. is not responsible for inventorship determination errors.'}
          </p>

          <h2>{'14. No Reliance; Independent Judgment'}</h2>
          <p>{'You acknowledge that:'}</p>
          <p>{'(a) you are not relying on Geyser Inc. for legal, technical, or business advice;'}</p>
          <p>{'(b) you will exercise your own independent judgment (or the judgment of a qualified professional you retain) in determining how to use any Outputs;'}</p>
          <p>{'(c) the AI-generated Advocate/Examiner debates, patentability analyses, white space assessments, and claim strategies in the Service are educational and informational tools only and do not constitute professional legal opinions; and'}</p>
          <p>{'(d) the decision to file a patent application and the content of that application are your sole responsibility.'}</p>

          <h2>{'15. Modification of Terms'}</h2>
          <p>{'15.1 We reserve the right to modify this Agreement at any time. We will provide notice of material changes by:'}</p>
          <p>{`(a) posting the updated Agreement on the Platform with a new \u201CLast Updated\u201D date; and`}</p>
          <p>{'(b) providing notice through the Platform interface or via email to registered Users.'}</p>
          <p>
            {'15.2 Your continued use of the Service after the effective date of any modification constitutes your acceptance of the modified terms. If you do not agree with a modification, your sole remedy is to discontinue use of the Service and cancel your Subscription.'}
          </p>
          <p>
            {'15.3 For material changes that affect the scope of the arbitration clause (Section 17) or class action waiver, we will provide at least thirty (30) days\u2019 advance notice, and any such changes will apply only to claims arising after the effective date of the modification.'}
          </p>

          <h2>{'16. Termination'}</h2>
          <p>
            {'16.1 Either party may terminate this Agreement at any time. You may terminate by canceling your Subscription and ceasing all use of the Service. We may terminate or suspend your access immediately, without prior notice, for any breach of this Agreement or for any other reason in our sole discretion.'}
          </p>
          <p>
            {'16.2 Upon termination, Sections 2, 6, 7, 8, 9, 10, 11, 13, 14, 17, 18, 19, and 20 shall survive and continue in full force and effect.'}
          </p>
          <p>
            {'16.3 Following termination, we may retain your User Content and project data for a commercially reasonable period for backup, archival, audit, or legal compliance purposes, after which it will be deleted in accordance with our data retention policy.'}
          </p>

          <h2>{'17. Binding Arbitration and Class Action Waiver'}</h2>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-sm text-amber-900">
            <p className="font-bold">
              {'PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR LEGAL RIGHTS, INCLUDING YOUR RIGHT TO FILE A LAWSUIT IN COURT AND TO HAVE A JURY TRIAL.'}
            </p>
          </div>

          <h3>{'17.1 Agreement to Arbitrate'}</h3>
          <p>
            {'You and Geyser Inc. mutually agree that any dispute, claim, or controversy arising out of or relating to this Agreement, the Service, or your use of any Outputs (collectively, \u201CDisputes\u201D) shall be resolved exclusively through final and binding arbitration administered by the American Arbitration Association (\u201CAAA\u201D) under its Consumer Arbitration Rules then in effect, rather than in a court of law. This agreement to arbitrate is governed by the Federal Arbitration Act, 9 U.S.C. \u00A7\u00A7 1\u201316 (\u201CFAA\u201D), and shall survive termination of this Agreement.'}
          </p>

          <h3>{'17.2 Informal Dispute Resolution'}</h3>
          <p>
            {'Before initiating arbitration, you agree to first contact us at info@patentgeyser.com and attempt to resolve the Dispute informally for at least sixty (60) days. If the Dispute is not resolved within sixty (60) days, either party may proceed to arbitration.'}
          </p>

          <h3>{'17.3 Arbitration Procedures'}</h3>
          <p>
            {'The arbitration shall be conducted by a single arbitrator in Wilmington, Delaware or, at your election, by videoconference or telephone. The arbitrator shall apply the substantive law of the State of Delaware without regard to conflicts-of-law principles. The arbitrator\u2019s award shall be final and binding and may be entered as a judgment in any court of competent jurisdiction.'}
          </p>

          <h3>{'17.4 Arbitration Costs'}</h3>
          <p>
            {'Payment of all filing, administration, and arbitrator fees shall be governed by the AAA\u2019s Consumer Arbitration Rules. If you demonstrate that arbitration costs are prohibitive compared to litigation costs, Geyser Inc. will pay as much of your filing, administration, and arbitrator fees as the arbitrator deems necessary to prevent arbitration from being cost-prohibitive.'}
          </p>

          <h3>{'17.5 Class Action Waiver'}</h3>
          <p className="font-semibold">
            {'YOU AND GEYSER INC. AGREE THAT EACH MAY BRING DISPUTES AGAINST THE OTHER ONLY IN AN INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS, COLLECTIVE, CONSOLIDATED, REPRESENTATIVE, OR MULTI-PARTY ACTION OR PROCEEDING. THE ARBITRATOR MAY NOT CONSOLIDATE MORE THAN ONE PERSON\u2019S CLAIMS AND MAY NOT OTHERWISE PRESIDE OVER ANY FORM OF A CLASS, COLLECTIVE, OR REPRESENTATIVE PROCEEDING. IF THIS CLASS ACTION WAIVER IS FOUND TO BE UNENFORCEABLE, THEN THE ENTIRETY OF THIS ARBITRATION PROVISION (EXCEPT FOR THE JURY TRIAL WAIVER IN SECTION 17.7) SHALL BE NULL AND VOID, AND THE DISPUTE SHALL PROCEED IN COURT.'}
          </p>

          <h3>{'17.6 Mass Arbitration'}</h3>
          <p>
            {'If twenty-five (25) or more similar Disputes are filed against Geyser Inc. within a sixty (60) day period, the parties agree to work with AAA to implement batching procedures, bellwether arbitrations, or other efficiencies to resolve the Disputes. No party shall be prejudiced by the implementation of such procedures.'}
          </p>

          <h3>{'17.7 Jury Trial Waiver'}</h3>
          <p className="font-semibold">
            {'TO THE EXTENT PERMITTED BY LAW, YOU AND GEYSER INC. WAIVE ANY RIGHT TO A JURY TRIAL IN CONNECTION WITH ANY DISPUTE.'}
          </p>

          <h3>{'17.8 Exceptions'}</h3>
          <p>
            {'Notwithstanding the foregoing, either party may seek injunctive or other equitable relief in any court of competent jurisdiction to prevent the actual or threatened infringement, misappropriation, or violation of intellectual property rights. Small claims court actions (within the jurisdictional limits of the applicable small claims court) are also exempt from this arbitration provision.'}
          </p>

          <h3>{'17.9 Opt-Out'}</h3>
          <p>
            {'You may opt out of this arbitration provision and class action waiver by sending written notice to info@patentgeyser.com within thirty (30) days of first accepting this Agreement. If you opt out, all other terms of this Agreement remain in full force and effect.'}
          </p>

          <h2>{'18. Governing Law and Jurisdiction'}</h2>
          <p>
            {'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict-of-law provisions. To the extent any Dispute is not subject to arbitration under Section 17, the parties consent to the exclusive jurisdiction and venue of the state and federal courts located in New Castle County, Delaware.'}
          </p>

          <h2>{'19. General Provisions'}</h2>
          <p>
            {'19.1 Entire Agreement. This Agreement, together with the Privacy Policy and any other policies referenced herein, constitutes the entire agreement between you and Geyser Inc. with respect to the Service and supersedes all prior agreements, representations, and understandings.'}
          </p>
          <p>
            {'19.2 Severability. If any provision of this Agreement is held to be invalid, illegal, or unenforceable, the remaining provisions shall continue in full force and effect. The invalid provision shall be modified to the minimum extent necessary to make it valid and enforceable while preserving the parties\u2019 original intent.'}
          </p>
          <p>
            {'19.3 Waiver. The failure of either party to enforce any right or provision of this Agreement shall not constitute a waiver of such right or provision.'}
          </p>
          <p>
            {'19.4 Assignment. You may not assign or transfer this Agreement or any of your rights hereunder without our prior written consent. We may assign this Agreement without restriction.'}
          </p>
          <p>
            {'19.5 Notices. We may provide notices to you via the email address associated with your account or through the Platform interface. You may provide notices to us at info@patentgeyser.com.'}
          </p>
          <p>
            {'19.6 Force Majeure. Geyser Inc. shall not be liable for any failure or delay in performance due to circumstances beyond its reasonable control, including but not limited to acts of God, natural disasters, pandemics, war, terrorism, government actions, power failures, internet outages, or third-party service provider failures.'}
          </p>
          <p>
            {'19.7 No Third-Party Beneficiaries. This Agreement does not confer any rights or remedies upon any third party, except as expressly provided herein.'}
          </p>
          <p>
            {'19.8 Headings. Section headings are for convenience only and do not affect the interpretation of this Agreement.'}
          </p>

          <h2>{'20. User Representations and Warranties'}</h2>
          <p>
            {'By clicking \u201CI Agree\u201D or otherwise indicating acceptance, you represent and warrant that:'}
          </p>
          <p>{'(a) You have read this Agreement in its entirety and understand all of its terms;'}</p>
          <p>{'(b) You understand that Geyser Inc. is NOT a law firm and does NOT provide legal advice;'}</p>
          <p>{'(c) You understand that no attorney-client relationship, fiduciary relationship, or privileged communication exists between you and Geyser Inc.;'}</p>
          <p>{'(d) You understand that all Outputs are AI-generated drafts that may contain errors, omissions, inaccuracies, and legal deficiencies;'}</p>
          <p>{'(e) You have been advised to retain a Registered Patent Practitioner to review all Outputs before filing;'}</p>
          <p>{'(f) You assume all risk associated with using the Service and any Outputs;'}</p>
          <p>{'(g) You are of legal age and have the legal capacity to enter into this Agreement;'}</p>
          <p>{'(h) You have the right and authority to submit all User Content provided to the Service;'}</p>
          <p>{'(i) You waive any claim that Outputs constitute legal advice or that Geyser Inc. has acted as your attorney or patent agent; and'}</p>
          <p>{'(j) You have voluntarily agreed to the arbitration clause and class action waiver in Section 17 with full knowledge of their consequences.'}</p>

          <h2>{'21. Contact Information'}</h2>
          <p>{'For questions about this Agreement or the Service:'}</p>
          <p>
            {'Geyser Inc.'}<br />
            {'251 Little Falls Drive'}<br />
            {'Wilmington, DE 19808'}<br />
            {'Email: '}
            <a href="mailto:info@patentgeyser.com">{'info@patentgeyser.com'}</a>
            <br />
            {'Website: '}
            <a href="https://patentgeyser.com">{'patentgeyser.com'}</a>
          </p>

          <hr />

          <h2>{'Electronic Consent'}</h2>
          <p>
            {'By clicking the \u201CI Agree\u201D button on the form, you confirm that you have read, understand, and agree to be bound by all terms and conditions of this User Agreement and Terms of Service, including the binding arbitration clause and class action waiver in Section 17. You further confirm that you understand Geyser Inc. is not a law firm, does not provide legal advice, and that all Outputs are AI-generated drafts requiring independent professional review before filing with any patent office.'}
          </p>
        </div>
      </section>
    </>
  );
}

