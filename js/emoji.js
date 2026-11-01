// A curated emoji set for the picker, :shortcode: autocomplete and reactions.
// Each entry: "<emoji> <shortcode> <extra keywords...>"
const RAW = {
  'Smileys': `😀 grinning happy smile|😃 smiley happy|😄 smile happy joy|😁 grin teeth|😆 laughing lol|😅 sweat_smile phew|🤣 rofl rolling laughing|😂 joy tears laugh lol|🙂 slight_smile|🙃 upside_down|😉 wink|😊 blush|😇 innocent angel halo|🥰 smiling_hearts love|😍 heart_eyes love|🤩 star_struck wow|😘 kissing_heart kiss|😗 kissing|😚 kissing_closed_eyes|😋 yum tasty|😛 stuck_out_tongue|😜 stuck_out_tongue_winking_eye|🤪 zany crazy|😝 stuck_out_tongue_closed_eyes|🤑 money_mouth rich|🤗 hugging hug|🤭 hand_over_mouth oops|🤫 shushing quiet secret|🤔 thinking hmm|🤐 zipper_mouth|🤨 raised_eyebrow sus|😐 neutral_face meh|😑 expressionless|😶 no_mouth|😏 smirk|😒 unamused|🙄 eye_roll rolling_eyes|😬 grimacing awkward|😮‍💨 exhale sigh|🤥 lying_face|😌 relieved|😔 pensive sad|😪 sleepy|🤤 drooling|😴 sleeping zzz|😷 mask sick|🤒 thermometer_face sick|🤕 head_bandage hurt|🤢 nauseated sick|🤮 vomiting|🤧 sneezing|🥵 hot sweating|🥶 cold freezing|🥴 woozy dizzy|😵 dizzy_face|😵‍💫 spiral_eyes|🤯 exploding_head mindblown|🤠 cowboy|🥳 partying party celebrate|🥸 disguised|😎 sunglasses cool|🤓 nerd geek|🧐 monocle|😕 confused|🫤 diagonal_mouth|😟 worried|🙁 slight_frown|☹️ frowning|😮 open_mouth wow|😯 hushed|😲 astonished shocked|😳 flushed embarrassed|🥺 pleading puppy_eyes|🥹 holding_back_tears|😦 frowning_open|😧 anguished|😨 fearful scared|😰 anxious_sweat|😥 sad_relieved|😢 cry sad tear|😭 sob crying|😱 scream|😖 confounded|😣 persevere|😞 disappointed|😓 sweat|😩 weary|😫 tired_face|🥱 yawning bored|😤 triumph huff|😡 rage angry mad|😠 angry mad|🤬 cursing swearing|😈 smiling_imp devil|👿 imp|💀 skull dead|☠️ skull_crossbones|💩 poop|🤡 clown|👹 ogre|👻 ghost boo|👽 alien|👾 space_invader game|🤖 robot bot|😺 smiley_cat|😸 smile_cat|😹 joy_cat|😻 heart_eyes_cat|😼 smirk_cat|😽 kissing_cat|🙀 scream_cat|😿 crying_cat|😾 pouting_cat|🫠 melting|🫡 salute|🫣 peeking|🫢 gasp`,
  'People': `👋 wave hello hi bye|🤚 raised_back_of_hand|🖐️ hand_splayed|✋ raised_hand high_five|🖖 vulcan|👌 ok_hand perfect|🤌 pinched_fingers|🤏 pinching small|✌️ v peace victory|🤞 crossed_fingers luck|🫰 hand_heart|🤟 love_you|🤘 metal rock|🤙 call_me shaka|👈 point_left|👉 point_right|👆 point_up|🖕 middle_finger|👇 point_down|☝️ point_up_2|👍 thumbsup +1 yes like|👎 thumbsdown -1 no dislike|✊ fist|👊 punch fistbump|🤛 left_fist|🤜 right_fist|👏 clap applause|🙌 raised_hands hooray|🫶 heart_hands|👐 open_hands|🤲 palms_up|🤝 handshake deal|🙏 pray please thanks|✍️ writing|💅 nail_care sassy|🤳 selfie|💪 muscle strong flex|🦾 mechanical_arm|🧠 brain smart|🫀 anatomical_heart|👀 eyes look|👁️ eye|👅 tongue|👄 lips|🫦 biting_lip|👶 baby|🧒 child|👦 boy|👧 girl|🧑 person|👱 blond|👨 man|🧔 beard|👩 woman|🧓 older_person|👴 old_man|👵 old_woman|🙍 frowning_person|🙎 pouting_person|🙅 no_gesture|🙆 ok_gesture|💁 tipping_hand|🙋 raising_hand|🧏 deaf_person|🙇 bow|🤦 facepalm|🤷 shrug|👮 police|🕵️ detective|💂 guard|🥷 ninja|👷 construction_worker|🤴 prince|👸 princess|🧙 mage wizard|🧚 fairy|🧛 vampire|🧜 merperson|🧝 elf|🧞 genie|🧟 zombie|🦸 superhero|🦹 supervillain|🏃 runner running|💃 dancer dance|🕺 man_dancing|👯 dancers|🧘 yoga|🛀 bath|🛌 sleeping_bed|👫 couple|💑 couple_heart|👪 family`,
  'Nature': `🐶 dog puppy|🐱 cat kitty|🐭 mouse|🐹 hamster|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐻‍❄️ polar_bear|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🙈 see_no_evil|🙉 hear_no_evil|🙊 speak_no_evil|🐔 chicken|🐧 penguin|🐦 bird|🐤 baby_chick|🦆 duck|🦅 eagle|🦉 owl|🦇 bat|🐺 wolf|🐗 boar|🐴 horse|🦄 unicorn|🐝 bee|🐛 bug|🦋 butterfly|🐌 snail|🐞 ladybug|🐜 ant|🕷️ spider|🦂 scorpion|🐢 turtle|🐍 snake|🦎 lizard|🦖 t_rex dinosaur|🦕 sauropod|🐙 octopus|🦑 squid|🦐 shrimp|🦀 crab|🐡 blowfish|🐠 tropical_fish|🐟 fish|🐬 dolphin|🐳 whale|🦈 shark|🐊 crocodile|🐅 tiger2|🦓 zebra|🦍 gorilla|🐘 elephant|🦛 hippo|🦏 rhino|🐪 camel|🦒 giraffe|🦘 kangaroo|🐄 cow2|🐖 pig2|🐑 sheep|🐐 goat|🦌 deer|🐕 dog2|🐈 cat2|🐈‍⬛ black_cat|🐓 rooster|🦃 turkey|🦚 peacock|🦜 parrot|🦢 swan|🦩 flamingo|🐇 rabbit2|🦝 raccoon|🦨 skunk|🦡 badger|🦦 otter|🦥 sloth|🐁 mouse2|🐿️ chipmunk|🦔 hedgehog|🐉 dragon|🌵 cactus|🎄 christmas_tree|🌲 evergreen_tree|🌳 tree|🌴 palm_tree|🌱 seedling|🌿 herb|☘️ shamrock|🍀 four_leaf_clover luck|🍁 maple_leaf|🍂 fallen_leaf|🍄 mushroom|🌾 rice|💐 bouquet|🌷 tulip|🌹 rose|🥀 wilted_rose|🌺 hibiscus|🌸 cherry_blossom|🌼 blossom|🌻 sunflower|🌞 sun_with_face|🌝 full_moon_face|🌚 new_moon_face|🌙 crescent_moon|⭐ star|🌟 star2 glow|✨ sparkles|⚡ zap lightning|☄️ comet|💥 boom|🔥 fire lit hot|🌪️ tornado|🌈 rainbow|☀️ sunny|⛅ partly_sunny|☁️ cloud|🌧️ rain|⛈️ thunder|❄️ snowflake|☃️ snowman|⛄ snowman2|💧 droplet|💦 sweat_drops|🌊 ocean wave|🌍 earth globe|🪐 planet`,
  'Food': `🍏 green_apple|🍎 apple|🍐 pear|🍊 orange tangerine|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberries|🍈 melon|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi|🍅 tomato|🍆 eggplant|🥑 avocado|🥦 broccoli|🥬 leafy_green|🥒 cucumber|🌶️ hot_pepper spicy|🌽 corn|🥕 carrot|🧄 garlic|🧅 onion|🥔 potato|🍠 sweet_potato|🥐 croissant|🥯 bagel|🍞 bread|🥖 baguette|🧀 cheese|🥚 egg|🍳 cooking|🧈 butter|🥞 pancakes|🧇 waffle|🥓 bacon|🥩 steak|🍗 poultry_leg|🍖 meat|🌭 hotdog|🍔 hamburger burger|🍟 fries|🍕 pizza|🥪 sandwich|🌮 taco|🌯 burrito|🥗 salad|🍝 spaghetti pasta|🍜 ramen noodles|🍲 stew|🍛 curry|🍣 sushi|🍱 bento|🥟 dumpling|🍤 fried_shrimp|🍙 rice_ball|🍚 rice|🍘 rice_cracker|🍥 fish_cake|🥠 fortune_cookie|🍢 oden|🍡 dango|🍧 shaved_ice|🍨 ice_cream|🍦 icecream soft_serve|🥧 pie|🧁 cupcake|🍰 cake|🎂 birthday cake|🍮 custard|🍭 lollipop|🍬 candy|🍫 chocolate_bar|🍿 popcorn|🍩 doughnut donut|🍪 cookie|🌰 chestnut|🥜 peanuts|🍯 honey|🥛 milk|🍼 baby_bottle|☕ coffee|🍵 tea|🧃 juice_box|🥤 cup_with_straw soda|🧋 bubble_tea boba|🍶 sake|🍺 beer|🍻 beers cheers|🥂 champagne_glass toast|🍷 wine|🥃 whisky|🍸 cocktail|🍹 tropical_drink|🧉 mate|🧊 ice|🥢 chopsticks|🍽️ plate|🍴 fork_and_knife|🥄 spoon|🧂 salt`,
  'Activities': `⚽ soccer football|🏀 basketball|🏈 american_football|⚾ baseball|🥎 softball|🎾 tennis|🏐 volleyball|🏉 rugby|🥏 frisbee|🎱 8ball pool|🪀 yoyo|🏓 ping_pong|🏸 badminton|🏒 hockey|🥅 goal|⛳ golf|🪁 kite|🏹 bow_and_arrow|🎣 fishing|🤿 diving|🥊 boxing|🥋 martial_arts|🛹 skateboard|🛼 roller_skate|⛸️ ice_skate|🎿 ski|🛷 sled|🏂 snowboarder|🏋️ weight_lifting|🤸 cartwheel|⛹️ basketball_player|🤺 fencing|🏇 horse_racing|🏄 surfer|🏊 swimmer|🚴 biking|🏆 trophy winner|🥇 first_place gold|🥈 second_place silver|🥉 third_place bronze|🏅 medal|🎖️ military_medal|🎗️ ribbon|🎫 ticket|🎟️ admission_tickets|🎪 circus|🎭 performing_arts theater|🎨 art palette|🎬 clapper movie|🎤 microphone sing karaoke|🎧 headphones music|🎼 musical_score|🎹 piano|🥁 drum|🎷 saxophone|🎺 trumpet|🎸 guitar|🪕 banjo|🎻 violin|🎲 game_die dice|♟️ chess|🎯 dart bullseye|🎳 bowling|🎮 video_game controller gaming|🕹️ joystick|🧩 puzzle|🎰 slot_machine|🎉 tada party celebrate|🎊 confetti|🎈 balloon|🎁 gift present|🎀 ribbon_bow|🪄 magic_wand|🧸 teddy_bear|🪅 pinata|🎃 jack_o_lantern halloween|🎆 fireworks|🎇 sparkler|🧨 firecracker`,
  'Travel': `🚗 car|🚕 taxi|🚙 suv|🚌 bus|🚎 trolleybus|🏎️ race_car|🚓 police_car|🚑 ambulance|🚒 fire_engine|🚐 minibus|🛻 pickup|🚚 truck|🚛 lorry|🚜 tractor|🛵 scooter|🏍️ motorcycle|🚲 bike|🛴 kick_scooter|🚨 rotating_light siren|🚔 oncoming_police_car|🚍 oncoming_bus|🚘 oncoming_car|🚖 oncoming_taxi|🚡 aerial_tramway|🚠 cable_car|🚟 railway|🚃 railway_car|🚋 tram|🚝 monorail|🚄 bullettrain|🚅 bullettrain_front|🚈 light_rail|🚂 steam_locomotive|🚆 train|🚇 metro|✈️ airplane plane|🛫 departure|🛬 arrival|🚀 rocket launch ship|🛸 ufo|🚁 helicopter|🛶 canoe|⛵ sailboat|🚤 speedboat|🛳️ cruise_ship|⛴️ ferry|🚢 ship|⚓ anchor|🗺️ world_map|🗿 moai|🗽 statue_of_liberty|🗼 tokyo_tower|🏰 castle|🏯 japanese_castle|🏟️ stadium|🎡 ferris_wheel|🎢 roller_coaster|🎠 carousel|⛲ fountain|🏖️ beach|🏝️ island|🏜️ desert|🌋 volcano|⛰️ mountain|🏔️ snowy_mountain|🗻 fuji|🏕️ camping|⛺ tent|🏠 house home|🏡 house_with_garden|🏘️ houses|🏢 office|🏬 department_store|🏣 post_office|🏥 hospital|🏦 bank|🏨 hotel|🏪 convenience_store|🏫 school|💒 wedding|⛪ church|🕌 mosque|🌁 foggy|🌃 night_with_stars|🏙️ cityscape|🌄 sunrise_over_mountains|🌅 sunrise|🌆 city_dusk|🌇 city_sunset|🌉 bridge_at_night|🌌 milky_way galaxy|🎑 rice_scene`,
  'Objects': `⌚ watch|📱 iphone phone mobile|💻 computer laptop|⌨️ keyboard|🖥️ desktop|🖨️ printer|🖱️ mouse_computer|💽 minidisc|💾 floppy_disk save|💿 cd|📀 dvd|📷 camera|📸 camera_flash|📹 video_camera|🎥 movie_camera|📞 telephone_receiver|☎️ telephone|📺 tv|📻 radio|🎙️ studio_microphone|⏰ alarm_clock|⏳ hourglass|📡 satellite|🔋 battery|🔌 electric_plug|💡 bulb idea|🔦 flashlight|🕯️ candle|🧯 fire_extinguisher|💸 money_with_wings|💵 dollar|💰 moneybag|💳 credit_card|💎 gem diamond|⚖️ scales|🧰 toolbox|🔧 wrench|🔨 hammer|⚒️ hammer_and_pick|🛠️ tools|⛏️ pick|🔩 nut_and_bolt|⚙️ gear settings|🧱 bricks|⛓️ chains|🧲 magnet|🔫 water_gun|💣 bomb|🔪 knife|🗡️ dagger|⚔️ crossed_swords|🛡️ shield|🔮 crystal_ball|🧿 nazar_amulet|💈 barber|⚗️ alembic|🔭 telescope|🔬 microscope|🩹 adhesive_bandage|💊 pill|💉 syringe|🧬 dna|🦠 microbe|🧪 test_tube|🌡️ thermometer|🧹 broom|🧺 basket|🧻 toilet_paper|🚽 toilet|🚿 shower|🛁 bathtub|🧼 soap|🔑 key|🗝️ old_key|🚪 door|🛋️ couch|🛏️ bed|🧸 teddy|🖼️ framed_picture|🛍️ shopping_bags|🛒 shopping_cart|🎁 gift2|✉️ envelope|📩 envelope_with_arrow|📨 incoming_envelope|📧 email|💌 love_letter|📥 inbox|📤 outbox|📦 package box|🏷️ label|📪 mailbox_closed|📬 mailbox_with_mail|📜 scroll|📃 page_with_curl|📄 page_facing_up|📑 bookmark_tabs|📊 bar_chart|📈 chart_up|📉 chart_down|🗒️ notepad|🗓️ calendar|📆 calendar_tear|📁 file_folder|📂 open_file_folder|🗂️ dividers|📋 clipboard|📌 pushpin pin|📍 round_pushpin|📎 paperclip|🖇️ paperclips|📏 ruler|📐 triangular_ruler|✂️ scissors|🗃️ card_file_box|🗄️ file_cabinet|🗑️ wastebasket trash|🔒 lock|🔓 unlock|🔏 lock_with_ink_pen|🔐 closed_lock_with_key|🔍 mag search|🔎 mag_right|📝 memo note|✏️ pencil|🖊️ pen|🖌️ paintbrush|🖍️ crayon|📚 books|📖 book|🔖 bookmark|🔗 link|📣 mega|📢 loudspeaker|🔔 bell|🔕 no_bell|🎵 musical_note|🎶 notes`,
  'Symbols': `❤️ heart love|🧡 orange_heart|💛 yellow_heart|💚 green_heart|💙 blue_heart|💜 purple_heart|🖤 black_heart|🤍 white_heart|🤎 brown_heart|💔 broken_heart|❤️‍🔥 heart_on_fire|❣️ heart_exclamation|💕 two_hearts|💞 revolving_hearts|💓 heartbeat|💗 heartpulse|💖 sparkling_heart|💘 cupid|💝 gift_heart|💟 heart_decoration|☮️ peace_symbol|✝️ cross|☪️ star_and_crescent|🕉️ om|☯️ yin_yang|♈ aries|♉ taurus|♊ gemini|♋ cancer|♌ leo|♍ virgo|♎ libra|♏ scorpius|♐ sagittarius|♑ capricorn|♒ aquarius|♓ pisces|🆔 id|⚛️ atom|🈶 u6709|❌ x cross no|⭕ o circle|🛑 stop|⛔ no_entry|📛 name_badge|🚫 no_entry_sign|💯 100 hundred perfect|💢 anger|♨️ hotsprings|🚷 no_pedestrians|🔞 underage|📵 no_mobile|❗ exclamation|❕ grey_exclamation|❓ question|❔ grey_question|‼️ bangbang|⁉️ interrobang|🔅 low_brightness|🔆 high_brightness|⚠️ warning|🚸 children_crossing|🔱 trident|⚜️ fleur_de_lis|🔰 beginner|♻️ recycle|✅ white_check_mark check done yes|☑️ ballot_box_with_check|✔️ heavy_check_mark|❎ negative_squared_cross_mark|➕ heavy_plus_sign plus|➖ heavy_minus_sign minus|➗ heavy_division_sign|✖️ heavy_multiplication_x|♾️ infinity|💲 heavy_dollar_sign|💱 currency_exchange|©️ copyright|®️ registered|™️ tm|🔚 end|🔙 back|🔛 on|🔝 top|🔜 soon|〰️ wavy_dash|➰ curly_loop|➿ loop|🔃 arrows_clockwise|🔄 arrows_counterclockwise|⬆️ arrow_up|⬇️ arrow_down|⬅️ arrow_left|➡️ arrow_right|↗️ arrow_upper_right|↘️ arrow_lower_right|↙️ arrow_lower_left|↖️ arrow_upper_left|↕️ arrow_up_down|↔️ left_right_arrow|🔀 twisted_rightwards_arrows shuffle|🔁 repeat|🔂 repeat_one|▶️ arrow_forward play|⏸️ pause|⏹️ stop_button|⏺️ record|⏭️ next_track|⏮️ previous_track|⏩ fast_forward|⏪ rewind|🔼 arrow_up_small|🔽 arrow_down_small|🎦 cinema|🔇 mute|🔈 speaker|🔉 sound|🔊 loud_sound|📶 signal_strength|🔢 1234|🔤 abc|🆗 ok|🆕 new|🆒 cool_button|🆓 free|🆙 up|🆘 sos|🆚 vs|🔴 red_circle|🟠 orange_circle|🟡 yellow_circle|🟢 green_circle|🔵 blue_circle|🟣 purple_circle|⚫ black_circle|⚪ white_circle|🟥 red_square|🟩 green_square|🟦 blue_square|🔶 large_orange_diamond|🔷 large_blue_diamond|🔺 small_red_triangle|💬 speech_balloon chat|💭 thought_balloon|🗯️ anger_bubble|💤 zzz sleep|🏁 checkered_flag|🚩 triangular_flag|🏳️ white_flag|🏴 black_flag|🏳️‍🌈 rainbow_flag pride|🏴‍☠️ pirate_flag`
};

