// A pool of one-line tips shown at random in the Tips panel.
//
// Three kinds:
//   'spec'     — how this game works
//   'genetics' — general genetics knowledge
//   'plant'    — general crop and wild-plant knowledge

export const TIPS = [
  // --- spec: how the game works ------------------------------------------
  { cat: 'spec', en: 'Pick a tool, then click map tiles to order work — colonists also take up jobs on their own.', ja: 'ツールを選び、マップをクリックして作業を指示。コロニストは自分でも仕事を取りに行きます。' },
  { cat: 'spec', en: 'Sowing spends one seed from your stock.', ja: '種まきは在庫から種を1つ消費します。' },
  { cat: 'spec', en: 'Plant crops next to each other and a harvest cross-pollinates their seeds.', ja: '作物を隣り合わせて植えると、収穫時に種が交配します。' },
  { cat: 'spec', en: 'The star rank on a seed sums up its gameplay quality.', ja: '種の★ランクは、その種のゲーム上の総合品質を表します。' },
  { cat: 'spec', en: 'Harvesting a ripe crop returns seeds for the next planting.', ja: '熟した作物を収穫すると、次の作付け用の種が手に入ります。' },
  { cat: 'spec', en: 'Tilled soil gives a sown crop a better chance to survive.', ja: '耕した土では、まいた作物が枯れにくくなります。' },
  { cat: 'spec', en: 'A watered crop grows faster for a while.', ja: '水やりした作物は、しばらく成長が速くなります。' },
  { cat: 'spec', en: 'Build a warehouse and colonists haul food into it, safe from pests.', ja: '倉庫を建てると、コロニストが食料を運び込み、虫害から守ります。' },
  { cat: 'spec', en: 'Pests gnaw at on-hand food; food in a warehouse is left untouched.', ja: '虫害は手持ちの食料をかじります。倉庫の中の食料は無事です。' },
  { cat: 'spec', en: 'Keep a hearth lit through winter, or colonists suffer in the cold.', ja: '冬はかまどの火を絶やさないこと。さもないとコロニストが寒さに苦しみます。' },
  { cat: 'spec', en: 'A lit hearth keeps colonists warm within 5 tiles — multiple hearths cover more of the farm.', ja: '点火したかまどは半径5タイル以内のコロニストを暖めます。複数のかまどで広い範囲をカバーできます。' },
  { cat: 'spec', en: 'Each lit hearth burns wood steadily — the more hearths burning, the faster your wood depletes.', ja: '点火中のかまど1つごとに材木を消費します。かまどが多いほど材木の消費が速くなります。' },
  { cat: 'spec', en: 'Wood comes from chopping trees, with a little from foraging wild plants.', ja: '材木は木の伐採で得られます。野生植物の採取でも少しだけ手に入ります。' },
  { cat: 'spec', en: 'Cook raw food at a hearth into meals — meals lift mood and never spoil.', ja: 'かまどで食材を料理にすると、気分が上がり、虫害でも傷みません。' },
  { cat: 'spec', en: 'Idle colonists hunt boar on their own when colony food runs low.', ja: '食料が尽きかけると、手すきのコロニストが自分でイノシシを狩ります。' },
  { cat: 'spec', en: 'The Cancel tool calls off planned tasks you no longer want.', ja: 'キャンセルツールで、いらなくなった予定タスクを取り消せます。' },
  { cat: 'spec', en: 'A hungry colonist stops work to eat; with no food at all, it starves.', ja: '空腹のコロニストは手を止めて食事します。食料が尽きると餓えます。' },
  { cat: 'spec', en: 'A miserable colonist may slack off instead of working.', ja: '気分がひどく落ち込んだコロニストは、仕事をサボることがあります。' },
  { cat: 'spec', en: 'A hut nearby helps a resting colonist recover its mood faster.', ja: '小屋が近くにあると、休むコロニストの気分の回復が速くなります。' },
  { cat: 'spec', en: 'Ring your farm with fences and boar will not cross them.', ja: '農地を柵で囲うと、イノシシは越えてこられません。' },
  { cat: 'spec', en: 'Press 1 to 5 to change game speed; press space to pause.', ja: '1〜5キーでゲーム速度、スペースキーで一時停止です。' },
  { cat: 'spec', en: 'Scroll the map with WASD, the on-screen arrows, or by dragging.', ja: 'マップは WASD・画面の矢印・ドラッグでスクロールできます。' },
  { cat: 'spec', en: 'Surviving one full year is the colony first milestone.', ja: '最初の目標は、コロニーで1年を生き延びることです。' },
  { cat: 'spec', en: 'The Variety codex shows the best variety you have bred for each crop.', ja: '品種図鑑には、作物ごとに育成した最良の品種が表示されます。' },
  { cat: 'spec', en: 'A sown crop can wither before ripening — soil suitability sets the odds.', ja: 'まいた作物は熟す前に枯れることがあり、土の適性で生存率が決まります。' },
  { cat: 'spec', en: 'Each season shifts the temperature, and temperature drives crop growth.', ja: '季節ごとに気温が変わり、気温が作物の成長を左右します。' },
  { cat: 'spec', en: 'In winter crops barely grow until the weather warms again.', ja: '冬の間、作物は暖かくなるまでほとんど育ちません。' },
  { cat: 'spec', en: 'Drag a range tool across tiles to paint many orders at once.', ja: '範囲ツールはドラッグで、まとめて指示を置けます。' },
  { cat: 'spec', en: 'Direct one colonist, or the whole colony, from the Colonists panel.', ja: 'コロニストパネルから、1人だけ・コロニー全体への指示を切り替えられます。' },
  { cat: 'spec', en: 'The View modes show fertility, moisture and sunlight as heat maps.', ja: '表示モードで、肥沃度・水分・日照をヒートマップとして見られます。' },
  { cat: 'spec', en: 'Higher map zoom shows fewer tiles in more detail.', ja: 'マップを拡大するほど、表示タイルは減り、細部が大きく見えます。' },
  { cat: 'spec', en: 'The activity log keeps a long history — scroll it back to review events.', ja: '活動ログは長い履歴を保持します。さかのぼって出来事を確認できます。' },
  { cat: 'spec', en: 'Hover a tile to inspect its soil and whatever grows on it.', ja: 'タイルにマウスを乗せると、土の状態と育っているものを確認できます。' },
  { cat: 'spec', en: 'Crops grown from higher-quality seed survive better and yield more.', ja: '品質の高い種から育てた作物は、よく生き残り、収量も増えます。' },
  { cat: 'spec', en: 'A colonist with no food on hand will help itself from a warehouse.', ja: '手持ちの食料がないコロニストは、倉庫から食べ物を取って食べます。' },
  { cat: 'spec', en: 'Colonists clear away withered, dead crops on their own.', ja: '枯れて死んだ作物は、コロニストが自分で撤去します。' },
  { cat: 'spec', en: 'Regenerate the map, or type in a seed, to start a fresh world.', ja: 'マップを再生成するか、シードを入力すると、新しい世界で始められます。' },
  { cat: 'spec', en: 'Save your best seed: this season stock is next season potential.', ja: '良い種は取っておきましょう。今季の在庫が来季の伸びしろです。' },

  // --- genetics: general knowledge ---------------------------------------
  { cat: 'genetics', en: 'Gregor Mendel showed that traits pass on in discrete units — genes.', ja: 'メンデルは、形質が「遺伝子」という分かれた単位で受け継がれることを示しました。' },
  { cat: 'genetics', en: 'Each gene here has two alleles; an offspring takes one from each parent.', ja: 'このゲームの各遺伝子は2つの対立遺伝子を持ち、子は親から1つずつ受け継ぎます。' },
  { cat: 'genetics', en: 'A dominant allele shows in the plant; a recessive one can stay hidden.', ja: '顕性の対立遺伝子は姿に現れ、潜性のものは隠れたままになることがあります。' },
  { cat: 'genetics', en: 'A recessive trait appears only when both alleles are recessive.', ja: '潜性の形質は、両方の対立遺伝子が潜性のときだけ現れます。' },
  { cat: 'genetics', en: 'Crossing two parents shuffles their alleles into new combinations.', ja: '2つの親をかけ合わせると、対立遺伝子が混ざって新しい組み合わせになります。' },
  { cat: 'genetics', en: 'Mutation is the source of brand-new alleles — fresh variation to select from.', ja: '突然変異はまったく新しい対立遺伝子の源で、選抜する変異を供給します。' },
  { cat: 'genetics', en: 'Choosing the best plants to breed each generation is selective breeding.', ja: '毎世代いちばん良い株を選んでかけ合わせるのが「選抜育種」です。' },
  { cat: 'genetics', en: 'Mendel bred pea plants in a monastery garden in the 1860s.', ja: 'メンデルは1860年代、修道院の庭でエンドウマメを育てて研究しました。' },
  { cat: 'genetics', en: 'Crossing two different strains can give offspring that beat both — hybrid vigour.', ja: '異なる系統をかけ合わせると、両親を上回る子ができることがあります(雑種強勢)。' },
  { cat: 'genetics', en: 'The set of genes is the genotype; the visible result is the phenotype.', ja: '遺伝子の構成が「遺伝子型」、見た目に現れた結果が「表現型」です。' },
  { cat: 'genetics', en: 'A Punnett square charts the alleles an offspring may inherit.', ja: 'パネットの方形は、子が受け継ぎうる対立遺伝子の組を図にしたものです。' },
  { cat: 'genetics', en: 'Self-pollination keeps a line true-breeding — stable across generations.', ja: '自家受粉は系統を「純系」に保ち、世代を越えて安定させます。' },
  { cat: 'genetics', en: 'Genetic diversity is the raw material that breeding works with.', ja: '遺伝的多様性は、育種が扱う「素材」です。' },
  { cat: 'genetics', en: 'Mendel law of segregation: the two alleles of a gene separate into the seeds.', ja: 'メンデルの分離の法則: 遺伝子の2つの対立遺伝子は、種へ分かれて入ります。' },
  { cat: 'genetics', en: 'Mendel law of independent assortment: separate genes are inherited independently.', ja: 'メンデルの独立の法則: 別々の遺伝子は、互いに独立して受け継がれます。' },
  { cat: 'genetics', en: 'Two plants that look alike can still carry different hidden alleles.', ja: '見た目がそっくりな2株でも、隠れた対立遺伝子は異なることがあります。' },
  { cat: 'genetics', en: 'A carrier shows a dominant trait but can still pass on a recessive one.', ja: '保因者は顕性の形質を見せつつ、潜性の対立遺伝子も子へ渡せます。' },
  { cat: 'genetics', en: 'Inbreeding a small stock can let harmful recessive traits surface.', ja: '少ない株での近親交配は、好ましくない潜性形質を表に出すことがあります。' },
  { cat: 'genetics', en: 'Most mutations do little; a rare one is a large leap.', ja: 'ほとんどの突然変異はわずかな変化で、まれに大きく跳ねるものがあります。' },
  { cat: 'genetics', en: 'DNA carries the instructions copied from parent to offspring.', ja: 'DNA は、親から子へ写し取られる設計情報を担います。' },
  { cat: 'genetics', en: 'A chromosome is a long bundle of many genes.', ja: '染色体は、多くの遺伝子をまとめた長い束です。' },
  { cat: 'genetics', en: 'Crops usually carry two copies of each chromosome — they are diploid.', ja: '作物は通常、各染色体を2セット持つ「二倍体」です。' },
  { cat: 'genetics', en: 'Heredity is why offspring resemble, but do not exactly copy, their parents.', ja: '遺伝があるから、子は親に似つつも、完全な複製にはなりません。' },
  { cat: 'genetics', en: 'Charles Darwin pointed to selection as the engine of change in living things.', ja: 'ダーウィンは、選択を生物の変化の原動力として挙げました。' },
  { cat: 'genetics', en: 'Selecting hard for one trait can drag along other traits linked to it.', ja: 'ある形質を強く選抜すると、それに連鎖した別の形質も一緒に動くことがあります。' },
  { cat: 'genetics', en: 'A landrace is a local crop variety shaped by generations of farmers.', ja: '在来品種(ランドレース)は、何世代もの農家が育てた土地固有の品種です。' },
  { cat: 'genetics', en: 'Backcrossing to a parent fixes one trait while keeping the rest familiar.', ja: '親へ戻し交配すると、1つの形質を固定しつつ、残りは元のまま保てます。' },
  { cat: 'genetics', en: 'The wider your breeding stock, the more combinations you can explore.', ja: '育種に使う株が幅広いほど、試せる組み合わせは増えます。' },
  { cat: 'genetics', en: 'Phenotype is genotype plus the environment the plant grew in.', ja: '表現型は、遺伝子型に、その植物が育った環境が加わったものです。' },
  { cat: 'genetics', en: 'A rare, large mutation can appear if you keep breeding generation after generation.', ja: '世代を重ねて育種を続けると、まれに大きな突然変異が現れることがあります。' },
  { cat: 'genetics', en: 'Dominant does not mean better — only that it shows over the recessive.', ja: '顕性は「優れる」という意味ではなく、潜性より姿に現れやすいだけです。' },
  { cat: 'genetics', en: 'Pollen from one plant fertilising another is cross-pollination.', ja: 'ある植物の花粉が別の植物を受粉させるのが「他家受粉(交配)」です。' },

  // --- plant: crop and wild-plant lore -----------------------------------
  { cat: 'plant', en: 'Wheat was bred from wild grasses over ten thousand years ago.', ja: '小麦は1万年以上前、野生のイネ科の草から育てられました。' },
  { cat: 'plant', en: 'Modern maize descends from a wild Mexican grass called teosinte.', ja: '現代のトウモロコシは、テオシントというメキシコの野草が祖先です。' },
  { cat: 'plant', en: 'The potato was first cultivated high in the Andes mountains.', ja: 'ジャガイモは、アンデス山脈の高地で最初に栽培されました。' },
  { cat: 'plant', en: 'Wild relatives of crops carry disease resistance breeders still use today.', ja: '作物の野生種は、今も育種に使われる病気への抵抗性を備えています。' },
  { cat: 'plant', en: 'The bananas we eat are seedless clones, grown from cuttings.', ja: '私たちが食べるバナナは種なしのクローンで、株分けで育てられます。' },
  { cat: 'plant', en: 'Wild almonds were bitter and toxic; farmers bred the safe ones.', ja: '野生のアーモンドは苦く有毒で、農家が安全なものを選び育てました。' },
  { cat: 'plant', en: 'Carrots were once mostly purple and white before orange ones spread.', ja: 'ニンジンは、オレンジ色が広まる前は紫や白が主流でした。' },
  { cat: 'plant', en: 'Cabbage, broccoli, kale and kohlrabi are all bred from one wild species.', ja: 'キャベツ・ブロッコリー・ケール・コールラビは、すべて同じ野生種から育てられました。' },
  { cat: 'plant', en: 'Apples grown from seed rarely match the parent — good ones are grafted.', ja: 'リンゴは種から育てても親と同じにならず、良い品種は接ぎ木で増やします。' },
  { cat: 'plant', en: 'Watermelons were once pale and bitter; centuries of breeding sweetened them.', ja: 'スイカはかつて淡色で苦く、何世紀もの育種で甘くなりました。' },
  { cat: 'plant', en: 'Tomatoes came from small wild berries in western South America.', ja: 'トマトは、南米西部の小さな野生の実が起源です。' },
  { cat: 'plant', en: 'Rice was domesticated from wild grasses in Asia thousands of years ago.', ja: 'イネは数千年前、アジアの野生の草から栽培化されました。' },
  { cat: 'plant', en: 'Wild wheat shatters to scatter its seed; farmed wheat holds onto it.', ja: '野生の小麦は穂が砕けて種を散らし、栽培種は種を穂に留めます。' },
  { cat: 'plant', en: 'A crop that holds its seed is easy to harvest but must be sown by hand.', ja: '種を留める作物は収穫しやすい一方、人の手でまく必要があります。' },
  { cat: 'plant', en: 'Beans and peas pull nitrogen from the air and enrich the soil.', ja: '豆類は空気中の窒素を取り込み、土を豊かにします。' },
  { cat: 'plant', en: 'Many wild plants guard their seeds with bitterness or a hard shell.', ja: '多くの野生植物は、苦みや固い殻で種を守っています。' },
  { cat: 'plant', en: 'Strawberries spread by runners — clones that root where they touch soil.', ja: 'イチゴはランナーで広がり、土に触れた先で根づくクローンを作ります。' },
  { cat: 'plant', en: 'Seed banks store crop varieties as a safeguard for the future.', ja: 'シードバンクは、将来への備えとして作物の品種を保存しています。' },
  { cat: 'plant', en: 'The first farmers picked plants with bigger, tastier, easier-to-gather seed.', ja: '最初の農家は、種が大きく・おいしく・集めやすい株を選びました。' },
  { cat: 'plant', en: 'A wild plant invests in survival; a crop is bred to invest in yield.', ja: '野生植物は生き残りに、作物は収量に力を注ぐよう育てられています。' },
  { cat: 'plant', en: 'Sunflowers turn to track the sun while their flower heads are still growing.', ja: 'ヒマワリは、花が育つ間は太陽を追って向きを変えます。' },
  { cat: 'plant', en: 'Soil fertility, water and sunlight all shape how well a crop grows.', ja: '土の肥沃度・水・日照のすべてが、作物の育ち方を左右します。' },
  { cat: 'plant', en: 'Crop rotation keeps soil healthy and starves pests of their target.', ja: '輪作は土を健やかに保ち、害虫から狙いの作物を遠ざけます。' },
  { cat: 'plant', en: 'Pumpkins and squash were among the earliest crops of the Americas.', ja: 'カボチャやウリの仲間は、アメリカ大陸で最も古い作物のひとつです。' },
  { cat: 'plant', en: 'Sweet corn is harvested young, while the kernels are still sugary.', ja: 'スイートコーンは、粒がまだ甘い若いうちに収穫します。' },
  { cat: 'plant', en: 'Drought-hardy crops invest in deep roots and thrifty leaves.', ja: '乾燥に強い作物は、深い根と水を節約する葉に力を注ぎます。' },
  { cat: 'plant', en: 'A perennial plant lives for years; most grain crops are annuals.', ja: '多年生植物は何年も生き、穀物の多くは一年生です。' },
  { cat: 'plant', en: 'Pollinators like bees carry the pollen that lets crops set seed.', ja: 'ミツバチなどの送粉者が花粉を運び、作物が種をつけられます。' },
  { cat: 'plant', en: 'Frost can kill a tender crop overnight — cold tolerance is precious.', ja: '霜は弱い作物を一晩で枯らします。耐寒性は貴重な形質です。' },
  { cat: 'plant', en: 'Heirloom varieties are old crops kept true by saving their seed.', ja: 'エアルーム品種は、種を採り続けて受け継がれてきた古い作物です。' },
  { cat: 'plant', en: 'Wild grasses still grow beside fields, holding genes crops have lost.', ja: '野生の草は今も畑のそばに育ち、作物が失った遺伝子を保っています。' },
  { cat: 'plant', en: 'A crop and its wild ancestor can often still cross and share traits.', ja: '作物とその野生の祖先は、今も交配して形質を分け合えることが多いです。' },
];

const CATS = ['spec', 'genetics', 'plant'];

/** A random tip index different from `notIndex` (if possible). */
export function randomTipIndex(notIndex = -1) {
  if (TIPS.length <= 1) return 0;
  let i = notIndex;
  while (i === notIndex) i = Math.floor(Math.random() * TIPS.length);
  return i;
}

export { CATS };
