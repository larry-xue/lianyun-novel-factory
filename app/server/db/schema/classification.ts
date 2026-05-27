import { z } from 'zod';

/** 主分类（单选） */
export const MAIN_CATEGORIES = [
  '西方奇幻',
  '东方仙侠',
  '科幻末世',
  '男频衍生',
  '都市高武',
  '悬疑灵异',
  '悬疑脑洞',
  '抗战谍战',
  '历史古代',
  '历史脑洞',
  '都市种田',
  '都市脑洞',
  '都市日常',
  '玄幻脑洞',
  '战神赘婿',
  '动漫衍生',
  '游戏体育',
  '传统玄幻',
  '都市修真',
] as const;

/** 主分类描述，喂给 agent 用 */
export const MAIN_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  西方奇幻: '偏西方世界背景下，包含魔法斗气奥术等奇幻元素的小说',
  东方仙侠: '偏东方世界背景下，包含修仙修道修真等仙侠元素的小说',
  科幻末世: '末世、丧尸、星际、机甲、未来科技等',
  男频衍生: '影视剧男频同人小说',
  都市高武: '都市架空,全民拥有修炼体系、灵气复苏等',
  悬疑灵异: '男频探案、悬疑、恐怖、风水奇术等',
  悬疑脑洞: '脑洞向的悬疑灵异、破案探险类，以及诡异复苏、惊悚游戏、规则怪谈等带有创意的悬疑新类型',
  抗战谍战: '抗战时期的军事战争和间谍情报的男频小说',
  历史古代: '以种田、朝堂、智谋、争霸、科举等为主要元素，行文严谨，兼顾历史真实与艺术创作规律的无金手指非系统历史文',
  历史脑洞: '脑洞向历史，一般有金手指',
  都市种田: '重生年代文、职场商战文、种田建设等都市文',
  都市脑洞: '拥有金手指系统的男频都市脑洞奇想',
  都市日常: '都市情感、现实生活等都市文',
  玄幻脑洞: '脑洞向玄幻',
  战神赘婿: '都市向战神，兵王文',
  动漫衍生: '游戏、动漫等偏二次元向的同人作品',
  游戏体育: '网游、竞技、体育及穿入游戏或世界游戏化',
  传统玄幻: '废柴逆袭，强者重生等传统玄幻，高武世界，异世大陆文',
  都市修真: '以修真为力量体系的都市文',
};

/** 主题（最多选两个） */
export const THEMES = [
  '衍生',
  '仕途',
  '综影视',
  '天灾',
  '第一人称',
  '赛博朋克',
  '第四天灾',
  '规则怪谈',
  '搞笑轻松',
  '古代',
  '悬疑',
  '克苏鲁',
  '都市异能',
  '末日求生',
  '灵气复苏',
  '高武世界',
  '异世大陆',
  '东方玄幻',
  '谍战',
  '清朝',
  '宋朝',
  '断层',
  '武将',
  '国运',
  '综漫',
  '开局',
  '架空',
  '奇幻仙侠',
  '都市',
  '玄幻',
  '历史',
  '体育',
  '武侠',
] as const;

/** 角色类型（最多选两个） */
export const CHARACTER_TYPES = [
  '多女主',
  '赘婿',
  '全能',
  '大佬',
  '大小姐',
  '特工',
  '游戏主播',
  '神探',
  '宫廷侯爵',
  '皇帝',
  '单女主',
  '校花',
  '无女主',
  '女帝',
  '特种兵',
  '反派',
  '神医',
  '奶爸',
  '学霸',
  '天才',
  '腹黑',
  '扮猪吃虎',
] as const;

/** 情节元素（最多选两个） */
export const PLOT_ELEMENTS = [
  '卡牌',
  '山海经',
  '捉鬼',
  '剑修',
  '废土',
  '副本',
  '黑科技',
  '无脑爽',
  '魂穿',
  '高手下山',
  '黑化',
  '迪化',
  '发家致富',
  '无后宫',
  '争霸',
  '1v1',
  '升级流',
  '灵魂互换',
  '科举',
  '封神',
  '四合院',
  '电竞',
  '双重生',
  '乡村',
  '同人',
  '打脸',
  '破案',
  '囤物资',
] as const;

export type MainCategory = (typeof MAIN_CATEGORIES)[number];
export type Theme = (typeof THEMES)[number];
export type CharacterType = (typeof CHARACTER_TYPES)[number];
export type PlotElement = (typeof PLOT_ELEMENTS)[number];

/** Zod schema：书籍分类（topic-scout 输出 / books 表存储共用）
 *  LLM 输出不完全可控，所以：
 *  - mainCategory 用 string + catch 兜底
 *  - 数组接受任意 string，transform 截断到 2 个
 */
export const BookClassificationSchema = z.object({
  mainCategory: z
    .string()
    .catch('')
    .transform((v) => (MAIN_CATEGORIES.includes(v as MainCategory) ? v : '')),
  themes: z
    .array(z.string())
    .catch([])
    .transform((v) => v.slice(0, 2)),
  characterTypes: z
    .array(z.string())
    .catch([])
    .transform((v) => v.slice(0, 2)),
  plotElements: z
    .array(z.string())
    .catch([])
    .transform((v) => v.slice(0, 2)),
});
export type BookClassification = z.infer<typeof BookClassificationSchema>;

/** 生成分类摘要文本，喂给 outline-architect 等 agent */
export function classificationContext(c: BookClassification): string {
  const parts = [`主分类：${c.mainCategory}（${MAIN_CATEGORY_DESCRIPTIONS[c.mainCategory] ?? ''}）`];
  if (c.themes.length) parts.push(`主题：${c.themes.join('、')}`);
  if (c.characterTypes.length) parts.push(`角色：${c.characterTypes.join('、')}`);
  if (c.plotElements.length) parts.push(`情节：${c.plotElements.join('、')}`);
  return parts.join('\n');
}
