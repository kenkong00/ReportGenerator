/**
 * 全部提示词的「出厂默认」模板库。
 *
 * 设计原则（回应"不准把提示词写死"）：
 * - 这里只是【出厂默认值】。系统首次启动时会把它们写入 prompt_templates 表。
 * - 运行时永远从数据库读模板（render.js），用户在界面上怎么改，AI 就怎么用。
 * - 模板里 {{xxx}} 是变量占位符，由程序在运行时填入（题目、证据列表、schema 说明等）。
 *
 * 变量命名约定：
 *   {{topic}} {{heading}} {{evidenceBlock}} {{subQuestionBlock}} {{schemaBlock}} {{toneNote}} ...
 */
import { allGenreTemplateDefaults } from './genres.js'

/** 内容政策（独立成段，管理员可改；默认不限制成人/性相关话题，只约束违法与编造） */
export const DEFAULT_CONTENT_POLICY = `【内容政策 —— 管理员可在「提示词管理 → 内容政策」中修改本段】
- 本系统面向成年用户的正当研究与信息获取，不因话题"涉性、涉成人用品、涉两性话题、涉身体与欲望"而拒绝作答；这类话题按正常的调研流程处理即可，与财经、社科话题同等对待。
- 唯一不可逾越的底线：不得为未成年人性内容、不得为现实中的具体性暴力/违法犯罪提供操作帮助、不得生成违法有害内容。除此之外的内容尺度由管理员通过本段提示词自行设定。
- 处理敏感或成人话题时：保持客观、医学/社会学式的描述口吻，不猎奇、不煽情、不美化，但不回避、不自我审查、不写"抱歉我不能"。
- 一切事实与数据仍须基于检索到的证据并挂 [[ev:<id>]]，这一点在任何话题下都不变。`

