/**
 * The premade tag set (README "Tags", design.md D14/D20).
 *
 * These ship with the app and carry fixed namespaced ids, so that packs and
 * imports attach to the same Europe the user already has rather than silently
 * creating a second one. `parent` gives rollup: filtering by Europe includes
 * Norway.
 *
 * This is the single source of truth for the premade tags — the synthetic
 * generator builds its corpus from it rather than keeping a parallel list.
 *
 * The colours are provisional. Connection colour encoding is deliberately left
 * open until the far view exists (design.md §10), and the palette gets a proper
 * pass when the renderer actually draws; these are placeholders that merely
 * need to be distinguishable.
 */

import type { Id, TagKind } from './types';

export interface BuiltinTag {
  id: Id;
  name: string;
  kind: TagKind;
  parent?: Id;
  color?: string;
  /**
   * Other names for the same tag (D44). A `#tag` in quick-add is one word, so a
   * premade tag called "Britain and Ireland" is untypeable without them: the
   * user types `#britain`, gets a private tag beside the built-in one, and the
   * event never shows under the region's filter. Aliases are matched after normalisation, so
   * only genuine synonyms belong here — a hyphen or a leading article does not.
   */
  aliases?: readonly string[];
}

// Regions ------------------------------------------------------------------

export const R_EUROPE = 'tag.region.europe';
export const R_BRITAIN = 'tag.region.britain';
export const R_FRANCE = 'tag.region.france';
export const R_GERMANY = 'tag.region.germany';
export const R_ITALY = 'tag.region.italy';
export const R_IBERIA = 'tag.region.iberia';
export const R_NORDICS = 'tag.region.nordics';
export const R_NORWAY = 'tag.region.norway';
export const R_RUSSIA = 'tag.region.russia';
export const R_MEDITERRANEAN = 'tag.region.mediterranean';
export const R_NEAR_EAST = 'tag.region.near-east';
export const R_ASIA = 'tag.region.asia';
export const R_CHINA = 'tag.region.china';
export const R_INDIA = 'tag.region.india';
export const R_JAPAN = 'tag.region.japan';
export const R_AFRICA = 'tag.region.africa';
export const R_AMERICAS = 'tag.region.americas';
export const R_NORTH_AMERICA = 'tag.region.north-america';
export const R_SOUTH_AMERICA = 'tag.region.south-america';
export const R_OCEANIA = 'tag.region.oceania';

// Themes — the history-of-ideas set ----------------------------------------

export const T_WAR = 'tag.theme.war';
export const T_POLITICS = 'tag.theme.politics';
export const T_PHILOSOPHY = 'tag.theme.philosophy';
export const T_SCIENCE = 'tag.theme.science';
export const T_MATHEMATICS = 'tag.theme.mathematics';
export const T_ART = 'tag.theme.art';
export const T_LITERATURE = 'tag.theme.literature';
export const T_MUSIC = 'tag.theme.music';
export const T_RELIGION = 'tag.theme.religion';
export const T_ECONOMICS = 'tag.theme.economics';
export const T_TECHNOLOGY = 'tag.theme.technology';
export const T_MEDICINE = 'tag.theme.medicine';
export const T_EXPLORATION = 'tag.theme.exploration';

