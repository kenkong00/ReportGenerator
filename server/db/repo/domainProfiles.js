import { q, one, run } from '../index.js'

/**
 * 中国语境域名权威画像。
 * tier: A 一手权威 | B 专业二手 | C 需交叉 | D 基本不用 | U 未知
 * kind: gov|stats|regulator|exchange|corporate|academic|media|industry|ugc|forum|wiki|international|marketing|blocked
 */
export const SEED = [
  // ---- A 一手权威：政府与监管 ----
  ['stats.gov.cn', 'A', 0.98, 'stats', 1, '国家统计局'],
  ['gov.cn', 'A', 0.95, 'gov', 1, '中国政府网'],
  ['pbc.gov.cn', 'A', 0.97, 'regulator', 1, '中国人民银行'],
  ['csrc.gov.cn', 'A', 0.97, 'regulator', 1, '中国证监会'],
  ['miit.gov.cn', 'A', 0.96, 'regulator', 1, '工业和信息化部'],
  ['mof.gov.cn', 'A', 0.96, 'gov', 1, '财政部'],
  ['customs.gov.cn', 'A', 0.96, 'gov', 1, '海关总署'],
  ['ndrc.gov.cn', 'A', 0.96, 'gov', 1, '国家发改委'],
  ['mofcom.gov.cn', 'A', 0.95, 'gov', 1, '商务部'],
  ['sasac.gov.cn', 'A', 0.94, 'gov', 1, '国资委'],
  ['nea.gov.cn', 'A', 0.94, 'regulator', 1, '国家能源局'],
  ['mee.gov.cn', 'A', 0.94, 'regulator', 1, '生态环境部'],
  ['most.gov.cn', 'A', 0.94, 'gov', 1, '科技部'],
  ['cnipa.gov.cn', 'A', 0.95, 'regulator', 1, '国家知识产权局'],
  ['samr.gov.cn', 'A', 0.95, 'regulator', 1, '国家市场监督管理总局'],
  ['nbs.gov.cn', 'A', 0.95, 'stats', 1, '统计局备用域名'],

  // ---- A 一手权威：交易所与披露 ----
  ['sse.com.cn', 'A', 0.96, 'exchange', 1, '上海证券交易所'],
  ['szse.cn', 'A', 0.96, 'exchange', 1, '深圳证券交易所'],
  ['bse.cn', 'A', 0.94, 'exchange', 1, '北京证券交易所'],
  ['hkexnews.hk', 'A', 0.95, 'exchange', 1, '港交所披露易'],
  ['cninfo.com.cn', 'A', 0.94, 'exchange', 1, '巨潮资讯网（法定披露）'],
  ['sec.gov', 'A', 0.97, 'regulator', 1, '美国 SEC'],
  ['nasdaq.com', 'A', 0.9, 'exchange', 1, '纳斯达克'],

  // ---- A 一手权威：国际机构 ----
  ['imf.org', 'A', 0.95, 'international', 1, 'IMF'],
  ['worldbank.org', 'A', 0.95, 'international', 1, '世界银行'],
  ['oecd.org', 'A', 0.94, 'international', 1, 'OECD'],
  ['who.int', 'A', 0.94, 'international', 1, 'WHO'],
  ['weforum.org', 'A', 0.88, 'international', 1, '世界经济论坛'],
  ['iea.org', 'A', 0.93, 'international', 1, '国际能源署'],
  ['unctad.org', 'A', 0.92, 'international', 1, '联合国贸发会议'],

  // ---- A：学术 ----
  ['nature.com', 'A', 0.96, 'academic', 1, 'Nature'],
  ['science.org', 'A', 0.96, 'academic', 1, 'Science'],
  ['cnki.net', 'A', 0.9, 'academic', 1, '中国知网'],
  ['arxiv.org', 'A', 0.88, 'academic', 1, 'arXiv 预印本'],
  ['ieee.org', 'A', 0.9, 'academic', 1, 'IEEE'],
  ['pubmed.ncbi.nlm.nih.gov', 'A', 0.95, 'academic', 1, 'PubMed'],

  // ---- A：企业官方（投资者关系 / 官网）----
  ['byd.com', 'A', 0.85, 'corporate', 1, '比亚迪官网'],
  ['bydauto.com.cn', 'A', 0.85, 'corporate', 1, '比亚迪汽车'],
  ['tesla.com', 'A', 0.85, 'corporate', 1, '特斯拉官网'],
  ['spacex.com', 'A', 0.85, 'corporate', 1, 'SpaceX 官网'],
  ['huawei.com', 'A', 0.85, 'corporate', 1, '华为官网'],
  ['catl.com', 'A', 0.85, 'corporate', 1, '宁德时代官网'],
  ['nio.com', 'A', 0.82, 'corporate', 1, '蔚来官网'],
  ['xiaomi.com', 'A', 0.82, 'corporate', 1, '小米官网'],
  ['apple.com', 'A', 0.88, 'corporate', 1, '苹果官网'],
  ['nvidia.com', 'A', 0.88, 'corporate', 1, '英伟达官网'],
  ['intel.com', 'A', 0.88, 'corporate', 1, '英特尔官网'],
  ['tsmc.com', 'A', 0.88, 'corporate', 1, '台积电官网'],
  ['samsung.com', 'A', 0.85, 'corporate', 1, '三星官网'],
  ['lg.com', 'A', 0.83, 'corporate', 1, 'LG 官网'],
  ['boeing.com', 'A', 0.85, 'corporate', 1, '波音官网'],
  ['siemens.com', 'A', 0.85, 'corporate', 1, '西门子官网'],

  // ---- B 专业二手：主流财经媒体 ----
  ['caixin.com', 'B', 0.85, 'media', 0, '财新（付费墙，常只能取摘要）'],
  ['yicai.com', 'B', 0.84, 'media', 0, '第一财经'],
  ['jiemian.com', 'B', 0.8, 'media', 0, '界面新闻'],
  ['thepaper.cn', 'B', 0.8, 'media', 0, '澎湃新闻'],
  ['stcn.com', 'B', 0.8, 'media', 0, '证券时报'],
  ['cs.com.cn', 'B', 0.8, 'media', 0, '中国证券报'],
  ['ssnews.com.cn', 'B', 0.78, 'media', 0, '上海证券报'],
  ['xinhuanet.com', 'B', 0.83, 'media', 0, '新华网'],
  ['people.com.cn', 'B', 0.83, 'media', 0, '人民网'],
  ['chinanews.com.cn', 'B', 0.82, 'media', 0, '中新网'],
  ['cctv.com', 'B', 0.82, 'media', 0, '央视网'],
  ['cnr.cn', 'B', 0.8, 'media', 0, '央广网'],
  ['21jingji.com', 'B', 0.78, 'media', 0, '21世纪经济报道'],
  ['nbd.com.cn', 'B', 0.76, 'media', 0, '每日经济新闻'],
  ['eeo.com.cn', 'B', 0.76, 'media', 0, '经济观察报'],

  // ---- B：财经数据平台 / 行业机构 ----
  ['eastmoney.com', 'B', 0.75, 'financial', 0, '东方财富（数据源，注意一手性）'],
  ['10jqka.com.cn', 'B', 0.72, 'financial', 0, '同花顺'],
  ['xueqiu.com', 'B', 0.7, 'financial', 0, '雪球（UGC 与数据混合）'],
  ['wind.com.cn', 'B', 0.82, 'financial', 0, 'Wind 资讯'],
  ['choice.com.cn', 'B', 0.8, 'financial', 0, 'Choice 数据'],
  ['iwencai.com', 'B', 0.7, 'financial', 0, '问财'],
  ['chinairn.com', 'B', 0.65, 'industry', 0, '中国行业研究网'],
  ['askci.com', 'B', 0.68, 'industry', 0, '中商产业研究院'],
  ['iimedia.cn', 'B', 0.68, 'industry', 0, '艾媒咨询'],
  ['qianfan-analytics.cn', 'B', 0.66, 'industry', 0, '千帆分析'],
  ['caam.org.cn', 'A', 0.9, 'industry', 1, '中国汽车工业协会'],
  ['cnevpost.com', 'B', 0.72, 'media', 0, '电车之家英文站'],
  ['ev-volumes.com', 'B', 0.75, 'industry', 0, 'EV Volumes'],
  ['cae.cn', 'A', 0.88, 'academic', 1, '中国工程院'],
  ['cas.cn', 'A', 0.9, 'academic', 1, '中国科学院'],

  // ---- B：国际媒体（注意本机可达性）----
  ['reuters.com', 'B', 0.88, 'media', 0, '路透社（本机常不可达，仅摘要）'],
  ['bloomberg.com', 'B', 0.88, 'media', 0, '彭博（付费墙）'],
  ['ft.com', 'B', 0.87, 'media', 0, '金融时报'],
  ['wsj.com', 'B', 0.86, 'media', 0, '华尔街日报'],
  ['nytimes.com', 'B', 0.84, 'media', 0, '纽约时报'],
  ['bbc.com', 'B', 0.83, 'media', 0, 'BBC（本机常不可达）'],
  ['economist.com', 'B', 0.85, 'media', 0, '经济学人'],
  ['nikkei.com', 'B', 0.82, 'media', 0, '日经'],
  ['scmp.com', 'B', 0.8, 'media', 0, '南华早报'],

  // ---- C 需交叉验证 ----
  ['zhihu.com', 'C', 0.5, 'ugc', 0, '知乎（需看作者资质）'],
  ['baike.baidu.com', 'C', 0.45, 'wiki', 0, '百度百科'],
  ['baike.sogou.com', 'C', 0.42, 'wiki', 0, '搜狗百科'],
  ['36kr.com', 'C', 0.6, 'media', 0, '36氪'],
  ['huxiu.com', 'C', 0.58, 'media', 0, '虎嗅'],
  ['tmtpost.com', 'C', 0.56, 'media', 0, '钛媒体'],
  ['donews.com', 'C', 0.5, 'media', 0, 'DoNews'],
  ['ifeng.com', 'C', 0.6, 'media', 0, '凤凰网'],
  ['sohu.com', 'C', 0.55, 'media', 0, '搜狐（转载多）'],
  ['163.com', 'C', 0.55, 'media', 0, '网易（转载多）'],
  ['sina.com.cn', 'C', 0.62, 'media', 0, '新浪（含财经频道为 B）'],
  ['qq.com', 'C', 0.55, 'media', 0, '腾讯网'],
  ['toutiao.com', 'C', 0.45, 'media', 0, '今日头条'],
  ['baijiahao.baidu.com', 'C', 0.4, 'ugc', 0, '百家号'],
  ['mp.weixin.qq.com', 'C', 0.45, 'ugc', 0, '微信公众号'],
  ['investing.com', 'C', 0.65, 'financial', 0, 'Investing.com'],
  ['tradingeconomics.com', 'C', 0.68, 'financial', 0, 'Trading Economics'],
  ['tradingview.com', 'C', 0.6, 'financial', 0, 'TradingView'],
  ['wikipedia.org', 'C', 0.55, 'wiki', 0, '维基百科（本机常不可达）'],

  // ---- D 基本不用 ----
  ['tieba.baidu.com', 'D', 0.15, 'forum', 0, '百度贴吧'],
  ['ngabbs.com', 'D', 0.15, 'forum', 0, 'NGA 论坛'],
  ['v2ex.com', 'D', 0.25, 'forum', 0, 'V2EX'],
  ['reddit.com', 'D', 0.3, 'forum', 0, 'Reddit'],
  ['zhihu.com/pin', 'D', 0.2, 'forum', 0, '知乎想法'],
  ['weibo.com', 'D', 0.3, 'ugc', 0, '微博'],

  // ---- blocked 已知不可达/反爬 ----
  ['zhuanlan.zhihu.com', 'U', 0.5, 'blocked', 0, '知乎专栏：403，仅取摘要'],
  ['baidu.com', 'U', 0.3, 'blocked', 0, '百度搜索结果页：跳验证码'],
  ['google.com', 'U', 0.6, 'blocked', 0, 'Google：本机不可达']
]

