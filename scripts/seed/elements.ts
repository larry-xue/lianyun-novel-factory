import { pathToFileURL } from 'node:url';
import { upsertElementBySlug } from '../../app/server/services/elements.ts';
import { MARKET_HOT_ELEMENTS_2026_05 } from './market-hot-elements.ts';

interface ElementSeed {
  slug: string;
  zh: string;
  category: string;
  hotScore: number;
  comboFriendly: string[];
  comboAvoid: string[];
  definitionMd: string;
}

const SEED: ElementSeed[] = [
  {
    slug: 'post-apocalypse',
    zh: '末世',
    category: '世界设定',
    hotScore: 0.82,
    comboFriendly: ['high-martial', 'system-flow', 'survival', 'hoarding', 'space-ability'],
    comboAvoid: ['slow-life'],
    definitionMd: `## 一句话定义
文明崩坏后求生 + 资源重建 + 秩序重塑。

## 核心爽点
- 信息差：重生预知/系统提示带来的先发优势
- 物资囤积、安全屋升级
- 队伍 hierarchy 建立 / 老婆/兄弟收编
- 失序中的强者主宰感

## 典型套路
- 丧尸/异变开篇 → 主角觉醒能力 → 收集物资 → 立基地 → 抢地盘
- 重生流：带未来记忆回到爆发前夜
- 末世 + 系统：日常签到/任务/抽奖系统

## 读者画像
男频为主，18-30，喜欢硬核求生 + 强者无敌。

## 避雷
- 圣母滥情、滥发物资
- 主角无脑送女角色光环
- 末世背景但日常依然像和平年代`,
  },
  {
    slug: 'slow-life',
    zh: '种田文',
    category: '基调',
    hotScore: 0.74,
    comboFriendly: ['cultivation', 'transmigration', 'cooking', 'lord-management'],
    comboAvoid: ['post-apocalypse', 'high-tension-war', 'hoarding'],
    definitionMd: `## 一句话定义
慢节奏的经营、积累、关系网构建，强调"日子越过越好"的复利感。

## 核心爽点
- 田园牧歌：种菜养殖、灶台烟火
- 一步一步把家变富
- 邻里互助、人情味
- 反派偶尔来踢馆 → 被淡淡解决

## 典型套路
- 穿越古代农家女/落魄秀才 → 用现代知识改良农具/食谱
- 异世界种田：带系统/空间/灵泉
- 修仙种田：在洞府里种灵田

## 读者画像
女频为主居多，男频也有"佛系老登"路线。25-45，工作压力大需要松弛感。

## 避雷
- 无矛盾导致剧情推不动
- 升级速度过慢导致疲软
- 主角圣母对反派太宽容`,
  },
  {
    slug: 'high-martial',
    zh: '高武',
    category: '世界设定',
    hotScore: 0.78,
    comboFriendly: ['post-apocalypse', 'urban', 'cultivation'],
    comboAvoid: [],
    definitionMd: `## 一句话定义
武力值至上的世界。气血/真气/武道境界递进，以肉身/兵器战斗为主，区别于"修仙"的法术体系。

## 核心爽点
- 越级挑战、一拳轰飞老资格
- 境界突破时的力量喷涌感
- 武学传承 / 秘籍开光时刻
- 国与国的武力较量、宗门战争

## 典型套路
- 都市高武：现代社会但底层武者横行，主角觉醒武者天赋
- 异世高武：大陆按武道境界划分阶级
- 系统高武：境界靠系统兑换/任务推进

## 读者画像
男频为主，纯爽文 + 暴力美学。

## 避雷
- 境界划分混乱、读者记不住
- 战斗描写堆砌特效但没有节奏感
- 反派智商时刻在线但毫无威胁`,
  },
  {
    slug: 'cultivation',
    zh: '修仙',
    category: '世界设定',
    hotScore: 0.86,
    comboFriendly: ['high-martial', 'slow-life', 'pill-alchemy', 'sect-ensemble'],
    comboAvoid: [],
    definitionMd: `## 一句话定义
凡人 → 长生的进阶之路。仙道伦理 + 福地洞天 + 金丹元婴/化神大乘的境界体系。区别于广义玄幻：修仙更强调灵根/血脉、功法、法宝、丹药/阵法/器修/剑修分工、宗门生态。

## 核心爽点
- 突破瓶颈时的天地异象
- 寻得仙缘/老爷爷/秘境的奇遇感
- 法宝/丹药/灵兽/阵盘/本命剑的收集
- 与天斗 / 长生求索 / 飞升真相的史诗感

## 典型套路
- 凡人流：低武凡人靠脑子和资源苟到大乘（《凡人修仙传》范式）
- 仙侠流：偏言情 + 仙门派系
- 洪荒/封神流：与神话人物挂钩
- 修仙种田：聚焦洞府经营、灵田耕作

## 2026 网文市场 主流四大子向（参考 5-08 风格图谱）
- 传统东方仙侠：剑、功法、秘境、门派、长期修炼
- 都市修真：高手下山 / 古武传承落入现代豪门、神医、鉴宝场景
- 宗门群像 / 团宠修仙：从"个人成神"改写为"组团建宗"
- 科玄混融：时间、文明、科技、历史废墟成为灵气和修炼机制的一部分（《光阴风月》一类）

## 读者画像
覆盖男女频，年龄 18-50 全覆盖；偏好长设定、慢节奏读者多。

## 避雷
- 设定前后矛盾、境界划分混乱
- 主角无脑屠杀宗门 → 因果报应链条乱
- 灵气复苏类滥用现代梗`,
  },
  {
    slug: 'system-flow',
    zh: '系统流',
    category: '金手指',
    hotScore: 0.91,
    comboFriendly: [
      'post-apocalypse',
      'rebirth',
      'transmigration',
      'urban',
      'cultivation',
      'quick-transit',
      'hoarding',
      'space-ability',
      'lord-management',
    ],
    comboAvoid: [],
    definitionMd: `## 一句话定义
主角脑内绑定一套量化系统：任务、签到、抽奖、商城、面板属性，把成长曲线游戏化。

## 核心爽点
- 每日签到 / 完成任务即时奖励，正反馈密集
- 抽奖出 SSR 时的惊喜感
- 属性面板可视化进度，强烈的"在变强"反馈
- 系统嘲讽/吐槽口癖带来轻松感

## 典型套路
- 签到流：每日定时签到，奖励从凡品到神器递进
- 任务流：系统派"打脸 X"、"NTR 反派"、"赚到 X 元"任务
- 商城流：积分换功法/物资，反向倒推赚取手段
- 抽奖流：转盘/盲盒/十连出货
- 反向流：废柴系统/坑爹系统逼主角自救

## 读者画像
男频核心读者群，14-30；高碎片化阅读，需要每章都有 reward tick。

## 避雷
- 系统设定臃肿，规则前后不一致
- 任务难度不递进，奖励通货膨胀
- 系统话太多、抢主角戏份`,
  },
  {
    slug: 'rebirth',
    zh: '重生',
    category: '主角设定',
    hotScore: 0.89,
    comboFriendly: [
      'post-apocalypse',
      'urban',
      'system-flow',
      'face-slap',
      'campus',
      'book-crossing',
      'hoarding',
      'female-emperor',
      'power-scheming',
    ],
    comboAvoid: ['slow-life'],
    definitionMd: `## 一句话定义
主角带着前世记忆/能力/积怨回到过去某个时间点，利用信息差走截然不同的人生。

## 核心爽点
- 预知未来：股市、彩票、灾难、剧情走向全部 cheat
- 复仇 / 报恩：把前世亏欠的人提前清算
- 提前布局：在风口起势之前进场，碾压同代人
- 与前世亲友的"重逢感"+"我可以救你"

## 典型套路
- 末世重生：回到爆发前 7 天囤货建队
- 商战重生：回到 1998 抢域名 / 2003 入互联网风口
- 校园重生：回到高三复读冲清华、追回前世错过的女主
- 修仙重生：金丹被夺重回练气，逆推上去屠门复仇

## 读者画像
通吃男女频，年龄跨度大；尤其打动 25-40 岁有"如果当年…"情绪的群体。

## 避雷
- 前世细节用一次就忘，金手指变薛定谔
- 复仇路线一帆风顺，缺乏阻力
- 主角靠预知傲慢，没有人物成长`,
  },
  {
    slug: 'transmigration',
    zh: '穿越',
    category: '主角设定',
    hotScore: 0.85,
    comboFriendly: ['slow-life', 'cultivation', 'system-flow', 'ancient-court', 'book-crossing', 'female-emperor', 'sect-ensemble', 'power-scheming'],
    comboAvoid: [],
    definitionMd: `## 一句话定义
现代人意识/身体被传送到另一个时空（古代/异世/小说世界），用现代知识降维打击。

## 核心爽点
- 现代知识/工艺降维打击：肥皂、火药、蒸馏、流水线
- 文化错位的反差萌：用现代梗冲击古代环境
- 身份反转：从社畜变成王爷/将军/修仙者
- 异世界探索的猎奇感

## 典型套路
- 穿成农女 → 种田 + 致富 + 良缘
- 穿成炮灰 → 反套路改写命运
- 穿到小说世界 → 当作者读者一样吐槽推剧情
- 反穿越：古人到现代 → 文化冲突喜剧

## 读者画像
男女频通吃；女频偏穿成主角/炮灰，男频偏穿成历史人物或异世枭雄。

## 避雷
- 现代知识开挂过头，破坏世界观
- 主角金手指来源含糊
- 古代人物动辄"哇"、"awesome"，违和`,
  },
  {
    slug: 'urban',
    zh: '都市',
    category: '世界设定',
    hotScore: 0.88,
    comboFriendly: [
      'rebirth',
      'system-flow',
      'face-slap',
      'high-martial',
      'tycoon',
    ],
    comboAvoid: [],
    definitionMd: `## 一句话定义
以现代都市为舞台，融入隐世武者/异能/财阀/明星圈等"都市奇谭"元素。

## 核心爽点
- 装逼打脸：被低估的扫地僧 / 落魄女婿一夜翻身
- 财阀豪门冲突：少爷夺嫡、家族联姻
- 都市异能：警局、特殊部门、隐世家族
- 商战 / 娱乐圈 / 直播间的现代场景

## 典型套路
- 都市赘婿 / 上门女婿翻身
- 神医回归都市 → 美女老板娘抢着请
- 学神回校 / 重生学霸 / 神豪签到
- 明星老婆 / 直播 + 系统签到

## 读者画像
男频主战场；30 岁以上较多，下班通勤碎片读。

## 避雷
- "我家很穷但我爸是隐藏首富"模板被读者审美疲劳
- 装逼桥段连发但没有真正威胁
- 反派智商时高时低`,
  },
  {
    slug: 'face-slap',
    zh: '打脸装逼',
    category: '桥段',
    hotScore: 0.93,
    comboFriendly: ['urban', 'rebirth', 'system-flow', 'tycoon', 'book-crossing', 'female-emperor', 'quick-transit'],
    comboAvoid: ['slow-life'],
    definitionMd: `## 一句话定义
反派/路人轻视主角 → 主角瞬间亮身份/亮实力 → 反派当众破防的桥段套路。

## 核心爽点
- 信息差揭穿瞬间的快感
- 反派从傲慢到惊恐的表情转变
- 围观群众的"卧槽 + 议论 + 起哄"反应
- 一连串反派被点名拉清单

## 典型套路
- 同学聚会装穷 → 被嘲讽 → 司机/秘书/兄弟来接 → 全场跪
- 相亲被否定 → 对方求婚未来岳父 → 拒绝
- 业务谈判被甲方羞辱 → 主角原来是真甲方
- 黑客被抓现行 → 反手扒出对方公司全部黑料

## 读者画像
碎片化阅读爽文核心读者，14-35；下班/通勤/睡前刷 5 章解压。

## 避雷
- 单章内塞太多打脸，反而麻木
- 反派降智为打脸而打脸，破坏现实感
- 主角全程嘲讽脸，缺乏成长弧`,
  },
  {
    slug: 'tycoon',
    zh: '神豪',
    category: '金手指',
    hotScore: 0.84,
    comboFriendly: ['urban', 'system-flow', 'face-slap', 'live-stream'],
    comboAvoid: ['slow-life', 'cultivation'],
    definitionMd: `## 一句话定义
绑定一套"花钱越多奖励越多/反向破产系统"的现代金手指，让主角无脑挥霍致富。

## 核心爽点
- 反向破产：花钱有奖励，越花越富
- 一掷千金的霸道感、围观群众瞠目结舌
- 收购知名公司、买下整条街的爽
- 慈善豪掷 / 包养 / 投资名场面

## 典型套路
- 花钱系统：每花 1 元返 10
- 限时破产任务：30 天花光 1 亿才能获得真正资产
- 神豪 + 直播：弹幕看主角挥金如土起哄
- 神豪 + 都市：面对豪门家族碾压式反杀

## 读者画像
男频快餐爽文核心；下沉市场偏多，年龄 16-35。

## 避雷
- 数字单位飘忽，读者算不清
- 缺乏挥霍后果，纯无脑爽
- 反派除了"嘲笑主角穷"没别的特点`,
  },
  {
    slug: 'infinite-flow',
    zh: '无限流',
    category: '世界设定',
    hotScore: 0.71,
    comboFriendly: ['system-flow', 'horror', 'rebirth', 'rule-horror', 'instance-flow', 'suspense-brainhole'],
    comboAvoid: ['slow-life'],
    definitionMd: `## 一句话定义
用一个个彼此相连的异世界/副本/关卡构成长期连载结构。核心魅力 =【关卡变化 + 主线大谜团】。区别于 instance-flow 偏"主题副本"，无限流更偏"循环 + 主神/血门/排位 + 终局反转"。

## 核心爽点
- 副本切换的新鲜感：恐怖片、武侠、科幻轮转
- 队伍博弈：信任、背叛、最后一刻反转
- 死亡威胁下的心理压力 + 智斗
- 主神/血门/规则世界的终局揭幕

## 典型套路
- 主神空间：主神发任务，得积分换技能
- 恐怖副本：解谜+苟活+找规则
- 末日轮回：每天循环一个固定 24 小时
- 万界穿越：穿到知名 IP 内当配角/主角
- 排位游戏 / 血门 / 诸神愚戏类总规则

## 读者画像
偏中高龄阅读群体（25+），耐心好、爱推理；女频也有大盘。

## 避雷
- 副本世界观薄弱，沦为打怪刷副本
- 队友刻画扁平，工具人化
- 主神规则前后不一致`,
  },
  {
    slug: 'live-stream',
    zh: '直播流',
    category: '桥段',
    hotScore: 0.77,
    comboFriendly: ['urban', 'tycoon', 'system-flow', 'survival'],
    comboAvoid: [],
    definitionMd: `## 一句话定义
主角行动通过直播间被海量观众围观，弹幕反应是核心爆点之一。

## 核心爽点
- 弹幕集体震惊 / 起哄 / 刷火箭的氛围感
- 直播间打赏带来的实质奖励或社会曝光
- 真伪辨认：观众从质疑到信服的转折
- 与平台/对家主播的明争暗斗

## 典型套路
- 户外野生直播：荒野求生 + 系统/超能力
- 探险直播：盗墓、深海、外星
- 日常直播：神豪挥霍、神医坐诊、装修翻车
- 修仙直播：现代人开了个仙气直播间

## 读者画像
2020 年后崛起的赛道，年轻读者偏多；与短视频文化重合度高。

## 避雷
- 弹幕全程一个口吻，缺少 character
- 主播经济学不通，收入数字荒诞
- 直播事故缺乏代价`,
  },
  {
    slug: 'campus',
    zh: '校园',
    category: '世界设定',
    hotScore: 0.69,
    comboFriendly: ['rebirth', 'system-flow', 'first-love', 'sports'],
    comboAvoid: ['post-apocalypse'],
    definitionMd: `## 一句话定义
高中/大学为舞台，强调青春记忆 + 学业竞争 + 校园恋爱的复合体验。

## 核心爽点
- 学神学霸的降维打击 / 全校惊艳
- 暗恋 → 表白 → 试探 → 在一起的甜蜜递进
- 班级/年级/校际竞赛的对抗感
- 天台、操场、毕业季的青春仪式感

## 典型套路
- 重生学霸：回到高中改命 + 暗恋逆袭
- 系统校园：每日做题/背单词得奖励
- 校园 + 异能：少年觉醒能力暗中保护同学
- 体育校园：篮球/足球/电竞校队冲冠

## 读者画像
女频偏多，14-25；男频也有甜宠 + 学神向。

## 避雷
- 角色全部使用现代成年人腔调
- 学习场景悬浮，知识点经不起推敲
- 反派老师/校霸过于扁平`,
  },
  {
    slug: 'invincible',
    zh: '无敌流',
    category: '主角设定',
    hotScore: 0.8,
    comboFriendly: ['high-martial', 'cultivation', 'urban', 'face-slap'],
    comboAvoid: ['slow-life', 'sect-ensemble'],
    definitionMd: `## 一句话定义
主角实力远超同代人甚至前代，一出手即终结战斗，看点不在能不能赢，而在赢得多飘逸。

## 核心爽点
- "一拳"美学：反派狂妄铺垫到尽头，主角一招收割
- 旁观者视角：通过 NPC 震惊烘托主角恐怖
- 隐藏身份：低调出场 → 暴露身份后全场跪
- 越级杀：跨大境界乱杀

## 典型套路
- 大佬装萌新进新手村
- 隐世宗主下山 / 老登归来
- 反派联盟围攻 → 主角一人镇压
- 系统加持：每日变强，越打越强

## 读者画像
男频快餐核心读者，碎片化阅读时段需要"大爽快"。

## 避雷
- 全程无敌缺乏紧张感，读者疲劳
- 反派降智被反复使用
- 没有真正的对手 / 没有外部世界对照系`,
  },
  {
    slug: 'imperial-exam',
    zh: '科举',
    category: '世界设定',
    hotScore: 0.62,
    comboFriendly: [
      'slow-life',
      'transmigration',
      'ming-qing-officialdom',
      'farmer-son-rise',
      'sun-shan-underdog',
      'no-cheat',
      'diligence-luck',
    ],
    comboAvoid: ['system-flow', 'tycoon', 'invincible'],
    definitionMd: `## 一句话定义
童生 → 秀才 → 举人 → 进士 → 同进士的层层考选；以"读书改命"为主线驱动。

## 核心爽点
- 院试/乡试/会试/殿试逐级闯关，每过一关身份阶层跃迁
- 案首/解元/会元/状元的名次焦虑与放榜瞬间
- 八股文、策论、试帖诗等题型现场写作的智斗感
- 寒门 vs 世家、清流 vs 浊流的圈层对抗

## 典型套路
- 寒门子弟苦读 → 一路过关 → 殿试逆袭
- 穿越者背诵后世名篇 / 用现代逻辑写策论
- 主考官识珠 → 收为门生 → 引入官场人脉网
- 科场舞弊案 → 主角洗冤或借势上位

## 读者画像
偏中高龄男频，25-45；喜欢制度细节、考据党重叠度高。

## 避雷
- 八股流于装饰，看不到主角真本事
- 考试规则前后矛盾（如把明代制度套到唐代）
- "背一首唐诗就成名"过于偷懒`,
  },
  {
    slug: 'ming-qing-officialdom',
    zh: '明清官场',
    category: '世界设定',
    hotScore: 0.58,
    comboFriendly: [
      'imperial-exam',
      'official-promotion',
      'farmer-son-rise',
      'pragmatic-technocrat',
      'transmigration',
    ],
    comboAvoid: ['system-flow', 'post-apocalypse', 'invincible'],
    definitionMd: `## 一句话定义
以明清两代为蓝本的官僚体系：九品十八级、京官 vs 外官、清贵 vs 浊流、内阁/六部/督抚。

## 核心爽点
- 县令 → 知府 → 道台 → 督抚 → 阁老的逐级升迁路径
- 党争、清流浊流、夺嫡、京察大计的政治博弈
- 折子（奏折）斗法 / 廷议唇枪舌剑
- 基层政事：钱粮、刑名、漕运、河工、赈灾

## 典型套路
- 外放县令实干立功 → 调京 → 入翰林 → 拜相
- 御史言官借小案撬大局
- 钦差出巡查盐/查案 / 雷霆手段
- 帝党 vs 后党 / 太子党之争

## 读者画像
喜欢历史 + 制度向的中年男频读者；与官场文/历史文受众重合。

## 避雷
- 官职乱用（把唐宋官名混进明清）
- 升迁速度违背常识（年方二十就督抚一方）
- 政治描写沦为口号，没有实际利害`,
  },
  {
    slug: 'no-cheat',
    zh: '凡人流',
    category: '基调',
    hotScore: 0.45,
    comboFriendly: [
      'slow-life',
      'imperial-exam',
      'diligence-luck',
      'romance-subplot',
      'farmer-son-rise',
    ],
    comboAvoid: ['system-flow', 'tycoon', 'invincible', 'rebirth'],
    definitionMd: `## 一句话定义
主角无系统、无空间、无外挂；一切优势靠自身努力 + 时代机遇 + 小概率运气累积。

## 核心爽点
- 复利感：每一步都不可逆地变强 / 变富 / 变体面
- 真实感：失败、试错、攒钱、求人，与读者生活共鸣
- 长线伏笔：早期不起眼的一次选择 → 后期撬动大局
- "我也可以"的代入感，区别于神豪/重生的悬浮

## 典型套路
- 寒门科举：苦读 + 名师 + 同窗人脉
- 穿越实干：用现代知识 + 古代规则博弈
- 现代逆袭：从底层岗位一步步攒资源、攒名声
- 修仙凡人流：无灵根/废灵根，用毅力补天赋

## 读者画像
偏理性向、年龄稍大（28+）；不爱看无脑爽文，喜欢"看人物真的成长"。

## 避雷
- 节奏太慢导致前 30 章流失读者
- "无金手指"沦为口号，实际上靠剧情主角光环开外挂
- 主角窝囊到读者代入失败`,
  },
  {
    slug: 'romance-subplot',
    zh: '爱情副线',
    category: '基调',
    hotScore: 0.5,
    comboFriendly: [
      'imperial-exam',
      'slow-life',
      'no-cheat',
      'official-promotion',
      'childhood-sweetheart',
    ],
    comboAvoid: ['campus', 'face-slap'],
    definitionMd: `## 一句话定义
有 CP、男主/女主专一，但感情线非主线；爱情作为人物锚点存在，不抢事业/成长戏份。

## 核心爽点
- 默默支持型 CP：女主在主角低谷期不离不弃
- 重要节点的相互成就：主角中举 / 升官 / 立功后回家见 TA 那一刻
- 一对一的纯粹感，没有后宫纷争消耗精力
- 长线感情积累的厚重感，区别于校园甜宠的密集发糖

## 典型套路
- 青梅竹马：从小一起长大，自然而然在一起
- 患难夫妻：主角寒门时下嫁，后来共同富贵
- 红颜知己：互相欣赏却各有志业，长线发酵
- 政治联姻 → 真情实感

## 读者画像
不排斥感情戏但讨厌恋爱脑的男频读者，年龄偏大；女频中也有"事业线先行"派系。

## 避雷
- 女主出场频率过低导致 CP 感断裂
- 后期突然加塞多女主，背离专一承诺
- 感情戏全部跳过，CP 沦为剧情工具`,
  },
  {
    slug: 'farmer-son-rise',
    zh: '农家子逆袭',
    category: '主角设定',
    hotScore: 0.55,
    comboFriendly: [
      'imperial-exam',
      'slow-life',
      'transmigration',
      'womb-transmigration',
      'sun-shan-underdog',
      'official-promotion',
    ],
    comboAvoid: ['tycoon', 'urban'],
    definitionMd: `## 一句话定义
主角出身古代农家/寒门，靠读书或手艺一路打破阶层壁垒，最终位列朝堂或富甲一方。

## 核心爽点
- 阶层跃迁的厚重感：从泥腿子 → 秀才 → 举人 → 朝堂
- 衣锦还乡 / 提携族人 / 修宗祠的家族荣耀
- 与世家子弟的对照：寒门贵子的尊严感
- 田间地头到金銮殿的视野扩张

## 典型套路
- 胎穿农家 → 启蒙 → 进学 → 中举 → 入朝
- 寒门 + 名师收徒 → 学问突飞猛进
- 帮家族脱贫 → 兴修水利/办族学 → 反哺乡里
- 与同乡/同窗结成长期人脉网

## 读者画像
偏中年男频；喜欢"出身决定起点而非天花板"的现实感叙事。

## 避雷
- 家人扁平化为讨好型工具
- 农村细节悬浮（不知道古代怎么种地交税）
- 升迁后忘本，丢失早期质感`,
  },
  {
    slug: 'diligence-luck',
    zh: '勤奋运气流',
    category: '主角设定',
    hotScore: 0.42,
    comboFriendly: [
      'imperial-exam',
      'no-cheat',
      'farmer-son-rise',
      'sun-shan-underdog',
      'slow-life',
    ],
    comboAvoid: ['rebirth', 'system-flow', 'invincible'],
    definitionMd: `## 一句话定义
主角无前世记忆、无系统外挂；优势来自吃苦 + 偶尔的小概率好运（搭尾榜、遇贵人、押对题）。

## 核心爽点
- 三更灯火五更鸡的努力质感
- 关键时刻的运气加持：押中题、撞上贵人、临场发挥
- 努力 + 运气滚雪球，单步收益小但长期复利明显
- 区别于"天赋碾压"，更像普通人的奋斗叙事

## 典型套路
- 苦读三年 → 院试侥幸过线 → 名师赏识 → 加速进步
- 临考前借到关键卷子 / 偶遇前辈点拨
- 多次落榜后绝处逢生 → 同进士尾榜上岸
- 入仕后靠扎实政绩 + 一次抓住机会的爆点

## 读者画像
对"运气"叙事不反感的现实派读者；与无金手指流大量重叠。

## 避雷
- 运气过于集中变成另一种金手指
- 努力描写流于"他熬夜了三年"的总结句
- 失败戏不够，导致后期成功廉价`,
  },
  {
    slug: 'pragmatic-technocrat',
    zh: '实干技术派',
    category: '主角设定',
    hotScore: 0.48,
    comboFriendly: [
      'imperial-exam',
      'ming-qing-officialdom',
      'transmigration',
      'farmer-son-rise',
      'official-promotion',
    ],
    comboAvoid: ['face-slap', 'invincible'],
    definitionMd: `## 一句话定义
主角不擅宫斗谋略，强在落地执行：兴水利、改农具、整漕运、办实业；用看得见的政绩立身。

## 核心爽点
- 用现代知识 + 古代资源解决具体问题（堤坝、瘟疫、灾荒）
- 数据/账目说话，把虚浮的政治化成实在的产出
- 被低估 → 政绩亮眼 → 同僚态度反转
- 治理一方 → 民生肉眼可见地变好

## 典型套路
- 县令任上修水利 / 改良作物 / 整顿胥吏
- 主持赈灾用记账法 + 物流调度避免贪墨
- 工部 / 户部任上推数据化管理
- 出使外邦 → 谈判桌上靠数字而非辞令

## 读者画像
理工科背景男频读者；喜欢"以工代笔"的硬核细节党。

## 避雷
- 现代知识 dump 太密，丧失古代质感
- 制度细节经不起推敲（赋税、漕运全凭脑补）
- 同僚一律降智来反衬主角能干`,
  },
  {
    slug: 'womb-transmigration',
    zh: '胎穿',
    category: '桥段',
    hotScore: 0.6,
    comboFriendly: [
      'transmigration',
      'slow-life',
      'farmer-son-rise',
      'imperial-exam',
    ],
    comboAvoid: ['rebirth', 'post-apocalypse'],
    definitionMd: `## 一句话定义
现代灵魂穿越到婴儿（甚至胎儿）身上，从零重新长大；与"成年穿越"相比多出童年成长线。

## 核心爽点
- 婴幼儿期 OOC 反差萌（用大人脑子吐槽奶妈/亲戚）
- 从牙牙学语到启蒙读书的复利成长
- 早慧人设带来的"村中神童"光环 + 收徒/拜师机会
- 与现世亲缘从零建立的厚重情感

## 典型套路
- 胎穿农家 → 早慧 → 启蒙 → 科举
- 胎穿世家 → 利用家族资源弯道超车
- 胎穿修真世界 → 从小积累灵根/功法
- 胎穿 + 系统 / 空间（属于杂交款）

## 读者画像
喜欢长线代入和"看主角真的从小长大"的耐心向读者。

## 避雷
- 婴幼儿期戏份过长导致主线推不动
- 早慧到不合理（三岁出口成章）
- 父母兄弟等亲缘戏份单薄`,
  },
  {
    slug: 'childhood-sweetheart',
    zh: '青梅竹马',
    category: '桥段',
    hotScore: 0.55,
    comboFriendly: [
      'campus',
      'slow-life',
      'romance-subplot',
      'imperial-exam',
      'farmer-son-rise',
    ],
    comboAvoid: ['face-slap', 'tycoon'],
    definitionMd: `## 一句话定义
男女主从小一同长大，感情天然存在，无需追求戏；常作为情感锚点贯穿全文。

## 核心爽点
- 一起长大的回忆杀（同窗、邻居、玩伴）
- 默默守候、共同期盼"等你出息"
- 关键节点的双向奔赴：中举/封官那一刻回乡定亲
- 区别于"一见钟情"，主打长线积累的安稳

## 典型套路
- 同村青梅 → 主角进学/赶考/做官 → 衣锦还乡迎娶
- 青梅另嫁的虐恋（少见，慎用）
- 青梅作为家族联姻的天然解
- 青梅默默学医/经商 → 后期成为主角的得力臂助

## 读者画像
偏好长线 CP、不喜欢多女主拉扯的男女读者皆有。

## 避雷
- 出场频率太低导致存在感稀薄
- 青梅人设单薄，沦为奖励道具
- 中后期突然加塞新女主把青梅挤掉`,
  },
  {
    slug: 'sun-shan-underdog',
    zh: '孙山逆袭',
    category: '桥段',
    hotScore: 0.4,
    comboFriendly: [
      'imperial-exam',
      'farmer-son-rise',
      'diligence-luck',
      'official-promotion',
      'no-cheat',
    ],
    comboAvoid: ['invincible', 'system-flow'],
    definitionMd: `## 一句话定义
"名落孙山"的"孙山"——尾榜上岸（同进士、末等举人、最后一名）→ 在所有人轻视下逆风翻盘。

## 核心爽点
- 放榜瞬间的惊险反转：差一名落榜 vs 险险上岸
- "同进士如夫人"的尴尬出身被同侪嘲笑 → 后来居上打脸
- 起点垫底 → 政绩 / 人脉 / 时机一项一项补回来
- 殿试/选官时的差额操作博弈

## 典型套路
- 殿试三甲末位 → 外放偏远县令 → 政绩亮眼
- 同年宴上被状元/榜眼忽视 → 多年后成为对方上司
- 起步差但选对赛道（如外放实任 vs 京中清贵）
- 最后一名却最先突破（贵人提携 / 时局送上风口）

## 读者画像
喜欢"垫底翻身"叙事的男频读者；与寒门 / 凡人流大量重叠。

## 避雷
- 翻身节奏太快显得开金手指
- 反派同僚降智，缺乏真正的竞争压力
- "尾榜出身"梗只在前期用，后面完全忘记`,
  },
  {
    slug: 'official-promotion',
    zh: '升官流',
    category: '桥段',
    hotScore: 0.65,
    comboFriendly: [
      'imperial-exam',
      'ming-qing-officialdom',
      'farmer-son-rise',
      'pragmatic-technocrat',
      'sun-shan-underdog',
    ],
    comboAvoid: ['slow-life', 'post-apocalypse'],
    definitionMd: `## 一句话定义
以官阶递进为主轴的剧情节奏：每隔一段写出一次升迁/调任/破格提拔的爆点。

## 核心爽点
- 县令 → 知府 → 巡抚 → 尚书 → 阁老的阶梯式爽点
- 京察大计、考成法、廷推等制度节点的爆发
- 破格提拔（连升三级 / 越级擢用）的稀缺感
- 任所变迁带来的场景刷新（边镇、漕运、河工、京畿）

## 典型套路
- 政绩积累 → 上官保举 → 调任更高一级
- 救驾 / 平叛 / 治灾立大功 → 破格提拔
- 京察被刁难 → 反向洗清 → 反超对手
- 党争中站队成功 → 跟随大势升官

## 读者画像
偏官场文/历史文受众；35+ 男性为主，节奏耐心好。

## 避雷
- 升迁速度违背常识，年纪与官职不匹配
- 每一次升官都靠救驾，模板单一
- 升官只写头衔变化，没有职责差异`,
  },
  // ── 2026-05 市场热门榜补充 ──────────────────────────────
  {
    slug: 'book-crossing',
    zh: '穿书',
    category: '主角设定',
    hotScore: 0.92,
    comboFriendly: ['transmigration', 'system-flow', 'face-slap', 'cultivation'],
    comboAvoid: ['no-cheat'],
    definitionMd: `## 一句话定义
主角意识穿入已知小说/话本世界，成为书中炮灰/配角/反派，利用"剧情预知"改写命运。

## 核心爽点
- 原书剧情就是最大的金手指：知道谁是反派、谁会背叛、哪里有宝物
- 反套路操作：原书主角/女主的计划全部落空
- "我看过这本书"的读者代入感极强
- 穿成炮灰逆袭成主角的身份翻转

## 典型套路
- 穿成恶毒女配 → 洗白自救 → 原女主反成反派
- 穿成反派娘亲 → 救赎黑化反派崽
- 穿成工具人二师姐 → 摆烂不干了 → 宗门反而起飞
- 穿成炮灰妻子 → 提前离婚 → 前夫追妻火葬场

## 读者画像
女频主力赛道，18-35 岁；男频也有"穿成反派/配角"变体。与短剧改编高度重合。

## 避雷
- 原书设定交代太长，读者跳章
- "我知道剧情"用完就忘，后期变成普通穿越
- 原书主角/反派降智为衬托穿书者`,
  },
  {
    slug: 'quick-transit',
    zh: '快穿',
    category: '世界设定',
    hotScore: 0.78,
    comboFriendly: ['system-flow', 'book-crossing', 'face-slap', 'romance-subplot'],
    comboAvoid: ['slow-life', 'no-cheat'],
    definitionMd: `## 一句话定义
主角绑定系统后在多个小世界/位面间快速穿梭，每个世界一个独立任务，完成后进入下一个。

## 核心爽点
- 每个世界都是全新背景（古代/末世/星际/民国），新鲜感密集
- 任务驱动的正反馈循环：完成 → 奖励 → 下一世界
- 不同世界的身份反差：这世是皇后，下世是末世求生者
- 收集碎片/积分/好感度的长线目标

## 典型套路
- 逆袭系统：穿越各世界帮炮灰逆袭人生
- 攻略系统：穿越各世界让反派/男主爱上自己
- 救赎系统：穿越各世界拯救即将黑化的角色
- 每个世界末尾有"原主回忆杀"催泪点

## 读者画像
女频核心赛道，16-30 岁；碎片化阅读友好，每个世界 30-100 章可独立完结。

## 避雷
- 世界之间缺乏关联，读完像看了 N 个短篇
- 男主在各世界是同一个人但性格割裂
- 任务目标过于简单，缺乏真正的困难`,
  },
  {
    slug: 'female-emperor',
    zh: '女帝',
    category: '主角设定',
    hotScore: 0.75,
    comboFriendly: ['transmigration', 'power-scheming', 'face-slap', 'rebirth'],
    comboAvoid: ['slow-life', 'campus'],
    definitionMd: `## 一句话定义
女主从乱世/宫廷/废墟中崛起，夺取政权、开疆拓土，最终称帝或掌控天下。

## 核心爽点
- 女性掌权的力量感：从被支配者变成支配者
- 乱世争霸的史诗格局：练兵、攻城、外交、权谋
- 群像塑造：麾下文臣武将各有性格
- "她比所有男人都强"的碾压快感

## 典型套路
- 穿越乱世 → 被送蛮族 → 反杀 → 练兵 → 争霸 → 称帝
- 重生复仇 → 夺回本该属于自己的皇位
- 穿成废妃 → 从冷宫崛起 → 一步步掌控朝堂
- 系统辅助 → 完成治国任务 → 国力碾压邻国

## 读者画像
女频 25-40 岁，喜欢大女主 + 权谋 + 群像；与男频争霸文受众有交叉。

## 避雷
- 女主全靠男性角色帮忙，"女帝"名不副实
- 争霸过程太顺利，缺乏真正的政治博弈
- 感情线喧宾夺主，称帝变成背景板`,
  },
  {
    slug: 'sect-ensemble',
    zh: '宗门群像',
    category: '桥段',
    hotScore: 0.88,
    comboFriendly: ['cultivation', 'book-crossing', 'transmigration', 'face-slap'],
    comboAvoid: ['invincible', 'no-cheat'],
    definitionMd: `## 一句话定义
以一个修仙宗门为核心舞台，女主/主角与 N 个性格各异的师兄/师姐/师弟组成群像，共同成长。

## 核心爽点
- 每个宗门成员都有独立故事线和心理创伤，被主角一一治愈
- 宗门日常的鸡飞狗跳：沙雕互动、互怼、护短
- 反差萌：表面大魔头实际给师妹买糖、社恐师姐抡琵琶砸敌
- 集体战斗时的团魂爆发

## 典型套路
- 穿书女主 → 加入没落宗门 → 逐个改造问题师兄 → 宗门崛起
- 摆烂师姐 → 不想努力 → 但宗门因她起飞
- 反派宗门 → 新来的弟子用"正常人"视角整顿宗门
- 重生回宗门 → 提前阻止师兄们的悲剧命运

## 读者画像
女频仙侠核心赛道，18-30 岁；群像塑造是关键卖点，影视改编热门方向。

## 避雷
- 师兄人设同质化（全是冷面+护短）
- 群像太多导致每个角色都浅尝辄止
- 宗门日常占比过大，主线推进缓慢`,
  },
  {
    slug: 'lord-management',
    zh: '领主经营',
    category: '世界设定',
    hotScore: 0.72,
    comboFriendly: ['system-flow', 'transmigration', 'slow-life', 'post-apocalypse'],
    comboAvoid: ['urban', 'campus'],
    definitionMd: `## 一句话定义
主角获得一片领地（荒野/异世界/末世基地），从零开始经营建设，招募人才，壮大势力。

## 核心爽点
- 从荒芜到繁荣的建设成就感
- 领地数据可视化：人口、资源、军事、科技树
- 招募人才/英雄的收集感
- 领地战争：防御入侵 → 主动扩张 → 称霸大陆

## 典型套路
- 勇者队伍散伙 → 转职领主 → 搞基建攒资源
- 穿越异世界 → 获得贫瘠封地 → 用现代知识改造
- 末世求生 → 建立安全区 → 从避难所发展成城市
- 系统领主：每日任务升级建筑/解锁科技

## 读者画像
男频为主，20-35 岁；喜欢策略/经营/建设类游戏的读者高度重合。

## 避雷
- 经营过程流水账，缺乏冲突
- 科技树跳跃太大（石器时代直接造火药）
- 领民/下属工具人化，没有人格`,
  },
  {
    slug: 'hoarding',
    zh: '囤货流',
    category: '桥段',
    hotScore: 0.83,
    comboFriendly: ['post-apocalypse', 'rebirth', 'system-flow', 'space-ability'],
    comboAvoid: ['slow-life', 'cultivation'],
    definitionMd: `## 一句话定义
末世/灾变来临前，主角利用重生预知或系统提示大量囤积物资（食物、药品、武器、燃料），在灾后成为资源霸主。

## 核心爽点
- 疯狂购物的爽感：超市扫货、批发市场清仓、网购下单
- 末世降临时的从容对比众人的慌乱
- 物资就是权力：用食物换劳动力、用药品换忠诚
- 安全屋/基地不断升级的空间满足感

## 典型套路
- 重生回末世前 7 天 → 疯狂囤货 → 末世降临 → 别人求上门
- 空间异能 → 装下整个超市 → 末世中开超市
- 系统签到 → 每日获得物资 → 积少成多
- 冰河/酷暑末世 → 囤燃料/冰块 → 成为唯一的避难所

## 读者画像
男频末世赛道核心读者，18-35；与生存类游戏/短视频囤货内容受众重合。

## 避雷
- 囤货清单过于详细变成购物清单流水账
- 物资用之不竭缺乏紧张感
- 囤货后没有使用场景，纯粹炫耀`,
  },
  {
    slug: 'power-scheming',
    zh: '权谋',
    category: '桥段',
    hotScore: 0.76,
    comboFriendly: ['female-emperor', 'transmigration', 'rebirth', 'ancient-court'],
    comboAvoid: ['face-slap', 'invincible'],
    definitionMd: `## 一句话定义
以政治博弈、派系斗争、阴谋布局为核心驱动力；主角靠智商和人脉网在权力场中步步为营。

## 核心爽点
- 棋局感：每一步布局都有后手，读者猜不到下一步
- 谈判/廷议/朝堂对峙的唇枪舌剑
- 盟友与敌人的不断转换：今天的盟友明天背刺
- 最终翻盘时回看全局的"原来如此"感

## 典型套路
- 宫斗权谋：后宫嫔妃之间的明争暗斗
- 朝堂权谋：清流 vs 浊流、帝党 vs 后党
- 家族权谋：世家大族内部的嫡庶之争
- 乱世权谋：诸侯争霸中的合纵连横

## 读者画像
偏中高龄读者（25+），男女频均有；喜欢智斗而非武斗，对逻辑性要求高。

## 避雷
- 计划过于复杂导致读者看不懂
- 配角全部沦为棋子，没有人格
- 权谋流于"密信/暗杀"的套路，缺乏制度博弈`,
  },
  {
    slug: 'space-ability',
    zh: '空间异能',
    category: '金手指',
    hotScore: 0.8,
    comboFriendly: ['post-apocalypse', 'hoarding', 'rebirth', 'system-flow'],
    comboAvoid: ['slow-life', 'imperial-exam'],
    definitionMd: `## 一句话定义
主角觉醒次元空间/随身空间/储物空间，可存放大量物资、种植养殖、甚至居住；末世/修仙赛道的万能金手指。

## 核心爽点
- 无限容量的囤货快感：超市、仓库、军火库全部装进空间
- 空间内种田/养殖的自给自足感
- 危机时刻"从空间掏出武器/物资"的反杀
- 空间升级：从 10 平米 → 100 亩 → 独立小世界

## 典型套路
- 末世觉醒空间 → 囤货 → 空间内建基地
- 修仙获得芥子空间 → 灵田 + 灵泉 + 炼丹房
- 空间 + 系统：空间作为系统的"背包"扩展
- 空间穿越：空间连接两个世界

## 读者画像
末世/修仙赛道通用金手指，男女频均有；满足"随身带着整个家"的安全感需求。

## 避雷
- 空间功能过于万能，解决一切问题
- 空间内时间流速/规则前后矛盾
- 频繁"进空间"打断叙事节奏`,
  },
];

export async function seedElements(): Promise<number> {
  const items = [...SEED, ...MARKET_HOT_ELEMENTS_2026_05];
  for (const item of items) {
    await upsertElementBySlug(item);
  }
  return items.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedElements()
    .then((count) => {
      console.log(`✓ elements seeded (${count} items)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
