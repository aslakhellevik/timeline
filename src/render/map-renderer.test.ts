import { describe, expect, it } from 'vitest';
import type { Id, Tag, TimelineEvent } from '../core/model/types';
import { clusterColour, inheritedTagColours } from './map-renderer';

const EUROPE = 'tag.region.europe';
const ART = 'tag.theme.art';
const WAR = 'tag.theme.war';
const PLAIN = 'user-tag-without-colour';

const COLOURS: ReadonlyMap<Id, string> = new Map([
  [EUROPE, '#4c6ef5'],
  [ART, '#f76707'],
  [WAR, '#e03131'],
]);

function tagged(...tags: Id[]): TimelineEvent {
  return { tags } as unknown as TimelineEvent;
}

describe('clusterColour', () => {
  it('is the tag most of the cluster carries, not the first event’s', () => {
    const events = [tagged(ART, EUROPE), tagged(EUROPE), tagged(EUROPE, WAR)];
    expect(clusterColour(events, COLOURS, 'grey')).toBe('#4c6ef5');
  });

  it('does not depend on the order of the events', () => {
    const events = [tagged(ART), tagged(WAR), tagged(WAR, ART), tagged(EUROPE)];
    const forward = clusterColour(events, COLOURS, 'grey');
    expect(clusterColour([...events].reverse(), COLOURS, 'grey')).toBe(forward);
  });

  it('breaks a tie by the order of the tags', () => {
    expect(clusterColour([tagged(WAR), tagged(ART)], COLOURS, 'grey')).toBe('#f76707');
  });

  it('ignores tags without a colour, and falls back when none has one', () => {
    expect(clusterColour([tagged(PLAIN), tagged(PLAIN, WAR)], COLOURS, 'grey')).toBe('#e03131');
    expect(clusterColour([tagged(PLAIN), tagged()], COLOURS, 'grey')).toBe('grey');
    expect(clusterColour([], COLOURS, 'grey')).toBe('grey');
  });
});

describe('inheritedTagColours', () => {
  const tag = (id: Id, extra: Partial<Tag> = {}): Tag =>
    ({ id, name: id, kind: 'region', ...extra }) as Tag;

  it('gives an uncoloured region its parent’s colour', () => {
    const colours = inheritedTagColours([
      tag('asia', { color: '#ae3ec9' }),
      tag('japan', { parent: 'asia' }),
      tag('kyoto', { parent: 'japan' }),
    ]);
    expect(colours.get('japan')).toBe('#ae3ec9');
    expect(colours.get('kyoto')).toBe('#ae3ec9');
  });

  it('keeps a tag’s own colour over its parent’s', () => {
    const colours = inheritedTagColours([
      tag('europe', { color: '#4c6ef5' }),
      tag('mediterranean', { parent: 'europe', color: '#12b886' }),
    ]);
    expect(colours.get('mediterranean')).toBe('#12b886');
  });

  it('leaves out a tag with no coloured ancestor, and survives a cycle', () => {
    const colours = inheritedTagColours([
      tag('a', { parent: 'b' }),
      tag('b', { parent: 'a' }),
      tag('orphan', { parent: 'missing' }),
    ]);
    expect(colours.size).toBe(0);
  });

  it('makes a Japan-only cluster Asian rather than its theme’s colour', () => {
    const colours = inheritedTagColours([
      tag('asia', { color: '#ae3ec9' }),
      tag('japan', { parent: 'asia' }),
      tag('technology', { kind: 'theme', color: '#1c7ed6' }),
    ]);
    const events = [tagged('japan', 'technology'), tagged('japan'), tagged('technology')];
    expect(clusterColour(events, colours, 'grey')).toBe('#ae3ec9');
  });
});