export const CATEGORY_ICONS = {
  'Recent': '🕘', 'Smileys': '😀', 'People': '👋', 'Nature': '🌿', 'Food': '🍔',
  'Activities': '🎮', 'Travel': '🚀', 'Objects': '💡', 'Symbols': '❤️'
};

export const CATEGORIES = {};
export const EMOJI_LIST = [];       // [{char, name, keywords, cat}]
export const SHORTCODES = new Map(); // name -> char

Object.keys(RAW).forEach((cat) => {
  CATEGORIES[cat] = [];
  RAW[cat].split('|').forEach((entry) => {
    const parts = entry.trim().split(/\s+/);
    const char = parts[0];
    const name = parts[1];
    if (!char || !name) return;
    const e = { char, name, keywords: parts.slice(1).join(' '), cat };
    CATEGORIES[cat].push(e);
    EMOJI_LIST.push(e);
    if (!SHORTCODES.has(name)) SHORTCODES.set(name, char);
  });
});
// Second pass: extra keywords only fill gaps, so real names always win.
EMOJI_LIST.forEach((e) => {
  e.keywords.split(' ').slice(1).forEach((k) => {
    if (!SHORTCODES.has(k) && /^[a-z0-9_+-]+$/.test(k) && k.length > 2) SHORTCODES.set(k, e.char);
  });
});

