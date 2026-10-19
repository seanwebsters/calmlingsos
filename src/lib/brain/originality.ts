/**
 * Originality screen: flags resemblance to well-known protected properties in
 * concept titles, character names and loglines. Deterministic and
 * conservative – a hit routes the idea to human review with the reason
 * attached. This is a screen, not legal clearance.
 * Adapted from the WEBSTER engine (seanwebsters/ipgenerator).
 */
const PROTECTED = [
  "Mickey Mouse", "Minnie Mouse", "Donald Duck", "Goofy", "Harry Potter", "Hogwarts", "Pokemon", "Pokémon", "Pikachu",
  "Star Wars", "Jedi", "Darth Vader", "Marvel", "Avengers", "Spider-Man", "Spiderman", "Batman", "Superman",
  "Wonder Woman", "Frozen", "Elsa", "Olaf", "Shrek", "Minions", "Toy Story", "Buzz Lightyear", "Bluey",
  "Peppa Pig", "Paw Patrol", "Sonic the Hedgehog", "Super Mario", "Zelda", "Gandalf", "Hobbit",
  "Narnia", "Totoro", "Ghibli", "Transformers", "Barbie", "Hello Kitty", "SpongeBob", "Simpsons", "Moana", "Encanto",
  "Kung Fu Panda", "Dragon Ball", "Naruto", "One Piece", "Stranger Things", "Game of Thrones",
  "Winnie the Pooh", "Paddington", "Gruffalo", "Teenage Mutant Ninja Turtles", "My Little Pony", "Care Bears", "Smurfs",
  "Lord of the Rings", "Mandalorian", "Groot", "Stitch", "Simba", "Lion King", "Little Mermaid", "Cinderella", "Rapunzel",
  "Inside Out", "Despicable Me", "How to Train Your Dragon", "Toothless", "Adventure Time", "Gravity Falls",
  "Fortnite", "Minecraft", "Roblox", "Among Us", "Animal Crossing", "Kirby", "Yoshi", "Luigi", "Squishmallows",
  "Jellycat", "Labubu", "Sanrio", "Kuromi", "Cinnamoroll", "Pusheen", "Molang", "Sumikko Gurashi", "Rilakkuma",
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export interface ResemblanceFlag {
  field: string;
  text: string;
  matches: string;
  kind: "contains" | "similar";
  similarity: number;
}

export function screenOriginality(fields: { field: string; text: string; isName?: boolean }[]): ResemblanceFlag[] {
  const flags: ResemblanceFlag[] = [];
  for (const { field, text, isName } of fields) {
    const t = ` ${norm(text)} `;
    for (const p of PROTECTED) {
      const n = norm(p);
      if (t.includes(` ${n} `)) {
        flags.push({ field, text, matches: p, kind: "contains", similarity: 1 });
        continue;
      }
      if (isName && n.length >= 4) {
        const a = norm(text);
        const sim = 1 - levenshtein(a, n) / Math.max(a.length, n.length);
        if (sim >= (n.length >= 6 ? 0.75 : 0.8)) flags.push({ field, text, matches: p, kind: "similar", similarity: Number(sim.toFixed(2)) });
      }
    }
  }
  return flags;
}
