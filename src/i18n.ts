/** Chinese source strings are the keys; placeholders use {name} in every language. */
export type Locale = 'zh-CN' | 'ja' | 'en';
export const LOCALES: ReadonlyArray<{ value: Locale; name: string }> = [
  { value: 'zh-CN', name: '简体中文' },
  { value: 'ja', name: '日本語' },
  { value: 'en', name: 'English' },
];
export const LOCALE_STORAGE_KEY = 'slsim.locale';

/** [English, Japanese]. Keep model/flow source labels here even when their owners render them. */
export const TRANSLATIONS: Readonly<Record<string, readonly [string, string]>> = {
  'SL-sim · Aster D51 实火蒸汽机车': ['SL-sim · Aster D51 live steam', 'SL-sim · Aster D51 ライブスチーム'],
  '语言': ['Language', '言語'],
  'Aster D51 · 1 号轨 · 酒精烧': ['Aster D51 · Gauge 1 · Alcohol-fired', 'Aster D51 · 1番ゲージ · アルコール焚き'],
  '冷态开始': ['Cold start', '冷態から開始'],
  '热态开始': ['Hot start', '暖機済みで開始'],
  '模式': ['Mode', '運転モード'],
  '轨道': ['Track', '線路'],
  '滚轮台': ['Rollers', 'ローラー台'],
  '时间倍率': ['Time scale', '時間倍率'],
  '暂停': ['Pause', '一時停止'],
  '拖重': ['Train load', '牽引重量'],
  '坡度': ['Gradient', '勾配'],
  '视图': ['View', '表示'],
  '外观': ['Exterior', '外観'],
  '剖视': ['Cutaway', '断面'],
  '机构': ['Mechanism', '機構'],
  '流向': ['Flows', '流れ'],
  '标注': ['Labels', '名称'],
  '拆解': ['Explode', '分解'],
  '下一步': ['Next step', '次の操作'],
  '操作': ['Controls', '操作'],
  '加减阀': ['Regulator', '加減弁'],
  '回动手柄（后退 ← 中立 → 前进）': ['Reverser (reverse ← neutral → forward)', '逆転機（後退 ← 中立 → 前進）'],
  '通风阀': ['Blower', 'ブロワー弁'],
  '燃料阀': ['Fuel valve', '燃料弁'],
  '旁通阀（0 = 轴泵全部给水）': ['Bypass (0 = all pump water to boiler)', 'バイパス弁（0 = 軸動ポンプ全量給水）'],
  '气缸排水阀': ['Cylinder drains', 'シリンダードレン弁'],
  '烟囱通风机': ['Chimney fan', '煙突ファン'],
  '锅炉排水阀': ['Boiler blowdown', 'ボイラー排水弁'],
  '点火': ['Ignite', '点火'],
  '熄火': ['Extinguish', '消火'],
  '手摇泵': ['Hand pump', '手動ポンプ'],
  '汽笛': ['Whistle', '汽笛'],
  '← 推': ['← Push', '← 押す'],
  '推 →': ['Push →', '押す →'],
  '加燃料': ['Refill fuel', '燃料補給'],
  '水柜加水': ['Refill tender', 'テンダー給水'],
  '加油': ['Refill oil', '給油'],
  '配气事件（当前回动位置）': ['Valve events (current reverser)', '弁の作動時期（現在の逆転機位置）'],
  '仪表': ['Gauges', '計器'],
  // Phase monitor: source strings are also captured once for dynamically inserted static nodes.
  '相位监视': ['Phase monitor', '位相モニター'],
  '相位': ['Phase', '位相'],
  '打开相位监视': ['Open phase monitor', '位相モニターを開く'],
  '图 6、图 6.2：柱塞沿车身前后水平往复，止回阀腔沿车宽横置。': ['Figs 6 / 6.2: the plunger reciprocates horizontally fore–aft; the check-valve chamber runs across the frames.', '図6・6.2：プランジャーは車体前後方向に水平往復し、逆止弁室は車幅方向に配置。'],
  '下图为侧视：x 向前，y 向上；不是竖直柱塞泵。': ['Side view below: x forward, y up; this is not a vertical plunger pump.', '下図は側面図：x は前方、y は上方。縦型プランジャーポンプではありません。'],
  '曲柄角：从前方 +x 顺时针': ['Crank angle: clockwise from forward +x', 'クランク角：前方 +x から時計回り'],
  '左曲柄定位（仅暂停时）': ['Position left crank (paused only)', '左クランク位置設定（一時停止中のみ）'],
  '左曲柄减小 15°': ['Decrease left crank by 15°', '左クランクを15°戻す'],
  '左曲柄增加 15°': ['Increase left crank by 15°', '左クランクを15°進める'],
  '左曲柄角度': ['Left crank angle', '左クランク角度'],
  '暂停定位会重置气缸状态；锅炉、时间和燃料不变。': ['Paused positioning resets cylinder state; boiler, time and fuel are unchanged.', '一時停止中の位置設定はシリンダー状態をリセットします。ボイラー・時間・燃料は変わりません。'],
  '左侧': ['Left', '左側'],
  '右侧': ['Right', '右側'],
  '活塞 mm': ['Piston mm', 'ピストン mm'],
  '滑阀 mm': ['Valve mm', '滑り弁 mm'],
  '回动曲柄销角度': ['Return-crank pin angle', 'リターンクランクピン角度'],
  '图 9：前死点时回动曲柄销在轴心上方，半径杆接合并杆上销；气缸汽道交叉。': ['Fig. 9: return-crank pin above the axle at front dead centre, radius rod on the top lever pin; crossed cylinder passages.', '図9：前死点でリターンクランクピンは軸心の上、心向棒は結合テコの上部ピンに接続。シリンダーの蒸気通路は交差。'],
  '关闭': ['Closed', '閉鎖'],
  '吸水': ['Suction', '吸水'],
  '压水': ['Delivery', '吐出'],
  '停止': ['Stopped', '停止'],
  '死点': ['Dead centre', '死点'],
  '已暂停 · 可定位': ['Paused · positioning enabled', '一時停止 · 位置設定可'],
  '运行中 · 定位已锁定': ['Live · positioning locked', '運転中 · 位置設定不可'],
  '同侧四轴相差 ≤ {angle}°': ['4 same-side axles: spread ≤ {angle}°', '同側4軸の位相差 ≤ {angle}°'],
  '右 − 左：{angle}°（模型约定）': ['Right − left: {angle}° (model convention)', '右 − 左：{angle}°（モデル上の規約）'],
  '位移：中位为零、向前为正；汽口仅表示几何开闭。': ['Displacement: mid-position = 0, forward +; ports show geometry only.', '変位：中央が0、前方が正。ポート表示は幾何学的な開閉のみ。'],
  '第 {axle} 动轴 · 轴泵': ['Driver #{axle} · axle pump', '第{axle}動軸 · 軸動ポンプ'],
  '相位 {angle}° · 行程 {percent}%': ['Phase {angle}° · stroke {percent}%', '位相 {angle}° · 行程 {percent}%'],
  '轴泵行程比例': ['Pump stroke fraction', '軸動ポンプ行程比'],
  '偏心 x / y mm': ['Eccentric x / y mm', '偏心輪 x / y mm'],
  '柱塞 x / y mm': ['Ram x / y mm', 'プランジャー x / y mm'],
  '柱塞速度 mm/s': ['Ram velocity mm/s', 'プランジャー速度 mm/s'],
  '正反转均每转一冲程 · 估计 {volume} mL/转（旁通前）': ['1 stroke/rev in either direction · est. {volume} mL/rev (before bypass)', '正逆転とも1行程/回転 · 推定 {volume} mL/回転（バイパス前）'],
  '主连杆长度误差最大 {error} mm': ['Max connecting-rod length error {error} mm', '主連棒長さの最大誤差 {error} mm'],
  '图 5–7：四轴联动，第 3 轴主传动及轴泵；右侧超前为约定，泵相位与尺寸为估计。': ['Figs 5–7: 4 coupled axles, #3 main/pump; right-leading is a convention, pump phase/geometry estimated.', '図5–7：4軸連結、第3軸が主動軸・ポンプ駆動。右側先行は規約、ポンプの位相・寸法は推定。'],
  '示功图（右缸：实线前端，虚线后端）': ['Indicator · RH cylinder: front solid, rear dashed', '指圧線図（右シリンダー：実線＝前端、破線＝後端）'],
  '气缸与滑阀': ['Cylinder & valve', 'シリンダーと滑り弁'],
  '配气机构': ['Valve gear', '弁装置'],
  '汽水与热量': ['Steam & heat', '蒸気・水・熱'],
  '收起': ['Collapse', '折りたたむ'],
  '展开': ['Expand', '展開'],
  '原理图': ['Diagrams', '模式図'],
  '设置': ['Settings', '設定'],
  '收起或展开面板': ['Collapse or expand panel', 'パネルを開閉'],
  '蒸汽机车三维视图': ['3D steam locomotive view', '蒸気機関車の3D表示'],
  '锅炉压力表': ['Boiler pressure gauge', 'ボイラー圧力計'],
  '锅炉水位玻璃管': ['Boiler water gauge glass', 'ボイラー水面計'],
  '右缸压力容积示功图': ['Right cylinder pressure–volume diagram', '右シリンダーの圧力・容積線図'],
  '机车原理动态图': ['Animated locomotive diagram', '機関車の動作模式図'],
  '点按可单独隐藏或显示': ['Tap a medium to hide or show it', 'タップして流れを個別に表示・非表示'],
  '水位过低': ['Low water', '水位低下'],
  '锅炉缺水干烧': ['Dry boiler — overheating', 'ボイラー空焚き'],
  '水位过高': ['High water', '水位過高'],
  '安全阀起跳': ['Safety valve lifting', '安全弁作動'],
  '燃料耗尽': ['Out of fuel', '燃料切れ'],
  '润滑油耗尽': ['Out of lubricating oil', '潤滑油切れ'],
  '动轮空转': ['Wheel slip', '動輪空転'],
  '水柜无水': ['Tender empty', 'テンダー水切れ'],
  '点不着：燃料阀还关着。先把“燃料阀”开到约 50%，再点火。': ['Cannot light: open the fuel valve to about 50%, then ignite.', '点火できません。燃料弁を約50%開いてから点火してください。'],
  '点不着：酒精箱是空的，先点“加燃料”。': ['Cannot light: the alcohol tank is empty. Refill fuel first.', '点火できません。アルコールタンクが空です。「燃料補給」を押してください。'],
  '已点着。没有抽风时火很弱，冷态请勾选“烟囱通风机”。': ['Lit. The fire needs draught: enable the chimney fan while cold.', '点火しました。通風がないと火力が弱いため、冷態時は煙突ファンを入れてください。'],
  '已点着。': ['Lit.', '点火しました。'],
  '燃料耗尽：点“加燃料”，再重新点火。': ['Out of fuel: refill fuel, then ignite again.', '燃料切れです。「燃料補給」を押して再点火してください。'],
  '火已熄灭：燃料阀开到约 50% 后点“点火”；也可以靠余压继续行驶。': ['Fire out: open the fuel valve to about 50% and ignite, or coast on remaining steam.', '消火状態です。燃料弁を約50%開いて点火するか、残圧で走行できます。'],
  '第 1 步：把“燃料阀”开到约 50%。': ['Step 1: open the fuel valve to about 50%.', '手順1：燃料弁を約50%開きます。'],
  '第 2 步：勾选“烟囱通风机”（冷态没有蒸汽，靠它抽风）。': ['Step 2: enable the chimney fan for draught before steam is available.', '手順2：煙突ファンを入れます（冷態時は蒸気がないためファンで通風）。'],
  '第 3 步：点“点火”。': ['Step 3: press Ignite.', '手順3：「点火」を押します。'],
  '水位过低：关小“旁通阀”让轴泵给水，或点“手摇泵”。': ['Low water: close the bypass to feed from the axle pump, or use the hand pump.', '水位低下：バイパス弁を絞って軸動ポンプで給水するか、手動ポンプを使ってください。'],
  '升压中…到 1.5–2 kgf/cm² 后改用通风阀。嫌慢可把时间倍率调到 20×。': ['Raising steam… switch to the blower at 1.5–2 kgf/cm². Use 20× time to speed up.', '昇圧中…1.5～2 kgf/cm²でブロワー弁に切り替えます。時間倍率20×で早送りできます。'],
  '火力很弱：冷态请勾选“烟囱通风机”抽风。': ['Weak fire: enable the chimney fan while cold.', '火力が弱い状態です。冷態時は煙突ファンで通風してください。'],
  '第 4 步：取消“烟囱通风机”，把“通风阀”开到约 30%，继续升压到 4 kgf/cm²。': ['Step 4: turn off the chimney fan, open the blower to about 30%, and raise pressure to 4 kgf/cm².', '手順4：煙突ファンを切り、ブロワー弁を約30%開いて4 kgf/cm²まで昇圧します。'],
  '继续升压到 3–4 kgf/cm²（通风阀约 30%）。': ['Continue to 3–4 kgf/cm² with the blower at about 30%.', 'ブロワー弁を約30%開き、3～4 kgf/cm²まで昇圧します。'],
  '第 5 步：勾选“气缸排水阀”，再慢慢打开“加减阀”（约 25–30%）起步。': ['Step 5: open the cylinder drains, then slowly open the regulator to about 25–30% to start.', '手順5：シリンダードレン弁を開き、加減弁をゆっくり約25～30%開いて発車します。'],
  '暖缸中：蒸汽正在冷气缸里凝结（缸壁 {temperature} °C），热起来后才有力起步，约需半分钟；排水阀保持打开。': ['Warming cylinders ({temperature} °C): steam is condensing. Allow about 30 seconds; keep drains open.', '暖機中（シリンダー壁 {temperature} °C）：蒸気が凝縮しています。約30秒待ち、ドレン弁は開いたままにします。'],
  '加减阀再开大一点；若停在死点附近，可点“推 →”。': ['Open the regulator a little more. Near dead centre, use Push →.', '加減弁をもう少し開いてください。死点付近で止まった場合は「押す →」を使えます。'],
  '第 6 步：凝水排净后取消“气缸排水阀”。': ['Step 6: close the cylinder drains once condensate is cleared.', '手順6：凝縮水が抜けたらシリンダードレン弁を閉じます。'],
  '运行中：加减阀控制速度；回动手柄拉向中立可省汽；调“旁通阀”把水位保持在 50% 左右。': ['Running: regulate speed with the regulator, shorten cutoff towards neutral to save steam, and adjust bypass to hold water near 50%.', '走行中：加減弁で速度を調整。逆転機を中立寄りにすると節汽できます。バイパス弁で水位を約50%に保ちます。'],
  '锅炉压力': ['Boiler pressure', 'ボイラー圧力'],
  '汽室压力': ['Steam chest pressure', '蒸気室圧力'],
  '锅炉温度': ['Boiler temperature', 'ボイラー温度'],
  '水位（玻璃管）': ['Water gauge level', '水面計水位'],
  '速度': ['Speed', '速度'],
  '{speed} m/s（实车 {scaleSpeed} km/h）': ['{speed} m/s (scale {scaleSpeed} km/h)', '{speed} m/s（実物換算 {scaleSpeed} km/h）'],
  '动轮转速': ['Driver speed', '動輪回転数'],
  '牵引力': ['Tractive effort', '牽引力'],
  '指示功率': ['Indicated power', '図示出力'],
  '耗汽量': ['Steam use', '蒸気消費量'],
  '给水量': ['Feedwater flow', '給水量'],
  '火力': ['Fire', '火力'],
  '{percent} %（{power} W）': ['{percent}% ({power} W)', '{percent}%（{power} W）'],
  '未点火': ['Unlit', '未点火'],
  '过热度': ['Superheat', '過熱度'],
  '缸壁温度 左 / 右': ['Cylinder wall L / R', 'シリンダー壁温度 左 / 右'],
  '燃料': ['Fuel', '燃料'],
  '水柜': ['Tender water', '水タンク'],
  '润滑油': ['Lubricating oil', '潤滑油'],
  '前端': ['Front', '前端'],
  '后端': ['Rear', '後端'],
  '导程 mm': ['Lead mm', 'リード mm'],
  '最大汽口开度 mm': ['Max port opening mm', '最大ポート開度 mm'],
  '截断 %': ['Cutoff %', '締切 %'],
  '排汽开始 %': ['Release %', '排気開始 %'],
  '压缩开始 %': ['Compression %', '圧縮開始 %'],
  '阀行程 mm': ['Valve travel mm', '弁行程 mm'],
  '水位': ['Water', '水位'],
  '气缸容积 →': ['Cylinder volume →', 'シリンダー容積 →'],
  '进汽': ['Admission', '給気'],
  '膨胀': ['Expansion', '膨張'],
  '排汽': ['Exhaust', '排気'],
  '压缩': ['Compression', '圧縮'],
  '汽室 {pressure} kgf/cm²': ['Chest {pressure} kgf/cm²', '蒸気室 {pressure} kgf/cm²'],
  '滑阀': ['Slide valve', '滑り弁'],
  '活塞杆 → 十字头': ['Piston rod → crosshead', 'ピストン棒 → クロスヘッド'],
  '← 后': ['← Rear', '← 後方'],
  '前 →': ['Front →', '前方 →'],
  '右侧气缸与滑阀纵剖面 · 中间圆孔为排汽口（通烟囱）': ['RH cylinder & slide valve · centre port: exhaust to chimney', '右シリンダー・滑り弁断面 · 中央の穴は煙突への排気口'],
  '右侧气缸与滑阀 · 交叉汽道不互通，中央排汽口通烟囱': ['RH cylinder & valve · separate crossed passages; central exhaust to chimney', '右シリンダーと滑り弁 · 交差通路は非連通、中央排気口は煙突へ'],
  '前': ['F', '前'],
  '后': ['R', '後'],
  '配气相位（外圈前端 / 内圈后端）': ['Valve phases · outer: front / inner: rear', '弁作動位相（外周＝前端 / 内周＝後端）'],
  '白线：曲柄位置；前 / 后：前、后死点': ['White: crank · F / R: front / rear dead centre', '白線：クランク · 前 / 後：前後死点'],
  '曲柄角 {angle}°': ['Crank {angle}°', 'クランク角 {angle}°'],
  '回动手柄 {percent}%': ['Reverser {percent}%', '逆転機 {percent}%'],
  '进汽开度 前 {opening}': ['Inlet F {opening}', '給気 前 {opening}'],
  '　　　　 后 {opening} mm': ['         R {opening} mm', '　　 後 {opening} mm'],
  '排汽开度 前 {opening}': ['Exhaust F {opening}', '排気 前 {opening}'],
  '（支点固定）': [' (fixed pivot)', '（支点固定）'],
  '气缸 / 活塞': ['Cylinder / piston', 'シリンダー / ピストン'],
  '中立': ['Neutral', '中立'],
  '前进': ['Forward', '前進'],
  '后退': ['Reverse', '後退'],
  '右侧 Walschaerts 配气机构 · 回动手柄 {percent}%（{gear}）· 滑块离月牙板支点越远，阀行程越大；过支点则反向': ['RH Walschaerts · Reverser {percent}% ({gear}) · Moving the die block away from the pivot increases valve travel; crossing it reverses direction.', '右側ワルシャート式弁装置 · 逆転機 {percent}%（{gear}）· 滑り子が支点から離れるほど弁行程が増え、支点を越えると逆転。'],
  '轴泵': ['Axle pump', '軸動ポンプ'],
  '过热器': ['Superheater', '過熱器'],
  '汽室': ['Steam chest', '蒸気室'],
  '气缸 ×2': ['Cylinders ×2', 'シリンダー ×2'],
  '车轮': ['Wheels', '車輪'],
  '酒精箱': ['Alcohol tank', 'アルコールタンク'],
  '酒精燃烧器': ['Alcohol burner', 'アルコールバーナー'],
  '火力 {percent}% · {power}': ['Fire {percent}% · {power}', '火力 {percent}% · {power}'],
  '烟囱': ['Chimney', '煙突'],
  '烟管 ×2（内插过热器）': ['2 flues + superheater', '煙管 ×2（過熱器内蔵）'],
  '锅炉 · 水位 {percent}%': ['Boiler · water {percent}%', 'ボイラー · 水位 {percent}%'],
  '给水': ['Feedwater', '給水'],
  '旁通回水': ['Bypass return', 'バイパス戻り水'],
  '蒸汽': ['Steam', '蒸気'],
  '安全阀开': ['Safety open', '安全弁開'],
  '安全阀': ['Safety valve', '安全弁'],
  '酒精': ['Alcohol', 'アルコール'],
  '传给水': ['To water', '水への伝熱'],
  '两根 U 形管，插在烟管内': ['2 U-tubes inside flues', '煙管内にU字管2本'],
  '烟气带走': ['Flue loss', '排ガス損失'],
  '散热': ['Heat loss', '放熱'],
  '活塞功': ['Piston work', 'ピストン仕事'],
  '通风机抽风': ['Fan draught', 'ファン通風'],
  '排汽 / 通风阀抽风': ['Exhaust / blower draught', '排気 / ブロワー通風'],
  '能量：燃料 {fuel} → 水 {water}（{waterEfficiency}）→ 指示功 {indicated} → 轮周 {wheel} · 总效率 {efficiency}': ['Energy: fuel {fuel} → water {water} ({waterEfficiency}) → indicated {indicated} → wheels {wheel} · Efficiency {efficiency}', 'エネルギー：燃料 {fuel} → 水 {water}（{waterEfficiency}）→ 図示 {indicated} → 動輪 {wheel} · 総効率 {efficiency}'],
  // Mechanism labels from colors.ts, shared by locoModel.ts and the diagrams.
  '连杆（侧杆）': ['Coupling rod', '連結棒'],
  '主连杆（摇杆）': ['Connecting rod', '主連棒'],
  '十字头 / 活塞杆': ['Crosshead / piston rod', 'クロスヘッド / ピストン棒'],
  '回动曲柄': ['Return crank', 'リターンクランク'],
  '偏心杆': ['Eccentric rod', '偏心棒'],
  '月牙板': ['Expansion link', '加減リンク'],
  '半径杆': ['Radius rod', '心向棒'],
  '合并杆': ['Combination lever', '結合テコ'],
  '结合杆': ['Union link', '結びリンク'],
  '阀杆 / 滑阀': ['Valve rod / slide valve', '弁棒 / 滑り弁'],
  '轴泵偏心轮': ['Axle-pump eccentric', '軸動ポンプ偏心輪'],
  '轴泵连杆': ['Axle-pump connecting rod', '軸動ポンプ連接棒'],
  '轴泵柱塞': ['Axle-pump plunger', '軸動ポンププランジャー'],
  '吸水单向阀': ['Suction check valve', '吸水逆止弁'],
  '出水单向阀': ['Delivery check valve', '吐出逆止弁'],
  '第三动轴': ['Third driving axle', '第3動軸'],
  // Structural labels retained as Chinese source strings by the model.
  '酒精燃烧器（3 根灯芯）': ['Alcohol burner (3 wicks)', 'アルコールバーナー（芯3本）'],
  '轴动给水泵': ['Axle-driven feed pump', '軸動給水ポンプ'],
  '油壶': ['Lubricator', '給油器'],
  '烟箱': ['Smokebox', '煙室'],
  '锅炉外壳': ['Boiler casing', 'ボイラー外板'],
  '烟囱 / 集烟装置': ['Chimney / smoke collector', '煙突 / 集煙装置'],
  '给水加热器（外观件）': ['Feedwater heater (cosmetic)', '給水温め器（外観部品）'],
  '汽包 / 砂箱': ['Steam dome / sand box', '蒸気ドーム / 砂箱'],
  '重油箱（外观件）': ['Heavy oil tank (cosmetic)', '重油タンク（外観部品）'],
  '除烟板': ['Smoke deflectors', '除煙板'],
  '锅炉（水 / 蒸汽）': ['Boiler (water / steam)', 'ボイラー（水 / 蒸気）'],
  '烟管 ×2': ['Flue tubes ×2', '煙管 ×2'],
  '过热器：两根 U 形管，各插入一根烟管': ['Superheater: one U-tube in each flue', '過熱器：各煙管にU字管1本ずつ'],
  '火室': ['Firebox', '火室'],
  '蒸汽干管 / 通风管（穿过锅炉）': ['Steam / blower pipes through boiler', 'ボイラー内の蒸気管 / ブロワー管'],
  '通风喷嘴 / 排汽喷口': ['Blower nozzle / blast pipe', 'ブロワーノズル / 排気ノズル'],
  '进汽总管': ['Steam inlet manifold', '給気集合管'],
  '左汽室': ['Left steam chest', '左蒸気室'],
  '右汽室': ['Right steam chest', '右蒸気室'],
  '左右汽室': ['Left / right steam chests', '左右の蒸気室'],
  '气缸排汽总管': ['Cylinder exhaust manifold', 'シリンダー排気集合管'],
  '独立通风喷嘴': ['Independent blower nozzle', '独立ブロワーノズル'],
  '烟箱管路连接': ['Smokebox pipe connections', '煙室内の配管接続'],
  '驾驶室': ['Cab', '運転室'],
  '气缸': ['Cylinder', 'シリンダー'],
  '气缸与汽室': ['Cylinder & steam chest', 'シリンダーと蒸気室'],
  '煤水车：水柜': ['Tender: water tank', 'テンダー：水タンク'],
  // Flow legend and live overlay label keys (the flow owner wraps dynamic values with t).
  '饱和蒸汽': ['Saturated steam', '飽和蒸気'],
  '过热蒸汽': ['Superheated steam', '過熱蒸気'],
  '烟气': ['Flue gas', '燃焼ガス'],
  '传热': ['Heat transfer', '伝熱'],
  '通风': ['Blower', 'ブロワー'],
  '烟气（烟管 ×2）': ['Flue gas (2 flues)', '燃焼ガス（煙管 ×2）'],
  '过热器 +{temperature} K': ['Superheater +{temperature} K', '過熱器 +{temperature} K'],
  // Pass unitless numbers (or preformatted numeric strings); the templates own their units.
  '给水 {flow} g/s': ['Feedwater {flow} g/s', '給水 {flow} g/s'],
  '旁通回水 {flow} g/s': ['Bypass return {flow} g/s', 'バイパス戻り水 {flow} g/s'],
  '饱和蒸汽 {flow} g/s': ['Saturated steam {flow} g/s', '飽和蒸気 {flow} g/s'],
  '通风 {flow} g/s': ['Blower {flow} g/s', 'ブロワー {flow} g/s'],
  '排汽 {flow} g/s': ['Exhaust {flow} g/s', '排気 {flow} g/s'],
  '酒精 {flow} mL/min': ['Alcohol {flow} mL/min', 'アルコール {flow} mL/min'],
  '传给水 {power} W': ['To water {power} W', '水への伝熱 {power} W'],
};