export function seed() {
  const ins = `INSERT INTO domain_profiles(domain, tier, score, kind, is_primary_default, note, source, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'builtin', datetime('now'))
               ON CONFLICT(domain) DO UPDATE SET
                 tier=excluded.tier, score=excluded.score, kind=excluded.kind,
                 is_primary_default=excluded.is_primary_default, note=excluded.note,
                 source='builtin', updated_at=datetime('now')`
  let n = 0
  for (const row of SEED) {
    try { run(ins, ...row); n++ } catch (e) { /* 忽略单行失败 */ }
  }
  return n
}

/** 查域名画像，支持逐级回退匹配子域 */
export function lookup(domain) {
  if (!domain) return null
  const d = String(domain).replace(/^www\./, '').toLowerCase()
  let row = one('SELECT * FROM domain_profiles WHERE domain = ?', d)
  if (row) return row
  // 逐级向上匹配：ir.byd.com → byd.com
  const parts = d.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    row = one('SELECT * FROM domain_profiles WHERE domain = ?', parts.slice(i).join('.'))
    if (row) return row
  }
  return null
}

/** 用户覆盖某个域名 */
export function upsert({ domain, tier, score, kind, note }) {
  run(`INSERT INTO domain_profiles(domain, tier, score, kind, note, source, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', datetime('now'))
       ON CONFLICT(domain) DO UPDATE SET tier=excluded.tier, score=excluded.score,
         kind=excluded.kind, note=excluded.note, source='user', updated_at=datetime('now')`,
    domain, tier, score ?? 0.5, kind || 'other', note || '')
}

export function list(tier) {
  return tier
    ? q('SELECT * FROM domain_profiles WHERE tier = ? ORDER BY domain', tier)
    : q('SELECT * FROM domain_profiles ORDER BY tier, domain')
}

export function count() {
  return one('SELECT COUNT(*) c FROM domain_profiles')?.c || 0
}