export const REGION_TAGS: readonly BuiltinTag[] = [
  { id: R_EUROPE, name: 'Europe', kind: 'region', color: '#4c6ef5' },
  {
    id: R_BRITAIN,
    name: 'Britain and Ireland',
    kind: 'region',
    parent: R_EUROPE,
    aliases: ['britain', 'ireland', 'british isles'],
  },
  { id: R_FRANCE, name: 'France', kind: 'region', parent: R_EUROPE },
  {
    id: R_GERMANY,
    name: 'German lands',
    kind: 'region',
    parent: R_EUROPE,
    aliases: ['germany', 'german'],
  },
  { id: R_ITALY, name: 'Italy', kind: 'region', parent: R_EUROPE },
  { id: R_IBERIA, name: 'Iberia', kind: 'region', parent: R_EUROPE },
  {
    id: R_NORDICS,
    name: 'the Nordics',
    kind: 'region',
    parent: R_EUROPE,
    aliases: ['scandinavia'],
  },
  { id: R_NORWAY, name: 'Norway', kind: 'region', parent: R_NORDICS, aliases: ['norge'] },
  { id: R_RUSSIA, name: 'Russia', kind: 'region', parent: R_EUROPE, aliases: ['soviet union'] },
  { id: R_MEDITERRANEAN, name: 'the Mediterranean', kind: 'region', color: '#12b886' },
  {
    id: R_NEAR_EAST,
    name: 'the Near East',
    kind: 'region',
    color: '#f08c00',
    aliases: ['middle east'],
  },
  { id: R_ASIA, name: 'Asia', kind: 'region', color: '#ae3ec9' },
  { id: R_CHINA, name: 'China', kind: 'region', parent: R_ASIA },
  { id: R_INDIA, name: 'India', kind: 'region', parent: R_ASIA },
  { id: R_JAPAN, name: 'Japan', kind: 'region', parent: R_ASIA },
  { id: R_AFRICA, name: 'Africa', kind: 'region', color: '#e8590c' },
  { id: R_AMERICAS, name: 'the Americas', kind: 'region', color: '#1098ad' },
  { id: R_NORTH_AMERICA, name: 'North America', kind: 'region', parent: R_AMERICAS },
  {
    id: R_SOUTH_AMERICA,
    name: 'South America',
    kind: 'region',
    parent: R_AMERICAS,
    aliases: ['latin america'],
  },
  { id: R_OCEANIA, name: 'Oceania', kind: 'region', color: '#82c91e', aliases: ['australasia'] },
];

export const THEME_TAGS: readonly BuiltinTag[] = [
  { id: T_WAR, name: 'war', kind: 'theme', color: '#e03131' },
  { id: T_POLITICS, name: 'politics', kind: 'theme', color: '#5c7cfa' },
  { id: T_PHILOSOPHY, name: 'philosophy', kind: 'theme', color: '#7048e8' },
  { id: T_SCIENCE, name: 'science', kind: 'theme', color: '#0ca678' },
  { id: T_MATHEMATICS, name: 'mathematics', kind: 'theme', color: '#099268', aliases: ['maths'] },
  { id: T_ART, name: 'art', kind: 'theme', color: '#f76707' },
  { id: T_LITERATURE, name: 'literature', kind: 'theme', color: '#d6336c' },
  { id: T_MUSIC, name: 'music', kind: 'theme', color: '#c2255c' },
  { id: T_RELIGION, name: 'religion', kind: 'theme', color: '#adb5bd' },
  { id: T_ECONOMICS, name: 'economics', kind: 'theme', color: '#74b816' },
  { id: T_TECHNOLOGY, name: 'technology', kind: 'theme', color: '#1c7ed6', aliases: ['tech'] },
  { id: T_MEDICINE, name: 'medicine', kind: 'theme', color: '#37b24d' },
  { id: T_EXPLORATION, name: 'exploration', kind: 'theme', color: '#f59f00' },
];

export const BUILTIN_TAGS: readonly BuiltinTag[] = [...REGION_TAGS, ...THEME_TAGS];

/**
 * The comparison key for a tag name (D44).
 *
 * A `#tag` in quick-add is one word, so half the premade regions can only be
 * typed with a hyphen where their name has a space, and nobody types the
 * article: `#near-east`, `#nordics`. Treating `-`, `_` and a space as the same
 * character and dropping a leading "the" is what makes those land on the tag
 * they obviously mean instead of inventing a private one beside it.
 *
 * It applies to the user's own tags too, so "Reading List" answers to
 * `#reading-list`.
 */
export function normaliseTagName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim()
    .replace(/^the\s+/, '');
}

const BY_NAME = new Map<string, BuiltinTag>();
for (const tag of BUILTIN_TAGS) {
  BY_NAME.set(normaliseTagName(tag.name), tag);
  for (const alias of tag.aliases ?? []) BY_NAME.set(normaliseTagName(alias), tag);
}

/** The premade tag a typed name means, by name or by alias. */
export function builtinTagByName(name: string): BuiltinTag | undefined {
  return BY_NAME.get(normaliseTagName(name));
}