function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'ja' || value === 'en';
}

function initialLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* Storage may be blocked, unavailable, or full. */ }
  // Keep the original Chinese default; choosing a language explicitly persists it when possible.
  return 'zh-CN';
}

let locale: Locale = initialLocale();
const listeners = new Set<(locale: Locale) => void>();

function updateDocumentLanguage(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
updateDocumentLanguage();

export function getLocale(): Locale {
  return locale;
}

/** Invalid locales are ignored. Changing language never changes simulation or control state. */
export function setLocale(next: string): void {
  if (!isLocale(next)) return;
  const changed = locale !== next;
  locale = next;
  updateDocumentLanguage();
  try { globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* In-memory switching still works. */ }
  if (changed) for (const listener of listeners) listener(locale);
}

/** Subscribe to later changes; returns an unsubscribe function. */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type TranslationValues = Readonly<Record<string, string | number | null | undefined>>;

/** Exact source-key lookup; unknown text and missing/nullish values keep their original spelling. */
export function t(source: string, values?: TranslationValues): string {
  const translated = locale === 'zh-CN' || !Object.hasOwn(TRANSLATIONS, source)
    ? source
    : TRANSLATIONS[source][locale === 'en' ? 0 : 1];
  // Plain text, not HTML escaping. A single callback pass keeps $, markup and nested tokens literal.
  return translated.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values && Object.hasOwn(values, key) ? values[key] : undefined;
    return value === null || value === undefined ? match : String(value);
  });
}

/** Bind only explicitly marked static text nodes/attributes, never replacing embedded controls. */
export function bindStaticText(root: ParentNode): () => void {
  const bindings: (() => void)[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue;
      const original = node.textContent;
      const source = original.trim();
      const start = original.indexOf(source);
      bindings.push(() => { node.textContent = original.slice(0, start) + t(source) + original.slice(start + source.length); });
    }
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attrs]')) {
    for (const attr of el.dataset.i18nAttrs!.split(/\s+/).filter(Boolean)) {
      const source = el.getAttribute(attr);
      if (source !== null) bindings.push(() => el.setAttribute(attr, t(source)));
    }
  }
  const refresh = () => { for (const binding of bindings) binding(); };
  refresh();
  return onLocaleChange(refresh);
}