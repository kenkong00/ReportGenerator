/**
 * 检索结果相关性闸门。
 *
 * 解决的问题：搜索引擎（尤其是被填充页污染时）会返回与查询毫无关系的条目——
 * 例如用"Future trends in outdoor leisure tourism"去搜，Bing 会返回
 * "future 是什么意思_爱词霸"、"Future Electronics"、"ChatGPT 中文"，
 * 维基兜底还会返回"加拿大""驴交"这种完全无关的随机条目，最终污染报告。
 *
 * 判定规则（宽进严出，宁可少杀）：
 *   保留 = 命中「话题锚点」 或 命中 ≥2 个「查询关键词」
 * 话题锚点来自研究话题本身（露营→{露营, camping, outdoor...} 的中/英关键词），
 * 只要正文里出现一个即认为"确实在讲这件事"。
 *
 * 2026-10 追加：**泛词锚点不能单独证明相关**。
 *   实测踩过的坑：话题「中国人最爱的日本AV女优」被搜索引擎降级成"日本"，
 *   于是返回「日本国家旅游局」「外交部·国家概况」「剑桥词典 Japanese」这类页面，
 *   而它们都命中了"日本"这个锚点 → 全部放行 → 报告通篇变成日本旅游。
 *   修法：把地域/通用元词（中国、日本、国家、文化、市场、旅游…）列为「泛词」，
 *   只用泛词命中的结果必须再满足"≥1 个非泛词命中"，否则丢弃。
 *   同时避免误伤：如果去掉泛词后锚点几乎没了（话题本身就是"旅游/经济"这类），
 *   就退回原来的宽判定。
 */

/** 泛词：出现它们只能说明"沾点边"，不能说明"在讲这个话题" */
const GENERIC = new Set([
  /* 地域 / 政治 */
  '中国', '中国', '中国人', '日本', '日本人', '美国', '韩国', '英国', '法国', '德国', '俄罗斯',
  '印度', '泰国', '越南', '台湾', '香港', '澳门', '世界', '全球', '国家', '全国', '国际', '国内',
  '外国', '海外', '亚洲', '欧洲', '非洲', '美洲', '东方', '西方', '大陆', '地区', '城市', '地方',
  /* 通用元词 */
  '文化', '经济', '市场', '社会', '生活', '历史', '政治', '政策', '政府', '官方', '企业', '公司',
  '行业', '产业', '媒体', '网络', '互联网', '科技', '教育', '健康', '旅游', '旅行', '消费', '商业',
  '女性', '男性', '女生', '男生', '女人', '男人', '人群', '人们', '用户', '观众', '读者', '消费者',
  '内容', '平台', '产品', '品牌', '价格', '数据', '报告', '研究', '分析', '信息', '新闻', '文章',
  '网站', '网页', '介绍', '概述', '简介', '概况', '百科', '官网', '首页', '相关', '综合', '大全',
  '最新', '热门', '流行', '趋势', '发展', '变化', '影响', '问题', '情况', '方面', '时间', '今年',
  '去年', '未来', '原因', '结果', '作用', '意义', '特点', '优势', '缺点', '方法', '方式', '技巧',
  '注意', '推荐', '评价', '排名', '榜单', '整理', '盘点', '指南',
  /* 英文 */
  'japan', 'japanese', 'china', 'chinese', 'korea', 'korean', 'usa', 'america', 'american',
  'world', 'global', 'country', 'national', 'international', 'asia', 'asian', 'europe',
  'culture', 'cultural', 'economy', 'economic', 'market', 'social', 'society', 'life', 'history',
  'politics', 'government', 'official', 'policy', 'company', 'industry', 'media', 'internet',
  'technology', 'education', 'health', 'travel', 'tourism', 'women', 'men', 'people', 'users',
  'content', 'platform', 'product', 'brand', 'price', 'data', 'report', 'research', 'analysis',
  'news', 'article', 'website', 'guide', 'general', 'overview', 'introduction', 'information',
  'latest', 'popular', 'trend', 'development', 'change', 'impact', 'issue', 'top', 'best', 'list'
])

