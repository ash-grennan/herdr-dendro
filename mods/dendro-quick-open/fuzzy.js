// Fuzzy matching for the quick-open popups (dendro-quick-open, dendro-switcher).

// How well a query word matches a path: -1 for no match, more is better. Letters must appear in
// order; a match inside the file name beats one spread over folders, and runs of letters, letters
// at the start of a word (after / . _ - or a capital) and shorter paths score higher.
export function wordScore(word, path, lower, baseAt) {
  const walk = (from) => {
    let at = 0, score = 0, prev = -2;
    for (let i = from; i < lower.length && at < word.length; i++) {
      if (lower[i] !== word[at]) continue;
      const before = i ? path[i - 1] : "/";
      let b = 1;
      if (i === prev + 1) b += 5;
      if ("/._- ".includes(before)) b += 4;
      else if (path[i] !== lower[i] && before === before.toLowerCase()) b += 3;
      score += b; prev = i; at++;
    }
    return at === word.length ? score : -1;
  };
  const name = lower.slice(baseAt);
  if (name.includes(word)) return 100 + (name.startsWith(word) ? 30 : 0) + word.length * 6;
  const inName = walk(baseAt);
  if (inName >= 0) return 50 + inName;
  if (lower.includes(word)) return 25 + word.length * 4;
  return walk(0);
}

export function score(words, path) {
  const lower = path.toLowerCase(), baseAt = lower.lastIndexOf("/") + 1;
  let total = 0;
  for (const w of words) {
    const s = wordScore(w, path, lower, baseAt);
    if (s < 0) return -1;
    total += s;
  }
  return Math.max(0, total - path.length * 0.1);   // never under 0: that means no match
}
