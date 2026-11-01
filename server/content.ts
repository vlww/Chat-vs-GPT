// Static game content: codenames, prompts, personas and the scripted fallback lines.

export const codenames = ['lucky', 'velvet', 'ace', 'smokey', 'duke', 'dice', 'mink', 'tommy', 'sal', 'knuckles'];
export const seatColors = ['#b5484b', '#8fb3c9', '#e8b04a', '#ff8a3d', '#e9e2cf', '#3fa37a', '#c97b45', '#c9748f'];

export const prompts = [
  'What did you eat today? Be specific.',
  'Describe the room you are sitting in right now.',
  'What is your most controversial snack opinion?',
  'Tell the room about the worst Wi-Fi moment of your life.',
  'What was the last thing that made you actually laugh?',
  'Which game have you sunk way too many hours into?',
  'What time is it where you are, and what should you be doing instead?',
  'Rate pineapple on pizza out of 10 and defend it.',
  'What is something you are bad at but still enjoy?',
  'Describe your morning in exactly one sentence.',
  'What is the weirdest thing in your search history this week?',
  'Which emote describes your week and why?',
  'What was your first username ever?',
  'Name a song stuck in your head right now.',
  'What would you do with a free day tomorrow?',
  'What chore do you avoid the longest?',
  'Tell us one lie and one truth about yourself.',
  'What is the last thing you bought online?',
];

export const personalities = ['The Confident One', 'The People Pleaser', 'The Quiet One', 'The Conspiracy Theorist', 'The Joker', 'The Detective'];
export const objectives = [
  'Get {target} unmasked this round',
  'Never be the most-voted suspect',
  'Be the first to accuse someone',
  'Get two humans to suspect each other',
  'Convince the room that {target} is the AI',
];

// Demo "humans": LLM-driven players with distinct typing habits.
export const demoHumans = [
  { login: 'tofu_bandit', style: 'chill, all lowercase, very short replies, says "lmao" and "nah", makes a typo now and then' },
  { login: 'gremlin_gwen', style: 'chaotic and loud, accuses people fast, occasional ALL CAPS word, uses emotes like KEKW or LUL' },
  { login: 'sixtyfps', style: 'analytical gamer, points out patterns like "that answer was way too polished", lowercase, no punctuation' },
  { login: 'couchcaptain', style: 'wholesome and a bit defensive, mentions real-life details like their dog or night shift, rambles slightly' },
  { login: 'mildlyhaunted', style: 'sarcastic one-liners, dry humor, answers questions with a question sometimes' },
];

export const juryNames = ['pixelpanda', 'xXbreadXx', 'lurkmode', 'cozycrab', 'rngesus', 'modsasleep', 'chairgang', 'saltysalmon', 'byteme_', 'ggnore', 'potatoaim', 'snackattack'];
export const juryLines = [
  '{x} is typing way too clean', '{x} is SO gpt', 'nah {x} is human, that was unhinged', 'KEKW', 'LUL', 'the {x} answer was sus',
  'who gives {x} that much confidence', 'trust nobody', 'i was wrong about {x}', '{x} hasnt said anything real yet', 'Pog', 'this is so tense',
  '{x} answered like a wikipedia page', 'clocked {x} already', 'its {x}. i will not elaborate',
];
export const juryAsks = [
  'what is 17 x 3 no calculator', 'name a vegetable you hate', 'whats the weather where you are', 'describe your chair',
  'say something only a human would say', 'last song you listened to?', 'what are you wearing rn', 'what time is it for you',
  'favorite twitch emote and why', 'who in the room do you trust least',
];

// Scripted lines for when no model key is configured. Shared by every bot seat so they stay indistinguishable.
export const fallbackLines = [
  'idk man', '{x} has been quiet way too long', 'who types full sentences in twitch chat lol', 'im literally eating cereal rn',
  '{x} that answer was sus', 'nah i trust {y}', 'voting {x} no hesitation', 'wait what was the question', 'ok but why is {x} so calm',
  'i forgot to eat lunch honestly', 'my room is a mess dont ask', 'lmao {x} what', 'thats exactly what gpt would say {x}',
  'i need {y} to explain themselves', 'im human i promise, my cat just walked on my keyboard', 'this is stressful',
];

