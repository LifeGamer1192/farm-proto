// Lightweight internationalisation. English is the default; Japanese is
// offered as an option. t(key, params) looks up the active language and
// substitutes {placeholders}.

const STRINGS = {
  en: {
    'app.tagline': 'A colony of farmers — seasons, crops and autonomous workers',

    'panel.season': 'Season',
    'panel.speedZoom': 'Speed & zoom',
    'panel.tool': 'Tool',
    'panel.crop': 'Crop to sow',
    'panel.colony': 'Colony',
    'panel.tasks': 'Tasks',
    'panel.colonists': 'Colonists',
    'panel.view': 'View',
    'panel.mapStats': 'Map stats',
    'panel.legend': 'Legend',
    'panel.language': 'Language',
    'label.seed': 'Seed',
    'label.gameSpeed': 'Game speed',
    'label.mapZoom': 'Map zoom',
    'label.activityLog': 'Activity log',
    'label.whyThisTask': 'Why this task',

    'btn.apply': 'Apply',
    'btn.regenerate': 'Regenerate (random)',
    'btn.clearQueue': 'Clear queue',
    'btn.center': 'Center camera on a colonist',

    'task.move': 'Move',
    'task.harvest': 'Harvest',
    'task.sow': 'Sow',
    'task.till': 'Till',
    'task.water': 'Water',
    'task.eat': 'Eat',
    'task.rest': 'Rest',
    'task.leisure': 'Leisure',
    'task.sleep': 'Sleep',

    'crop.wheat': 'Wheat',
    'crop.potato': 'Potato',
    'crop.bean': 'Bean',

    'zoom.small': 'Small',
    'zoom.medium': 'Medium',
    'zoom.large': 'Large',

    'view.terrain': 'Terrain',
    'view.fertility': 'Fertility',
    'view.moisture': 'Moisture',
    'view.sunlight': 'Sunlight',

    'season.spring': 'Spring',
    'season.summer': 'Summer',
    'season.autumn': 'Autumn',
    'season.winter': 'Winter',

    'state.idle': 'Idle',
    'state.walking': 'Walking',
    'state.working': 'Working',
    'state.eating': 'Eating',
    'state.resting': 'Resting',
    'state.sleeping': 'Sleeping',
    'state.strolling': 'Strolling',

    'stat.seed': 'Seed',
    'stat.size': 'Size',
    'stat.water': 'Water',
    'stat.land': 'Land',
    'stat.avgFertility': 'Avg fertility',
    'stat.avgMoisture': 'Avg moisture',
    'stat.avgSunlight': 'Avg sunlight',
    'stat.year': 'Year',
    'stat.season': 'Season',
    'stat.temperature': 'Temperature',
    'stat.daylight': 'Daylight',
    'stat.seasonGrowth': 'Season growth',
    'stat.foodStored': 'Food stored',
    'stat.harvest': 'Wheat / Potato / Bean',
    'stat.forage': 'Forage',
    'stat.cropsLost': 'Crops lost',
    'stat.meals': 'Meals eaten',
    'stat.missed': 'Missed meals',
    'stat.queued': 'Queued',
    'stat.busy': 'Working now',
    'stat.camera': 'Camera',

    'val.day': 'day {n}',
    'val.none': '—',
    'val.tiles': '{n} tiles',

    'legend.water': 'Water',
    'legend.poorSoil': 'Poor soil',
    'legend.richSoil': 'Rich soil',
    'legend.low': 'Low',
    'legend.high': 'High',
    'legend.waterNA': 'Water (n/a)',
    'legend.dry': 'Dry',
    'legend.wet': 'Wet',
    'legend.shade': 'Shade',
    'legend.bright': 'Bright',

    'hint.welcome':
      'Pick a tool, then click map tiles to set tasks. Colonists pick up work on their own.',
    'hint.task.move': 'Move tool — click a tile and a colonist walks there.',
    'hint.task.harvest':
      'Harvest tool — click a ripe crop, wild plant or dead husk to gather or clear it.',
    'hint.task.sow':
      'Sow tool — click tiles to plant the chosen crop. It grows over time; harvest it when ripe.',
    'hint.task.till':
      'Till tool — click land to till the soil. Crops sown on tilled soil survive better.',
    'hint.task.water':
      'Water tool — click a growing crop. Watered crops grow faster for a while.',
    'hint.crop.wheat': 'Wheat — moderate growth, yields 4 food.',
    'hint.crop.potato': 'Potato — slow to grow, yields 7 food.',
    'hint.crop.bean': 'Bean — quick to grow, yields 2 food.',

    'note.spring': 'Spring — mild. Crops grow steadily; a good time to sow.',
    'note.summer': 'Summer — warm and bright. Crops grow fastest.',
    'note.autumn': 'Autumn — cooling down. Crop growth slows.',
    'note.winter': 'Winter — cold. Crops barely grow until it warms again.',

    'reason.queued': 'Picked {task} ({x}, {y}) from the work queue.',
    'reason.idle': 'No queued work — colonists eat, rest and stroll on their own.',
    'reason.cleared': 'Task queue cleared.',
    'reason.start': 'No tasks queued yet.',

    'tip.elevation': 'elevation',
    'tip.fertility': 'fertility',
    'tip.moisture': 'moisture',
    'tip.sunlight': 'sunlight',
    'tip.tilled': 'tilled soil',
    'tip.plantWild': 'plant: wild',
    'tip.crop': 'crop: {crop} ({status})',
    'tip.ripe': 'ripe',
    'tip.withered': 'withered',
    'tip.watered': 'watered',
    'tip.growthHere': 'crop growth here ~{n}%',
    'tip.sowHere': 'sow {crop}: ~{n}% to survive',
    'tile.land': 'land',
    'tile.water': 'water',

    'log.withered': '{crop} ({x}, {y}) withered',
    'log.ate': '{name} ate',
    'log.hungry': '{name} went hungry — no food',
    'out.arrived': 'arrived',
    'out.sowed': 'sowed {crop}',
    'out.harvested': '{crop} +{n}',
    'out.foraged': 'foraged +1',
    'out.cleared': 'cleared dead crop',
    'out.tilled': 'soil tilled',
    'out.watered': 'crop watered',
    'out.offMap': 'off the map',
    'out.notRipe': 'crop not ripe yet',
    'out.occupied': 'tile already occupied',
    'out.onWater': 'cannot use on water',
    'out.unreachable': 'unreachable',
    'out.noPlant': 'nothing to harvest',
    'out.noCrop': 'no crop to water',
  },

  ja: {
    'app.tagline': '農民のコロニー — 季節・作物・自律して働く仲間たち',

    'panel.season': '季節',
    'panel.speedZoom': '速度・ズーム',
    'panel.tool': 'ツール',
    'panel.crop': '蒔く作物',
    'panel.colony': 'コロニー',
    'panel.tasks': 'タスク',
    'panel.colonists': 'コロニスト',
    'panel.view': '表示',
    'panel.mapStats': 'マップ統計',
    'panel.legend': '凡例',
    'panel.language': '言語',
    'label.seed': 'シード',
    'label.gameSpeed': 'ゲーム速度',
    'label.mapZoom': 'マップ拡大',
    'label.activityLog': '活動ログ',
    'label.whyThisTask': '選定理由',

    'btn.apply': '適用',
    'btn.regenerate': '再生成（ランダム）',
    'btn.clearQueue': 'キューを空に',
    'btn.center': 'コロニストに視点を合わせる',

    'task.move': '移動',
    'task.harvest': '収穫',
    'task.sow': '種まき',
    'task.till': '耕す',
    'task.water': '水やり',
    'task.eat': '食事',
    'task.rest': '休憩',
    'task.leisure': '娯楽',
    'task.sleep': '睡眠',

    'crop.wheat': '小麦',
    'crop.potato': 'じゃがいも',
    'crop.bean': '豆',

    'zoom.small': '小',
    'zoom.medium': '中',
    'zoom.large': '大',

    'view.terrain': '地形',
    'view.fertility': '肥沃度',
    'view.moisture': '水分',
    'view.sunlight': '日照',

    'season.spring': '春',
    'season.summer': '夏',
    'season.autumn': '秋',
    'season.winter': '冬',

    'state.idle': '待機',
    'state.walking': '移動中',
    'state.working': '作業中',
    'state.eating': '食事中',
    'state.resting': '休憩中',
    'state.sleeping': '睡眠中',
    'state.strolling': '散策中',

    'stat.seed': 'シード',
    'stat.size': 'サイズ',
    'stat.water': '水域',
    'stat.land': '陸地',
    'stat.avgFertility': '平均肥沃度',
    'stat.avgMoisture': '平均水分',
    'stat.avgSunlight': '平均日照',
    'stat.year': '年',
    'stat.season': '季節',
    'stat.temperature': '気温',
    'stat.daylight': '日照',
    'stat.seasonGrowth': '季節成長率',
    'stat.foodStored': '食料備蓄',
    'stat.harvest': '小麦／芋／豆',
    'stat.forage': '採取',
    'stat.cropsLost': '枯死作物',
    'stat.meals': '食事回数',
    'stat.missed': '欠食',
    'stat.queued': '待ち',
    'stat.busy': '作業中',
    'stat.camera': 'カメラ',

    'val.day': '{n}日目',
    'val.none': '—',
    'val.tiles': '{n}タイル',

    'legend.water': '水域',
    'legend.poorSoil': '痩せた土',
    'legend.richSoil': '肥沃な土',
    'legend.low': '低',
    'legend.high': '高',
    'legend.waterNA': '水域（対象外）',
    'legend.dry': '乾燥',
    'legend.wet': '湿潤',
    'legend.shade': '日陰',
    'legend.bright': '日なた',

    'hint.welcome':
      'ツールを選び、マップをクリックして作業を指示。コロニストは自分で仕事を取りに行きます。',
    'hint.task.move': '移動ツール — タイルをクリックするとコロニストがそこへ歩きます。',
    'hint.task.harvest':
      '収穫ツール — 熟した作物・野生植物・枯死株をクリックして収穫／撤去します。',
    'hint.task.sow':
      '種まきツール — タイルをクリックして作物を植えます。時間で育ち、熟したら収穫します。',
    'hint.task.till':
      '耕すツール — 陸地をクリックして土を耕します。耕した土では作物が枯れにくくなります。',
    'hint.task.water':
      '水やりツール — 育成中の作物をクリック。しばらく成長が速くなります。',
    'hint.crop.wheat': '小麦 — 成長は普通、収量4。',
    'hint.crop.potato': 'じゃがいも — 成長は遅い、収量7。',
    'hint.crop.bean': '豆 — 成長は速い、収量2。',

    'note.spring': '春 — 穏やか。作物は順調に育ち、種まきの好機です。',
    'note.summer': '夏 — 暖かく明るい。作物の成長が最も速い季節です。',
    'note.autumn': '秋 — 冷え込み始め、作物の成長が鈍ります。',
    'note.winter': '冬 — 寒い。暖かくなるまで作物はほとんど育ちません。',

    'reason.queued': '作業キューから {task}（{x}, {y}）を選択。',
    'reason.idle': '待ちの作業なし — コロニストは食事・休憩・散策をします。',
    'reason.cleared': 'タスクキューを空にしました。',
    'reason.start': 'まだタスクはありません。',

    'tip.elevation': '標高',
    'tip.fertility': '肥沃度',
    'tip.moisture': '水分',
    'tip.sunlight': '日照',
    'tip.tilled': '耕済み',
    'tip.plantWild': '植物：野生',
    'tip.crop': '作物：{crop}（{status}）',
    'tip.ripe': '熟',
    'tip.withered': '枯死',
    'tip.watered': '水やり済み',
    'tip.growthHere': 'ここでの成長 ～{n}%',
    'tip.sowHere': '{crop}の生存率 ～{n}%',
    'tile.land': '陸地',
    'tile.water': '水域',

    'log.withered': '{crop}（{x}, {y}）が枯れた',
    'log.ate': '{name}が食事した',
    'log.hungry': '{name}が空腹 — 食料なし',
    'out.arrived': '到着',
    'out.sowed': '{crop}を植えた',
    'out.harvested': '{crop} +{n}',
    'out.foraged': '採取 +1',
    'out.cleared': '枯死株を撤去',
    'out.tilled': '土を耕した',
    'out.watered': '水をやった',
    'out.offMap': 'マップ外',
    'out.notRipe': 'まだ熟していない',
    'out.occupied': 'タイルがふさがっている',
    'out.onWater': '水域には使えない',
    'out.unreachable': '到達不可',
    'out.noPlant': '収穫対象がない',
    'out.noCrop': '水やりする作物がない',
  },
};

let lang = 'en';

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (STRINGS[next]) lang = next;
}

/** Translate a key, substituting {placeholders} from params. */
export function t(key, params) {
  let s = STRINGS[lang][key];
  if (s === undefined) s = STRINGS.en[key];
  if (s === undefined) return key;
  if (params) {
    for (const p in params) s = s.split(`{${p}}`).join(params[p]);
  }
  return s;
}