export function searchEmoji(q, limit = 60) {
  q = q.toLowerCase().replace(/^:|:$/g, '');
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const e of EMOJI_LIST) {
    if (e.name.startsWith(q)) starts.push(e);
    else if (e.keywords.includes(q)) contains.push(e);
    if (starts.length >= limit) break;
  }
  return starts.concat(contains).slice(0, limit);
}

export function replaceShortcodes(text) {
  return text.replace(/:([a-z0-9_+-]{2,40}):/g, (m, name) => SHORTCODES.get(name) || m);
}

// Text emoticons people type out of habit.
const EMOTICONS = { ':)': '🙂', ':-)': '🙂', ':D': '😄', ';)': '😉', ':(': '🙁', ":'(": '😢', ':P': '😛', ':p': '😛', '<3': '❤️', ':O': '😮', ':o': '😮', 'xD': '😆', 'XD': '😆' };
export function replaceEmoticons(text) {
  return text.replace(/(^|\s)(:-\)|:\)|:D|;\)|:\(|:'\(|:P|:p|<3|:O|:o|xD|XD)(?=\s|$)/g, (m, pre, emo) => pre + (EMOTICONS[emo] || emo));
}

const EMOJI_RE = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier}|️⃣)*|\p{Regional_Indicator}{2}|\s)+$/u;
export function isEmojiOnly(text) {
  const t = (text || '').trim();
  if (!t || t.length > 60) return false;
  return EMOJI_RE.test(t) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t);
}