function isGeneric(k) {
  return GENERIC.has(String(k).toLowerCase())
}

const LATIN_STOP = new Set([
  'the', 'and', 'for', 'with', 'are', 'was', 'were', 'from', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'does', 'did', 'not', 'you',
  'your', 'its', 'can', 'could', 'will', 'would', 'should', 'all', 'any', 'new', 'use', 'get',
  'about', 'into', 'over', 'more', 'most', 'than', 'then', 'them', 'they', 'there', 'here',
  'also', 'such', 'some', 'many', 'much', 'other', 'only', 'just', 'like', 'very', 'been',
  'have', 'has', 'had', 'but', 'out', 'off', 'per', 'via', 'www', 'com', 'http', 'https'
])

// 中文里高频但无实义的二字/三字组合（避免"因为/所以"这类词造成误判）
const CJK_STOP = new Set([
  '什么', '怎么', '如何', '哪些', '是否', '可以', '我们', '他们', '她们', '以及', '一个',
  '这个', '那个', '因为', '所以', '但是', '而且', '就是', '还有', '已经', '认为', '目前',
  '现在', '问题', '方面', '情况', '时候', '为什么', '到底', '真的', '可能', '需要', '主要',
  '最新', '近年', '近年', '有关', '相关', '进行', '出现', '产生', '带来', '造成', '导致'
])

/** 抽关键词：中文取连续汉字串的 2-gram，英文取长度 ≥3 的词 */
export function extractKeywords(text) {
  const s = String(text || '')
  const cjk = new Set()
  const latin = new Set()
  for (const run of (s.match(/[\u4e00-\u9fa5]{2,}/g) || [])) {
    if (run.length <= 3) { if (!CJK_STOP.has(run)) cjk.add(run); continue }
    for (let i = 0; i + 2 <= run.length; i++) {
      const bg = run.slice(i, i + 2)
      if (!CJK_STOP.has(bg)) cjk.add(bg)
    }
  }
  for (const w of (s.match(/[A-Za-z]{3,}/g) || [])) {
    const lw = w.toLowerCase()
    if (!LATIN_STOP.has(lw)) latin.add(lw)
  }
  return { cjk, latin }
}

/**
 * 由研究话题构造"锚点关键词"。
 * 话题通常较短且是核心词，所以这里不做 2-gram 切碎，直接整串 + 常识英文映射，
 * 命中率反而更高、误杀更少。
 */
export function buildAnchors(topic, extra = []) {
  const raw = String(topic || '')
  const { cjk, latin } = extractKeywords(raw)
  const anchors = { cjk: new Set(cjk), latin: new Set(latin) }

  // 中文话题词直接整词加入（露营 / 比亚迪 / 新能源…）
  for (const run of (raw.match(/[\u4e00-\u9fa5]{2,}/g) || [])) {
    if (run.length <= 6 && !CJK_STOP.has(run)) anchors.cjk.add(run)
  }
  // 常见领域的英文等价词，帮助英文源通过
  const EN_MAP = [
    [/露营|野营|户外/, ['camping', 'camp', 'outdoor', 'glamping']],
    [/汽车|新能源|电动车|电车/, ['car', 'vehicle', 'ev', 'auto', 'battery']],
    [/经济|市场|消费|金融/, ['economy', 'market', 'consumption', 'finance']],
    [/健康|心理|医疗/, ['health', 'mental', 'medical', 'psychology']],
    [/旅游|旅行|度假/, ['travel', 'tourism', 'vacation', 'resort']],
    [/游戏|电竞/, ['game', 'gaming', 'esports']],
    [/教育|大学|升学/, ['education', 'university', 'college']],
    [/科技|互联网|芯片|半导体/, ['tech', 'internet', 'chip', 'semiconductor']],
    [/美食|餐饮|食品/, ['food', 'cuisine', 'restaurant']],
    [/运动|健身|体育/, ['sport', 'fitness', 'exercise']]
  ]
  const pool = raw + ' ' + (extra || []).join(' ')
  for (const [re, words] of EN_MAP) if (re.test(pool)) words.forEach(w => anchors.latin.add(w))

  // 额外主题词（如子问题里的核心词）也纳入，提高召回
  for (const t of (extra || [])) {
    const k = extractKeywords(t)
    k.cjk.forEach(x => { if (x.length >= 2) anchors.cjk.add(x) })
    k.latin.forEach(x => anchors.latin.add(x))
  }

  // 去泛词后的"强锚点"：只有它能单独证明相关性（见 isRelevant）
  anchors.strong = strongOnly(anchors)
  return anchors
}

