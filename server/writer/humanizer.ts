import { splitSentences } from './text.ts';

/**
 * The humanizer rule set: patterns that make prose read as machine-written.
 *
 * Attribution. The taxonomy follows Wikipedia's "Wikipedia:Signs of AI writing"
 * (https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing, text under
 * CC BY-SA 4.0). Every rule description below is our own paraphrase; no prose
 * is copied from that page. Single words and short stock phrases are used only
 * as detection patterns. Extra markers come from the stylometry papers the
 * writer brief cites: sentence-initial transition words that AI editing
 * over-uses ("notably", "consequently", "additionally"; arXiv 2608.27855) and
 * nominalisation density (arXiv 2604.14111, measured in lint.ts). Third-party
 * humanizer skills (for example blader/humanizer, MIT) were not copied.
 *
 * Each rule is a pass/fail detector over a letter, answer or note. The lint
 * counts hits (zero allowed) and the humanize pass asks Claude to rewrite only
 * the sentences that contain them.
 */

export type TellCategory =
  | 'significance'
  | 'promotional'
  | 'vague_attribution'
  | 'ai_vocabulary'
  | 'transition'
  | 'negative_parallelism'
  | 'opener'
  | 'closer'
  | 'hedging'
  | 'sycophancy'
  | 'cliche'
  | 'formatting';

export interface HumanizerRule {
  id: string;
  category: TellCategory;
  /** Our paraphrase of what the pattern signals. */
  description: string;
  /** How to fix it, sent to the humanize pass. */
  fix: string;
  pattern: RegExp;
}

const w = (alts: string) => new RegExp(`(?<![A-Za-z])(?:${alts})(?![A-Za-z])`, 'gi');

