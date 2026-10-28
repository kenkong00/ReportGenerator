-- ============================================================
-- 深度调研报告生成器 · 全量 Schema（幂等，M1 一次到位）
-- ============================================================

-- ---------- 0. 设置（value 一律 JSON 字符串） ----------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  is_secret   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- 1. 项目 ----------
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  raw_topic       TEXT NOT NULL,
  clarified_topic TEXT,
  mode            TEXT NOT NULL DEFAULT 'standard',      -- quick|standard|deep
  genre           TEXT NOT NULL DEFAULT 'auto',          -- auto|life|ent|society|biz|tech（题材，决定整套拆题/视角/取信标准）
  status          TEXT NOT NULL DEFAULT 'draft',          -- draft|clarifying|running|paused|failed|done
  language        TEXT NOT NULL DEFAULT 'zh',
  budget_json     TEXT NOT NULL DEFAULT '{}',
  options_json    TEXT NOT NULL DEFAULT '{}',
  current_run_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_status  ON projects(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);

-- ---------- 2. 执行批次 ----------
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  trigger       TEXT NOT NULL DEFAULT 'manual',        -- manual|resume|rerun-stage
  status        TEXT NOT NULL DEFAULT 'running',       -- running|succeeded|failed|aborted|budget_exceeded
  current_stage TEXT,
  from_stage    TEXT,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  last_error    TEXT,
  stats_json    TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_seq ON runs(project_id, seq);