// Scripted answers to each room prompt, so keyless rounds still stay on topic.
export const promptAnswers: Record<string, string[]> = {
  'What did you eat today? Be specific.': ['two eggos and a sad banana', 'leftover pad thai cold out of the fridge', 'nothing yet its 3pm help', 'a gas station burrito i regret'],
  'Describe the room you are sitting in right now.': ['bed unmade, 4 cups on my desk, rgb on purple', 'my kitchen table bc my desk is covered in laundry', 'tiny room, one window, fan rattling', 'posters falling off the wall and a cat on my keyboard'],
  'What is your most controversial snack opinion?': ['plain rice cakes are elite', 'pickles in a milkshake slaps', 'gummy bears are better frozen', 'chips are better stale. fight me'],
  'Tell the room about the worst Wi-Fi moment of your life.': ['lagged out of a ranked final at match point', 'router died mid zoom interview', 'had to play on hotel wifi at 12 ping... 1200 ping', 'my brother unplugged it to charge his phone'],
  'What was the last thing that made you actually laugh?': ['my dog sneezed so hard he fell over', 'a guy in my lobby named himself "mom"', 'my friend tried to parallel park for 10 min', 'a clip of a cat knocking a cake off a table'],
  'Which game have you sunk way too many hours into?': ['minecraft, like 2k hours easy', 'stardew. dont ask how many years', 'league and i hate it', 'rocket league, still plat'],
  'What time is it where you are, and what should you be doing instead?': ['almost 2am, i have class at 8', '11pm, should be doing dishes', 'lunch break, should be working lol', 'its 4pm and i have an essay due tonight'],
  'Rate pineapple on pizza out of 10 and defend it.': ['8, sweet and salty is the whole point', '2. fruit does not belong on bread', '10 with jalapenos no debate', '6 its fine people are dramatic'],
  'What is something you are bad at but still enjoy?': ['bowling, i average like 80', 'singing in the car', 'cooking, i set off the alarm weekly', 'chess, i blunder my queen every game'],
  'Describe your morning in exactly one sentence.': ['snoozed 4 times then ran for the bus', 'coffee spilled on my only clean hoodie', 'woke up at noon so technically no morning', 'fed the cat, forgot to feed myself'],
  'What is the weirdest thing in your search history this week?': ['can ducks get sunburned', 'how long can a potato last', 'is it illegal to own a raccoon', 'why does my fridge hum at night'],
  'Which emote describes your week and why?': ['Sadge. car broke down tuesday', 'KEKW bc everything went wrong in a funny way', 'Pog i finally got the job', 'monkaS exams'],
  'What was your first username ever?': ['xXdragonslayerXx no shame', 'cheesepuff2009', 'my real name plus 123 lol', 'something with "ninja" in it i was 9'],
  'Name a song stuck in your head right now.': ['the subway surfers theme somehow', 'some taylor swift song my sister plays', 'a jingle from a mattress ad', 'the lofi beat from my study playlist'],
  'What would you do with a free day tomorrow?': ['sleep till 1 then get tacos', 'grind ranked all day', 'go to the beach and not touch my phone', 'clean my room finally. jk play games'],
  'What chore do you avoid the longest?': ['folding laundry, it lives in a chair', 'taking out recycling', 'cleaning the bathroom', 'unloading the dishwasher'],
  'Tell us one lie and one truth about yourself.': ['i have 3 cats and i hate pizza', 'i broke my arm skating and i speak 5 languages', 'ive met a celebrity and i cant swim', 'i was born in a taxi and i love spiders'],
  'What is the last thing you bought online?': ['a new phone case after i cracked mine', 'cat food in bulk', 'a mousepad the size of my desk', 'socks. 12 pack. very exciting'],
};

// GPT's typing voice for a game, drawn from the same kind of habits as the demo humans.
export const impostorStyles = [
  'terse, all lowercase, rarely more than a few words, no punctuation',
  'excitable, uses "LMAO" and "bro", sometimes doubles letters like "noooo"',
  'deadpan and dry, short lines, occasional "ok" or "sure" on its own',
  'chatty but sloppy, run-on thoughts, forgets capitals, says "like" a lot',
  'suspicious of everyone, asks people direct questions, short and blunt',
];

// Per-turn length targets, weighted toward short, so lines vary like real chat.
export const lengthHints = [
  'one to three words only, like "lol same", "nah" or "wait what"',
  'one to three words only, a quick reaction',
  'a short fragment, three to six words',
  'a short fragment, three to six words',
  'one casual sentence, six to twelve words',
  'a quick question to one specific suspect, under eight words',
];