export const HUMANIZER_RULES: HumanizerRule[] = [
  // Significance inflation: telling the reader something matters instead of showing why.
  {
    id: 'significance-inflation',
    category: 'significance',
    description: 'Inflates importance with stock phrases (a testament to, plays a pivotal role, marks a shift).',
    fix: 'Say the concrete thing that happened; drop the claim that it matters.',
    pattern: w(
      "(?:is|was|stands as|serves as) a (?:testament|reminder)|a testament to|plays? an? (?:pivotal|crucial|vital|key|significant) role|underscor(?:es|ed|ing) (?:the|its|their) importance|reflects? (?:the )?broader|setting the stage for|marks? an? (?:significant |major )?(?:shift|turning point|milestone)|indelible mark|deeply rooted|evolving landscape|ever-evolving|ever-changing|in today's (?:fast-paced|digital|modern) world",
    ),
  },
  {
    id: 'copula-avoidance',
    category: 'significance',
    description: 'Avoids plain "is" with grand substitutes (serves as, stands as, functions as).',
    fix: 'Use "is" or a plain verb.',
    pattern: w('serves as an?|stands as an?|functions as an?'),
  },
  // Promotional tone: brochure language.
  {
    id: 'promotional',
    category: 'promotional',
    description: 'Brochure language that praises instead of describing.',
    fix: 'Replace praise with a specific, checkable detail.',
    pattern: w(
      "boasts?|vibrant|rich (?:history|heritage|tradition)|profound|showcas(?:e|es|ed|ing)|exemplif(?:y|ies|ied)|commitment to excellence|groundbreaking|renowned|world-class|best-in-class|state-of-the-art|cutting-edge|nestled|in the heart of|diverse array|game-?changer|innovative solutions?|industry-leading",
    ),
  },
  // Vague attribution.
  {
    id: 'vague-attribution',
    category: 'vague_attribution',
    description: 'Attributes claims to unnamed experts, reports or observers.',
    fix: 'Name the source or cut the claim.',
    pattern: w(
      'experts (?:say|argue|agree|believe)|industry (?:reports|experts|observers)|observers have (?:noted|cited)|studies (?:show|have shown)|it is widely (?:known|believed|recognized|recognised|accepted)|many (?:believe|would argue)|some critics argue',
    ),
  },
  // AI vocabulary: words that cluster in model output far above their human rate.
  {
    id: 'ai-vocabulary',
    category: 'ai_vocabulary',
    description: 'Words that appear in model-written text far more often than in human writing.',
    fix: 'Use the plain word a person would say out loud.',
    pattern: w(
      "delv(?:e|es|ed|ing)|tapestry|testament|pivotal|leverag(?:e|es|ed|ing)|seamless(?:ly)?|robust|elevat(?:e|es|ed|ing)|foster(?:s|ed|ing)?|navigat(?:e|es|ed|ing) the (?:complexities|challenges|intricacies)|intricac(?:y|ies)|intricate|meticulous(?:ly)?|underscor(?:e|es|ed|ing)|bolster(?:s|ed|ing)?|garner(?:s|ed|ing)?|interplay|enduring|multifaceted|holistic|synerg(?:y|ies|istic)|paradigm|realm|embark(?:s|ed|ing)?|unwavering|crucial|deep dive|align(?:s|ed)? (?:perfectly |closely )?with|resonat(?:e|es|ed) (?:deeply )?with|in the (?:\\w+ )?landscape|landscape of|thrive in|dynamic team|fast-paced|team player|self-starter|hit the ground running|results-driven|detail-oriented|go-getter|wheelhouse",
    ),
  },
  {
    id: 'passionate',
    category: 'cliche',
    description: 'Declares passion instead of showing interest through specifics.',
    fix: 'Show the interest with something the candidate actually did.',
    pattern: w('passionate|passion for|my passion'),
  },
  // Transition words that AI editing over-uses at sentence starts.
  {
    id: 'ai-transitions',
    category: 'transition',
    description: 'Stiff sentence-initial transitions that AI editing adds (additionally, moreover, notably).',
    fix: 'Drop the transition or use "and", "but", "so", "also".',
    pattern: /(?:^|[.!?]\s+|\n)(?:Additionally|Moreover|Furthermore|Notably|Consequently|Ultimately|In essence|Importantly|Overall),/g,
  },
  // Negative parallelisms.
  {
    id: 'negative-parallelism',
    category: 'negative_parallelism',
    description: 'The "not just X, but Y" / "it is not X, it is Y" construction.',
    fix: 'State Y directly.',
    pattern: /\bnot (?:just|only|merely|simply)\b[^.!?\n]{1,90}?\bbut(?: also)?\b|\b(?:it|this|that)(?:'s| is| was) not (?:just |only |merely )?(?:about )?[^.!?\n]{1,60}?[,;:—-]\s*(?:it|this|that)(?:'s| is| was)\b|\bisn't just\b|\bmore than just\b/gi,
  },
  // Formulaic openers.
  {
    id: 'opener-writing-to',
    category: 'opener',
    description: 'Opens with "I am writing to…".',
    fix: 'Open with something specific to the company or role.',
    pattern: /\bI(?: am|'m|’m) writing (?:to|in)\b/gi,
  },
  {
    id: 'opener-excited',
    category: 'opener',
    description: 'Opens with excitement about applying.',
    fix: 'Open with a specific fact about the role, the team or the work.',
    pattern: /\bI(?: am|'m|’m) (?:so |very |truly |really )?(?:excited|thrilled|delighted|eager|pleased|keen) to (?:apply|submit|express|be considered|throw my hat)\b/gi,
  },
  {
    id: 'opener-stock',
    category: 'opener',
    description: 'Stock cover-letter openers.',
    fix: 'Open with something specific to the company or role.',
    pattern: w(
      'please accept (?:this|my) (?:letter|application)|I would like to (?:express|apply)|my name is|as a highly motivated|with a proven track record|I came across your (?:posting|job posting|advert|listing)|I am confident that I (?:am|would be) (?:the|a) (?:ideal|perfect|strong)',
    ),
  },
  // Formulaic closers and summary sentences.
  {
    id: 'closer-stock',
    category: 'closer',
    description: 'Stock cover-letter closers.',
    fix: 'End with one concrete, low-pressure ask.',
    pattern: w(
      "thank you for (?:considering|your consideration)|I look forward to (?:hearing from you|the opportunity)|please (?:do not|don't) hesitate|don't hesitate to|in conclusion|to summari[sz]e|in summary|all in all|would (?:be|make) (?:me )?an? (?:great|perfect|ideal|strong|excellent) (?:fit|addition|asset|candidate)|valuable (?:addition|asset)|make a meaningful (?:impact|contribution)|contribute to your (?:continued )?success",
    ),
  },
  // Hedging and chatbot residue.
  {
    id: 'hedging-stock',
    category: 'hedging',
    description: 'Disclaimers and hedges that hold the claim at arm\'s length.',
    fix: 'Say it plainly or cut it.',
    pattern: w("it(?:'s| is) (?:important|worth) (?:to note|noting)|while specific details|based on (?:the )?available information|to some extent|it could be argued|I believe that I|I feel that I"),
  },
  {
    id: 'sycophancy',
    category: 'sycophancy',
    description: 'Flattery of the reader or chatbot-style residue.',
    fix: 'Cut it.',
    pattern: w(
      "your (?:esteemed|prestigious|renowned|reputable) (?:company|organi[sz]ation|team|firm)|esteemed (?:company|organi[sz]ation)|I would be (?:honou?red|privileged)|I(?:'m| am) (?:honou?red|humbled)|certainly!|of course!|great question|I hope this (?:helps|message finds you|email finds you|finds you well)|let me know if you (?:need|have) anything|absolutely love",
    ),
  },
  // Formatting residue: a letter has no markdown, headings or placeholders.
  {
    id: 'markdown',
    category: 'formatting',
    description: 'Markdown or chat formatting in prose (bold, headings, rules, code fences).',
    fix: 'Plain prose only.',
    pattern: /\*\*[^*\n]+\*\*|^#{1,6}\s|^---+\s*$|```|^\s*[-*•]\s+\S/gm,
  },
  {
    id: 'title-case-heading',
    category: 'formatting',
    description: 'A Title Case heading line inside prose (letters and answers have no headings).',
    fix: 'Remove the heading; let the paragraph speak for itself.',
    pattern: /^[ 	]*(?:[A-Z][a-z]+|&)(?:[ 	]+(?:[A-Z][a-z]+|&|of|and|for|the|to|in|a|an)){2,7}[ 	]*$/gm,
  },
  {
    id: 'placeholder',
    category: 'formatting',
    description: 'An unfilled template placeholder.',
    fix: 'Fill it with the real value or remove it.',
    pattern: /\[[A-Z][A-Za-z ]{1,30}\]|\{\{[^}]*\}\}|\bINSERT[_ ][A-Z_]+|\bXX+\b|<(?:company|name|role)>/g,
  },
];

export interface Tell {
  rule: string;
  category: TellCategory;
  match: string;
  index: number;
  /** The sentence the hit sits in: the span the humanize pass may rewrite. */
  sentence: string;
}

const HEDGES = /(?<![A-Za-z])(?:perhaps|possibly|potentially|arguably|somewhat|relatively|fairly|might|may be|could potentially|i think|i feel|i believe)(?![A-Za-z])/gi;

/** Every rule hit, plus excessive hedging (more than two hedges in one text). */
export function findTells(text: string): Tell[] {
  const sentences = splitSentences(text);
  const sentenceAt = (idx: number, match: string): string => {
    const probe = text.slice(Math.max(0, idx - 2), idx + match.length + 2);
    return sentences.find((s) => s.includes(match.trim())) ?? sentences.find((s) => probe.includes(s)) ?? match;
  };
  const out: Tell[] = [];
  for (const r of HUMANIZER_RULES) {
    r.pattern.lastIndex = 0;
    for (const m of text.matchAll(r.pattern)) {
      const match = m[0].replace(/^[.!?\s]+/, '');
      out.push({ rule: r.id, category: r.category, match, index: m.index ?? 0, sentence: sentenceAt(m.index ?? 0, match) });
    }
  }
  const hedges = [...text.matchAll(HEDGES)];
  if (hedges.length > 2) {
    for (const m of hedges) out.push({ rule: 'hedging-density', category: 'hedging', match: m[0], index: m.index ?? 0, sentence: sentenceAt(m.index ?? 0, m[0]) });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function ruleById(id: string): HumanizerRule | undefined {
  return HUMANIZER_RULES.find((r) => r.id === id);
}

/** The rules as a compact list for the humanize prompt (stable text, so it caches). */
export function rulesForPrompt(): string {
  return HUMANIZER_RULES.map((r) => `- ${r.id} (${r.category}): ${r.description} Fix: ${r.fix}`).join('\n');
}