-- ---------- 3. 阶段流水 ----------
CREATE TABLE IF NOT EXISTS stages (
  id                TEXT PRIMARY KEY,                  -- `${runId}:${stageKey}`
  run_id            TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  project_id        TEXT NOT NULL,
  stage_key         TEXT NOT NULL,
  stage_index       INTEGER NOT NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',   -- pending|running|succeeded|failed|skipped
  attempt           INTEGER NOT NULL DEFAULT 0,
  input_json        TEXT,
  output_json       TEXT,
  summary           TEXT,
  error             TEXT,
  tokens_prompt     INTEGER NOT NULL DEFAULT 0,
  tokens_completion INTEGER NOT NULL DEFAULT 0,
  llm_calls         INTEGER NOT NULL DEFAULT 0,
  searches          INTEGER NOT NULL DEFAULT 0,
  fetches           INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT,
  finished_at       TEXT,
  duration_ms       INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stages_run_key ON stages(run_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_stages_project ON stages(project_id, stage_index);

-- ---------- 4. 事件流（SSE 持久化 + 过程回看） ----------
CREATE TABLE IF NOT EXISTS stage_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  stage_key    TEXT,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_run     ON stage_events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_project ON stage_events(project_id, seq);

-- ---------- 5. 澄清问答 ----------
CREATE TABLE IF NOT EXISTS clarify_qa (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  options_json TEXT,
  answer       TEXT,
  skipped      INTEGER NOT NULL DEFAULT 0,
  asked_run_id TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_clarify_project ON clarify_qa(project_id, id);

-- ---------- 6. 子问题 ----------
CREATE TABLE IF NOT EXISTS sub_questions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id               TEXT NOT NULL,
  ord                  INTEGER NOT NULL,
  question             TEXT NOT NULL,
  qtype                TEXT NOT NULL,                  -- factual|numeric|opinion|forecast|causal
  expected_source_type TEXT NOT NULL,                  -- official|academic|industry|media|financial|ugc
  perspective_key      TEXT,
  priority             INTEGER NOT NULL DEFAULT 2,     -- 1高 2中 3低
  rationale            TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',-- pending|searching|answered|unresolved
  answer               TEXT,
  confidence           TEXT,                           -- high|medium|low|disputed
  answered_by_stage    TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sq_project ON sub_questions(project_id, ord);
CREATE INDEX IF NOT EXISTS idx_sq_run     ON sub_questions(run_id);
CREATE INDEX IF NOT EXISTS idx_sq_persp   ON sub_questions(project_id, perspective_key);

-- ---------- 7. 视角 ----------
CREATE TABLE IF NOT EXISTS perspectives (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id           TEXT NOT NULL,
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  lens             TEXT NOT NULL,
  key_metrics_json TEXT,
  ord              INTEGER NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_persp_key ON perspectives(project_id, run_id, key);

-- ---------- 8. 检索词 ----------
CREATE TABLE IF NOT EXISTS search_queries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  sub_question_id INTEGER REFERENCES sub_questions(id) ON DELETE SET NULL,
  perspective_key TEXT,
  query           TEXT NOT NULL,
  lang            TEXT NOT NULL DEFAULT 'zh',
  engine          TEXT NOT NULL,
  engine_used     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',     -- pending|ok|empty|error
  results_count   INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sq2_project ON search_queries(project_id, id);
CREATE INDEX IF NOT EXISTS idx_sq2_subq    ON search_queries(sub_question_id);

-- ---------- 9. 来源 ----------
CREATE TABLE IF NOT EXISTS sources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  url_hash       TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  snippet        TEXT,
  domain         TEXT NOT NULL DEFAULT '',
  site_name      TEXT,
  published_at   TEXT,
  retrieved_at   TEXT NOT NULL DEFAULT (datetime('now')),
  language       TEXT,
  authority_tier TEXT NOT NULL DEFAULT 'U',            -- A|B|C|D|U
  authority_score REAL NOT NULL DEFAULT 0,
  is_primary     INTEGER,
  freshness_score REAL,
  relevance_score REAL,
  quality_score  REAL,
  eval_reason    TEXT,
  fetch_status   TEXT NOT NULL DEFAULT 'not_attempted',-- not_attempted|ok|failed|skipped|blocked
  fetch_error    TEXT,
  fetch_attempts INTEGER NOT NULL DEFAULT 0,
  content_chars  INTEGER NOT NULL DEFAULT 0,
  fulltext       TEXT,
  content_hash   TEXT,
  from_engine    TEXT,
  from_query_id  INTEGER REFERENCES search_queries(id) ON DELETE SET NULL,
  run_id         TEXT,                                  -- 首次发现它的那次运行（=版本），用于版本隔离
  in_report      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_dedupe ON sources(project_id, url_hash);
CREATE INDEX IF NOT EXISTS idx_sources_rank   ON sources(project_id, authority_tier, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain);
CREATE INDEX IF NOT EXISTS idx_sources_run    ON sources(project_id, run_id);

-- ---------- 10. 证据 ----------
CREATE TABLE IF NOT EXISTS evidences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id            TEXT,                              -- 归属的那次运行（=版本）；老数据由迁移回填
  source_id         INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  sub_question_id   INTEGER REFERENCES sub_questions(id) ON DELETE SET NULL,
  perspective_key   TEXT,
  claim             TEXT NOT NULL,
  quote             TEXT NOT NULL,
  quote_locator     TEXT,
  data_json         TEXT,
  fact_key          TEXT,
  polarity          TEXT,                              -- support|refute|neutral
  stance            TEXT,                              -- official|academic|media|skeptic|vendor
  confidence        TEXT NOT NULL DEFAULT 'medium',    -- high|medium|low|disputed
  confidence_rule   TEXT,
  confidence_llm    TEXT,
  confidence_reason TEXT,
  inference         INTEGER NOT NULL DEFAULT 0,        -- 1 = 这是推理不是事实
  inference_chain   TEXT,
  used_in_report    INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ev_project ON evidences(project_id, id);
CREATE INDEX IF NOT EXISTS idx_ev_run     ON evidences(project_id, run_id, id);
CREATE INDEX IF NOT EXISTS idx_ev_source  ON evidences(source_id);
CREATE INDEX IF NOT EXISTS idx_ev_subq    ON evidences(project_id, sub_question_id);
CREATE INDEX IF NOT EXISTS idx_ev_factkey ON evidences(project_id, fact_key);
CREATE INDEX IF NOT EXISTS idx_ev_persp   ON evidences(project_id, perspective_key);

-- ---------- 11. 报告章节 ----------
CREATE TABLE IF NOT EXISTS report_sections (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id            TEXT NOT NULL,
  ord               INTEGER NOT NULL,
  level             INTEGER NOT NULL DEFAULT 2,
  perspective_key   TEXT,
  heading           TEXT NOT NULL,
  md                TEXT NOT NULL,                     -- 标准版
  md_brief          TEXT,                              -- 速览版
  md_deep           TEXT,                              -- 深度版
  key_points_json   TEXT NOT NULL DEFAULT '[]',        -- 三档共用的核心结论句
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  unresolved_json   TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'draft',     -- draft|written|expanded|audited
  audit_json        TEXT,
  tokens_prompt     INTEGER NOT NULL DEFAULT 0,
  tokens_completion INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sec_project ON report_sections(project_id, run_id, ord);

-- ---------- 12. 报告成品 ----------
CREATE TABLE IF NOT EXISTS reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id           TEXT NOT NULL,
  variant          TEXT NOT NULL,                      -- brief|standard|deep
  title            TEXT,
  subtitle         TEXT,
  md               TEXT NOT NULL,
  html             TEXT,
  word_count       INTEGER NOT NULL DEFAULT 0,
  stats_json       TEXT NOT NULL DEFAULT '{}',
  offline_notice   TEXT,
  knowledge_cutoff TEXT,
  quality_json     TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_var ON reports(project_id, run_id, variant);

-- ---------- 13. 分歧地图 ----------
CREATE TABLE IF NOT EXISTS disagreements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id              TEXT NOT NULL,
  sub_question_id     INTEGER REFERENCES sub_questions(id) ON DELETE SET NULL,
  fact_key            TEXT,
  topic               TEXT NOT NULL,
  positions_json      TEXT NOT NULL,
  root_cause          TEXT,
  severity            TEXT NOT NULL DEFAULT 'medium',  -- high|medium|low
  adjudication        TEXT,                            -- adjudicated|unresolved|partially
  adjudication_reason TEXT,
  verdict             TEXT,
  ord                 INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dis_project ON disagreements(project_id, ord);

-- ---------- 14. 知识库文档 ----------
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  source_type    TEXT NOT NULL,                        -- paste|url|file|report|manual
  origin_url     TEXT,
  file_path      TEXT,
  mime           TEXT,
  author         TEXT,
  published_at   TEXT,
  authority_tier TEXT NOT NULL DEFAULT 'C',
  tags_json      TEXT NOT NULL DEFAULT '[]',
  char_count     INTEGER NOT NULL DEFAULT 0,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'ready',        -- processing|ready|failed
  error          TEXT,
  project_id     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kd_created ON knowledge_documents(created_at DESC);

-- ---------- 15. 知识库分片 ----------
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id     TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  heading    TEXT,
  text       TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  fts_id     INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kc_doc ON knowledge_chunks(doc_id, ord);

-- trigram 分词器：中文短语检索必需（默认 unicode61 对中文整句当一个 token）
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
  heading,
  text,
  tokenize = 'trigram'
);

-- ---------- 16. 域名权威画像 ----------
CREATE TABLE IF NOT EXISTS domain_profiles (
  domain             TEXT PRIMARY KEY,
  tier               TEXT NOT NULL,                    -- A|B|C|D|U
  score              REAL NOT NULL DEFAULT 0.5,
  kind               TEXT NOT NULL DEFAULT 'other',    -- gov|stats|regulator|exchange|corporate|academic|media|industry|ugc|forum|wiki|international|marketing|blocked
  is_primary_default INTEGER,
  note               TEXT,
  source             TEXT NOT NULL DEFAULT 'builtin',  -- builtin|user
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dp_tier ON domain_profiles(tier);

-- ---------- 17. 抓取健康度（域名熔断） ----------
CREATE TABLE IF NOT EXISTS fetch_domain_stats (
  domain               TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_ok             INTEGER NOT NULL DEFAULT 0,
  total_fail           INTEGER NOT NULL DEFAULT 0,
  last_ok_at           TEXT,
  last_fail_at         TEXT,
  disabled_until       TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- 18. LLM 调用流水（成本归因） ----------
CREATE TABLE IF NOT EXISTS llm_calls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           TEXT,
  project_id       TEXT,
  stage_key        TEXT,
  provider         TEXT NOT NULL,                      -- cloud|openai-compat
  model            TEXT NOT NULL,
  purpose          TEXT,
  prompt_chars     INTEGER,
  prompt_tokens    INTEGER,
  completion_chars INTEGER,
  completion_tokens INTEGER,
  latency_ms       INTEGER,
  ok               INTEGER NOT NULL DEFAULT 1,
  error_code       TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_llmc_run     ON llm_calls(run_id, id);
CREATE INDEX IF NOT EXISTS idx_llmc_project ON llm_calls(project_id, id);

-- ---------- 19. 提示词模板（全部提示词公开、可增删改，不写死在代码里） ----------
-- template  = 当前生效模板（含 {{变量}} 占位符）
-- builtin   = 出厂默认文本（用于「恢复默认」）
-- variables = 可用变量说明 JSON: [{ name, desc, sample }]
CREATE TABLE IF NOT EXISTS prompt_templates (
  key         TEXT PRIMARY KEY,                      -- 唯一键，如 system.base / stage.section.user / tone.playful / schema.decompose
  name        TEXT NOT NULL,                         -- 中文名
  category    TEXT NOT NULL DEFAULT 'stage',         -- system | tone | stage | schema | policy | custom
  stage_key   TEXT,                                  -- 关联流水线阶段（可空）
  description TEXT,                                  -- 这段提示词是干什么的
  template    TEXT NOT NULL,                         -- 当前生效模板
  builtin     TEXT NOT NULL,                         -- 出厂默认
  variables   TEXT NOT NULL DEFAULT '[]',            -- 变量说明
  enabled     INTEGER NOT NULL DEFAULT 1,            -- 是否启用（停用则用出厂默认）
  is_builtin  INTEGER NOT NULL DEFAULT 1,            -- 1=内置(可改可重置，不可删)；0=用户自建
  ord         INTEGER NOT NULL DEFAULT 0,            -- 排序
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prompt_cat ON prompt_templates(category, ord);
