/**
 * 报告「风格 / 语气」档位。
 *
 * 现在风格文本也在数据库里（tone.professional / tone.casual / tone.playful，
 * 以及各自对应的 tone.*.note 短提示），可在「提示词管理」页面增删改。
 *
 * 设计原则不变：tone 只改变「怎么说」（措辞/语气/章节命名），
 * 永远不改变「证据纪律」（反幻觉、引用纪律、不确定性纪律在 system.base 里恒定生效）。
 */
import { effectiveTemplate } from './render.js'

/** 元信息（给前端做选择器用；实际文本以 DB 模板为准） */
export const TONES = {
  professional: { key: 'professional', label: '严肃', desc: '咨询机构风格：严谨论证、术语规范、书面化' },
  casual: { key: 'casual', label: '轻松', desc: '朋友闲聊风：大白话、少术语、可带一点轻松吐槽' },
  playful: { key: 'playful', label: '搞怪', desc: '小红书/朋友圈段子风：带梗、俏皮、可夸张，但绝不胡编' }
}

export const TONE_KEYS = Object.keys(TONES)

/** system 层用的风格说明（模板：tone.<key>） */
export function toneStyle(tone) {
  return effectiveTemplate(`tone.${tone || 'professional'}`) || effectiveTemplate('tone.professional') || ''
}

/** user 层短提示（模板：tone.<key>.note），可为空 */
export function toneNote(tone) {
  return effectiveTemplate(`tone.${tone || 'professional'}.note`) || ''
}