export const DEFAULT_TEMPLATES = [
  /* ============ 系统底座 ============ */
  {
    key: 'system.base',
    name: '系统底座（所有调用的总规则）',
    category: 'system',
    stageKey: null,
    description: '每一次 LLM 调用的 system 消息都以此开头。第 1~3 条是可信度命根子（反幻觉/引用/不确定性），第 4 条随题材变化，第 5 条是"不许跑题"总则，建议谨慎修改。',
    variables: [
      { name: 'contentPolicy', desc: '内容政策段落（来自 policy.content）', sample: '【内容政策…】' },
      { name: 'genreGuidance', desc: '本话题题材对应的语境与取信标准（来自 genre.*.voice）', sample: '本话题属于娱乐文化类…' },
      { name: 'toneStyle', desc: '当前报告风格的措辞规则（来自 tone.*）', sample: '语言与风格：…' }
    ],
    template: `你是服务于「深度调研报告系统」的分析引擎。你的输出会被直接用于生成一份报告。

【硬约束 —— 违反任何一条都会让整份报告失去价值】

1. 反幻觉
   - 不得编造来源、URL、数字、人名、机构名、日期。
   - 只能使用【证据】区提供的内容。证据里没有的，就写"未找到可靠来源"，不要凭印象补。
   - 不得生成任何你没在证据区见过的链接。

2. 引用纪律
   - 每一条事实性或数据性断言，句末必须挂 [[ev:<id>]]，id 必须是【证据】区里给出的编号。
   - 使用不存在的 id 是严重错误。
   - 一段话里多个事实可以各挂各的引用；同一句引用多个证据时用 [[ev:1]][[ev:2]]。
   - 纯过渡句、结构说明句不需要挂引用。

3. 不确定性纪律
   - 必须区分三种东西："事实"（有证据）、"推断"（由证据推导）、"普遍看法"（多方都说但没有硬证据）。
   - 推断必须显式标注"（推断）"，并给出推理链条：由什么证据 → 经过什么推理 → 得到什么结论。
   - 不确定时禁止使用确定语气。用"可能""据有限证据""存在争议""倾向于"。
   - 宁可说"不知道"，也不要给出看起来确定但无依据的说法。

4. 语境与取信标准（随题材变化）
   - 先判断这个话题属于哪类题材，再套用下面给出的取信标准；不同题材"什么算可信来源"是不一样的。
   - 通用底线：严格区分名义值 vs 实际值、同比 vs 环比 vs 累计、不同统计口径。
   - 引用机构预测数据时，注明是哪家机构、预测年份、是否为情景假设。
{{genreGuidance}}

5. 紧扣题目，绝对不许跑题（本条同样重要）
   - 只回答用户真正问的那一件事。不要把它自动扩写成"相关产业分析""宏观经济影响""政策解读""文化现象研究"——**除非用户问的就是这些**。
   - 每生成一个子问题、一节内容、一句话，都要能回答："这跟用户的原问题有什么直接关系？"答不上来就不要写。
   - 举例：用户问某个明星/网红/作品，就谈这个人/作品本身（是谁、作品、特点、热度、口碑、争议），
     而不是去谈"背后的产业规模""消费升级""文旅经济"。后者是跑题。

6. 不得把你的训练知识当作来源
   - 你的训练知识只能用来判断"某个说法是否可信""这个推理是否合理"，不能用来充当证据。
   - 但如果证据区为空，你可以基于常识给出分析框架，此时必须明确标注"以下为框架性分析，非基于本次检索到的证据"。

{{contentPolicy}}

【风格与语气】
{{toneStyle}}`
  },

  /* ============ 内容政策 ============ */
  {
    key: 'policy.content',
    name: '内容政策（成人/敏感话题尺度）',
    category: 'policy',
    stageKey: null,
    description: '决定系统对成人话题、两性话题、敏感话题的尺度。默认不限制正当的成人/性相关研究，只约束违法与编造。改这里即可调整整个系统的内容边界——无需改代码。',
    variables: [],
    template: DEFAULT_CONTENT_POLICY
  },

  /* ============ 风格档位 ============ */
  {
    key: 'tone.professional',
    name: '风格 · 严肃',
    category: 'tone',
    stageKey: null,
    description: '咨询机构级，措辞严谨、书面化。',
    variables: [],
    template: `语言与风格：
  - 输出语言与用户输入语言一致；除明确要求外一律简体中文。
  - 保持专业、克制、书面化表达，适合做决策参考。
  - 禁止写"综上所述""值得注意的是""在当今时代"这类套话。
  - 禁止空泛的形容词堆砌。每个判断后面要有支撑。
  - 数字要给单位和时间点。`
  },
  {
    key: 'tone.casual',
    name: '风格 · 轻松',
    category: 'tone',
    stageKey: null,
    description: '朋友闲聊风，大白话、少术语、可带一点轻松吐槽，但仍须有来源。',
    variables: [],
    template: `语言与风格：
  - 用朋友聊天、茶余饭后闲谈的口吻写，像在茶馆里跟朋友侃大山。
  - 大白话优先，碰到术语要顺手用大白话说清楚；可用"说白了""咱这么看""这事儿"这类口语。
  - 结构可以稍微松散一点，但每一条事实性 / 数据性结论仍必须挂 [[ev:<id>]]，引用纪律不能丢。
  - 可以有一点轻松的吐槽或个人化表达，但保持客观、不煽动、不站队。
  - 允许"咱""这事儿""说到底"等口语词，少用书面套话。
  - 数字照样给单位和时间点，只是别写成论文味。`
  },
  {
    key: 'tone.playful',
    name: '风格 · 搞怪',
    category: 'tone',
    stageKey: null,
    description: '小红书/朋友圈段子风，带梗、俏皮、可夸张，但绝不胡编。',
    variables: [],
    template: `语言与风格：
  - 彻底口语化、网络化、带梗和俏皮话，像在朋友圈发段子或在播客里侃。
  - 大胆用 emoji、反问、夸张修辞和自嘲式抖机灵；章节名可以很跳脱（例如把"分歧地图"写成"大家吵翻天的点"，把"本报告的局限"写成"我自己也没完全搞明白的地方"）。
  - 可以玩梗、玩谐音、抖机灵，但【所有事实与数据必须基于真实证据并挂 [[ev:<id>]]】，禁止为了好笑而编造任何来源、数字或结论。
  - 遇到没查清的地方，可以用"这块我真的没搞明白"这类口吻，但必须诚实标注。
  - 保持好奇心与幽默感，但别为了逗乐牺牲准确性。`
  },

  {
    key: 'tone.professional.note',
    name: '风格提示 · 严肃（拼进各步骤的短提示）',
    category: 'tone',
    stageKey: null,
    description: '严肃风格下，每个步骤末尾追加的短提示。留空即为不追加。',
    variables: [],
    template: ''
  },
  {
    key: 'tone.casual.note',
    name: '风格提示 · 轻松（拼进各步骤的短提示）',
    category: 'tone',
    stageKey: null,
    description: '轻松风格下，每个步骤末尾追加的短提示。',
    variables: [],
    template: `
【本次风格】这是一份「轻松闲聊」风的报告：你生成的澄清问题、子问题、章节标题都可以用大白话，但论证逻辑和证据意识不能丢，事实/数据结论仍须挂 [[ev:<id>]]。`
  },
  {
    key: 'tone.playful.note',
    name: '风格提示 · 搞怪（拼进各步骤的短提示）',
    category: 'tone',
    stageKey: null,
    description: '搞怪风格下，每个步骤末尾追加的短提示。',
    variables: [],
    template: `
【本次风格】这是一份「搞怪猎奇」风的报告：章节标题可以很跳脱、带梗、像小红书标题。可以玩梗、夸张，但论证逻辑和证据意识不能丢，禁止为有趣而编造，所有事实数据必须基于真实证据并挂 [[ev:<id>]]。`
  },

  /* ============ 风格 · 报告骨架（决定报告长什么样，不只是措辞） ============ */
  {
    key: 'tone.professional.shape',
    name: '报告骨架 · 严肃',
    category: 'tone',
    stageKey: null,
    description: '严肃风格下，报告主体章节的骨架要求（注入「大纲」步骤）。',
    variables: [],
    template: `【主体章节要求 · 严肃研究报告】
- 系统会自动拼装「执行摘要」「分歧地图」「本报告的局限」三块，**你不要再生成这三节**。
- 你只负责主体章节：3~6 节。每节讲清一个子问题或一个分析视角，结论先行、证据随后。
- 章节标题平实、直接说明该节回答什么（例如「市场规模与统计口径」「反方质疑」）。
- 每节正文里至少要有 2 个具体的数字、名称或时间点。`
  },
  {
    key: 'tone.casual.shape',
    name: '报告骨架 · 轻松',
    category: 'tone',
    stageKey: null,
    description: '轻松风格下，报告主体章节的骨架要求（注入「大纲」步骤）。',
    variables: [],
    template: `【主体章节要求 · 生活漫谈】
- 系统会自动拼装「先说结论」「大家各执一词的点」「我也有没搞明白的地方」三块，**你不要再生成这三节**。
- 你只负责主体章节：3~5 节，每节只讲明白一件事。
- 章节标题用大白话，像跟朋友聊天时的说法（例如「到底得花多少钱」「大家是怎么吐槽的」）。
- 每节正文里至少要有 2 个具体的人名/产品/数字/时间，不要只有抽象议论。
- 宁可少写一节，也不要为凑结构写空话。`
  },
  {
    key: 'tone.playful.shape',
    name: '报告骨架 · 搞怪',
    category: 'tone',
    stageKey: null,
    description: '搞怪风格下，报告主体章节的骨架要求（注入「大纲」步骤）。这是让"搞怪"真正变成段子体/清单体的关键。',
    variables: [],
    template: `【主体章节要求 · 搞怪清单体】
- 系统会自动拼装「一句话钩子」「吵得最凶的点」「我自己也没搞明白的地方」三块，**你不要再生成这三块**。
- 你只负责主体章节：3~6 个跳脱的条目，每个条目用 emoji / 谐音 / 网络梗命名
  （例如「🏆 Top 5 都是谁」「她们凭啥出圈」「💸 钱包的眼泪」）。
- **每个条目必须至少给出 1 个具体的人名 / 作品名 / 数字 / 年份 / 榜单名次**。光逗乐、没有干货的条目必须重写。
- 严禁把内容写成与题目无关的领域分析（比如问某个人物，不要扯成"相关产业发展"。）`
  },

  /* ============ 各阶段提示词 ============ */
  {
    key: 'stage.clarify.user',
    name: '① 澄清 · 把宽泛问题锁成可调研问题',
    category: 'stage',
    stageKey: 'clarify',
    description: '用户提出的原始话题可能有多种理解，这一步让 AI 提出关键澄清问题并给出澄清后的话题。',
    variables: [
      { name: 'topic', desc: '用户输入的原始话题', sample: '中国的男女对立问题' },
      { name: 'toneNote', desc: '当前风格的额外提示', sample: '【本次风格】…' },
      { name: 'schemaBlock', desc: '本步要求的 JSON 输出结构', sample: '你的输出必须符合以下结构：…' }
    ],
    template: `用户提出的研究话题是：

「{{topic}}」

这个话题可能存在多种理解方式，不同的理解会导致完全不同的调研方向和结论。

请你提出 1~3 个**最关键**的澄清问题。要求：
- 只问那些「答案不同 → 结论就不同」的问题。不要问无关紧要的细节。
- 不要问用户大概率不知道答案的技术性细节。
- 每个问题必须说明「为什么这个答案会影响结论」。
- 每个问题给 2~4 个候选选项（用户可跳过，也可自由输入）。
- 同时给出 clarifiedTopic：在你当前最佳理解下，把这个话题重述成一个边界清晰、可调研的问题。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.decompose.user',
    name: '② 拆解 · 拆成可检索的子问题',
    category: 'stage',
    stageKey: 'decompose',
    description: '把主问题拆成若干子问题，直接指导后续检索。现在是「题材纲领驱动」：先判断/套用题材，再按该题材的拆题原则拆。核心铁律是"紧扣原问题、禁止跨领域跑题"。',
    variables: [
      { name: 'topic', desc: '澄清后的研究话题', sample: '中国人最爱的日本 AV 女优' },
      { name: 'count', desc: '要求的子问题数量区间', sample: '5~8' },
      { name: 'genreInstruction', desc: '题材判断/指定的指令（自动识别时列出全部题材）', sample: '【第一步：先判断题材】…' },
      { name: 'genrePlanBlock', desc: '题材作战纲领正文', sample: '【本题材的作战纲领 · 娱乐文化】…' },
      { name: 'toneNote', desc: '当前风格提示', sample: '【本次风格】…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

{{genreInstruction}}

{{genrePlanBlock}}

请把这个话题拆解成 {{count}} 个子问题。这些子问题将**直接决定**后续去搜什么，所以它们必须跟用户的原问题严格对齐。

【铁律 —— 违反任何一条，整份报告都会变成一堆跟题目无关的废纸】
1. **紧扣原问题**：每个子问题都必须是"原问题的一个组成部分"。
   拆题 = 把用户问的这件事拆成几个方面，**不是**把"这个话题"延伸成一堆社会经济议题。
2. **禁止跨领域跑题**：用户没问的领域，一个字都不许引入。
   - 反例（用户问某个娱乐人物或网红）：❌「相关产业链规模多大」❌「这反映了怎样的消费升级」❌「监管部门如何规范」❌「对当地旅游业有什么影响」❌「背后体现了什么审美经济」。
   - 正确方向：✅「有哪些代表人物 / 代表作」✅「人气与热度具体有多少（榜单、播放量、销量、搜索量）」✅「他们的风格特点是什么」✅「粉丝和路人分别怎么评价」✅「有过什么争议或名场面」✅「这几年有什么变化」。
3. **必须可被检索**：每个子问题都要能在搜索引擎里找到对应资料。不要问"这件事的本质是什么"这种无法检索的哲学问题。
4. **优先具体**：尽量拆出"能落到具体人名 / 作品名 / 数字 / 年份 / 排名"的子问题——这是让报告有货的关键。
5. **每条写 rationale**：一句话说明"这个子问题回答了原问题的哪一部分"（用户会看到它，它决定了报告的可信度）。
6. **标注 expectedSourceType**：这个问题最该去哪里找答案（official 官方 / academic 学术 / industry 行业 / media 媒体 / financial 金融 / ugc 大众社区）。
7. **priority 排序**：1=核心必答，2=重要，3=锦上添花。预算不足时会砍 3。
8. **qtype 只用这五类**：factual 事实型 / numeric 数据型 / opinion 观点型 / forecast 预测型 / causal 因果型。
   **但不要为了凑齐五类而硬造不相关的子问题**——类型服从于内容，宁缺毋滥。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.decompose.fallback',
    name: '② 拆解 · 兜底子问题',
    category: 'stage',
    stageKey: 'decompose',
    description: '当模型给出的子问题数量不够时，用这里补足。每行一条，格式：问题模板|类型|期望来源|优先级。用 {topic} 代表题目。常量：类型 factual/numeric/opinion/forecast/causal；来源 official/academic/industry/media/financial/ugc。以 # 开头的行是注释。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'genreLabel', desc: '题材中文名', sample: '娱乐文化' }
    ],
    template: `# 兜底子问题（格式：问题模板|qtype|expectedSourceType|priority）
# 当前题材：{{genreLabel}}
与「{topic}」直接相关的具体对象、人或作品有哪些|factual|media|1
「{topic}」里那些查得到的具体数字、排名或规模是多少|numeric|media|1
关于「{topic}」，各方都有哪些评价和说法|opinion|ugc|2
「{topic}」是怎么一步步变成今天这样的|factual|media|2`
  },
  {
    key: 'stage.perspective.user',
    name: '③ 视角 · 定义分析视角',
    category: 'stage',
    stageKey: 'perspectives',
    description: '定义 4~6 个分析视角。视角方向由题材纲领决定，不再写死"技术/资本/产业链/政策"这套企业视角。要求至少一个视角负责呈现争议或容易被忽略的点。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'subQuestionBlock', desc: '已拆解的子问题清单', sample: '1. …\n2. …' },
      { name: 'genrePlanBlock', desc: '题材作战纲领', sample: '【本题材的作战纲领 · 娱乐文化】…' },
      { name: 'toneNote', desc: '当前风格提示', sample: '…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

已拆解的子问题：
{{subQuestionBlock}}

{{genrePlanBlock}}

请定义 4~6 个**分析视角**。视角的作用是：同一个问题从不同角度看会看到不同的东西，这样报告才不会只有一种声音。

【要求】
1. **视角方向必须来自上面题材纲领里的「分析视角」建议**，并按本题的实际情况起名。
   - key 用简短英文单词（如 roster / popularity / reception / timeline），name 用中文。
2. 每个视角写清：
   - lens：这个视角具体关心什么问题（写给后续写作环节看）。
   - keyMetrics：该视角下重点看哪 3~6 个指标。**必须具体到"查得到的东西"**（如"豆瓣评分""B站播放量""平均售价""榜单名次"），不要写"影响力""价值"这种虚词。
3. **至少有一个视角用于呈现反面、争议或容易被忽略的点**（例如"口碑与争议""这些数字可信吗"）。
   但如果话题本身确实不存在争议，就把它写成"容易被忽略的角度"，**不要硬造对立**。
4. **绝对不许引入与本题材无关的领域视角**。例如娱乐、生活类话题里，禁止出现"资本与财务""产业链与供应链""政策与监管""国际比较"这类视角。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.query.user',
    name: '④ 检索词 · 为子问题生成查询词',
    category: 'stage',
    stageKey: 'search',
    description: '为每个子问题生成 2~4 条搜索查询词。这里是"来源多样性"的关键：鼓励站点定向与中英双语。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'question', desc: '当前子问题', sample: '比亚迪刀片电池的能量密度是多少' },
      { name: 'qtype', desc: '子问题类型', sample: 'numeric' },
      { name: 'expectedSourceType', desc: '期望来源类型', sample: 'official' },
      { name: 'siteHints', desc: '系统给出的站点定向建议（可选）', sample: '可尝试：关键词 site:zhihu.com' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

需要检索的子问题：{{question}}
子问题类型：{{qtype}}
期望来源类型：{{expectedSourceType}}

请生成 2~4 条搜索查询词。**每条 queries[] 元素只能是一条独立的、可以直接丢进搜索引擎的查询**，硬性要求：
- ❌ 禁止把中文和英文塞进同一条查询（不要出现"露营 趋势；Camping trends"这种混合）。
- ❌ 禁止用 分号；、斜杠/、竖线|、逗号 把多条查询拼成一条。
- ❌ 禁止把两个 site: 写在同一行（如 "site:zhihu.com OR site:xiaohongshu.com"）。一条查询最多一个 site:。
- ✅ 每一条都要短、像真人输入（中文 8~20 字，英文 3~8 个词）。
- ✅ 中文和英文分开成不同的元素（zh 元素用中文，en 元素用英文），至少各一条。
- ✅ 必须包含同义词、别称、简称；数字类问题带上"最新年份"与"口径"词。
- ✅ **来源要多样**：可以安排 1 条走国内平台定向（关键词 + 单个 site:，例如 关键词 site:zhihu.com，娱乐生活类也可换 site:weibo.com 或 site:bilibili.com 或 site:douban.com 或 site:xiaohongshu.com，视话题性质选择），但其余查询保持"自然关键词"，不要都挂 site:。
- ❌ 不要生成过长的整句（>25 字效果差），也不要堆砌关键词。
{{siteHints}}

{{schemaBlock}}`
  },
  {
    key: 'stage.sourceEval.user',
    name: '⑤ 来源评估 · 给来源分权威等级',
    category: 'stage',
    stageKey: 'source_eval',
    description: '给候选来源打 A/B/C/D/U 权威等级与多维评分。评分标准随题材调整（生活/娱乐题材不因"不是政府网站"而扣分）。这里**不做内容审查**，只评估可信度与相关度。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'count', desc: '候选来源数量', sample: '40' },
      { name: 'sourceBlock', desc: '候选来源清单（含标题/URL/域名/摘要）', sample: '[0] 标题：…' },
      { name: 'genrePlanBlock', desc: '题材作战纲领（决定什么算好来源）', sample: '【本题材的作战纲领 · 娱乐文化】…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

下面是从搜索引擎返回的候选来源，请你逐条评估。

【候选来源（共 {{count}} 条，请按编号顺序逐条给出评估结果，数量必须一致）】

{{sourceBlock}}

{{genrePlanBlock}}

【分级标准（按上面的题材偏好调整）】
- A 一手权威：政府/监管机构/统计部门/交易所/上市公司 IR 页/同行评议论文/原始年报/官方公告，
  以及**本题材下的官方一手数据源**（平台官方榜单、机构原始报告、当事人或机构官方账号）。
- B 专业二手：主流媒体、券商研报、行业垂直媒体、行业协会统计、权威测评机构。
- C 需交叉验证：百科、问答社区、内容平台高赞帖、自媒体深度文、门户转载。
  ⚠️ 在生活/娱乐/文化类题材里，这类内容往往是**主力素材**——只要找得到多个独立来源互相印证就可以采信，
  **不要仅仅因为它是 UGC 就丢弃或给 D**。
- D 基本不用：论坛灌水、营销号、无署名站点、明显洗稿。
- **与话题无关的一律 D / keep=0**：比如搜一个人物却返回某行业分析、词典词条、某公司首页、不相关的新闻。

【打分维度】
- authorityScore：权威度 0~1（按上面题材偏好判断，不要一律按"是不是政府网站"打分）
- isPrimary：1=一手 0=二手
- freshnessScore：时效性 0~1（越新越高；无日期给中间值）
- relevanceScore：与**本话题**的相关度 0~1（不是"看起来像不像正经文章"）

【特别注意】
- 不要因为"看起来像官网"就给 A。伪装成官方的营销站点很常见。
- 无法判断域名性质时给 U，不要猜。
- keep=0 表示建议丢弃，但必须在 reason 里说明为什么。
- idx 必须与输入的编号一致。
- 这里**只评估可信度与相关度，不因话题敏感/涉成人而降低评分或丢弃**——内容尺度由系统提示词统一管理。

{{schemaBlock}}`
  },
  {
    key: 'stage.extract.user',
    name: '⑥ 证据抽取 · 从来源里挖证据',
    category: 'stage',
    stageKey: 'extract',
    description: '从单条来源文本中抽取证据（断言+原文摘录+数据点）。鼓励把具体案例、数字、人名地名抽出来，避免"未找到"。',
    variables: [
      { name: 'title', desc: '来源标题', sample: '…' },
      { name: 'url', desc: '来源 URL', sample: '…' },
      { name: 'domain', desc: '来源域名', sample: 'zhihu.com' },
      { name: 'tier', desc: '来源权威等级', sample: 'C' },
      { name: 'text', desc: '来源正文/摘要文本', sample: '…' },
      { name: 'subQuestionBlock', desc: '待回答的子问题清单', sample: '- [id:3] …' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `【来源信息】
标题：{{title}}
URL：{{url}}
域名：{{domain}}
权威等级：{{tier}}

【来源文本】
{{text}}

【需要回答的子问题】
{{subQuestionBlock}}

请从上面的来源文本中，抽取能回答子问题的证据。要求：

1. **quote 必须原文照抄**，不得改写、不得翻译时塞入数值。没有原文可引就说明。
2. **claim 是一条可以独立理解的一句话断言**（报告里用的就是它），不能是"见原文第3段"这种。
3. **数值必须填进 dataPoints**，带单位（unit）和时间点（asOf，如 "2025Q1"、"截至2025-06"）。
4. **factKey** 是同一事实的规范键名，用于跨来源比对。格式：主题.指标.期间，如 "byd.2025.revenue"、"china_gdp.2024.expenditure_share"。同一个事实在不同来源里必须用同一个 key。
5. **confidence 自评**：high/medium/low/disputed。不确定就往低了给。
6. **inference**：如果是从文本推导出来的（原文没直接说），必须填 1，并在 inferenceChain 里写完整推理链条。
7. **尽量挖具体信息**：具体案例、具体数字、具体人名/地名/时间/产品名，都值得抽成证据。不要只抽泛泛的观点。（但依然只能来自上面的文本，不得编造。）
8. 一段文本可能产出多条证据，也可能一条都没有。**没有就返回空数组，不要硬凑。**

{{schemaBlock}}`
  },
  {
    key: 'stage.crosscheck.user',
    name: '⑦ 交叉验证 · 对冲突做裁决',
    category: 'stage',
    stageKey: 'crosscheck',
    description: '对同一事实键下互相冲突的多条证据做裁决：能裁就裁，不能裁就明确 unresolved。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'groupBlock', desc: '按事实键分组的证据清单', sample: '### 子问题 [id:3]…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

下面是同一子问题下的多条证据。系统已按事实键（factKey）分组，发现其中存在**数值或结论上的冲突**。请你做裁决。

{{groupBlock}}

【裁决规则 —— 严格遵守】
1. 你只能在这些证据里挑选，不许引入证据之外的新事实。
2. adjudication=adjudicated（已裁决）**必须有 A 级来源支撑**，否则必须标 unresolved。
3. 必须给出 rootCause（为什么会不一样）：口径差异 / 时间点差异 / 样本差异 / 利益立场 / 数据不可得。
4. verdict 是"本报告采用哪个口径"，要写明理由。
5. **不许和稀泥**。如果确实无法裁决，就明确写 unresolved，这本身就是有价值的结论。
6. 同时给每个子问题一句 answer（简答）和 confidence。

{{schemaBlock}}`
  },
  {
    key: 'stage.outline.user',
    name: '⑧ 大纲 · 设计报告结构',
    category: 'stage',
    stageKey: 'draft',
    description: '设计报告大纲。主体章节的骨架由「报告风格」决定（tone.<key>.shape），分歧地图/局限等由系统自动拼装，不在这里生成。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'perspectiveList', desc: '已定义的视角清单', sample: '- roster（名单）…' },
      { name: 'sqList', desc: '子问题及回答状态', sample: '- [id:1] …' },
      { name: 'sectionCount', desc: '要求的章节数区间', sample: '4~6 节' },
      { name: 'shapeBlock', desc: '当前风格要求的报告骨架', sample: '【主体章节要求 · 搞怪清单体】…' },
      { name: 'toneNote', desc: '当前风格提示', sample: '…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

【已定义的分析视角】
{{perspectiveList}}

【子问题及当前回答状态】
{{sqList}}

{{shapeBlock}}

【统一要求】
1. 主体章节数量：{{sectionCount}}（按上面的骨架要求来）。
2. 每节必须标注它要回答哪些 subQuestionIds（从上面的 [id:N] 里选）。
3. 章节标题要**具体**，一眼能看出这节讲的是什么。
   - ❌ 禁止"背景介绍""现状分析""综合分析""总结与展望"这类空洞标题。
   - ✅ 好标题例如："Top 5 都是谁""到底要花多少钱""大家是怎么吐槽的""数据到底靠不靠谱"。
4. 每节的 purpose 要写清"这节回答原问题的哪一部分"。
5. **只设计内容章节**：不要把"执行摘要""分歧地图""本报告的局限"写进 sections——这些由系统自动拼装。
6. 再确认一次：所有章节都必须跟上面的话题直接相关，不许出现跟题目无关的领域章节。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.section.user',
    name: '⑨ 逐节写作（核心）',
    category: 'stage',
    stageKey: 'draft',
    description: '报告正文的核心：逐节写作，每节只喂本节证据，句末必须挂 [[ev:id]] 引用。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'heading', desc: '本节标题', sample: '技术视角' },
      { name: 'purpose', desc: '本节目的', sample: '…' },
      { name: 'perspectiveLine', desc: '本节视角行（可空）', sample: '【本节视角】tech' },
      { name: 'subQuestionBlock', desc: '本节要回答的子问题', sample: '- [id:1] …' },
      { name: 'evidenceCount', desc: '本节可用证据条数', sample: '8' },
      { name: 'evidenceBlock', desc: '本节可用证据清单（只能引用这些）', sample: '[ev:12] 断言：…' },
      { name: 'priorBlock', desc: '前文已写内容的摘要（避免重复）', sample: '【前文已写过…】…' },
      { name: 'words', desc: '本节篇幅要求', sample: '150~300 字' },
      { name: 'toneNote', desc: '当前风格提示', sample: '…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

【本节标题】{{heading}}
【本节目的】{{purpose}}
{{perspectiveLine}}

【本节要回答的子问题】
{{subQuestionBlock}}

【本节可用的证据】（共 {{evidenceCount}} 条，**只能引用这些**）
{{evidenceBlock}}
{{priorBlock}}

【写作要求 —— 严格遵守】
1. 篇幅 {{words}}。
2. **每一条事实性/数据性断言句末必须挂 [[ev:<id>]]**，id 只能来自上面的证据列表。
3. **不要编造证据之外的内容**，但也**不要把"未找到"当挡箭牌**。当某个点证据不足时：
   - ❌ 禁止反复写"关于 XX，本次检索未找到可采信来源""暂未发现相关案例""未找到具体数据""资料缺乏""信息不足""难以获取"这类空话——这正是让报告显得不可信的主因。
   - ✅ 正确做法：① 先把你手头**有**的、哪怕只能侧证的证据讲透（能推到哪里就推到哪里，并标明"（此为间接推断）"）；② 再**具体说明缺的是什么**（缺哪一年/哪个口径/哪类一手来源/哪个地区），而不是笼统说"没找到"；③ 给一句可操作的补救方向（例如"需查 XX 统计年鉴/企业财报/招股书"）。
   - **量化约束**：全文"未找到/未发现/暂无/缺乏/缺失/资料不足/信息不足/难以获取"这类表意空洞的词，**合计不超过 2 次**，且只能出现在 unresolved 或"本报告局限"里；正文叙述段一律要用"已知什么 + 缺什么"的具体句式替代。
4. **同步产出 keyPoints**：3~5 条本节的核心结论句。这些句子会被速览版和深度版共用，所以必须：
   - 每条能独立成立，不依赖上下文
   - **不要包含 [[ev:]] 标记**
   - 是结论，不是"本节讨论了 XX"这种目录式描述
   - 也不要是"证据不足""未找到"这类空洞句；实在没有结论时，给"现有证据指向什么"的判断
5. **unresolved 数组必须填**：本节没能解决但值得注意的问题。**要具体到"缺什么"**（缺哪个年份的数据、哪个口径、哪类来源），不要写"资料不足"这种废话，也不要用空数组敷衍。
6. 禁止写"综上所述""值得注意的是""在当今时代"这类套话。禁止空泛形容词堆砌。
7. 数字必须带单位和时间点。
8. 如果证据里有推断类（标注【这是推断】的），引用时要写明"（推断）"并简述推理依据。
9. **信息浓度（最重要的一条）**：正文里必须出现**具体的人名 / 作品名 / 品牌名 / 地名 / 数字 / 年份 / 榜单名次 / 具体案例**。
   - 写完一节后自检：如果读者说不出"这一节到底给了我哪些具体信息"，那这一节就是失败的，必须重写。
   - 有数字就把数字写出来（带单位和时间点）；有榜单就把名次写出来；有作品/人物就把名字写出来；有对比就把两边的数字都摆出来。
   - ❌ 只写"很受欢迎""影响力很大""深受喜爱""发展迅速"这种没有具体支撑的话，等于没写。
   - ❌ 也不要整节都在谈"趋势""格局""意义"这类大词——这是在凑字数。
10. **仍然紧扣题目**：本节内容必须直接回答上面列出的子问题。如果证据里混进了与本节主题无关的材料，**直接不要用**，不要为了填满篇幅把它写进来。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.expand.user',
    name: '⑩ 深度版逐节扩写',
    category: 'stage',
    stageKey: 'render',
    description: '仅 deep 模式使用：在标准版基础上逐节扩写细节与数据，但不改变核心结论。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'heading', desc: '本节标题', sample: '…' },
      { name: 'keyPointBlock', desc: '本节已有核心结论（不得改变）', sample: '1. …' },
      { name: 'standardMd', desc: '标准版正文', sample: '…' },
      { name: 'evidenceBlock', desc: '本节可用证据', sample: '[ev:12] …' },
      { name: 'toneNote', desc: '当前风格提示', sample: '…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}
章节：{{heading}}

【标准版已有的核心结论 —— 扩写时不得改变这些结论，只能补充论证过程、细节和数据】
{{keyPointBlock}}

【标准版正文】
{{standardMd}}

【本节可用证据】
{{evidenceBlock}}

【扩写要求】
1. 在标准版基础上补充：更完整的数据、论证过程、反例、边界条件。
2. **不得改变核心结论**，不得引入与 keyPoints 矛盾的说法。
3. 新增内容同样必须挂 [[ev:<id>]]。
4. 不得新增章节、不得改变结构。
5. 篇幅 1200~2500 字。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.summary.user',
    name: '⑪ 执行摘要',
    category: 'stage',
    stageKey: 'render',
    description: '生成速览版核心：核心结论/最大分歧/最不可靠的部分/本报告局限。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'keyPointList', desc: '各节核心结论（带节标题）', sample: '（第1节 技术视角）…' },
      { name: 'disagreementBlock', desc: '已识别的分歧', sample: '- …' },
      { name: 'toneNote', desc: '当前风格提示', sample: '…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

【各节核心结论】
{{keyPointList}}

【已识别的分歧】
{{disagreementBlock}}

请写一份执行摘要（速览版的核心），400 字以内。必须包含四部分：
1. **核心结论**：最重要的一两个判断。
2. **最大分歧**：各方说法不一致的地方（没有就写"本次未发现显著分歧"）。
3. **最不可靠的部分**：置信度最低、最可能是错的结论——这比核心结论更重要。
4. **本报告局限**：**具体**说明缺的是哪类证据（哪个年份/哪个地区/哪类一手来源），并给一句补救方向；不要写成"资料有限""未找到信息"这类套话。

每一条都必须能追溯到上面某节的核心结论，不许引入新信息。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.disagreement.user',
    name: '⑫ 分歧地图润色',
    category: 'stage',
    stageKey: 'render',
    description: '把系统识别出的分歧点润色成人能读懂的"分歧地图"。注意：不裁决 unresolved 的分歧。',
    variables: [
      { name: 'topic', desc: '研究话题', sample: '…' },
      { name: 'disagreementBlock', desc: '分歧点清单', sample: '[0] …' },
      { name: 'toneNote', desc: '当前风格提示', sample: '…' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `研究话题：{{topic}}

下面是系统识别出的分歧点。请把它们润色成一份人能读懂的"分歧地图"。

{{disagreementBlock}}

要求：
- 立场标签只能用：official 官方口径 / academic 学界 / media 媒体 / skeptic 质疑方 / vendor 厂商自述。
- **不许裁决 unresolved 的分歧**，保持其 unresolved 状态——"这个问题没有定论"本身就是重要结论。
- 必须说明"为什么会不一样"（口径差异/时间点差异/样本差异/利益立场/数据不可得）。
- 语气中立，不站队。

{{toneNote}}
{{schemaBlock}}`
  },
  {
    key: 'stage.audit.user',
    name: '⑬ 逐节自审',
    category: 'stage',
    stageKey: 'audit',
    description: '审查报告正文，只挑毛病（无证据断言/逻辑跳跃/过度自信/数据过时/片面）。',
    variables: [
      { name: 'heading', desc: '章节标题', sample: '…' },
      { name: 'sectionMd', desc: '章节正文', sample: '…' },
      { name: 'allowIds', desc: '本章可用的证据 id 列表', sample: '12, 15, 18' },
      { name: 'evidenceBlock', desc: '证据简表', sample: '[ev:12] …' },
      { name: 'schemaBlock', desc: '本步 JSON 结构', sample: '…' }
    ],
    template: `请审查下面这段报告正文，只挑毛病，不要重写。

【章节】{{heading}}

【正文】
{{sectionMd}}

【本章可用的证据 id 列表】{{allowIds}}
{{evidenceBlock}}

【检查项】
- no_evidence：有没有无证据支撑的事实性断言（包括挂了不存在的 id 的）
- logic_jump：有没有逻辑跳跃（前提推不出结论）
- overconfident：有没有把推断写成事实、把低置信度写成确定
- stale_data：有没有用了明显过时的数据却当现状说
- missing_perspective：有没有只呈现了一面之词
- hollow_hedge：有没有"未找到相关案例/未发现具体信息/缺乏数据/资料有限/信息不足"这类**没有信息量的空话**（应改为"讲清已有什么 + 具体缺什么 + 怎么补"）
- off_topic：有没有**跟章节主题/原问题无关**的内容（例如问某个人物却大谈产业、消费、政策、旅游）——这是最严重的毛病
- vague_no_specifics：有没有通篇只有"很受欢迎""影响很大""趋势明显"这类**没有具体人名/数字/时间/案例**的空段

要求：
- 每条 issue 必须 quote 出原文里出问题的那句话。
- 宁可漏报，不要为了凑数乱报。
- 只输出 issues 数组。

{{schemaBlock}}`
  },

  /* ============ 题材纲领（按题材切换整套拆题/视角/取信标准） ============ */
  ...allGenreTemplateDefaults()
]