/** 统计结果文本命中了哪些关键词 */
function hits(result, kw) {
  const text = ((result?.title || '') + ' ' + (result?.snippet || '') + ' ' + (result?.url || '')).toLowerCase()
  const cjkHits = []
  for (const k of kw.cjk) if (text.includes(k)) cjkHits.push(k)
  const latinHits = []
  for (const k of kw.latin) if (text.includes(k)) latinHits.push(k)
  return { cjkHits, latinHits, total: cjkHits.length + latinHits.length }
}

/** 从关键词集合里剔除泛词，得到"能证明相关性"的强词 */
function strongOnly(kw) {
  const cjk = new Set()
  const latin = new Set()
  for (const k of (kw?.cjk || [])) if (!isGeneric(k)) cjk.add(k)
  for (const k of (kw?.latin || [])) if (!isGeneric(k)) latin.add(k)
  return { cjk, latin }
}

/** 一组关键词是否"可用作强判定"（非泛词数量足够多） */
function usable(kw) {
  return (kw.cjk.size + kw.latin.size) >= 2
}

/**
 * 判断单个结果是否相关。
 * @param {object} result  {title, snippet, url}
 * @param {{cjk:Set,latin:Set}} queryKw  查询关键词
 * @param {{cjk:Set,latin:Set,strong?:{cjk:Set,latin:Set}}} anchors  话题锚点（strong = 去掉泛词后的锚点）
 */
export function isRelevant(result, queryKw, anchors) {
  const h = hits(result, queryKw)
  if (h.total === 0) return false

  const strong = anchors?.strong || strongOnly(anchors)
  if (usable(strong)) {
    // 命中非泛词锚点 → 确实在讲这个话题
    if (hits(result, strong).total >= 1) return true
    // 否则：至少 2 个查询词命中，且其中至少一个是非泛词
    return h.total >= 2 && hits(result, strongOnly(queryKw)).total >= 1
  }

  // 锚点几乎全是泛词（话题本身就是"旅游/经济/文化"这类）→ 退回宽判定
  if (hits(result, anchors).total >= 1) return true
  return h.total >= 2
}

/**
 * 过滤结果数组，返回 {kept, dropped, rescued}。
 * 兜底策略（避免误杀）：
 *   - 结果集很小（≤2 条）时保留原样：可能是同义表述导致词面不匹配；
 *   - 结果全都没有正文（title/snippet 都空）时保留原样：无文本无法判定，不该冤杀。
 * 其余情况（例如 8 条结果全是词典站 / ChatGPT / 随机维基条目）一律剔除，
 * 不因为"过滤后为空"就把垃圾放回去。
 */
export function filterRelevant(results, query, anchors) {
  const list = Array.isArray(results) ? results : []
  if (!list.length) return { kept: [], dropped: 0, rescued: false }
  const queryKw = extractKeywords(query)
  const kept = []
  let dropped = 0
  let textual = 0
  for (const r of list) {
    if (String(r?.title || '').trim() || String(r?.snippet || '').trim()) textual++
    if (isRelevant(r, queryKw, anchors)) kept.push(r)
    else dropped++
  }
  const noText = textual === 0
  if (!kept.length && (list.length <= 2 || noText)) {
    return { kept: list, dropped: 0, rescued: true }
  }
  return { kept, dropped, rescued: false }
}
