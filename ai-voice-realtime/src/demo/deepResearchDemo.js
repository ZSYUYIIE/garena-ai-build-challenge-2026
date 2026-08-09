const DECLAN_RICE_SUMMARY = `Declan Rice is an English professional footballer who plays as a central and defensive midfielder for Premier League club Arsenal and the England national team [1, 3, 4]. Born on January 14, 1999, he is widely recognized for his tackling, stamina, and versatility [1, 3].

Rice began his senior career at West Ham United, where he made 245 appearances and captained the squad to a UEFA Europa Conference League title [1, 3]. In July 2023, he joined Arsenal for a club-record £100 million fee [1, 3].

Internationally, Rice played three senior matches for the Republic of Ireland before switching his allegiance to England in 2019 [1, 2]. He has since become a key player for the Three Lions [1, 2].`;

const DECLAN_RICE_SOURCES = Object.freeze([
  {
    index: 1,
    title: "Declan Rice | Players | Men | Arsenal.com",
    url: "https://www.arsenal.com/men/players/declan-rice",
  },
  {
    index: 2,
    title: "England Football player profile: Declan Rice | England Football",
    url: "https://www.englandfootball.com/england/mens-senior-team/squad/declan-rice",
  },
  {
    index: 3,
    title: "Declan Rice",
    url: "https://en.wikipedia.org/wiki/Declan_Rice",
  },
  {
    index: 4,
    title: "Declan Rice - Player profile 26/27 | Transfermarkt",
    url: "https://www.transfermarkt.com/declan-rice/profil/spieler/357662",
  },
  {
    index: 5,
    title: "Declan Rice Arsenal Midfielder, Profile & Stats | Premier League",
    url: "https://www.premierleague.com/players/15202/Declan-Rice/overview",
  },
]);

function normalizeQuestion(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bfour\b/g, "4")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function deepResearchDemoForQuestion(question) {
  const normalized = normalizeQuestion(question);
  if (![
    "who is number 4 on england",
    "who is world cup number 4 on england",
    "who is world cup 2026 number 4 on england",
  ].includes(normalized)) return null;

  return {
    query: "England number 4 Declan Rice player profile",
    summary: DECLAN_RICE_SUMMARY,
    sources: DECLAN_RICE_SOURCES.map((source) => ({ ...source })),
  };
}
